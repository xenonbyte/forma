// ---------------------------------------------------------------------------
// Media credential store — SPEC-BEHAVIOR-003 (multi-provider, MP2)
//
// Per-provider image-generation credentials persisted as YAML at
// $FORMA_HOME/media-config.yaml. Ported from the open-design daemon's
// media-config.ts (env precedence / masked reads / preserveApiKey / 409
// wipe-guard), adapted to Forma conventions: JSON -> YAML storage; a single
// fixed file location (no OD_*_DIR override layers); no OAuth-borrowing and no
// model-alias mechanism; FormaError instead of od error types.
//
// MP2 generalises the v1 volcengine-only store to multiple providers
// (volcengine + openai + gemini; `stub` stays hidden/test-only). Each provider
// has its own env-key precedence list; the file gains an optional top-level
// `active_provider` selector.
//
// Read precedence per provider (high -> low):
//   1. env  — provider-specific keys (see PROVIDER_ENV_KEYS)
//   2. file $FORMA_HOME/media-config.yaml -> providers.<id>.api_key
//
// Active provider selection (resolveActiveImageConfig):
//   1. `active_provider` set + that provider resolves (env or file key) -> use it.
//      Set-but-unconfigured throws MEDIA_NOT_CONFIGURED naming it (never silently
//      falls through to another provider).
//   2. `active_provider` unset/empty -> first configured REAL provider in the
//      deterministic order [volcengine, openai, gemini]; else the `stub` entry
//      if present (offline tests); else MEDIA_NOT_CONFIGURED.
//   Backward compat: a legacy volcengine-only file with no active_provider still
//   resolves to volcengine, and an exported volcengine env key still drives it.
//
// Security invariants:
//   * Masked reads only ever return, per provider, { configured, source, model,
//     base_url, api_key_tail }. api_key_tail is the last 4 chars and is OMITTED
//     entirely when the key came from the environment.
//   * The plaintext api_key NEVER appears in any FormaError message/details or
//     in the masked-read response. (resolveProviderConfig is the only path that
//     returns the plaintext key, by design, to the in-process renderer.)
//   * The temp file is born with mode 0600 on POSIX (passed to writeYamlAtomic)
//     so there is no window where media-config.yaml is readable at 0644.
//     Any pre-existing file that was created looser than 0600 is also tightened
//     by enforceFileMode after the rename. Permission semantics are skipped on
//     win32 (POSIX mode bits are not meaningful there).
//
// On-disk shape:
//   active_provider: "openai"            # optional top-level selector
//   providers:
//     volcengine:
//       api_key: "…"
//       base_url: "https://ark.cn-beijing.volces.com/api/v3"   # optional
//       model: "doubao-seedream-5-0-260128"                    # optional
//     openai:
//       api_key: "…"
// ---------------------------------------------------------------------------

import { chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { FormaError } from "../errors.js";
import { readYamlUnknown, writeYamlAtomic } from "../yaml.js";
import { IMAGE_MODELS, IMAGE_PROVIDERS } from "./image-models.js";

/** The deterministic offline test provider. Resolves without a real key and is
 * hidden from the masked multi-provider view. */
const PROVIDER_STUB = "stub";

/**
 * Per-provider env-key precedence (high -> low). A provider absent from this map
 * carries no env key (e.g. the offline `stub`). volcengine precedence is kept
 * exactly as the v1 store: FORMA_VOLCENGINE_API_KEY > ARK_API_KEY > VOLCENGINE_API_KEY.
 */
const PROVIDER_ENV_KEYS: Record<string, readonly string[]> = {
  volcengine: ["FORMA_VOLCENGINE_API_KEY", "ARK_API_KEY", "VOLCENGINE_API_KEY"],
  openai: ["FORMA_OPENAI_API_KEY", "OPENAI_API_KEY"],
  gemini: ["FORMA_GEMINI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

/**
 * Deterministic order in which providers are probed when `active_provider` is
 * unset. Derived from the catalogue's visible (non-hidden) providers so the
 * fallback always tries volcengine first, preserving the v1 behavior, then
 * openai, then gemini. The hidden `stub` is excluded here and only consulted as
 * a last resort by resolveActiveImageConfig.
 */
const VISIBLE_PROVIDER_IDS: readonly string[] = IMAGE_PROVIDERS.filter((p) => p.hidden !== true).map((p) => p.id);

/** True when `providerId` is a known visible provider (a legal write target). */
function isVisibleProvider(providerId: string): boolean {
  return VISIBLE_PROVIDER_IDS.includes(providerId);
}

const MEDIA_CONFIG_FILENAME = "media-config.yaml";
const CONFIG_FILE_MODE = 0o600;

/** Masked view of a single provider's stored credentials. Never carries the
 * plaintext key. `api_key_tail` is omitted entirely for env-sourced keys. */
export interface MaskedProviderConfig {
  configured: boolean;
  source: "env" | "file" | "none";
  model?: string;
  base_url?: string;
  api_key_tail?: string;
}

/**
 * Masked multi-provider view. `active_provider` reflects the stored top-level
 * field verbatim: `null` means "auto / fallback" (resolveActiveImageConfig then
 * picks the first configured provider). `providers` carries the masked status of
 * every VISIBLE provider (volcengine/openai/gemini); the hidden `stub` is never
 * included.
 */
export interface MaskedMediaConfig {
  active_provider: string | null;
  providers: Record<string, MaskedProviderConfig>;
}

/**
 * Provider-targeted write payload. `provider` selects which `providers.<id>`
 * entry to write; `make_active` additionally sets the top-level
 * `active_provider`. The server PUT route maps its body onto this.
 */
export interface MediaConfigInput {
  provider: string;
  api_key?: string;
  base_url?: string;
  model?: string;
  make_active?: boolean;
}

type ProviderEntry = { api_key?: string; base_url?: string; model?: string };

/** Parsed top-level config shape (only the fields this module owns). */
type StoredConfig = {
  active_provider: string;
  providers: Record<string, ProviderEntry>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function errorCode(err: unknown): string | undefined {
  return isRecord(err) && typeof err.code === "string" ? err.code : undefined;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function configFile(home: string): string {
  return join(home, MEDIA_CONFIG_FILENAME);
}

/** Read the env-supplied key for a provider, honouring its precedence list.
 * Providers without an env-key list (e.g. stub) always return "". */
function readEnvKey(providerId: string): string {
  const names = PROVIDER_ENV_KEYS[providerId];
  if (!names) return "";
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Default base_url for a provider from the catalogue (empty when unknown). */
function defaultBaseUrl(providerId: string): string {
  return IMAGE_PROVIDERS.find((p) => p.id === providerId)?.defaultBaseUrl ?? "";
}

/** Default model id for a provider from the catalogue (empty when unknown). */
function defaultModel(providerId: string): string {
  const flagged = IMAGE_MODELS.find((m) => m.provider === providerId && m.default);
  if (flagged) return flagged.id;
  return IMAGE_MODELS.find((m) => m.provider === providerId)?.id ?? "";
}

/**
 * Read and parse the whole config file. Returns an empty config when the file is
 * absent or malformed (a missing config is a normal state). `active_provider` is
 * normalised to a trimmed string ("" when unset); each `providers.<id>` entry is
 * kept only when it is an object.
 */
async function readStoredConfig(home: string): Promise<StoredConfig> {
  let parsed: unknown;
  try {
    parsed = await readYamlUnknown(configFile(home));
  } catch (err) {
    if (errorCode(err) === "ENOENT") return { active_provider: "", providers: {} };
    throw err;
  }
  if (!isRecord(parsed)) return { active_provider: "", providers: {} };
  const providers: Record<string, ProviderEntry> = {};
  if (isRecord(parsed.providers)) {
    for (const [id, entry] of Object.entries(parsed.providers)) {
      if (isRecord(entry)) providers[id] = entry as ProviderEntry;
    }
  }
  return { active_provider: trimmedString(parsed.active_provider), providers };
}

/** Look up a single provider entry from a parsed config. */
function providerEntry(config: StoredConfig, providerId: string): ProviderEntry {
  return config.providers[providerId] ?? {};
}

/** True when the entry carries any persisted field. */
function entryHasContent(entry: ProviderEntry): boolean {
  return Boolean(trimmedString(entry.api_key) || trimmedString(entry.base_url) || trimmedString(entry.model));
}

/**
 * Persist the whole config, enforcing 0600 on the resulting file. Provider
 * entries with no content are dropped; an empty providers map + empty
 * active_provider yields an empty `{ providers: {} }` document.
 */
async function writeStoredConfig(home: string, config: StoredConfig): Promise<void> {
  const providers: Record<string, ProviderEntry> = {};
  for (const [id, entry] of Object.entries(config.providers)) {
    if (entryHasContent(entry)) {
      const clean: ProviderEntry = {};
      const apiKey = trimmedString(entry.api_key);
      const baseUrl = trimmedString(entry.base_url);
      const model = trimmedString(entry.model);
      if (apiKey) clean.api_key = apiKey;
      if (baseUrl) clean.base_url = baseUrl;
      if (model) clean.model = model;
      providers[id] = clean;
    }
  }
  const doc: Record<string, unknown> = { providers };
  if (config.active_provider) doc.active_provider = config.active_provider;
  await writeYamlAtomic(configFile(home), doc, { mode: CONFIG_FILE_MODE });
  await enforceFileMode(configFile(home));
}

/** Ensure the config file is no looser than 0600. Skipped on win32 where
 * POSIX mode bits are not meaningful. */
async function enforceFileMode(file: string): Promise<void> {
  if (process.platform === "win32") return;
  let mode: number;
  try {
    mode = (await stat(file)).mode & 0o777;
  } catch (err) {
    if (errorCode(err) === "ENOENT") return;
    throw err;
  }
  if (mode !== CONFIG_FILE_MODE) {
    await chmod(file, CONFIG_FILE_MODE);
  }
}

/** Build the masked view of a single provider from its env key + file entry. */
function maskProvider(providerId: string, entry: ProviderEntry): MaskedProviderConfig {
  const envKey = readEnvKey(providerId);
  const fileKey = trimmedString(entry.api_key);
  const baseUrl = trimmedString(entry.base_url);
  const model = trimmedString(entry.model);

  if (envKey) {
    // env 来源连尾号都不回：never echo an env secret, not even masked.
    return {
      configured: true,
      source: "env",
      ...(model ? { model } : {}),
      ...(baseUrl ? { base_url: baseUrl } : {}),
    };
  }

  if (fileKey) {
    return {
      configured: true,
      source: "file",
      api_key_tail: fileKey.slice(-4),
      ...(model ? { model } : {}),
      ...(baseUrl ? { base_url: baseUrl } : {}),
    };
  }

  return {
    configured: false,
    source: "none",
    ...(model ? { model } : {}),
    ...(baseUrl ? { base_url: baseUrl } : {}),
  };
}

/**
 * Masked read of EVERY visible provider plus the stored active_provider. Never
 * returns a plaintext key. Env-sourced keys report source="env" with NO
 * api_key_tail; file-sourced keys report source="file" with the last-4 tail;
 * absent keys report configured:false. The hidden `stub` provider is never
 * surfaced here. `active_provider` reflects the stored field verbatim (null when
 * unset — meaning "auto / fallback" to MP4/MP5).
 */
export async function readMediaConfig(home: string): Promise<MaskedMediaConfig> {
  const config = await readStoredConfig(home);
  const providers: Record<string, MaskedProviderConfig> = {};
  for (const providerId of VISIBLE_PROVIDER_IDS) {
    providers[providerId] = maskProvider(providerId, providerEntry(config, providerId));
  }
  return {
    active_provider: config.active_provider || null,
    providers,
  };
}

/**
 * Write ONE provider's credentials (provider-targeted) and return the full
 * masked multi-provider view.
 *
 * - The write target must be a known VISIBLE provider id (volcengine/openai/
 *   gemini); anything else (including the hidden `stub`) throws
 *   MEDIA_INVALID_INPUT and writes nothing.
 * - `preserveApiKey`: when the payload omits api_key, keep that provider's
 *   existing stored key instead of clearing it (per-provider).
 * - `make_active`: also set the top-level `active_provider` to this provider,
 *   but only when the provider has a usable file/env key after this write.
 * - Wipe-guard (per provider): if the write would clear this provider's only
 *   existing config (payload empties everything for it), throw unless `force` is
 *   set. The code is MEDIA_NOT_CONFIGURED (the same 409-mapped code the resolve
 *   path uses) with details.{provider, requires_force}. The plaintext key is
 *   never placed in the error. Other providers' entries are untouched.
 */
export async function writeMediaConfig(
  home: string,
  payload: MediaConfigInput,
  opts: { preserveApiKey?: boolean; force?: boolean },
): Promise<MaskedMediaConfig> {
  const provider = trimmedString(payload.provider);
  if (!provider || !isVisibleProvider(provider)) {
    // No plaintext key in the error — only the (invalid) provider id.
    throw new FormaError("MEDIA_INVALID_INPUT", `Unknown media provider: ${provider || "(empty)"}`, {
      provider: provider || null,
      knownProviders: VISIBLE_PROVIDER_IDS,
    });
  }

  const config = await readStoredConfig(home);
  const prior = providerEntry(config, provider);
  const priorApiKey = trimmedString(prior.api_key);

  const incomingApiKey = trimmedString(payload.api_key);
  const apiKey = incomingApiKey || (opts.preserveApiKey ? priorApiKey : "");
  const baseUrl = trimmedString(payload.base_url);
  const model = trimmedString(payload.model);

  const wouldBeEmpty = !apiKey && !baseUrl && !model;
  const priorHadConfig = entryHasContent(prior);

  if (wouldBeEmpty && priorHadConfig && !opts.force) {
    throw new FormaError("MEDIA_NOT_CONFIGURED", "Refusing to clear existing media credentials without force", {
      provider,
      requires_force: true,
    });
  }

  const next: ProviderEntry = {};
  if (apiKey) next.api_key = apiKey;
  if (baseUrl) next.base_url = baseUrl;
  if (model) next.model = model;

  if (entryHasContent(next)) {
    config.providers[provider] = next;
  } else {
    delete config.providers[provider];
  }
  if (payload.make_active) {
    if (!apiKey && !readEnvKey(provider)) {
      throw new FormaError("MEDIA_NOT_CONFIGURED", `Cannot set active media provider without an API key: ${provider}`, {
        provider,
        requires_api_key: true,
      });
    }
    config.active_provider = provider;
  }

  await writeStoredConfig(home, config);
  return readMediaConfig(home);
}

/** Resolved plaintext credentials a renderer needs. */
export type ResolvedProviderConfig = { apiKey: string; baseUrl: string; model: string };

/** Resolved active image config: which provider is selected plus its creds. */
export type ResolvedImageConfig = ResolvedProviderConfig & { providerId: string };

/**
 * Resolve the plaintext credentials a renderer needs for a SPECIFIC provider.
 * Env wins over the stored file (per-provider precedence). base_url / model fall
 * back to the provider catalogue defaults. The `stub` provider needs no real key
 * — it resolves with a sentinel apiKey so offline tests run the full chain.
 * Throws MEDIA_NOT_CONFIGURED (no plaintext in the error) when no key is
 * available from either source.
 */
export async function resolveProviderConfig(home: string, providerId: string): Promise<ResolvedProviderConfig> {
  const config = await readStoredConfig(home);
  const entry = providerEntry(config, providerId);

  // The stub provider is a deterministic offline renderer; it carries no real
  // credential, so its mere presence in config is enough to "configure" it.
  if (providerId === PROVIDER_STUB) {
    return {
      apiKey: trimmedString(entry.api_key) || "stub",
      baseUrl: trimmedString(entry.base_url) || defaultBaseUrl(providerId),
      model: trimmedString(entry.model) || defaultModel(providerId),
    };
  }

  const envKey = readEnvKey(providerId);
  const apiKey = envKey || trimmedString(entry.api_key);
  if (!apiKey) {
    throw new FormaError("MEDIA_NOT_CONFIGURED", `No API key configured for provider: ${providerId}`, {
      provider: providerId,
    });
  }

  const baseUrl = trimmedString(entry.base_url) || defaultBaseUrl(providerId);
  const model = trimmedString(entry.model) || defaultModel(providerId);
  return { apiKey, baseUrl, model };
}

/** True when a provider has a usable key from env or the stored file. */
function providerHasKey(providerId: string, entry: ProviderEntry): boolean {
  return Boolean(readEnvKey(providerId) || trimmedString(entry.api_key));
}

/**
 * Resolve the ACTIVE image config — which provider is currently selected plus
 * its plaintext credentials. The scheduler (generateImages) needs to learn the
 * configured provider+model before it can validate input and pick a renderer.
 *
 * Selection order:
 *   1. If `active_provider` is set: that provider must resolve (env or file
 *      key), else MEDIA_NOT_CONFIGURED naming it — we never silently fall
 *      through to a different provider than the operator selected.
 *   2. Otherwise, the first VISIBLE provider in [volcengine, openai, gemini]
 *      that has a key (env or file). This preserves the v1 volcengine-first
 *      behavior for legacy files and exported env keys.
 *   3. Otherwise, a `stub` entry if present (offline tests).
 *   4. Otherwise, MEDIA_NOT_CONFIGURED (no plaintext in the error).
 */
export async function resolveActiveImageConfig(home: string): Promise<ResolvedImageConfig> {
  const config = await readStoredConfig(home);

  if (config.active_provider) {
    const selected = config.active_provider;
    // resolveProviderConfig throws MEDIA_NOT_CONFIGURED naming `selected` when it
    // has no key — surfaced as-is so the operator's explicit choice is honoured.
    return { providerId: selected, ...(await resolveProviderConfig(home, selected)) };
  }

  for (const providerId of VISIBLE_PROVIDER_IDS) {
    if (providerHasKey(providerId, providerEntry(config, providerId))) {
      return { providerId, ...(await resolveProviderConfig(home, providerId)) };
    }
  }

  // Offline test fallback: a stub entry resolves without a real key.
  if (entryHasContent(providerEntry(config, PROVIDER_STUB))) {
    return { providerId: PROVIDER_STUB, ...(await resolveProviderConfig(home, PROVIDER_STUB)) };
  }

  throw new FormaError("MEDIA_NOT_CONFIGURED", "No image-generation provider is configured", {
    checkedProviders: [...VISIBLE_PROVIDER_IDS, PROVIDER_STUB],
  });
}
