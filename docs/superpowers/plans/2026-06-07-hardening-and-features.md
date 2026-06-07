# Forma 加固 + 功能 (R1–R11, F3–F4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实施 `docs/hardening-requirements.md` 中的全部待实施项：第一批加固 R1–R6、R10，第二批 R7、R11（R8 已完成、R9 被 lint backlog 门控另行排期），已立项功能 F3（版本对比视图）与 F4（`forma doctor` 只读诊断）。

**Architecture:** 全部为现有架构内的薄层加固与加法扩展——core 单点预算、CLI token 通道收敛、server 新端点、web 新页面、core 新诊断函数。无数据格式/on-disk layout 变更，每个任务独立可 revert。

**Tech Stack:** TypeScript (strict), pnpm monorepo, Vitest, Fastify, React (happy-dom tests), Puppeteer, sharp, zod。

**Source spec:** `docs/hardening-requirements.md`（含每项的现状/需求/验收标准，实现时如有疑义以该文档为准）。

**约定（适用所有任务）：**
- 每个 commit message 末尾加：`Co-Authored-By: Claude <noreply@anthropic.com>`
- 所有 `Commit` step 只有在用户明确要求提交时才执行；未获授权时保留本地改动并在汇报中列出待提交文件。
- 每个 `Commit` step 执行前先跑 `git status --short`；若存在该任务 `Files:` 列表之外的改动，停止并请用户决定。执行 `git add ...` 后跑 `git diff --cached --name-only`，确认 staged 文件只包含该任务列出的文件，再执行 `git commit`。
- 每个任务收尾跑 `pnpm lint:changed`（新代码必须 lint 干净；全量 lint 有 112-error backlog，是 R9 的事，不要去修无关文件）。
- 测试命令均在仓库根目录执行。
- `docs/` 下新文件默认被 ignore；本计划和需求文档已在 source branch 跟踪，实施 commit 不需要再包含计划文件变更，除非用户明确要求提交文档修订。

---

### Task 0: 建分支

**Files:** 无代码改动。

- [ ] **Step 1: 安全预检**

```bash
cd /Users/xubo/x-studio/forma
git status --short
git rev-parse --abbrev-ref HEAD
git log --oneline -1
```

Expected: worktree 为空；当前分支为 `docs/hardening-requirements`；HEAD 为 `e4c1b06 docs: add implementation plan for hardening batch and F3/F4 features`。若 worktree 非空、分支不符、HEAD 不符，或 `feat/hardening-batch` 已存在，停止并请用户决定是否提交/暂存本地改动、切换 base、复用已有分支或换分支名；不要自行覆盖或继续。

- [ ] **Step 2: 从需求文档分支切出实施分支**

```bash
git switch docs/hardening-requirements
git switch -c feat/hardening-batch
git log --oneline -1   # 应为 e4c1b06 docs: add implementation plan for hardening batch and F3/F4 features
```

---

### Task 1: R10 — 删除 core 中污染 MCP stdio 的 console.log + 守护测试

**Files:**
- Modify: `packages/core/src/artifact-store.ts:194`（删一行）
- Create: `packages/core/tests/no-console-log.test.ts`

**背景：** MCP server 走 stdio，JSON-RPC 占用 stdout。`artifact-store.ts:194` 的 `console.log("[artifact-store] written:", artifactId)` 在 MCP 进程内每次设计保存都向 stdout 写非 JSON 文本。core 其余 `console.warn`/`console.error` 走 stderr，安全，允许保留。

- [ ] **Step 1: 写守护测试（会失败）**

创建 `packages/core/tests/no-console-log.test.ts`：

```typescript
/**
 * Guard: packages/core runs inside the MCP stdio server where stdout carries
 * JSON-RPC frames. console.log writes to stdout and corrupts the protocol
 * stream; console.warn / console.error go to stderr and are allowed.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

async function listTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("core source hygiene", () => {
  it("contains no console.log (stdout is reserved for the MCP stdio protocol)", async () => {
    const offenders: string[] = [];
    for (const file of await listTsFiles(SRC_DIR)) {
      const text = await readFile(file, "utf8");
      for (const [index, line] of text.split("\n").entries()) {
        if (line.includes("console.log(")) {
          offenders.push(`${file}:${index + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/core/tests/no-console-log.test.ts
```
Expected: FAIL，offenders 包含 `artifact-store.ts:194`。

- [ ] **Step 3: 删除该行**

在 `packages/core/src/artifact-store.ts` 中删除：

```typescript
        console.log("[artifact-store] written:", artifactId);
```

（`return { artifactId, etag };` 前的一行，retention hook 调用之后。）

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/core/tests/no-console-log.test.ts packages/core/tests/artifact-store.test.ts
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/artifact-store.ts packages/core/tests/no-console-log.test.ts
git commit -m "fix(core): drop stdout console.log that corrupts MCP stdio framing (R10)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: R4 — parseDataUrl malformed payload 抛 FormaError

**Files:**
- Modify: `packages/core/src/artifact-asset-pipeline.ts:103-109`
- Test: `packages/core/tests/artifact-asset-pipeline.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `packages/core/tests/artifact-asset-pipeline.test.ts` 末尾追加：

```typescript
describe("parseDataUrl error classification (R4)", () => {
  it("rejects malformed url-encoded data URLs with ARTIFACT_INVALID_INPUT", async () => {
    // %E0%A4%A is a truncated percent-escape — decodeURIComponent throws URIError
    const html = `<img src="data:image/svg+xml,%E0%A4%A">`;
    await expect(localizeArtifactAssets({ html })).rejects.toMatchObject({
      code: "ARTIFACT_INVALID_INPUT",
    });
  });
});
```

（该文件已 import `localizeArtifactAssets`；若 describe/it/expect 已在顶部 import 则无需新增。）

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/core/tests/artifact-asset-pipeline.test.ts
```
Expected: 新用例 FAIL（收到裸 `URIError` 而非 FormaError）。

- [ ] **Step 3: 实现**

`packages/core/src/artifact-asset-pipeline.ts` 中 `parseDataUrl` 的 payload 分支，将：

```typescript
  let payload: Buffer;
  if (isBase64) {
    payload = Buffer.from(body, "base64");
  } else {
    // url-encoded
    payload = Buffer.from(decodeURIComponent(body), "utf8");
  }
```

改为：

```typescript
  let payload: Buffer;
  if (isBase64) {
    payload = Buffer.from(body, "base64");
  } else {
    // url-encoded
    let decoded: string;
    try {
      decoded = decodeURIComponent(body);
    } catch (err) {
      throw new FormaError("ARTIFACT_INVALID_INPUT", `Malformed url-encoded data: URL payload (${mime})`, {
        mime,
        cause: String(err),
      });
    }
    payload = Buffer.from(decoded, "utf8");
  }
```

（`FormaError` 已在该文件 import。）

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/core/tests/artifact-asset-pipeline.test.ts
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/artifact-asset-pipeline.ts packages/core/tests/artifact-asset-pipeline.test.ts
git commit -m "fix(core): classify malformed data URL payloads as ARTIFACT_INVALID_INPUT (R4)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: R3 — core 单点资源预算（3 常量 + sharp 像素上限）

**Files:**
- Modify: `packages/core/src/artifact-asset-pipeline.ts`（预算常量 + 检查 + sharp limitInputPixels）
- Modify: `packages/core/src/artifact-icon-extraction.ts`（inline SVG icon rasterization sharp limitInputPixels）
- Test: `packages/core/tests/artifact-asset-pipeline.test.ts`（追加预算 + raster limit 用例）
- Test: `packages/core/tests/artifact-icon-extraction.test.ts`（追加 icon raster limit 用例）

**设计决定：** 预算在 `localizeArtifactAssets` 入口/出口单点执行（其唯一调用方是 `design-save.ts:105`，MCP/HTTP/Web 全部共享此链路）。不在 MCP、HTTP、Web 层重复写限制。

- [ ] **Step 1: 写失败测试**

追加到 `packages/core/tests/artifact-asset-pipeline.test.ts`：

```typescript
import {
  MAX_HTML_BYTES,
  MAX_ASSET_COUNT,
  MAX_TOTAL_ASSET_BYTES,
  assertArtifactAssetBudgets,
} from "../src/artifact-asset-pipeline.js";

describe("input budgets (R3)", () => {
  it("rejects HTML over MAX_HTML_BYTES with ARTIFACT_INVALID_INPUT", async () => {
    const html = `<html><body>${"x".repeat(MAX_HTML_BYTES + 1)}</body></html>`;
    await expect(localizeArtifactAssets({ html })).rejects.toMatchObject({
      code: "ARTIFACT_INVALID_INPUT",
      details: expect.objectContaining({ budget: "MAX_HTML_BYTES" }),
    });
  });

  it("rejects asset count over MAX_ASSET_COUNT with ARTIFACT_INVALID_INPUT", async () => {
    // Each unique data URL becomes a distinct asset file (svg here → 1 file each).
    const imgs = Array.from(
      { length: MAX_ASSET_COUNT + 1 },
      (_, i) => `<img src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg'><text>${i}</text></svg>`)}">`,
    ).join("");
    await expect(localizeArtifactAssets({ html: `<html><body>${imgs}</body></html>` })).rejects.toMatchObject({
      code: "ARTIFACT_INVALID_INPUT",
      details: expect.objectContaining({ budget: "MAX_ASSET_COUNT" }),
    });
  });

  it("rejects total localized asset bytes over MAX_TOTAL_ASSET_BYTES with ARTIFACT_INVALID_INPUT", () => {
    const files = new Map([["assets/too-large.bin", Buffer.alloc(MAX_TOTAL_ASSET_BYTES + 1)]]);
    let error: unknown;

    try {
      assertArtifactAssetBudgets(files);
    } catch (err) {
      error = err;
    }

    expect(error).toMatchObject({
      code: "ARTIFACT_INVALID_INPUT",
      details: expect.objectContaining({ budget: "MAX_TOTAL_ASSET_BYTES" }),
    });
  });

  it("wraps sharp pixel-limit rejection as ARTIFACT_INVALID_INPUT", async () => {
    const png = makePngHeaderWithDimensions(65_000_000, 1);
    const html = `<html><body><img src="data:image/png;base64,${png.toString("base64")}"></body></html>`;

    await expect(localizeArtifactAssets({ html })).rejects.toMatchObject({
      code: "ARTIFACT_INVALID_INPUT",
      details: expect.objectContaining({ budget: "SHARP_PIXEL_LIMIT" }),
    });
  });

  it("accepts a normal-sized page unchanged", async () => {
    const html = `<html><body><p>ok</p></body></html>`;
    const result = await localizeArtifactAssets({ html });
    expect(result.files.size).toBe(0);
  });
});
```

在测试文件 fixtures 区域新增一个小型 PNG 头构造 helper；它只构造带超大 IHDR 尺寸的最小 PNG buffer，不分配真实像素：

```typescript
function makePngHeaderWithDimensions(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", ihdr), pngChunk("IEND", Buffer.alloc(0))]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  // Chunk layout: length(4) + type+data(body) + crc(4) — exactly body.length + 8.
  const chunk = Buffer.alloc(4 + body.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), 4 + body.length);
  return chunk;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
