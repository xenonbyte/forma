# 设计能力地基（P1 Schema/存储 + P2 内容迁移）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地设计生成能力的两块地基——(P1) 把 artifact 存储/manifest 升级为 `page→N artifact→N version` + `manifest.forma.*` 扩展命名空间 + 当前版本指针索引 + 资源清单 + 幂等补齐脚本；(P2) 把 open-design 的质量本体（craft 规则 + 150 brand 风格 3 文件 + 系统风格目录）迁入并成为唯一来源，并把 `styles.ts`/产品配置/资产拷贝改造到新格式。

**Architecture:** 两块地基相互独立、可分别测试，合并为一份 plan（用户已锁定 `P1+P2` 同批执行）。Part A（P1）只做"存储/schema 原语 + 指针 + 补齐"，**不实现 generate→save 管线（P4）、不渲染预览（P3/P4）、不动 requirement 状态机**。Part B（P2）只做"内容搬运 + 格式改造"。两 Part 都改 `packages/core/src/product.ts` 的 `productSchema`，故 **A 组任务先于 B 组**执行（B6 在 A5 已改过的 `productSchema` 上继续改）。

**Tech Stack:** TypeScript ESM, Node ≥22, pnpm workspace, Vitest（`environment: node`，`createFormaStore` + tmpdir 范式），zod v4, YAML（`writeYamlAtomic`/`readYamlAs`），手写 JSON manifest 校验，`tsx`（`scripts/copy-assets.ts`）。

**上游迁移源：** `/Users/xubo/x-studio/forma2-cankao/open-design`（craft Apache 2.0；design-systems MIT，源 `bergside/awesome-design-skills`）。

---

## ⚠️ 现实增量与作用域边界（执行前必读 · 与主规划文档核对发现）

主规划文档 `2026-05-29-open-design-design-capability-implementation.md` 写于实地核对前，以下数字/结构与**当前真实代码与上游**不符，本 plan 以**真实事实**为准（已在任务里据实编码），列出供复核否决：

1. **brand 风格数 = 150（非 152）**：上游 `design-systems/` 共 152 项含 `README.md` + `_schema/`；含 `DESIGN.md` 的 brand 目录实测 **150** 个。任务 B2 用脚本按"含 `DESIGN.md`"动态发现，不写死数字。
2. **系统风格 stub = 36（非 17）**：上游 `skills/*/SKILL.md` 含 frontmatter `od.mode: design-system` 的实测 **36** 个。任务 B3 用脚本按 frontmatter 动态发现，断言"全部迁入"，不写死 17。
3. **forma 仓库根 `styles/` 已是旧格式**：现有 72 个 `styles/<name>/{DESIGN.md, preview@2x.png}` + `styles/styles.yaml`（旧 `variables:` 7 键 schema）。B2 **整体替换**为上游 150 brand 的 3 文件格式（`DESIGN.md`+`tokens.css`+`components.html`，上游无 `preview@2x.png`）。
4. **`craft/` 在 forma 尚不存在**：B1 新建仓库根 `craft/`（11 个内容 `.md` + `README.md`），并挂入 `scripts/copy-assets.ts`。
5. **manifest 是 JSON + 手写校验（非 YAML/zod）**：`packages/core/src/artifact-manifest.ts` 的 `validateArtifactManifest` 是手写校验，字段 **camelCase**（`requirementId`/`sourceSkillId`/`createdAt`）。本 plan 的 `manifest.forma.*` 字段一律 **camelCase**，保持一致；新字段全部**可选/加性**，旧 manifest 仍校验通过。
6. **artifact 现状是扁平、无版本、requirement 级单指针**：现 `artifacts/{id}/manifest.json`，`product.requirements[reqId] = {latestArtifactId?}`，**无 page_id、无 variant、无 version**。`~/.forma` 实测**无任何 artifact（greenfield）**。故 backfill（A8）主要是**未来兼容 + fixture 测试**，page_id 推断采用**显式 best-effort + 标记**，不假装精确。
7. **作用域边界 — design_status 不从 requirement page 移除**：主规划 note 4 说"把 page 的 design_status 挂到指针上"。真实代码里 `requirementPageSchema.design_status`（枚举 `pending|done|expired`）驱动 requirement 状态机（`resolveRequirementStatus`/`resolveSavedPage`）。P1 **只新增**指针自带的 `designStatus`（枚举 `pending|active|expired`，独立字段、无旧消费者），**不删除/不改动** page 级 `design_status` 与状态机（移除它的爆炸半径超出 P1）。两者并存，note 4 的"移除"推迟到后续 phase。⚠️ 指针 `designStatus` 用 `active` 是遵主规划字面；page 级仍是 `done`——术语差异已知、各自独立。
8. **kind 迁移策略 = 加性 + 读时归一**：`ALLOWED_KINDS` **新增** `design-page`/`component-library`，**保留** `html`/`design-system` 仍可校验（旧 manifest 读取兼容）；新增 `normalizeKind()` 在读取面把 `html→design-page`、`design-system→component-library`。backfill 重写旧 manifest 落到新 kind。彻底删除旧 enum 值留待 P4 读取面收口后。

> 如需改动以上任一决策，请在评审本 plan 时指出；否则按上述执行。

---

## File Structure（本批新建/改动文件职责）

**Part A（P1，全部在 `packages/core/`）：**
- `src/artifact-manifest.ts`（改）— 扩 `ALLOWED_KINDS`；新增 `ArtifactFormaExtension` 类型 + `validateFormaExtension` + `normalizeKind` + `normalizeFormaExtension`；`validateArtifactManifest` 加性校验 `m.forma`。
- `src/artifact-paths.ts`（改）— 新增 `v{n}` 版本目录路径助手（version dir / manifest / assets / preview）。
- `src/artifact-store.ts`（改）— 新增 version 感知方法 `writeArtifactVersion`/`readArtifactVersion`/`listArtifactVersions`（旧扁平方法保留）。
- `src/artifact-assets.ts`（新）— `assets ⊆ supportingFiles` 一致性校验 `validateAssetsAgainstSupportingFiles`。
- `src/product.ts`（改）— `productSchema` 新增 `designPointers` 数组 + 唯一性 superRefine；`ProductService` 新增 `setDesignPointerLocked`/`getDesignPointer`/`listDesignPointers`/`rollbackDesignPointerLocked`。
- `src/backfill-design-artifacts.ts`（新）— 幂等补齐脚本（旧 artifact→新字段/新 kind、建指针）。

**Part B（P2）：**
- 仓库根 `craft/`（新）— 11 内容 md + README + 归属。
- 仓库根 `styles/`（整体替换）— 150 brand × 3 文件 + `styles.yaml`（新 schema）+ `_system/system-styles.yaml`（36 stub 目录）+ LICENSE。
- `packages/core/src/styles.ts`（改）— 新 `styleMetadataSchema`（brand 三文件 / system 目录元数据）；`getStyle` 按类型返回；删 `styleVariablesSchema`/`withDefaultVariables`；新增 craft 读取 `getDefaultBundledCraftDir`/`readCraftDoc`/`listCraftDocs`。
- `packages/core/src/product.ts`（改，承 A5）— 产品配置 `style` → `brand_style`(必填) + `system_style`(可选)；`productConfigSchema`/`assertProductConfig`/`ProductConfigField`。
- `scripts/copy-assets.ts`（改）— styles 校验改新格式；新增 craft 拷贝条目。
- 受影响测试：`packages/core/tests/{product-config,product-session-style}.test.ts`、`packages/cli/tests/copy-assets.test.ts` 等随改。

---

# Part A — P1：Schema / 存储地基

## Task A1: manifest.forma 扩展命名空间 + kind 迁移（加性校验）

**Files:**
- Modify: `packages/core/src/artifact-manifest.ts`
- Test: `packages/core/tests/artifact-manifest.test.ts`（已存在，追加）

- [ ] **Step 1: 写失败测试 —— 新 kind 接受、forma 扩展校验、normalizeKind**

在 `packages/core/tests/artifact-manifest.test.ts` 末尾追加：

```ts
import {
  ALLOWED_KINDS,
  normalizeKind,
  validateFormaExtension,
  normalizeFormaExtension,
  validateArtifactManifest,
} from '../src/artifact-manifest.js';

describe('A1 manifest.forma extension + kind migration', () => {
  it('accepts new kinds design-page and component-library', () => {
    expect(ALLOWED_KINDS).toContain('design-page');
    expect(ALLOWED_KINDS).toContain('component-library');
    // 旧 kind 仍可校验（读取兼容）
    expect(ALLOWED_KINDS).toContain('html');
    expect(ALLOWED_KINDS).toContain('design-system');
  });

  it('normalizeKind maps legacy kinds to new', () => {
    expect(normalizeKind('html')).toBe('design-page');
    expect(normalizeKind('design-system')).toBe('component-library');
    expect(normalizeKind('design-page')).toBe('design-page');
    expect(normalizeKind('svg')).toBe('svg');
  });

  it('validateFormaExtension accepts a full valid extension', () => {
    const r = validateFormaExtension({
      requirementId: 'R-1234abcd',
      pageId: 'login',
      variant: 'default',
      brandStyle: 'ant',
      systemStyle: 'shadcn-ui',
      platform: 'web',
      language: 'zh-CN',
      provenance: { model: 'claude', sourceSkillId: 'fm-design', generatedAt: '2026-05-30T00:00:00.000Z', promptDigest: 'abc' },
      quality: { craftChecks: [{ id: 'accent-budget', passed: true }] },
      preview: { status: 'ready', generatedAt: '2026-05-30T00:00:00.000Z' },
      assets: [{ path: 'assets/hero@1x.png', density: [1, 2], role: 'image' }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects invalid forma fields (bad preview status, empty variant, asset density not array)', () => {
    expect(validateFormaExtension({ preview: { status: 'pending' } }).ok).toBe(false);
    expect(validateFormaExtension({ variant: '' }).ok).toBe(false);
    expect(validateFormaExtension({ assets: [{ path: 'assets/a.png', density: 1, role: 'image' }] }).ok).toBe(false);
    // 资源路径不得逃逸
    expect(validateFormaExtension({ assets: [{ path: '../escape.png', density: [1], role: 'image' }] }).ok).toBe(false);
  });

  it('design-page manifest requires forma.variant; legacy missing variant normalizes to default', () => {
    const base = {
      version: 1, id: 'AbCdEfGhIjKlMnOp', kind: 'design-page', renderer: 'html',
      title: 'Login', entry: 'index.html', status: 'complete', exports: ['index.html'],
      createdAt: '2026-05-30T00:00:00.000Z', updatedAt: '2026-05-30T00:00:00.000Z',
    };
    // design-page 缺 forma.variant → 校验失败
    expect(validateArtifactManifest({ ...base, forma: { requirementId: 'R-1234abcd', pageId: 'login' } }).ok).toBe(false);
    // 有 variant → 通过
    const ok = validateArtifactManifest({ ...base, forma: { requirementId: 'R-1234abcd', pageId: 'login', variant: 'default' } });
    expect(ok.ok).toBe(true);
    // normalizeFormaExtension 给缺 variant 的旧扩展补 default
    expect(normalizeFormaExtension({ pageId: 'login' }).variant).toBe('default');
  });

  it('non-forma legacy manifest still validates (additive)', () => {
    const legacy = {
      version: 1, id: 'AbCdEfGhIjKlMnOp', kind: 'html', renderer: 'html',
      title: 'Old', entry: 'index.html', status: 'complete', exports: ['index.html'],
      createdAt: '2026-05-28T00:00:00.000Z', updatedAt: '2026-05-28T00:00:00.000Z',
    };
    expect(validateArtifactManifest(legacy).ok).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/artifact-manifest.test.ts -t "A1"`
