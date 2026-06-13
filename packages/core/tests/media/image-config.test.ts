import { mkdtemp, readFile, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FormaError,
  readMediaConfig,
  writeMediaConfig,
  resolveProviderConfig,
} from "@xenonbyte/forma-core";

// ---------------------------------------------------------------------------
// SPEC-BEHAVIOR-003 — media-config credential store.
//
// Read precedence: env (FORMA_VOLCENGINE_API_KEY > ARK_API_KEY >
// VOLCENGINE_API_KEY) > $FORMA_HOME/media-config.yaml. Masked reads only
// return { configured, source, model, base_url, api_key_tail }; env-sourced
// keys never echo a tail. Writes support preserveApiKey + a 409 wipe-guard.
// File permissions are tightened to 0600 (skipped on win32).
// ---------------------------------------------------------------------------

const ENV_VARS = ["FORMA_VOLCENGINE_API_KEY", "ARK_API_KEY", "VOLCENGINE_API_KEY"];
const VOLCENGINE_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const VOLCENGINE_DEFAULT_MODEL = "doubao-seedream-5-0-260128";
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

describe("readMediaConfig — unconfigured", () => {
  it("reports none when neither env nor file present", async () => {
    const home = await makeHome();
    expect(await readMediaConfig(home)).toEqual({ configured: false, source: "none" });
  });
});

describe("readMediaConfig — env precedence", () => {
  it("uses env source and omits api_key_tail entirely", async () => {
    const home = await makeHome();
    process.env.VOLCENGINE_API_KEY = "sk-from-env-1234";
    const masked = await readMediaConfig(home);
    expect(masked.configured).toBe(true);
    expect(masked.source).toBe("env");
    expect(masked).not.toHaveProperty("api_key_tail");
  });

  it("FORMA_VOLCENGINE_API_KEY wins over ARK_API_KEY and VOLCENGINE_API_KEY", async () => {
    const home = await makeHome();
    process.env.FORMA_VOLCENGINE_API_KEY = "sk-forma";
    process.env.ARK_API_KEY = "sk-ark";
    process.env.VOLCENGINE_API_KEY = "sk-volc";
    const resolved = await resolveProviderConfig(home, "volcengine");
    expect(resolved.apiKey).toBe("sk-forma");
  });

  it("ARK_API_KEY wins over VOLCENGINE_API_KEY", async () => {
    const home = await makeHome();
    process.env.ARK_API_KEY = "sk-ark";
    process.env.VOLCENGINE_API_KEY = "sk-volc";
    const resolved = await resolveProviderConfig(home, "volcengine");
    expect(resolved.apiKey).toBe("sk-ark");
  });

  it("env overrides a stored file key", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { api_key: "sk-file-key-9999" }, {});
    process.env.VOLCENGINE_API_KEY = "sk-env-override";
    const masked = await readMediaConfig(home);
    expect(masked.source).toBe("env");
    expect(masked).not.toHaveProperty("api_key_tail");
    const resolved = await resolveProviderConfig(home, "volcengine");
    expect(resolved.apiKey).toBe("sk-env-override");
  });

  it("env source still surfaces file-stored model/base_url", async () => {
    const home = await makeHome();
    await writeMediaConfig(
      home,
      { api_key: "sk-file", base_url: "https://example/api", model: "doubao-seedream-4-0-250828" },
      {},
    );
    process.env.VOLCENGINE_API_KEY = "sk-env";
    const masked = await readMediaConfig(home);
    expect(masked.source).toBe("env");
    expect(masked.base_url).toBe("https://example/api");
    expect(masked.model).toBe("doubao-seedream-4-0-250828");
  });
});

describe("readMediaConfig — file source", () => {
  it("returns tail-4 of the stored key with source=file", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { api_key: "sk-abcd1234WXYZ" }, {});
    const masked = await readMediaConfig(home);
    expect(masked.configured).toBe(true);
    expect(masked.source).toBe("file");
    expect(masked.api_key_tail).toBe("WXYZ");
  });

  it("reports none when file has no api_key", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { base_url: "https://example/api" }, { force: true });
    expect(await readMediaConfig(home)).toEqual({ configured: false, source: "none" });
  });
});