```

追加到 `packages/core/tests/artifact-icon-extraction.test.ts`：

```typescript
it("wraps icon SVG raster pixel-limit rejection as ARTIFACT_INVALID_INPUT", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="9000" aria-label="Huge"><rect width="9000" height="9000"/></svg>`;

  await expect(extractIconAssets(wrapInHtml([svg]), METADATA, { densities: [1] })).rejects.toMatchObject({
    code: "ARTIFACT_INVALID_INPUT",
    details: expect.objectContaining({ budget: "SHARP_PIXEL_LIMIT" }),
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/core/tests/artifact-asset-pipeline.test.ts
```
Expected: FAIL（常量未导出 / 无预算检查）。

- [ ] **Step 3: 实现预算**

`packages/core/src/artifact-asset-pipeline.ts`，在 `// ─── Public types ───` 区块之前加：

```typescript
// ─── Input budgets (R3) ──────────────────────────────────────────────────────
// Enforced at the single entry point all save paths share (design-save →
// localizeArtifactAssets). Constants, not configuration: a generated page that
// exceeds these is a malfunctioning generator, not a use case.

/** Max bytes of input HTML (single generated page). */
export const MAX_HTML_BYTES = 4 * 1024 * 1024; // 4 MiB
/** Max total bytes across all localized asset files of one artifact version. */
export const MAX_TOTAL_ASSET_BYTES = 48 * 1024 * 1024; // 48 MiB
/** Max number of localized asset files in one artifact version. */
export const MAX_ASSET_COUNT = 200;
/** sharp decode ceiling — rejects raster decompression bombs before resize. */
const SHARP_PIXEL_LIMIT = 64_000_000; // ~64 MP
```

在同一区块下面新增可直接单测的预算 helper，并在 `localizeArtifactAssets` return 前调用它：

```typescript
export function assertArtifactAssetBudgets(files: ReadonlyMap<string, Buffer>): void {
  if (files.size > MAX_ASSET_COUNT) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", `Artifact asset count exceeds the ${MAX_ASSET_COUNT} budget`, {
      budget: "MAX_ASSET_COUNT",
      limit: MAX_ASSET_COUNT,
      actual: files.size,
    });
  }
  let totalAssetBytes = 0;
  for (const buf of files.values()) {
    totalAssetBytes += buf.byteLength;
  }
  if (totalAssetBytes > MAX_TOTAL_ASSET_BYTES) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", `Artifact assets exceed the ${MAX_TOTAL_ASSET_BYTES}-byte budget`, {
      budget: "MAX_TOTAL_ASSET_BYTES",
      limit: MAX_TOTAL_ASSET_BYTES,
      actual: totalAssetBytes,
    });
  }
}
```

在 `localizeArtifactAssets` 函数体开头（`const { html, assetDirName = "assets" } = input;` 之后）加：

```typescript
  const htmlBytes = Buffer.byteLength(html, "utf8");
  if (htmlBytes > MAX_HTML_BYTES) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", `HTML exceeds the ${MAX_HTML_BYTES}-byte budget`, {
      budget: "MAX_HTML_BYTES",
      limit: MAX_HTML_BYTES,
      actual: htmlBytes,
    });
  }
```

在 `localizeArtifactAssets` 的 return 之前（函数最后构造 LocalizeResult 处；找到 `return {` 返回 html/files/assets 的位置）调用：

```typescript
  assertArtifactAssetBudgets(ctx.files);
```

- [ ] **Step 4: sharp limitInputPixels + 错误包装**

同文件 `downsampleRaster`（约 :146-183），把两处

```typescript
    const buf = await sharp(master).resize({ width: w2x }).toBuffer();
```
和
```typescript
    const buf = await sharp(master).resize({ width: w1x }).toBuffer();
```

改为调用新 helper（在 `downsampleRaster` 上方定义）：

```typescript
/** Resize one density tier with the decode pixel ceiling; wrap sharp errors. */
async function resizeTier(master: Buffer, width: number): Promise<Buffer> {
  try {
    return await sharp(master, { limitInputPixels: SHARP_PIXEL_LIMIT }).resize({ width }).toBuffer();
  } catch (err) {
    throw new FormaError("ARTIFACT_INVALID_INPUT", "Raster image processing failed", {
      budget: "SHARP_PIXEL_LIMIT",
      cause: String(err),
    });
  }
}
```

两处调用分别为 `const buf = await resizeTier(master, w2x);` 与 `const buf = await resizeTier(master, w1x);`。

`localizeDataUrl` 中（约 :254）：

```typescript
    const meta = await sharp(payload).metadata();
```
改为：
```typescript
    let meta: import("sharp").Metadata;
    try {
      meta = await sharp(payload, { limitInputPixels: SHARP_PIXEL_LIMIT }).metadata();
    } catch (err) {
      throw new FormaError("ARTIFACT_INVALID_INPUT", "Raster image metadata read failed", {
        budget: "SHARP_PIXEL_LIMIT",
        cause: String(err),
      });
    }
```

`packages/core/src/artifact-icon-extraction.ts`：在该文件新增同值常量（或从共享 raster-limit helper 引入，若实现时选择拆 helper）：

```typescript
const SHARP_PIXEL_LIMIT = 64_000_000; // ~64 MP
```

将 icon PNG 生成处：

```typescript
          pngBuf = await sharp(svgBuf, { density: 96 * density })
```

改为：

```typescript
          pngBuf = await sharp(svgBuf, { density: 96 * density, limitInputPixels: SHARP_PIXEL_LIMIT })
```

并在 catch 的 `FormaError` details 中加入 `budget: "SHARP_PIXEL_LIMIT"`：

```typescript
            { index: i, budget: "SHARP_PIXEL_LIMIT", sharpError: e instanceof Error ? e.message : String(e) },
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run packages/core/tests/artifact-asset-pipeline.test.ts packages/core/tests/artifact-icon-extraction.test.ts packages/core/tests/design-save.test.ts
```
Expected: PASS（design-save 正常尺寸输入不受影响）。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/artifact-asset-pipeline.ts packages/core/src/artifact-icon-extraction.ts packages/core/tests/artifact-asset-pipeline.test.ts packages/core/tests/artifact-icon-extraction.test.ts
git commit -m "feat(core): enforce HTML/asset budgets and sharp pixel limit at save entry (R3)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: R2 — product ID 碰撞防护与孤儿安全清理

**Files:**
- Modify: `packages/core/src/errors.ts`（新增 error code）
- Modify: `packages/core/src/product.ts:160-178`（createProductLocked + allocateProductId）
- Create: `packages/core/tests/product-create-collision.test.ts`

**背景：** 当前 `createProductLocked` 不检查 ID 占用，碰撞时 `writeYamlAtomic` 静默覆盖既有 `product.yaml`（数据丢失）；index 写失败留下孤儿文件。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/tests/product-create-collision.test.ts`：

```typescript
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/ids.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ids.js")>();
  return { ...actual, createId: vi.fn(actual.createId) };
});
vi.mock("../src/yaml.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/yaml.js")>();
  return { ...actual, writeYamlAtomic: vi.fn(actual.writeYamlAtomic) };
});

import { createId } from "../src/ids.js";
import { writeYamlAtomic } from "../src/yaml.js";
import { ProductService } from "../src/product.js";

const homes: string[] = [];

afterEach(async () => {
  vi.mocked(createId).mockReset();
  const actualIds = await vi.importActual<typeof import("../src/ids.js")>("../src/ids.js");
  vi.mocked(createId).mockImplementation(actualIds.createId);
  const actualYaml = await vi.importActual<typeof import("../src/yaml.js")>("../src/yaml.js");
  vi.mocked(writeYamlAtomic).mockReset();
  vi.mocked(writeYamlAtomic).mockImplementation(actualYaml.writeYamlAtomic);
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function testHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "forma-product-collision-"));
  homes.push(home);
  return home;
}