Expected: FAIL（`normalizeKind`/`validateFormaExtension`/`normalizeFormaExtension` 未导出；新 kind 不在 enum）

- [ ] **Step 3: 实现 —— 扩 enum + forma 类型/校验/归一**

在 `packages/core/src/artifact-manifest.ts`：

(a) 扩 `ALLOWED_KINDS` / `ALLOWED_RENDERERS`：

```ts
export const ALLOWED_KINDS = [
  'html',
  'design-system',
  'design-page',          // 新：需求页面设计稿（替代旧 html 用法）
  'component-library',     // 新：generate_components 产物（替代旧 design-system 用法）
  'markdown-document',
  'svg',
  'image',
  'preview-only',
] as const;

export const ALLOWED_RENDERERS = [
  'html',
  'design-system',
  'markdown',
  'svg',
  'image',
  'preview-only',
] as const;
```

(b) 文件尾部新增类型与函数：

```ts
// ─── forma 扩展命名空间 ─────────────────────────────────────────────────────
const PREVIEW_STATUSES = ['ready', 'failed'] as const;
const POINTER_DESIGN_STATUSES = ['pending', 'active', 'expired'] as const;

export interface ArtifactAssetEntry {
  /** 相对 bundle 根、须 ⊆ supportingFiles、不得逃逸 */
  path: string;
  /** 实际可得 density 集合（如 [1,2,3]；SVG 单份 [1]）。绝不上采样 */
  density: number[];
  /** 资源角色，如 image / icon / font */
  role: string;
  /** master 不足时实际档位不全 → true */
  degraded?: boolean;
}

export interface ArtifactProvenance {
  model?: string;
  sourceSkillId?: string;
  generatedAt?: string;
  promptDigest?: string;
}

export interface ArtifactCraftCheck {
  id: string;
  passed: boolean;
  detail?: string;
}

export interface ArtifactPreview {
  status: typeof PREVIEW_STATUSES[number];
  generatedAt?: string;
  error?: string;
}

export interface ArtifactFormaExtension {
  requirementId?: string;
  pageId?: string;
  variant?: string;        // design-page: 始终存在、默认 'default'、同 page 唯一
  brandStyle?: string;
  systemStyle?: string;
  platform?: string;
  language?: string;
  provenance?: ArtifactProvenance;
  quality?: { craftChecks?: ArtifactCraftCheck[] };
  preview?: ArtifactPreview;
  assets?: ArtifactAssetEntry[];
}

const LEGACY_KIND_MAP: Record<string, ArtifactKind> = {
  html: 'design-page',
  'design-system': 'component-library',
};

/** 读取面归一：把旧 kind 映射到新 kind，其余原样返回 */
export function normalizeKind(kind: string): ArtifactKind {
  return (LEGACY_KIND_MAP[kind] ?? kind) as ArtifactKind;
}

/** 读取面归一：缺 variant 的扩展补 'default' */
export function normalizeFormaExtension(forma: ArtifactFormaExtension): ArtifactFormaExtension {
  return { ...forma, variant: forma.variant ?? 'default' };
}

type FormaValidationResult =
  | { ok: true; value: ArtifactFormaExtension }
  | { ok: false; error: string };

export function validateFormaExtension(forma: unknown): FormaValidationResult {
  if (typeof forma !== 'object' || forma === null || Array.isArray(forma)) {
    return { ok: false, error: 'forma must be a non-null object' };
  }
  const f = forma as Record<string, unknown>;

  for (const key of ['requirementId', 'pageId', 'brandStyle', 'systemStyle', 'platform', 'language'] as const) {
    if (f[key] !== undefined && (typeof f[key] !== 'string' || (f[key] as string).length === 0)) {
      return { ok: false, error: `forma.${key} must be a non-empty string` };
    }
  }
  // variant：若提供必须非空（design-page 的"必填"在 validateArtifactManifest 里按 kind 追加约束）
  if (f['variant'] !== undefined && (typeof f['variant'] !== 'string' || (f['variant'] as string).length === 0)) {
    return { ok: false, error: 'forma.variant must be a non-empty string' };
  }

  if (f['preview'] !== undefined) {
    const p = f['preview'] as Record<string, unknown>;
    if (typeof p !== 'object' || p === null || !(PREVIEW_STATUSES as readonly string[]).includes(p['status'] as string)) {
      return { ok: false, error: `forma.preview.status must be one of: ${PREVIEW_STATUSES.join(', ')}` };
    }
  }

  if (f['assets'] !== undefined) {
    if (!Array.isArray(f['assets'])) {
      return { ok: false, error: 'forma.assets must be an array' };
    }
    for (const a of f['assets'] as unknown[]) {
      if (typeof a !== 'object' || a === null) return { ok: false, error: 'forma.assets entry must be an object' };
      const entry = a as Record<string, unknown>;
      if (validateSupportingPath(entry['path']) === null) {
        return { ok: false, error: `forma.assets path invalid: ${String(entry['path'])}` };
      }
      if (!Array.isArray(entry['density']) || (entry['density'] as unknown[]).some((d) => typeof d !== 'number' || d <= 0)) {
        return { ok: false, error: 'forma.assets density must be a non-empty array of positive numbers' };
      }
      if (typeof entry['role'] !== 'string' || entry['role'].length === 0) {
        return { ok: false, error: 'forma.assets role must be a non-empty string' };
      }
    }
  }

  if (f['provenance'] !== undefined && (typeof f['provenance'] !== 'object' || f['provenance'] === null || Array.isArray(f['provenance']))) {
    return { ok: false, error: 'forma.provenance must be an object' };
  }
  if (f['quality'] !== undefined) {
    const q = f['quality'] as Record<string, unknown>;
    if (typeof q !== 'object' || q === null || Array.isArray(q)) return { ok: false, error: 'forma.quality must be an object' };
    if (q['craftChecks'] !== undefined && !Array.isArray(q['craftChecks'])) {
      return { ok: false, error: 'forma.quality.craftChecks must be an array' };
    }
  }
  void POINTER_DESIGN_STATUSES; // 指针 designStatus 在 product.ts 校验，此处仅声明词表来源
  return { ok: true, value: f as ArtifactFormaExtension };
}
```

(c) 在 `validateArtifactManifest` 的 `return { ok: true, ... }` **之前**插入 forma 加性校验 + design-page variant 约束：

```ts
  // forma 扩展（加性、可选）
  if (m['forma'] !== undefined) {
    const formaResult = validateFormaExtension(m['forma']);
    if (!formaResult.ok) {
      return { ok: false, error: formaResult.error };
    }
    // design-page：forma.variant 必填（写入期强制；读取期用 normalizeFormaExtension 补默认）
    if (m['kind'] === 'design-page' && formaResult.value.variant === undefined) {
      return { ok: false, error: 'design-page manifest requires forma.variant' };
    }
  }
```

并在 `ArtifactManifest` 接口加 `forma?: ArtifactFormaExtension;`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/artifact-manifest.test.ts`
Expected: PASS（含原有用例不回归）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/artifact-manifest.ts packages/core/tests/artifact-manifest.test.ts
git commit -m "feat(core): add manifest.forma extension namespace + design-page/component-library kinds"
```

---

## Task A2: 版本目录路径助手（`v{n}/`）

**Files:**
- Modify: `packages/core/src/artifact-paths.ts`
- Test: `packages/core/tests/artifact-paths.test.ts`（已存在，追加）

- [ ] **Step 1: 写失败测试**