describe("writeMediaConfig — preserveApiKey", () => {
  it("keeps existing key when payload omits api_key and preserveApiKey is set", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { api_key: "sk-original-7777" }, {});
    await writeMediaConfig(home, { model: "doubao-seedream-4-5-251128" }, { preserveApiKey: true });
    const resolved = await resolveProviderConfig(home, "volcengine");
    expect(resolved.apiKey).toBe("sk-original-7777");
    expect(resolved.model).toBe("doubao-seedream-4-5-251128");
    const masked = await readMediaConfig(home);
    expect(masked.api_key_tail).toBe("7777");
  });
});

describe("writeMediaConfig — wipe-guard", () => {
  it("throws MEDIA_NOT_CONFIGURED with requires_force when emptying existing config", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { api_key: "sk-existing-0001" }, {});
    let thrown: unknown;
    try {
      await writeMediaConfig(home, {}, {});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FormaError);
    const err = thrown as FormaError;
    expect(err.code).toBe("MEDIA_NOT_CONFIGURED");
    expect(err.details).toMatchObject({ requires_force: true });
  });

  it("never leaks the plaintext key in the wipe-guard error", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { api_key: "sk-secret-leak-test" }, {});
    let thrown: unknown;
    try {
      await writeMediaConfig(home, {}, {});
    } catch (err) {
      thrown = err;
    }
    const serialized = JSON.stringify((thrown as FormaError).toJSON()) + String((thrown as Error).message);
    expect(serialized).not.toContain("sk-secret-leak-test");
  });

  it("allows wiping with force=true", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { api_key: "sk-existing-0002" }, {});
    const masked = await writeMediaConfig(home, {}, { force: true });
    expect(masked).toEqual({ configured: false, source: "none" });
    expect(await readMediaConfig(home)).toEqual({ configured: false, source: "none" });
  });

  it("does not guard when there is no existing config", async () => {
    const home = await makeHome();
    const masked = await writeMediaConfig(home, {}, {});
    expect(masked).toEqual({ configured: false, source: "none" });
  });
});

describe("file permissions", () => {
  it.skipIf(isWin)("creates the config file with 0600", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { api_key: "sk-perm-create" }, {});
    const st = await stat(join(home, "media-config.yaml"));
    expect(st.mode & 0o777).toBe(0o600);
  });

  it.skipIf(isWin)("tightens a pre-existing 0644 file to 0600", async () => {
    const home = await makeHome();
    const file = join(home, "media-config.yaml");
    await writeFile(file, "providers:\n  volcengine:\n    api_key: sk-loose-0644\n", "utf8");
    await chmod(file, 0o644);
    await writeMediaConfig(home, { model: "doubao-seedream-4-0-250828" }, { preserveApiKey: true });
    const st = await stat(file);
    expect(st.mode & 0o777).toBe(0o600);
  });
});

describe("resolveProviderConfig", () => {
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

  it("fills default base_url and model when file omits them", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { api_key: "sk-defaults-1111" }, {});
    const resolved = await resolveProviderConfig(home, "volcengine");
    expect(resolved.apiKey).toBe("sk-defaults-1111");
    expect(resolved.baseUrl).toBe(VOLCENGINE_DEFAULT_BASE_URL);
    expect(resolved.model).toBe(VOLCENGINE_DEFAULT_MODEL);
  });

  it("honours stored base_url and model over defaults", async () => {
    const home = await makeHome();
    await writeMediaConfig(
      home,
      { api_key: "sk-stored-2222", base_url: "https://custom/api", model: "doubao-seedream-4-5-251128" },
      {},
    );
    const resolved = await resolveProviderConfig(home, "volcengine");
    expect(resolved.baseUrl).toBe("https://custom/api");
    expect(resolved.model).toBe("doubao-seedream-4-5-251128");
  });

  it("never includes the api_key in an error for an unknown provider", async () => {
    const home = await makeHome();
    await writeMediaConfig(home, { api_key: "sk-unknown-provider-secret" }, {});
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
    await writeMediaConfig(home, { api_key: "sk-shape-3333", model: "doubao-seedream-4-0-250828" }, {});
    const raw = await readFile(join(home, "media-config.yaml"), "utf8");
    expect(raw).toContain("providers:");
    expect(raw).toContain("volcengine:");
    expect(raw).toContain("api_key:");
    expect(raw).toContain("doubao-seedream-4-0-250828");
  });
});