describe("createProduct collision safety (R2)", () => {
  it("retries on an indexed-id collision and leaves the original product untouched", async () => {
    const home = await testHome();
    const products = new ProductService({ home });
    const first = await products.createProduct({ name: "First", description: "d1" });

    const actualIds = await vi.importActual<typeof import("../src/ids.js")>("../src/ids.js");
    vi.mocked(createId)
      .mockReturnValueOnce(first.id) // collide once
      .mockImplementation(actualIds.createId);

    const before = await readFile(join(home, "data", first.id, "product.yaml"), "utf8");
    const second = await products.createProduct({ name: "Second", description: "d2" });

    expect(second.id).not.toBe(first.id);
    const after = await readFile(join(home, "data", first.id, "product.yaml"), "utf8");
    expect(after).toBe(before);
  });

  it("treats a non-indexed orphan product dir as occupied and never writes into it", async () => {
    const home = await testHome();
    const products = new ProductService({ home });
    const orphanId = "P-0ffffe";
    await mkdir(join(home, "data", orphanId), { recursive: true });
    await writeFile(join(home, "data", orphanId, "stray.txt"), "do not touch", "utf8");

    const actualIds = await vi.importActual<typeof import("../src/ids.js")>("../src/ids.js");
    vi.mocked(createId)
      .mockReturnValueOnce(orphanId)
      .mockImplementation(actualIds.createId);

    const created = await products.createProduct({ name: "P", description: "d" });

    expect(created.id).not.toBe(orphanId);
    await expect(readFile(join(home, "data", orphanId, "stray.txt"), "utf8")).resolves.toBe("do not touch");
    await expect(access(join(home, "data", orphanId, "product.yaml"))).rejects.toThrow();
  });

  it("throws PRODUCT_ID_ALLOCATION_FAILED after exhausting retries", async () => {
    const home = await testHome();
    const products = new ProductService({ home });
    const first = await products.createProduct({ name: "First", description: "d1" });

    vi.mocked(createId).mockReturnValue(first.id); // collide forever

    await expect(products.createProduct({ name: "Second", description: "d2" })).rejects.toMatchObject({
      code: "PRODUCT_ID_ALLOCATION_FAILED",
    });
  });

  it("cleans up the just-written product file when the index write fails, preserving foreign content", async () => {
    const home = await testHome();
    const products = new ProductService({ home });
    const actualYaml = await vi.importActual<typeof import("../src/yaml.js")>("../src/yaml.js");

    vi.mocked(writeYamlAtomic).mockImplementation(async (file: string, value: unknown) => {
      if (file.endsWith("products.yaml")) {
        throw new Error("index write failed");
      }
      return actualYaml.writeYamlAtomic(file, value);
    });

    await expect(products.createProduct({ name: "P", description: "d" })).rejects.toThrow("index write failed");

    // No orphan product.yaml under data/ for the failed create
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(join(home, "data"), { withFileTypes: true }).catch(() => []);
    const productDirs = entries.filter((e) => e.isDirectory() && /^P-[a-f0-9]{6}$/.test(e.name));
    expect(productDirs).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/core/tests/product-create-collision.test.ts
```
Expected: FAIL（碰撞时覆盖、孤儿目录被写入、无重试 code、孤儿不清理）。

- [ ] **Step 3: 加 error code**

`packages/core/src/errors.ts` 的 `FormaErrorCode` union 中（`"PRODUCT_NOT_FOUND"` 一行之后）加：

```typescript
  | "PRODUCT_ID_ALLOCATION_FAILED"
```

- [ ] **Step 4: 实现 createProductLocked**

`packages/core/src/product.ts`：

imports 首行 `import { access, readFile } from "node:fs/promises";` 改为：

```typescript
import { access, readFile, rm, rmdir } from "node:fs/promises";
```

`createProductLocked`（:164-178）整体替换为：

```typescript
  async createProductLocked(input: { name: string; description: string }): Promise<Product> {
    const index = await this.readProductIndex();
    const id = await this.allocateProductId(index.products);
    const product = productSchema.parse({
      id,
      name: input.name,
      description: input.description,
    });

    await writeYamlAtomic(this.productFile(product.id), product);
    try {
      await writeYamlAtomic(this.indexFile, {
        products: [...index.products, productIndexEntrySchema.parse(product)],
      });
    } catch (error) {
      // Best-effort cleanup of the file written above. rmdir only removes the
      // directory when it is empty, so pre-existing foreign content survives.
      // Never mask the original error.
      await rm(this.productFile(product.id), { force: true }).catch(() => undefined);
      await rmdir(join(this.dataDir, product.id)).catch(() => undefined);
      throw error;
    }

    return product;
  }

  /**
   * Allocate a product id that is free in the index AND on disk. A bare
   * data/<id>/ directory (orphaned requirement data) also counts as occupied —
   * writing into it would silently adopt foreign state.
   */
  private async allocateProductId(existing: ProductIndexEntry[]): Promise<string> {
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const id = createId("product");
      if (existing.some((product) => product.id === id)) continue;
      if (await fileExists(join(this.dataDir, id))) continue;
      return id;
    }
    throw new FormaError("PRODUCT_ID_ALLOCATION_FAILED", "Failed to allocate a unique product id", {
      attempts: MAX_ATTEMPTS,
    });
  }
```

（`fileExists` 为该文件底部既有私有 helper（:386），对目录同样有效；`ProductIndexEntry` 类型已在该文件定义。）

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run packages/core/tests/product-create-collision.test.ts
npx vitest run packages/core/tests/product-config.test.ts packages/core/tests/product-design-pointer.test.ts packages/core/tests/product-mutation-lock.test.ts packages/core/tests/product-pen-compat.test.ts packages/core/tests/product-session-style.test.ts
```
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/errors.ts packages/core/src/product.ts packages/core/tests/product-create-collision.test.ts
git commit -m "fix(core): retry product id collisions and clean up failed creates (R2)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: R6 — mutation origin 日志走 Fastify logger

**Files:**
- Modify: `packages/server/src/routes.ts:197-205`

- [ ] **Step 1: 实现**

`packages/server/src/routes.ts` 的 `checkMutationOrigin` 中，将：

```typescript
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      route: request.url,
      origin: originStr ?? null,
      "x-forma-client": formaClientStr,
      allowed,
    }),
  );
```

改为（timestamp 由 logger 提供，不再手写；不记录 token/路径/用户内容）：

```typescript
  request.log.info(
    {
      origin: originStr ?? null,
      formaClient: formaClientStr,
      allowed,
    },
    "mutation origin check",
  );
```

- [ ] **Step 2: 验证**

```bash
grep -rn "console\.log" packages/server/src ; echo "exit=$?"
npx vitest run packages/server/tests/routes.test.ts
```
Expected: grep 无结果（exit=1）；测试 PASS。

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes.ts
git commit -m "refactor(server): route mutation-origin audit log through request.log (R6)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: R5 — `/api/health` 端点 + desktop 探活切换

**Files:**
- Modify: `packages/server/src/routes.ts`（registerRoutes 顶部加路由）
- Modify: `packages/desktop/src/main/index.ts:89-95`（serverStatus）
- Test: `packages/server/tests/routes.test.ts`、`packages/desktop/src/main/index.test.ts`（各追加）

- [ ] **Step 1: 写失败测试（server）**

`packages/server/tests/routes.test.ts` 末尾追加：

```typescript
describe("GET /api/health (R5)", () => {
  it("returns ok without touching the store", async () => {
    const app = await buildServer({ store: fakeStore() });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("is bearer-protected like every other /api route when a token is set", async () => {
    const app = await buildServer({ store: fakeStore(), authToken: "secret" });
    apps.push(app);
    const denied = await app.inject({ method: "GET", url: "/api/health" });
    expect(denied.statusCode).toBe(401);
    const allowed = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { authorization: "Bearer secret" },
    });
    expect(allowed.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: 写失败测试（desktop）**

`packages/desktop/src/main/index.test.ts` 的 `describe("createFormaHttpClient", ...)` 内追加：

```typescript
  it("serverStatus probes /api/health", async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    const { createFormaHttpClient } = await import("./index.js");
    const client = createFormaHttpClient({ baseUrl: "http://127.0.0.1:3000", fetchFn: fetchFn as typeof fetch });

    await expect(client.serverStatus()).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:3000/api/health");
  });
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run packages/server/tests/routes.test.ts packages/desktop/src/main/index.test.ts
```
Expected: 新用例 FAIL（health 404；desktop 仍打 /api/products）。

- [ ] **Step 4: 实现**

`packages/server/src/routes.ts` `registerRoutes` 函数体内、`// ─── Product routes ───` 注释之前加：

```typescript
  // ─── Health ────────────────────────────────────────────────────────────────
  // Read-only liveness probe: no disk I/O, no store access. Sits under /api so
  // the bearer-auth hook applies uniformly (no auth exception).
  app.get("/api/health", async () => ({ status: "ok" }));
```

`packages/desktop/src/main/index.ts` `serverStatus` 中，将：

```typescript
        const response = await fetchFn(`${baseUrl}/api/products`);
```
改为：
```typescript
        const response = await fetchFn(`${baseUrl}/api/health`);
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run packages/server/tests/routes.test.ts packages/desktop/src/main/index.test.ts
```
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes.ts packages/desktop/src/main/index.ts packages/server/tests/routes.test.ts packages/desktop/src/main/index.test.ts
git commit -m "feat(server): add read-only /api/health and switch desktop liveness probe to it (R5)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: R1 — serve token 暴露面收敛

**Files:**
- Modify: `packages/cli/src/index.ts`（4 处：spawn argv、parseForegroundServeArgs、defaultVerifyServerProcess、writeText mode+chmod）
- Modify: `packages/cli/tests/cli.test.ts`（foreground 用例、formaServerCommandLine helper、新增 0600/ps/loose-mode 用例）

**边界（来自需求文档 R1）：** `FORMA_SERVE_TOKEN` 仅作 CLI 托管进程归属 token；API Bearer 仍只由 `FORMA_SERVER_TOKEN` 控制，本任务不触碰后者。

- [ ] **Step 1: 更新现有测试 + 写新失败测试**

`packages/cli/tests/cli.test.ts`：

1. 两个 foreground 用例（约 :168-211）的 runCli 参数数组中删除两行 `"--serve-token",` `"child-token",`（token 现在只走 env；这两个用例不依赖 token——runtime 写入由 `FORMA_SERVE_READY_FILE` 门控，测试中未设置）。

2. `formaServerCommandLine` helper（:688-701）中删除两行 `"--serve-token",` 与 `options.token,`，并加注释：

```typescript
// R1: the managed serve child no longer receives the token via argv — it is
// delivered through FORMA_SERVE_TOKEN env only and must not appear in `ps`.
```

把 helper 形参改为 `{ home: string; startedAt: string }`，并删除调用方的 `token` 实参；这是 ps/argv 断言的共同 helper。

3. 新增/调整用例（放在 serve describe 块内）：

```typescript
  it("serve start writes pid state with 0600 permissions and tightens an existing loose file", async () => {
    const { chmod, stat, writeFile: fsWriteFile, mkdir: fsMkdir } = await import("node:fs/promises");
    const home = await mkdtemp();
    const formaHome = join(home, ".forma");
    await fsMkdir(formaHome, { recursive: true });

    const metadata = {
      schema_version: 1,
      marker: "xenonbyte.forma.serve",
      home: formaHome,
      pid: 4242,
      token: "perm-token",
      started_at: "2026-05-17T00:00:00.000Z",
      log: join(formaHome, "serve.log"),
    };

    // Minimal CliEnv: writeText is NOT overridden so the production default
    // (0600 mode) is what actually writes serve.pid.
    const result = await runCli(["serve", "start"], {
      formaHome,
      currentPid: 1111,
      now: () => new Date("2026-05-17T00:00:00.000Z"),
      createServeToken: () => "perm-token",
      isPidAlive: (pid) => pid === 4242,
      verifyServerProcess: async () => true,
      spawnDetachedServer: async (options) => {
        await fsWriteFile(join(formaHome, "serve.pid"), "loose stale state", { encoding: "utf8", mode: 0o644 });
        await chmod(join(formaHome, "serve.pid"), 0o644);
        await fsWriteFile(options.runtimeFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
        return { pid: 4242 };
      },
    });

    expect(result.exitCode).toBe(0);
    const pidStat = await stat(join(formaHome, "serve.pid"));
    expect(pidStat.mode & 0o777).toBe(0o600);
  });

  it("foreground internal writes runtime state with 0600 permissions and receives token from env only", async () => {
    const { chmod, stat, writeFile: fsWriteFile } = await import("node:fs/promises");
    const env = await testEnv({
      currentPid: 7777,
      startWebServer: async () => undefined,
      useDefaultStartServer: true,
    });
    const runtimeFile = join(env.state.formaHome, "serve.state.json");
    await fsWriteFile(runtimeFile, "loose stale runtime", { encoding: "utf8", mode: 0o644 });
    await chmod(runtimeFile, 0o644);
    process.env.FORMA_SERVE_TOKEN = "child-token";
    process.env.FORMA_SERVE_READY_FILE = runtimeFile;
    process.env.FORMA_SERVE_STARTED_AT = "2026-05-17T00:00:00.000Z";
    process.env.FORMA_SERVE_LOG_FILE = join(env.state.formaHome, "serve.log");
    try {
      const result = await runCli(
        [
          "serve",
          "--foreground-internal",
          "--serve-home",
          env.state.formaHome,
          "--serve-started-at",
          "2026-05-17T00:00:00.000Z",
        ],
        env,
      );

      expect(result.exitCode).toBe(0);
      const runtimeStat = await stat(runtimeFile);
      expect(runtimeStat.mode & 0o777).toBe(0o600);
      await expect(readFile(runtimeFile, "utf8").then(JSON.parse)).resolves.toMatchObject({
        pid: 7777,
        token: "child-token",
      });
    } finally {
      delete process.env.FORMA_SERVE_TOKEN;
      delete process.env.FORMA_SERVE_READY_FILE;
      delete process.env.FORMA_SERVE_STARTED_AT;
      delete process.env.FORMA_SERVE_LOG_FILE;
    }
  });

  it("verifies owned children without exposing the token in the process command", async () => {
    const startedAt = "2026-05-17T00:00:00.000Z";
    let observedCommand = "";
    let env: CliEnv & { state: TestState };
    env = await testEnv({
      useDefaultServerStatus: true,
      useDefaultVerifyServerProcess: true,
      isPidAlive: (pid) => pid === 4321,
      readProcessCommand: async () => {
        observedCommand = formaServerCommandLine({ home: env.state.formaHome, startedAt });
        return observedCommand;
      },
    });
    await mkdir(env.state.formaHome, { recursive: true });
    const metadata = serveMetadata({
      home: env.state.formaHome,
      pid: 4321,
      token: "owned-token",
      started_at: startedAt,
      log: join(env.state.formaHome, "serve.log"),
    });
    await writeFile(join(env.state.formaHome, "serve.pid"), JSON.stringify(metadata), "utf8");
    await writeFile(join(env.state.formaHome, "serve.state.json"), JSON.stringify(metadata), "utf8");

    const status = await runCli(["status"], env);

    expect(status.stdout).toContain("Web server: running");
    expect(observedCommand).not.toContain("owned-token");
    expect(observedCommand).not.toContain("--serve-token");
  });
```

（`mkdtemp`/`join`/`runCli` 已在文件内可用。`started_at` 必须与 `now()` 一致，否则 readiness 校验 metadata 不匹配。）

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/cli/tests/cli.test.ts
```
Expected: 新 0600/ps/loose-mode 用例 FAIL（默认 writeFile 无 mode、既有 loose 文件不会 chmod、foreground runtime state 无 0600、默认 ownership 校验仍要求命令行 token）；foreground 用例 FAIL（`--serve-token` 已从参数移除但 parse 仍要求/或 parse 报 unexpected——以实际输出为准，进入 Step 3 修复）。

- [ ] **Step 3: 实现（packages/cli/src/index.ts 四处）**

1. `defaultSpawnDetachedServer`（:863-916）argv 数组中删除两行：

```typescript
        "--serve-token",
        options.token,
```

（env 中的 `FORMA_SERVE_TOKEN: options.token` 保留——这是唯一的 token 通道。）

2. `parseForegroundServeArgs`（:381-406）：删除 `--serve-token` 分支，返回类型与 options 对象去掉 `token` 字段：

```typescript
function parseForegroundServeArgs(args: string[]): { home?: string; startedAt?: string } {
  const options: { home?: string; startedAt?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--serve-home") {
      options.home = requireOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--serve-started-at") {
      options.startedAt = requireOptionValue(args, index, arg);
      if (!Number.isFinite(Date.parse(options.startedAt))) {
        throw new Error("Invalid value for --serve-started-at");
      }
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  return options;
}
```

对应地，`runForegroundServeChild`（:333-353）首两行：

```typescript
  const options = parseForegroundServeArgs(args);
  const token = options.token ?? process.env.FORMA_SERVE_TOKEN;
```
改为：
```typescript
  const options = parseForegroundServeArgs(args);
  // R1: the ownership token arrives via env only — never via argv (visible in `ps`).
  const token = process.env.FORMA_SERVE_TOKEN;
```

3. `defaultVerifyServerProcess`（:1015-1030）：删除 token 匹配行，归属强校验由 0600 state 文件中的随机 token 承担：

```typescript
async function defaultVerifyServerProcess(
  metadata: ServeMetadata,
  readProcessCommand: (pid: number) => Promise<string>,
): Promise<boolean> {
  try {
    const command = await readProcessCommand(metadata.pid);
    // The token is deliberately NOT matched here: it must never appear in the
    // process command line. Strong ownership comes from the random token in
    // the 0600 serve state files; this check pins entrypoint + home + start.
    return (
      commandIncludesArgs(command, [packageCliEntrypoint(), "serve", "--foreground-internal"]) &&
      commandIncludesArgPair(command, "--serve-home", metadata.home) &&
      commandIncludesArgPair(command, "--serve-started-at", metadata.started_at)
    );
  } catch {
    return false;
  }
}
```

4. 顶部 `node:fs/promises` import 加 `chmod`，然后把 `resolveCliEnv` 中 writeText 默认实现（:522-527）改为 write + chmod：

```typescript
    writeText:
      env.writeText ??
      (async (file, content) => {
        await mkdir(dirname(file), { recursive: true });
        // Serve state files carry the ownership token — owner-only by default.
        await writeFile(file, content, { encoding: "utf8", mode: 0o600 });
        // mode is only applied on creation; chmod tightens existing loose files.
        await chmod(file, 0o600);
      }),
```

- [ ] **Step 4: 跑测试确认通过 + 全 grep 验证**

```bash
npx vitest run packages/cli/tests/cli.test.ts
grep -rn '"--serve-token"' packages/cli/src ; echo "src-exit=$?"
```
Expected: 测试全 PASS；grep 无结果（src-exit=1）。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/tests/cli.test.ts
git commit -m "fix(cli): keep serve token out of argv/ps, 0600 state files (R1)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: R7 — 静态校验器恶意输入回归测试 + 校验器加固

**Files:**
- Modify: `packages/core/src/artifact-static-validation.ts`（4 处加固，含 image-set 全候选扫描）
- Modify: `packages/core/tests/artifact-static-validation.test.ts`（追加安全回归组）

**已知校验器缺口（核对源码确认）：** ① 无 meta refresh 规则；② `scanSvg` 不查 iframe/object/embed/foreignObject；③ `scanCssText` 只匹配 `url(...)`，漏 `image-set("...")` 裸字符串，且必须检查同一个 image-set 内的每个候选；④ `isJavascriptUrl` 不抗实体/控制字符混淆。`srcdoc`（iframe 整体被拒）与 `@font-face src url(...)`（url() 已覆盖）预期现状即通过。

- [ ] **Step 1: 写安全回归测试（部分会失败）**

`packages/core/tests/artifact-static-validation.test.ts` 末尾追加：

```typescript
// ─── Security regression suite (R7) ──────────────────────────────────────────
// These vectors are the safety precondition for no-sandbox Puppeteer rendering
// and CSP-less iframe embedding. Removing or weakening any case requires a
// security review (see docs/hardening-requirements.md R7).
describe("static validator security regressions (R7)", () => {
  function expectRejected(result: ReturnType<typeof validateStaticArtifact>, fragment: string) {
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.join("\n")).toContain(fragment);
    }
  }

  it("rejects <meta http-equiv=refresh>", () => {
    const result = validateStaticArtifact({
      html: `<html><head><meta http-equiv="REFRESH" content="0;url=https://evil.example"></head><body></body></html>`,
    });
    expectRejected(result, "refresh");
  });

  it("rejects iframe srcdoc (covered by the iframe rule)", () => {
    const result = validateStaticArtifact({
      html: `<html><body><iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe></body></html>`,
    });
    expectRejected(result, "<iframe>");
  });

  it("rejects foreignObject inside SVG files", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>html island</div></foreignObject></svg>`;
    const result = validateStaticArtifact({ html: "<html><body></body></html>", svgFiles: new Map([["a.svg", svg]]) });
    expectRejected(result, "foreignobject");
  });

  it("rejects iframe smuggled into an SVG file", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><iframe src="x"></iframe></svg>`;
    const result = validateStaticArtifact({ html: "<html><body></body></html>", svgFiles: new Map([["a.svg", svg]]) });
    expectRejected(result, "<iframe>");
  });

  it("rejects javascript: in SVG animate to/from/values", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" to="javascript:alert(1)"/></a></svg>`;
    const result = validateStaticArtifact({ html: "<html><body></body></html>", svgFiles: new Map([["a.svg", svg]]) });
    expectRejected(result, "javascript:");
  });

  it("rejects javascript: in a later SVG animate values entry", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="#safe;javascript:alert(1)"/></a></svg>`;
    const result = validateStaticArtifact({ html: "<html><body></body></html>", svgFiles: new Map([["a.svg", svg]]) });
    expectRejected(result, "javascript:");
  });

  it("rejects remote URLs inside CSS image-set()", () => {
    const result = validateStaticArtifact({
      html: `<html><head><style>.x { background: image-set("https://evil.example/a.png" 1x); }</style></head><body></body></html>`,
    });
    expectRejected(result, "image-set");
  });

  it("rejects remote URLs in later CSS image-set() candidates", () => {
    const result = validateStaticArtifact({
      html: `<html><head><style>.x { background: image-set("/safe.png" 1x, "https://evil.example/a.png" 2x); }</style></head><body></body></html>`,
    });
    expectRejected(result, "image-set");
  });

  it("rejects remote @font-face src (existing url() rule)", () => {
    const result = validateStaticArtifact({
      html: `<html><head><style>@font-face { font-family: x; src: url(https://evil.example/f.woff2); }</style></head><body></body></html>`,
    });
    expectRejected(result, "Remote CSS url()");
  });

  it("rejects whitespace-obfuscated javascript: URLs", () => {
    const result = validateStaticArtifact({
      html: `<html><body><a href="java\tscript:alert(1)">x</a></body></html>`,
    });
    expectRejected(result, "javascript:");
  });

  it("rejects numeric-entity-obfuscated javascript: URLs", () => {
    const result = validateStaticArtifact({
      html: `<html><body><a href="&#106;avascript:alert(1)">x</a></body></html>`,
    });
    expectRejected(result, "javascript:");
  });
});
```

- [ ] **Step 2: 跑测试，记录哪些向量漏放**

```bash
npx vitest run packages/core/tests/artifact-static-validation.test.ts
```
Expected: meta refresh / foreignObject / SVG iframe / animate / image-set / 混淆 javascript: 这些用例 FAIL；srcdoc 与 @font-face 用例 PASS。

- [ ] **Step 3: 加固校验器（packages/core/src/artifact-static-validation.ts）**

1. `isJavascriptUrl`（:30-32）替换为：

```typescript
/**
 * Returns true when the value resolves to a javascript: URL. Decodes numeric
 * HTML entities and strips control/space characters first — browsers do both
 * before scheme resolution, so plain prefix matching is bypassable.
 */
