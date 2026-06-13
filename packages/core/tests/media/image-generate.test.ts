import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormaError, generateImages } from "@xenonbyte/forma-core";

// ---------------------------------------------------------------------------
// SPEC-BEHAVIOR-001 / SPEC-BEHAVIOR-002 — image generation scheduler.
//
// Covers:
//   stub full chain — offline, deterministic PNG bytes encode width/height
//   purpose -> default aspect mapping
//   explicit aspect override + invalid aspect -> MEDIA_INVALID_INPUT
//   unknown purpose -> MEDIA_INVALID_INPUT
//   count default 1, count > 4 -> MEDIA_INVALID_INPUT (no silent truncation)
//   count > 1 -> N distinct staged images
//   no key configured -> MEDIA_NOT_CONFIGURED
//   bad configured model (not in catalogue / wrong provider) -> MEDIA_INVALID_INPUT
//   volcengine renderer (mocked fetch): 2xx b64_json staged; non-2xx ->
//     MEDIA_PROVIDER_ERROR with status + truncated body, NEVER the api key.
// ---------------------------------------------------------------------------

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
const PRODUCT_ID = "P-7e5701";

let savedEnv: Record<string, string | undefined>;
let home: string;

async function makeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forma-image-generate-"));
}

function clearEnv(): void {
  for (const name of ENV_VARS) delete process.env[name];
}

/** Write a media-config.yaml selecting the deterministic stub provider/model. */
async function writeStubConfig(h: string): Promise<void> {
  await writeFile(join(h, "media-config.yaml"), "providers:\n  stub:\n    model: stub-image-1\n", "utf8");
}

/** Write a media-config.yaml selecting volcengine with a file api_key. */
async function writeVolcengineConfig(h: string, apiKey: string): Promise<void> {
  await writeFile(
    join(h, "media-config.yaml"),
    `providers:\n  volcengine:\n    api_key: ${apiKey}\n    model: doubao-seedream-5-0-260128\n`,
    "utf8",
  );
}

/** Write a media-config.yaml selecting openai (gpt-image-1) as the active provider. */
async function writeOpenAIConfig(h: string, apiKey: string): Promise<void> {
  await writeFile(
    join(h, "media-config.yaml"),
    `active_provider: openai\nproviders:\n  openai:\n    api_key: ${apiKey}\n    model: gpt-image-1\n`,
    "utf8",
  );
}

/** Write a media-config.yaml selecting gemini (gemini-2.5-flash-image) as the active provider. */
async function writeGeminiConfig(h: string, apiKey: string): Promise<void> {
  await writeFile(
    join(h, "media-config.yaml"),
    `active_provider: gemini\nproviders:\n  gemini:\n    api_key: ${apiKey}\n    model: gemini-2.5-flash-image\n`,
    "utf8",
  );
}

// --- A real, decodable solid-colour RGB PNG with known dimensions. ---------
// Mirrors the scheduler's stub encoder so sharp can read back exact width/height
// (used to assert gemini reads ACTUAL dims from the bytes, not the nominal table).
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function makeSolidPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const raw = Buffer.alloc((1 + width * 3) * height);
  const idat = deflateSync(raw);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

