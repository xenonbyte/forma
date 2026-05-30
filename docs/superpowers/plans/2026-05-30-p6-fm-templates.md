# P6 — fm-* 设计技能模板（薄胶水，三平台）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 启用三个设计生成技能命令 `fm-design` / `fm-refine-components` / `fm-change-style`，在 claude/codex/gemini 三平台各落一份**薄胶水**模板：编排 P4 的 MCP 工具（生成前 `get_design_context` / `get_style`、生成后 save）、不内联 craft 知识、并**强制 self-review**（读回 `manifest.forma.quality.craftChecks`，违规重生成 + prose craft 清单）。同时把现有 `fm-rollback-design` 模板同步到 P4 的 page/variant/version rollback 语义。

**Architecture:** 模板是纯 prose 胶水，知识本体仍由 MCP 即时下发。安装器是**数据驱动**的：`InstallService.installCommandTemplates`（`packages/core/src/install.ts`）遍历 `formaInstallCommands` × 平台元数据，把 `templates/{platform}/<pattern>` 拷到目标路径。所以「启用一个命令」= 在 `formaInstallCommands`（install 真源）+ `formaAgentCommands`（agent 镜像）注册 + 为三平台各建一份模板。**但现状不是从零**：这三个命令此刻被测试**显式禁止**——`copy-assets.test.ts` 的 `disabledRuntimeCommands` 与 `install.test.ts` 的 `removedLegacyCommands` 断言它们的模板不存在、且命令数组里没有它们。P6 的核心是**把它们从「禁用」翻到「启用」**：建模板 + 注册 + 翻转这些测试守卫。

**Tech Stack:** TypeScript ESM、Vitest（node env）、Markdown / TOML 模板。无新依赖、不改安装器逻辑（只改它遍历的命令数组）。

**锁定决策（实现期对照，勿偏离）：**
1. **self-review = 读回 craftChecks + 重生成**（用户定）：save 后调 `get_product_artifact` 读 `manifest.forma.quality.craftChecks`，任一 `passed:false` → 针对该违规修 HTML 并**重新调用对应 save 工具**（Forma 让该 page/variant 当前指针指向修正稿，旧稿被 supersede）；再叠加 prose craft 清单覆盖 lint 判不了的项。
2. **fm-refine-components 知识下发 = `get_style` + 内嵌 craft 清单**（用户定）：组件库无 requirement，`get_design_context` 用不了 → 调 `get_style(brand_style)` 取 `DESIGN.md`+`tokens.css`+`components.html`；craft 自检项作为 prose 内嵌。**不改 MCP**。
3. **fm-design 步数（master Q2）**：无参全量 = 三步（plan→generate→self-review）；带变更描述 = 单步（定位→只重生成该页→self-review，不弱化 self-review）。
4. **调用顺序硬约束（架构要点 2）**：context 工具（`get_design_context` 或 `get_style`）在生成**前**调；save 工具在生成**后**调。模板绝不在 save 之后才取 context。
5. **入参用 `brand_style`+`system_style`**（不是旧 `style`）。
6. **纯静态契约**：生成的 HTML 无 `<script>` / 内联 `on*` / `javascript:` / 外链脚本样式；图片以 `data:` 内联；无远程 URL。
7. **模板格式必须照现有约定**（被测试断言）：
   - 每平台模板正文含一行 `# Forma route: <command>`（`install.test.ts` / `copy-assets.test.ts` 断言）。
   - 引用共享文档用 `Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.`。
   - **codex** 模板必须以**精确** frontmatter 开头：`---\nname: <command>\ndescription: <DESC>\n---\n`，且含 `Codex route: \`$<command>\``；`<DESC>` 必须与 `copy-assets.test.ts` 的 `codexSkillDescriptions[command]` 字面一致。
   - **claude** 模板以 `---\ndescription: <DESC>\n---` frontmatter 开头（与现有 claude 模板一致）。
   - **gemini** 模板为 `description = "<DESC>"` + `prompt = """..."""`，prompt 内含 `# Forma route: <command>`。
8. **两个命令数组必须始终相等**：`formaInstallCommands`（install.ts）与 `formaAgentCommands`（agent/src/index.ts）—— `copy-assets.test.ts` 的 `agent template inventory` 断言两者都等于同一列表、且三平台模板目录列举（`sourceCommands`）也等于该列表。故**每个 task 必须同步**：建三平台模板 + 两个 src 数组 + 两处测试命令数组 + 移出禁用列表，一次到位（否则 `sourceCommands` 相等断言会红）。
9. **shared SKILL.md 禁词**：`copy-assets.test.ts` 断言 shared SKILL.md `not.toContain("generate_components")` 且 `not.toContain("set_current_session")`。P6.4 给 shared 加 self-review 指引时**不得**出现 `generate_components` 字面（用命令名 `fm-refine-components` 或描述性措辞）。
10. **`fm-refine-design` 永久移除**：它是更早的遗留名、不在本期三命令内，保留在两处测试的「removed」列表里。
11. **fm-rollback-design 必须先修**：现有模板仍是旧 `target_artifact_id` 语义；P6.0 先同步到 P4 当前 schema：`rollback_requirement_design(product_id, requirement_id, page_id, variant?, target_version)`，并更新测试禁止旧字段。

---

## File Structure

新增模板（3 命令 × 3 平台 = 9 文件，命名/格式照 `fm-rollback-design` 现有模板）：

| 文件 |
|---|
| `packages/agent/templates/claude/fm-design.md` |
| `packages/agent/templates/codex/fm-design/SKILL.md` |
| `packages/agent/templates/gemini/fm-design.toml` |
| `packages/agent/templates/claude/fm-refine-components.md` |
| `packages/agent/templates/codex/fm-refine-components/SKILL.md` |
| `packages/agent/templates/gemini/fm-refine-components.toml` |
| `packages/agent/templates/claude/fm-change-style.md` |
| `packages/agent/templates/codex/fm-change-style/SKILL.md` |
| `packages/agent/templates/gemini/fm-change-style.toml` |

修改：
| 文件 | 改动 |
|---|---|
| `packages/agent/templates/claude/fm-rollback-design.md` | P6.0 更新为 page/variant/version rollback 语义 |
| `packages/agent/templates/codex/fm-rollback-design/SKILL.md` | P6.0 更新为 page/variant/version rollback 语义 |
| `packages/agent/templates/gemini/fm-rollback-design.toml` | P6.0 更新为 page/variant/version rollback 语义 |
| `packages/core/src/install.ts` | `formaInstallCommands` 追加 3 命令 |
| `packages/agent/src/index.ts` | `formaAgentCommands` 追加 3 命令 |
| `packages/core/tests/install.test.ts` | `commands` 加 3；`removedLegacyCommands` 收缩为 `["fm-refine-design"]` |
| `packages/cli/tests/copy-assets.test.ts` | P6.0 更新 rollback 断言；后续 `formaCommands` 加 3、移除 `disabledRuntimeCommands` 的对应项 + 其断言循环、`codexSkillDescriptions` 加 3 条 |
| `packages/agent/templates/shared/SKILL.md` | P6.4 拆分页面/组件取知识指引，并增 self-review（craftChecks 读回）指引，避开禁词 |

