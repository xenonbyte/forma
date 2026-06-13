// ---------------------------------------------------------------------------
// Media credential store — SPEC-BEHAVIOR-003
//
// Per-provider image-generation credentials persisted as YAML at
// $FORMA_HOME/media-config.yaml. Ported from the open-design daemon's
// media-config.ts (env precedence / masked reads / preserveApiKey / 409
// wipe-guard), adapted to Forma conventions: JSON -> YAML storage; a single
// fixed file location (no OD_*_DIR override layers); no OAuth-borrowing and no
// model-alias mechanism; FormaError instead of od error types.
//
// Read precedence (high -> low):
//   1. env  FORMA_VOLCENGINE_API_KEY > ARK_API_KEY > VOLCENGINE_API_KEY
//   2. file $FORMA_HOME/media-config.yaml -> providers.volcengine.api_key
//
// Security invariants:
//   * Masked reads only ever return { configured, source, model, base_url,
//     api_key_tail }. api_key_tail is the last 4 chars and is OMITTED entirely
//     when the key came from the environment.
//   * The plaintext api_key NEVER appears in any FormaError message/details or
//     in the masked-read response. (resolveProviderConfig is the only path that
//     returns the plaintext key, by design, to the in-process renderer.)
//   * The file is created with mode 0600; an existing file looser than 0600 is
//     tightened on every write. Permission semantics are skipped on win32
//     (POSIX mode bits are not meaningful there).
//
// On-disk shape:
//   providers:
//     volcengine:
//       api_key: "…"
//       base_url: "https://ark.cn-beijing.volces.com/api/v3"   # optional
//       model: "doubao-seedream-5-0-260128"                    # optional
// ---------------------------------------------------------------------------

import { chmod, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FormaError } from "../errors.js";
import { readYamlUnknown, writeYamlAtomic } from "../yaml.js";
import { IMAGE_MODELS, IMAGE_PROVIDERS } from "./image-models.js";

/** Only provider Forma ships credentials for in v1. */
const PROVIDER_VOLCENGINE = "volcengine";

/** Env vars that supply the volcengine api_key, in precedence order. */
const VOLCENGINE_ENV_KEYS = [
  "FORMA_VOLCENGINE_API_KEY",
  "ARK_API_KEY",
  "VOLCENGINE_API_KEY",
] as const;

const MEDIA_CONFIG_FILENAME = "media-config.yaml";
const CONFIG_FILE_MODE = 0o600;

/** Masked view of a single provider's stored credentials. Never carries the
 * plaintext key. `api_key_tail` is omitted entirely for env-sourced keys. */
export type MaskedMediaConfig = {
  configured: boolean;
  source: "env" | "file" | "none";
  model?: string;
  base_url?: string;
  api_key_tail?: string;
};

/** Write payload for the volcengine provider. Minimal flat shape for the
 * v1 single-provider store; the server PUT route maps its body onto this. */
export type MediaConfigInput = {
  api_key?: string;
  base_url?: string;
  model?: string;
};

type ProviderEntry = { api_key?: string; base_url?: string; model?: string };

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

/** Read the env-supplied volcengine key, honouring precedence. */
function readEnvKey(): string {
  for (const name of VOLCENGINE_ENV_KEYS) {
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

/** Read the stored provider entry from the YAML file. Returns {} when the
 * file is absent or malformed (a missing config is a normal state). */
async function readStoredEntry(home: string): Promise<ProviderEntry> {
  let parsed: unknown;
  try {
    parsed = await readYamlUnknown(configFile(home));
  } catch (err) {
    if (errorCode(err) === "ENOENT") return {};
    throw err;
  }
  if (!isRecord(parsed) || !isRecord(parsed.providers)) return {};
  const entry = parsed.providers[PROVIDER_VOLCENGINE];
  return isRecord(entry) ? (entry as ProviderEntry) : {};
}

/** Persist the provider entry, enforcing 0600 on the resulting file. An empty
 * entry clears the providers map (used by force-wipe). */
async function writeStoredEntry(home: string, entry: ProviderEntry): Promise<void> {
  const providers: Record<string, ProviderEntry> = {};
  const hasContent = Boolean(entry.api_key || entry.base_url || entry.model);
  if (hasContent) providers[PROVIDER_VOLCENGINE] = entry;
  await writeYamlAtomic(configFile(home), { providers });
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

/**
 * Masked read of the volcengine credentials. Never returns the plaintext key.
 * Env-sourced keys report source="env" with NO api_key_tail; file-sourced keys
 * report source="file" with the last-4 tail.
 */
export async function readMediaConfig(home: string): Promise<MaskedMediaConfig> {
  const entry = await readStoredEntry(home);
  const envKey = readEnvKey();
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

  return { configured: false, source: "none" };
}

/**
 * Write the volcengine credentials and return the masked view.
 *
 * - `preserveApiKey`: when the payload omits api_key, keep the existing stored
 *   key instead of clearing it.
 * - Wipe-guard: if the write would clear an existing configured key (payload
 *   empties everything), throw unless `force` is set. The error code is
 *   MEDIA_NOT_CONFIGURED — the same 409-mapped code the resolve path uses —
 *   because the post-write state would be "not configured" and the operator
 *   must confirm that with force. `details.requires_force` flags this so the
 *   route layer can surface a precise 409 message. The plaintext key is never
 *   placed in the error.
 */
export async function writeMediaConfig(
  home: string,
  payload: MediaConfigInput,
  opts: { preserveApiKey?: boolean; force?: boolean },
): Promise<MaskedMediaConfig> {
  const prior = await readStoredEntry(home);
  const priorApiKey = trimmedString(prior.api_key);

  const incomingApiKey = trimmedString(payload.api_key);
  const apiKey = incomingApiKey || (opts.preserveApiKey ? priorApiKey : "");
  const baseUrl = trimmedString(payload.base_url);
  const model = trimmedString(payload.model);

  const wouldBeEmpty = !apiKey && !baseUrl && !model;
  const priorHadConfig = Boolean(priorApiKey || trimmedString(prior.base_url) || trimmedString(prior.model));

  if (wouldBeEmpty && priorHadConfig && !opts.force) {
    throw new FormaError(
      "MEDIA_NOT_CONFIGURED",
      "Refusing to clear existing media credentials without force",
      { provider: PROVIDER_VOLCENGINE, requires_force: true },
    );
  }

  const next: ProviderEntry = {};
  if (apiKey) next.api_key = apiKey;
  if (baseUrl) next.base_url = baseUrl;
  if (model) next.model = model;

  await writeStoredEntry(home, next);
  return readMediaConfig(home);
}

/**
 * Resolve the plaintext credentials a renderer needs. Env wins over the
 * stored file. base_url / model fall back to the provider catalogue defaults.
 * Throws MEDIA_NOT_CONFIGURED (no plaintext in the error) when no key is
 * available from either source.
 */
export async function resolveProviderConfig(
  home: string,
  providerId: string,
): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  const entry = providerId === PROVIDER_VOLCENGINE ? await readStoredEntry(home) : {};
  const envKey = providerId === PROVIDER_VOLCENGINE ? readEnvKey() : "";
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