beforeEach(async () => {
  savedEnv = {};
  for (const name of ENV_VARS) savedEnv[name] = process.env[name];
  clearEnv();
  home = await makeHome();
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// stub full chain — offline, deterministic
// ---------------------------------------------------------------------------

describe("generateImages — stub provider (offline)", () => {
  it("stages one image by default and returns ref/preview_path/dimensions", async () => {
    await writeStubConfig(home);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await generateImages(home, {
      productId: PRODUCT_ID,
      purpose: "app-icon",
      prompt: "a friendly robot mascot",
    });

    // Never touched the network.
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(result.images).toHaveLength(1);
    const img = result.images[0];
    expect(img.ref).toMatch(/^forma-image:\/\/[0-9a-f-]{36}$/);
    expect(img.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // app-icon default aspect is 1:1 -> 2048x2048 for the stub 2K table.
    expect(img.width).toBe(2048);
    expect(img.height).toBe(2048);
    expect(img.preview_path).toContain(join("data", PRODUCT_ID, "image-staging"));
    expect(img.preview_path.endsWith(".png")).toBe(true);
    expect(typeof result.provider_note).toBe("string");
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("writes a real PNG whose IHDR encodes the resolved width/height", async () => {
    await writeStubConfig(home);
    const result = await generateImages(home, {
      productId: PRODUCT_ID,
      purpose: "hero", // default 16:9 -> 2848x1600
      prompt: "city skyline",
    });
    const img = result.images[0];
    expect(img.width).toBe(2848);
    expect(img.height).toBe(1600);

    const bytes = await readFile(img.preview_path);
    // PNG signature.
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // IHDR length(4)+"IHDR"(4) starts at offset 8; width/height are the next two big-endian u32s.
    expect(bytes.readUInt32BE(16)).toBe(2848);
    expect(bytes.readUInt32BE(20)).toBe(1600);
  });

  it("maps each purpose to its default aspect", async () => {
    await writeStubConfig(home);
    const cases: Array<[string, number, number]> = [
      ["app-icon", 2048, 2048], // 1:1
      ["illustration", 2304, 1728], // 4:3
      ["hero", 2848, 1600], // 16:9
      ["poster-bg", 1600, 2848], // 9:16
      ["store-shot-bg", 1600, 2848], // 9:16
    ];
    for (const [purpose, w, h] of cases) {
      const result = await generateImages(home, {
        productId: PRODUCT_ID,
        // biome-ignore lint/suspicious/noExplicitAny: exercising the purpose union via table
        purpose: purpose as any,
        prompt: "x",
      });
      expect([result.images[0].width, result.images[0].height]).toEqual([w, h]);
    }
  });

  it("honours an explicit aspect override", async () => {
    await writeStubConfig(home);
    const result = await generateImages(home, {
      productId: PRODUCT_ID,
      purpose: "hero", // would default 16:9
      aspect: "1:1",
      prompt: "x",
    });
    expect([result.images[0].width, result.images[0].height]).toEqual([2048, 2048]);
  });

  it("produces N distinct staged images for count > 1", async () => {
    await writeStubConfig(home);
    const result = await generateImages(home, {
      productId: PRODUCT_ID,
      purpose: "illustration",
      prompt: "x",
      count: 3,
    });
    expect(result.images).toHaveLength(3);
    const ids = new Set(result.images.map((i) => i.id));
    expect(ids.size).toBe(3);
    // Each maps to a distinct on-disk png.
    const dir = join(home, "data", PRODUCT_ID, "image-staging");
    const pngs = (await readdir(dir)).filter((f) => f.endsWith(".png"));
    expect(pngs).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

describe("generateImages — input validation", () => {
  it("rejects an unknown purpose with MEDIA_INVALID_INPUT", async () => {
    await writeStubConfig(home);
    await expect(
      generateImages(home, {
        productId: PRODUCT_ID,
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid
        purpose: "banner" as any,
        prompt: "x",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_INVALID_INPUT" });
  });

  it("rejects an invalid aspect with MEDIA_INVALID_INPUT", async () => {
    await writeStubConfig(home);
    await expect(
      generateImages(home, {
        productId: PRODUCT_ID,
        purpose: "hero",
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid
        aspect: "21:9" as any,
        prompt: "x",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_INVALID_INPUT" });
  });

  it("rejects count > 4 with MEDIA_INVALID_INPUT (no silent truncation)", async () => {
    await writeStubConfig(home);
    await expect(
      generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x", count: 5 }),
    ).rejects.toMatchObject({ code: "MEDIA_INVALID_INPUT" });
  });

  it("rejects count < 1 with MEDIA_INVALID_INPUT", async () => {
    await writeStubConfig(home);
    await expect(
      generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x", count: 0 }),
    ).rejects.toMatchObject({ code: "MEDIA_INVALID_INPUT" });
  });
});

// ---------------------------------------------------------------------------
// configuration errors
// ---------------------------------------------------------------------------

describe("generateImages — configuration", () => {
  it("throws MEDIA_NOT_CONFIGURED when nothing is configured", async () => {
    // no media-config.yaml, no env keys
    await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
      code: "MEDIA_NOT_CONFIGURED",
    });
  });

  it("throws MEDIA_INVALID_INPUT when the configured model is not in the catalogue", async () => {
    await writeFile(
      join(home, "media-config.yaml"),
      "providers:\n  volcengine:\n    api_key: sk-test\n    model: not-a-real-model\n",
      "utf8",
    );
    await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
      code: "MEDIA_INVALID_INPUT",
    });
  });
});

// ---------------------------------------------------------------------------
// volcengine renderer (mocked fetch)
// ---------------------------------------------------------------------------

describe("generateImages — volcengine provider (mocked fetch)", () => {
  it("stages bytes from a 2xx b64_json response and POSTs the expected body", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    const tinyPng = makeSolidPng(1, 1);
    const b64 = tinyPng.toString("base64");

    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const result = await generateImages(home, {
      productId: PRODUCT_ID,
      purpose: "hero",
      prompt: "a quiet harbour",
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0].width).toBe(2848);
    expect(result.images[0].height).toBe(1600);

    // Endpoint + auth + body shape.
    expect(capturedUrl).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-secret-123");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.model).toBe("doubao-seedream-5-0-260128");
    expect(body.prompt).toBe("a quiet harbour");
    expect(body.response_format).toBe("b64_json");
    expect(body.size).toBe("2848x1600");
    // Watermark suppressed — Forma output is commercial brand material.
    expect(body.watermark).toBe(false);

    // The staged bytes match the decoded response.
    const staged = await readFile(result.images[0].preview_path);
    expect(staged).toEqual(tinyPng);
  });

  it("makes count calls for count > 1", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    const tinyPng = makeSolidPng(1, 1);
    const b64 = tinyPng.toString("base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImages(home, {
      productId: PRODUCT_ID,
      purpose: "hero",
      prompt: "x",
      count: 2,
    });
    expect(result.images).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws MEDIA_PROVIDER_ERROR on non-2xx with status + truncated body, never the key", async () => {
    await writeVolcengineConfig(home, "sk-super-secret-key-XYZ");
    const longBody = `error: bad request ${"A".repeat(2000)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(longBody, { status: 401, headers: { "content-type": "text/plain" } })),
    );

    let caught: unknown;
    try {
      await generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FormaError);
    const err = caught as FormaError;
    expect(err.code).toBe("MEDIA_PROVIDER_ERROR");
    expect(err.details).toMatchObject({ status: 401 });

    // Body present but truncated to <= 500 chars.
    const detailBody = (err.details as { body?: string }).body ?? "";
    expect(detailBody.length).toBeLessThanOrEqual(500);
    expect(detailBody).toContain("error: bad request");

    // No api key anywhere in the serialized error.
    const serialized = JSON.stringify({ message: err.message, details: err.details });
    expect(serialized).not.toContain("sk-super-secret-key-XYZ");
    expect(serialized.toLowerCase()).not.toContain("bearer");
  });

  it("redacts the api key if a custom provider echoes Authorization in the error body", async () => {
    await writeVolcengineConfig(home, "sk-super-secret-key-XYZ");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("upstream saw Authorization: Bearer sk-super-secret-key-XYZ", {
            status: 401,
            headers: { "content-type": "text/plain" },
          }),
      ),
    );

    let caught: unknown;
    try {
      await generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FormaError);
    const serialized = JSON.stringify((caught as FormaError).toJSON());
    expect(serialized).not.toContain("sk-super-secret-key-XYZ");
    expect(serialized.toLowerCase()).not.toContain("bearer");
    expect(serialized).toContain("[REDACTED:authorization]");
  });

  it("throws MEDIA_PROVIDER_ERROR when the 2xx body has no b64_json/url", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{}] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
      code: "MEDIA_PROVIDER_ERROR",
    });
  });

  it("rejects a 2xx b64_json payload that is not a readable image", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("not an image").toString("base64") }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
      code: "MEDIA_PROVIDER_ERROR",
    });
  });

  it("env-key-wins: FORMA_VOLCENGINE_API_KEY selects volcengine even when only stub is in the file", async () => {
    // File contains only stub; env key must override and select volcengine.
    await writeStubConfig(home);
    process.env.FORMA_VOLCENGINE_API_KEY = "sk-env-key-wins";

    const tinyPng = makeSolidPng(1, 1);
    const b64 = tinyPng.toString("base64");
    let capturedUrl = "";
    let capturedAuth = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedAuth = (init?.headers as Record<string, string>).authorization ?? "";
        return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const result = await generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" });
    expect(result.images).toHaveLength(1);
    // fetch must have been called — volcengine renderer was selected, not stub.
    expect(capturedUrl).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    expect(capturedAuth).toBe("Bearer sk-env-key-wins");
  });

  it("both-file-providers: volcengine in file wins over stub when both present", async () => {
    // media-config.yaml has both providers; volcengine should be selected (probe order).
    await writeFile(
      join(home, "media-config.yaml"),
      `${[
        "providers:",
        "  volcengine:",
        "    api_key: sk-file-key",
        "    model: doubao-seedream-5-0-260128",
        "  stub:",
        "    model: stub-image-1",
      ].join("\n")}\n`,
      "utf8",
    );

    const tinyPng = makeSolidPng(1, 1);
    const b64 = tinyPng.toString("base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" });
    expect(result.images).toHaveLength(1);
    // volcengine renderer was selected — fetch called exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-file-key");
  });

  it("non-JSON 2xx body throws MEDIA_PROVIDER_ERROR with status 200 and truncated body", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } })),
    );

    let caught: unknown;
    try {
      await generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FormaError);
    const err = caught as FormaError;
    expect(err.code).toBe("MEDIA_PROVIDER_ERROR");
    const details = err.details as { status?: number; body?: string };
    expect(details.status).toBe(200);
    // Body should be present and not exceed the 500-char limit.
    expect(typeof details.body).toBe("string");
    expect((details.body ?? "").length).toBeLessThanOrEqual(500);
  });

  it("fetches the url when the response carries url instead of b64_json", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    const imgBytes = makeSolidPng(1, 1);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://cdn.example.com/out.png") {
        return new Response(imgBytes, { status: 200 });
      }
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/out.png" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" });
    const staged = await readFile(result.images[0].preview_path);
    expect(staged).toEqual(imgBytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Finding 4a (SSRF) — provider-controlled url second-fetch must be guarded.
//
// The volcengine renderer requests b64_json but tolerates a provider that
// returns data[0].url and second-fetches it. That url is fully provider-
// controlled, so it must be screened (scheme + literal private/loopback IPs +
// no redirects + size cap) before the second fetch is allowed to run.
// ---------------------------------------------------------------------------

describe("generateImages — SSRF guard on the url second-fetch", () => {
  /** Build a fetch mock whose FIRST call returns a provider url, then delegates. */
  function urlResponse(url: string) {
    return new Response(JSON.stringify({ data: [{ url }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("rejects a cloud-metadata IP (169.254.169.254) and never second-fetches it", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    const metadataUrl = "http://169.254.169.254/latest/meta-data/iam/security-credentials/";
    let secondFetched = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === metadataUrl) {
        secondFetched = true;
        return new Response(Buffer.from("STOLEN-CREDS"), { status: 200 });
      }
      return urlResponse(metadataUrl);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
      code: "MEDIA_PROVIDER_ERROR",
    });
    // The internal host must never be fetched.
    expect(secondFetched).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a loopback url (http://127.0.0.1:9200/...)", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    const loopback = "http://127.0.0.1:9200/_cat/indices";
    let secondFetched = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === loopback) {
        secondFetched = true;
        return new Response(Buffer.from("LOCAL"), { status: 200 });
      }
      return urlResponse(loopback);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
      code: "MEDIA_PROVIDER_ERROR",
    });
    expect(secondFetched).toBe(false);
  });

  it("rejects a localhost hostname", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    const fetchMock = vi.fn(async () => urlResponse("http://localhost:8080/admin"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
      code: "MEDIA_PROVIDER_ERROR",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects bracketed IPv6 loopback and unique-local literals before second-fetch", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    for (const ip of ["http://[::1]:9200/admin", "http://[fd00::1]/admin"]) {
      let secondFetched = false;
      const fetchMock = vi.fn(async (url: string) => {
        if (url === ip) {
          secondFetched = true;
          return new Response(Buffer.from("LOCAL"), { status: 200 });
        }
        return urlResponse(ip);
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject(
        { code: "MEDIA_PROVIDER_ERROR" },
      );
      expect(secondFetched).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects a private-range IP (10.x / 192.168.x / 172.16.x)", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    for (const ip of ["http://10.0.0.5/x", "http://192.168.1.1/x", "http://172.16.0.1/x"]) {
      const fetchMock = vi.fn(async () => urlResponse(ip));
      vi.stubGlobal("fetch", fetchMock);
      await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject(
        { code: "MEDIA_PROVIDER_ERROR" },
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects a non-http(s) scheme (file:///etc/passwd)", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    const fetchMock = vi.fn(async () => urlResponse("file:///etc/passwd"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
      code: "MEDIA_PROVIDER_ERROR",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never leaks the api key in the SSRF rejection error", async () => {
    await writeVolcengineConfig(home, "sk-super-secret-key-XYZ");
    const fetchMock = vi.fn(async () => urlResponse("http://169.254.169.254/x"));
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FormaError);
    const serialized = JSON.stringify((caught as FormaError).toJSON());
    expect(serialized).not.toContain("sk-super-secret-key-XYZ");
    expect(serialized.toLowerCase()).not.toContain("bearer");
  });

  it("rejects a second-fetch that responds with a redirect (redirect: error)", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    const safeUrl = "https://cdn.example.com/out.png";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === safeUrl) {
        // Simulate the fetch refusing to follow a redirect (redirect: "error").
        expect(init?.redirect).toBe("error");
        throw new TypeError("Failed to fetch: unexpected redirect");
      }
      return urlResponse(safeUrl);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
      code: "MEDIA_PROVIDER_ERROR",
    });
  });

  it("rejects an oversized response (Content-Length over the cap)", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    const safeUrl = "https://cdn.example.com/huge.png";
    const fetchMock = vi.fn(async (url: string) => {
      if (url === safeUrl) {
        return new Response(Buffer.from("small"), {
          status: 200,
          headers: { "content-length": String(128 * 1024 * 1024) },
        });
      }
      return urlResponse(safeUrl);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
      code: "MEDIA_PROVIDER_ERROR",
    });
  });

  it("rejects a response whose streamed bytes exceed the cap (no/under-reported Content-Length)", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    const safeUrl = "https://cdn.example.com/sneaky.png";
    // Stream chunks summing to > 64 MiB while reporting no Content-Length.
    const chunk = new Uint8Array(8 * 1024 * 1024); // 8 MiB
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 9; i++) controller.enqueue(chunk); // 72 MiB total
        controller.close();
      },
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === safeUrl) {
        return new Response(stream, { status: 200 });
      }
      return urlResponse(safeUrl);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
      code: "MEDIA_PROVIDER_ERROR",
    });
  });

  it("still works for a normal public https url (regression)", async () => {
    await writeVolcengineConfig(home, "sk-secret-123");
    const safeUrl = "https://cdn.example.com/ok.png";
    const imgBytes = makeSolidPng(1, 1);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === safeUrl) return new Response(imgBytes, { status: 200 });
      return urlResponse(safeUrl);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" });
    const staged = await readFile(result.images[0].preview_path);
    expect(staged).toEqual(imgBytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Finding 3a — productId is joined into the staging path; validate it.
//
// The security boundary is PATH SAFETY, not product-id SHAPE. A path-unsafe id
// (traversal / separators / absolute / NUL / control / over-length) must be
// rejected before any provider call. A path-safe non-product segment (e.g. the
// "media-config-test" smoke-test sentinel) is allowed — product existence is
// the caller's concern, not the staging directory-name boundary.
// ---------------------------------------------------------------------------

describe("generateImages — productId validation (path-traversal guard)", () => {
  // PATH-UNSAFE ids — every one would let the staging dir escape the per-product
  // tree or smuggle a NUL/control char into a filesystem path.
  const BAD_IDS = [
    "../../evil",
    "..",
    "a/b",
    "a\\b",
    "",
    "/etc/passwd",
    "C:\\windows",
    "P-test01\x00",
    `P-${"a".repeat(200)}`,
  ];

  for (const bad of BAD_IDS) {
    it(`rejects productId ${JSON.stringify(bad)} before any provider call`, async () => {
      await writeStubConfig(home);
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await expect(generateImages(home, { productId: bad, purpose: "hero", prompt: "x" })).rejects.toMatchObject({
        code: "MEDIA_INVALID_INPUT",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it("accepts a well-formed productId (regression)", async () => {
    await writeStubConfig(home);
    const result = await generateImages(home, { productId: "P-abc123", purpose: "hero", prompt: "x" });
    expect(result.images).toHaveLength(1);
  });

  it("accepts the path-safe non-product sentinel 'media-config-test'", async () => {
    // POST /api/media/test runs the connectivity probe through generateImages
    // with this throwaway sentinel bucket. It is path-safe, so it must pass.
    await writeStubConfig(home);
    const result = await generateImages(home, {
      productId: "media-config-test",
      purpose: "app-icon",
      prompt: "smoke test",
    });
    expect(result.images).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MP3 — openai provider (gpt-image-1) via the shared OpenAI-compatible renderer.
//   Request shape: { model, prompt, size } — NO response_format, NO watermark.
//   gpt-image-1 honours the requested size (OpenAI size table).
// ---------------------------------------------------------------------------

describe("generateImages — openai provider (mocked fetch)", () => {
  it("POSTs the OpenAI body shape (size, no response_format, no watermark) and stages bytes", async () => {
    await writeOpenAIConfig(home, "sk-openai-123");
    const png = makeSolidPng(1024, 1024);
    const b64 = png.toString("base64");

    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const result = await generateImages(home, {
      productId: PRODUCT_ID,
      purpose: "app-icon", // 1:1 -> OpenAI table 1024x1024
      prompt: "a friendly robot mascot",
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0].width).toBe(1024);
    expect(result.images[0].height).toBe(1024);

    expect(capturedUrl).toBe("https://api.openai.com/v1/images/generations");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-openai-123");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.model).toBe("gpt-image-1");
    expect(body.prompt).toBe("a friendly robot mascot");
    expect(body.size).toBe("1024x1024");
    // gpt-image-1 rejects response_format and has no watermark control.
    expect(body.response_format).toBeUndefined();
    expect(body.watermark).toBeUndefined();

    const staged = await readFile(result.images[0].preview_path);
    expect(staged).toEqual(png);
  });

  it("throws MEDIA_PROVIDER_ERROR on non-2xx and never leaks the openai key", async () => {
    await writeOpenAIConfig(home, "sk-openai-SECRET-9999");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401, headers: { "content-type": "text/plain" } })),
    );

    let caught: unknown;
    try {
      await generateImages(home, { productId: PRODUCT_ID, purpose: "app-icon", prompt: "x" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FormaError);
    expect((caught as FormaError).code).toBe("MEDIA_PROVIDER_ERROR");
    const serialized = JSON.stringify((caught as FormaError).toJSON());
    expect(serialized).not.toContain("sk-openai-SECRET-9999");
    expect(serialized.toLowerCase()).not.toContain("bearer");
  });

  it("rejects an OpenAI 2xx b64_json payload that is not a readable image", async () => {
    await writeOpenAIConfig(home, "sk-openai-123");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("not an image").toString("base64") }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(
      generateImages(home, { productId: PRODUCT_ID, purpose: "app-icon", prompt: "x" }),
    ).rejects.toMatchObject({ code: "MEDIA_PROVIDER_ERROR" });
  });

  it("applies the SSRF guard to an openai url response (169.254 metadata)", async () => {
    await writeOpenAIConfig(home, "sk-openai-123");
    const metadataUrl = "http://169.254.169.254/latest/meta-data/";
    let secondFetched = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === metadataUrl) {
        secondFetched = true;
        return new Response(Buffer.from("STOLEN"), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [{ url: metadataUrl }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateImages(home, { productId: PRODUCT_ID, purpose: "app-icon", prompt: "x" }),
    ).rejects.toMatchObject({ code: "MEDIA_PROVIDER_ERROR" });
    expect(secondFetched).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// MP3 — gemini provider (gemini-2.5-flash-image) via the OpenAI-compat endpoint.
//   Request shape: { model, prompt, response_format } — NO size (size handling
//   UNCONFIRMED; let the model default). Dimensions are read back from the
//   ACTUAL returned bytes, not the nominal gemini size table.
// ---------------------------------------------------------------------------

describe("generateImages — gemini provider (mocked fetch)", () => {
  it("POSTs without size and reports the ACTUAL returned dimensions (not the nominal table)", async () => {
    await writeGeminiConfig(home, "sk-gemini-123");
    // Return a PNG whose real dims (900x1600) differ from the nominal 16:9 table.
    const png = makeSolidPng(900, 1600);
    const b64 = png.toString("base64");

    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const result = await generateImages(home, {
      productId: PRODUCT_ID,
      purpose: "hero",
      prompt: "a wide landscape",
    });

    expect(capturedUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai/images/generations");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.model).toBe("gemini-2.5-flash-image");
    expect(body.response_format).toBe("b64_json");
    // Size is NOT sent — Gemini's OpenAI-compat size handling is unverified.
    expect(body.size).toBeUndefined();
    expect(body.watermark).toBeUndefined();

    // Dimensions come from the actual decoded bytes, NOT the nominal 16:9 table (1536x1024).
    expect(result.images[0].width).toBe(900);
    expect(result.images[0].height).toBe(1600);

    const staged = await readFile(result.images[0].preview_path);
    expect(staged).toEqual(png);
  });

  it("throws MEDIA_PROVIDER_ERROR (no key leak) on non-2xx", async () => {
    await writeGeminiConfig(home, "sk-gemini-SECRET-7777");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 400, headers: { "content-type": "text/plain" } })),
    );

    let caught: unknown;
    try {
      await generateImages(home, { productId: PRODUCT_ID, purpose: "hero", prompt: "x" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FormaError);
    expect((caught as FormaError).code).toBe("MEDIA_PROVIDER_ERROR");
    const serialized = JSON.stringify((caught as FormaError).toJSON());
    expect(serialized).not.toContain("sk-gemini-SECRET-7777");
  });
});