新增测试：
- `packages/cli/tests/design-commands.test.ts` — 跨平台校验设计命令模板的胶水语义：调用顺序（context 工具 → save 工具）、引用正确 save 工具、用 `brand_style`+`system_style`、含 self-review（`get_product_artifact` + `craftChecks`）。

**约束/纪律：**
- 模板**薄**：编排 + 契约 + self-review，不复制 craft 知识本体。
- 安装器逻辑零改动；只改它遍历的命令数组。
- `grep` 在本 shell 偶发不可用，用 `rg` / `node -e` / Read 代替。
- 各 task 末尾跑 install/copy-assets 测试确认守卫全绿；最终集成在 P6.4。
- 三平台同一命令的步骤文案保持一致（仅 frontmatter / 平台路由行不同）。
- 先执行 P6.0；当前 rollback 模板与 P4 MCP schema 不兼容，不修会让已安装命令继续调用旧字段。

> **CODEX 描述常量（三处必须字面一致：codex 模板 frontmatter、copy-assets 测试 `codexSkillDescriptions`）：**
> - fm-design: `Generate a static-HTML page design for a Forma requirement via MCP, then self-review.`
> - fm-refine-components: `Generate or refine a Forma product component library (static HTML) via MCP, then self-review.`
> - fm-change-style: `Re-skin a Forma artifact under a new brand and system style via MCP, then self-review.`

---

## Task P6.0: fm-rollback-design 适配 P4 page/variant/version rollback

**Files:**
- Modify: `packages/agent/templates/claude/fm-rollback-design.md`
- Modify: `packages/agent/templates/codex/fm-rollback-design/SKILL.md`
- Modify: `packages/agent/templates/gemini/fm-rollback-design.toml`
- Modify: `packages/cli/tests/copy-assets.test.ts`

- [ ] **Step 1: 先更新 rollback 内容断言**

Edit the `documents v8 design artifact workflows` test in `packages/cli/tests/copy-assets.test.ts`. Keep the existing assertions for `rollback_requirement_design`, `list_product_artifacts`, and `include_superseded`, then replace the stale artifact-id assertion with:

```ts
expect(rollback).toContain("page_id");
expect(rollback).toContain("variant");
expect(rollback).toContain("target_version");
expect(rollback).toContain("current_version");
expect(rollback).toContain("versions");
expect(rollback).not.toContain("target_artifact_id");
```

Run: `npx vitest run packages/cli/tests/copy-assets.test.ts`
Expected: FAIL until the three rollback templates are updated.

- [ ] **Step 2: 更新 claude rollback 模板**

Replace `packages/agent/templates/claude/fm-rollback-design.md` with:

```markdown
---
description: Roll back a Forma design artifact to a previous version.
---

# Forma route: fm-rollback-design

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Cold path scenario:
The user wants to undo a recent design generation by moving one requirement page/variant back to an earlier saved version. The agent lists available design-page artifacts and versions, asks the user to choose the page, variant, and target version, then calls `rollback_requirement_design` once to flip that page/variant pointer.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first. If requirement_id is unknown, call `get_requirement` with product_id to retrieve it and its pages.
2. Call `list_product_artifacts` with product_id, `include_superseded: true`, and `kind: "design-page"` to display available design artifacts. If requirement_id is known, only present artifacts for that requirement.
3. For each candidate, show artifact_id, page_id, variant (default `default`), current_version, versions, title, preview URL, and whether it is superseded. Superseded artifacts are history only; choose `target_version` from the current non-superseded artifact for that page/variant. Do not ask for an artifact id as the rollback target; rollback is by page/variant pointer plus target_version.
4. Ask the user to confirm `page_id`, `variant` (or `default`), and `target_version`.
5. Call `rollback_requirement_design(product_id, requirement_id, page_id, variant, target_version)`.
6. Report the restored `page_id`, `variant`, `version`, and stable error codes exactly as returned.
```

- [ ] **Step 3: 更新 codex rollback 模板**

Replace `packages/agent/templates/codex/fm-rollback-design/SKILL.md` with the same body as Step 2, with Codex frontmatter and route line:

```markdown
---
name: fm-rollback-design
description: Roll back a Forma design artifact to a previous version.
---

# Forma route: fm-rollback-design

Codex route: `$fm-rollback-design`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Cold path scenario:
The user wants to undo a recent design generation by moving one requirement page/variant back to an earlier saved version. The agent lists available design-page artifacts and versions, asks the user to choose the page, variant, and target version, then calls `rollback_requirement_design` once to flip that page/variant pointer.

Execution:
1. Require product_id from context or ask the user to run `$fm-list-product` first. If requirement_id is unknown, call `get_requirement` with product_id to retrieve it and its pages.
2. Call `list_product_artifacts` with product_id, `include_superseded: true`, and `kind: "design-page"` to display available design artifacts. If requirement_id is known, only present artifacts for that requirement.
3. For each candidate, show artifact_id, page_id, variant (default `default`), current_version, versions, title, preview URL, and whether it is superseded. Superseded artifacts are history only; choose `target_version` from the current non-superseded artifact for that page/variant. Do not ask for an artifact id as the rollback target; rollback is by page/variant pointer plus target_version.
4. Ask the user to confirm `page_id`, `variant` (or `default`), and `target_version`.
5. Call `rollback_requirement_design(product_id, requirement_id, page_id, variant, target_version)`.
6. Report the restored `page_id`, `variant`, `version`, and stable error codes exactly as returned.
```

- [ ] **Step 4: 更新 gemini rollback 模板**

Replace `packages/agent/templates/gemini/fm-rollback-design.toml` with:

```toml
description = "Roll back a Forma design artifact to a previous version."
prompt = """
# Forma route: fm-rollback-design

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Cold path scenario:
The user wants to undo a recent design generation by moving one requirement page/variant back to an earlier saved version. The agent lists available design-page artifacts and versions, asks the user to choose the page, variant, and target version, then calls `rollback_requirement_design` once to flip that page/variant pointer.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first. If requirement_id is unknown, call `get_requirement` with product_id to retrieve it and its pages.
2. Call `list_product_artifacts` with product_id, `include_superseded: true`, and `kind: "design-page"` to display available design artifacts. If requirement_id is known, only present artifacts for that requirement.
3. For each candidate, show artifact_id, page_id, variant (default `default`), current_version, versions, title, preview URL, and whether it is superseded. Superseded artifacts are history only; choose `target_version` from the current non-superseded artifact for that page/variant. Do not ask for an artifact id as the rollback target; rollback is by page/variant pointer plus target_version.
4. Ask the user to confirm `page_id`, `variant` (or `default`), and `target_version`.
5. Call `rollback_requirement_design(product_id, requirement_id, page_id, variant, target_version)`.
6. Report the restored `page_id`, `variant`, `version`, and stable error codes exactly as returned.
"""
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run packages/cli/tests/copy-assets.test.ts`
Expected: PASS, and `target_artifact_id` no longer appears in any rollback template.

