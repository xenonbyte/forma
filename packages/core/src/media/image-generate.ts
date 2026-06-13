// ---------------------------------------------------------------------------
// Image generation scheduler — SPEC-BEHAVIOR-001 / SPEC-BEHAVIOR-002
//
// Drives a single image-generation request end to end:
//
//   resolveActiveImageConfig  → learn the configured provider + model
//                               (throws MEDIA_NOT_CONFIGURED when unconfigured)
//   validate model + provider → MEDIA_INVALID_INPUT on catalogue mismatch
//   validate purpose / aspect / count → MEDIA_INVALID_INPUT (no silent fixups)
//   renderer registry lookup  → render N images (provider call or stub)
//   putStagedImage            → land each PNG in the per-product staging area
//
// `model` is NOT a caller input: it always comes from config. The spec lists
// "model validation" before "resolveProviderConfig", but the model IS derived
// from config — so we resolve config FIRST, then validate that the configured
// model is registered and belongs to the resolved provider. This ordering keeps
// the unconfigured case (MEDIA_NOT_CONFIGURED) and the bad-model case
// (MEDIA_INVALID_INPUT) cleanly separable, which the tests assert.
//
// Generation deliberately does NOT take the product-mutation lock: staging
// writes are isolated per-image under a UUID and never mutate product state.
//
// Mid-batch failure semantics: a failure on image N of a multi-count batch
// propagates immediately (fail loud), leaving images 1..N-1 staged on disk;
// the staging TTL sweep reclaims them.
//
// Renderers (provider id → fn):
//   volcengine  POST {baseUrl}/images/generations, Bearer auth, b64_json.
//               Ported from the open-design daemon's renderVolcengineImage.
//   openai      POST {baseUrl}/images/generations, Bearer auth, b64_json.
//               gpt-image-1: same OpenAI shape, but NO response_format / NO
//               watermark (gpt-image-1 400s on response_format and always
//               returns b64_json).
//   gemini      POST {baseUrl}/images/generations, Bearer auth, b64_json.
//               gemini-2.5-flash-image via the OpenAI-compat endpoint: sends
//               response_format but NO size (size handling is UNCONFIRMED, the
//               official example omits it); actual dimensions are read back from
//               the decoded PNG.
//   stub        deterministic offline PNG (width/height encoded in real IHDR
//               bytes); never touches the network. Used by tests.
//
// volcengine/openai/gemini all share one OpenAI-compatible renderer
// (renderOpenAICompatibleImage) that branches on providerId for the documented
// per-provider dialect differences (body fields + dimension source).
//
// Security: a provider error NEVER carries the api key. Non-2xx / unparseable
// responses throw MEDIA_PROVIDER_ERROR with the HTTP status and a body
// truncated to PROVIDER_BODY_LIMIT chars. The Authorization header is built
// locally and is never echoed into any error.
// ---------------------------------------------------------------------------

import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { FormaError } from "../errors.js";
import { resolveActiveImageConfig, type ResolvedImageConfig } from "./image-config.js";
import { ASPECT_RATIOS, type AspectRatio, findImageModel, resolveSize } from "./image-models.js";
import { assertSafeStagingSegment, putStagedImage } from "./image-staging.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Closed set of generation purposes; each maps to a default aspect ratio. */
export type ImagePurpose = "app-icon" | "illustration" | "hero" | "poster-bg" | "store-shot-bg";

/** Input to generateImages. `model` is intentionally absent — it comes from config. */
export type GenerateImagesInput = {
  /** Product the staged images belong to. */
  productId: string;
  /** What the image is for; drives the default aspect ratio. */
  purpose: ImagePurpose;
  /** Generation prompt. Core only passes this through verbatim — no rewriting. */
  prompt: string;
  /** Optional aspect override. Defaults to the purpose's canonical aspect. */
  aspect?: AspectRatio;
  /** How many images to generate. Defaults to 1; must be 1..4. */
  count?: number;
};

