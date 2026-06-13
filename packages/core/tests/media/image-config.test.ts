import { mkdtemp, readFile, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FormaError,
  readMediaConfig,
  writeMediaConfig,
  resolveProviderConfig,
  resolveActiveImageConfig,
} from "@xenonbyte/forma-core";

// ---------------------------------------------------------------------------
// SPEC-BEHAVIOR-003 — multi-provider media-config credential store (MP2).
//
// Per-provider env precedence + file fallback for volcengine / openai / gemini
// (stub stays test-only / hidden). Masked reads return a multi-provider view
// { active_provider, providers: Record<id, { configured, source, model,
// base_url, api_key_tail }> }; env-sourced keys never echo a tail. Writes are
// provider-targeted with an optional active flag, preserveApiKey, and a 409
// wipe-guard. File permissions are tightened to 0600 (skipped on win32).
//
// Backward compat: an existing volcengine-only file with no active_provider
// must still resolve to volcengine exactly as before.
// ---------------------------------------------------------------------------

// Every env var the store reads, across all providers — cleared/restored per test.
const ENV_VARS = [
  "FORMA_VOLCENGINE_API_KEY",
  "ARK_API_KEY",
  "VOLCENGINE_API_KEY",
  "FORMA_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "FORMA_GEMINI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
];

const VOLCENGINE_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const VOLCENGINE_DEFAULT_MODEL = "doubao-seedream-5-0-260128";
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENAI_DEFAULT_MODEL = "gpt-image-1";
const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-image";
const isWin = process.platform === "win32";

let savedEnv: Record<string, string | undefined>;

async function makeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forma-media-config-"));
}

function clearEnv(): void {
  for (const name of ENV_VARS) delete process.env[name];
}

beforeEach(() => {
  savedEnv = {};
  for (const name of ENV_VARS) savedEnv[name] = process.env[name];
  clearEnv();
});