- [ ] **Step 6: 提交**

```bash
git add packages/agent/templates/claude/fm-rollback-design.md packages/agent/templates/codex/fm-rollback-design/SKILL.md packages/agent/templates/gemini/fm-rollback-design.toml packages/cli/tests/copy-assets.test.ts
git commit -m "fix(p6): align rollback template with page version rollback"
```

---

## Task P6.1: fm-design（三平台模板 + 注册 + 翻转守卫 + 内容测试）

**Files:**
- Create: `packages/agent/templates/claude/fm-design.md`
- Create: `packages/agent/templates/codex/fm-design/SKILL.md`
- Create: `packages/agent/templates/gemini/fm-design.toml`
- Create: `packages/cli/tests/design-commands.test.ts`
- Modify: `packages/core/src/install.ts`, `packages/agent/src/index.ts`
- Modify: `packages/core/tests/install.test.ts`, `packages/cli/tests/copy-assets.test.ts`

- [ ] **Step 1: 写失败的内容测试**

Create `packages/cli/tests/design-commands.test.ts` with EXACTLY this content:

```ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const agentTemplatesDir = new URL("../../../packages/agent/templates/", import.meta.url);

async function loadCommand(command: string): Promise<{ claude: string; codex: string; gemini: string; blob: string }> {
  const claude = await readFile(new URL(`claude/${command}.md`, agentTemplatesDir), "utf8");
  const codex = await readFile(new URL(`codex/${command}/SKILL.md`, agentTemplatesDir), "utf8");
  const gemini = await readFile(new URL(`gemini/${command}.toml`, agentTemplatesDir), "utf8");
  return { claude, codex, gemini, blob: [claude, codex, gemini].join("\n").toLowerCase() };
}

function expectOrder(text: string, before: string, after: string): void {
  const a = text.indexOf(before);
  const b = text.indexOf(after);
  expect(a, `${before} must appear`).toBeGreaterThanOrEqual(0);
  expect(b, `${after} must appear`).toBeGreaterThanOrEqual(0);
  expect(a, `${before} must precede ${after}`).toBeLessThan(b);
}

describe("fm-design template", () => {
  it("uses the Forma route header on every platform", async () => {
    const t = await loadCommand("fm-design");
    expect(t.claude).toContain("# Forma route: fm-design");
    expect(t.codex).toContain("name: fm-design");
    expect(t.gemini).toContain("# Forma route: fm-design");
  });

  it("fetches design context BEFORE saving on every platform", async () => {
    const t = await loadCommand("fm-design");
    for (const body of [t.claude, t.codex, t.gemini]) {
      expectOrder(body.toLowerCase(), "get_design_context", "generate_requirement_design");
    }
  });

  it("uses brand_style + system_style and the page save tool", async () => {
    const t = await loadCommand("fm-design");
    expect(t.blob).toContain("brand_style");
    expect(t.blob).toContain("system_style");
    expect(t.blob).toContain("generate_requirement_design");
  });

  it("enforces self-review via craftChecks read-back", async () => {
    const t = await loadCommand("fm-design");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expect(lc).toContain("get_product_artifact");
      expect(lc).toContain("craftchecks");
      expect(lc).toContain("self-review");
    }
  });

  it("documents both full and described modes and the static contract", async () => {
    const t = await loadCommand("fm-design");
    expect(t.blob).toContain("full");
    expect(t.blob).toContain("single");
    expect(t.blob).toContain("<script>");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/cli/tests/design-commands.test.ts`
Expected: FAIL — `ENOENT` (fm-design template files do not exist yet).

- [ ] **Step 3: 建 claude 模板**

Create `packages/agent/templates/claude/fm-design.md` with EXACTLY this content:

```markdown
---
description: Generate a static-HTML page design for a Forma requirement via MCP, then self-review.
---

# Forma route: fm-design

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate the static-HTML design for a requirement's page(s). You write the HTML; Forma localizes its assets, validates it is pure-static, stores a versioned bundle, renders a preview, and runs the deterministic craft lint.

Modes:
- Full (no change description given): three steps — (1) plan the pages from the requirement, (2) generate each page, (3) self-review.
- Described (a change description argument given): a single pass — locate the affected page, regenerate only that page, self-review. Scope is the changed page; do not weaken self-review.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Call `get_requirement` for the requirement, its `pages[]` and each `page_id`. If `ui_affected=false`, stop — there is no design to produce.
3. Confirm the `brand_style` and optional `system_style` (read product config / `list_styles`); confirm with the user when not already chosen.
4. Fetch design context BEFORE generating (recency matters): `get_design_context(product_id, requirement_id, page_id, brand_style, system_style)` returns craft rules + the selected brand/system style (tokens, components) + the page spec + applicable rules. Never call this after saving.
5. Generate the page as one self-contained static HTML document following the craft rules and style tokens. Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs (Forma extracts and localizes them); no remote URLs anywhere (HTML, CSS `url()`/`@import`, `srcset`, SVG).
6. Save: `generate_requirement_design(product_id, requirement_id, page_id, html, title, brand_style, system_style[, variant])`. It returns `artifact_id`, `version`, `preview_status`.
7. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false` (e.g. `contrast-aa`, `type-scale`, `color-palette`, `font-families`), fix that specific violation in the HTML and call `generate_requirement_design` again — Forma points the page/variant to the corrected design and supersedes the old one. Repeat until the checks pass.
   - Also judge the non-mechanical craft items the lint cannot: avoid AI-slop layouts; clear type hierarchy; restrained color (accent reserved for primary actions); WCAG AA contrast on real backgrounds; empty/loading/error states; forms show inline validation; purposeful motion; honor core UX laws. Regenerate if any fails.
8. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned.
```

- [ ] **Step 4: 建 codex 模板**

Create `packages/agent/templates/codex/fm-design/SKILL.md` with EXACTLY this content:

```markdown
---
name: fm-design
description: Generate a static-HTML page design for a Forma requirement via MCP, then self-review.
---

# Forma route: fm-design

Codex route: `$fm-design`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate the static-HTML design for a requirement's page(s). You write the HTML; Forma localizes its assets, validates it is pure-static, stores a versioned bundle, renders a preview, and runs the deterministic craft lint.

Modes:
- Full (no change description given): three steps — (1) plan the pages from the requirement, (2) generate each page, (3) self-review.
- Described (a change description argument given): a single pass — locate the affected page, regenerate only that page, self-review. Scope is the changed page; do not weaken self-review.