```ts
import {
  getArtifactVersionDir,
  getArtifactVersionManifestPath,
  getArtifactVersionAssetsDir,
  getArtifactVersionPreviewPath,
} from '../src/artifact-paths.js';

describe('A2 versioned artifact paths', () => {
  const root = '/tmp/products';
  const pid = 'P-ab1234';
  const aid = 'AbCdEfGhIjKlMnOp';

  it('builds v{n} dir under artifacts/{id}', () => {
    expect(getArtifactVersionDir(root, pid, aid, 1).endsWith('od-project/artifacts/AbCdEfGhIjKlMnOp/v1')).toBe(true);
  });
  it('builds version manifest / assets / preview paths', () => {
    expect(getArtifactVersionManifestPath(root, pid, aid, 2).endsWith('v2/manifest.json')).toBe(true);
    expect(getArtifactVersionAssetsDir(root, pid, aid, 3).endsWith('v3/assets')).toBe(true);
    expect(getArtifactVersionPreviewPath(root, pid, aid, 1, '2x').endsWith('v1/preview/2x.png')).toBe(true);
  });
  it('rejects non-positive-integer version', () => {
    expect(() => getArtifactVersionDir(root, pid, aid, 0)).toThrow();
    expect(() => getArtifactVersionDir(root, pid, aid, 1.5)).toThrow();
    expect(() => getArtifactVersionDir(root, pid, aid, -1)).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/artifact-paths.test.ts -t "A2"`
Expected: FAIL（函数未定义）

- [ ] **Step 3: 实现**

在 `packages/core/src/artifact-paths.ts` 追加（复用现有 `safeArtifactPath`/`validateProductId`/`validateArtifactId`）：

```ts
function validateVersion(version: number): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new FormaError('ARTIFACT_INVALID_INPUT', 'Invalid artifact version', { version });
  }
  return `v${version}`;
}

export function getArtifactVersionDir(
  productsRoot: string, productId: string, artifactId: string, version: number,
): string {
  return safeArtifactPath(
    productsRoot, validateProductId(productId), 'od-project', 'artifacts',
    validateArtifactId(artifactId), validateVersion(version),
  );
}

export function getArtifactVersionManifestPath(
  productsRoot: string, productId: string, artifactId: string, version: number,
): string {
  return safeArtifactPath(
    productsRoot, validateProductId(productId), 'od-project', 'artifacts',
    validateArtifactId(artifactId), validateVersion(version), 'manifest.json',
  );
}

export function getArtifactVersionAssetsDir(
  productsRoot: string, productId: string, artifactId: string, version: number,
): string {
  return safeArtifactPath(
    productsRoot, validateProductId(productId), 'od-project', 'artifacts',
    validateArtifactId(artifactId), validateVersion(version), 'assets',
  );
}

export function getArtifactVersionPreviewPath(
  productsRoot: string, productId: string, artifactId: string, version: number, resolution: '1x' | '2x',
): string {
  return safeArtifactPath(
    productsRoot, validateProductId(productId), 'od-project', 'artifacts',
    validateArtifactId(artifactId), validateVersion(version), 'preview', `${resolution}.png`,
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/artifact-paths.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/artifact-paths.ts packages/core/tests/artifact-paths.test.ts
git commit -m "feat(core): add v{n} versioned artifact path helpers"
```

---

## Task A3: version 感知的 artifact 读写

**Files:**
- Modify: `packages/core/src/artifact-store.ts`
- Test: `packages/core/tests/artifact-store.test.ts`（已存在，追加）

- [ ] **Step 1: 写失败测试**

```ts
import { createArtifactStore } from '../src/artifact-store.js';

describe('A3 versioned artifact read/write', () => {
  // 注意：现有测试里 lock 是每个 it 内局部声明（const lock = getProductMutationLock(testRoot)），
  // 不在 beforeEach。下面每个 it 同样自行声明 lock。productId/productsRoot/testRoot 为模块级，已就绪。
  it('writes and reads v1 then v2 of the same artifact id', async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    const aid = 'AbCdEfGhIjKlMnOp';
    await store.writeArtifactVersion({
      productId, artifactId: aid, version: 1,
      manifest: makeManifest({ id: aid, kind: 'design-page', forma: { requirementId: 'R-1234abcd', pageId: 'login', variant: 'default' } }),
      files: new Map([['index.html', Buffer.from('<h1>v1</h1>')]]),
    });
    await store.writeArtifactVersion({
      productId, artifactId: aid, version: 2,
      manifest: makeManifest({ id: aid, kind: 'design-page', forma: { requirementId: 'R-1234abcd', pageId: 'login', variant: 'default' } }),
      files: new Map([['index.html', Buffer.from('<h1>v2</h1>')]]),
    });

    const v1 = await store.readArtifactVersion(productId, aid, 1);
    const v2 = await store.readArtifactVersion(productId, aid, 2);
    expect(v1.manifest.id).toBe(aid);
    expect(v2.manifest.id).toBe(aid);

    const versions = await store.listArtifactVersions(productId, aid);
    expect(versions.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('rejects overwriting an existing version', async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    const aid = 'BbCdEfGhIjKlMnOp';
    const input = {
      productId, artifactId: aid, version: 1,
      manifest: makeManifest({ id: aid, kind: 'design-page', forma: { variant: 'default' } }),
      files: new Map([['index.html', Buffer.from('x')]]),
    };
    await store.writeArtifactVersion(input);
    await expect(store.writeArtifactVersion(input)).rejects.toThrow(/already exists/i);
  });

  it('readArtifactVersion throws ARTIFACT_NOT_FOUND for missing version', async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    await expect(store.readArtifactVersion(productId, 'ZZCdEfGhIjKlMnOp', 9)).rejects.toThrow();
  });
});
```

> 注：`getProductMutationLock` 已在该测试文件顶部 import；`productId`/`productsRoot`/`testRoot` 为模块级（`productsRoot = join(testRoot,'data','products')`，与 artifact 根一致）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/artifact-store.test.ts -t "A3"`
Expected: FAIL（`writeArtifactVersion` 等未实现）

- [ ] **Step 3: 实现**

在 `packages/core/src/artifact-store.ts`：

(a) import 版本路径助手：

```ts
import {
  getArtifactDir, getArtifactManifestPath, getArtifactTmpDir, getArtifactsDir,
  getArtifactVersionDir, getArtifactVersionManifestPath,
} from './artifact-paths.js';
import { readdir } from 'node:fs/promises';
```

(b) `ArtifactStore` 接口加：

```ts
  writeArtifactVersion(input: WriteArtifactVersionInput): Promise<{ etag: string }>;
  readArtifactVersion(productId: string, artifactId: string, version: number): Promise<{ manifest: ArtifactManifest; etag: string }>;
  listArtifactVersions(productId: string, artifactId: string): Promise<number[]>;
