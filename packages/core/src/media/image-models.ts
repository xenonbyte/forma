// ---------------------------------------------------------------------------
// Image models catalogue — SPEC-BEHAVIOR-001 / SPEC-BEHAVIOR-002
//
// T6 (2026-06-14): openai provider default changed to gpt-image-1.5 (SPEC-BEHAVIOR-001).
//
// Single source of truth for the image-generation provider/model catalogue and
// the aspect -> pixel-size resolution table. Pure data + lookups only: NO HTTP,
// NO fetch, NO renderer logic (the scheduler/renderer is a separate task).
//
// All values below were verified against the Volcengine Ark official docs on
// 2026-06-13. Do NOT edit a model id or pixel value without re-verifying the
// source and updating tests/media/image-models.test.ts (which records the
// source URLs + verification date as provenance comments).
//
//   Endpoint (doc 82379/1541523):
//     POST https://ark.cn-beijing.volces.com/api/v3/images/generations
//     Bearer auth · response_format: "url" | "b64_json" (default "url")
//     response: data[].url | data[].b64_json | data[].size
//   Model list (doc 82379/1330310 @ 2026-05-29, 82379/1824121 tutorial,
//     82379/1555133 for 3.0 t2i @ 2026-06-12).
// ---------------------------------------------------------------------------

import { FormaError } from "../errors.js";

export type ImageProvider = {
  id: string;
  label: string;
  hint: string;
  defaultBaseUrl?: string;
  docsUrl?: string;
  /** When true, hide from settings UI / public model listings (e.g. the deterministic test stub). */
  hidden?: boolean;
};

export type ImageModel = {
  id: string;
  label: string;
  hint: string;
  provider: string;
  default?: boolean;
  /** When true, hide from settings UI / public model listings (mirrors provider hidden flag). */
  hidden?: boolean;
};

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

/** The supported aspect ratios, in canonical display order. */
export const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const satisfies readonly AspectRatio[];

export const IMAGE_PROVIDERS: ImageProvider[] = [
  {
    id: "volcengine",
    label: "火山方舟 (Volcengine Ark)",
    hint: "字节跳动豆包 Seedream 图片生成模型，需要方舟 API Key。",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    docsUrl: "https://www.volcengine.com/docs/82379/1541523",
  },
  {
    id: "openai",
    label: "OpenAI",
    hint: "OpenAI gpt-image-1.5 图片生成，需要 OpenAI API Key。",
    defaultBaseUrl: "https://api.openai.com/v1",
    docsUrl: "https://platform.openai.com/docs/api-reference/images",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    hint: "Google Gemini 2.5 Flash Image（Nano Banana），OpenAI 兼容端点，需要 Gemini API Key。",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    docsUrl: "https://ai.google.dev/gemini-api/docs/image-generation",
  },
  {
    id: "stub",
    label: "Stub (test only)",
    hint: "Deterministic offline provider for tests; never shown in settings.",
    hidden: true,
  },
];