Execution:
1. Require product_id from context or ask the user to run `$fm-list-product` first.
2. Call `get_requirement` for the requirement, its `pages[]` and each `page_id`. If `ui_affected=false`, stop — there is no design to produce.
3. Confirm the `brand_style` and optional `system_style` (read product config / `list_styles`); confirm with the user when not already chosen.
4. Fetch design context BEFORE generating (recency matters): `get_design_context(product_id, requirement_id, page_id, brand_style, system_style)` returns craft rules + the selected brand/system style (tokens, components) + the page spec + applicable rules. Never call this after saving.
5. Generate the page as one self-contained static HTML document following the craft rules and style tokens. Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs (Forma extracts and localizes them); no remote URLs anywhere (HTML, CSS `url()`/`@import`, `srcset`, SVG).
6. Save: `generate_requirement_design(product_id, requirement_id, page_id, html, title, brand_style, system_style[, variant])`. It returns `artifact_id`, `version`, `preview_status`.
7. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false` (e.g. `contrast-aa`, `type-scale`, `color-palette`, `font-families`), fix that specific violation in the HTML and call `generate_requirement_design` again — Forma points the page/variant to the corrected design and supersedes the old one. Repeat until the checks pass.
   - Also judge the non-mechanical craft items the lint cannot: avoid AI-slop layouts; clear type hierarchy; restrained color (accent reserved for primary actions); WCAG AA contrast on real backgrounds; empty/loading/error states; forms show inline validation; purposeful motion; honor core UX laws. Regenerate if any fails.
8. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned.
```

- [ ] **Step 5: 建 gemini 模板**

Create `packages/agent/templates/gemini/fm-design.toml` with EXACTLY this content:

```toml
description = "Generate a static-HTML page design for a Forma requirement via MCP, then self-review."
prompt = """
# Forma route: fm-design

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate the static-HTML design for a requirement's page(s). You write the HTML; Forma localizes its assets, validates it is pure-static, stores a versioned bundle, renders a preview, and runs the deterministic craft lint.

Modes:
- Full (no change description given): three steps — (1) plan the pages from the requirement, (2) generate each page, (3) self-review.
- Described (a change description argument given): a single pass — locate the affected page, regenerate only that page, self-review. Scope is the changed page; do not weaken self-review.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Call `get_requirement` for the requirement, its `pages[]` and each `page_id`. If `ui_affected=false`, stop — there is no design to produce.
3. Confirm the `brand_style` and optional `system_style` (read product config / `list_styles`); confirm with the user when not already chosen.
4. Fetch design context BEFORE generating (recency matters): `get_design_context(product_id, requirement_id, page_id, brand_style, system_style)` returns craft rules + the selected brand/system style (tokens, components) + the page spec + applicable rules. Never call this after saving.
5. Generate the page as one self-contained static HTML document following the craft rules and style tokens. Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs (Forma extracts and localizes them); no remote URLs anywhere (HTML, CSS `url()`/`@import`, `srcset`, SVG).
6. Save: `generate_requirement_design(product_id, requirement_id, page_id, html, title, brand_style, system_style[, variant])`. It returns `artifact_id`, `version`, `preview_status`.
7. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false` (e.g. `contrast-aa`, `type-scale`, `color-palette`, `font-families`), fix that specific violation in the HTML and call `generate_requirement_design` again — Forma points the page/variant to the corrected design and supersedes the old one. Repeat until the checks pass.
   - Also judge the non-mechanical craft items the lint cannot: avoid AI-slop layouts; clear type hierarchy; restrained color (accent reserved for primary actions); WCAG AA contrast on real backgrounds; empty/loading/error states; forms show inline validation; purposeful motion; honor core UX laws. Regenerate if any fails.
8. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned.
"""
```

- [ ] **Step 6: 注册命令（两个 src 数组）**

Edit `packages/core/src/install.ts` — change `formaInstallCommands` to:
```ts
export const formaInstallCommands = [
  "fm-list-product",
  "fm-status",
  "fm-requirement",
  "fm-rollback-design",
  "fm-design"
] as const;
```

Edit `packages/agent/src/index.ts` — change `formaAgentCommands` to:
```ts
export const formaAgentCommands = [
  "fm-list-product",
  "fm-status",
  "fm-requirement",
  "fm-rollback-design",
  "fm-design"
] as const;
```

- [ ] **Step 7: 翻转 install.test.ts 守卫**

Edit `packages/core/tests/install.test.ts`:

Change the `commands` const (top of file) to add `"fm-design"`:
```ts
const commands = [
  "fm-list-product",
  "fm-status",
  "fm-requirement",
  "fm-rollback-design",
  "fm-design"
] as const;
```

Change `removedLegacyCommands` to drop `"fm-design"` (keep the others still-removed for now):
```ts
const removedLegacyCommands = ["fm-refine-design", "fm-refine-components", "fm-change-style"] as const;
```

- [ ] **Step 8: 翻转 copy-assets.test.ts 守卫**

Edit `packages/cli/tests/copy-assets.test.ts`:

(a) Add `"fm-design"` to `formaCommands`:
```ts
const formaCommands = [
  "fm-list-product",
  "fm-status",
  "fm-requirement",
  "fm-rollback-design",
  "fm-design"
] as const;
```

(b) Shrink `disabledRuntimeCommands` to drop `"fm-design"`:
```ts
const disabledRuntimeCommands = ["fm-refine-components", "fm-change-style"] as const;
```

(c) Add a codex description for the new command to `codexSkillDescriptions`:
```ts
const codexSkillDescriptions = {
  "fm-list-product": "List and select Forma products, or delete a product on explicit request.",
  "fm-status": "Report Forma product, requirement, and artifact status. Read-only.",
  "fm-requirement": "Add or update a Forma requirement from any granularity of product input.",
  "fm-rollback-design": "Roll back a Forma design artifact to a previous version.",
  "fm-design": "Generate a static-HTML page design for a Forma requirement via MCP, then self-review."
} as const;
```

(d) The `documents v8 design artifact workflows` test asserts `allTemplateText` (built from `[rollback, requirement]`) does NOT contain `generate_requirement_design`. That stays correct — fm-design is not in that pair. Make NO change there.

> Note: that same test reads only `fm-rollback-design` and `fm-requirement`; fm-design's use of `generate_requirement_design` does not violate it.

- [ ] **Step 9: 跑测试确认通过**

Run: `npx vitest run packages/cli/tests/design-commands.test.ts packages/core/tests/install.test.ts packages/cli/tests/copy-assets.test.ts`
Expected: all PASS. (`sourceCommands` now finds 5 templates per platform matching the 5-command `formaCommands`; codex strict-frontmatter check finds the new description; design-commands content test passes; install.test command/manifest checks cover 5 commands.)

- [ ] **Step 10: 提交**

```bash
git add packages/agent/templates/claude/fm-design.md packages/agent/templates/codex/fm-design/SKILL.md packages/agent/templates/gemini/fm-design.toml packages/cli/tests/design-commands.test.ts packages/core/src/install.ts packages/agent/src/index.ts packages/core/tests/install.test.ts packages/cli/tests/copy-assets.test.ts
git commit -m "feat(p6): enable fm-design thin-glue template (context -> generate -> self-review)"
```

---

## Task P6.2: fm-refine-components（三平台模板 + 注册 + 翻转守卫 + 内容测试）

**Files:**
- Create: `packages/agent/templates/claude/fm-refine-components.md`
- Create: `packages/agent/templates/codex/fm-refine-components/SKILL.md`
- Create: `packages/agent/templates/gemini/fm-refine-components.toml`
- Modify: `packages/cli/tests/design-commands.test.ts`
- Modify: `packages/core/src/install.ts`, `packages/agent/src/index.ts`
- Modify: `packages/core/tests/install.test.ts`, `packages/cli/tests/copy-assets.test.ts`

- [ ] **Step 1: 追加失败的内容测试**

In `packages/cli/tests/design-commands.test.ts`, add this `describe` block at the end of the file:

```ts
describe("fm-refine-components template", () => {
  it("uses the Forma route header on every platform", async () => {
    const t = await loadCommand("fm-refine-components");
    expect(t.claude).toContain("# Forma route: fm-refine-components");
    expect(t.codex).toContain("name: fm-refine-components");
    expect(t.gemini).toContain("# Forma route: fm-refine-components");
  });

  it("uses get_style for knowledge (no get_design_context) before the component save tool", async () => {
    const t = await loadCommand("fm-refine-components");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expect(lc).toContain("get_style");
      expect(lc).not.toContain("get_design_context");
      expectOrder(lc, "get_style", "generate_components");
    }
  });

  it("uses brand_style + system_style and the component save tool", async () => {
    const t = await loadCommand("fm-refine-components");
    expect(t.blob).toContain("brand_style");
    expect(t.blob).toContain("system_style");
    expect(t.blob).toContain("generate_components");
  });

  it("enforces self-review via craftChecks read-back", async () => {
    const t = await loadCommand("fm-refine-components");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expect(lc).toContain("get_product_artifact");
      expect(lc).toContain("craftchecks");
      expect(lc).toContain("self-review");
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/cli/tests/design-commands.test.ts`
Expected: FAIL — `ENOENT` for the fm-refine-components files.

- [ ] **Step 3: 建 claude 模板**

Create `packages/agent/templates/claude/fm-refine-components.md` with EXACTLY this content:

```markdown
---
description: Generate or refine a Forma product component library (static HTML) via MCP, then self-review.
---

# Forma route: fm-refine-components

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate or refine a product's static-HTML component library. You write the HTML; Forma localizes assets, validates it is pure-static, stores a versioned bundle, renders a preview, and runs the deterministic craft lint. A component library is product-level — it has no requirement or page.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Confirm the `brand_style` and optional `system_style` (read product config / `list_styles`); confirm with the user when not already chosen.
3. Fetch the style knowledge BEFORE generating: `get_style(brand_style)` returns DESIGN.md (design principles), tokens.css (design tokens), components.html (reference components). If a `system_style` is set, `get_style(system_style)` too. Component libraries have no requirement, so requirement page context does not apply here.
4. Generate the component library as one self-contained static HTML document following the style tokens and these craft principles: avoid generic AI-slop; clear type hierarchy on a small type scale; restrained color with accent reserved for primary actions; WCAG AA contrast; cover component states (default/hover/disabled/empty/error); accessible form controls; purposeful motion; honor core UX laws. Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs; no remote URLs anywhere.
5. Save the component library with the component save tool, passing product_id, html, title, brand_style, and system_style. It returns `artifact_id`, `version`, `preview_status`.
6. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false`, fix that specific violation and save again until the checks pass.
   - Also judge the non-mechanical craft items above that the lint cannot; regenerate if any fails.
7. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned.

The component save tool is `generate_components`.
```

> 说明：把工具名 `generate_components` 放在正文末尾单独一行（满足内容测试断言），步骤里用「the component save tool」以保持可读；二者并存不冲突。

- [ ] **Step 4: 建 codex 模板**

Create `packages/agent/templates/codex/fm-refine-components/SKILL.md` with EXACTLY this content:

```markdown
---
name: fm-refine-components
description: Generate or refine a Forma product component library (static HTML) via MCP, then self-review.
---

# Forma route: fm-refine-components

Codex route: `$fm-refine-components`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate or refine a product's static-HTML component library. You write the HTML; Forma localizes assets, validates it is pure-static, stores a versioned bundle, renders a preview, and runs the deterministic craft lint. A component library is product-level — it has no requirement or page.

Execution:
1. Require product_id from context or ask the user to run `$fm-list-product` first.
2. Confirm the `brand_style` and optional `system_style` (read product config / `list_styles`); confirm with the user when not already chosen.
3. Fetch the style knowledge BEFORE generating: `get_style(brand_style)` returns DESIGN.md (design principles), tokens.css (design tokens), components.html (reference components). If a `system_style` is set, `get_style(system_style)` too. Component libraries have no requirement, so requirement page context does not apply here.
4. Generate the component library as one self-contained static HTML document following the style tokens and these craft principles: avoid generic AI-slop; clear type hierarchy on a small type scale; restrained color with accent reserved for primary actions; WCAG AA contrast; cover component states (default/hover/disabled/empty/error); accessible form controls; purposeful motion; honor core UX laws. Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs; no remote URLs anywhere.
5. Save the component library with the component save tool, passing product_id, html, title, brand_style, and system_style. It returns `artifact_id`, `version`, `preview_status`.
6. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false`, fix that specific violation and save again until the checks pass.
   - Also judge the non-mechanical craft items above that the lint cannot; regenerate if any fails.
7. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned.

The component save tool is `generate_components`.
```

- [ ] **Step 5: 建 gemini 模板**

Create `packages/agent/templates/gemini/fm-refine-components.toml` with EXACTLY this content:

```toml
description = "Generate or refine a Forma product component library (static HTML) via MCP, then self-review."
prompt = """
# Forma route: fm-refine-components

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate or refine a product's static-HTML component library. You write the HTML; Forma localizes assets, validates it is pure-static, stores a versioned bundle, renders a preview, and runs the deterministic craft lint. A component library is product-level — it has no requirement or page.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Confirm the `brand_style` and optional `system_style` (read product config / `list_styles`); confirm with the user when not already chosen.
3. Fetch the style knowledge BEFORE generating: `get_style(brand_style)` returns DESIGN.md (design principles), tokens.css (design tokens), components.html (reference components). If a `system_style` is set, `get_style(system_style)` too. Component libraries have no requirement, so requirement page context does not apply here.
4. Generate the component library as one self-contained static HTML document following the style tokens and these craft principles: avoid generic AI-slop; clear type hierarchy on a small type scale; restrained color with accent reserved for primary actions; WCAG AA contrast; cover component states (default/hover/disabled/empty/error); accessible form controls; purposeful motion; honor core UX laws. Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs; no remote URLs anywhere.
5. Save the component library with the component save tool, passing product_id, html, title, brand_style, and system_style. It returns `artifact_id`, `version`, `preview_status`.
6. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false`, fix that specific violation and save again until the checks pass.
   - Also judge the non-mechanical craft items above that the lint cannot; regenerate if any fails.
7. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned.

The component save tool is `generate_components`.
"""
```