```

(c) 新增输入类型：

```ts
export interface WriteArtifactVersionInput {
  productId: string;
  artifactId: string;
  version: number;
  manifest: ArtifactManifest;
  files: Map<string, Buffer>;
}
```

(d) `ArtifactStoreImpl` 实现（沿用 tmp→rename 原子写、collision 检测、`resolveArtifactTmpFilePath` 路径夹紧、`normalizeAndValidateManifest`）：

```ts
  async writeArtifactVersion(input: WriteArtifactVersionInput): Promise<{ etag: string }> {
    const { productId, artifactId, version, manifest, files } = input;
    return this.lock.run({ operation: 'write_artifact_version', product_id: productId }, async () => {
      const versionDir = getArtifactVersionDir(this.productsRoot, productId, artifactId, version);
      const normalized = normalizeAndValidateManifest(manifest, artifactId);

      if (await dirExists(versionDir)) {
        throw new FormaError('ARTIFACT_ALREADY_EXISTS', `Artifact version already exists: ${artifactId} v${version}`, { artifactId, productId, version });
      }
      await mkdir(getArtifactDir(this.productsRoot, productId, artifactId), { recursive: true });

      const tmpDir = getArtifactTmpDir(this.productsRoot, productId);
      await mkdir(tmpDir, { recursive: true });
      try {
        for (const [relativePath, content] of files) {
          const destPath = resolveArtifactTmpFilePath(tmpDir, relativePath);
          await mkdir(dirname(destPath), { recursive: true });
          await writeFile(destPath, content);
        }
        const manifestJson = JSON.stringify(normalized, null, 2);
        await writeFile(join(tmpDir, 'manifest.json'), manifestJson, 'utf8');
        const etag = computeEtag(manifestJson);
        try {
          await this._rename(tmpDir, versionDir);
        } catch (err) {
          await rm(tmpDir, { recursive: true, force: true });
          throw new FormaError('ARTIFACT_WRITE_FAIL', `Failed to write artifact version: ${artifactId} v${version}`, { artifactId, productId, version, cause: String(err) });
        }
        return { etag };
      } catch (err) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        throw err;
      }
    });
  }

  async readArtifactVersion(productId: string, artifactId: string, version: number): Promise<{ manifest: ArtifactManifest; etag: string }> {
    const manifestPath = getArtifactVersionManifestPath(this.productsRoot, productId, artifactId, version);
    let manifestJson: string;
    try {
      manifestJson = await readFile(manifestPath, 'utf8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        throw new FormaError('ARTIFACT_NOT_FOUND', `Artifact version not found: ${artifactId} v${version}`, { artifactId, productId, version });
      }
      throw err;
    }
    return { manifest: JSON.parse(manifestJson) as ArtifactManifest, etag: computeEtag(manifestJson) };
  }

  async listArtifactVersions(productId: string, artifactId: string): Promise<number[]> {
    const artifactDir = getArtifactDir(this.productsRoot, productId, artifactId);
    let entries: string[];
    try {
      entries = await readdir(artifactDir);
    } catch {
      return [];
    }
    return entries
      .map((e) => /^v(\d+)$/.exec(e))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/artifact-store.test.ts`
Expected: PASS（旧扁平方法用例不回归）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/artifact-store.ts packages/core/tests/artifact-store.test.ts
git commit -m "feat(core): add version-aware artifact write/read/list"
```

---

## Task A4: assets ⊆ supportingFiles 一致性校验

**Files:**
- Create: `packages/core/src/artifact-assets.ts`
- Test: `packages/core/tests/artifact-assets.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { validateAssetsAgainstSupportingFiles } from '../src/artifact-assets.js';

describe('A4 assets ⊆ supportingFiles', () => {
  it('passes when every asset path is in supportingFiles', () => {
    const r = validateAssetsAgainstSupportingFiles(
      { assets: [{ path: 'assets/a@1x.png', density: [1], role: 'image' }] },
      ['index.html', 'assets/a@1x.png'],
    );
    expect(r.ok).toBe(true);
  });
  it('fails when an asset path is missing from supportingFiles', () => {
    const r = validateAssetsAgainstSupportingFiles(
      { assets: [{ path: 'assets/missing@1x.png', density: [1], role: 'image' }] },
      ['index.html'],
    );
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toMatch(/missing/);
  });
  it('passes when forma has no assets', () => {
    expect(validateAssetsAgainstSupportingFiles({}, ['index.html']).ok).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/artifact-assets.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`packages/core/src/artifact-assets.ts`：

```ts
import type { ArtifactFormaExtension } from './artifact-manifest.js';

type Result = { ok: true } | { ok: false; error: string };

/**
 * manifest.forma.assets 是权威视图；supportingFiles 是扁平路径索引（od v1 原字段）。
 * 约束：每个 asset.path 必须出现在 supportingFiles 中，避免双源漂移。
 */
export function validateAssetsAgainstSupportingFiles(
  forma: Pick<ArtifactFormaExtension, 'assets'>,
  supportingFiles: string[] | undefined,
): Result {
  const assets = forma.assets ?? [];
  if (assets.length === 0) return { ok: true };
  const index = new Set(supportingFiles ?? []);
  for (const a of assets) {
    if (!index.has(a.path)) {
      return { ok: false, error: `forma.assets path missing from supportingFiles: ${a.path}` };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/artifact-assets.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/artifact-assets.ts packages/core/tests/artifact-assets.test.ts
git commit -m "feat(core): validate manifest.forma.assets are subset of supportingFiles"
```

---

## Task A5: 当前版本指针索引（product 记录）

**Files:**
- Modify: `packages/core/src/product.ts`
- Test: `packages/core/tests/product-design-pointer.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFormaStore } from '../src/index.js';

async function makeStore() {
  const home = await mkdtemp(join(tmpdir(), 'forma-design-pointer-'));
  await writeFile(join(home, '.v6-schema-cutover-committed'), 'committed\n', 'utf8');
  return createFormaStore({ home });
}

describe('A5 design pointer index', () => {
  it('sets, gets, lists a pointer keyed by (requirementId,pageId,variant)', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    await store.runProductMutation({ operation: 'test', product_id: p.id }, () =>
      store.products.setDesignPointerLocked(p.id, {
        requirementId: 'R-1234abcd', pageId: 'login', variant: 'default',
        artifactId: 'AbCdEfGhIjKlMnOp', version: 2, designStatus: 'active',
      }),
    );
    const got = await store.products.getDesignPointer(p.id, 'R-1234abcd', 'login', 'default');
    expect(got).toMatchObject({ artifactId: 'AbCdEfGhIjKlMnOp', version: 2, designStatus: 'active' });
    const all = await store.products.listDesignPointers(p.id);
    expect(all).toHaveLength(1);
  });

  it('enforces uniqueness: re-setting same (req,page,variant) replaces, not duplicates', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    const set = (artifactId: string, version: number) =>
      store.runProductMutation({ operation: 'test', product_id: p.id }, () =>
        store.products.setDesignPointerLocked(p.id, {
          requirementId: 'R-1234abcd', pageId: 'login', variant: 'default', artifactId, version, designStatus: 'active',
        }),
      );
    await set('AbCdEfGhIjKlMnOp', 1);
    await set('AbCdEfGhIjKlMnOp', 2);
    const all = await store.products.listDesignPointers(p.id);
    expect(all).toHaveLength(1);
    expect(all[0].version).toBe(2);
  });

  it('rollback flips the pointer to an older version without deleting it', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    await store.runProductMutation({ operation: 'test', product_id: p.id }, () =>
      store.products.setDesignPointerLocked(p.id, {
        requirementId: 'R-1234abcd', pageId: 'login', variant: 'default', artifactId: 'AbCdEfGhIjKlMnOp', version: 3, designStatus: 'active',
      }),
    );
    await store.runProductMutation({ operation: 'test', product_id: p.id }, () =>
      store.products.rollbackDesignPointerLocked(p.id, 'R-1234abcd', 'login', 'default', 1),
    );
    const got = await store.products.getDesignPointer(p.id, 'R-1234abcd', 'login', 'default');
    expect(got?.version).toBe(1);
  });

  it('schema rejects two pointers with identical (req,page,variant)', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    const dup = {
      ...p,
      designPointers: [
        { requirementId: 'R-1', pageId: 'a', variant: 'default', artifactId: 'A1', version: 1, designStatus: 'active' },
        { requirementId: 'R-1', pageId: 'a', variant: 'default', artifactId: 'A2', version: 1, designStatus: 'active' },
      ],
    };
    // 直接落盘非法数据后读取应抛错（唯一性 superRefine）
    await writeFile(join(store.home, 'data', p.id, 'product.yaml'), JSON.stringify(dup), 'utf8');
    await expect(store.products.getProduct(p.id)).rejects.toThrow();
  });
});
```

> 注：测试用 **`store.runProductMutation`** —— 它**本就是 `FormaStore` 上的 public 方法**（`store.ts:68/224`，与 `ProductService` 共用同一把锁）。**无需**改 `ProductService.runProductMutation` 的可见性。`setDesignPointerLocked` 在该锁回调内执行即满足"持锁写"语义。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/product-design-pointer.test.ts`
Expected: FAIL（`designPointers`/指针方法未实现）

- [ ] **Step 3: 实现**

在 `packages/core/src/product.ts`：

(a) 新增 schema（放在 `productSchema` 定义前）：

```ts
const pointerDesignStatuses = ['pending', 'active', 'expired'] as const;

const designPointerSchema = z.object({
  requirementId: z.string().min(1),
  pageId: z.string().min(1),
  variant: z.string().min(1),
  artifactId: z.string().min(1),
  version: z.number().int().min(1),
  designStatus: z.enum(pointerDesignStatuses),
}).strict();

export type DesignPointer = z.infer<typeof designPointerSchema>;
```

(b) `productSchema.extend(...)` 加字段 + 在其 `superRefine` 内追加唯一性校验：

```ts
  // 在 .extend({...}) 内加：
  designPointers: z.array(designPointerSchema).optional(),
```
```ts
  // 在 superRefine 回调内追加：
  if (product.designPointers) {
    const seen = new Set<string>();
    for (const ptr of product.designPointers) {
      const key = `${ptr.requirementId} ${ptr.pageId} ${ptr.variant}`;
      if (seen.has(key)) {
        context.addIssue({ code: 'custom', message: `duplicate design pointer for (${ptr.requirementId},${ptr.pageId},${ptr.variant})`, path: ['designPointers'] });
      }
      seen.add(key);
    }
  }
```

(c) `ProductService` 新增方法（被 `store.runProductMutation` 回调在锁内调用；`store.runProductMutation` 已 public，无需改 `ProductService` 可见性）：

```ts
  async setDesignPointerLocked(productId: string, pointer: DesignPointer): Promise<void> {
    const product = await this.getProduct(productId);
    const parsed = designPointerSchema.parse(pointer);
    const rest = (product.designPointers ?? []).filter(
      (p) => !(p.requirementId === parsed.requirementId && p.pageId === parsed.pageId && p.variant === parsed.variant),
    );
    const updated = productSchema.parse({ ...product, designPointers: [...rest, parsed] });
    await writeYamlAtomic(this.productFile(updated.id), updated);
  }

  async getDesignPointer(productId: string, requirementId: string, pageId: string, variant: string): Promise<DesignPointer | undefined> {
    const product = await this.getProduct(productId);
    return (product.designPointers ?? []).find(
      (p) => p.requirementId === requirementId && p.pageId === pageId && p.variant === variant,
    );
  }

  async listDesignPointers(productId: string): Promise<DesignPointer[]> {
    return (await this.getProduct(productId)).designPointers ?? [];
  }

  async rollbackDesignPointerLocked(productId: string, requirementId: string, pageId: string, variant: string, targetVersion: number): Promise<void> {
    const current = await this.getDesignPointer(productId, requirementId, pageId, variant);
    if (!current) {
      throw new FormaError('ARTIFACT_NOT_FOUND', 'Design pointer not found', { productId, requirementId, pageId, variant });
    }
    await this.setDesignPointerLocked(productId, { ...current, version: targetVersion });
  }
```

> 设计说明：本任务**只动指针**，不校验目标 version 是否在盘（落到 P4 的 rollback 工具里联动 `listArtifactVersions`），保持 P1 纯存储原语。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/product-design-pointer.test.ts && npx vitest run packages/core/tests/product-config.test.ts`
Expected: PASS（指针用例通过；现有 product 用例不回归）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/product.ts packages/core/tests/product-design-pointer.test.ts
git commit -m "feat(core): add current-version design pointer index with uniqueness + rollback"
```

---

## Task A6: 幂等补齐脚本（旧 artifact → 新字段/kind + 建指针）

**Files:**
- Create: `packages/core/src/backfill-design-artifacts.ts`
- Test: `packages/core/tests/backfill-design-artifacts.test.ts`

- [ ] **Step 1: 写失败测试（用合成的旧 artifact fixture，非真实数据）**