/** One staged image in the result. */
export type GeneratedImage = {
  /** Staging UUID. */
  id: string;
  /** forma-image://<uuid> reference. */
  ref: string;
  /** Absolute on-disk path to the staged .png. */
  preview_path: string;
  /** Pixel width. */
  width: number;
  /** Pixel height. */
  height: number;
};

/** Result of generateImages. */
export type GenerateImagesResult = {
  images: GeneratedImage[];
  /** Human-readable note about the provider/model used. */
  provider_note: string;
  /** Non-fatal advisories (empty in v1). */
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The supported image purposes, in canonical order. */
export const IMAGE_PURPOSES = [
  "app-icon",
  "illustration",
  "hero",
  "poster-bg",
  "store-shot-bg",
] as const satisfies readonly ImagePurpose[];

/** Default aspect ratio per purpose (SPEC-BEHAVIOR-001). */
const PURPOSE_DEFAULT_ASPECT: Record<ImagePurpose, AspectRatio> = {
  "app-icon": "1:1",
  illustration: "4:3",
  hero: "16:9",
  "poster-bg": "9:16",
  "store-shot-bg": "9:16",
};

/** Inclusive count bounds. */
const COUNT_MIN = 1;
const COUNT_MAX = 4;

/** How many chars of a provider error body we surface in details.body. */
const PROVIDER_BODY_LIMIT = 500;

// ---------------------------------------------------------------------------
// Renderer contract + registry
// ---------------------------------------------------------------------------

/** Everything a renderer needs to produce one image's bytes. */
type RenderInput = {
  prompt: string;
  aspect: AspectRatio;
  model: string;
  width: number;
  height: number;
};

/** Plaintext provider credentials handed to a renderer. */
type ProviderConfig = { apiKey: string; baseUrl: string; model: string };

/** A renderer turns one RenderInput into one image's raw PNG bytes. */
type ImageRenderer = (input: RenderInput, cfg: ProviderConfig) => Promise<RenderedImage>;

/**
 * Raw bytes produced by a renderer. `width`/`height` are OPTIONAL authoritative
 * dimensions the renderer read back from the actual decoded image (used by
 * gemini, whose request omits `size` so the model picks its own dimensions).
 * When absent, the scheduler keeps the requested {width,height}.
 */
type RenderedImage = { bytes: Buffer; width?: number; height?: number };

/**
 * The three real providers all speak the OpenAI-compatible images API, so they
 * share renderOpenAICompatibleImage with the providerId baked into a closure.
 * The closure threads the dialect (which body fields to send, where the
 * dimensions come from) without widening the ImageRenderer signature. `stub`
 * stays its own pure-JS offline renderer.
 */
const RENDERERS: Record<string, ImageRenderer> = {
  volcengine: (input, cfg) => renderOpenAICompatibleImage(input, cfg, "volcengine"),
  openai: (input, cfg) => renderOpenAICompatibleImage(input, cfg, "openai"),
  gemini: (input, cfg) => renderOpenAICompatibleImage(input, cfg, "gemini"),
  stub: renderStubImage,
};

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Generate `count` images for `input.prompt` using the configured provider, and
 * land each one in the per-product staging area. See the module header for the
 * full sequence and the model-validation ordering rationale.
 */
export async function generateImages(home: string, input: GenerateImagesInput): Promise<GenerateImagesResult> {
  // 0. Validate the agent-facing productId BEFORE any I/O or provider call.
  //    productId is joined into the per-product staging path, so a path-unsafe
  //    value (traversal / separators / absolute / NUL / control / over-length)
  //    must be rejected up front (Finding 3a). The boundary is PATH SAFETY, not
  //    product-id shape: the staging dir name just has to stay a single safe
  //    segment, and the /api/media/test probe stages under a non-product
  //    sentinel. assertSafeStagingSegment is the shared validator used by the
  //    staging layer too.
  assertSafeStagingSegment(input.productId);

  // 1. Resolve the active config (provider + model + creds). Unconfigured →
  //    MEDIA_NOT_CONFIGURED (raised inside resolveActiveImageConfig).
  const config = await resolveActiveImageConfig(home);

  // 2. Validate the configured model is registered AND belongs to the resolved
  //    provider. A config that names an unknown / cross-provider model is an
  //    invalid input the operator must fix.
  validateConfiguredModel(config);

  // 3. Validate caller input: purpose, aspect, count.
  const purpose = validatePurpose(input.purpose);
  const aspect = resolveAspect(input.aspect, purpose);
  const count = validateCount(input.count);

  // 4. Dimensions from the verified per-model size table.
  const { width, height } = resolveSize(config.model, aspect);

  // 5. Look up the renderer for the resolved provider.
  const renderer = RENDERERS[config.providerId];
  if (!renderer) {
    throw new FormaError("MEDIA_INVALID_INPUT", `No renderer for provider: ${config.providerId}`, {
      provider: config.providerId,
      knownProviders: Object.keys(RENDERERS),
    });
  }

  const renderInput: RenderInput = { prompt: input.prompt, aspect, model: config.model, width, height };
  const cfg: ProviderConfig = { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model };

  // 6. Render N images sequentially and stage each one. A renderer may report
  //    authoritative dimensions it read back from the actual decoded image
  //    (gemini, whose request omits `size`); when it does, those win over the
  //    nominal table value. volcengine/openai honour the requested size, so
  //    their renderer leaves these undefined and we keep {width,height}.
  const images: GeneratedImage[] = [];
  for (let i = 0; i < count; i++) {
    const rendered = await renderer(renderInput, cfg);
    const actualWidth = rendered.width ?? width;
    const actualHeight = rendered.height ?? height;
    const staged = await putStagedImage(home, input.productId, rendered.bytes, {
      purpose,
      prompt: input.prompt,
      model: config.model,
      width: actualWidth,
      height: actualHeight,
    });
    images.push({
      id: staged.id,
      ref: staged.ref,
      preview_path: staged.path,
      width: actualWidth,
      height: actualHeight,
    });
  }

  return {
    images,
    provider_note: `${config.providerId}/${config.model} · ${aspect} · ${width}x${height} · ${count} image${count === 1 ? "" : "s"}`,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Ensure the configured model is in the catalogue and matches its provider. */
function validateConfiguredModel(config: ResolvedImageConfig): void {
  const entry = findImageModel(config.model);
  if (!entry) {
    throw new FormaError("MEDIA_INVALID_INPUT", `Configured image model is not in the catalogue: ${config.model}`, {
      model: config.model,
      provider: config.providerId,
    });
  }
  if (entry.provider !== config.providerId) {
    throw new FormaError(
      "MEDIA_INVALID_INPUT",
      `Configured model ${config.model} belongs to provider ${entry.provider}, not ${config.providerId}`,
      { model: config.model, modelProvider: entry.provider, activeProvider: config.providerId },
    );
  }
}

function validatePurpose(purpose: ImagePurpose): ImagePurpose {
  if (!IMAGE_PURPOSES.includes(purpose)) {
    throw new FormaError("MEDIA_INVALID_INPUT", `Unknown image purpose: ${purpose}`, {
      purpose,
      validPurposes: IMAGE_PURPOSES,
    });
  }
  return purpose;
}

function resolveAspect(aspect: AspectRatio | undefined, purpose: ImagePurpose): AspectRatio {
  if (aspect === undefined) return PURPOSE_DEFAULT_ASPECT[purpose];
  if (!ASPECT_RATIOS.includes(aspect)) {
    throw new FormaError("MEDIA_INVALID_INPUT", `Unsupported aspect ratio: ${aspect}`, {
      aspect,
      supportedAspects: ASPECT_RATIOS,
    });
  }
  return aspect;
}

function validateCount(count: number | undefined): number {
  if (count === undefined) return COUNT_MIN;
  if (!Number.isInteger(count) || count < COUNT_MIN || count > COUNT_MAX) {
    throw new FormaError("MEDIA_INVALID_INPUT", `count must be an integer in ${COUNT_MIN}..${COUNT_MAX}`, {
      count,
      min: COUNT_MIN,
      max: COUNT_MAX,
    });
  }
  return count;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible renderer — serves volcengine + openai + gemini
// (volcengine path ported from the open-design daemon renderVolcengineImage)
// ---------------------------------------------------------------------------

/** Providers that share the OpenAI-compatible images endpoint. */
type OpenAICompatProvider = "volcengine" | "openai" | "gemini";

/**
 * One image via the OpenAI-compatible images API, shared by volcengine, openai,
 * and gemini:
 *   POST {baseUrl}/images/generations
 *   Authorization: Bearer <key>
 *   body: provider-specific (see buildRequestBody)
 *
 * Parses data[0].b64_json (preferred) or data[0].url (second GET for bytes,
 * SSRF-guarded). Any non-2xx or unparseable response throws MEDIA_PROVIDER_ERROR
 * carrying the status and a truncated body — never the key.
 *
 * Per-provider dialect (verified differences):
 *   volcengine — { model, prompt, size:"WxH", response_format:"b64_json",
 *                  watermark:false }. UNCHANGED from v1 (M1-verified). Honours
 *                  the requested size, so dims = requested {width,height}.
 *   openai     — { model, prompt, size:"WxH" }. NO response_format (gpt-image-1
 *                  400s on it and always returns b64_json), NO watermark.
 *                  Honours size, so dims = requested {width,height}.
 *   gemini     — { model, prompt, response_format:"b64_json" }. NO size
 *                  (OpenAI-compat size handling UNCONFIRMED; official example
 *                  omits it), NO watermark. The model picks its own dimensions,
 *                  so we read the ACTUAL width/height back from the decoded PNG.
 */
async function renderOpenAICompatibleImage(
  input: RenderInput,
  cfg: ProviderConfig,
  provider: OpenAICompatProvider,
): Promise<RenderedImage> {
  if (!cfg.apiKey) {
    // resolveProviderConfig already guards this, but keep the renderer honest.
    throw new FormaError("MEDIA_NOT_CONFIGURED", `No ${provider} API key`, { provider });
  }
  const baseUrl = (cfg.baseUrl || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
  const body = buildRequestBody(input, cfg, provider);

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw providerError(0, "", `Image provider request failed: ${err instanceof Error ? err.message : "error"}`, [
      cfg.apiKey,
    ]);
  }

  const text = await resp.text();
  if (!resp.ok) {
    throw providerError(resp.status, text, undefined, [cfg.apiKey]);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw providerError(resp.status, text, "Image provider response was not valid JSON", [cfg.apiKey]);
  }

  const entry = isRecord(data) && Array.isArray(data.data) ? data.data[0] : null;
  if (!isRecord(entry)) {
    throw providerError(resp.status, text, "Image provider response had no data[0]", [cfg.apiKey]);
  }

  let bytes: Buffer;
  if (typeof entry.b64_json === "string" && entry.b64_json) {
    bytes = Buffer.from(entry.b64_json, "base64");
  } else if (typeof entry.url === "string" && entry.url) {
    // The url is fully provider-controlled, so this second fetch is an SSRF
    // sink: screen it (scheme + literal private/loopback IPs + no redirects +
    // size cap) before the request is allowed to run. See Finding 4a and
    // assertSafeFetchUrl below.
    bytes = await fetchImageBytesGuarded(entry.url);
  } else {
    throw providerError(resp.status, text, "Image provider response missing b64_json/url", [cfg.apiKey]);
  }

  const actual = await readImageDimensions(bytes);

  // gemini omits `size`, so the model chose its own dimensions: read them back
  // from the actual bytes (authoritative). volcengine/openai honour the
  // requested size, so they leave dims undefined and the scheduler keeps the
  // requested {width,height}.
  if (provider === "gemini") {
    return { bytes, ...actual };
  }
  return { bytes };
}

/**
 * Build the provider-specific request body. The three providers diverge only in
 * which of {size, response_format, watermark} they accept (see the function
 * doc on renderOpenAICompatibleImage for the verified rationale per field).
 */
function buildRequestBody(
  input: RenderInput,
  cfg: ProviderConfig,
  provider: OpenAICompatProvider,
): Record<string, unknown> {
  const base: Record<string, unknown> = { model: cfg.model, prompt: input.prompt };
  switch (provider) {
    case "volcengine":
      // UNCHANGED from v1 (M1-verified). Volcengine stamps a visible "AI
      // generated" watermark by default; Forma output is commercial brand
      // material (icons, store shots, posters), so request without it. Any
      // required AI-content labeling for a channel is the operator's call.
      return { ...base, size: `${input.width}x${input.height}`, response_format: "b64_json", watermark: false };
    case "openai":
      // gpt-image-1 rejects response_format (always returns b64_json) and has
      // no watermark control. It honours size from the OpenAI size table.
      return { ...base, size: `${input.width}x${input.height}` };
    case "gemini":
      // gemini's OpenAI-compat endpoint accepts response_format but its size
      // handling is UNCONFIRMED (official example omits size), so we let the
      // model use its default and read the actual dims back from the bytes.
      return { ...base, response_format: "b64_json" };
  }
}

/**
 * Read the actual pixel dimensions from decoded image bytes via sharp (already a
 * core dependency). Throws MEDIA_PROVIDER_ERROR (never the api key) when sharp
 * cannot determine the dimensions — we fail loud rather than guess, since the
 * gemini nominal size table is bookkeeping-only and there is no trustworthy
 * fallback for a gemini render.
 */
async function readImageDimensions(bytes: Buffer): Promise<{ width: number; height: number }> {
  let meta: import("sharp").Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: SHARP_PIXEL_LIMIT }).metadata();
  } catch (err) {
    throw providerError(
      0,
      "",
      `Image provider returned bytes sharp could not read: ${err instanceof Error ? err.message : "error"}`,
    );
  }
  if (!Number.isFinite(meta.width) || !Number.isFinite(meta.height) || !meta.width || !meta.height) {
    throw providerError(0, "", "Image provider returned an image with no readable dimensions");
  }
  return { width: meta.width, height: meta.height };
}

// ---------------------------------------------------------------------------
// SSRF guard for the provider-controlled url second-fetch (Finding 4a).
// Applies to ALL providers' data[0].url responses (volcengine/openai/gemini).
// ---------------------------------------------------------------------------

/** Hard ceiling on a downloaded provider image: 64 MiB. */
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

/** sharp decode ceiling for provider-returned bytes. */
const SHARP_PIXEL_LIMIT = 64_000_000;

/**
 * Validate `rawUrl` before it is fetched.
 *
 * Rejects:
 *   - any scheme other than http:/https: (no file:, data:, ftp:, gopher:, …);
 *   - literal IPs in private / loopback / link-local / unique-local / unspecified
 *     ranges (IPv4 + IPv6, including IPv4-mapped IPv6 forms);
 *   - the hostnames localhost / *.localhost / metadata / metadata.google.internal.
 *
 * Residual risk: a hostname that DNS-resolves to a private IP (DNS rebinding)
 * is NOT caught here — we do not resolve+pin synchronously. This is an accepted
 * v1 limitation; the literal-IP and known-hostname blocks close the cheap,
 * common SSRF vectors (cloud metadata, loopback services, RFC1918 hosts).
 *
 * Throws MEDIA_PROVIDER_ERROR (never the api key) on rejection.
 */
function assertSafeFetchUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw providerError(0, "", "Image provider url is not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw providerError(0, "", `Image provider url scheme not allowed: ${url.protocol}`);
  }

  const host = normalizeUrlHostname(url.hostname);

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata" ||
    host === "metadata.google.internal"
  ) {
    throw providerError(0, "", "Image provider url targets a blocked host");
  }

  if (isBlockedLiteralIp(host)) {
    throw providerError(0, "", "Image provider url targets a private/loopback address");
  }

  return url;
}