- [ ] **Step 6: 注册命令**

Append `"fm-refine-components"` to `formaInstallCommands` (install.ts) and `formaAgentCommands` (agent/src/index.ts), after `"fm-design"`. Both arrays become:
```ts
[ "fm-list-product", "fm-status", "fm-requirement", "fm-rollback-design", "fm-design", "fm-refine-components" ]
```
(keep the multi-line `as const` formatting used in each file).

- [ ] **Step 7: 翻转 install.test.ts 守卫**

Edit `packages/core/tests/install.test.ts`:
- Append `"fm-refine-components"` to `commands`.
- Change `removedLegacyCommands` to `["fm-refine-design", "fm-change-style"] as const`.

- [ ] **Step 8: 翻转 copy-assets.test.ts 守卫**

Edit `packages/cli/tests/copy-assets.test.ts`:
- Append `"fm-refine-components"` to `formaCommands`.
- Change `disabledRuntimeCommands` to `["fm-change-style"] as const`.
- Add to `codexSkillDescriptions`: `"fm-refine-components": "Generate or refine a Forma product component library (static HTML) via MCP, then self-review."`.

- [ ] **Step 9: 跑测试确认通过**

Run: `npx vitest run packages/cli/tests/design-commands.test.ts packages/core/tests/install.test.ts packages/cli/tests/copy-assets.test.ts`
Expected: all PASS.

- [ ] **Step 10: 提交**

```bash
git add packages/agent/templates/claude/fm-refine-components.md packages/agent/templates/codex/fm-refine-components/SKILL.md packages/agent/templates/gemini/fm-refine-components.toml packages/cli/tests/design-commands.test.ts packages/core/src/install.ts packages/agent/src/index.ts packages/core/tests/install.test.ts packages/cli/tests/copy-assets.test.ts
git commit -m "feat(p6): enable fm-refine-components thin-glue template (style -> generate -> self-review)"
```

---

## Task P6.3: fm-change-style（三平台模板 + 注册 + 翻转守卫 + 内容测试）

**Files:**
- Create: `packages/agent/templates/claude/fm-change-style.md`
- Create: `packages/agent/templates/codex/fm-change-style/SKILL.md`
- Create: `packages/agent/templates/gemini/fm-change-style.toml`
- Modify: `packages/cli/tests/design-commands.test.ts`
- Modify: `packages/core/src/install.ts`, `packages/agent/src/index.ts`
- Modify: `packages/core/tests/install.test.ts`, `packages/cli/tests/copy-assets.test.ts`

- [ ] **Step 1: 追加失败的内容测试**

In `packages/cli/tests/design-commands.test.ts`, add this `describe` block at the end:

```ts
describe("fm-change-style template", () => {
  it("uses the Forma route header on every platform", async () => {
    const t = await loadCommand("fm-change-style");
    expect(t.claude).toContain("# Forma route: fm-change-style");
    expect(t.codex).toContain("name: fm-change-style");
    expect(t.gemini).toContain("# Forma route: fm-change-style");
  });

  it("selects the source artifact then changes style with brand_style + system_style", async () => {
    const t = await loadCommand("fm-change-style");
    expect(t.blob).toContain("list_product_artifacts");
    expect(t.blob).toContain("artifact_id");
    expect(t.blob).toContain("brand_style");
    expect(t.blob).toContain("system_style");
    expect(t.blob).toContain("change_artifact_style");
  });

  it("fetches context before the change save tool on every platform", async () => {
    const t = await loadCommand("fm-change-style");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      const ctxIdx = [lc.indexOf("get_design_context"), lc.indexOf("get_style")].filter((i) => i >= 0);
      expect(ctxIdx.length).toBeGreaterThan(0);
      const ctx = Math.min(...ctxIdx);
      const save = lc.indexOf("change_artifact_style");
      expect(save).toBeGreaterThan(ctx);
    }
  });

  it("enforces self-review via craftChecks read-back", async () => {
    const t = await loadCommand("fm-change-style");
    for (const body of [t.claude, t.codex, t.gemini]) {
      const lc = body.toLowerCase();
      expect(lc).toContain("get_product_artifact");
      expect(lc).toContain("craftchecks");
      expect(lc).toContain("self-review");
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/cli/tests/design-commands.test.ts`
Expected: FAIL — `ENOENT` for the fm-change-style files.

- [ ] **Step 3: 建 claude 模板**

Create `packages/agent/templates/claude/fm-change-style.md` with EXACTLY this content:

```markdown
---
description: Re-skin a Forma artifact under a new brand and system style via MCP, then self-review.
---

# Forma route: fm-change-style

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Re-skin an existing artifact under a new `brand_style` / `system_style`. You regenerate the HTML in the new style; Forma localizes assets, validates pure-static, stores it as a new version of the same artifact, renders a preview, and runs the craft lint.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Pick the source artifact: `list_product_artifacts(product_id)` then choose the target; `get_product_artifact(product_id, artifact_id)` to read its `manifest` (its `kind`, and for a `design-page` its `forma.requirementId` / `forma.pageId` / `forma.variant`).
3. Confirm the new `brand_style` and optional `system_style`. If not chosen, `list_styles` and confirm with the user.
4. Fetch context BEFORE generating:
   - For a `design-page` artifact: `get_design_context(product_id, requirement_id, page_id, brand_style, system_style)` (the new styles) returns craft rules + style + page spec.
   - For a `component-library` artifact (no requirement/page): `get_style(brand_style)` (and `get_style(system_style)` if set).
5. Regenerate the artifact's HTML in the new style, preserving content/structure but applying the new tokens. Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs; no remote URLs anywhere.
6. Save: `change_artifact_style(product_id, artifact_id, html, title, brand_style, system_style)`. It returns `artifact_id`, `version`, `preview_status`.
7. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false`, fix that specific violation and call `change_artifact_style` again until the checks pass.
   - Also judge the non-mechanical craft items the lint cannot (type hierarchy, color restraint, contrast, state coverage, form validation, motion, UX laws); regenerate if any fails.
8. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned. `change_artifact_style` only applies to `design-page` / `component-library` artifacts.
```

- [ ] **Step 4: 建 codex 模板**

Create `packages/agent/templates/codex/fm-change-style/SKILL.md` with EXACTLY this content:

```markdown
---
name: fm-change-style
description: Re-skin a Forma artifact under a new brand and system style via MCP, then self-review.
---

# Forma route: fm-change-style

Codex route: `$fm-change-style`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Re-skin an existing artifact under a new `brand_style` / `system_style`. You regenerate the HTML in the new style; Forma localizes assets, validates pure-static, stores it as a new version of the same artifact, renders a preview, and runs the craft lint.