```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFormaStore } from '../src/index.js';
import { backfillDesignArtifacts } from '../src/backfill-design-artifacts.js';

async function seedLegacyArtifact(home: string, productId: string, artifactId: string, kind: string, requirementId?: string) {
  const dir = join(home, 'data', 'products', productId, 'od-project', 'artifacts', artifactId);
  await mkdir(dir, { recursive: true });
  const manifest = {
    version: 1, id: artifactId, kind, renderer: kind === 'design-system' ? 'design-system' : 'html',
    title: 'Legacy', entry: 'index.html', status: 'complete', exports: ['index.html'],
    ...(requirementId ? { requirementId } : {}),
    createdAt: '2026-05-28T00:00:00.000Z', updatedAt: '2026-05-28T00:00:00.000Z',
  };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await writeFile(join(dir, 'index.html'), '<h1>legacy</h1>', 'utf8');
}

async function makeStore() {
  const home = await mkdtemp(join(tmpdir(), 'forma-backfill-'));
  await writeFile(join(home, '.v6-schema-cutover-committed'), 'committed\n', 'utf8');
  return createFormaStore({ home });
}

describe('A6 backfill', () => {
  it('migrates legacy html→design-page (with variant=default) and design-system→component-library', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    await seedLegacyArtifact(store.home, p.id, 'AbCdEfGhIjKlMnOp', 'html', 'R-1234abcd');
    await seedLegacyArtifact(store.home, p.id, 'CcCdEfGhIjKlMnOp', 'design-system');

    const report = await backfillDesignArtifacts({ home: store.home });
    expect(report.migrated).toBe(2);

    const dir = join(store.home, 'data', 'products', p.id, 'od-project', 'artifacts');
    const pageManifest = JSON.parse(await readFile(join(dir, 'AbCdEfGhIjKlMnOp', 'v1', 'manifest.json'), 'utf8'));
    expect(pageManifest.kind).toBe('design-page');
    expect(pageManifest.forma.variant).toBe('default');
    expect(pageManifest.forma.requirementId).toBe('R-1234abcd');

    const libManifest = JSON.parse(await readFile(join(dir, 'CcCdEfGhIjKlMnOp', 'v1', 'manifest.json'), 'utf8'));
    expect(libManifest.kind).toBe('component-library');
  });

  it('is idempotent: re-running makes no further changes', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    await seedLegacyArtifact(store.home, p.id, 'AbCdEfGhIjKlMnOp', 'html', 'R-1234abcd');
    const first = await backfillDesignArtifacts({ home: store.home });
    const second = await backfillDesignArtifacts({ home: store.home });
    expect(first.migrated).toBe(1);
    expect(second.migrated).toBe(0);
  });

  it('builds a design pointer for migrated design-page artifacts', async () => {
    const store = await makeStore();
    const p = await store.products.createProduct({ name: 'X', description: 'y' });
    await seedLegacyArtifact(store.home, p.id, 'AbCdEfGhIjKlMnOp', 'html', 'R-1234abcd');
    await backfillDesignArtifacts({ home: store.home });
    const pointers = await store.products.listDesignPointers(p.id);
    expect(pointers).toHaveLength(1);
    expect(pointers[0]).toMatchObject({ requirementId: 'R-1234abcd', variant: 'default', version: 1 });
  });
});
```

> ⚠️ page_id 推断（现实增量 #6）：旧 artifact 是 requirement 级、无 page_id。脚本采用 best-effort：`pageId = legacy.requirementId ?? artifactId`（合成可读键，并在 report.notes 记录"page_id 为推断值"）。greenfield 下无真实数据受影响。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/backfill-design-artifacts.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`packages/core/src/backfill-design-artifacts.ts`：

```ts
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getArtifactsDir, getArtifactVersionDir } from './artifact-paths.js';
import { getFormaPaths } from './paths.js';
import { normalizeKind, validateArtifactManifest, type ArtifactManifest } from './artifact-manifest.js';
import { ProductService } from './product.js';

export interface BackfillOptions { home: string; }
export interface BackfillReport { migrated: number; skipped: number; notes: string[]; }

/**
 * 幂等补齐：把旧扁平 artifact（manifest.json 在 artifacts/{id}/）迁为版本化 v1/，
 * kind 归一（html→design-page / design-system→component-library），
 * 补 forma.variant=default + forma.requirementId（若有），并建当前版本指针。
 * 已是 v{n} 布局的（含 forma）视为已迁移，跳过。
 */
export async function backfillDesignArtifacts(options: BackfillOptions): Promise<BackfillReport> {
  const report: BackfillReport = { migrated: 0, skipped: 0, notes: [] };
  const products = new ProductService({ home: options.home });
  const productsRoot = getFormaPaths(options.home).productsDir; // = home/data/products

  let productIds: string[];
  try {
    productIds = (await readdir(productsRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && /^P-[a-f0-9]{6}$/.test(e.name)).map((e) => e.name);
  } catch { return report; }

  for (const productId of productIds) {
    const artifactsDir = getArtifactsDir(productsRoot, productId);
    let artifactIds: string[];
    try {
      artifactIds = (await readdir(artifactsDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith('.tmp-')).map((e) => e.name);
    } catch { continue; }

    for (const artifactId of artifactIds) {
      const flatManifest = join(artifactsDir, artifactId, 'manifest.json');
      const isFlat = await fileExists(flatManifest);
      if (!isFlat) { report.skipped += 1; continue; } // 已是版本化布局

      const legacy = JSON.parse(await readFile(flatManifest, 'utf8')) as ArtifactManifest & { requirementId?: string };
      const newKind = normalizeKind(legacy.kind);
      const requirementId = legacy.requirementId;
      const isDesignPage = newKind === 'design-page';
      const pageId = requirementId ?? artifactId; // best-effort（见 plan 现实增量 #6）

      const migrated: ArtifactManifest = {
        ...legacy,
        kind: newKind,
        forma: {
          ...(legacy.forma ?? {}),
          ...(isDesignPage ? { requirementId, pageId, variant: legacy.forma?.variant ?? 'default' } : {}),
        },
      };
      const validation = validateArtifactManifest(migrated);
      if (!validation.ok) { report.notes.push(`skip ${artifactId}: ${validation.error}`); report.skipped += 1; continue; }

      // 把整个旧目录搬进 v1/（原子 rename：先建临时 v1 同级再移）
      const versionDir = getArtifactVersionDir(productsRoot, productId, artifactId, 1);
      await moveLegacyDirIntoV1(join(artifactsDir, artifactId), versionDir, migrated);
      report.migrated += 1;

      if (isDesignPage && requirementId) {
        await products.setDesignPointerLocked(productId, {
          requirementId, pageId, variant: 'default', artifactId, version: 1, designStatus: 'active',
        });
      }
    }
  }
  return report;
}

async function moveLegacyDirIntoV1(artifactDir: string, versionDir: string, migratedManifest: ArtifactManifest): Promise<void> {
  await mkdir(versionDir, { recursive: true });
  for (const entry of await readdir(artifactDir, { withFileTypes: true })) {
    if (entry.name === 'manifest.json') continue;                 // 重写后写新 manifest
    if (/^v\d+$/.test(entry.name)) continue;                       // 已有版本目录不动（含刚建的 v1）
    await rename(join(artifactDir, entry.name), join(versionDir, entry.name));
  }
  await writeFile(join(versionDir, 'manifest.json'), JSON.stringify(migratedManifest, null, 2), 'utf8');
  await rm(join(artifactDir, 'manifest.json'), { force: true });
}

async function fileExists(file: string): Promise<boolean> {
  try { await stat(file); return true; } catch { return false; }
}
```

