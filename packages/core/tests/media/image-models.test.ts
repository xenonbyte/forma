import { describe, expect, it } from "vitest";
import {
  type AspectRatio,
  ASPECT_RATIOS,
  FormaError,
  IMAGE_MODELS,
  IMAGE_PROVIDERS,
  findImageModel,
  isModelOfProvider,
  resolveSize,
} from "@xenonbyte/forma-core";

// ---------------------------------------------------------------------------
// Provenance — Volcengine Ark official docs, verified 2026-06-13.
//
// Endpoint / response contract (SPEC-BEHAVIOR-002):
//   POST https://ark.cn-beijing.volces.com/api/v3/images/generations
//   Bearer auth · response_format: "url" | "b64_json" (default "url")
//   response: data[].url | data[].b64_json | data[].size
//   Source: https://www.volcengine.com/docs/82379/1541523
//
// Model list (SPEC-BEHAVIOR-001):
//   Source: https://www.volcengine.com/docs/82379/1330310  (updated 2026-05-29)
//   Source: https://www.volcengine.com/docs/82379/1824121  (Seedream 4.0-5.0 tutorial)
//   doubao-seedream-5-0-260128       (primary / recommended default)
//   doubao-seedream-5-0-lite-260128  (co-supported under the 5.0 row)
//   doubao-seedream-4-5-251128
//   doubao-seedream-4-0-250828
//   doubao-seedream-3-0-t2i-250415   (separate page 1555133, updated 2026-06-12;
//                                     not in the 1330310 image table but live + t2i)
//
// Aspect -> size tables:
//   4.x / 5.x family (2K class), official table @ 1824121:
//     1:1  2048x2048
//     4:3  2304x1728
//     3:4  1728x2304
//     16:9 2848x1600
//     9:16 1600x2848
//   3.0 t2i family (lower max res, default 1024x1024; range 512x512..2048x2048),
//   corroborated across novita.ai / jiekou.ai mirrors of doc 1555133 (2026-06-13):
//     1:1  1024x1024
//     4:3  1152x864
//     3:4  864x1152
//     16:9 1280x720
//     9:16 720x1280
//
// MP1 additions — OpenAI + Gemini providers (verified 2026-06-13):
//   OpenAI gpt-image-1 — images API reference (https://platform.openai.com/docs/api-reference/images).
//     Standard sizes: 1024x1024, 1536x1024, 1024x1536 (+ auto). Our 5 aspects map
//     to the nearest allowed size; 4:3/3:4 collapse onto the landscape/portrait pair:
//       1:1  1024x1024
//       16:9 1536x1024   4:3 1536x1024   (landscape)
//       9:16 1024x1536   3:4 1024x1536   (portrait)
//   Gemini gemini-2.5-flash-image (Nano Banana) — NOMINAL / UNCONFIRMED. The
//     OpenAI-compat images endpoint's `size` handling is not verified (the official
//     example omits size; output is ~1024px square by default). The table mirrors the
//     OpenAI sizes only so resolveSize doesn't throw; MP3 reads ACTUAL dimensions from
//     the returned PNG. These are bookkeeping placeholders, not a verified contract.
//
// T6 additions — expanded OpenAI + Gemini models (2026-06-14):
//   OpenAI gpt-image-2 — confirmed real model ID. Source:
//     https://developers.openai.com/api/docs/models/gpt-image-2
//     Supports arbitrary WxH (div by 16, ratio 1:3..3:1, max 3840x2160) plus standard
//     presets. Standard sizes: 1024x1024, 1536x1024, 1024x1536.  VERIFIED.
//   OpenAI gpt-image-1.5 — confirmed real model ID. Source:
//     https://developers.openai.com/api/docs/models/gpt-image-1.5
//     Same standard sizes as gpt-image-1.  VERIFIED.
//   openai default changed to gpt-image-1.5 (T6 / SPEC-BEHAVIOR-001 update).
//   Gemini gemini-3.1-flash-image — confirmed stable model ID. Source:
//     https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image
//     VERIFIED model ID; size contract via /images/generations endpoint: UNCONFIRMED.
//   Gemini gemini-3-pro-image — confirmed stable model ID. Source:
//     https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image
//     VERIFIED model ID; size contract via /images/generations endpoint: UNCONFIRMED.
//   Gemini default: UNCHANGED (gemini-2.5-flash-image). DECISION-002 A: OpenAI-compat
//     /images/generations endpoint compatibility for Gemini 3.x models is unconfirmed
//     (user reports + docs indicate 404 on that endpoint for image models). A native
//     generateContent renderer is a deferred follow-up.
// ---------------------------------------------------------------------------