Execution:
1. Require product_id from context or ask the user to run `$fm-list-product` first.
2. Pick the source artifact: `list_product_artifacts(product_id)` then choose the target; `get_product_artifact(product_id, artifact_id)` to read its `manifest` (its `kind`, and for a `design-page` its `forma.requirementId` / `forma.pageId` / `forma.variant`).
3. Confirm the new `brand_style` and optional `system_style`. If not chosen, `list_styles` and confirm with the user.
4. Fetch context BEFORE generating:
   - For a `design-page` artifact: `get_design_context(product_id, requirement_id, page_id, brand_style, system_style)` (the new styles) returns craft rules + style + page spec.
   - For a `component-library` artifact (no requirement/page): `get_style(brand_style)` (and `get_style(system_style)` if set).
5. Regenerate the artifact's HTML in the new style, preserving content/structure but applying the new tokens. Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs; no remote URLs anywhere.
6. Save: `change_artifact_style(product_id, artifact_id, html, title, brand_style, system_style)`. It returns `artifact_id`, `version`, `preview_status`.
7. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false`, fix that specific violation and call `change_artifact_style` again until the checks pass.
   - Also judge the non-mechanical craft items the lint cannot (type hierarchy, color restraint, contrast, state coverage, form validation, motion, UX laws); regenerate if any fails.
8. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned. `change_artifact_style` only applies to `design-page` / `component-library` artifacts.
```

- [ ] **Step 5: 建 gemini 模板**

Create `packages/agent/templates/gemini/fm-change-style.toml` with EXACTLY this content:

```toml
description = "Re-skin a Forma artifact under a new brand and system style via MCP, then self-review."
prompt = """
# Forma route: fm-change-style

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Re-skin an existing artifact under a new `brand_style` / `system_style`. You regenerate the HTML in the new style; Forma localizes assets, validates pure-static, stores it as a new version of the same artifact, renders a preview, and runs the craft lint.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Pick the source artifact: `list_product_artifacts(product_id)` then choose the target; `get_product_artifact(product_id, artifact_id)` to read its `manifest` (its `kind`, and for a `design-page` its `forma.requirementId` / `forma.pageId` / `forma.variant`).
3. Confirm the new `brand_style` and optional `system_style`. If not chosen, `list_styles` and confirm with the user.
4. Fetch context BEFORE generating:
   - For a `design-page` artifact: `get_design_context(product_id, requirement_id, page_id, brand_style, system_style)` (the new styles) returns craft rules + style + page spec.
   - For a `component-library` artifact (no requirement/page): `get_style(brand_style)` (and `get_style(system_style)` if set).
5. Regenerate the artifact's HTML in the new style, preserving content/structure but applying the new tokens. Pure-static contract: no `<script>`, no inline `on*` handlers, no `javascript:` URLs, no external scripts/stylesheets; inline images as `data:` URLs; no remote URLs anywhere.
6. Save: `change_artifact_style(product_id, artifact_id, html, title, brand_style, system_style)`. It returns `artifact_id`, `version`, `preview_status`.
7. Self-review (MANDATORY):
   - Read it back: `get_product_artifact(product_id, artifact_id)` and inspect `manifest.forma.quality.craftChecks`.
   - For any check with `passed:false`, fix that specific violation and call `change_artifact_style` again until the checks pass.
   - Also judge the non-mechanical craft items the lint cannot (type hierarchy, color restraint, contrast, state coverage, form validation, motion, UX laws); regenerate if any fails.
8. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned. `change_artifact_style` only applies to `design-page` / `component-library` artifacts.
"""
```

- [ ] **Step 6: 注册命令**

Append `"fm-change-style"` to `formaInstallCommands` (install.ts) and `formaAgentCommands` (agent/src/index.ts). Both arrays become:
```ts
[ "fm-list-product", "fm-status", "fm-requirement", "fm-rollback-design", "fm-design", "fm-refine-components", "fm-change-style" ]
```

- [ ] **Step 7: 翻转 install.test.ts 守卫**

Edit `packages/core/tests/install.test.ts`:
- Append `"fm-change-style"` to `commands`.
- Change `removedLegacyCommands` to `["fm-refine-design"] as const`.

- [ ] **Step 8: 翻转 copy-assets.test.ts 守卫**

Edit `packages/cli/tests/copy-assets.test.ts`:
- Append `"fm-change-style"` to `formaCommands`.
- Remove `disabledRuntimeCommands` entirely (now empty), AND remove the two loops that reference it (in `agent template inventory` Step ~105-107 and in `documents v8 product selection` ~163-165). Verify by `node -e "const t=require('node:fs').readFileSync('packages/cli/tests/copy-assets.test.ts','utf8'); console.log('disabledRuntimeCommands refs:', (t.match(/disabledRuntimeCommands/g)||[]).length)"` → expect `0`.
- Add to `codexSkillDescriptions`: `"fm-change-style": "Re-skin a Forma artifact under a new brand and system style via MCP, then self-review."`.

- [ ] **Step 9: 跑测试确认通过**

Run: `npx vitest run packages/cli/tests/design-commands.test.ts packages/core/tests/install.test.ts packages/cli/tests/copy-assets.test.ts`
Expected: all PASS — 7 commands across all three platforms; no `disabledRuntimeCommands` references remain.

- [ ] **Step 10: 提交**

```bash
git add packages/agent/templates/claude/fm-change-style.md packages/agent/templates/codex/fm-change-style/SKILL.md packages/agent/templates/gemini/fm-change-style.toml packages/cli/tests/design-commands.test.ts packages/core/src/install.ts packages/agent/src/index.ts packages/core/tests/install.test.ts packages/cli/tests/copy-assets.test.ts
git commit -m "feat(p6): enable fm-change-style thin-glue template (context -> change -> self-review)"
```

---

## Task P6.4: shared SKILL.md self-review 指引 + 集成验证

**Files:**
- Modify: `packages/agent/templates/shared/SKILL.md`
- Test: 全仓验证（无新文件）

- [ ] **Step 1: 拆分 shared SKILL.md 取知识指引，并增 self-review 指引（避开禁词）**

Edit `packages/agent/templates/shared/SKILL.md`. Find this line:
```markdown
- Design generation commands (fm-design, fm-refine-components, fm-change-style) save an AI-generated static HTML design artifact: the model produces the HTML, Forma localizes its assets, validates it is pure-static (no JS, local-only resources), stores it as a versioned bundle, and renders a preview. Call `get_design_context` before generating to fetch craft rules + the selected brand/system style + the page spec.
```
Replace it with these bullets:
```markdown
- Page-design and style-change commands (fm-design, fm-change-style) save AI-generated static HTML design artifacts: the model produces the HTML, Forma localizes assets, validates pure-static output (no JS, local-only resources), stores a versioned bundle, and renders a preview. Call `get_design_context` before generating a requirement page artifact to fetch craft rules + selected brand/system style + the page spec.
- Component-library work (fm-refine-components) has no requirement page; fetch knowledge before generating with `get_style` for the selected brand style and optional system style.
- After saving a design, self-review is mandatory: read the saved artifact back with `get_product_artifact` and inspect `manifest.forma.quality.craftChecks`; for any check that did not pass, fix the violation and save again. For component-library work, which has no requirement, fetch knowledge with `get_style` instead of `get_design_context`.
```
> 禁词检查：该 bullet 不得出现 `generate_components` 或 `set_current_session`。用 `get_style` / `get_product_artifact` 等措辞。

