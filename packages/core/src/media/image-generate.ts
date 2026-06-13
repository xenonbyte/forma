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
//   stub        deterministic offline PNG (width/height encoded in real IHDR
//               bytes); never touches the network. Used by tests.
//
// Security: a provider error NEVER carries the api key. Non-2xx / unparseable
// responses throw MEDIA_PROVIDER_ERROR with the HTTP status and a body
// truncated to PROVIDER_BODY_LIMIT chars. The Authorization header is built
// locally and is never echoed into any error.
// ---------------------------------------------------------------------------

import { deflateSync } from "node:zlib";
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

/** Raw bytes produced by a renderer. */
type RenderedImage = { bytes: Buffer };

const RENDERERS: Record<string, ImageRenderer> = {
  volcengine: renderVolcengineImage,
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

  // 6. Render N images sequentially and stage each one.
  const images: GeneratedImage[] = [];
  for (let i = 0; i < count; i++) {
    const { bytes } = await renderer(renderInput, cfg);
    const staged = await putStagedImage(home, input.productId, bytes, {
      purpose,
      prompt: input.prompt,
      model: config.model,
      width,
      height,
    });
    images.push({ id: staged.id, ref: staged.ref, preview_path: staged.path, width, height });
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
// volcengine renderer — ported from open-design daemon renderVolcengineImage
// ---------------------------------------------------------------------------

/**
 * Volcengine Seedream images. OpenAI-compatible payload:
 *   POST {baseUrl}/images/generations
 *   Authorization: Bearer <key>
 *   { model, prompt, size: "WxH", response_format: "b64_json" }
 *
 * Parses data[0].b64_json (preferred) or data[0].url (second GET for bytes),
 * matching the od source. Any non-2xx or unparseable response throws
 * MEDIA_PROVIDER_ERROR carrying the status and a truncated body — never the key.
 */
async function renderVolcengineImage(input: RenderInput, cfg: ProviderConfig): Promise<RenderedImage> {
  if (!cfg.apiKey) {
    // resolveProviderConfig already guards this, but keep the renderer honest.
    throw new FormaError("MEDIA_NOT_CONFIGURED", "No Volcengine API key", { provider: "volcengine" });
  }
  const baseUrl = (cfg.baseUrl || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
  const body = {
    model: cfg.model,
    prompt: input.prompt,
    size: `${input.width}x${input.height}`,
    response_format: "b64_json",
    // Volcengine stamps a visible "AI generated" watermark by default. Forma output is
    // commercial brand material (icons, store shots, posters), so request without it.
    // Any required AI-content labeling for a given distribution channel is the operator's call.
    watermark: false,
  };

  const resp = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw providerError(resp.status, text);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw providerError(resp.status, text, "Volcengine image response was not valid JSON");
  }

  const entry = isRecord(data) && Array.isArray(data.data) ? data.data[0] : null;
  if (!isRecord(entry)) {
    throw providerError(resp.status, text, "Volcengine image response had no data[0]");
  }

  if (typeof entry.b64_json === "string" && entry.b64_json) {
    return { bytes: Buffer.from(entry.b64_json, "base64") };
  }
  if (typeof entry.url === "string" && entry.url) {
    // The url is fully provider-controlled, so this second fetch is an SSRF
    // sink: screen it (scheme + literal private/loopback IPs + no redirects +
    // size cap) before the request is allowed to run. See Finding 4a and
    // assertSafeFetchUrl below.
    return { bytes: await fetchImageBytesGuarded(entry.url) };
  }
  throw providerError(resp.status, text, "Volcengine image response missing b64_json/url");
}

// ---------------------------------------------------------------------------
// SSRF guard for the provider-controlled url second-fetch (Finding 4a)
// ---------------------------------------------------------------------------

/** Hard ceiling on a downloaded provider image: 64 MiB. */
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

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
    throw providerError(0, "", "Volcengine image url is not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw providerError(0, "", `Volcengine image url scheme not allowed: ${url.protocol}`);
  }

  // URL.hostname strips the brackets from IPv6 literals and lowercases the host.
  const host = url.hostname.toLowerCase();

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata" ||
    host === "metadata.google.internal"
  ) {
    throw providerError(0, "", "Volcengine image url targets a blocked host");
  }

  if (isBlockedLiteralIp(host)) {
    throw providerError(0, "", "Volcengine image url targets a private/loopback address");
  }

  return url;
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

  // IPv6 literal (already de-bracketed by URL.hostname).
  if (host.includes(":")) {
    // IPv4-mapped / -embedded IPv6 (e.g. ::ffff:127.0.0.1, ::ffff:169.254.0.1).
    const mapped = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
    const embedded = mapped?.[1];
    if (embedded) {
      const octets = embedded.split(".").map(Number);
      if (octets.length === 4 && octets.every((o) => o <= 255)) {
        return isBlockedIpv4(octets as [number, number, number, number]);
      }
    }
    const h = host.replace(/%.*$/, ""); // strip zone id
    if (h === "::1" || h === "::") return true; // loopback / unspecified
    if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
      return true; // fe80::/10 link-local
    }
    if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 unique-local
    return false;
  }

  return false;
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
    throw providerError(0, "", `Volcengine image url fetch failed: ${err instanceof Error ? err.message : "error"}`);
  }

  if (!imgResp.ok) {
    throw providerError(imgResp.status, "", "Volcengine image url fetch failed");
  }

  // Reject up front if the server advertises an oversized payload.
  const declared = Number(imgResp.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw providerError(imgResp.status, "", `Volcengine image exceeds ${MAX_IMAGE_BYTES} byte cap`);
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
      throw providerError(resp.status, "", `Volcengine image exceeds ${cap} byte cap`);
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
      throw providerError(resp.status, "", `Volcengine image exceeds ${cap} byte cap`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}

/**
 * Build a MEDIA_PROVIDER_ERROR. The body is truncated to PROVIDER_BODY_LIMIT
 * chars; the api key is never part of `details` (the Authorization header is
 * built locally and the response body is provider-controlled, not our header).
 */
function providerError(status: number, body: string, message?: string): FormaError {
  return new FormaError("MEDIA_PROVIDER_ERROR", message ?? `Volcengine image provider returned ${status}`, {
    status,
    body: truncate(body, PROVIDER_BODY_LIMIT),
  });
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