afterEach(() => {
  // Restore exactly to avoid leaking keys across tests.
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

// Shorthand for the masked-none entry of a single provider.
const NONE = { configured: false, source: "none" } as const;

describe("readMediaConfig — unconfigured", () => {
  it("reports every visible provider as none with active_provider null", async () => {
    const home = await makeHome();
    expect(await readMediaConfig(home)).toEqual({
      active_provider: null,
      providers: {
        volcengine: NONE,
        openai: NONE,
        gemini: NONE,
      },
    });
  });

  it("does not expose the hidden stub provider in the masked view", async () => {
    const home = await makeHome();
    const masked = await readMediaConfig(home);
    expect(masked.providers).not.toHaveProperty("stub");
  });
});

describe("readMediaConfig — env precedence per provider", () => {
  it("volcengine: env source, omits api_key_tail entirely", async () => {
    const home = await makeHome();
    process.env.VOLCENGINE_API_KEY = "sk-from-env-1234";
    const masked = await readMediaConfig(home);
    expect(masked.providers.volcengine.configured).toBe(true);
    expect(masked.providers.volcengine.source).toBe("env");
    expect(masked.providers.volcengine).not.toHaveProperty("api_key_tail");
  });

  it("volcengine: FORMA_VOLCENGINE_API_KEY > ARK_API_KEY > VOLCENGINE_API_KEY", async () => {
    const home = await makeHome();
    process.env.FORMA_VOLCENGINE_API_KEY = "sk-forma";
    process.env.ARK_API_KEY = "sk-ark";
    process.env.VOLCENGINE_API_KEY = "sk-volc";
    expect((await resolveProviderConfig(home, "volcengine")).apiKey).toBe("sk-forma");
  });

  it("volcengine: ARK_API_KEY > VOLCENGINE_API_KEY", async () => {
    const home = await makeHome();
    process.env.ARK_API_KEY = "sk-ark";
    process.env.VOLCENGINE_API_KEY = "sk-volc";
    expect((await resolveProviderConfig(home, "volcengine")).apiKey).toBe("sk-ark");
  });

  it("openai: FORMA_OPENAI_API_KEY > OPENAI_API_KEY", async () => {
    const home = await makeHome();
    process.env.FORMA_OPENAI_API_KEY = "sk-openai-forma";
    process.env.OPENAI_API_KEY = "sk-openai-plain";
    expect((await resolveProviderConfig(home, "openai")).apiKey).toBe("sk-openai-forma");
  });

  it("openai: OPENAI_API_KEY used when FORMA_OPENAI_API_KEY absent", async () => {
    const home = await makeHome();
    process.env.OPENAI_API_KEY = "sk-openai-plain";
    expect((await resolveProviderConfig(home, "openai")).apiKey).toBe("sk-openai-plain");
  });

  it("gemini: FORMA_GEMINI_API_KEY > GEMINI_API_KEY > GOOGLE_API_KEY", async () => {
    const home = await makeHome();
    process.env.FORMA_GEMINI_API_KEY = "sk-gemini-forma";
    process.env.GEMINI_API_KEY = "sk-gemini-plain";
    process.env.GOOGLE_API_KEY = "sk-google";
    expect((await resolveProviderConfig(home, "gemini")).apiKey).toBe("sk-gemini-forma");
  });

  it("gemini: GEMINI_API_KEY > GOOGLE_API_KEY", async () => {
    const home = await makeHome();
    process.env.GEMINI_API_KEY = "sk-gemini-plain";
    process.env.GOOGLE_API_KEY = "sk-google";
    expect((await resolveProviderConfig(home, "gemini")).apiKey).toBe("sk-gemini-plain");
  });

  it("gemini: GOOGLE_API_KEY used as last resort", async () => {
    const home = await makeHome();
    process.env.GOOGLE_API_KEY = "sk-google";
    expect((await resolveProviderConfig(home, "gemini")).apiKey).toBe("sk-google");
  });

  it("env source still surfaces file-stored model/base_url (volcengine)", async () => {
    const home = await makeHome();
    await writeMediaConfig(
      home,
      {
        provider: "volcengine",
        api_key: "sk-file",
        base_url: "https://example/api",
        model: "doubao-seedream-4-0-250828",
      },
      {},
    );
    process.env.VOLCENGINE_API_KEY = "sk-env";
    const masked = await readMediaConfig(home);
    expect(masked.providers.volcengine.source).toBe("env");
    expect(masked.providers.volcengine.base_url).toBe("https://example/api");
    expect(masked.providers.volcengine.model).toBe("doubao-seedream-4-0-250828");
    expect(masked.providers.volcengine).not.toHaveProperty("api_key_tail");
  });
});

describe("readMediaConfig — multi-provider view", () => {
  it("mixes file-configured volcengine with env-configured openai", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "volcengine", api_key: "sk-volc-WXYZ" }, {});
    process.env.OPENAI_API_KEY = "sk-openai-env";
    const masked = await readMediaConfig(home);

    expect(masked.providers.volcengine).toMatchObject({
      configured: true,
      source: "file",
      api_key_tail: "WXYZ",
    });
    expect(masked.providers.openai.configured).toBe(true);
    expect(masked.providers.openai.source).toBe("env");
    expect(masked.providers.openai).not.toHaveProperty("api_key_tail");
    expect(masked.providers.gemini).toEqual(NONE);
    // active_provider reflects the stored field — never written here.
    expect(masked.active_provider).toBeNull();
  });

  it("file source returns tail-4 with source=file", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-abcd1234WXYZ" }, {});
    const masked = await readMediaConfig(home);
    expect(masked.providers.openai).toMatchObject({
      configured: true,
      source: "file",
      api_key_tail: "WXYZ",
    });
  });

  it("active_provider reflects the stored field when set", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-active-0001", make_active: true }, {});
    const masked = await readMediaConfig(home);
    expect(masked.active_provider).toBe("openai");
  });
});