- [ ] **Step 2: 跑 shared-doc 相关测试**

Run: `npx vitest run packages/cli/tests/copy-assets.test.ts packages/core/tests/install.test.ts`
Expected: PASS — shared-doc assertions still hold: `not.toContain("generate_components")`, `not.toContain("set_current_session")`, the positive snippets (`ui_affected=false`, `confirm_product_id`, `recovery_warnings`, etc.) unchanged, and shared guidance no longer says component-library work calls `get_design_context`.

- [ ] **Step 3: 构建（模板拷进 dist/assets）**

Run: `pnpm build`
Expected: success. `scripts/copy-assets.ts` copies `packages/agent/templates/**` into `packages/cli/dist/assets/agent/templates`; the 9 new files travel with it.

- [ ] **Step 4: 全仓 typecheck**

Run: `pnpm typecheck`
Expected: all packages Done, 0 errors. The only TS change is two `readonly` tuple literals gaining members (`FormaInstallCommand` / `FormaAgentCommand` unions widen).

- [ ] **Step 5: 全量测试**

Run: `pnpm test`
Expected: 全绿。New: `design-commands.test.ts` (3 commands × ~5 assertions); `install.test.ts` / `copy-assets.test.ts` now cover 7 commands × 3 platforms; no `disabledRuntimeCommands` references. No regressions.

- [ ] **Step 6: 自检安装产物（手动 smoke）**

Run:
```bash
node -e "const {InstallService}=require('./packages/core/dist/install.js'); const os=require('node:os'),fs=require('node:fs'),path=require('node:path'); (async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'fm-smoke-')); const svc=new InstallService({formaHome:path.join(root,'.forma'),userHome:path.join(root,'user'),templatesDir:path.resolve('packages/agent/templates'),mcpCommandRunner:{run:async()=>{throw new Error('skip official cli');}}}); await svc.installPlatforms(['claude','codex','gemini']); const u=path.join(root,'user'); console.log('claude fm-design:', fs.existsSync(path.join(u,'.claude','commands','fm-design.md'))); console.log('codex fm-change-style:', fs.existsSync(path.join(u,'.codex','skills','fm-change-style','SKILL.md'))); console.log('gemini fm-refine-components:', fs.existsSync(path.join(u,'.gemini','commands','fm-refine-components.toml'))); fs.rmSync(root,{recursive:true,force:true});})().catch(e=>{console.error(e);process.exit(1);});"
```
Expected: three `true` lines.
> If `dist/install.js` is ESM-only and `require` fails, use `node --input-type=module -e "import('./packages/core/dist/install.js').then(async ({InstallService})=>{ ... })"` with the same logic.

- [ ] **Step 7: 提交**

```bash
git add packages/agent/templates/shared/SKILL.md
git commit -m "docs(p6): note mandatory craftChecks self-review in shared agent guidance"
```
> `pnpm build` 若产生被仓库跟踪的 dist 改动也一并 stage；dist 若 gitignore 则跳过。先 `git status --short`，只 stage 预期文件（不要 `git add -A`）。

---

## Self-Review（plan 作者自检）

**1. Spec 覆盖（对照 master Phase 6）**
- 「fm-rollback-design 适配 P4 page/variant/version rollback」→ P6.0 更新三平台模板 + copy-assets 断言 ✅
- 「fm-design / fm-refine-components / fm-change-style 薄胶水，三平台」→ P6.1/P6.2/P6.3 各建三平台模板 ✅
- 「调用顺序 context → 生成 → save」→ 模板 + 内容测试 `expectOrder` ✅
- 「强制 self-review（违规重生成）」→ 每模板末步读回 craftChecks + 重生成 + prose 清单；内容测试断言 ✅（决策 1）
- 「入参用 brand_style+system_style」→ 模板 + 测试 ✅；fm-change-style 拆 style 入参 ✅
- 「formaInstallCommands（install.ts）与 formaAgentCommands（agent/src/index.ts）扩容」→ 两数组各加 3，逐 task 同步 ✅（决策 8；修正了草稿「install.ts 不改」的错误）
- 「fm-rollback-design 适配 P4 语义」→ P6.0 明确修旧 `target_artifact_id` 模板，改为 `page_id`/`variant`/`target_version` ✅
- 验收「三平台安装产出对应文件」→ P6.4 Step 6 smoke + install/copy-assets 测试自动覆盖 ✅
- 验收「模板薄、知识不内联、显式调 MCP」→ 模板仅编排 + 契约 + self-review，知识走 `get_design_context`/`get_style` ✅
- fm-refine-components 用 `get_style` + 内嵌 craft 清单（决策 2，用户定）→ P6.2 + 测试断言「不含 get_design_context、含 get_style」✅

**2. 现状守卫修正（草稿曾遗漏，现已对照真实测试）**
- `copy-assets.test.ts` 的 `disabledRuntimeCommands` / `sourceCommands` 相等 / `codexSkillDescriptions` 严格匹配 → P6.1-P6.3 Step 8 逐条翻转 ✅
- `install.test.ts` 的 `commands` / `removedLegacyCommands` → 逐 task 翻转，`fm-refine-design` 永久保留 removed ✅
- 模板格式 `# Forma route: <cmd>` + `Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.` + codex 严格 frontmatter + `Codex route: $<cmd>` → 全部模板照 `fm-rollback-design` 现有约定 ✅
- shared SKILL.md 禁词 `generate_components` / `set_current_session` → P6.4 Step 1 显式避开，并拆分页面/组件取知识指引 ✅（决策 9）

**3. Placeholder 扫描**：无 TBD / 「类似 TaskN」/ 省略；12 个模板（含 3 个 rollback 更新 + 9 个新设计命令模板）与测试给全文。✅

**4. 类型/常量一致性**：`formaInstallCommands` 与 `formaAgentCommands` 在三 task 同步递增到 7、两处测试命令数组同步、codex 描述常量三处（模板 frontmatter / 测试 `codexSkillDescriptions`）字面一致；MCP 工具名（`get_design_context`/`generate_requirement_design`/`generate_components`/`change_artifact_style`/`rollback_requirement_design`/`get_style`/`get_product_artifact`/`list_product_artifacts`/`list_styles`/`get_requirement`）已对照 `packages/mcp/src/tools.ts` 的 `formaToolNames` 全部存在；`manifest.forma.quality.craftChecks` 与 P5 落盘字段一致。✅

**依赖前置**：P4（MCP 工具，已在 main）、P5（craftChecks 落盘，已在 main）。安装器数据驱动、无需改逻辑。