export const IMAGE_MODELS: ImageModel[] = [
  {
    id: "doubao-seedream-5-0-260128",
    label: "Doubao Seedream 5.0",
    hint: "最强图片生成，支持联网检索、参考一致性与组图；最高 4K。",
    provider: "volcengine",
    default: true,
  },
  {
    id: "doubao-seedream-5-0-lite-260128",
    label: "Doubao Seedream 5.0 lite",
    hint: "Seedream 5.0 轻量版，速度更快、成本更低；最高 4K。",
    provider: "volcengine",
  },
  {
    id: "doubao-seedream-4-5-251128",
    label: "Doubao Seedream 4.5",
    hint: "上一代旗舰，支持组图与多参考图；最高 4K。",
    provider: "volcengine",
  },
  {
    id: "doubao-seedream-4-0-250828",
    label: "Doubao Seedream 4.0",
    hint: "经典版本，支持组图与多参考图；最高 4K。",
    provider: "volcengine",
  },
  {
    id: "doubao-seedream-3-0-t2i-250415",
    label: "Doubao Seedream 3.0 (t2i)",
    hint: "文生图基础模型；最高约 2K（默认 1024x1024）。",
    provider: "volcengine",
  },
  // ---------------------------------------------------------------------------
  // OpenAI image models
  // Source: https://platform.openai.com/docs/api-reference/images
  //         https://developers.openai.com/api/docs/models/gpt-image-2
  //         https://developers.openai.com/api/docs/models/gpt-image-1.5
  // Verified: 2026-06-14 — gpt-image-2 and gpt-image-1.5 are confirmed real
  // model IDs per the OpenAI API reference. Both support the same standard size
  // set as gpt-image-1 (1024x1024, 1536x1024, 1024x1536). gpt-image-2 also
  // supports arbitrary WxH (divisible by 16, ratio 1:3..3:1, max 3840x2160).
  // ---------------------------------------------------------------------------
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    hint: "OpenAI 最新旗舰图片生成，支持自定义分辨率（最高 4K）；标准尺寸 1024 / 1536。",
    provider: "openai",
  },
  {
    id: "gpt-image-1.5",
    label: "GPT Image 1.5",
    hint: "OpenAI 通用图片生成旗舰；更强表现力、更好文字渲染；标准尺寸 1024 / 1536。",
    provider: "openai",
    default: true,
  },
  {
    id: "gpt-image-1",
    label: "GPT Image 1",
    hint: "OpenAI 图片生成经典版；标准尺寸 1024 / 1536 三档。",
    provider: "openai",
  },
  // ---------------------------------------------------------------------------
  // Gemini image models
  // Source: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image
  //         https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image
  // Verified: 2026-06-14 — gemini-3.1-flash-image and gemini-3-pro-image are
  // confirmed stable (non-preview) model IDs per Google AI for Developers docs.
  //
  // DECISION-002 A — gemini default UNCHANGED (gemini-2.5-flash-image stays default):
  // The OpenAI-compatible /images/generations endpoint compatibility of the new
  // Gemini 3.x image models CANNOT be confirmed. The existing renderer uses
  // renderOpenAICompatibleImage(...,"gemini"), and user reports indicate that even
  // gemini-2.5-flash-image returns 404 on the OpenAI-compat endpoint in some
  // configurations. The new models are registered non-default here; a native
  // generateContent renderer is a deferred follow-up (out of scope for T6).
  //
  // Sizes: gemini-3.1-flash-image supports 512px/1K/2K/4K output sizes per
  // https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-flash-image
  // The exact pixel dimensions for the /images/generations size parameter are
  // UNCONFIRMED — these tables use placeholder values mirroring the sibling
  // model's table (GEMINI_2_5_FLASH_IMAGE_SIZES) until a native renderer is added.
  // ---------------------------------------------------------------------------
  {
    id: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image (Nano Banana 2)",
    hint: "Gemini 高效图片生成；速度快、高并发；native renderer 待接入，暂通过 OpenAI 兼容端点注册。",
    provider: "gemini",
  },
  {
    id: "gemini-3-pro-image",
    label: "Gemini 3 Pro Image (Nano Banana Pro)",
    hint: "Gemini 旗舰图片生成，融合推理能力，适合复杂高保真场景；native renderer 待接入。",
    provider: "gemini",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image (Nano Banana)",
    hint: "Gemini 快速图片生成；OpenAI 兼容端点，默认约 1024px 方图。",
    provider: "gemini",
    default: true,
  },
  {
    id: "stub-image-1",
    label: "Stub image model",
    hint: "Deterministic offline model for tests; never shown in settings.",
    provider: "stub",
    hidden: true,
  },
];

// ---------------------------------------------------------------------------
// Aspect -> size tables, verified 2026-06-13.
//
// Seedream 4.x / 5.x share the same recommended 2K-class table (doc 1824121,
// official "推荐宽高像素值" table, 2K column). Seedream 3.0 t2i maxes out far
// lower and uses its own 1K-class table (doc 1555133; corroborated across
// novita.ai / jiekou.ai mirrors). resolveSize routes per model family.
// ---------------------------------------------------------------------------

type SizeTable = Record<AspectRatio, { width: number; height: number }>;