describe("resolveActiveImageConfig — selection + fallback", () => {
  it("uses active_provider when set and configured", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "volcengine", api_key: "sk-volc-aaaa" }, {});
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-openai-bbbb", make_active: true }, {});
    const active = await resolveActiveImageConfig(home);
    expect(active.providerId).toBe("openai");
    expect(active.apiKey).toBe("sk-openai-bbbb");
  });

  it("falls back to first configured real provider (volcengine-first) when active unset", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-openai-cccc" }, {});
    await writeMediaConfig(home, { provider: "volcengine", api_key: "sk-volc-dddd" }, {});
    // No active_provider field written.
    const active = await resolveActiveImageConfig(home);
    expect(active.providerId).toBe("volcengine");
    expect(active.apiKey).toBe("sk-volc-dddd");
  });

  it("falls back to openai when only openai is configured and active unset", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-openai-eeee" }, {});
    const active = await resolveActiveImageConfig(home);
    expect(active.providerId).toBe("openai");
  });

  it("throws MEDIA_NOT_CONFIGURED naming the provider when active is set but unconfigured", async () => {
    const home = await makeHome();
    // Write a base_url-only entry plus active_provider, but no key for it.
    await writeMediaConfig(home, { provider: "openai", base_url: "https://x", make_active: true }, { force: true });
    let thrown: unknown;
    try {
      await resolveActiveImageConfig(home);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FormaError);
    const err = thrown as FormaError;
    expect(err.code).toBe("MEDIA_NOT_CONFIGURED");
    expect(err.details).toMatchObject({ provider: "openai" });
  });

  it("throws MEDIA_NOT_CONFIGURED when nothing is configured", async () => {
    const home = await makeHome();
    let thrown: unknown;
    try {
      await resolveActiveImageConfig(home);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FormaError);
    expect((thrown as FormaError).code).toBe("MEDIA_NOT_CONFIGURED");
  });

  it("resolves the offline stub provider when present and no real provider exists", async () => {
    const home = await makeHome();
    await writeFile(join(home, "media-config.yaml"), "providers:\n  stub:\n    model: stub-image-1\n", "utf8");
    const active = await resolveActiveImageConfig(home);
    expect(active.providerId).toBe("stub");
    expect(active.apiKey).toBe("stub");
  });

  it("env volcengine key drives active selection without a file (backward compat)", async () => {
    const home = await makeHome();
    process.env.ARK_API_KEY = "sk-ark-env";
    const active = await resolveActiveImageConfig(home);
    expect(active.providerId).toBe("volcengine");
    expect(active.apiKey).toBe("sk-ark-env");
  });
});

describe("writeMediaConfig — provider-targeted", () => {
  it("writes providers.openai and active_provider when make_active is set", async () => {
    const home = await makeHome();
    const masked = await writeMediaConfig(
      home,
      { provider: "openai", api_key: "sk-openai-9999", make_active: true },
      {},
    );
    expect(masked.active_provider).toBe("openai");
    expect(masked.providers.openai).toMatchObject({ configured: true, source: "file", api_key_tail: "9999" });

    const raw = await readFile(join(home, "media-config.yaml"), "utf8");
    expect(raw).toContain("providers:");
    expect(raw).toContain("openai:");
    expect(raw).toContain("active_provider: openai");
  });

  it("does not set active_provider when make_active is omitted", async () => {
    const home = await makeHome();
    const masked = await writeMediaConfig(home, { provider: "openai", api_key: "sk-openai-7777" }, {});
    expect(masked.active_provider).toBeNull();
    const raw = await readFile(join(home, "media-config.yaml"), "utf8");
    expect(raw).not.toContain("active_provider");
  });

  it("preserveApiKey keeps the existing key for that provider only", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-keep-1234" }, {});
    await writeMediaConfig(home, { provider: "openai", model: "gpt-image-1" }, { preserveApiKey: true });
    const resolved = await resolveProviderConfig(home, "openai");
    expect(resolved.apiKey).toBe("sk-keep-1234");
    const masked = await readMediaConfig(home);
    expect(masked.providers.openai.api_key_tail).toBe("1234");
  });

  it("writing one provider does not disturb another provider's stored key", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "volcengine", api_key: "sk-volc-aaaa" }, {});
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-openai-bbbb" }, {});
    const masked = await readMediaConfig(home);
    expect(masked.providers.volcengine.api_key_tail).toBe("aaaa");
    expect(masked.providers.openai.api_key_tail).toBe("bbbb");
  });

  it("rejects an unknown provider with MEDIA_INVALID_INPUT", async () => {
    const home = await makeHome();
    let thrown: unknown;
    try {
      await writeMediaConfig(home, { provider: "does-not-exist", api_key: "sk-x" }, {});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FormaError);
    expect((thrown as FormaError).code).toBe("MEDIA_INVALID_INPUT");
    // Nothing should have been written.
    let raw = "";
    try {
      raw = await readFile(join(home, "media-config.yaml"), "utf8");
    } catch {
      raw = "";
    }
    expect(raw).not.toContain("sk-x");
  });

  it("rejects the hidden stub provider as a write target", async () => {
    const home = await makeHome();
    let thrown: unknown;
    try {
      await writeMediaConfig(home, { provider: "stub", api_key: "sk-stub" }, {});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FormaError);
    expect((thrown as FormaError).code).toBe("MEDIA_INVALID_INPUT");
  });
});