> 并发安全：backfill 是一次性离线脚本，`setDesignPointerLocked` 在此**不另加锁**（单线程顺序执行）。不要用 `createFormaStore` 跑 backfill——它在构造时跑 `validateStrictStoreReadModels`，会在半迁移/旧数据上抛错；故直接 `new ProductService({ home })`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/backfill-design-artifacts.test.ts`
Expected: PASS（迁移 + 幂等 + 建指针）

- [ ] **Step 5: 导出 + 提交**

在 `packages/core/src/index.ts` 导出 `backfillDesignArtifacts`、`normalizeKind`、`normalizeFormaExtension`、版本路径助手、`validateAssetsAgainstSupportingFiles`、`DesignPointer` 类型（按现有 index 导出风格补）。

```bash
git add packages/core/src/backfill-design-artifacts.ts packages/core/src/index.ts packages/core/tests/backfill-design-artifacts.test.ts
git commit -m "feat(core): idempotent backfill of legacy artifacts to versioned design-page model"
```

- [ ] **Step 6: Part A 收口校验**

Run: `pnpm --filter @xenonbyte/forma-core test && pnpm --filter @xenonbyte/forma-core typecheck`
Expected: 全绿（A1–A6 全通过、无类型错误、现有 core 用例不回归）

---

# Part B — P2：内容迁移（craft + styles）

> ⚠️ B 组的 B5（styles.ts）与 B6（product config）改 `styleMetadataSchema` 与 `productSchema`，会**破坏现有依赖旧 style 格式的测试**（`product-config.test.ts`/`product-session-style.test.ts`/`copy-assets.test.ts`）。按 B1→B2→B3→B4→B5→B6 顺序执行；B5/B6 内含对受影响测试的同步修改步骤。

## Task B1: 迁移 craft 规则 + core 读取 API

**Files:**
- Create: 仓库根 `craft/`（11 内容 md + `README.md` + `LICENSE`/归属）
- Modify: `packages/core/src/styles.ts`（追加 craft 读取，与 styles 同模块）
- Test: `packages/core/tests/craft.test.ts`

- [ ] **Step 1: 拷贝 craft 内容（命令 + 校验）**

```bash
# 从上游冻结 fork 拷入仓库根 craft/（verbatim）
mkdir -p craft
cp /Users/xubo/x-studio/forma2-cankao/open-design/craft/*.md craft/
# 归属：保留上游 LICENSE（Apache 2.0）
cp /Users/xubo/x-studio/forma2-cankao/open-design/LICENSE craft/LICENSE.upstream 2>/dev/null || true
ls -1 craft/
```
Expected: 列出 `README.md accessibility-baseline.md animation-discipline.md anti-ai-slop.md color.md form-validation.md laws-of-ux.md rtl-and-bidi.md state-coverage.md typography-hierarchy-editorial.md typography-hierarchy.md typography.md`（11 内容 + README）。

新建 `craft/ATTRIBUTION.md`：
```markdown
# Attribution
Craft design rules vendored from open-design (`craft/`), Apache License 2.0.
Upstream: https://github.com/<open-design upstream> — frozen at the DESIGN-v8 vendored SHA.
Do not edit content verbatim; treat as read-only knowledge source delivered via MCP.
```

- [ ] **Step 2: 写失败测试**

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StyleService } from '../src/styles.js';

function svc() {
  return new StyleService({ home: '/tmp/forma-craft', bundledStylesDir: resolve('styles'), bundledCraftDir: resolve('craft') });
}

describe('B1 craft reading', () => {
  it('lists all craft docs by slug', async () => {
    const docs = await svc().listCraftDocs();
    const slugs = docs.map((d) => d.slug);
    expect(slugs).toContain('color');
    expect(slugs).toContain('anti-ai-slop');
    expect(slugs).toContain('typography-hierarchy');
    expect(slugs.length).toBeGreaterThanOrEqual(11);
  });
  it('reads a craft doc verbatim by slug', async () => {
    const doc = await svc().readCraftDoc('color');
    expect(doc.slug).toBe('color');
    expect(doc.content.length).toBeGreaterThan(0);
  });
  it('throws on unknown craft slug', async () => {
    await expect(svc().readCraftDoc('does-not-exist')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/craft.test.ts`
Expected: FAIL（`bundledCraftDir`/`listCraftDocs`/`readCraftDoc` 不存在）

- [ ] **Step 4: 实现 craft 读取（追加到 `styles.ts`）**

```ts
// StyleServiceOptions 加：
//   bundledCraftDir?: string;
// 构造器加：
//   this.bundledCraftDir = options.bundledCraftDir ?? getDefaultBundledCraftDir();

export interface CraftDoc { slug: string; content: string; }

function getDefaultBundledCraftDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../craft');
}

// StyleService 方法：
async listCraftDocs(): Promise<CraftDoc[]> {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(this.bundledCraftDir);
  const slugs = entries
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'ATTRIBUTION.md')
    .map((f) => f.replace(/\.md$/, ''));
  return Promise.all(slugs.map((slug) => this.readCraftDoc(slug)));
}

async readCraftDoc(slug: string): Promise<CraftDoc> {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new FormaError('INVALID_INPUT', 'Invalid craft slug', { slug });
  }
  const file = join(this.bundledCraftDir, `${slug}.md`);
  try {
    return { slug, content: await readFile(file, 'utf8') };
  } catch {
    throw new FormaError('INVALID_INPUT', 'Craft doc not found', { slug });
  }
}
```
（`readdir` 可提到顶部 import；此处内联示意。`bundledCraftDir` 加为私有字段。）

(c) 把 `bundledCraftDir` 串进 store 工厂（让 `createFormaStore` 使用者也能用上 craft，并可在测试里覆盖）：在 `packages/core/src/store.ts` 的 `FormaStoreOptions` 加 `bundledCraftDir?: string;`，并在 `createStrictFormaStore` 把 `new StyleService({ home: options.home, bundledStylesDir: options.bundledStylesDir })` 改为 `new StyleService({ home: options.home, bundledStylesDir: options.bundledStylesDir, bundledCraftDir: options.bundledCraftDir })`。默认值由 `getDefaultBundledCraftDir()` 兜（repo 根 `craft/`），故不传也正确。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/craft.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add craft packages/core/src/styles.ts packages/core/src/store.ts packages/core/tests/craft.test.ts
git commit -m "feat(core): vendor craft design rules + add craft reading API"
```

---

## Task B2: 迁移 150 brand 风格（3 文件）+ 重写 styles.yaml

**Files:**
- Replace: 仓库根 `styles/`（删旧 72 个、置入上游 150 brand 三文件）
- Create: 临时迁移脚本 `scripts/migrate-brand-styles.ts`（一次性、产出 `styles/styles.yaml` 新格式）
- Test: `packages/core/tests/styles-catalog.test.ts`

- [ ] **Step 1: 写失败测试（先定新格式契约）**

```ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';

describe('B2 brand styles catalog (new 3-file format)', () => {
  it('styles.yaml lists >=150 brand styles, each with 3 file paths and no variables block', async () => {
    const raw = await readFile(resolve('styles/styles.yaml'), 'utf8');
    const doc = load(raw) as { styles: Array<Record<string, unknown>> };
    expect(doc.styles.length).toBeGreaterThanOrEqual(150);
    for (const s of doc.styles) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.description).toBe('string');
      expect(s.design_md_path).toMatch(/^styles\/[^/]+\/DESIGN\.md$/);
      expect(s.tokens_css_path).toMatch(/^styles\/[^/]+\/tokens\.css$/);
      expect(s.components_html_path).toMatch(/^styles\/[^/]+\/components\.html$/);
      expect(s.variables).toBeUndefined(); // 旧 variables 块已移除
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/styles-catalog.test.ts`
Expected: FAIL（旧 styles.yaml 仍是 `variables` 格式、无 tokens/components 路径）

- [ ] **Step 3: 写一次性迁移脚本并执行**

`scripts/migrate-brand-styles.ts`：

```ts
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dump } from 'js-yaml';

const UPSTREAM = '/Users/xubo/x-studio/forma2-cankao/open-design/design-systems';
const REPO_STYLES = resolve('styles');

interface BrandEntry { name: string; description: string; category?: string; upstream?: string; design_md_path: string; tokens_css_path: string; components_html_path: string; }

async function main() {
  const names = (await readdir(UPSTREAM, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name !== '_schema')
    .map((e) => e.name);

  // 清理旧 brand 目录（保留 LICENSE / _system 等非 brand 资源由后续任务管理）
  for (const e of await readdir(REPO_STYLES, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== '_system') await rm(join(REPO_STYLES, e.name), { recursive: true, force: true });
  }

  const entries: BrandEntry[] = [];
  for (const name of names) {
    const src = join(UPSTREAM, name);
    const files = await readdir(src);
    if (!files.includes('DESIGN.md')) continue; // 只取真正的 brand 风格
    const dst = join(REPO_STYLES, name);
    await mkdir(dst, { recursive: true });
    for (const f of ['DESIGN.md', 'tokens.css', 'components.html']) {
      if (files.includes(f)) await cp(join(src, f), join(dst, f));
    }
    const description = await firstParagraph(join(dst, 'DESIGN.md'));
    entries.push({
      name, description,
      design_md_path: `styles/${name}/DESIGN.md`,
      tokens_css_path: `styles/${name}/tokens.css`,
      components_html_path: `styles/${name}/components.html`,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(join(REPO_STYLES, 'styles.yaml'), dump({ styles: entries }), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`migrated ${entries.length} brand styles`);
}

async function firstParagraph(designMd: string): Promise<string> {
  const text = await readFile(designMd, 'utf8');
  const quote = text.split('\n').find((l) => l.trim().startsWith('>'));
  return (quote ? quote.replace(/^>\s*/, '') : 'Brand design system').slice(0, 200);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
```

执行 + 校验上游归属保留：

```bash
npx tsx scripts/migrate-brand-styles.ts
# 保留上游 MIT 归属
cp /Users/xubo/x-studio/forma2-cankao/open-design/design-systems/README.md styles/ATTRIBUTION.md 2>/dev/null || true
find styles -maxdepth 2 -name DESIGN.md | wc -l   # 期望 >=150
```
Expected: 打印 `migrated 150 brand styles`（或实际发现数）；`styles/<name>/{DESIGN.md,tokens.css,components.html}` 就位；`styles/styles.yaml` 为新格式。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/styles-catalog.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add styles scripts/migrate-brand-styles.ts packages/core/tests/styles-catalog.test.ts
git commit -m "feat(styles): migrate 150 brand styles to 3-file format + new styles.yaml schema"
```

> 注：`styles/` 目录可能被 `.gitignore` 影响——若 `git add styles` 报忽略，用 `git add -f styles`（与本仓库既有 docs/superpowers 情形一致）。先 `git status --short` 确认。

---

## Task B3: 迁移 36 系统风格目录 stub（元数据）