const EXPECTED_VOLCENGINE_MODEL_IDS = [
  "doubao-seedream-5-0-260128",
  "doubao-seedream-5-0-lite-260128",
  "doubao-seedream-4-5-251128",
  "doubao-seedream-4-0-250828",
  "doubao-seedream-3-0-t2i-250415",
];

describe("IMAGE_PROVIDERS catalogue", () => {
  it("includes volcengine with the official base URL and a docs URL", () => {
    const volcengine = IMAGE_PROVIDERS.find((p) => p.id === "volcengine");
    expect(volcengine).toBeDefined();
    expect(volcengine?.defaultBaseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
    expect(volcengine?.docsUrl).toMatch(/^https:\/\/www\.volcengine\.com\/docs\//);
    expect(volcengine?.label).toBeTruthy();
    expect(volcengine?.hint).toBeTruthy();
  });

  it("includes a stub provider marked hidden so the settings UI can filter it", () => {
    const stub = IMAGE_PROVIDERS.find((p) => p.id === "stub");
    expect(stub).toBeDefined();
    expect(stub?.hidden).toBe(true);
  });

  it("includes openai with the official base URL and a docs URL, not hidden", () => {
    const openai = IMAGE_PROVIDERS.find((p) => p.id === "openai");
    expect(openai).toBeDefined();
    expect(openai?.defaultBaseUrl).toBe("https://api.openai.com/v1");
    expect(openai?.docsUrl).toBe("https://platform.openai.com/docs/api-reference/images");
    expect(openai?.hidden).toBeFalsy();
    expect(openai?.label).toBeTruthy();
    expect(openai?.hint).toBeTruthy();
  });

  it("includes gemini with the official OpenAI-compat base URL and a docs URL, not hidden", () => {
    const gemini = IMAGE_PROVIDERS.find((p) => p.id === "gemini");
    expect(gemini).toBeDefined();
    expect(gemini?.defaultBaseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(gemini?.docsUrl).toBe("https://ai.google.dev/gemini-api/docs/image-generation");
    expect(gemini?.hidden).toBeFalsy();
    expect(gemini?.label).toBeTruthy();
    expect(gemini?.hint).toBeTruthy();
  });

  it("only the stub provider is hidden; volcengine / openai / gemini are visible", () => {
    const visible = IMAGE_PROVIDERS.filter((p) => !p.hidden).map((p) => p.id);
    expect(visible).toContain("volcengine");
    expect(visible).toContain("openai");
    expect(visible).toContain("gemini");
    expect(visible).not.toContain("stub");
  });

  it("provider ids are unique", () => {
    const ids = IMAGE_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("IMAGE_MODELS catalogue", () => {
  it("registers exactly the five verified Seedream models under volcengine", () => {
    const volcengineIds = IMAGE_MODELS.filter((m) => m.provider === "volcengine").map((m) => m.id);
    expect(volcengineIds.sort()).toEqual([...EXPECTED_VOLCENGINE_MODEL_IDS].sort());
  });

  // T6: openai default moved to gpt-image-1.5 (SPEC-BEHAVIOR-001 update, 2026-06-14).
  it("registers gpt-image-1.5 under openai as its default (T6)", () => {
    const model = findImageModel("gpt-image-1.5");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("openai");
    expect(model?.default).toBe(true);
  });

  it("registers gpt-image-1 under openai as non-default (demoted in T6)", () => {
    const model = findImageModel("gpt-image-1");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("openai");
    expect(model?.default).toBeFalsy();
  });

  it("registers gpt-image-2 under openai as non-default (T6)", () => {
    const model = findImageModel("gpt-image-2");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("openai");
    expect(model?.default).toBeFalsy();
  });

  // T6: gemini default UNCHANGED per DECISION-002 A — OpenAI-compat /images/generations
  // endpoint compatibility of new gemini-3.x models could not be confirmed (reports of
  // 404; native generateContent renderer is deferred). gemini-2.5-flash-image stays default.
  it("registers gemini-2.5-flash-image under gemini as its default (DECISION-002 A, T6)", () => {
    const model = findImageModel("gemini-2.5-flash-image");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("gemini");
    expect(model?.default).toBe(true);
  });

  it("registers gemini-3.1-flash-image under gemini as non-default (T6)", () => {
    const model = findImageModel("gemini-3.1-flash-image");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("gemini");
    expect(model?.default).toBeFalsy();
  });

  it("registers gemini-3-pro-image under gemini as non-default (T6)", () => {
    const model = findImageModel("gemini-3-pro-image");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("gemini");
    expect(model?.default).toBeFalsy();
  });

  it("has exactly one default model per visible provider, with the verified primary volcengine default", () => {
    const visibleProviderIds = IMAGE_PROVIDERS.filter((p) => !p.hidden).map((p) => p.id);
    for (const providerId of visibleProviderIds) {
      const defaults = IMAGE_MODELS.filter((m) => m.provider === providerId && m.default);
      expect(defaults, `provider ${providerId} should have exactly one default`).toHaveLength(1);
    }
    const volcengineDefault = IMAGE_MODELS.find((m) => m.provider === "volcengine" && m.default);
    expect(volcengineDefault?.id).toBe("doubao-seedream-5-0-260128");
  });

  it("model ids are unique", () => {
    const ids = IMAGE_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every model points at a registered provider", () => {
    const providerIds = new Set(IMAGE_PROVIDERS.map((p) => p.id));
    for (const model of IMAGE_MODELS) {
      expect(providerIds.has(model.provider)).toBe(true);
    }
  });

  it("includes a hidden stub model under the stub provider", () => {
    const stubModel = IMAGE_MODELS.find((m) => m.provider === "stub");
    expect(stubModel).toBeDefined();
    expect(stubModel?.hidden).toBe(true);
  });

  it("every model has label and hint", () => {
    for (const model of IMAGE_MODELS) {
      expect(model.label).toBeTruthy();
      expect(model.hint).toBeTruthy();
    }
  });
});

describe("findImageModel", () => {
  it("returns the model entry for a registered id", () => {
    const model = findImageModel("doubao-seedream-5-0-260128");
    expect(model?.provider).toBe("volcengine");
  });

  it("returns undefined for an unregistered id", () => {
    expect(findImageModel("not-a-real-model")).toBeUndefined();
  });
});

describe("isModelOfProvider", () => {
  it("is true when the model belongs to the provider", () => {
    expect(isModelOfProvider("doubao-seedream-5-0-260128", "volcengine")).toBe(true);
  });

  it("is false when the model belongs to a different provider", () => {
    expect(isModelOfProvider("doubao-seedream-5-0-260128", "stub")).toBe(false);
  });

  it("is false for an unregistered model id", () => {
    expect(isModelOfProvider("not-a-real-model", "volcengine")).toBe(false);
  });

  it("matches openai / gemini models to their own provider and not across providers", () => {
    expect(isModelOfProvider("gpt-image-1", "openai")).toBe(true);
    expect(isModelOfProvider("gpt-image-1", "gemini")).toBe(false);
    expect(isModelOfProvider("gpt-image-1", "volcengine")).toBe(false);
    expect(isModelOfProvider("gemini-2.5-flash-image", "gemini")).toBe(true);
    expect(isModelOfProvider("gemini-2.5-flash-image", "openai")).toBe(false);
  });
});

describe("resolveSize — 4.x / 5.x family (2K class)", () => {
  const cases: Array<[AspectRatio, { width: number; height: number }]> = [
    ["1:1", { width: 2048, height: 2048 }],
    ["16:9", { width: 2848, height: 1600 }],
    ["9:16", { width: 1600, height: 2848 }],
    ["4:3", { width: 2304, height: 1728 }],
    ["3:4", { width: 1728, height: 2304 }],
  ];

  for (const modelId of [
    "doubao-seedream-5-0-260128",
    "doubao-seedream-5-0-lite-260128",
    "doubao-seedream-4-5-251128",
    "doubao-seedream-4-0-250828",
  ]) {
    describe(modelId, () => {
      for (const [aspect, expected] of cases) {
        it(`${aspect} -> ${expected.width}x${expected.height}`, () => {
          expect(resolveSize(modelId, aspect)).toEqual(expected);
        });
      }
    });
  }
});

describe("resolveSize — 3.0 t2i family (1K class)", () => {
  const cases: Array<[AspectRatio, { width: number; height: number }]> = [
    ["1:1", { width: 1024, height: 1024 }],
    ["16:9", { width: 1280, height: 720 }],
    ["9:16", { width: 720, height: 1280 }],
    ["4:3", { width: 1152, height: 864 }],
    ["3:4", { width: 864, height: 1152 }],
  ];

  for (const [aspect, expected] of cases) {
    it(`${aspect} -> ${expected.width}x${expected.height}`, () => {
      expect(resolveSize("doubao-seedream-3-0-t2i-250415", aspect)).toEqual(expected);
    });
  }
});

describe("resolveSize — openai gpt-image-1 (nearest-allowed sizes)", () => {
  const cases: Array<[AspectRatio, { width: number; height: number }]> = [
    ["1:1", { width: 1024, height: 1024 }],
    ["16:9", { width: 1536, height: 1024 }],
    ["9:16", { width: 1024, height: 1536 }],
    ["4:3", { width: 1536, height: 1024 }],
    ["3:4", { width: 1024, height: 1536 }],
  ];

  for (const [aspect, expected] of cases) {
    it(`${aspect} -> ${expected.width}x${expected.height}`, () => {
      expect(resolveSize("gpt-image-1", aspect)).toEqual(expected);
    });
  }
});

describe("resolveSize — openai gpt-image-1.5 (verified standard sizes, T6)", () => {
  // Verified 2026-06-14: same standard preset sizes as gpt-image-1.
  // Source: https://developers.openai.com/api/docs/models/gpt-image-1.5
  const cases: Array<[AspectRatio, { width: number; height: number }]> = [
    ["1:1", { width: 1024, height: 1024 }],
    ["16:9", { width: 1536, height: 1024 }],
    ["9:16", { width: 1024, height: 1536 }],
    ["4:3", { width: 1536, height: 1024 }],
    ["3:4", { width: 1024, height: 1536 }],
  ];

  for (const [aspect, expected] of cases) {
    it(`${aspect} -> ${expected.width}x${expected.height}`, () => {
      expect(resolveSize("gpt-image-1.5", aspect)).toEqual(expected);
    });
  }
});

describe("resolveSize — openai gpt-image-2 (verified standard sizes, T6)", () => {
  // Verified 2026-06-14: mapped to standard presets (arbitrary WxH also supported).
  // Source: https://developers.openai.com/api/docs/models/gpt-image-2
  const cases: Array<[AspectRatio, { width: number; height: number }]> = [
    ["1:1", { width: 1024, height: 1024 }],
    ["16:9", { width: 1536, height: 1024 }],
    ["9:16", { width: 1024, height: 1536 }],
    ["4:3", { width: 1536, height: 1024 }],
    ["3:4", { width: 1024, height: 1536 }],
  ];

  for (const [aspect, expected] of cases) {
    it(`${aspect} -> ${expected.width}x${expected.height}`, () => {
      expect(resolveSize("gpt-image-2", aspect)).toEqual(expected);
    });
  }
});

describe("resolveSize — gemini-3.1-flash-image (NOMINAL / UNCONFIRMED placeholders, T6)", () => {
  // Model ID verified 2026-06-14; size values are UNCONFIRMED for /images/generations.
  // Source: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image
  // Tests assert positive integers only — do NOT assert specific pixel values.
  for (const aspect of ASPECT_RATIOS) {
    it(`${aspect} -> positive integers (placeholder, not a verified contract)`, () => {
      const size = resolveSize("gemini-3.1-flash-image", aspect);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
      expect(Number.isInteger(size.width)).toBe(true);
      expect(Number.isInteger(size.height)).toBe(true);
    });
  }
});

describe("resolveSize — gemini-3-pro-image (NOMINAL / UNCONFIRMED placeholders, T6)", () => {
  // Model ID verified 2026-06-14; size values are UNCONFIRMED for /images/generations.
  // Source: https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image
  // Tests assert positive integers only — do NOT assert specific pixel values.
  for (const aspect of ASPECT_RATIOS) {
    it(`${aspect} -> positive integers (placeholder, not a verified contract)`, () => {
      const size = resolveSize("gemini-3-pro-image", aspect);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
      expect(Number.isInteger(size.width)).toBe(true);
      expect(Number.isInteger(size.height)).toBe(true);
    });
  }
});

describe("resolveSize — gemini-2.5-flash-image (NOMINAL / UNCONFIRMED placeholders)", () => {
  const cases: Array<[AspectRatio, { width: number; height: number }]> = [
    ["1:1", { width: 1024, height: 1024 }],
    ["16:9", { width: 1536, height: 1024 }],
    ["9:16", { width: 1024, height: 1536 }],
    ["4:3", { width: 1536, height: 1024 }],
    ["3:4", { width: 1024, height: 1536 }],
  ];

  for (const [aspect, expected] of cases) {
    it(`${aspect} -> ${expected.width}x${expected.height} (placeholder, not a verified contract)`, () => {
      expect(resolveSize("gemini-2.5-flash-image", aspect)).toEqual(expected);
    });
  }
});

describe("resolveSize — error handling", () => {
  it("throws MEDIA_INVALID_INPUT for an unknown model", () => {
    try {
      resolveSize("not-a-real-model", "1:1");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(FormaError);
      expect((error as FormaError).code).toBe("MEDIA_INVALID_INPUT");
    }
  });

  it("throws MEDIA_INVALID_INPUT for an unknown aspect ratio", () => {
    try {
      resolveSize("doubao-seedream-5-0-260128", "2:1" as AspectRatio);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(FormaError);
      expect((error as FormaError).code).toBe("MEDIA_INVALID_INPUT");
    }
  });
});

describe("ASPECT_RATIOS", () => {
  it("lists the five supported aspect ratios", () => {
    expect([...ASPECT_RATIOS].sort()).toEqual(["1:1", "16:9", "3:4", "4:3", "9:16"].sort());
  });
});

describe("drift-guard — every IMAGE_MODELS entry has a size-table entry", () => {
  // This test iterates the full catalogue cross-product so that any model
  // registered in IMAGE_MODELS but missing from the module-private
  // MODEL_SIZE_TABLES will fail the suite here rather than exploding at runtime.
  for (const model of IMAGE_MODELS) {
    describe(model.id, () => {
      for (const aspect of ASPECT_RATIOS) {
        it(`resolveSize("${model.id}", "${aspect}") returns positive integers`, () => {
          const size = resolveSize(model.id, aspect);
          expect(size.width).toBeTypeOf("number");
          expect(size.height).toBeTypeOf("number");
          expect(size.width).toBeGreaterThan(0);
          expect(size.height).toBeGreaterThan(0);
          expect(Number.isInteger(size.width)).toBe(true);
          expect(Number.isInteger(size.height)).toBe(true);
        });
      }
    });
  }
});