describe("writeMediaConfig — wipe-guard per provider", () => {
  it("throws MEDIA_NOT_CONFIGURED with requires_force naming the provider when emptying it", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-existing-0001" }, {});
    let thrown: unknown;
    try {
      await writeMediaConfig(home, { provider: "openai" }, {});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FormaError);
    const err = thrown as FormaError;
    expect(err.code).toBe("MEDIA_NOT_CONFIGURED");
    expect(err.details).toMatchObject({ provider: "openai", requires_force: true });
  });

  it("never leaks the plaintext key in the wipe-guard error", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-secret-leak-test" }, {});
    let thrown: unknown;
    try {
      await writeMediaConfig(home, { provider: "openai" }, {});
    } catch (err) {
      thrown = err;
    }
    const serialized = JSON.stringify((thrown as FormaError).toJSON()) + String((thrown as Error).message);
    expect(serialized).not.toContain("sk-secret-leak-test");
  });

  it("allows wiping one provider with force=true, leaving others intact", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "volcengine", api_key: "sk-volc-keep" }, {});
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-openai-wipe" }, {});
    const masked = await writeMediaConfig(home, { provider: "openai" }, { force: true });
    expect(masked.providers.openai).toEqual(NONE);
    expect(masked.providers.volcengine.configured).toBe(true);
  });

  it("does not guard when that provider had no existing config", async () => {
    const home = await makeHome();
    const masked = await writeMediaConfig(home, { provider: "openai" }, {});
    expect(masked.providers.openai).toEqual(NONE);
  });
});

describe("file permissions", () => {
  it.skipIf(isWin)("creates the config file with 0600", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "volcengine", api_key: "sk-perm-create" }, {});
    const st = await stat(join(home, "media-config.yaml"));
    expect(st.mode & 0o777).toBe(0o600);
  });

  it.skipIf(isWin)("tightens a pre-existing 0644 file to 0600", async () => {
    const home = await makeHome();
    const file = join(home, "media-config.yaml");
    await writeFile(file, "providers:\n  volcengine:\n    api_key: sk-loose-0644\n", "utf8");
    await chmod(file, 0o644);
    await writeMediaConfig(
      home,
      { provider: "volcengine", model: "doubao-seedream-4-0-250828" },
      { preserveApiKey: true },
    );
    const st = await stat(file);
    expect(st.mode & 0o777).toBe(0o600);
  });
});

describe("readMediaConfig — whitespace-only api_key", () => {
  it("treats whitespace-only api_key as unconfigured", async () => {
    const home = await makeHome();
    const file = join(home, "media-config.yaml");
    await writeFile(file, 'providers:\n  volcengine:\n    api_key: "   "\n', "utf8");
    const masked = await readMediaConfig(home);
    expect(masked.providers.volcengine).toEqual(NONE);
  });

  it("resolveProviderConfig throws MEDIA_NOT_CONFIGURED for whitespace-only api_key", async () => {
    const home = await makeHome();
    const file = join(home, "media-config.yaml");
    await writeFile(file, 'providers:\n  volcengine:\n    api_key: "   "\n', "utf8");
    let thrown: unknown;
    try {
      await resolveProviderConfig(home, "volcengine");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FormaError);
    expect((thrown as FormaError).code).toBe("MEDIA_NOT_CONFIGURED");
  });
});