**Files:**
- Create: `styles/_system/system-styles.yaml`（脚本产出）
- Create: 临时脚本 `scripts/migrate-system-styles.ts`
- Test: `packages/core/tests/styles-catalog.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

```ts
describe('B3 system-style catalog stubs', () => {
  it('system-styles.yaml lists all skills with od.mode: design-system (>=36), metadata only', async () => {
    const raw = await readFile(resolve('styles/_system/system-styles.yaml'), 'utf8');
    const doc = load(raw) as { systems: Array<Record<string, unknown>> };
    expect(doc.systems.length).toBeGreaterThanOrEqual(36);
    for (const s of doc.systems) {
      expect(typeof s.name).toBe('string');
      expect(s.mode).toBe('design-system');
      expect(typeof s.description).toBe('string');
      // stub：只有元数据，无三文件
      expect(s.design_md_path).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/styles-catalog.test.ts -t "B3"`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 写脚本（解析 frontmatter）并执行**

`scripts/migrate-system-styles.ts`：

```ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dump } from 'js-yaml';

const SKILLS = '/Users/xubo/x-studio/forma2-cankao/open-design/skills';
const OUT = resolve('styles/_system');

interface SystemStub { name: string; description: string; mode: 'design-system'; category?: string; upstream?: string; }

function frontmatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  // od.mode 在嵌套块；用宽匹配
  if (/mode:\s*design-system/.test(md)) out['od_mode'] = 'design-system';
  const cat = /category:\s*(.+)/.exec(md); if (cat) out['od_category'] = cat[1].trim();
  const up = /upstream:\s*"?([^"\n]+)"?/.exec(md); if (up) out['od_upstream'] = up[1].trim();
  return out;
}

async function main() {
  const names = (await readdir(SKILLS, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  const systems: SystemStub[] = [];
  for (const name of names) {
    let md: string;
    try { md = await readFile(join(SKILLS, name, 'SKILL.md'), 'utf8'); } catch { continue; }
    if (!/mode:\s*design-system/.test(md)) continue;
    const fm = frontmatter(md);
    systems.push({
      name,
      description: (fm['description'] ?? name).slice(0, 200),
      mode: 'design-system',
      ...(fm['od_category'] ? { category: fm['od_category'] } : {}),
      ...(fm['od_upstream'] ? { upstream: fm['od_upstream'] } : {}),
    });
  }
  systems.sort((a, b) => a.name.localeCompare(b.name));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'system-styles.yaml'), dump({ systems }), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`migrated ${systems.length} system-style stubs`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
```

```bash
npx tsx scripts/migrate-system-styles.ts   # 期望 migrated 36 system-style stubs
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/styles-catalog.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add styles/_system scripts/migrate-system-styles.ts packages/core/tests/styles-catalog.test.ts
git commit -m "feat(styles): migrate system-style catalog stubs (od.mode design-system)"
```

---

## Task B4: 重构 `styles.ts` —— 新 `styleMetadataSchema` + 按类型返回

**Files:**
- Modify: `packages/core/src/styles.ts`
- Test: `packages/core/tests/styles.test.ts`（已存在则改，否则新建）

- [ ] **Step 1: 写失败测试**

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StyleService } from '../src/styles.js';

function svc() {
  return new StyleService({ home: '/tmp/forma-styles', bundledStylesDir: resolve('styles'), bundledCraftDir: resolve('craft') });
}

describe('B4 styles.ts new format', () => {
  it('listStyles returns >=150 brand styles, no variables field', async () => {
    const styles = await svc().listStyles();
    expect(styles.length).toBeGreaterThanOrEqual(150);
    const ant = styles.find((s) => s.name === 'ant');
    expect(ant).toBeDefined();
    expect((ant as Record<string, unknown>).variables).toBeUndefined();
    expect(ant?.tokens_css_path).toBe('styles/ant/tokens.css');
  });

  it('getStyle returns 3 files for a brand style', async () => {
    const r = await svc().getStyle('ant');
    expect(r.kind).toBe('brand');
    expect(r.designMd.length).toBeGreaterThan(0);
    expect(r.tokensCss).toContain('--accent');
    expect(r.componentsHtml.length).toBeGreaterThan(0);
  });

  it('listSystemStyles returns >=36 catalog stubs', async () => {
    const systems = await svc().listSystemStyles();
    expect(systems.length).toBeGreaterThanOrEqual(36);
    expect(systems[0].mode).toBe('design-system');
  });

  it('getStyle throws for unknown style', async () => {
    await expect(svc().getStyle('nope')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/styles.test.ts`
Expected: FAIL（旧 `styleMetadataSchema` 含 variables、`getStyle` 返回 designMd 单文件）

- [ ] **Step 3: 实现 —— 重写 styles.ts schema 与方法**

替换 `styleVariablesSchema`/`styleMetadataSchema`/`getStyle`/`withDefaultVariables`：

```ts
// 删除 styleVariablesSchema、defaultVariables、withDefaultVariables

export const styleMetadataSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().optional(),
  upstream: z.string().optional(),
  design_md_path: styleDesignPathSchema,                 // styles/<name>/DESIGN.md
  tokens_css_path: z.string().min(1),
  components_html_path: z.string().min(1),
}).strict();

export const systemStyleSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  mode: z.literal('design-system'),
  category: z.string().optional(),
  upstream: z.string().optional(),
}).strict();

export const stylesIndexSchema = z.object({
  last_synced: z.string().optional(),
  styles: z.array(styleMetadataSchema),
});
export const systemStylesIndexSchema = z.object({
  systems: z.array(systemStyleSchema),
});

export type StyleMetadata = z.infer<typeof styleMetadataSchema>;
export type SystemStyleMetadata = z.infer<typeof systemStyleSchema>;
export interface BrandStyleContent { kind: 'brand'; metadata: StyleMetadata; designMd: string; tokensCss: string; componentsHtml: string; }
```

`getStyle` 改为读三文件：

```ts
async getStyle(name: string): Promise<BrandStyleContent> {
  const metadata = (await this.listStyles()).find((s) => s.name === name);
  if (!metadata) throw new FormaError('INVALID_INPUT', 'Style not found', { style: name });
  const [designMd, tokensCss, componentsHtml] = await Promise.all([
    readFile(this.safeHomeStylePath(metadata.design_md_path), 'utf8'),
    readFile(this.safeHomeStylePath(metadata.tokens_css_path), 'utf8'),
    readFile(this.safeHomeStylePath(metadata.components_html_path), 'utf8'),
  ]);
  return { kind: 'brand', metadata, designMd, tokensCss, componentsHtml };
}

async listSystemStyles(): Promise<SystemStyleMetadata[]> {
  const file = join(this.stylesDir, '_system', 'system-styles.yaml');
  if (!(await fileExists(file))) {
    // 首装从 bundled 拷贝（与 installBuiltInStyles 一致）
    return (await readYamlAs(join(this.bundledStylesDir, '_system', 'system-styles.yaml'), systemStylesIndexSchema)).systems;
  }
  return (await readYamlAs(file, systemStylesIndexSchema)).systems;
}
```

`styleDesignPathSchema` 的 `isSafeStyleDesignPath` 仍要求 `styles/` 前缀；`tokens_css_path`/`components_html_path` 同样经 `safeHomeStylePath` 夹紧，无需额外正则（已含 `styles/` 边界检查）——但为安全应对 tokens/components 路径同样 `startsWith('styles/')` 校验：在 `safeHomeStylePath` 已校验 `stylesRoot` 边界，足够。

- [ ] **Step 4: 修复编译断点 —— product.ts 仍 import `styleMetadataSchema`**

`product.ts` 的 `style: styleMetadataSchema.optional()` 暂时仍可编译（新 schema 仍叫 `styleMetadataSchema`）。**但语义将在 B6 改为 brand_style/system_style**——本步只确保 `styles.ts` 改完后 `pnpm --filter @xenonbyte/forma-core typecheck` 找出所有 `withDefaultVariables`/`variables` 的引用点，逐个在调用处改/删。

Run: `pnpm --filter @xenonbyte/forma-core typecheck`
Expected: 列出所有断点（如 `product-config.test.ts` 用 `withDefaultVariables`）。在 B6 统一修复测试；本步只改**源码**引用（非测试）。

- [ ] **Step 5: 跑测试确认通过（仅 styles.test.ts，勿跑全量 core）**

Run: `npx vitest run packages/core/tests/styles.test.ts`
Expected: PASS

> ⚠️ 红窗说明：本步删了 `withDefaultVariables`，`product-config.test.ts`/`product-session-style.test.ts` 会**编译/运行失败**，直到 B6 改完。故 B4–B5 期间**只跑 scoped 测试**（`styles.test.ts`/`copy-assets.test.ts`），**不要**跑 `pnpm --filter @xenonbyte/forma-core test`（全量）——全量绿在 B6 Step 7 收口。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/styles.ts packages/core/tests/styles.test.ts
git commit -m "refactor(core): styles.ts to 3-file brand format + system-style catalog, drop variables"
```

---

## Task B5: 改造 `scripts/copy-assets.ts`（新格式校验 + craft 拷贝）

**Files:**
- Modify: `scripts/copy-assets.ts`
- Test: `packages/cli/tests/copy-assets.test.ts`（已存在，改）

- [ ] **Step 1: 改测试以反映新契约（先红）**

把 `packages/cli/tests/copy-assets.test.ts` 中对旧格式（`variables` 7 键 / `preview@2x.png`）的断言改为新格式：每个 brand 校验 `DESIGN.md`+`tokens.css`+`components.html` 存在；新增 craft 拷贝条目断言（`cli/dist/assets/craft/color.md` 等）。具体断言对齐 `copy-assets.ts` 改后导出的校验函数。

（最小集示例）：

```ts
it('assertBuiltInStyles validates 3-file brand format', async () => {
  const styles = await assertBuiltInStyles(resolve('styles'));
  expect(styles.length).toBeGreaterThanOrEqual(150);
});
it('copyAssets includes craft', async () => {
  // 断言 assetCopies 含 label 'craft'，source=craft, target=cli/dist/assets/craft
  expect(assetCopies.some((c) => c.label === 'craft')).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/cli/tests/copy-assets.test.ts`
Expected: FAIL（旧校验仍查 `preview@2x.png`/variables；无 craft 条目）

- [ ] **Step 3: 实现 copy-assets.ts 改造**

(a) `assetCopies` 增加 craft 条目，并 **export `assetCopies`**（B5 测试 `import { assetCopies }` 断言含 craft；现为模块内未导出 const，改 `export const assetCopies`）：

```ts
export const assetCopies: AssetCopy[] = [
  // ...existing agent templates / styles / web dist...
  {
    label: "craft",
    source: resolve(repoRoot, "craft"),
    target: resolve(repoRoot, "packages/cli/dist/assets/craft")
  },
];
```

(b) `requiredStyleVariableKeys` 删除；`assertBuiltInStyles` 改为校验三文件存在、不再校验 `preview@2x.png`/variables：

```ts
    assertSafeStyleDesignPath(style); // 仍校验 styles/<name>/DESIGN.md
    const styleDir = resolve(stylesDir, style.name);
    assertPathInside(stylesDir, styleDir);
    await access(resolve(styleDir, "DESIGN.md"), constants.F_OK);
    await access(resolve(styleDir, "tokens.css"), constants.F_OK);
    await access(resolve(styleDir, "components.html"), constants.F_OK);
```

(c) `parseStyleIndex` 重写为读 `design_md_path`/`tokens_css_path`/`components_html_path`，删 `variables` 解析；`BuiltInStyleAsset` 增 `tokensCssPath`/`componentsHtmlPath`。鉴于 `js-yaml` 已是依赖，**直接用 `load()` 解析 styles.yaml** 替换手写行解析器（更稳）：

```ts
import { load } from 'js-yaml';
function parseStyleIndex(source: string): BuiltInStyleAsset[] {
  const doc = load(source) as { styles?: Array<Record<string, string>> };
  if (!doc?.styles || !Array.isArray(doc.styles)) throw new Error('Expected styles/styles.yaml to contain a styles list');
  return doc.styles.map((s) => {
    if (!s.name || !s.description || !s.design_md_path || !s.tokens_css_path || !s.components_html_path) {
      throw new Error(`Incomplete built-in style entry: ${JSON.stringify(s)}`);
    }
    return { name: s.name, description: s.description, designMdPath: s.design_md_path, tokensCssPath: s.tokens_css_path, componentsHtmlPath: s.components_html_path };
  });
}
```
（`assertSafeStyleDesignPath` 保留 3 段 `styles/<name>/DESIGN.md` 校验；为 tokens/components 增同样的 `styles/<name>/...` 边界校验或复用现有 `assertPathInside`。）

(d) `checkAssets` 里对 craft 增一个 `assertCraftAssets`（拷后 `cli/dist/assets/craft/color.md` 存在）。

- [ ] **Step 4: 跑测试 + 实跑拷贝校验**

Run:
```bash
npx vitest run packages/cli/tests/copy-assets.test.ts
npx tsx scripts/copy-assets.ts            # 实跑拷贝
npx tsx scripts/copy-assets.ts --check    # 校验拷贝产物
```
Expected: 测试 PASS；拷贝打印 `copied styles` / `copied craft`；`--check` 通过。

- [ ] **Step 5: 提交**

```bash
git add scripts/copy-assets.ts packages/cli/tests/copy-assets.test.ts
git commit -m "build: copy-assets supports 3-file styles + craft bundle"
```

---

## Task B6: 产品配置拆 `brand_style` + `system_style`

**Files:**
- Modify: `packages/core/src/product.ts`（承 A5）
- Modify: `packages/core/tests/product-config.test.ts`、`packages/core/tests/product-session-style.test.ts`（及其他引用旧 `style`/`withDefaultVariables` 的测试）
- Test: 同上 + 新增 `product-config` 断言

- [ ] **Step 1: 写/改失败测试**

在 `product-config.test.ts` 改为新配置形态（`brand_style` 字符串 + 可选 `system_style`，删 `withDefaultVariables`）：

```ts
it('writes brand_style and optional system_style to product.yaml', async () => {
  const store = await createTestStore();
  const product = await store.products.createProduct({ name: 'Checkout App', description: 'Mobile checkout' });
  await store.products.initProductConfig(product.id, {
    platform: 'web', brand_style: 'ant', system_style: 'shadcn-ui',
    languages: ['en', 'zh-CN'], default_language: 'en',
  });
  const productYaml = await readYaml(join(store.home, 'data', product.id, 'product.yaml'));
  expect(productYaml).toMatchObject({ platform: 'web', brand_style: 'ant', system_style: 'shadcn-ui' });
});

it('assertProductConfig flags missing brand_style', async () => {
  // assertProductConfig(product, id, ['brand_style']) 在缺 brand_style 时抛 PRODUCT_CONFIG_INCOMPLETE
});
```

`createTestStore` 已用 `bundledStylesDir: resolve("styles")`。product-config 测试**不碰 craft**，无需为它传 `bundledCraftDir`（craft 串接已在 B1 完成，默认值兜底）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/core/tests/product-config.test.ts`
Expected: FAIL（schema 仍是单 `style`）

- [ ] **Step 3: 实现 product.ts 配置拆分**

(a) `productSchema.extend(...)`：把 `style: styleMetadataSchema.optional()` 替换为：

```ts
  brand_style: z.string().min(1).optional(),
  system_style: z.string().min(1).optional(),
```
（删除 `style` 与 `import { styleMetadataSchema }`，除非别处仍需。`designSystemArtifactId` 保留。）

> ⚠️ A5 已在**同一个** `productSchema.extend({...})` 加了 `designPointers` 字段、在**同一个** `superRefine` 回调里加了指针唯一性校验。B6 只替换 `style` 这一行，**务必保留** A5 的 `designPointers` 与唯一性校验，勿整体覆盖。

(b) `productConfigSchema`：

```ts
const productConfigSchema = z.object({
  platform: z.enum(platforms),
  brand_style: z.string().min(1),
  system_style: z.string().min(1).optional(),
  languages: z.array(z.enum(languages)).min(1),
  default_language: z.enum(languages),
}).superRefine((config, context) => {
  if (!config.languages.includes(config.default_language)) {
    context.addIssue({ code: 'custom', message: 'default_language must be included in languages', path: ['default_language'] });
  }
});
```

(c) `ProductConfigField` 由 `"platform" | "style" | "languages"` 改为 `"platform" | "brand_style" | "languages"`；`isProductConfigFieldIncomplete` 的 `case "style"` 改 `case "brand_style"`（判 `product.brand_style === undefined`）。

- [ ] **Step 4: 扫描并修复所有受影响调用点/测试**

Run: `pnpm --filter @xenonbyte/forma-core typecheck`
逐个修复报错点（`product-session-style.test.ts`、MCP/server 若引用 `product.style` —— 但 MCP/server 改属 P4/P8，本批只保证 **core 包**编译与测试通过；若 server/mcp 因 core 类型变更编译失败，在本任务用最小适配桩或标注 TODO(P4) 不在本批扩散。优先 `pnpm --filter @xenonbyte/forma-core` 范围绿）。

> ⚠️ 跨包影响：`packages/mcp`、`packages/server`、`packages/web` 可能引用 `product.style`/旧 style 形态。本批（P1+P2）**只承诺 core 包 + copy-assets 绿**；其余包的适配属 P4/P8。若 `pnpm typecheck`（全量）因此变红，在本 plan 收口处记录为"已知、归 P4/P8"，不在本批强行改它们的业务逻辑。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run packages/core/tests/product-config.test.ts packages/core/tests/product-session-style.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/product.ts packages/core/tests/product-config.test.ts packages/core/tests/product-session-style.test.ts
git commit -m "feat(core): split product config style into brand_style + system_style"
```

- [ ] **Step 7: Part B 收口校验**

Run: `pnpm --filter @xenonbyte/forma-core test && pnpm --filter @xenonbyte/forma-core typecheck && npx tsx scripts/copy-assets.ts --check`
Expected: core 全绿、copy-assets 校验通过。全量 `pnpm typecheck` 若因 mcp/server/web 引用旧 style 而红，记录归 P4/P8（不在本批修复）。

---

## 整批 Definition of Done（P1+P2）

- **Part A**：A1–A6 全通过；`manifest.forma.*` 加性校验生效（旧 manifest 仍过）、新 kind + `normalizeKind` 就位；`v{n}` 版本读写 + 版本列举可用；`assets ⊆ supportingFiles` 校验可用；当前版本指针索引（唯一性 + rollback 改指针不删旧版本）可用；幂等补齐脚本对合成旧 fixture 迁移 + 幂等 + 建指针通过。`pnpm --filter @xenonbyte/forma-core test`/`typecheck` 全绿。
- **Part B**：craft 11 文件 + 归属落地、core 可 `listCraftDocs`/`readCraftDoc`；150 brand 三文件 + 新 `styles.yaml` 就位；36 系统风格目录 stub 就位；`styles.ts` 新格式（按类型返回 brand 三文件 / system 元数据、无 `variables`）；`copy-assets.ts` 新格式校验 + craft 拷贝 + `--check` 通过；产品配置拆 `brand_style`+`system_style`。core 包测试/typecheck 绿。
- **已知跨批缺口（不在本批修复，归后续 phase）**：(1) generate→save 管线、预览渲染、读取面 A–G 属 P3/P4；(2) `mcp`/`server`/`web` 对旧 `product.style` 形态的适配属 P4/P8；本批若令全量 `pnpm typecheck` 变红，在 PR 描述里显式标注归属，勿在本批扩散修改它们的业务逻辑。
- **许可归属**：`craft/`（Apache 2.0）与 `styles/`（MIT，源 `bergside/awesome-design-skills`）随包保留 LICENSE/ATTRIBUTION，记录上游冻结 SHA。

---

## Self-Review（写后自查）

- **Spec 覆盖**：P1 的 manifest 扩字段(A1)/版本布局(A2-A3)/assets 清单(A4)/指针索引(A5)/补齐脚本(A6) 全部有任务；P2 的 craft(B1)/150 brand(B2)/系统 stub(B3)/styles.ts(B4)/copy-assets(B5)/产品配置拆分(B6) 全部有任务。`preview` 字段仅在 A1 定义 schema、不渲染（渲染归 P3/P4，已在边界说明）。✅
- **现实增量**：152→150、17→36、styles 旧格式整体替换、craft 新建、manifest JSON/camelCase、greenfield backfill、design_status 不移除、kind 加性归一——均在开头显式列出并据实编码。✅
- **类型一致性**：`ArtifactFormaExtension`/`normalizeKind`/`normalizeFormaExtension`(A1) 在 A6 backfill 复用；`getArtifactVersion*`(A2) 在 A3/A6 复用；`DesignPointer`/`setDesignPointerLocked`(A5) 在 A6 复用；`styleMetadataSchema` 新形(B4) 被 B5 copy-assets 校验与 B6 产品配置一致引用（B6 改为按 name 字符串引用，不再内嵌 metadata，故无 variables 残留）。✅
- **占位扫描**：无 TBD/TODO 充数；唯一显式 best-effort 是 backfill 的 page_id 推断（现实增量 #6，已说明 + 记入 report.notes）；跨包 typecheck 缺口已显式归属 P4/P8（非占位，是作用域边界）。✅
- **执行顺序**：A1→A6 先行（A5 改 productSchema），B1→B6 续（B6 在 A5 基础上再改 productSchema）。两 Part 各自有收口校验。✅