/** Seedream 4.x / 5.x — 2K class recommended sizes (doc 82379/1824121). */
const SEEDREAM_2K_SIZES: SizeTable = {
  "1:1": { width: 2048, height: 2048 },
  "16:9": { width: 2848, height: 1600 },
  "9:16": { width: 1600, height: 2848 },
  "4:3": { width: 2304, height: 1728 },
  "3:4": { width: 1728, height: 2304 },
};

/** Seedream 3.0 t2i — 1K class recommended sizes (doc 82379/1555133). */
const SEEDREAM_3_0_T2I_SIZES: SizeTable = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "4:3": { width: 1152, height: 864 },
  "3:4": { width: 864, height: 1152 },
};

/**
 * OpenAI gpt-image-1 — exact allowed sizes (verified 2026-06-13 against the OpenAI
 * images API reference: https://platform.openai.com/docs/api-reference/images).
 * gpt-image-1 only accepts 1024x1024, 1536x1024, 1024x1536 (plus "auto"); our five
 * aspects map to the nearest allowed size. OpenAI offers no native 4:3 / 3:4 pixel
 * option, so 4:3 collapses onto the landscape pair and 3:4 onto the portrait pair.
 */
const GPT_IMAGE_1_SIZES: SizeTable = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1536, height: 1024 },
  "9:16": { width: 1024, height: 1536 },
  "4:3": { width: 1536, height: 1024 }, // nearest allowed landscape
  "3:4": { width: 1024, height: 1536 }, // nearest allowed portrait
};

/**
 * Gemini 2.5 Flash Image (Nano Banana) — NOMINAL / UNCONFIRMED.
 *
 * Gemini's OpenAI-compatible images endpoint size behavior is NOT verified: the
 * official example omits `size`, and Nano Banana outputs ~1024px square by default.
 * This table only mirrors the OpenAI sizes so resolveSize() does not throw — the MP3
 * renderer will use the model default and read the ACTUAL dimensions from the returned
 * PNG. These values are bookkeeping placeholders only, NOT a verified contract.
 */
const GEMINI_2_5_FLASH_IMAGE_SIZES: SizeTable = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1536, height: 1024 },
  "9:16": { width: 1024, height: 1536 },
  "4:3": { width: 1536, height: 1024 },
  "3:4": { width: 1024, height: 1536 },
};

/**
 * OpenAI gpt-image-1.5 — same standard allowed sizes as gpt-image-1.
 *
 * Verified 2026-06-14: gpt-image-1.5 supports 1024x1024, 1536x1024, 1024x1536
 * (plus "auto") per the OpenAI API reference:
 *   https://developers.openai.com/api/docs/models/gpt-image-1.5
 *   https://platform.openai.com/docs/api-reference/images
 * Also supports custom resolutions (divisible by 16, ratio 1:3..3:1) but we map our
 * 5 named aspects to the nearest standard preset to stay within confirmed behavior.
 * 4:3 / 3:4 collapse onto the landscape / portrait pair (no native option).
 */
const GPT_IMAGE_1_5_SIZES: SizeTable = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1536, height: 1024 },
  "9:16": { width: 1024, height: 1536 },
  "4:3": { width: 1536, height: 1024 }, // nearest allowed landscape
  "3:4": { width: 1024, height: 1536 }, // nearest allowed portrait
};

/**
 * OpenAI gpt-image-2 — standard sizes confirmed; also supports arbitrary WxH.
 *
 * Verified 2026-06-14: gpt-image-2 supports 1024x1024, 1536x1024, 1024x1536
 * (plus arbitrary WxH divisible by 16, ratio 1:3..3:1, max 3840x2160) per:
 *   https://developers.openai.com/api/docs/models/gpt-image-2
 *   https://platform.openai.com/docs/api-reference/images
 * We map our 5 aspects to the standard preset sizes for consistency with sibling models.
 */
const GPT_IMAGE_2_SIZES: SizeTable = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1536, height: 1024 },
  "9:16": { width: 1024, height: 1536 },
  "4:3": { width: 1536, height: 1024 }, // nearest standard landscape
  "3:4": { width: 1024, height: 1536 }, // nearest standard portrait
};

