// ---------------------------------------------------------------------------
// Image models catalogue — SPEC-BEHAVIOR-001 / SPEC-BEHAVIOR-002
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

/** Maps each registered model id to its size table. */
const MODEL_SIZE_TABLES: Record<string, SizeTable> = {
  "doubao-seedream-5-0-260128": SEEDREAM_2K_SIZES,
  "doubao-seedream-5-0-lite-260128": SEEDREAM_2K_SIZES,
  "doubao-seedream-4-5-251128": SEEDREAM_2K_SIZES,
  "doubao-seedream-4-0-250828": SEEDREAM_2K_SIZES,
  "doubao-seedream-3-0-t2i-250415": SEEDREAM_3_0_T2I_SIZES,
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