/** Normalize WHATWG URL hostnames before literal-IP range checks. */
function normalizeUrlHostname(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

/** True if `host` is a literal IP in a private/loopback/link-local/etc. range. */
function isBlockedLiteralIp(host: string): boolean {
  // IPv4 dotted quad.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const octets = v4.slice(1, 5).map(Number);
    if (octets.some((o) => o > 255)) return true; // malformed → reject
    return isBlockedIpv4(octets as [number, number, number, number]);
  }

  // IPv6 literal.
  if (host.includes(":")) {
    const h = host.replace(/%.*$/, ""); // strip zone id
    const parts = parseIpv6Hextets(h);
    if (!parts) return true; // malformed literal → reject

    // IPv4-mapped / -compatible IPv6 after WHATWG normalization
    // (e.g. ::ffff:127.0.0.1 becomes ::ffff:7f00:1).
    const embedded = ipv4FromIpv6(parts);
    if (embedded && isBlockedIpv4(embedded)) return true;

    if (parts.every((part) => part === 0)) return true; // unspecified
    if (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) return true; // loopback
    if ((parts[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((parts[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    return false;
  }

  return false;
}

function parseIpv4DottedQuad(value: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((o) => o > 255)) return null;
  return octets as [number, number, number, number];
}

function parseIpv6Side(side: string): number[] | null {
  if (!side) return [];
  const groups = side.split(":");
  const parts: number[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (!group) return null;
    if (group.includes(".")) {
      if (i !== groups.length - 1) return null;
      const octets = parseIpv4DottedQuad(group);
      if (!octets) return null;
      parts.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    parts.push(Number.parseInt(group, 16));
  }
  return parts;
}

function parseIpv6Hextets(host: string): [number, number, number, number, number, number, number, number] | null {
  const doubleColon = host.split("::");
  if (doubleColon.length > 2) return null;

  if (doubleColon.length === 1) {
    const parts = parseIpv6Side(host);
    return parts?.length === 8 ? (parts as [number, number, number, number, number, number, number, number]) : null;
  }

  const left = parseIpv6Side(doubleColon[0]);
  const right = parseIpv6Side(doubleColon[1]);
  if (!left || !right || left.length + right.length > 7) return null;
  const parts = [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
  return parts as [number, number, number, number, number, number, number, number];
}

function ipv4FromIpv6(
  parts: [number, number, number, number, number, number, number, number],
): [number, number, number, number] | null {
  const firstFiveZero = parts.slice(0, 5).every((part) => part === 0);
  const isMapped = firstFiveZero && parts[5] === 0xffff;
  const isCompatible = firstFiveZero && parts[5] === 0;
  if (!isMapped && !isCompatible) return null;
  return [(parts[6] >> 8) & 0xff, parts[6] & 0xff, (parts[7] >> 8) & 0xff, parts[7] & 0xff];
}

/** True if the IPv4 octets fall in a blocked range. */
function isBlockedIpv4(o: [number, number, number, number]): boolean {
  const [a, b] = o;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  return false;
}

/**
 * Fetch image bytes from a provider-controlled url after SSRF screening, with
 * redirects disabled and a hard size cap. Throws MEDIA_PROVIDER_ERROR on any
 * failure (bad scheme/host, redirect, non-2xx, oversize) — never the api key.
 */
async function fetchImageBytesGuarded(rawUrl: string): Promise<Buffer> {
  assertSafeFetchUrl(rawUrl);

  let imgResp: Response;
  try {
    // redirect: "error" — a redirect could send us to a host the guard never
    // saw (e.g. a 302 from a public CDN to http://169.254.169.254/...).
    // Pass the original raw string (URL.toString() can re-encode the path).
    imgResp = await fetch(rawUrl, { redirect: "error" });
  } catch (err) {
    throw providerError(0, "", `Image provider url fetch failed: ${err instanceof Error ? err.message : "error"}`);
  }

  if (!imgResp.ok) {
    throw providerError(imgResp.status, "", "Image provider url fetch failed");
  }

  // Reject up front if the server advertises an oversized payload.
  const declared = Number(imgResp.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw providerError(imgResp.status, "", `Image provider response exceeds ${MAX_IMAGE_BYTES} byte cap`);
  }

  return await readCapped(imgResp, MAX_IMAGE_BYTES);
}

/**
 * Read a response body into a Buffer, aborting (throwing MEDIA_PROVIDER_ERROR)
 * if the streamed total exceeds `cap`. Falls back to arrayBuffer() with a
 * post-read length check when the body is not a readable stream.
 */
async function readCapped(resp: Response, cap: number): Promise<Buffer> {
  const body = resp.body;
  if (!body || typeof body.getReader !== "function") {
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > cap) {
      throw providerError(resp.status, "", `Image provider response exceeds ${cap} byte cap`);
    }
    return buf;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw providerError(resp.status, "", `Image provider response exceeds ${cap} byte cap`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}

/**
 * Build a MEDIA_PROVIDER_ERROR. The body is redacted and truncated to
 * PROVIDER_BODY_LIMIT chars. Some custom OpenAI-compatible endpoints echo
 * request headers in their response body, so redact the current request secret
 * before surfacing provider-controlled text.
 */
function providerError(status: number, body: string, message?: string, secrets: readonly string[] = []): FormaError {
  return new FormaError("MEDIA_PROVIDER_ERROR", message ?? `Image provider returned ${status}`, {
    status,
    body: truncate(redactSecrets(body, secrets), PROVIDER_BODY_LIMIT),
  });
}

function redactSecrets(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (!secret) continue;
    const escaped = escapeRegExp(secret);
    redacted = redacted.replace(new RegExp(`Bearer\\s+${escaped}`, "gi"), "[REDACTED:authorization]");
    redacted = redacted.replace(new RegExp(escaped, "g"), "[REDACTED:api-key]");
  }
  return redacted;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

// ---------------------------------------------------------------------------
// stub renderer — deterministic offline PNG
// ---------------------------------------------------------------------------

/**
 * Produce a minimal but valid solid-colour PNG with the requested width/height
 * encoded into the IHDR chunk. Fully deterministic and offline — used by tests
 * so the whole scheduler chain runs without a network. We hand-encode IHDR +
 * a single zlib-deflated IDAT (one solid colour) + IEND for two reasons:
 * (1) sharp IS a core dependency but its compressed output is not byte-stable
 * across versions, so fixture assertions would break on sharp upgrades; (2) the
 * stub renderer must never invoke a native addon — hand-encoding avoids that
 * entirely and keeps the path pure-JS.
 */
async function renderStubImage(input: RenderInput): Promise<RenderedImage> {
  return { bytes: makeSolidPng(input.width, input.height) };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 (PNG polynomial) over a buffer. */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Assemble a single PNG chunk: length + type + data + crc(type+data). */
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Build a valid solid-colour RGB PNG of the given dimensions. */
function makeSolidPng(width: number, height: number): Buffer {
  // IHDR: width, height, bit depth 8, colour type 2 (RGB), no filters/interlace.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw scanlines: each row is one filter byte (0) + width*3 colour bytes.
  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(rowBytes * height); // all zero → black, filter 0
  const idat = deflateSync(raw);

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