/**
 * Gemini 3.1 Flash Image (Nano Banana 2) — NOMINAL / UNCONFIRMED for /images/generations.
 *
 * Verified 2026-06-14: gemini-3.1-flash-image is a confirmed stable model ID per
 * https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image. The model
 * supports 512px / 1K / 2K / 4K output tiers per Vertex AI docs. However, the exact
 * `size` parameter format for the OpenAI-compat /images/generations endpoint is
 * UNCONFIRMED for this model family (DECISION-002 A). This table uses placeholder
 * values mirroring GEMINI_2_5_FLASH_IMAGE_SIZES so resolveSize() does not throw.
 * Actual pixel values are bookkeeping only until a native generateContent renderer lands.
 */
const GEMINI_3_1_FLASH_IMAGE_SIZES: SizeTable = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1536, height: 1024 },
  "9:16": { width: 1024, height: 1536 },
  "4:3": { width: 1536, height: 1024 },
  "3:4": { width: 1024, height: 1536 },
};

/**
 * Gemini 3 Pro Image (Nano Banana Pro) — NOMINAL / UNCONFIRMED for /images/generations.
 *
 * Verified 2026-06-14: gemini-3-pro-image is a confirmed stable model ID per
 * https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image. Designed for
 * complex / high-fidelity generation. Size capabilities and OpenAI-compat endpoint
 * support are UNCONFIRMED. Placeholder table mirrors GEMINI_2_5_FLASH_IMAGE_SIZES
 * until a native generateContent renderer is implemented.
 */
const GEMINI_3_PRO_IMAGE_SIZES: SizeTable = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1536, height: 1024 },
  "9:16": { width: 1024, height: 1536 },
  "4:3": { width: 1536, height: 1024 },
  "3:4": { width: 1024, height: 1536 },
};

/** Maps each registered model id to its size table. */
const MODEL_SIZE_TABLES: Record<string, SizeTable> = {
  "doubao-seedream-5-0-260128": SEEDREAM_2K_SIZES,
  "doubao-seedream-5-0-lite-260128": SEEDREAM_2K_SIZES,
  "doubao-seedream-4-5-251128": SEEDREAM_2K_SIZES,
  "doubao-seedream-4-0-250828": SEEDREAM_2K_SIZES,
  "doubao-seedream-3-0-t2i-250415": SEEDREAM_3_0_T2I_SIZES,
  // openai: verified 2026-06-14 (see GPT_IMAGE_* docstrings above)
  "gpt-image-2": GPT_IMAGE_2_SIZES,
  "gpt-image-1.5": GPT_IMAGE_1_5_SIZES,
  "gpt-image-1": GPT_IMAGE_1_SIZES,
  // gemini: NOMINAL/UNCONFIRMED placeholders (see per-const docstrings above)
  "gemini-3.1-flash-image": GEMINI_3_1_FLASH_IMAGE_SIZES,
  "gemini-3-pro-image": GEMINI_3_PRO_IMAGE_SIZES,
  "gemini-2.5-flash-image": GEMINI_2_5_FLASH_IMAGE_SIZES,
  // stub: reuses the 2K profile for deterministic tests; not doc-derived
  "stub-image-1": SEEDREAM_2K_SIZES,
};

/** Returns the catalogue entry for a model id, or undefined when unregistered. */
export function findImageModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((model) => model.id === id);
}

/** True when the given model id is registered and belongs to the given provider. */
export function isModelOfProvider(modelId: string, providerId: string): boolean {
  return findImageModel(modelId)?.provider === providerId;
}

/**
 * Resolves the exact output pixel dimensions for a model + aspect ratio from the
 * verified per-model-family size table. Throws FormaError(MEDIA_INVALID_INPUT)
 * for an unregistered model or an unsupported aspect ratio.
 */
export function resolveSize(model: string, aspect: AspectRatio): { width: number; height: number } {
  const table = MODEL_SIZE_TABLES[model];
  if (!table) {
    throw new FormaError("MEDIA_INVALID_INPUT", `Unknown image model: ${model}`, {
      model,
      knownModels: Object.keys(MODEL_SIZE_TABLES),
    });
  }
  const size = table[aspect];
  if (!size) {
    throw new FormaError("MEDIA_INVALID_INPUT", `Unsupported aspect ratio: ${aspect}`, {
      model,
      aspect,
      supportedAspects: ASPECT_RATIOS,
    });
  }
  return { ...size };
}