function isJavascriptUrl(value: string): boolean {
  const decoded = value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => safeCodePoint(Number(dec)));
  const normalized = decoded.replace(/[\u0000-\u0020]/g, "").toLowerCase();
  return normalized.startsWith("javascript:");
}

function safeCodePoint(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}
```

2. `scanCssText` 中 `@import` 扫描之后、`return violations;` 之前加：

```typescript
  // image-set("…") / -webkit-image-set("…") carry bare string URLs that the
  // url() pattern above never sees. Check every quoted candidate in the list,
  // not only the first one.
  const imageSetPattern = /(?:-webkit-)?image-set\s*\(([^)]*)\)/gi;
  while ((m = imageSetPattern.exec(cssText)) !== null) {
    const imageSetBody = m[1];
    const quotedUrlPattern = /(['"])((?:https?:|data:|\/\/)[^'"]+)\1/gi;
    let q: RegExpExecArray | null;
    while ((q = quotedUrlPattern.exec(imageSetBody)) !== null) {
      const inner = q[2].trim();
      if (isRemoteUrl(inner)) {
        violations.push(`Remote image-set() reference in ${source}: ${inner}`);
      } else if (isDataUrl(inner)) {
        violations.push(`Residual data: image-set() in ${source}: ${inner.slice(0, 64)}`);
      }
    }
  }
```

3. `scanParsedTree` 中 link 扫描（Rule 4）之后加：

```typescript
  // Rule 10: <meta http-equiv="refresh"> can navigate the embedding document.
  for (const el of root.querySelectorAll("meta")) {
    const httpEquiv = (el.getAttribute("http-equiv") ?? "").trim().toLowerCase();
    if (httpEquiv === "refresh") {
      violations.push(`<meta http-equiv="refresh"> found in ${context}`);
    }
  }
```

4. `scanSvg` 的 per-element 循环内（`const tag = ...` 之后）加：

```typescript
    // Embedded-content elements have no place in a localized SVG asset.
    if (tag === "iframe" || tag === "object" || tag === "embed" || tag === "foreignobject") {
      violations.push(`<${tag}> element in SVG file "${path}"`);
    }

    // SMIL animation can write href-class attributes — scan animation values.
    if (tag === "animate" || tag === "set" || tag === "animatemotion" || tag === "animatetransform") {
      for (const attr of ["to", "from", "by", "values"]) {
        const val = el.getAttribute(attr);
        if (!val) continue;
        const candidates = attr === "values" ? val.split(";") : [val];
        for (const candidate of candidates) {
          if (isJavascriptUrl(candidate.trim())) {
            violations.push(`javascript: URL in ${attr} on <${tag}> in SVG file "${path}"`);
          }
        }
      }
    }
```

- [ ] **Step 4: 跑测试确认全过 + 既有套件回归**

```bash
npx vitest run packages/core/tests/artifact-static-validation.test.ts packages/core/tests/design-save.test.ts
```
Expected: 全 PASS。若既有用例因新规则误伤（例如正常页面含无害 meta），按"现状即合法输出"原则调整规则精度而非放宽测试——meta 规则只匹配 `http-equiv="refresh"`，不应误伤。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/artifact-static-validation.ts packages/core/tests/artifact-static-validation.test.ts
git commit -m "feat(core): harden static validator against refresh/SVG-embed/image-set/obfuscated-js vectors (R7)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: R11 — preview-renderer 默认启用 Chromium sandbox（对齐 vzi-parser 模式）

**Files:**
- Modify: `packages/core/src/preview-renderer.ts`
- Modify: `packages/core/tests/preview-renderer.test.ts`（追加 launch-args 用例）
- Create: `packages/core/tests/design-save-preview-failure.test.ts`

- [ ] **Step 1: 写失败测试（launch args）**

`packages/core/tests/preview-renderer.test.ts` 追加：

```typescript
import { previewChromiumLaunchArgs } from "../src/preview-renderer.js";

describe("preview chromium launch args (R11)", () => {
  it("keeps the Chromium sandbox by default outside test/CI fallback", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", "");
    vi.stubEnv("FORMA_PREVIEW_ALLOW_NO_SANDBOX", "");
    try {
      expect(previewChromiumLaunchArgs()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("drops the sandbox only under the explicit fallback gates", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", "");
    vi.stubEnv("FORMA_PREVIEW_ALLOW_NO_SANDBOX", "1");
    try {
      expect(previewChromiumLaunchArgs()).toEqual(["--no-sandbox", "--disable-setuid-sandbox"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
```

（该文件若未 import `vi`，在顶部 vitest import 中补上。）

- [ ] **Step 2: 写失败测试（preview 失败非致命，钉住）**

创建 `packages/core/tests/design-save-preview-failure.test.ts`：

```typescript
/**
 * Pins the R11 safety property: if the sandboxed Chromium launch fails on an
 * exotic environment, the save still succeeds with previewStatus "failed".
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/preview-renderer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/preview-renderer.js")>();
  return {
    ...actual,
    renderArtifactPreview: vi.fn(async () => {
      throw new Error("chromium sandbox launch failed");
    }),
  };
});

import { saveDesignArtifact } from "../src/design-save.js";
import { createFormaStore } from "../src/store.js";
import { getFormaPaths } from "../src/paths.js";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("design save when preview rendering fails (R11)", () => {
  it("persists the artifact with previewStatus failed", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-preview-fail-"));
    homes.push(home);
    const store = await createFormaStore({ home });

    const result = await saveDesignArtifact(
      { artifacts: store.artifacts, products: store.products, productsRoot: getFormaPaths(home).productsDir },
      {
        productId: "P-0abc12",
        kind: "component-library",
        html: "<html><body><p>ok</p></body></html>",
        title: "Components",
        forma: {},
      },
    );

    expect(result.previewStatus).toBe("failed");
    expect(result.version).toBe(1);
    expect(result.artifactId).toMatch(/^[a-zA-Z0-9]{16}$/);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run packages/core/tests/preview-renderer.test.ts packages/core/tests/design-save-preview-failure.test.ts
```
Expected: launch-args 用例 FAIL（`previewChromiumLaunchArgs` 未导出）；preview-failure 用例应 PASS（既有逻辑已非致命——若 FAIL 则说明现状理解有误，停下排查再继续）。

- [ ] **Step 4: 实现**

`packages/core/src/preview-renderer.ts`，在 `const RELEVANT_RESOURCE_TYPES` 之后加：

```typescript
/**
 * R11: keep the Chromium OS sandbox by default — generated HTML is validated
 * but still untrusted. Mirror the vzi-parser fallback gates so tests/CI (and
 * an explicit local escape hatch) can run where the sandbox is unavailable.
 * Preview failure is non-fatal: design saves complete with previewStatus
 * "failed" (design-save.ts), so a sandbox-incompatible host degrades safely.
 */
export function previewChromiumLaunchArgs(): string[] {
  const allowNoSandbox =
    process.env.FORMA_PREVIEW_ALLOW_NO_SANDBOX === "1" ||
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true";
  return allowNoSandbox ? ["--no-sandbox", "--disable-setuid-sandbox"] : [];
}
```

launch 行（:40）：

```typescript
    browser = await launch({ headless: "shell", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
```
改为：
```typescript
    browser = await launch({ headless: "shell", args: previewChromiumLaunchArgs() });
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run packages/core/tests/preview-renderer.test.ts packages/core/tests/design-save-preview-failure.test.ts packages/core/tests/design-save.test.ts
```
Expected: 全 PASS（vitest 环境下 fallback 生效，真实渲染用例不受影响）。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/preview-renderer.ts packages/core/tests/preview-renderer.test.ts packages/core/tests/design-save-preview-failure.test.ts
git commit -m "feat(core): default preview renderer to sandboxed Chromium with explicit fallback gates (R11)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: F3(server) — artifact 详情响应增加 versions / current_version，列表增加 version_count

**Files:**
- Modify: `packages/server/src/routes.ts`（artifact 列表 version_count + 详情 versions/current_version）
- Test: `packages/server/tests/routes.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

`packages/server/tests/routes.test.ts` 追加：

```typescript
describe("artifact detail versions (F3)", () => {
  it("returns the sorted version list and current_version", async () => {
    const store = fakeStore();
    (store.artifacts.listArtifactVersions as ReturnType<typeof vi.fn>).mockResolvedValue([3, 1, 2]);
    const app = await buildServer({ store });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-0abc12/artifacts/A-abcdef1234567890",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.versions).toEqual([1, 2, 3]);
    expect(body.current_version).toBe(3);
  });

  it("includes version_count in artifact list summaries", async () => {
    const store = fakeStore();
    (store.artifacts.listArtifactVersions as ReturnType<typeof vi.fn>).mockResolvedValue([1, 2]);
    const app = await buildServer({ store });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/products/P-0abc12/artifacts",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.artifacts[0]).toEqual(expect.objectContaining({ version_count: 2 }));
  });
});
```

（fakeStore 的 `listArtifactVersions` 是 `vi.fn(async () => [])`，可直接 mock。若该 URL 在 fakeStore 下需要 pointer 数据，参照同文件既有 artifact 详情用例的 store 构造方式对齐 product/pointer mock——以既有用例为准。）

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/server/tests/routes.test.ts
```
Expected: 新用例 FAIL（详情响应无 versions 字段，列表响应无 version_count 字段）。

- [ ] **Step 3: 实现**

`packages/server/src/routes.ts` artifact 列表路由中，在构造 `artifacts.push({ ... })` 之前取版本列表：

```typescript
        const versions = [...(await store.artifacts.listArtifactVersions(pid, artifactId))].sort((a, b) => a - b);
```

并在 summary payload 中加入：

```typescript
          ...(versions.length > 0 ? { version_count: versions.length } : {}),
```

`packages/server/src/routes.ts` artifact 详情路由整体替换为：

```typescript
  // SPEC-IF-HTTP-002: get artifact manifest
  app.get<{ Params: { pid: string; aid: string } }>("/api/products/:pid/artifacts/:aid", async (request, reply) => {
    const { pid, aid } = request.params;
    const { pointerVersions } = await loadArtifactPointers(store, pid);
    const { manifest, etag } = await resolveCurrentArtifact(store, pid, aid, pointerVersions);
    // F3: expose the immutable version list so the web compare view can pick
    // any two versions; current_version mirrors the pointer (or latest).
    const versions = [...(await store.artifacts.listArtifactVersions(pid, aid))].sort((a, b) => a - b);
    const currentVersion = pointerVersions.get(aid) ?? (versions.length > 0 ? versions[versions.length - 1] : undefined);
    reply.header("ETag", etag);
    reply.header("Cache-Control", "private, max-age=300");
    return {
      manifest,
      supportingFiles: manifest.supportingFiles ?? [],
      preview_url: artifactPreviewUrl(pid, aid, "2x"),
      versions,
      ...(currentVersion !== undefined ? { current_version: currentVersion } : {}),
    };
  });
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/server/tests/routes.test.ts
```
Expected: 全 PASS（既有 artifact 详情用例为加法字段，不受影响）。

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes.ts packages/server/tests/routes.test.ts
git commit -m "feat(server): expose artifact version metadata for compare (F3)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: F3(web) — 版本对比视图

**Files:**
- Modify: `packages/web/src/api.ts`（ArtifactSummary.version_count + ArtifactDetail 字段 + getArtifactVersionPreviewUrl）
- Create: `packages/web/src/pages/VersionCompare.tsx`
- Create: `packages/web/src/pages/VersionCompare.test.tsx`
- Modify: `packages/web/src/routes.tsx`（新路由）
- Modify: `packages/web/src/pages/DesignView.tsx`（对比入口）
- Modify: `packages/web/src/i18n.ts`（en + zh 各 6 个 key）
- Test: `packages/web/src/routes.test.ts`、`packages/web/src/pages/DesignView.test.tsx`（追加）

- [ ] **Step 1: api.ts 扩展**

`ArtifactSummary`（:233-248）加一个可选字段：

```typescript
export interface ArtifactSummary {
  id: string;
  kind: string;
  title: string;
  preview_url?: string;
  updated_at: string;
  source_skill_id?: string;
  requirement_id?: string;
  page_id?: string;
  variant?: string;
  current_version?: number;
  /** F3: immutable version count from the server list endpoint. */
  version_count?: number;
  superseded: boolean;
}
```

`ArtifactDetail`（:251-263）加两个可选字段：

```typescript
export interface ArtifactDetail {
  manifest: {
    id: string;
    kind: string;
    title: string;
    entry: string;
    supportingFiles?: string[];
    status: string;
    exports: string[];
    requirementId?: string;
  };
  preview_url?: string;
  /** F3: immutable version numbers, ascending. */
  versions?: number[];
  current_version?: number;
}
```

`FormaApiClient` 接口（按字母序插在 `getArtifactPreviewUrl` 之后）：

```typescript
  getArtifactVersionPreviewUrl(productId: string, artifactId: string, version: number, resolution: "1x" | "2x"): string;
```

`createApiClient` 实现（同样插在 `getArtifactPreviewUrl` 实现之后）：

```typescript
    getArtifactVersionPreviewUrl: (productId, artifactId, version, resolution) =>
      `/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifactId)}/versions/${version}/preview/${resolution}.png`,
```

- [ ] **Step 2: i18n key（packages/web/src/i18n.ts）**

en 字典（"design.canvasEmpty" 附近按字母序）加：

```typescript
    "design.compareEmpty": "This artifact has fewer than two versions",
    "design.compareLeft": "Left version",
    "design.comparePreviewMissing": "Preview unavailable for this version",
    "design.compareRight": "Right version",
    "design.compareTitle": "Version compare",
    "design.compareVersions": "Compare versions",
```

zh 字典（:374 "design.canvasEmpty" 附近）加：

```typescript
    "design.compareEmpty": "该设计稿不足两个版本",
    "design.compareLeft": "左侧版本",
    "design.comparePreviewMissing": "该版本无预览",
    "design.compareRight": "右侧版本",
    "design.compareTitle": "版本对比",
    "design.compareVersions": "对比版本",
```

- [ ] **Step 3: 写组件测试（失败）**

创建 `packages/web/src/pages/VersionCompare.test.tsx`：

```typescript
// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { VersionCompare, type VersionCompareClient } from "./VersionCompare.js";
import { LocaleProvider } from "../LocaleContext.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
});

function previewUrl(productId: string, artifactId: string, version: number, resolution: "1x" | "2x"): string {
  return `/api/products/${productId}/artifacts/${artifactId}/versions/${version}/preview/${resolution}.png`;
}

function fakeClient(versions: number[]): VersionCompareClient {
  return {
    getProductArtifact: async () => ({
      manifest: {
        id: "A1",
        kind: "design-page",
        title: "Checkout",
        entry: "index.html",
        status: "complete",
        exports: [],
      },
      versions,
      current_version: versions[versions.length - 1],
    }),
    getArtifactVersionPreviewUrl: previewUrl,
  };
}

async function render(client: VersionCompareClient) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(LocaleProvider, {
        children: createElement(VersionCompare, {
          client,
          params: { productId: "P-0abc12", artifactId: "A1" },
        }),
      }),
    );
  });
  return container;
}

describe("VersionCompare (F3)", () => {
  it("renders two preview panes defaulting to previous vs latest", async () => {
    const container = await render(fakeClient([1, 2, 3]));
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.map((img) => img.getAttribute("src"))).toEqual([
      previewUrl("P-0abc12", "A1", 2, "2x"),
      previewUrl("P-0abc12", "A1", 3, "2x"),
    ]);
  });

  it("switching a selector updates the corresponding pane", async () => {
    const container = await render(fakeClient([1, 2, 3]));
    const selects = [...container.querySelectorAll("select")];
    expect(selects).toHaveLength(2);
    await act(async () => {
      selects[0].value = "1";
      selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs[0].getAttribute("src")).toBe(previewUrl("P-0abc12", "A1", 1, "2x"));
  });

  it("shows an empty state when fewer than two versions exist", async () => {
    const container = await render(fakeClient([1]));
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.textContent).toContain("fewer than two versions");
  });
});
```

> 若 `LocaleContext.tsx` 的 provider 名称/props 与 `LocaleProvider {children}` 不符，以该文件实际导出为准调整（DesignView.test.tsx 同样消费 `useT`，参考它的包装方式）。

- [ ] **Step 4: 实现 VersionCompare 组件**

创建 `packages/web/src/pages/VersionCompare.tsx`：

```tsx
import { useEffect, useState } from "react";

import { formatApiError, type ApiErrorInfo, type FormaApiClient } from "../api.js";
import { useT } from "../LocaleContext.js";
import { PrimaryActionLink, StatePanel } from "../components/Layout.js";

export type VersionCompareClient = Pick<FormaApiClient, "getProductArtifact" | "getArtifactVersionPreviewUrl">;

export interface VersionCompareProps {
  client: VersionCompareClient;
  params: Record<string, string>;
}

type ViewState =
  | { status: "loading" }
  | { status: "error"; error: ApiErrorInfo }
  | { status: "empty"; title: string }
  | { status: "ready"; title: string; versions: number[]; left: number; right: number };

/** F3: read-only side-by-side compare of two immutable artifact versions. */
export function VersionCompare({ client, params }: VersionCompareProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const artifactId = params.artifactId ?? "";
  const [state, setState] = useState<ViewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getProductArtifact(productId, artifactId)
      .then((detail) => {
        if (cancelled) return;
        const versions = [...(detail.versions ?? [])].sort((a, b) => a - b);
        if (versions.length < 2) {
          setState({ status: "empty", title: detail.manifest.title });
          return;
        }
        const right = detail.current_version ?? versions[versions.length - 1];
        const rightIndex = versions.indexOf(right);
        const left = rightIndex > 0 ? versions[rightIndex - 1] : versions[versions.length - 2];
        setState({ status: "ready", title: detail.manifest.title, versions, left, right });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ error: formatApiError(error), status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, productId, artifactId]);

  const backHref = `/products/${encodeURIComponent(productId)}`;

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("design.compareTitle")}>
        {t("requirement.loading")}
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel
        action={<PrimaryActionLink href={backHref}>{t("action.backToProduct")}</PrimaryActionLink>}
        state="error"
        title={t("design.compareTitle")}
      >
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  if (state.status === "empty") {
    return (
      <StatePanel
        action={<PrimaryActionLink href={backHref}>{t("action.backToProduct")}</PrimaryActionLink>}
        state="empty"
        title={`${t("design.compareTitle")} · ${state.title}`}
      >
        {t("design.compareEmpty")}
      </StatePanel>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="truncate text-sm font-semibold tracking-normal text-zinc-950">
          {t("design.compareTitle")} · {state.title}
        </h2>
        <a
          className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-zinc-600 transition hover:text-zinc-950"
          href={backHref}
        >
          ← {t("action.backToProduct")}
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ComparePane
          label={t("design.compareLeft")}
          missingText={t("design.comparePreviewMissing")}
          onSelect={(version) => setState({ ...state, left: version })}
          previewUrl={client.getArtifactVersionPreviewUrl(productId, artifactId, state.left, "2x")}
          selected={state.left}
          versions={state.versions}
        />
        <ComparePane
          label={t("design.compareRight")}
          missingText={t("design.comparePreviewMissing")}
          onSelect={(version) => setState({ ...state, right: version })}
          previewUrl={client.getArtifactVersionPreviewUrl(productId, artifactId, state.right, "2x")}
          selected={state.right}
          versions={state.versions}
        />
      </div>
    </div>
  );
}

function ComparePane(props: {
  label: string;
  missingText: string;
  onSelect: (version: number) => void;
  previewUrl: string;
  selected: number;
  versions: number[];
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3">
      <label className="flex items-center gap-2 text-sm text-zinc-600">
        {props.label}
        <select
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
          onChange={(event) => {
            setFailed(false);
            props.onSelect(Number(event.target.value));
          }}
          value={String(props.selected)}
        >
          {props.versions.map((version) => (
            <option key={version} value={String(version)}>
              v{version}
            </option>
          ))}
        </select>
      </label>
      {failed ? (
        <div className="flex min-h-48 items-center justify-center text-sm text-zinc-500">{props.missingText}</div>
      ) : (
        <img
          alt={`${props.label} v${props.selected}`}
          className="w-full rounded-md border border-zinc-100"
          key={props.previewUrl}
          onError={() => setFailed(true)}
          src={props.previewUrl}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: 路由 + DesignView 入口**

`packages/web/src/routes.tsx`：

1. import 区加 `import { VersionCompare } from "./pages/VersionCompare.js";`
2. `routeTable` 中（DesignView 条目之后）加：

```typescript
  {
    component: VersionCompareRoute,
    context: "Design",
    navGroup: "products",
    path: "/products/:productId/artifacts/:artifactId/compare",
    title: ({ artifactId }) => `${artifactId} compare`,
  },
```

3. route 组件区加：

```typescript
function VersionCompareRoute(props: RoutePageProps) {
  return <VersionCompare client={apiClient} params={props.params} />;
}
```

`packages/web/src/routes.test.ts` 追加：

```typescript
it("matches the version compare route (F3)", () => {
  const match = matchRoute("/products/P-0abc12/artifacts/A1/compare");
  expect(match.found).toBe(true);
  expect(match.params).toEqual({ productId: "P-0abc12", artifactId: "A1" });
});
```

`packages/web/src/pages/DesignView.tsx`：

1. ViewState 的 ready 分支加字段：

```typescript
  | { status: "ready"; model: ViewerModel; compareTargets: Array<{ artifactId: string; title: string }> };
```

2. 数据加载 `.then` 中（`setState({ status: "ready", ... })` 之前）加：

```typescript
        // F3: artifacts with 2+ immutable versions get a compare entry. Do not
        // use current_version here; it is the active pointer and can be v1 after rollback.
        const compareTargets = requirementArtifacts
          .filter((artifact) => (artifact.version_count ?? 1) >= 2)
          .map((artifact) => ({ artifactId: artifact.id, title: artifact.title }));
```

并把 ready setState 改为：

```typescript
        setState({ status: "ready", model: buildViewerModel({ entry: "requirement", artifacts: inputs }), compareTargets });
```

3. 顶栏（`<h2 ...>{requirementId}</h2>` 之前）加：

```tsx
        {state.status === "ready" && state.compareTargets.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto text-sm">
            {state.compareTargets.map((target) => (
              <a
                className="whitespace-nowrap rounded-md border border-zinc-200 px-2 py-1 text-zinc-600 transition hover:text-zinc-950"
                href={`/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(target.artifactId)}/compare`}
                key={target.artifactId}
              >
                {t("design.compareVersions")} · {target.title}
              </a>
            ))}
          </div>
        )}
```

`packages/web/src/pages/DesignView.test.tsx` 的 fake artifact `d` 改为 `current_version: 1, version_count: 2`，覆盖“已回滚到 v1 但仍有历史版本可对比”的情况；其他单版本 design artifact 显式加 `version_count: 1`。代表性 fake data：

```typescript
{
  id: "d",
  kind: "design-page",
  title: "登录页 宽屏",
  updated_at: "",
  superseded: false,
  requirement_id: "r1",
  page_id: "login",
  variant: "wide",
  current_version: 1,
  version_count: 2,
}
```

然后追加（用既有 fakeClient 模式）：

```typescript
  it("shows a compare entry for artifacts with 2+ versions (F3)", async () => {
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<DesignView client={fakeClient()} params={{ productId: "p1", reqId: "r1" }} />);
      await flushPromises();
    });

    const link = container.querySelector('a[href="/products/p1/artifacts/d/compare"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("登录页 宽屏");
  });
```

- [ ] **Step 6: 跑测试**

```bash
npx vitest run packages/web/src/pages/VersionCompare.test.tsx packages/web/src/pages/DesignView.test.tsx packages/web/src/routes.test.ts packages/web/src/api.test.ts packages/web/src/i18n.test.ts
```
Expected: 全 PASS。i18n.test.ts 若校验 en/zh key 对齐，新 key 已成对添加。

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/api.ts packages/web/src/i18n.ts packages/web/src/routes.tsx packages/web/src/pages/VersionCompare.tsx packages/web/src/pages/VersionCompare.test.tsx packages/web/src/pages/DesignView.tsx packages/web/src/pages/DesignView.test.tsx packages/web/src/routes.test.ts
git commit -m "feat(web): side-by-side artifact version compare view (F3)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: F4(core) — diagnoseWorkspace 只读诊断

**Files:**
- Modify: `packages/core/src/store.ts`（导出 createStrictFormaStore）
- Create: `packages/core/src/doctor.ts`
- Modify: `packages/core/src/index.ts`（导出 doctor）
- Create: `packages/core/tests/doctor.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/core/tests/doctor.test.ts`：

```typescript
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createFormaStore } from "../src/store.js";
import { diagnoseWorkspace } from "../src/doctor.js";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function testHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "forma-doctor-"));
  homes.push(home);
  return home;
}

describe("diagnoseWorkspace (F4)", () => {
  it("reports a clean workspace with zero findings", async () => {
    const home = await testHome();
    const store = await createFormaStore({ home });
    await store.products.createProduct({ name: "P", description: "d" });

    const diagnosis = await diagnoseWorkspace({ home });

    expect(diagnosis.findings).toEqual([]);
    expect(diagnosis.products_checked).toBe(1);
  });

  it("collects ALL schema findings instead of failing fast", async () => {
    const home = await testHome();
    const store = await createFormaStore({ home });
    const p1 = await store.products.createProduct({ name: "P1", description: "d" });
    const p2 = await store.products.createProduct({ name: "P2", description: "d" });

    await writeFile(join(home, "data", p1.id, "product.yaml"), "not: [valid yaml", "utf8");
    await writeFile(join(home, "data", p2.id, "product.yaml"), "also: [broken", "utf8");

    const diagnosis = await diagnoseWorkspace({ home });

    const schemaFindings = diagnosis.findings.filter((f) => f.kind === "schema");
    expect(schemaFindings.map((f) => f.product_id).sort()).toEqual([p1.id, p2.id].sort());
    expect(diagnosis.products_checked).toBe(2);
  });

  it("reports orphan product directories without modifying them", async () => {
    const home = await testHome();
    await createFormaStore({ home }); // initialize empty workspace
    const orphanDir = join(home, "data", "P-0ffffe");
    await mkdir(orphanDir, { recursive: true });
    await writeFile(join(orphanDir, "stray.txt"), "keep me", "utf8");

    const diagnosis = await diagnoseWorkspace({ home });

    expect(diagnosis.findings).toContainEqual(
      expect.objectContaining({ kind: "orphan", product_id: "P-0ffffe" }),
    );
    await expect(readFile(join(orphanDir, "stray.txt"), "utf8")).resolves.toBe("keep me");
  });

  it("does not modify existing workspace files while diagnosing", async () => {
    const home = await testHome();
    const store = await createFormaStore({ home });
    const product = await store.products.createProduct({ name: "P", description: "d" });
    const productFile = join(home, "data", product.id, "product.yaml");
    const beforeContent = await readFile(productFile, "utf8");
    const beforeStat = await stat(productFile);

    await diagnoseWorkspace({ home });

    expect(await readFile(productFile, "utf8")).toBe(beforeContent);
    const afterStat = await stat(productFile);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    expect(afterStat.size).toBe(beforeStat.size);
  });

  it("survives a corrupt products.yaml and reports it as an index finding", async () => {
    const home = await testHome();
    await mkdir(join(home, "data"), { recursive: true });
    await writeFile(join(home, "data", "products.yaml"), "{{{{ not yaml", "utf8");

    const diagnosis = await diagnoseWorkspace({ home });

    expect(diagnosis.findings.some((f) => f.kind === "index")).toBe(true);
    expect(diagnosis.products_checked).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/core/tests/doctor.test.ts
```
Expected: FAIL（doctor.ts 不存在）。

- [ ] **Step 3: 实现**

`packages/core/src/store.ts`：`function createStrictFormaStore(` 改为 `export function createStrictFormaStore(`（仅加 export 关键字）。

创建 `packages/core/src/doctor.ts`：

```typescript
/**
 * doctor.ts — F4: read-only workspace diagnosis.
 *
 * Runs the same product → requirement → translation scan as startup
 * validation (store.ts validateStrictStoreReadModels), but collects every
 * finding instead of failing fast, and additionally reports orphan product
 * directories. Strictly read-only: no locks, no writes, no repairs.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { FormaError } from "./errors.js";
import { createStrictFormaStore } from "./store.js";

export interface WorkspaceFinding {
  kind: "schema" | "orphan" | "index";
  product_id?: string;
  requirement_id?: string;
  file?: string;
  error_code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface WorkspaceDiagnosis {
  findings: WorkspaceFinding[];
  products_checked: number;
}

const PRODUCT_DIR_PATTERN = /^P-[a-f0-9]{6}$/;

export async function diagnoseWorkspace(options: { home: string }): Promise<WorkspaceDiagnosis> {
  // createStrictFormaStore (unlike createFormaStore) performs no startup
  // validation and no tmp-dir cleanup — exactly the read-only handle we need.
  const store = createStrictFormaStore({ home: options.home });
  const findings: WorkspaceFinding[] = [];

  let products: Array<{ id: string }>;
  try {
    products = await store.products.listProducts();
  } catch (error) {
    findings.push(toFinding("index", error, { file: "data/products.yaml" }));
    return { findings, products_checked: 0 };
  }

  for (const entry of products) {
    try {
      await store.products.getProduct(entry.id);
    } catch (error) {
      findings.push(toFinding("schema", error, {
        product_id: entry.id,
        file: `data/${entry.id}/product.yaml`,
      }));
      continue;
    }

    const requirementIds = await listRequirementIds(options.home, entry.id, findings);
    for (const requirementId of requirementIds) {
      try {
        await store.requirements.getRequirement({ requirement_id: requirementId });
      } catch (error) {
        findings.push(toFinding("schema", error, {
          product_id: entry.id,
          requirement_id: requirementId,
          file: `data/${entry.id}/${requirementId}/requirement.yaml`,
        }));
        continue;
      }

      try {
        await store.copy.getTranslations(entry.id, requirementId);
      } catch (error) {
        findings.push(toFinding("schema", error, {
          product_id: entry.id,
          requirement_id: requirementId,
          file: `data/${entry.id}/${requirementId}/copy-translations.yaml`,
        }));
      }
    }
  }

  // Orphans: data/<P-xxxxxx>/ directories missing from the index. The data dir
  // also contains products.yaml and the products/ artifacts tree — both are
  // excluded by the id pattern / directory check.
  const indexed = new Set(products.map((product) => product.id));
  try {
    const entries = await readdir(join(options.home, "data"), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !PRODUCT_DIR_PATTERN.test(entry.name)) continue;
      if (!indexed.has(entry.name)) {
        findings.push({
          kind: "orphan",
          product_id: entry.name,
          file: `data/${entry.name}`,
          error_code: "PRODUCT_NOT_FOUND",
          message: `Product directory data/${entry.name} is not listed in products.yaml`,
        });
      }
    }
  } catch {
    // data/ does not exist yet — an empty workspace has nothing to scan.
  }

  return { findings, products_checked: products.length };
}

async function listRequirementIds(home: string, productId: string, findings: WorkspaceFinding[]): Promise<string[]> {
  const productDir = join(home, "data", productId);
  try {
    const entries = await readdir(productDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && /^R-[a-f0-9]{8}$/.test(entry.name)).map((entry) => entry.name);
  } catch (error) {
    findings.push(toFinding("schema", error, { product_id: productId, file: `data/${productId}` }));
    return [];
  }
}

function toFinding(
  kind: "schema" | "index",
  error: unknown,
  scope: { product_id?: string; requirement_id?: string; file?: string },
): WorkspaceFinding {
  if (error instanceof FormaError) {
    return { kind, ...scope, error_code: error.code, message: error.message, details: error.details };
  }
  return {
    kind,
    ...scope,
    error_code: "STRICT_SCHEMA_VALIDATION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}
```

关键点：`diagnoseWorkspace` 不再调用 `store.requirements.getRequirementHistory()`。它先按 `data/<productId>/R-*` 目录列出 requirement id，再逐个调用 `getRequirement()` / `getTranslations()`，这样一个坏 requirement 不会通过 `Promise.all` 折叠同产品下后续 finding。

`packages/core/src/index.ts` 末尾（`export { isSameOrChildPath }` 行之前）加：

```typescript
export * from "./doctor.js";
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/core/tests/doctor.test.ts packages/core/tests/store-startup-validation.test.ts
```
Expected: 全 PASS（startup fail-fast 行为不变）。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store.ts packages/core/src/doctor.ts packages/core/src/index.ts packages/core/tests/doctor.test.ts
git commit -m "feat(core): add read-only diagnoseWorkspace for forma doctor (F4)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: F4(cli) — `forma doctor` 命令 + strict 启动失败提示

**Files:**
- Modify: `packages/cli/src/index.ts`（命令分发、runDoctor、usage、strict 失败提示）
- Modify: `packages/cli/tests/cli.test.ts`（doctor 用例）

- [ ] **Step 1: 写失败测试**

`packages/cli/tests/cli.test.ts` 追加 describe：

```typescript
describe("forma doctor (F4)", () => {
  it("reports a clean empty workspace and exits 0", async () => {
    const home = await mkdtemp();
    const formaHome = join(home, ".forma");

    const result = await runCli(["doctor"], { formaHome });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Workspace is clean");
  });

  it("reports findings and exits 1 on a corrupt index", async () => {
    const { mkdir: fsMkdir, writeFile: fsWriteFile } = await import("node:fs/promises");
    const home = await mkdtemp();
    const formaHome = join(home, ".forma");
    await fsMkdir(join(formaHome, "data"), { recursive: true });
    await fsWriteFile(join(formaHome, "data", "products.yaml"), "{{{{ not yaml", "utf8");

    const result = await runCli(["doctor"], { formaHome });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("[index]");
    expect(result.stdout).toContain("data/products.yaml");
  });

  it("is listed in usage", async () => {
    const result = await runCli(["--help"], { formaHome: "/tmp/unused" });
    expect(result.stdout).toContain("doctor");
  });

  it("suggests forma doctor when strict startup validation fails", async () => {
    const strictError = new Error("strict validation failed") as Error & { code: string };
    strictError.code = "STRICT_SCHEMA_VALIDATION_FAILED";

    const result = await runCli(["mcp"], {
      formaHome: "/tmp/unused",
      startMcp: async () => {
        throw strictError;
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("strict validation failed");
    expect(result.stderr).toContain("Run `forma doctor` to locate invalid workspace data.");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/cli/tests/cli.test.ts
```
Expected: doctor 用例 FAIL（Unknown command）。

- [ ] **Step 3: 实现（packages/cli/src/index.ts）**

1. import：与既有 `@xenonbyte/forma-core` import 合并（若无则新增一行）：

```typescript
import { diagnoseWorkspace } from "@xenonbyte/forma-core";
```

2. 命令分发（`if (command === "status")` 块之后）：

```typescript
    if (command === "doctor") {
      return await runDoctor(args, runtimeEnv, output);
    }
```

3. `runStatus` 函数之后加：

```typescript
async function runDoctor(args: string[], env: RuntimeCliEnv, output: CliOutput): Promise<CliResult> {
  assertNoExtraArgs(args);

  const diagnosis = await diagnoseWorkspace({ home: env.formaHome });
  output.stdout(`Checked ${diagnosis.products_checked} product(s) in ${env.formaHome}\n`);

  if (diagnosis.findings.length === 0) {
    output.stdout("Workspace is clean\n");
    return output.result(0);
  }

  for (const finding of diagnosis.findings) {
    const scope = finding.file ?? [finding.product_id, finding.requirement_id].filter(Boolean).join("/");
    output.stdout(`[${finding.kind}] ${scope ? `${scope}: ` : ""}${finding.error_code} ${finding.message}\n`);
  }
  output.stdout(`${diagnosis.findings.length} finding(s)\n`);
  return output.result(1);
}
```

4. `usage()`：`"  status",` 之后加 `"  doctor",`。

5. strict 启动失败提示（需求文档 F4 第 6 条）：`runCli` 的顶层 catch（:173-175）改为：

```typescript
  } catch (error) {
    output.stderr(`${errorMessage(error)}\n`);
    if (isStrictValidationError(error)) {
      output.stderr("Run `forma doctor` to locate invalid workspace data.\n");
    }
    return output.result(1);
  }
```

并在文件中（`errorMessage` 定义附近）加：

```typescript
function isStrictValidationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "STRICT_SCHEMA_VALIDATION_FAILED"
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/cli/tests/cli.test.ts
```
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/tests/cli.test.ts
git commit -m "feat(cli): add read-only forma doctor command (F4)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: 收尾 — 全量验证

- [ ] **Step 1: 全量校验**

```bash
pnpm typecheck
pnpm test
pnpm lint:changed
```
Expected: 全部通过。typecheck 会先 build（cross-package dist 解析依赖它）。

- [ ] **Step 2: 验收清单核对**

对照 `docs/hardening-requirements.md` 各项验收标准逐条勾选；重点复核：

```bash
grep -rn "console\.log" packages/core/src ; echo "exit=$?"       # R10: exit=1
grep -rn '"--serve-token"' packages/cli/src ; echo "exit=$?"     # R1: exit=1
grep -rn "no-sandbox" packages/core/src/preview-renderer.ts       # R11: 仅 fallback 函数内出现
```

- [ ] **Step 3: 汇报**

向用户汇报完成状态与残留风险（如有），由用户决定 merge / PR（不要主动 push）。

---

## Self-Review 记录

- **Spec 覆盖**：R1✓(T7) R2✓(T4) R3✓(T3) R4✓(T2) R5✓(T6) R6✓(T5) R7✓(T8) R8 已完成无任务 R9 门控排期无任务 R10✓(T1) R11✓(T9) F3✓(T10+T11) F4✓(T12+T13)。
- **类型一致性**：`previewChromiumLaunchArgs`（T9 测试与实现同名）；`diagnoseWorkspace/WorkspaceFinding/WorkspaceDiagnosis`（T12/T13 一致）；`getArtifactVersionPreviewUrl`（T11 接口/实现/测试一致）；`PRODUCT_ID_ALLOCATION_FAILED`（T4 errors.ts 与测试一致）。
- **已知现场适配点**（非 placeholder，是依赖既有测试 harness 的对齐动作，executor 须按文件实况完成）：T11 Step 3 的 `LocaleProvider` 包装方式以 `LocaleContext.tsx` 实际导出为准；T11 Step 5 的 DesignView 测试体已按现有 `createTestRoot` / `fakeClient` / `flushPromises` 辅助写成完整断言。