describe("resolveProviderConfig — defaults + errors", () => {
  it("throws MEDIA_NOT_CONFIGURED when no key from env or file", async () => {
    const home = await makeHome();
    let thrown: unknown;
    try {
      await resolveProviderConfig(home, "volcengine");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FormaError);
    expect((thrown as FormaError).code).toBe("MEDIA_NOT_CONFIGURED");
  });

  it("fills default base_url and model for volcengine when file omits them", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "volcengine", api_key: "sk-defaults-1111" }, {});
    const resolved = await resolveProviderConfig(home, "volcengine");
    expect(resolved.apiKey).toBe("sk-defaults-1111");
    expect(resolved.baseUrl).toBe(VOLCENGINE_DEFAULT_BASE_URL);
    expect(resolved.model).toBe(VOLCENGINE_DEFAULT_MODEL);
  });

  it("fills default base_url and model for openai", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-openai-defaults" }, {});
    const resolved = await resolveProviderConfig(home, "openai");
    expect(resolved.baseUrl).toBe(OPENAI_DEFAULT_BASE_URL);
    expect(resolved.model).toBe(OPENAI_DEFAULT_MODEL);
  });

  it("fills default base_url and model for gemini", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "gemini", api_key: "sk-gemini-defaults" }, {});
    const resolved = await resolveProviderConfig(home, "gemini");
    expect(resolved.baseUrl).toBe(GEMINI_DEFAULT_BASE_URL);
    expect(resolved.model).toBe(GEMINI_DEFAULT_MODEL);
  });

  it("honours stored base_url and model over defaults", async () => {
    const home = await makeHome();
    await writeMediaConfig(
      home,
      {
        provider: "volcengine",
        api_key: "sk-stored-2222",
        base_url: "https://custom/api",
        model: "doubao-seedream-4-5-251128",
      },
      {},
    );
    const resolved = await resolveProviderConfig(home, "volcengine");
    expect(resolved.baseUrl).toBe("https://custom/api");
    expect(resolved.model).toBe("doubao-seedream-4-5-251128");
  });

  it("never includes the api_key in an error for an unknown provider", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "volcengine", api_key: "sk-unknown-provider-secret" }, {});
    let thrown: unknown;
    try {
      await resolveProviderConfig(home, "does-not-exist");
    } catch (err) {
      thrown = err;
    }
    if (thrown instanceof FormaError) {
      const serialized = JSON.stringify(thrown.toJSON()) + thrown.message;
      expect(serialized).not.toContain("sk-unknown-provider-secret");
    }
  });
});

describe("media-config.yaml on-disk shape", () => {
  it("persists under providers.volcengine", async () => {
    const home = await makeHome();
    await writeMediaConfig(
      home,
      { provider: "volcengine", api_key: "sk-shape-3333", model: "doubao-seedream-4-0-250828" },
      {},
    );
    const raw = await readFile(join(home, "media-config.yaml"), "utf8");
    expect(raw).toContain("providers:");
    expect(raw).toContain("volcengine:");
    expect(raw).toContain("api_key:");
    expect(raw).toContain("doubao-seedream-4-0-250828");
  });
});

describe("backward compatibility — legacy volcengine-only file", () => {
  it("resolves to volcengine and reports configured with active_provider null", async () => {
    const home = await makeHome();
    // A file written by the old single-provider store: no active_provider field.
    await writeFile(
      join(home, "media-config.yaml"),
      "providers:\n  volcengine:\n    api_key: sk-legacy-volc-1234\n    base_url: https://ark.cn-beijing.volces.com/api/v3\n    model: doubao-seedream-5-0-260128\n",
      "utf8",
    );

    const active = await resolveActiveImageConfig(home);
    expect(active.providerId).toBe("volcengine");
    expect(active.apiKey).toBe("sk-legacy-volc-1234");

    const masked = await readMediaConfig(home);
    expect(masked.active_provider).toBeNull();
    expect(masked.providers.volcengine).toMatchObject({
      configured: true,
      source: "file",
      api_key_tail: "1234",
    });
    expect(masked.providers.openai).toEqual(NONE);
    expect(masked.providers.gemini).toEqual(NONE);
  });
});

describe("security — no plaintext key in any masked output", () => {
  it("readMediaConfig never serialises a stored key across providers", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { provider: "volcengine", api_key: "sk-volc-LEAK" }, {});
    await writeMediaConfig(home, { provider: "openai", api_key: "sk-openai-LEAK" }, {});
    process.env.GEMINI_API_KEY = "sk-gemini-env-LEAK";
    const masked = await readMediaConfig(home);
    const serialized = JSON.stringify(masked);
    expect(serialized).not.toContain("sk-volc-LEAK");
    expect(serialized).not.toContain("sk-openai-LEAK");
    expect(serialized).not.toContain("sk-gemini-env-LEAK");
    // tails are fine, full keys are not.
    expect(serialized).toContain("LEAK".slice(-4));
  });

  it("writeMediaConfig return value never serialises a plaintext key", async () => {
    const home = await makeHome();
    const masked = await writeMediaConfig(home, { provider: "openai", api_key: "sk-openai-RETURN-LEAK" }, {});
    expect(JSON.stringify(masked)).not.toContain("sk-openai-RETURN-LEAK");
  });
});
