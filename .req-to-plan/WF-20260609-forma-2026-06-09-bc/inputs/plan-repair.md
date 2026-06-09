# Plan

> 执行顺序遵循 spec 排期：T001(删除批) → T002–T009(B 批语义+core) → T010(R3 下沉) → T011/T012(R2 一致守卫最后锁) → T013–T017(web/viewer，与 fm-* 解耦可并行；T013/T015 同改 DesignView.tsx 须串行/合并)。

## Tasks

### PLAN-TASK-001 删命令壳与 MCP 写工具壳、死 core 与守卫（R1/R4/R5）
Spec References: SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-002, SPEC-BEHAVIOR-003, SPEC-DATA-006
Change Type: modify
TDD Applicable: yes
Files:
- packages/agent/templates/claude/fm-develop-design-handoff.md
- packages/agent/templates/codex/fm-develop-design-handoff/SKILL.md
- packages/agent/templates/gemini/fm-develop-design-handoff.toml
- packages/agent/templates/claude/fm-rollback-design.md
- packages/agent/templates/codex/fm-rollback-design/SKILL.md
- packages/agent/templates/gemini/fm-rollback-design.toml
- packages/agent/src/index.ts
- packages/core/src/install.ts
- packages/mcp/src/tools.ts
- packages/core/src/product.ts
- packages/agent/templates/shared/SKILL.md
- packages/agent/templates/claude/fm-list-product.md
- packages/cli/tests/copy-assets.test.ts
- packages/cli/tests/design-commands.test.ts
- packages/core/tests/install.test.ts
- packages/mcp/tests/tools.test.ts
Skeleton:
```ts
// mcp/tests/tools.test.ts — 守卫：工具集既无 create_product 也无 delete_product，且无回退/换肤写工具
it("tool set excludes product create/delete and removed write tools", () => {
  const names = new Set(listToolNames());
  for (const n of ["create_product", "delete_product", "rollback_requirement_design", "change_artifact_style"]) {
    expect(names.has(n)).toBe(false);
  }
});
// install/copy-assets：命令列表恰为 6
expect(installedCommandNames().sort()).toEqual(
  ["fm-change-style","fm-design","fm-list-product","fm-refine-components","fm-requirement","fm-status"]);
```
Steps:
- [ ] 删 3 平台 fm-develop-design-handoff 与 fm-rollback-design 模板文件；从 formaAgentCommands(agent/src/index.ts) 与 install.ts 列表移除两命令（两处一致为 6）。
- [ ] mcp/src/tools.ts 移除 delete_product / rollback_requirement_design / change_artifact_style 的 const 名单/schema/映射/描述/handler；rollback 另删实现。
- [ ] core/src/product.ts 删 rollbackDesignPointerLocked（先 grep 复核唯一调用者为已删 handler）；不触底层版本机制。
- [ ] fm-list-product 三平台模板删"删除分支"，shared/SKILL.md 删产品删除指引（保留需求删除约束）。
- [ ] 更新 copy-assets/design-commands/install/tools 测试；新增上述工具集守卫。store.deleteProduct、HTTP DELETE、web ConfirmDeleteDialog 一字不动。
- [ ] 关闭 SCOPE-IN-001、SCOPE-IN-004、SCOPE-IN-005。
Verification: npx vitest run packages/cli/tests/copy-assets.test.ts packages/cli/tests/design-commands.test.ts packages/core/tests/install.test.ts packages/mcp/tests/tools.test.ts && pnpm typecheck

### PLAN-TASK-002 命令前置门槛三档（B1）
Spec References: SPEC-BEHAVIOR-006
Change Type: modify
TDD Applicable: no
Files:
- packages/agent/templates/claude/fm-design.md
- packages/agent/templates/codex/fm-design/SKILL.md
- packages/agent/templates/gemini/fm-design.toml
- packages/agent/templates/claude/fm-refine-components.md
- packages/agent/templates/codex/fm-refine-components/SKILL.md
- packages/agent/templates/gemini/fm-refine-components.toml
- packages/agent/templates/claude/fm-change-style.md
- packages/agent/templates/codex/fm-change-style/SKILL.md
- packages/agent/templates/gemini/fm-change-style.toml
- packages/agent/templates/shared/SKILL.md
Skeleton:
```ts
// 模板文本改动，无单测；行为由 core 错误码（REQUIREMENT_NOT_FOUND / REQUIREMENT_STATUS_INVALID）驱动，
// 受 R2 去壳一致守卫（PLAN-TASK-012）与 design-commands 测试保护。
```
Steps:
- [ ] 在各命令模板写明门槛档位（档1 产品 / 档2 +未归档需求 / 档3 +需求有内容+pages）及命中错误码时的可执行提示（去后台建/激活需求；归档需求如实上报）。
- [ ] 三平台同改（claude/codex/gemini）；agent 侧不另造状态判断；不触碰改页过期状态机。
- [ ] 关闭 SCOPE-IN-006。
Verification: pnpm build && npx vitest run packages/cli/tests/design-commands.test.ts

### PLAN-TASK-003 manifest forma.productIcon 字段与校验（B2 manifest）
Spec References: SPEC-DATA-001
Change Type: modify
TDD Applicable: yes
Files:
- packages/core/src/artifact-manifest.ts
- packages/core/tests/artifact-manifest.test.ts
Skeleton:
```ts
// ArtifactFormaExtension 增 productIcon?: { primary; monochrome; shape:{ shapeId; geometry; sourceVersion } }
it("validates productIcon paths and tolerates absence", () => {
  expect(validateFormaExtension({ productIcon: { primary: "assets/icon.svg", monochrome: "assets/icon-mono.svg",
    shape: { shapeId: "s1", geometry: "<path d='M0 0h8v8H0z'/>", sourceVersion: "1" } } }).ok).toBe(true);
  expect(validateFormaExtension({ productIcon: { primary: "/abs.svg", monochrome: "m.svg",
    shape: { shapeId: "s", geometry: "<g/>", sourceVersion: "1" } } }).ok).toBe(false); // abs path rejected
  expect(validateFormaExtension({}).ok).toBe(true); // 缺字段容错
});
```
Steps:
- [ ] 扩 ArtifactFormaExtension 加可选 productIcon；primary/monochrome 经 validateSupportingPath，shape 三字段非空串；geometry 携带可复用 SVG 本体。
- [ ] validateFormaExtension 增分支；缺字段读取面返回"无 ICON"不抛错。asset 登记 forma.assets(role icon)。
- [ ] 关闭 SCOPE-IN-007（manifest 契约部分）。
Verification: npx vitest run packages/core/tests/artifact-manifest.test.ts && pnpm typecheck

### PLAN-TASK-004 component-baseline.ts 单一事实源数据（B7 数据）
Spec References: SPEC-BEHAVIOR-009, SPEC-DATA-003
Change Type: create
TDD Applicable: yes
Files:
- packages/core/src/component-baseline.ts
- packages/core/tests/component-baseline.test.ts
Skeleton:
```ts
export type Platform = "web" | "mobile";
export interface ComponentBaselineSpec {
  foundations: { color; typography; spacing; radius; elevation; motion; functionalIconStyle };
  productIcon: { variants: ["primary","monochrome"]; derivation: "productName+brandStyle"; shapeStability: "reuse-geometry-recolor" };
  components: Array<{ group: string; name: string; states: string[]; variants?: string[] }>;
}
export const COMPONENT_BASELINES: Record<Platform, ComponentBaselineSpec>;
// test：逐项断言 web 6 组/锁定枚举数、mobile 变体替换；每组件 states 非空
```
Steps:
- [ ] 把 raw-requirement B2 基线清单逐字落为 COMPONENT_BASELINES.web（6 组：动作/表单/数据展示/导航/反馈浮层/通用三态）与 .mobile（移动变体替换导航/交互层）。
- [ ] 锁定确定性枚举（固定 group→component 列表与计数），消解"约28"模糊，使单测可逐项断言。
- [ ] 关闭 SCOPE-IN-012（数据部分）。
Verification: npx vitest run packages/core/tests/component-baseline.test.ts && pnpm typecheck

### PLAN-TASK-005 激活当前组件库指针（B2/B7 核心）
Spec References: SPEC-BEHAVIOR-008, SPEC-DATA-002
Change Type: modify
TDD Applicable: yes
Files:
- packages/core/src/store.ts
- packages/core/tests/store-design-mutations.test.ts
Skeleton:
```ts
it("first refine sets pointer; subsequent appends same artifact version", async () => {
  const a = await store.generateComponents(pid, htmlV1);
  const p1 = await store.products.getProduct(pid);
  expect(p1.designSystemArtifactId).toBe(a.artifact_id);
  const b = await store.generateComponents(pid, htmlV2);
  expect(b.artifact_id).toBe(a.artifact_id);   // 同一 artifact
  expect(b.version).toBe(a.version + 1);        // 追加版本
});
```
Steps:
- [ ] generateComponents：首次新建后 setDesignSystemArtifactPointerLocked；后续读 product.designSystemArtifactId 作为 saveDesignArtifact 的 input.artifactId 传入追加版本。
- [ ] 当前版本 = listArtifactVersions 的 max；新增可观察日志 productId+artifactId+version。
- [ ] 关闭 SCOPE-IN-007（指针写入部分）。
Verification: npx vitest run packages/core/tests/store-design-mutations.test.ts && pnpm typecheck

### PLAN-TASK-006 get_component_baseline + get_design_context 扩展 + 读取面单一事实源（B7）
Spec References: SPEC-BEHAVIOR-009, SPEC-BEHAVIOR-010, SPEC-DATA-004, SPEC-DATA-005
Change Type: modify
TDD Applicable: yes
Files:
- packages/mcp/src/tools.ts
- packages/core/src/design-context.ts
- packages/mcp/tests/tools.test.ts
Skeleton:
```ts
// design-context.ts：DesignContextResult 增 componentBaseline + componentLibrary?(结构化引用，无内联 HTML)
it("get_component_baseline returns platform spec; design context carries refs", async () => {
  expect((await getComponentBaseline(pid)).components.length).toBeGreaterThan(0);
  const ctx = await buildDesignContext(deps, { productId: pid, requirementId: rid });
  expect(ctx.componentBaseline).toBeDefined();
  expect(ctx.componentLibrary?.artifactId).toBe(currentLibArtifactId); // 经指针解析，不按 updated_at
});
it("get_baseline_page/get_baseline_image succeed after pointer set", async () => { /* 评审#5 成功路径 */ });
```
Steps:
- [ ] 新增 MCP get_component_baseline(product_id)（const 名单/schema/描述/handler）；与 history-driven 的 get_product_baseline 并存、命名区分。
- [ ] buildDesignContext 返回 componentBaseline + componentLibrary（{artifactId,version,bundleUrl?,previewUrl?,productIcon?}，HTML 经既有 get_product_artifact/export_artifact 读取）。
- [ ] list_product_artifacts/get_product_artifact/get_design_context 解析"当前组件库"统一经指针，移除任何 updated_at/顺序/superseded 推断；补 get_baseline_page/get_baseline_image 成功路径测试。
- [ ] 关闭 SCOPE-IN-011、SCOPE-IN-012。
Verification: npx vitest run packages/mcp/tests/tools.test.ts && pnpm typecheck

### PLAN-TASK-007 fm-refine-components 产出产品设计系统（B2 生成）
Spec References: SPEC-BEHAVIOR-007
Change Type: modify
TDD Applicable: no
Files:
- packages/agent/templates/claude/fm-refine-components.md
- packages/agent/templates/codex/fm-refine-components/SKILL.md
- packages/agent/templates/gemini/fm-refine-components.toml
Skeleton:
```ts
// 模板文本：经 get_component_baseline 取规格 → 生成 Foundations + 产品 ICON(primary+mono) + 固定基线组件集。
// 三平台同改；无单测，受 R2 守卫(PLAN-TASK-012)与 design-commands 保护。
```
Steps:
- [ ] 模板改为档1（不读需求）；产出含令牌可视化 Foundations + 产品 ICON（产品名+brand_style 派生，复用 shape 只套色）+ 按 platform 固定基线组件集（state-coverage）。
- [ ] 不生成通用图标库/wordmark/完整 VI；favicon 由 ICON 派生；清单来自 get_component_baseline，不抄清单正文。三平台（claude/codex/gemini）同改。
- [ ] 关闭 SCOPE-IN-007（生成模板部分）。
Verification: pnpm build && npx vitest run packages/cli/tests/design-commands.test.ts

### PLAN-TASK-008 fm-change-style 产品级委托并移除 change_artifact_style（B3）
Spec References: SPEC-BEHAVIOR-011
Change Type: modify
TDD Applicable: yes
Files:
- packages/agent/templates/claude/fm-change-style.md
- packages/agent/templates/codex/fm-change-style/SKILL.md
- packages/agent/templates/gemini/fm-change-style.toml
- packages/mcp/src/tools.ts
- packages/core/src/store.ts
- packages/core/tests/store-design-mutations.test.ts
- packages/cli/tests/design-commands.test.ts
Skeleton:
```ts
it("change_artifact_style removed from core and MCP", () => {
  expect(typeof (store as any).changeArtifactStyle).toBe("undefined");
  expect(listToolNames()).not.toContain("change_artifact_style");
});
```
Steps:
- [ ] 模板：update_product_config 落配置 → 委托 fm-refine-components 同一生成流程整体重生成设计系统（ICON 复用 shape 只套色，经 PLAN-TASK-005 追加版本+指针，self-review 至通过）；不触 design-page；结束无后续。三平台同改。
- [ ] 删 change_artifact_style：MCP 名单/schema/映射/描述/handler + core changeArtifactStyle/changeArtifactStyleWithManifest/接口/导出；grep 复核无其它调用者；更新相关测试。
- [ ] 关闭 SCOPE-IN-008。
Verification: npx vitest run packages/core/tests/store-design-mutations.test.ts packages/mcp/tests/tools.test.ts packages/cli/tests/design-commands.test.ts && pnpm typecheck

### PLAN-TASK-009 fm-design 缺组件库两段式停下、按需复用、rule 1（B4/B6/B5）
Spec References: SPEC-BEHAVIOR-012, SPEC-BEHAVIOR-013
Change Type: modify
TDD Applicable: yes
Files:
- packages/agent/templates/claude/fm-design.md
- packages/agent/templates/codex/fm-design/SKILL.md
- packages/agent/templates/gemini/fm-design.toml
- packages/agent/templates/shared/SKILL.md
- packages/cli/tests/design-commands.test.ts
Skeleton:
```ts
// design-commands.test.ts：模板含"缺当前组件库指针 → 停下"分支，且区分 never-refined 与 legacy
it("fm-design template stops without pointer and distinguishes legacy", () => {
  const t = readTemplate("fm-design");
  expect(t).toMatch(/designSystemArtifactId/);
  expect(t).toMatch(/fm-refine-components/);
  expect(t).toMatch(/已检测到旧组件库|legacy/i);
});
```
Steps:
- [ ] 模板：生成前检查 product.designSystemArtifactId（非以 list 非空替代）；缺失显式两段式停下，提示区分①从未精修 ②legacy(有 artifact 无指针)→重跑 refine 采纳。
- [ ] 按需复用基线组件与产品 ICON SVG（同 tokens/状态），不为复用而设计、不削弱 Scope fidelity；shared+模板写明 rule 1 不回溯。三平台同改。
- [ ] 关闭 SCOPE-IN-009、SCOPE-IN-010、SCOPE-IN-011（复用部分）。
Verification: npx vitest run packages/cli/tests/design-commands.test.ts && pnpm build

### PLAN-TASK-010 pure-static/self-review 下沉 shared（R3，B 批之后）
Spec References: SPEC-BEHAVIOR-005
Change Type: modify
TDD Applicable: no
Files:
- packages/agent/templates/shared/SKILL.md
- packages/agent/templates/claude/fm-design.md
- packages/agent/templates/codex/fm-design/SKILL.md
- packages/agent/templates/gemini/fm-design.toml
- packages/agent/templates/claude/fm-refine-components.md
- packages/agent/templates/codex/fm-refine-components/SKILL.md
- packages/agent/templates/gemini/fm-refine-components.toml
Skeleton:
```ts
// shared 收敛 pure-static 契约与 self-review 协议为带锚点小节；fm-design/fm-refine-components 改引用。
// product_id 前置不下沉；补"存前确认不对称"说明。语义不变，受 R2 守卫保护。
```
Steps:
- [ ] shared/SKILL.md 增 pure-static 与 self-review 锚点小节 + 存前确认不对称说明；两生成命令（三平台）改为引用。
- [ ] 必须在 B 批模板改动稳定后执行（下沉最终正文）。关闭 SCOPE-IN-003。
Verification: pnpm build && npx vitest run packages/cli/tests/design-commands.test.ts

### PLAN-TASK-011 补 gemini fm-design 缺失 Scope fidelity 段（R2）
Spec References: SPEC-BEHAVIOR-004
Change Type: modify
TDD Applicable: no
Files:
- packages/agent/templates/gemini/fm-design.toml
Skeleton:
```ts
// 把 claude/codex 已有的 `Scope fidelity (hard rule)` 整段补入 gemini/fm-design.toml 第 5 步，去壳后与两者逐字一致。
```
Steps:
- [ ] 补齐 gemini/fm-design.toml 的 Scope fidelity (hard rule) 段，使三平台去壳正文一致。关闭 SCOPE-IN-002（补段部分）。
Verification: pnpm build

### PLAN-TASK-012 三平台去壳一致守卫（R2，链路最后锁）
Spec References: SPEC-BEHAVIOR-004
Change Type: create
TDD Applicable: yes
Files:
- packages/agent/tests/template-parity.test.ts
Skeleton:
```ts
import { formaAgentCommands, formaAgentPlatformMetadata } from "../src/index.js";
describe("three-platform deshelled parity", () => {
  for (const cmd of formaAgentCommands) {
    it(`${cmd} bodies identical across platforms`, () => {
      const bodies = ["claude","codex","gemini"].map((p) => deshell(readTemplate(p, cmd), p));
      expect(bodies[1]).toBe(bodies[0]);
      expect(bodies[2]).toBe(bodies[0]);
    });
  }
});
```
Steps:
- [ ] 新增守卫：按 formaAgentPlatformMetadata 去壳（frontmatter/toml 包裹/$ 前缀）后断言最终 6 命令三平台正文逐字一致；手动单点漂移反证一次。
- [ ] 必须在 B 批与 R3 之后落地（锁最终命令集）。关闭 SCOPE-IN-002（守卫部分）。
Verification: npx vitest run packages/agent/tests/template-parity.test.ts

### PLAN-TASK-013 web 版本/回退 UI 下线（W1–W5）
Spec References: SPEC-BEHAVIOR-014
Change Type: modify
TDD Applicable: yes
Files:
- packages/web/src/pages/VersionCompare.tsx
- packages/web/src/routes.tsx
- packages/web/src/pages/DesignView.tsx
- packages/web/src/i18n.ts
- packages/web/src/pages/DesignView.test.tsx
Skeleton:
```ts
it("no compare route/link; current design renders when current_version is not max", () => {
  expect(routePaths()).not.toContain("/compare");
  const view = renderDesign({ versions: [1,2,3], current_version: 2 });
  expect(view.activeVersion).toBe(2); // 内部活跃指针保留
});
```
Steps:
- [ ] 删 VersionCompare.tsx 页 + routes.tsx 的 compare import/route/VersionCompareRoute；删 DesignView 对比链接与 version_count>=2 过滤、用户可见版本号；删 6 个对比 i18n 键(en+zh 12 条)与悬挂引用。
- [ ] 保留 current_version 内部活跃指针；api.ts/server/core/底层版本机制零改动；/rollback/plan 残留不动。与 PLAN-TASK-015 同改 DesignView.tsx → 串行/合并为一个改动批。
- [ ] 关闭 SCOPE-IN-013。
Verification: npx vitest run packages/web/src/pages/DesignView.test.tsx && pnpm --filter @xenonbyte/forma-web build

### PLAN-TASK-014 标注画布改白底（BC1）
Spec References: SPEC-BEHAVIOR-015
Change Type: modify
TDD Applicable: yes
Files:
- packages/web/src/pages/AnnotationPage.tsx
- packages/web/src/pages/AnnotationPage.test.tsx
Skeleton:
```ts
it("annotation canvas is light with WCAG-AA labels, behaviors unchanged", () => {
  const { container } = render(<AnnotationPage {...fx} />);
  expect(bgColor(container)).toMatch(/#ffffff|#fafafa/i);
  // 点网深点 on 白、磨砂框/标签适配；选中/hover/fit 行为不变
});
```
Steps:
- [ ] 底色→白、容器边浅色、点网深点 on 白、focus 磨砂框与标题标签色适配，满足 WCAG AA 不新增 contrast-aa 失败；不动 CanvasKit 渲染/选中/hover/fit 逻辑。
- [ ] 关闭 SCOPE-IN-014。
Verification: npx vitest run packages/web/src/pages/AnnotationPage.test.tsx

### PLAN-TASK-015 设计画布增强：标题标签+选中框+pan/zoom（BC2）
Spec References: SPEC-BEHAVIOR-015
Change Type: modify
TDD Applicable: yes
Files:
- packages/viewer/src/Canvas.tsx
- packages/viewer/src/Canvas.browser.test.tsx
- packages/web/src/pages/DesignView.tsx
Skeleton:
```ts
it("design canvas shows per-tile title label and selection frame", async () => {
  const { getAllByTestId } = render(<Canvas mode="design" tiles={tiles} />);
  expect(getAllByTestId("tile-title").length).toBe(tiles.length);
  await selectTile(0);
  expect(getByTestId("selection-frame")).toBeVisible();
});
```
Steps:
- [ ] viewer/Canvas.tsx 增逐 tile 标题标签（对齐 PageFrameOverlays）+ 选中框（补 elementsSelectable 选中态，对齐 FocusFrame）+ pan/zoom 手感对齐；保持 React Flow + HTML DesignTile 不换引擎。
- [ ] DesignView.tsx 宿主改动与 PLAN-TASK-013 合并为一个改动批避免冲突。可核对项：标签存在/选中框可见/滚轮缩放+拖拽平移一致（非像素复刻）。
- [ ] 关闭 SCOPE-IN-015。
Verification: npx vitest run packages/viewer/src/Canvas.browser.test.tsx && pnpm --filter @xenonbyte/forma-web build

### PLAN-TASK-016 品牌资源页与 product-level mapper（BC3 新建）
Spec References: SPEC-BEHAVIOR-015
Change Type: create
TDD Applicable: yes
Files:
- packages/web/src/pages/BrandResources.tsx
- packages/web/src/viewer/brandResourcesMapper.ts
- packages/web/src/pages/BrandResources.test.tsx
Skeleton:
```ts
// brandResourcesMapper.ts：不复用 design-page 前提的 mapArtifactsToViewerInputs；分组键固定 "brand-resources"
it("renders component-library via pointer + productIcon tile; empty state when no pointer", () => {
  const { getByTestId, queryByText } = render(<BrandResources product={withPointer} />);
  expect(getByTestId("brand-tile")).toBeInTheDocument();
  expect(getByTestId("product-icon-tile")).toBeInTheDocument(); // 经 manifest.forma.productIcon，不解析 HTML
  render(<BrandResources product={noPointer} />);
  expect(queryByText(/fm-refine-components/)).toBeTruthy(); // 空态
});
```
Steps:
- [ ] 新建 BrandResources 页：经 designSystemArtifactId 指针读当前 component-library，渲染 HTML + 由 manifest forma.productIcon 解析的 ICON 图片 tile；复用 PLAN-TASK-015 增强后的 viewer Canvas。
- [ ] 新建 product-level mapper（分组键 brand-resources，不需 page_id/variant）；无指针时空态提示去 fm-refine-components。
- [ ] 关闭 SCOPE-IN-016（页面/mapper 部分）。
Verification: npx vitest run packages/web/src/pages/BrandResources.test.tsx && pnpm --filter @xenonbyte/forma-web build

### PLAN-TASK-017 品牌资源入口与路由接线（BC3）
Spec References: SPEC-BEHAVIOR-015
Change Type: modify
TDD Applicable: no
Files:
- packages/web/src/pages/ProductDetail.tsx
- packages/web/src/routes.tsx
- packages/web/src/i18n.ts
Skeleton:
```ts
// ProductDetail 加"品牌资源"入口卡片/链接 → 新路由 /products/:productId/brand → BrandResources；i18n 文案 en+zh。
```
Steps:
- [ ] ProductDetail.tsx 加品牌资源入口；routes.tsx 注册 /products/:productId/brand → BrandResources；i18n 增对应文案。
- [ ] 关闭 SCOPE-IN-016（入口/路由部分）。
Verification: pnpm --filter @xenonbyte/forma-web build

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| PLAN-TASK-001 | SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-002, SPEC-BEHAVIOR-003, SPEC-DATA-006 | covered |
| PLAN-TASK-002 | SPEC-BEHAVIOR-006 | covered |
| PLAN-TASK-003 | SPEC-DATA-001 | covered |
| PLAN-TASK-004 | SPEC-BEHAVIOR-009, SPEC-DATA-003 | covered |
| PLAN-TASK-005 | SPEC-BEHAVIOR-008, SPEC-DATA-002 | covered |
| PLAN-TASK-006 | SPEC-BEHAVIOR-009, SPEC-BEHAVIOR-010, SPEC-DATA-004, SPEC-DATA-005 | covered |
| PLAN-TASK-007 | SPEC-BEHAVIOR-007 | covered |
| PLAN-TASK-008 | SPEC-BEHAVIOR-011 | covered |
| PLAN-TASK-009 | SPEC-BEHAVIOR-012, SPEC-BEHAVIOR-013 | covered |
| PLAN-TASK-010 | SPEC-BEHAVIOR-005 | covered |
| PLAN-TASK-011 | SPEC-BEHAVIOR-004 | covered |
| PLAN-TASK-012 | SPEC-BEHAVIOR-004 | covered |
| PLAN-TASK-013 | SPEC-BEHAVIOR-014 | covered |
| PLAN-TASK-014 | SPEC-BEHAVIOR-015 | covered |
| PLAN-TASK-015 | SPEC-BEHAVIOR-015 | covered |
| PLAN-TASK-016 | SPEC-BEHAVIOR-015 | covered |
| PLAN-TASK-017 | SPEC-BEHAVIOR-015 | covered |

## Upstream Summary (read-only)
# Spec

## Behavior Contracts

### SPEC-BEHAVIOR-001 最终命令集为 6 且安装一致（批次1 R1/R5）
删 `fm-develop-design-handoff`、`fm-rollback-design` 后，`formaAgentCommands`（`agent/src/index.ts`）与 `install.ts` 安装列表均恰为 6 项且彼此一致：`fm-list-product`、`fm-status`、`fm-requirement`、`fm-design`、`fm-refine-components`、`fm-change-style`。三平台模板文件（claude/codex/gemini）对应删除。重装后 `~/.claude/commands/` 不含被删命令。

### SPEC-BEHAVIOR-002 MCP 工具集净变化 +1/−3（R4/R5/B3/B7）
工具集移除 `delete_product`、`rollback_requirement_design`、`change_artifact_style`，新增 `get_component_baseline`；保留 `get_product_baseline`、`generate_components`、`get_design_context`、`update_product_config`、`list_styles`、`get_style` 及 4 个读取工具（`get_design_handoff`/`get_page_ui`/`get_ui_node`/`search_page_ui`）。工具集**既不含 `create_product` 也不含 `delete_product`**（守卫固化）。

### SPEC-BEHAVIOR-003 产品删除仅经后台、core/HTTP/web 保留（R4 边界）
删 MCP `delete_product` 后，`store.deleteProduct`、HTTP `DELETE /api/products`、web `ConfirmDeleteDialog` 行为零变化；后台删除流程端到端可用。`fm-list-product` 模板与 `shared/SKILL.md` 不再含产品删除指引，但保留**需求删除**约束文案。

### SPEC-BEHAVIOR-004 三平台去壳正文逐字一致（R2）
`gemini/fm-design.toml` 含 `Scope fidelity (hard rule)` 段，与 claude/codex 一致。守卫测试对最终 6 命令逐一去壳（按 `formaAgentPlatformMetadata` 移除 frontmatter/toml 包裹/`$` 前缀）后断言三平台正文逐字相等；任一平台单点漂移即失败（手动反证一次）。

### SPEC-BEHAVIOR-005 样板下沉后命令语义不变（R3）
`fm-design`/`fm-refine-components` 模板引用 `shared/SKILL.md` 的 pure-static / self-review 锚点小节而非各自抄写；`fm-change-style` 经 B3 为薄委托、不带这些块。product_id 前置不下沉。shared 含"存前确认不对称"说明。下沉后命令运行语义与 R2 守卫均不变。R3 在 B 批之后执行。

### SPEC-BEHAVIOR-006 命令门槛三档复用 core 错误码（B1）
各命令模板声明门槛档位。未满足时：缺未归档需求 → 命中 `REQUIREMENT_NOT_FOUND`，提示去后台建/激活需求（agent 不创建需求）；改归档需求 → `REQUIREMENT_STATUS_INVALID`，如实上报。agent 侧不另造状态判断。不触碰"改页过期→不可归档"状态机。

### SPEC-BEHAVIOR-007 fm-refine-components 产出产品设计系统（B2）
`fm-refine-components` 仅需产品（档1、不读需求；最新需求已归档仍可运行）。产出 kind `component-library` 工件，含 Foundations 区（令牌可视化：色/字/距/圆角/高度/动效，派生自 brand_style）+ 产品 ICON（primary+monochrome，由产品名+brand_style 派生）+ 固定基线组件集（按 platform 交付 web/mobile 变体、覆盖 state-coverage）。不生成通用图标库/wordmark/完整 VI；favicon 由 ICON 派生。基线清单来自 `component-baseline.ts`，模板不复制清单正文。

### SPEC-BEHAVIOR-008 当前组件库指针：激活既有 designSystemArtifactId（B2/B7 核心）
- **首次**：产品无 `designSystemArtifactId` 时，`generateComponents` 新建 component-library artifact 后调 `setDesignSystemArtifactPointerLocked(productId, artifactId)` 落指针。
- **后续**：`generateComponents`（及 B3 委托）读 `product.designSystemArtifactId` 并作为 `saveDesignArtifact` 的 `input.artifactId` 传入 → 同一 artifact 追加不可变新版本；指针 artifactId 不变。
- **当前版本** = 该 artifact `listArtifactVersions` 的 max。
- **单一事实源**：`list_product_artifacts`/`get_product_artifact`/`get_design_context`/web BrandResources 解析"当前组件库"一律经该指针，**不得**用 `updated_at`/数组顺序/`superseded`。
- **副作用**：`get_baseline_page`/`get_baseline_image` 由"恒抛 ARTIFACT_NOT_FOUND"恢复返回数据（须补成功路径测试）；`get_product_baseline`（history-driven）不受影响。
- **存量数据（DECISION-001=B）**：指针未设即视作"无当前组件库"，不迁移、不推断。

### SPEC-BEHAVIOR-009 数据驱动 baseline 规格与 get_component_baseline（B7）
新增 core `component-baseline.ts`，按 platform（web/mobile）键入 `{ foundations, productIcon, components }` 规格；web 清单为权威约28件/6组、mobile 为其移动变体（**逐字镜像 raw-requirement B2 基线清单，不得改写**）。新增 MCP `get_component_baseline(product_id)`，由产品 platform 解析返回对应规格，与既有 `get_product_baseline` 语义并存且命名清晰区分。

### SPEC-BEHAVIOR-010 get_design_context 扩展两字段（B7）
`buildDesignContext` 返回新增 `componentBaseline`（platform 规格）+ `componentLibrary`（由 `designSystemArtifactId` 解析的**结构化引用**，见 SPEC-DATA-004；无指针时为 `undefined`）。`systemStyle` 继续经结构化字段交付（既有、非 bug）。`fm-design` 复用以 `componentLibrary` 为准、`componentBaseline` 为辅。

### SPEC-BEHAVIOR-011 fm-change-style 产品级委托（B3）
`fm-change-style`：① 确认/选 brand_style/system_style（未选→`list_styles`）；② `update_product_config` 落配置；③ 委托 `fm-refine-components` 同一生成流程整体重生成设计系统（经 `get_component_baseline` 取规格、导出当前组件库源 HTML 为基线、套新 tokens、ICON 复用 `shape` geometry 只重新着色、经 SPEC-BEHAVIOR-008 追加版本+指针、self-review 至通过）；④ 不触碰已有 design-page；⑤ 结束无后续。移除 `change_artifact_style`（MCP 名单/schema/映射/描述/handler + core `changeArtifactStyle`/`changeArtifactStyleWithManifest`/接口/导出 + 测试），实施前 grep 复核无其它调用者。

### SPEC-BEHAVIOR-012 fm-design 缺组件库两段式停下（B4）
`fm-design` 生成前检查 `product.designSystemArtifactId`（**不以 `list_product_artifacts(kind=component-library)` 非空替代**）。缺失 → 显式停下、不产出任何设计、流程内无静默生成；提示**区分两情形**：①从未精修 → 提示先跑 `fm-refine-components`；②存量已有并列 artifact 但无指针（legacy）→ 提示"已检测到旧组件库但未登记为当前，重跑一次 fm-refine-components 采纳并接管"。有指针时正常生成。

### SPEC-BEHAVIOR-013 fm-design 按需复用 + rule 1 不回溯（B5/B6）
页面 spec 需要标准元素时优先复用对应基线组件（同 tokens/状态/交互）；展示产品图标时复用产品 ICON SVG；**不为复用而设计**、不削弱 `Scope fidelity (hard rule)`；沉浸式/定制页可省略或替代通用件。shared 指南+模板写明：样式/组件改动（`fm-change-style`/`fm-refine-components`）不回头重生成已有设计稿，旧页面版本不可变直到被重新 `fm-design`。

### SPEC-BEHAVIOR-014 web 版本/回退 UI 下线、current_version 内部保留（W1–W5）
删 `VersionCompare.tsx` + compare 路由/`VersionCompareRoute` + `DesignView.tsx` 对比链接与 `version_count>=2` 过滤 + 用户可见版本号 + 6 个对比 i18n 键（en+zh 12 条）及悬挂引用。`current_version` 内部活跃指针逻辑保留并在 current_version 非最高版本号时仍正确渲染当前设计。`api.ts`/server 路由/core/底层版本机制零改动；`/rollback/plan` 残留保留不动、不视作可用路径。`pnpm --filter @xenonbyte/forma-web build` 通过。

### SPEC-BEHAVIOR-015 web 无限画布白底+增强+品牌资源（BC1/BC2/BC3）
BC1：`AnnotationPage.tsx` 白底 + 深点网 + 适配磨砂框/标签色，满足 WCAG AA、不新增 contrast-aa 失败，CanvasKit 渲染/选中/hover/fit 逻辑不变。BC2：`viewer/src/Canvas.tsx` 增逐 tile 标题标签 + 选中框（补 `elementsSelectable` 选中态）+ pan/zoom 对齐标注，保持 React Flow + HTML `DesignTile`。BC3：`ProductDetail.tsx` 品牌资源入口 + 路由 `/products/:productId/brand` + `BrandResources` 页经指针渲染 component-library HTML + manifest `forma.productIcon` 解析的产品 ICON 图片 tile（不从 HTML 解析 logo）；新增 product-level mapper（分组键 `brand-resources`，不复用 design-page 前提的 `mapArtifactsToViewerInputs`）；无指针时空态提示去 refine。`DesignView.tsx` 的 W2/BC2 改动串行/合并为一个改动批。

## API / Data / Config Contracts

### SPEC-DATA-001 manifest `forma.productIcon` 字段
扩 `ArtifactFormaExtension`（`artifact-manifest.ts:73`）新增可选字段：
```
productIcon?: {
  primary: string;     // bundle 内 SVG asset 相对路径，须 ⊆ supportingFiles，经 validateSupportingPath
  monochrome: string;  // 同上
  shape: { shapeId: string; geometry: string; sourceVersion: string };
}
```
- `shape.geometry` 携带**可复用几何本体**（SVG 内层 markup / path data 字符串），使"复用 geometry 只套色"可从 manifest 恢复（评审 v4 #4 定型：携带几何本体，非仅标识符）。
- asset 同时登记进 `forma.assets`（role `icon`）。
- `validateFormaExtension` 增分支：present 时校验 primary/monochrome 为合法 supporting path、shape 三字段为非空串；**缺字段容错**：读取面遇无 `productIcon` 返回"无 ICON"而非抛错（RISK-MIG-003 [ADDRESSED]）。

### SPEC-DATA-002 当前组件库指针写/读契约
复用既有 `product.designSystemArtifactId`（无 schema 变更）。写入仅经 `setDesignSystemArtifactPointerLocked`，由 `generateComponents`（首次）调用；后续复用指针 artifactId 追加版本。读取统一 helper 解析（artifactId + 最新 version）。无指针 → "无当前组件库"语义（DECISION-001=B）。

### SPEC-DATA-003 `component-baseline.ts` 数据形状
```
type Platform = "web" | "mobile";
interface ComponentBaselineSpec {
  foundations: { color; typography; spacing; radius; elevation; motion; functionalIconStyle };
  productIcon: { variants: ["primary","monochrome"]; derivation: "productName+brandStyle"; shapeStability: "reuse-geometry-recolor" };
  components: Array<{ group: string; name: string; states: string[]; variants?: string[] }>;
}
export const COMPONENT_BASELINES: Record<Platform, ComponentBaselineSpec>;
```
web 与 mobile 两套，components 逐字对应 raw-requirement B2 清单（web 6 组约28件；mobile 变体替换导航/交互层）。单测逐项断言齐全。

### SPEC-DATA-004 `get_design_context.componentLibrary` 交付形态（评审 v3 #2 定型）
`componentLibrary?: { artifactId: string; version: number; bundleUrl?: string; previewUrl?: string; productIcon?: { primary: string; monochrome: string; shape: {...} } }`。**结构化引用，不内联当前 HTML**；模型需完整 markup 时经既有 `get_product_artifact`/`export_artifact` 读取（满足 B7"或等价读取面"，且界定体量、解 RISK-CONTRACT-002 [ADDRESSED]）。无 `designSystemArtifactId` → 字段 `undefined`。

### SPEC-DATA-005 `get_component_baseline` MCP schema
input `{ product_id: string }`；输出该产品 platform 的 `ComponentBaselineSpec`。与 `get_product_baseline`（产品已生成 DS、history-driven）并存、命名区分。新增至工具 const 名单/schema 映射/描述/handler；附 MCP 测试。

### SPEC-DATA-006 MCP / web 删除面接线清单
- MCP 移除：`delete_product`、`rollback_requirement_design`、`change_artifact_style` 的 const 名单/schema/映射/描述/handler（rollback 另删实现）。
- core 移除：`rollbackDesignPointerLocked`（grep 确认唯一调用者即被删 handler）、`changeArtifactStyle`/`changeArtifactStyleWithManifest`/接口/导出。
- web 移除：`VersionCompare.tsx`、`routes.tsx` compare import/route/`VersionCompareRoute`、`DesignView.tsx:115-118`/:59、6 个 i18n 键。
- 新增 web：路由 `/products/:productId/brand` + i18n + `BrandResources` 页。
- 实施期以各 R/B/W 小节行号为线索、按现网复核行号。

## External Documentation Checked
| Dependency | Version | Check Date | Conclusion |
|---|---|---|---|
| @xyflow/react (React Flow) | ^12.0.0 | 2026-06-09 | 本 spec 对画布仅作引擎无关的行为级断言，不涉版本特定 API；BC2/BC3 实现期须经 Context7 核实 custom-node overlay 与 selection/viewport API |
| @vzi-core/renderer (CanvasKit) | BC1 仅改样式参数 | 2026-06-09 | 不触渲染 API、无版本敏感声明，无需外部文档核实 |

- 本阶段不引入未经核实的版本敏感声明（无 `UNCONFIRMED` 断言）；版本特定 API 留 PLAN/实现期 Context7 核实。
- 其余批次为 Forma 本地代码契约（core/mcp/web/agent），不依赖外部库版本行为，非 Context7 适用面。

## Test Matrix
| 测试面 | 用例 | 关联 |
|---|---|---|
| `cli/tests/copy-assets`·`design-commands`·`core/tests/install` | 命令列表/描述为 6、不含 handoff/rollback；删块 | SPEC-BEHAVIOR-001 |
| 新增 R2 守卫（agent/tests） | 6 命令三平台去壳逐字一致；单点漂移失败 | SPEC-BEHAVIOR-004 |
| `mcp/tests/tools` | 工具集无 create/delete_product、无 change_artifact_style、无 rollback_requirement_design；有 get_component_baseline | SPEC-BEHAVIOR-002 |
| `core/tests`（store/product） | generateComponents 首次建指针、后续追加同 artifact 版本、指针 artifactId 不变 | SPEC-BEHAVIOR-008 |
| `core/tests`+`mcp/tests` | list/get_product_artifact/get_design_context 经指针解析当前组件库；不按 updated_at/顺序/superseded | SPEC-BEHAVIOR-008 |
| `mcp/tests/tools` | get_baseline_page/get_baseline_image 在指针设置后成功路径（评审 #5） | SPEC-BEHAVIOR-008 |
| `core/tests`（manifest） | forma.productIcon 校验合法/非法；缺字段容错不抛 | SPEC-DATA-001 |
| `core/tests`（component-baseline） | web/mobile 规格 foundations/productIcon/components 逐项齐全 | SPEC-DATA-003 |
| `mcp/tests/tools` | get_component_baseline 按 platform 返回规格；schema 校验 | SPEC-DATA-005 |
| `core/tests`（design-context） | 返回 componentBaseline + componentLibrary（结构化引用）；无指针时 componentLibrary undefined | SPEC-BEHAVIOR-010/SPEC-DATA-004 |
| `cli/tests/design-commands` | fm-design 无指针停下（含 legacy 分支提示）；有指针正常 | SPEC-BEHAVIOR-012 |
| `core/tests/store-design-mutations`·`mcp/tests` | 移除 change_artifact_style 后用例更新通过 | SPEC-BEHAVIOR-011 |
| `web` `DesignView.test`·`routes` | 无 compare 页/路由/入口；current_version 非最高版本号仍渲染当前设计 | SPEC-BEHAVIOR-014 |
| `web` i18n | 删 6 键无悬挂引用；web build 通过 | SPEC-BEHAVIOR-014 |
| `web` `AnnotationPage.test` | 白底+适配后颜色断言；选中/hover/fit 不变 | SPEC-BEHAVIOR-015 |
| `web`+`viewer` `Canvas`/`DesignView.test` | tile 标题标签 + 选中框；BrandResources 经指针渲染 + ICON tile + 空态；product-level mapper 不需 page_id/variant | SPEC-BEHAVIOR-015 |
| 全局 | `pnpm typecheck` / `pnpm build` / `pnpm test` 全绿 | 所有 |

## Non-goals
- 不删/改 4 个 MCP 读取工具及 `design-handoff.ts`/`vzi-read-layer.ts`（SCOPE-OUT-001）。
- 不改 core 产品删除逻辑、HTTP `POST`/`DELETE /api/products`、web `ConfirmDeleteDialog`（SCOPE-OUT-002）。
- 不改底层版本机制（不可变 `v{n}`/`current_version`/supersede/按版本服务）（SCOPE-OUT-003）。
- 不改 web `api.ts`/server 版本路由/core；`/rollback/plan` 残留不动（SCOPE-OUT-004）。
- 不批量重生成已有设计页；不新增样式存储/token 覆写；不生成通用图标库/wordmark/完整 VI（SCOPE-OUT-005/006）。
- 不合并/更换画布引擎（SCOPE-OUT-007）。
- 不引入命令单源生成器；不做按域名补充专有组件；不规格化回退（B8 取消）（SCOPE-OUT-008）。
- 不做存量产品指针回填迁移（DECISION-001=B）。
- 不在本 spec 对 React Flow 版本特定 API 作断言（留 PLAN/实现期 Context7 核实）。

## PLAN Handoff
- **排期硬依赖**：R1/R4/R5 → B1–B7 → R3 → R2；BC3 正式验收依赖 B2/B7（SPEC-BEHAVIOR-008/009）；`DesignView.tsx` 的 W2 与 BC2 合并为单一改动批。
- **任务切分建议**：(1) 命令/工具删除批（R1/R4/R5）+守卫；(2) 指针激活+manifest productIcon+component-baseline 数据+get_component_baseline+get_design_context 扩展（B2/B7，core 重心）；(3) 命令语义（B1/B3/B4/B5/B6）；(4) R3 下沉 + R2 守卫；(5) web W 批；(6) web/viewer BC 批。
- **实现期 Context7**：xyflow 选择/视口/自定义 node API（BC2/BC3）。
- **复核动作**：删除前 grep 复核 `rollbackDesignPointerLocked`/`changeArtifactStyle*` 无其它调用者；按现网行号定位接线点。
- **验收闸门**：各 SPEC-BEHAVIOR/SPEC-DATA 对应 Test Matrix 行 + 三大 `pnpm` 检查全绿 + WCAG AA 不回退。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| SPEC-BEHAVIOR-001 | DES-ARCH-001 | [ADDRESSED] |
| SPEC-BEHAVIOR-002 | DES-ARCH-001, DES-ARCH-006, DES-ARCH-007 | [ADDRESSED] |
| SPEC-BEHAVIOR-003 | DES-ARCH-001 | [ADDRESSED] |
| SPEC-BEHAVIOR-004 | DES-ARCH-002 | [ADDRESSED] |
| SPEC-BEHAVIOR-005 | DES-ARCH-002 | [ADDRESSED] |
| SPEC-BEHAVIOR-006 | DES-ARCH-003 | [ADDRESSED] |
| SPEC-BEHAVIOR-007 | DES-ARCH-004 | [ADDRESSED] |
| SPEC-BEHAVIOR-008 | DES-ARCH-005 | [ADDRESSED] |
| SPEC-BEHAVIOR-009 | DES-ARCH-006 | [ADDRESSED] |
| SPEC-BEHAVIOR-010 | DES-ARCH-006 | [ADDRESSED] |
| SPEC-BEHAVIOR-011 | DES-ARCH-007 | [ADDRESSED] |
| SPEC-BEHAVIOR-012 | DES-ARCH-008 | [ADDRESSED] |
| SPEC-BEHAVIOR-013 | DES-ARCH-008 | [ADDRESSED] |
| SPEC-BEHAVIOR-014 | DES-ARCH-009 | [ADDRESSED] |
| SPEC-BEHAVIOR-015 | DES-ARCH-010 | [ADDRESSED] |
| SPEC-DATA-001 | DES-ARCH-004 | [ADDRESSED] |
| SPEC-DATA-002 | DES-ARCH-005 | [ADDRESSED] |
| SPEC-DATA-003 | DES-ARCH-006 | [ADDRESSED] |
| SPEC-DATA-004 | DES-ARCH-006 | [ADDRESSED] |
| SPEC-DATA-005 | DES-ARCH-006 | [ADDRESSED] |
| SPEC-DATA-006 | DES-ARCH-001, DES-ARCH-007, DES-ARCH-009 | [ADDRESSED] |

## Upstream Summary (read-only)
# Design

## Design Summary
四批改造落在既有架构的真实接缝上，**绝大多数是"接线/收口/删壳"，而非新建子系统**。代码核查推翻了需求文档的一个隐含前提：B2/B7 的"当前组件库指针"**并非全新数据契约**——产品 schema 已有 `designSystemArtifactId`（`product.ts:61`）+ 写方法 `setDesignSystemArtifactPointerLocked`（`product.ts:270`），且已被 2 个读取面消费（`get_baseline_page`/`getBaselinePage:1225`、`get_baseline_image`/`getBaselineImage:1244`）；但**无任何写入者**，故这两个 baseline 工具当前恒抛 `ARTIFACT_NOT_FOUND`。（注：另有 `get_product_baseline` 工具是 history-driven、与该指针无关、不受影响。）因此 B2/B7 的核心是"激活既有指针"：让 `generateComponents` 复用同一 artifactId 追加版本并写指针，再把 `get_design_context` 接到该指针。其余批次：R1/R4/R5 删命令壳与 MCP 写工具壳（core/HTTP/web 保留）；R2/R3 模板一致性与下沉；B1/B3/B4/B6 命令语义；W 批纯删 web 前端面；BC 批纯 web/viewer 增强。设计围绕 10 个架构单元（DES-ARCH-001..010）展开。

## Current Code Evidence
- **设计上下文**：`buildDesignContext`（`packages/core/src/design-context.ts:30`）返回 `{craft, brandStyle, systemStyle, page, rules, platform, language}`——与需求文档所述一字不差；B7 需加 `componentBaseline` + `componentLibrary` 两字段。
- **产品级指针**：`product.ts` `productSchema` 含 `designSystemArtifactId?:string`（:61，产品级当前 component-library 指针，仅 artifactId 无版本号）、`requirements[reqId].latestArtifactId`（:60 每需求最新设计）、`designPointers[]`（:62，每 (reqId,pageId,variant) 带 version+designStatus）。写方法：`setDesignSystemArtifactPointerLocked`（:270）、`setDesignPointerLocked`（:276）。
- **指针写入缺口（关键）**：`grep` 确认 `setDesignSystemArtifactPointerLocked` **零调用者**——`designSystemArtifactId` 从不被写入。`getBaselinePage`（`tools.ts:1225`，工具 `get_baseline_page`）/`getBaselineImage`（:1244，工具 `get_baseline_image`）读它 → 现网恒 `ARTIFACT_NOT_FOUND`。**注**：`get_product_baseline`（handler `getProductBaseline`，:420）**不读该指针**——它由需求历史聚合（history-driven），与本指针正交、不受影响（评审 v3 修正）。
- **生成生命周期**：`saveDesignArtifact`（`design-save.ts`）`const artifactId = input.artifactId ?? generateArtifactId()`（:206-207，传 id 追加版本/不传则新建 v1）；`setDesignPointerLocked` 仅对 **design-page** 调用（:9 注释、:264）。`generateComponents`（`store.ts:220`）以 kind `component-library` 调 `saveDesignArtifact` 但**不传 artifactId、不设指针** → 现状每次 refine 产出并列新 artifact（正是 B2 要修的问题）。
- **R5 死码确认**：`rollbackDesignPointerLocked`（`product.ts:302`）唯一调用者为 `tools.ts:1017`（`rollback_requirement_design` handler，:1016）；删 MCP 工具后即死码。
- **MCP 工具清单**（`tools.ts` const 名单）：含删除目标 `delete_product`（:40）、`rollback_requirement_design`（:56）、`change_artifact_style`（:59）；保留 `get_product_baseline`（:40）、`generate_components`（:58）、`get_design_context`（:60）、`update_product_config`（:49）、`list_styles`/`get_style`（:50-51）。**无 `create_product`**（创建侧规则已满足）。
- **命名冲突**：已存在 MCP 工具 `get_product_baseline`（读产品**已生成**的 DS via 指针）；B7 要新增 `get_component_baseline`（返回 Forma **内置规格** component-baseline.ts）。二者语义不同、须并存且命名清晰区分。
- **manifest 扩展点**：`ArtifactFormaExtension`（`artifact-manifest.ts:73`）有 `assets[]`（path/density/role）/`provenance`/`quality`/`preview`，**无 `productIcon`**；B2 需新增 `forma.productIcon` 字段 + `validateFormaExtension`（:104）校验。`normalizeKind`（:93）已映射 legacy `design-system`→`component-library`。
- **删除路径边界**：`store.deleteProduct`（`store.ts`）由 MCP `delete_product`（:419）与后台 HTTP `DELETE /api/products` 共享——R4 仅删 MCP 壳，store/HTTP/web `ConfirmDeleteDialog` 保留。
- **web 版本面**（需求文档已逐处核实，未复验，标 [DOC]）：`VersionCompare.tsx`、`routes.tsx` compare 路由、`DesignView.tsx` 对比链接 + `version_count>=2` 过滤、6 个 i18n 键；`current_version` 内部活跃指针用途保留。
- **画布**（[DOC]）：`AnnotationPage.tsx`（CanvasKit/VZI，深底 `#2b2b2b`）、`viewer/src/Canvas.tsx`（React Flow/HTML `DesignTile`，白底）；不换引擎。

## Requirements Coverage
| SCOPE-IN | DES-ARCH | 说明 |
|---|---|---|
| SCOPE-IN-001 (R1) | DES-ARCH-001 | 删 fm-develop-design-handoff 命令壳 |
| SCOPE-IN-004 (R4) | DES-ARCH-001 | 删 MCP delete_product + 命令删除分支 + 守卫 |
| SCOPE-IN-005 (R5) | DES-ARCH-001 | 删 fm-rollback-design + MCP 工具 + 死 core |
| SCOPE-IN-002 (R2) | DES-ARCH-002 | 三平台去壳一致守卫 + 补 gemini 缺段 |
| SCOPE-IN-003 (R3) | DES-ARCH-002 | pure-static/self-review 下沉 shared |
| SCOPE-IN-006 (B1) | DES-ARCH-003 | 门槛三档（复用错误码） |
| SCOPE-IN-007 (B2) | DES-ARCH-004, DES-ARCH-005 | 设计系统生成 + 当前组件库指针 |
| SCOPE-IN-012 (B7) | DES-ARCH-005, DES-ARCH-006 | 指针契约 + 数据驱动 baseline 上下文 |
| SCOPE-IN-008 (B3) | DES-ARCH-007 | 产品级换肤 + 移除 change_artifact_style |
| SCOPE-IN-009 (B4) | DES-ARCH-008 | 缺组件库两段式停下 |
| SCOPE-IN-010 (B5) | DES-ARCH-008 | rule 1 不回溯（模板/shared 文案） |
| SCOPE-IN-011 (B6) | DES-ARCH-008 | 按需复用基线组件与产品 ICON |
| SCOPE-IN-013 (W1–W5) | DES-ARCH-009 | web 版本/回退 UI 下线 |
| SCOPE-IN-014 (BC1) | DES-ARCH-010 | 标注画布白底适配 |
| SCOPE-IN-015 (BC2) | DES-ARCH-010 | 设计画布增强（viewer/Canvas） |
| SCOPE-IN-016 (BC3) | DES-ARCH-010 | 品牌资源画布 + product-level mapper |

## Options Considered
- **OPT-A 当前组件库指针**：(A1) 复用既有 `designSystemArtifactId` + 修写入路径〔选〕；(A2) 新建独立 `componentLibraryPointer` 字段〔弃：与既有读取面重复、徒增迁移面〕。证据：指针字段+读取面已存在、仅缺写入者，复用成本最低且顺带激活既有 baseline 工具。
- **OPT-B 既有数据迁移**（见 DECISION-001）：(B1) 启动期/读取期回退推断〔弃：违反"不得用 updated_at/顺序/superseded 推断"〕；(B2) 不迁移、指针未设即视作"无当前组件库" → B4 停下，首次 refine 建指针〔推荐〕。
- **OPT-C `componentLibrary` 交付形态**（RISK-CONTRACT-002）：(C1) 结构化引用（artifact_id/version/bundle/preview + manifest productIcon）+ 按需读取面〔选〕；(C2) 整段内联当前 HTML〔弃：组件库 HTML 大、撑爆上下文〕。可保留"可选 HTML 摘要/截断"作为软附加。
- **OPT-D 新 baseline 工具命名**：沿用需求文档 `get_component_baseline`（内置规格）与既有 `get_product_baseline`（产品已生成 DS）并存〔选〕；不重命名既有工具以免扩大破坏面。
- **OPT-E 画布引擎**：不合并 CanvasKit/VZI 与 React Flow/HTML，只对齐观感与交互〔选，遵 SCOPE-OUT-007〕。
- **OPT-F R2 一致性**：方案 B（去壳逐字守卫 + 手补缺段）〔选〕；方案 A（单源生成器）〔弃，SCOPE-OUT-008〕。

## Chosen Design

### DES-ARCH-001 命令集清理与 MCP 写工具收口（R1/R4/R5）
删 3 组命令面，**只动壳层**：(a) agent 模板（claude/codex/gemini 各 3 文件）+ `formaAgentCommands`（`agent/src/index.ts`）+ `install.ts` 安装列表（两处一致）；(b) MCP 写工具壳 `delete_product`/`rollback_requirement_design`/`change_artifact_style`（const 名单/schema/描述/handler，rollback 另删实现 + R5 死 core `rollbackDesignPointerLocked`）；(c) `fm-list-product` 删除分支 + `shared/SKILL.md` 产品删除指引（保留需求删除约束）。**保留**：`store.deleteProduct`、HTTP `DELETE /api/products`、web `ConfirmDeleteDialog`、底层版本机制、4 个 MCP 读取工具。新增守卫测试：MCP 工具集既无 `create_product` 也无 `delete_product`。R5 删 `rollbackDesignPointerLocked` 前以 grep 复核（已确认唯一调用者是被删的 handler）。破坏性移除（无 deprecation 窗口）在实施记录显式标注（RISK-MIG-001）。

### DES-ARCH-002 三平台模板一致性与样板下沉（R2/R3）
R2：补 `gemini/fm-design.toml` 缺失的 `Scope fidelity (hard rule)` 段；新增 vitest 守卫——按 `formaAgentPlatformMetadata` 去壳（frontmatter/toml 包裹/`$` 前缀）后断言三平台正文逐字一致，覆盖**最终 6 命令集**。R3（**排 B 批之后**）：pure-static 契约、self-review 协议各收敛为 `shared/SKILL.md` 带锚点小节，仅 `fm-design`/`fm-refine-components` 引用；product_id 前置不下沉；补"存前确认不对称"说明。顺序硬依赖：R3 下沉的是 B3/B1/B4 改后的最终正文，R2 守卫最后锁（RISK-DEP-001）。

### DES-ARCH-003 命令前置门槛三档（B1）
模板层声明门槛档位（档1 产品 / 档2 +未归档需求 / 档3 +需求有内容+pages），未满足时复用 **core 现有错误码**（`REQUIREMENT_NOT_FOUND`→提示去后台建/激活需求；`REQUIREMENT_STATUS_INVALID`→如实上报），agent 侧不另造状态判断。不触碰"改页过期→不可归档"状态机。

### DES-ARCH-004 产品设计系统生成物（B2）
`fm-refine-components` 定位档1，产出 kind `component-library` 工件，含 Foundations 区（令牌可视化，派生自 brand_style）+ 产品 ICON（primary+monochrome）+ 固定基线组件集（按 platform）。**manifest 扩展**：`ArtifactFormaExtension` 新增 `productIcon: { primary: <assetPath>, monochrome: <assetPath>, shape: { geometryId/shapeId/sourceVersion } }`，asset 落 `forma.assets`（role `icon`）；扩 `validateFormaExtension` 校验。ICON 复用：已有当前 ICON 时复用 `shape` geometry、只按新 tokens 重新着色；无则新建。favicon 由 ICON 小尺寸派生。不生成通用图标库/wordmark/完整 VI（SCOPE-OUT-006）。

### DES-ARCH-005 当前组件库指针：激活既有 `designSystemArtifactId`（B2/B7 核心）
复用既有字段而非新建。改 `generateComponents`（及 B3 委托路径）：**首次**生成新 artifact 后调 `setDesignSystemArtifactPointerLocked(productId, artifactId)`；**后续**读取 `product.designSystemArtifactId`，把它作为 `saveDesignArtifact` 的 `input.artifactId` 传入 → 在同一 artifact 追加不可变新版本（design-save.ts 既有语义）。当前版本 = 该 artifact 的最新版本（`listArtifactVersions` 取 max）。**单一事实源收口**：`list_product_artifacts`/`get_product_artifact`/`get_design_context` 及 web BrandResources 一律以该指针解析"当前组件库"，移除任何 updated_at/顺序/superseded 推断。副作用：既有 `get_baseline_page` / `get_baseline_image` 随之从"恒抛 ARTIFACT_NOT_FOUND"恢复可用（`get_product_baseline` 为 history-driven、与指针无关、不受影响）；二者的成功路径须补测试（见 SPEC Handoff）。既有数据迁移见 DECISION-001。

### DES-ARCH-006 数据驱动设计系统上下文（B7）
新增 core `packages/core/src/component-baseline.ts`：按 platform（web/mobile）键入 `{ foundations 分类, productIcon 规格, components 清单 }`，单一事实源、单测逐项断言。新增 MCP `get_component_baseline(product_id)`（由产品 platform 解析返回规格；与既有 `get_product_baseline` 语义并存、命名区分，OPT-D）。扩 `buildDesignContext` 返回 `componentBaseline`（规格）+ `componentLibrary`（由 `designSystemArtifactId` 解析的结构化引用：artifact_id/version/bundle·preview 引用/manifest `forma.productIcon`；HTML 仅按需/可截断，OPT-C）。`systemStyle` 继续经结构化字段交付（既有，非 bug）。新增/扩展 MCP schema + 测试。

### DES-ARCH-007 产品级换肤委托（B3）
`fm-change-style` 重定义为薄命令：① 确认/选 brand_style/system_style；② `update_product_config` 落配置；③ 委托执行 `fm-refine-components` 同一生成流程（经 `get_component_baseline` 取规格、导出当前组件库源 HTML 为基线、套新 tokens、ICON 复用 shape 只套色、`generate_components` 经 DES-ARCH-005 追加版本 + 更新指针、self-review 至通过）；④ 不触碰已有 design-page；⑤ 结束无后续。移除旧单产物 `change_artifact_style`：MCP（名单/schema/映射/描述/handler）+ core `changeArtifactStyle`/`changeArtifactStyleWithManifest`（`store.ts:240-298`/:307 导出/:84 接口）+ 相关测试；grep 复核无其它调用者。

### DES-ARCH-008 fm-design 门槛、两段式停下与按需复用（B4/B6/B5）
`fm-design` 生成前检查 `product.designSystemArtifactId` 是否存在（**不以 `list_product_artifacts(kind=component-library)` 非空替代**）；缺失 → 显式两段式停下，提示先跑 `fm-refine-components`，流程内无静默生成（B4）。**停下提示须区分两种缺指针情形（落实 DECISION-001 选项 B 的可用性）**：①从未精修过组件 → "先跑 fm-refine-components 生成设计系统"；②存量产品已有并列 component-library artifact 但指针未设（legacy）→ "已检测到旧组件库但未登记为当前；重跑一次 fm-refine-components 以采纳并接管后续版本"，避免用户困惑"我明明已经有组件库"。生成时经 DES-ARCH-006 的 `componentBaseline`+`componentLibrary` 按需复用基线组件与产品 ICON SVG（同 tokens/状态/同一 mark），不为复用而设计、不削弱 `Scope fidelity (hard rule)`、沉浸式/定制页可省略通用件（B6）。shared 指南 + 模板写明 rule 1：样式/组件改动不回溯已生成设计稿（B5）。

### DES-ARCH-009 web 版本/回退 UI 下线（W1–W5，纯前端）
删 `VersionCompare.tsx` 页 + `routes.tsx` compare import/route/`VersionCompareRoute`；删 `DesignView.tsx` 对比链接（:115-118）与 `version_count>=2` 过滤（:59）；删用户可见版本号展示；删 6 个对比 i18n 键（en+zh 12 条）及悬挂引用。**保留** `current_version` 内部活跃指针（DesignView 选当前设计、RequirementDetail 判可渲染）——含 current_version 非最高版本号场景的测试（RISK-REG-002）。`api.ts`/server 路由/core/底层版本机制零改动；`/rollback/plan` 客户端残留保留不动、不视作可用路径。

### DES-ARCH-010 web 无限画布（BC1/BC2/BC3，纯 web/viewer）
BC1：`AnnotationPage.tsx` 底色→白 + 点网（深点 on 白）/focus 磨砂框/标题标签色适配，满足 WCAG AA、不新增对比失败（参 `viewer-craft-contrast-debt`），仅改样式不动 CanvasKit 逻辑。BC2：增强落 `viewer/src/Canvas.tsx`——逐 tile 标题标签（对齐标注 `PageFrameOverlays`）+ 选中框（对齐 `FocusFrame`，补 `elementsSelectable` 选中态）+ pan/zoom 手感对齐；保持 React Flow + HTML `DesignTile`，BC3 复用。BC3：`ProductDetail.tsx` 加品牌资源入口 + 路由 `/products/:productId/brand` + `BrandResources` 页，经 `designSystemArtifactId` 指针渲染 component-library HTML + 由 manifest `forma.productIcon` 解析的产品 ICON 图片 tile；新增 product-level viewer mapper（不复用 design-page 前提的 `mapArtifactsToViewerInputs`，分组键固定 `brand-resources`）；无指针时空态提示去 refine。`DesignView.tsx` 被 W2 与 BC2 同改 → 串行/合并（RISK-DEP-003）。

## Decision Requests
### DECISION-001 既有产品的"当前组件库指针"迁移策略
Question: 对已运行过 `fm-refine-components`、已有并列 component-library/design-system artifact 但 `designSystemArtifactId` 未设的存量产品，激活指针后如何解析"当前组件库"？（需求文档禁止用 updated_at/列表顺序/superseded 推断。）
Options: A) 一次性迁移脚本回填指针（须定义"选哪个 artifact"的确定性规则，但任何按时间/顺序的选择都触碰被禁止的推断，难以无歧义） / B) 不迁移——指针未设即视作"无当前组件库"，存量产品首次 `fm-design` 撞 B4 两段式停下、提示重跑 `fm-refine-components`，该次 refine 建立指针并接管后续版本
Recommended: B
Rationale: B 零推断、与 B4"先有设计系统"语义自洽、无脏数据风险；存量产品仅多一次显式 refine。A 无法在不违反"禁止推断"前提下确定回填目标。
Decision: B（不迁移——指针未设视作"无当前组件库"，存量产品首次 fm-design 撞 B4 停下、重跑 fm-refine-components 建指针）
Decided By: 用户（2026-06-09，r2p design 检查点）
Selected: B
Status: selected

## Rollback
- 全部改动经 git 版本控制，按 DES-ARCH 单元粒度可分支/分 PR 回退；无数据库 schema 迁移。
- 指针写入（DES-ARCH-005）为**加性**：`designSystemArtifactId` 此前从不写入，新增写入不破坏既有读路径；回退只需移除写入调用，读取面退回旧"恒 ARTIFACT_NOT_FOUND"现状。
- manifest `forma.productIcon`（DES-ARCH-004）为加性可选字段；旧 bundle 无该字段，读取面须容错（缺字段→无 ICON tile，不抛错，RISK-MIG-003），故回退不影响旧工件。
- MCP 工具移除（DES-ARCH-001/007）不可平滑回退给外部已装集成（RISK-MIG-001）——回退手段是 git revert 恢复工具，而非运行期降级。
- W/BC 批为纯前端，回退即还原 web 组件/路由/i18n；底层零改动保证不留半状态。

## Observability
- 主验证面是**确定性检查**：`pnpm typecheck` / `pnpm build` / `pnpm test`(Vitest) 全绿为闸门；新增守卫测试（无 create/delete_product、三平台去壳一致、指针单一事实源、component-baseline 规格齐全、缺组件库停下、current_version 非最高版本号仍渲染、缺 productIcon 容错）。
- 指针写入路径建议加可观察日志/provenance：`generateComponents` 设/复用指针时记录 productId+artifactId+version（便于排查 RISK-CONTRACT-001 的事实源一致性）。
- WCAG AA 对比（BC1/BC2）纳入验收核对，参照既有 contrast-aa 债务基线不回退。
- 破坏性 MCP 移除在 CHANGELOG/实施记录显式标注为不兼容点。

## SPEC Handoff
SPEC 阶段需把每个 DES-ARCH 细化为可验收的 SPEC 单元，重点：
- **接线点逐处枚举**（删除面）：DES-ARCH-001/007 的 const 名单/schema/映射/描述/handler/实现/测试逐行清单（需求文档各 R/B 小节已给行号，SPEC 复核现网行号）。
- **指针契约**（DES-ARCH-005）：首次建指针 / 后续追加同 artifact 版本 / 读取面统一解析 / 缺指针行为 的 core·API·MCP 测试矩阵；落实 DECISION-001 决议。
- **manifest schema**（DES-ARCH-004）：`forma.productIcon` 字段形状 + `validateFormaExtension` 分支 + 缺字段容错测试。
- **component-baseline 数据**（DES-ARCH-006）：web/mobile 两套规格的字段级清单（foundations 分类/ICON 规格/约28 组件 + 状态覆盖）与断言。
- **get_design_context 扩展**（DES-ARCH-006）：`componentBaseline`/`componentLibrary` 字段形状 + `componentLibrary` 交付形态（OPT-C 结构化引用）。
- **web/viewer**（DES-ARCH-009/010）：删除清单 + 画布增强的可核对验收项 + product-level mapper 测试 + DesignView 同文件协调顺序。
- **componentLibrary 交付形态定型**（评审 v3 #2 / RISK-CONTRACT-002）：SPEC 须明确"当前组件库 HTML"的具体读取面——复用既有 `get_product_artifact`/`export_artifact` 还是新增字段——并给出确定的截断/体量策略，不把 OPT-C 的"按需/可截断"留给 spec 再决策。
- **产品 ICON shape 可复用性定型**（评审 v3 #4）：SPEC 须钉死 `forma.productIcon.shape` 携带的是**可复用 geometry（SVG path/markup 本体）**还是仅标识符——"复用 geometry 只套色"只有在 path 数据可从 manifest/bundle 恢复时才成立。
- **baseline 工具行为翻转测试**（评审 v3 #5）：DES-ARCH-005 指针激活后 `get_baseline_page` / `get_baseline_image` 由"恒抛"变"返回数据"，属预期良性变化但当前无断言其抛错的测试；SPEC 须把这两个工具的成功路径纳入契约测试矩阵。
- **排期约束**：R1/R4/R5 → B1–B7 → R3 → R2；BC3 正式验收依赖 B2/B7；DesignView W2/BC2 串行。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| DES-ARCH-001 | SCOPE-IN-001, SCOPE-IN-004, SCOPE-IN-005 | covered |
| DES-ARCH-002 | SCOPE-IN-002, SCOPE-IN-003 | covered |
| DES-ARCH-003 | SCOPE-IN-006 | covered |
| DES-ARCH-004 | SCOPE-IN-007 | covered |
| DES-ARCH-005 | SCOPE-IN-007, SCOPE-IN-012 | covered |
| DES-ARCH-006 | SCOPE-IN-011, SCOPE-IN-012 | covered |
| DES-ARCH-007 | SCOPE-IN-008 | covered |
| DES-ARCH-008 | SCOPE-IN-009, SCOPE-IN-010, SCOPE-IN-011 | covered |
| DES-ARCH-009 | SCOPE-IN-013 | covered |
| DES-ARCH-010 | SCOPE-IN-014, SCOPE-IN-015, SCOPE-IN-016 | covered |
| DECISION-001 | RISK-MIG-002, SCOPE-IN-007, SCOPE-IN-012 | selected |

## Upstream Summary (read-only)
# Risk Discovery

## Risks

### RISK-SAFETY-001 移除 agent/MCP 产品删除误伤后台合法删除路径
Status: open（已有缓解方向）
R4 移除 `fm-list-product` 删除分支 + shared 删除指引 + MCP `delete_product`。`delete_product` handler 与后台 `DELETE /api/products` 共享同一 `store.deleteProduct`。若实施时连带改动 store/HTTP 路由/`ConfirmDeleteDialog`，会破坏唯一合法删除入口。**仅删 MCP 工具薄壳层，store/HTTP/web 删除一字不动。**

### RISK-MIG-001 删除 3 个 MCP 写工具破坏外部使用方已安装集成
Status: open
R4/B3/R5 移除 `delete_product`/`change_artifact_style`/`rollback_requirement_design`。使用方仓库中已安装的旧命令或外部 MCP 客户端仍可能调用 → 运行期"工具不存在"。属预期破坏性变更，需在实施记录中显式标注为不兼容点（无 deprecation 窗口）。

### RISK-MIG-002 "当前组件库指针"对既有数据无迁移路径
Status: open（需设计判定）
B2/B7 新增产品级"当前 component-library 指针"，并禁止用 `updated_at`/列表顺序/`superseded` 推断。但既有产品可能已有用旧方式生成的并列 component-library artifact、且无指针。读取面（`list_product_artifacts`/`get_product_artifact`/`get_design_context`）对"有 artifact 无指针"的回退行为未定义——可能导致旧产品的 `fm-design` 撞 B4"缺指针"停下。需明确：迁移补指针 vs 视作"无当前组件库"。

### RISK-MIG-003 旧组件库 bundle 缺 manifest `forma.productIcon`
Status: open
B2 要求 manifest 记录 productIcon primary/monochrome asset path + 稳定 shape 元数据；B7/BC3 的 web 与 `get_design_context` 直接读该字段。既有 bundle 无此字段，解析需容错（缺字段 → 无 ICON tile / 触发重生成），不得抛错。

### RISK-CONTRACT-001 "当前组件库"单一事实源在多读取面不一致
Status: open
B7 要求 `list_product_artifacts`/`get_product_artifact`/`get_design_context`/web BrandResources 全部以指针为唯一事实源。任一读取面遗留 `updated_at`/数组顺序/`superseded` 推断即违反契约，且 BC3 会渲染错误的组件库。需统一收口 + 契约测试覆盖全部读取面。

### RISK-CONTRACT-002 `get_design_context.componentLibrary` 内嵌 HTML 体量过大
Status: open
B7 要求 componentLibrary 含"可供模型参考的当前 HTML 内容或等价读取面"。组件库 HTML 可能很大，整段内嵌会撑爆设计上下文/拖慢 MCP。需界定交付形态（引用 + 按需读取 vs 全量内联）。

### RISK-DEP-001 实施顺序违背 R1/R4/R5→B1–B7→R3→R2 链
Status: open
R3 下沉的是被 B3/B1/B4 改动后的最终命令正文；R2 守卫最后锁最终 6 命令集。若乱序，R3 会下沉过期正文、R2 会锁错 canonical，且 B 批编辑期模板正文本就会临时漂移。顺序是硬依赖。

### RISK-DEP-002 BC3 先于 B2/B7 落地只能原型
Status: open
BC3 正式验收依赖当前组件库指针 + manifest ICON 契约（B2/B7）。未落地时只能原型渲染现有组件库，不得把"按更新时间猜最新组件库"当正式行为。

### RISK-DEP-003 `DesignView.tsx` 被 W2 与 BC2 同改
Status: open
批次3 W2 删 compare 链接与 `version_count>=2` 过滤；BC2 增强画布（增强落 `viewer/Canvas.tsx`，但 DesignView 是宿主）。同文件并行改动 → 合并冲突/相互覆盖。需串行或合并到同一改动批。

### RISK-REG-001 B 批编辑期三平台模板漂移、R2 守卫尚未就位
Status: open
B1/B2/B4/B6/B7 改 `fm-design`/`fm-refine-components` 模板正文，跨 claude/codex/gemini 手工三套。R2 守卫在链路最后才上线，期间漂移（如再现 gemini 缺 `Scope fidelity` 那类行为缺失）可逃逸 CI。

### RISK-REG-002 删版本 UI 误伤 `current_version` 内部活跃指针
Status: open
W1–W5 删版本/回退用户可见面，但 `current_version` 仍是 DesignView 选当前设计、RequirementDetail 判定可渲染的内部指针。删"给用户看版本"时若连带删内部判定，会在 `current_version` 非最高版本号时渲染错误设计。底层版本机制（SCOPE-OUT-003）须零改动。

### RISK-REG-003 删命令/工具/i18n 键留下悬挂引用
Status: open
R1/R4/R5 删命令与 MCP 工具、W4 删 6 个对比 i18n 键（en+zh 12 条），涉及 `copy-assets`/`design-commands`/`install`/`tools`/`store-design-mutations` 多处测试与 web 引用。漏改任一处 → `pnpm build`/`pnpm test` 失败。

### RISK-REG-004 R3 下沉/R5 删死码改动语义或误删仍被引用项
Status: open
R3 把 pure-static/self-review 下沉 shared 须保持命令语义不变；R5 删 `rollbackDesignPointerLocked` 须先 grep 确认无其它调用者、不触底层版本机制。误删/误改会引入隐性行为变化。

### RISK-CONTRAST-001 BC1 白底改造对比度不达 WCAG AA
Status: open
标注画布 `#2b2b2b`→白后，白点网/白磨砂框/浅色标签在白底不可见；验收要求满足 WCAG AA。记忆 `viewer-craft-contrast-debt` 记录 viewer 已有 2 处 contrast-aa 失败（React Flow badge 2.85:1、AnnotationSlot #888 3.54:1），BC1/BC2 改造须不新增、且适配后达标。

## Boundaries
- **底层设计版本机制**（不可变 `v{n}`、`current_version`、supersede、按版本服务 artifact）——只读不改（SCOPE-OUT-003）；批次3 diff 仅限 web 组件/路由/i18n。
- **后台产品创建/删除路径**（core `store.deleteProduct`/`createProduct`、HTTP `POST`/`DELETE /api/products`、web `ConfirmDeleteDialog`）——保留；R4 只删 agent/MCP 薄壳（SCOPE-OUT-002）。
- **4 个 MCP 读取工具** 与 `design-handoff.ts`/`vzi-read-layer.ts`——一字不改（SCOPE-OUT-001）。
- **"改页过期→需求不可归档"状态机**——R1–R5/B1–B7 均不触碰（Non-Goals）。
- **画布引擎边界**——annotation 留 CanvasKit/VZI、design+brand 留 React Flow/HTML，不合并不更换（SCOPE-OUT-007）；只对齐观感与交互。
- **样式权威边界**——brand_style 视觉权威 / Forma 固定基线结构权威 / system_style 仅软提示永不覆盖。

## Scope Overflow Risks
### RISK-SCOPE-001 产品 ICON 生成膨胀为完整 VI / 图标库
Status: open
B2 产品 ICON（由产品名+brand_style 派生 SVG mark，primary+monochrome）是新生成能力，易溢出为 wordmark/lockup/多版 logo/印刷物/通用功能图标库。上游已显式界定 out-of-scope（SCOPE-OUT-006），实施须严守：只做 mark + favicon 派生，复用 geometry/shape 只套色。

### RISK-SCOPE-002 固定基线组件集随需求自由增减、生成量失控
Status: open
B2 固定基线（web≈28 件 / mobile 变体 + 状态覆盖）量大；风险是模型按需求自由增减或漏项，失去"通用"意义。须由 `component-baseline.ts` 单一事实源约束，命令只交付该 platform 全集、不自由发挥；本轮不做按域名补充专有组件（SCOPE-OUT-008）。

### RISK-SCOPE-003 画布"对齐标注观感"主观验收无限扩张
Status: open
BC2/BC3 "pan/zoom 与标注观感一致""人工核对"是主观验收，易无限打磨。须把"对齐"约束为可核对的具体项（标题标签存在、选中框可见、滚轮缩放+拖拽平移行为一致），不追求像素级复刻。

## Mitigations
- **MIT-001（→RISK-SAFETY-001/MIG-001）**：R4/B3/R5 仅删 MCP 工具壳层（名单/schema/描述/handler/实现）+ agent 模板分支；实施前 `grep` 复核无其它调用者；store/HTTP/web 路径零改动。破坏性移除在实施记录显式标注无兼容窗口。
- **MIT-002（→RISK-MIG-002/MIG-003/CONTRACT-001）**：在 B7 设计当前组件库指针时一并定义"无指针/缺 manifest 字段"的显式回退（迁移补指针或视作无当前组件库 + 容错读取），并以 core/API/MCP 契约测试覆盖全部读取面（首次生成建指针、重复生成追加同 artifact 新版本、读取面返回同一当前组件库）。
- **MIT-003（→RISK-CONTRACT-002）**：componentLibrary 优先交付结构化引用（artifact_id/version/bundle/preview/manifest 字段）+ 按需读取面，避免无条件整段内联 HTML。
- **MIT-004（→RISK-DEP-001/002/003）**：严格按统一排期 R1/R4/R5→B1–B7→R3→R2 执行；BC3 在 B2/B7 后做正式验收；`DesignView.tsx` 的 W2 与 BC2 改动串行或合并到同一改动批。
- **MIT-005（→RISK-REG-001）**：R2 去壳逐字一致守卫覆盖最终 6 命令集，并手动验证"单平台漂移即失败"；B 批期间以该守卫作为模板一致性回归网。
- **MIT-006（→RISK-REG-002）**：W3 仅删"给用户看版本"的渲染，保留 `current_version` 内部活跃指针逻辑；测试覆盖 current_version 非最高版本号时仍正确渲染当前设计。
- **MIT-007（→RISK-REG-003/004）**：删除面以各 R/B/W 小节列出的接线点逐处清理 + 更新对应 vitest；R3 保持语义不变、R5 grep 确认死码；以 `pnpm typecheck`/`build`/`test` 全绿为闸门。
- **MIT-008（→RISK-CONTRAST-001）**：BC1/BC2 改造同步适配点网（深点 on 白）/磨砂框/标签色，验收纳入 WCAG AA 对比检查；不新增 contrast-aa 失败（参照 `viewer-craft-contrast-debt`）。
- **MIT-009（→RISK-SCOPE-001/002/003）**：以上游 Non-Goals/Out-of-Scope 为硬边界 + `component-baseline.ts` 单一事实源约束生成范围；画布"对齐"落为可核对清单项而非像素复刻。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| RISK-SAFETY-001 | SCOPE-IN-004, SCOPE-OUT-002 | covered |
| RISK-MIG-001 | SCOPE-IN-004, SCOPE-IN-005, SCOPE-IN-008 | covered |
| RISK-MIG-002 | SCOPE-IN-007, SCOPE-IN-012 | covered |
| RISK-MIG-003 | SCOPE-IN-007, SCOPE-IN-016 | covered |
| RISK-CONTRACT-001 | SCOPE-IN-012, SCOPE-IN-016 | covered |
| RISK-CONTRACT-002 | SCOPE-IN-012 | covered |
| RISK-DEP-001 | SCOPE-IN-002, SCOPE-IN-003 | covered |
| RISK-DEP-002 | SCOPE-IN-016, SCOPE-IN-007, SCOPE-IN-012 | covered |
| RISK-DEP-003 | SCOPE-IN-013, SCOPE-IN-015 | covered |
| RISK-REG-001 | SCOPE-IN-002, SCOPE-IN-006, SCOPE-IN-007 | covered |
| RISK-REG-002 | SCOPE-IN-013, SCOPE-OUT-003 | covered |
| RISK-REG-003 | SCOPE-IN-001, SCOPE-IN-004, SCOPE-IN-005, SCOPE-IN-013 | covered |
| RISK-REG-004 | SCOPE-IN-003, SCOPE-IN-005 | covered |
| RISK-CONTRAST-001 | SCOPE-IN-014, SCOPE-IN-015 | covered |
| RISK-SCOPE-001 | SCOPE-IN-007, SCOPE-OUT-006 | covered |
| RISK-SCOPE-002 | SCOPE-IN-007, SCOPE-OUT-008 | covered |
| RISK-SCOPE-003 | SCOPE-IN-015, SCOPE-IN-016 | covered |

## Upstream Summary (read-only)
# Requirement Brief

## Goal
对 Forma 做四批互相关联的重构，统一为单一实施基线：**(1)** 清理 fm-* agent 命令集（删冗余命令、三平台防漂移、样板下沉、把产品删除/设计回退收口出 agent/MCP），**(2)** 重构 fm-* 命令语义并引入数据驱动的产品设计系统（前置门槛三档、`fm-refine-components` 生成 Foundations+产品 ICON+固定基线组件集、`fm-change-style` 升为产品级样式切换、`fm-design` 缺组件库显式停下并按需复用基线），**(3)** 下线 web 后台的设计版本/回退用户可见面（底层版本机制保留），**(4)** 给 web 后台新增无限画布能力（标注画布白底、设计画布增强、产品品牌资源画布）。全程不改动既有"改页过期→需求不可归档"状态机与"产品只能在后台管理页创建/删除"生命周期不变量。最终 fm-* 命令集收敛为 6 个，MCP 工具净变化为 +1/−3。

## In-Scope
- SCOPE-IN-001 R1：删除 `fm-develop-design-handoff` agent 命令（3 平台模板 + 注册/安装 + 测试），保留 4 个 MCP 读取工具与 `design-handoff.ts`/`vzi-read-layer.ts` 不动。
- SCOPE-IN-002 R2：三平台模板防漂移——补齐 `gemini/fm-design.toml` 缺失的 `Scope fidelity (hard rule)` 段 + 新增"去壳正文逐字一致"vitest 守卫（方案 B）。
- SCOPE-IN-003 R3：把 pure-static 契约与 self-review 协议下沉到 `shared/SKILL.md` 锚点小节，仅 `fm-design`/`fm-refine-components` 引用；product_id 前置不下沉；补"存前确认不对称"说明。（排在 B 批之后）
- SCOPE-IN-004 R4：移除 agent/MCP 层产品删除——删 `fm-list-product` 删除分支 + `shared/SKILL.md` 删除指引 + MCP `delete_product`（4 处）；加守卫断言工具集既无 `create_product` 也无 `delete_product`。core 删除逻辑/HTTP `DELETE` 路由/web 删除对话框保留。
- SCOPE-IN-005 R5：删 `fm-rollback-design` 命令（3 平台 + 注册/安装/测试）+ MCP `rollback_requirement_design`（6 处）+ 死 core `rollbackDesignPointerLocked` 及其测试；底层版本机制保留。
- SCOPE-IN-006 B1：命令前置门槛三档明确化（产品存在 / +未归档需求 / +需求有内容），依赖 core 现有错误码（`REQUIREMENT_NOT_FOUND`/`REQUIREMENT_STATUS_INVALID`）给可执行提示，不在 agent 侧另造状态判断。
- SCOPE-IN-007 B2：`fm-refine-components` 定位档1（产品级、不读需求）+ 生成产品设计系统工件（artifact kind `component-library`）：Foundations 区（令牌可视化）+ 产品 ICON（primary+monochrome，由产品名+brand_style 派生，结构化落盘 manifest `forma.productIcon` + 稳定 shape 元数据）+ 固定基线组件集（web≈28 件 / mobile 变体、状态覆盖）；新增产品级"当前组件库"指针，重复 refine 追加同一 artifact 新版本。
- SCOPE-IN-008 B3：`fm-change-style` 重定义为产品级样式切换——`update_product_config` 落配置 + 委托 `fm-refine-components` 整体重生成设计系统（ICON 复用 geometry/shape 只套色），不触碰已有 design-page；移除旧单产物 `change_artifact_style`（MCP + core + 测试）。
- SCOPE-IN-009 B4：`fm-design` 生成前检查产品"当前组件库指针"，不存在则显式两段式停下提示先跑 `fm-refine-components`，流程内无静默生成。
- SCOPE-IN-010 B5：rule 1 精确表述——样式/组件改动不回溯已生成设计稿，只作后续 `fm-design` 输入（写入 shared 指南与相关模板）。
- SCOPE-IN-011 B6：`fm-design` 按需复用基线组件与产品 ICON（同 tokens/状态/同一 mark），不为复用而设计、不削弱 Scope fidelity 硬规则、沉浸式/定制页可省略通用件。
- SCOPE-IN-012 B7：数据驱动设计系统上下文——新增 core `component-baseline.ts`（按 platform 键入）+ MCP `get_component_baseline(product_id)`（refine 侧）+ 扩 `get_design_context` 返回 `componentBaseline`/`componentLibrary`（design 侧）+ 当前组件库指针的 core/API 契约；system_style 经结构化 `systemStyle` 字段交付。
- SCOPE-IN-013 W1–W5：web 删除版本/回退用户可见面——删 `VersionCompare.tsx` 页/路由/入口、`DesignView.tsx` 对比链接与 `version_count>=2` 过滤、用户可见版本号展示、6 个对比 i18n 键（en+zh 共 12 条）；`current_version` 内部活跃指针保留。
- SCOPE-IN-014 BC1：标注画布 `AnnotationPage.tsx` 底色 `#2b2b2b`→白，连带适配点网（深点 on 白）/focus 磨砂框/标题标签色，满足 WCAG AA，仅改样式不动 CanvasKit 渲染逻辑。
- SCOPE-IN-015 BC2：需求设计画布增强（落 `viewer/src/Canvas.tsx`）——逐 tile 标题标签 + 选中框 + pan/zoom 对齐标注，保持 React Flow + HTML `DesignTile` 不换引擎。
- SCOPE-IN-016 BC3：ProductDetail 加"品牌资源"入口 + 新路由 `/products/:productId/brand` + `BrandResources` 页，经当前组件库指针渲染 `component-library` HTML + 产品 ICON 图片 tile（复用 BC2 增强、走 manifest `forma.productIcon`），含空态提示。

## Out-of-Scope
- SCOPE-OUT-001 不删/不改 4 个 MCP 读取工具（`get_design_handoff`/`get_page_ui`/`get_ui_node`/`search_page_ui`）及 `design-handoff.ts`/`vzi-read-layer.ts` 与其测试——它们是产品本体能力。
- SCOPE-OUT-002 不改 core 产品删除逻辑、HTTP `POST`/`DELETE /api/products` 路由、web `ConfirmDeleteDialog`——产品创建/删除保留在后台管理页。
- SCOPE-OUT-003 不改底层设计版本机制（不可变 `v{n}`、`current_version` 指针、supersede、按版本服务 artifact）。
- SCOPE-OUT-004 批次3 仅改 web 前端组件/路由/i18n；`api.ts`、server 版本路由、core 一律不动；`api.ts` 的 `rollback`/`/rollback/plan` 客户端残留保留不动，不视作可用回退路径。
- SCOPE-OUT-005 不做样式/组件变更后批量重生成已有设计页（rule 1）。
- SCOPE-OUT-006 不新增样式存储/产品级样式 token 覆写；不生成通用功能图标库/图标字体/wordmark/完整品牌 VI（产品 ICON mark 在范围内）。
- SCOPE-OUT-007 不统一/更换画布引擎（annotation 留 CanvasKit/VZI，design+brand 留 React Flow/HTML），只对齐观感与交互。
- SCOPE-OUT-008 不引入命令单源生成器（R2 方案 A）；不做按产品域名补充专有组件（域内补充另列后续）；B8 规格化已取消（改为 R5 整体删除）。
- SCOPE-OUT-009 `hardening-requirements.md`（加固批）不在本合集范围。

## Non-Goals
- 不引入新的命令分档、代码生成框架或其它重抽象，除非问题确实需要。
- 不为 `fm-develop-design-handoff` 重新设计消费侧 agent 工作流——设计交付物的消费/落地不在 Forma 命令范围。
- 不触碰"`fm-requirement` 改页 → 页 `expired` → 需求退回 `submitted` → 不可归档（重跑 `fm-design` 解除）"状态机；R1–R5、B1–B7 均保持其不变。

## Assumptions
- 产品生命周期不变量：产品只能在后台管理页创建/删除；agent/MCP 不暴露 `create_product`/`delete_product`（见记忆 `forma-product-lifecycle-rule`）。
- "最新需求"= `getLatestRequirement` 返回最近的非归档需求；全归档或无需求则抛 `REQUIREMENT_NOT_FOUND`。
- 三方权威边界：`brand_style` 视觉 tokens 与组件长相权威；Forma 固定基线 → 组件清单与基础结构权威；`system_style` 仅 name+description 元数据、为软提示，永不覆盖前两者。
- 可复用既有零件：`update_product_config`、`generate_components`、core 状态机与错误码、`DesignView` 的"`listProductArtifacts` → viewer `Canvas`"渲染链。
- 代码尚未改动；全部变更可被现有 Vitest 覆盖。
- BC3 正式验收依赖 B2/B7 落地（当前组件库指针 + manifest `forma.productIcon` 契约）；未落地时只可原型渲染。
- `DesignView.tsx` 同时被 W2（删 compare 链接）与 BC2（增强画布）触及，需同文件协调但不冲突。

## Acceptance Criteria
- AC-001 最终 fm-* 命令集为 6 个：`fm-list-product`、`fm-status`、`fm-requirement`、`fm-design`、`fm-refine-components`、`fm-change-style`；`formaAgentCommands` 与 `install.ts` 安装列表一致。
- AC-002 MCP 工具净变化：新增 `get_component_baseline`；移除 `change_artifact_style`、`rollback_requirement_design`、`delete_product`；守卫测试断言工具集既无 `create_product` 也无 `delete_product`。
- AC-003 R2 守卫存在并通过：三平台去壳正文对全部命令逐字一致；故意单平台漂移会令其失败。
- AC-004 core 新增 `component-baseline.ts`（web/mobile 两套规格、单测断言齐全）+ 产品级当前组件库指针；`get_design_context` 返回 `componentBaseline`/`componentLibrary`，后者含可解析的 `forma.productIcon` primary/monochrome asset path 与稳定 shape 元数据。
- AC-005 web 无版本对比页/路由/入口、无用户可见版本号、无悬挂 i18n 引用；`current_version` 内部活跃指针逻辑不受影响；`api.ts`/server 路由/core 版本机制零改动（diff 仅在 web 组件/路由/i18n）。
- AC-006 三块画布观感对齐：标注与设计画布均白底 + 逐 tile 标题标签 + 选中框 + pan/zoom 一致，对比指示满足 WCAG AA；品牌资源画布经当前组件库指针渲染 HTML + 产品 ICON 图片 tile，含空态。
- AC-007 既有状态机与生命周期不变量保持：改页过期→不可归档逻辑、产品后台创建/删除路径、底层版本机制均未被改动。
- AC-008 `pnpm typecheck`、`pnpm build`、`pnpm test` 全绿；新增工具/字段附 MCP schema 与测试，各 R/B/W/BC 项的逐条验收标准（见 Upstream Summary）满足。

## Open Questions
- 无阻塞性开放问题：四批方向均已在各自"决策记录"确认。以下为已明确推迟、非本轮验收对象的后续项，仅作可见性记录——(a) 按产品域名补充专有组件；(b) R2 方案 A（claude 单源 + build 期生成 codex/gemini）；(c) `hardening-requirements.md` 加固批。
- 协调点（非开放问题）：`DesignView.tsx` 被 W2 与 BC2 同改，需在实施排期中串行或合并改动以避免冲突。

## Sources
- `docs/forma-requirements-consolidated.md`（唯一权威需求文档，已逐字捕获为本运行的 `00-raw-requirement.md`，全文见下方 Upstream Summary）。
- `docs/hardening-requirements.md`（独立加固批，明确 out-of-scope）。
- 代码基线：`packages/agent`（命令模板/注册/安装）、`packages/core`（store/product/requirement/design-context/component-baseline）、`packages/mcp`（tools）、`packages/server`（routes）、`packages/web`（DesignView/AnnotationPage/VersionCompare/ProductDetail/routes/i18n）、`packages/viewer`（Canvas/tiles）。
- 记忆：`forma-product-lifecycle-rule`（产品只能后台创建/删除）。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| SCOPE-IN-001 | 批次1 R1 | covered |
| SCOPE-IN-002 | 批次1 R2 | covered |
| SCOPE-IN-003 | 批次1 R3 | covered |
| SCOPE-IN-004 | 批次1 R4 | covered |
| SCOPE-IN-005 | 批次1 R5 | covered |
| SCOPE-IN-006 | 批次2 B1 | covered |
| SCOPE-IN-007 | 批次2 B2 | covered |
| SCOPE-IN-008 | 批次2 B3 | covered |
| SCOPE-IN-009 | 批次2 B4 | covered |
| SCOPE-IN-010 | 批次2 B5 | covered |
| SCOPE-IN-011 | 批次2 B6 | covered |
| SCOPE-IN-012 | 批次2 B7 | covered |
| SCOPE-IN-013 | 批次3 W1–W5 | covered |
| SCOPE-IN-014 | 批次4 BC1 | covered |
| SCOPE-IN-015 | 批次4 BC2 | covered |
| SCOPE-IN-016 | 批次4 BC3 | covered |
| SCOPE-OUT-001 | 批次1 非范围（MCP 读取工具） | covered |
| SCOPE-OUT-002 | 批次1 R4 / 产品生命周期规则 | covered |
| SCOPE-OUT-003 | 批次3 边界（底层版本机制） | covered |
| SCOPE-OUT-004 | 批次3 W5 / 非范围 | covered |
| SCOPE-OUT-005 | 批次2 B5 / 非范围 | covered |
| SCOPE-OUT-006 | 批次2 B2 item6 / 非范围 | covered |
| SCOPE-OUT-007 | 批次4 非范围（画布引擎） | covered |
| SCOPE-OUT-008 | 批次1 R2 方案 A / B2 决策记录 B8 | covered |
| SCOPE-OUT-009 | 顶部说明（hardening 独立批） | covered |

## Upstream Summary (read-only)
# Forma 命令重构 + 后台画布 合并需求文档

- 日期：2026-06-09
- 说明：本文件合并**批次1–4**（原四份分批需求文档已合并入此并删除，内容原样收录于下方四节、标题降一级）。供统一拆解为实施任务；每条 R/B/W/BC 项的"现状 / 需求 / 验收标准"均在各自批次内。
- 唯一需求文档：本文件（`forma-requirements-consolidated.md`）。另有独立的 `hardening-requirements.md`（加固批，不在本合集范围）。
- 状态：方向已定，待拆解 / 实施。**代码尚未改动。**

## 总览索引

**批次1 — fm-* 命令集清理（agent/MCP/core）**
- R1：删 `fm-develop-design-handoff` 命令（保留 MCP 读取工具）
- R2：三平台模板防漂移（补 gemini 缺段 + 去壳正文一致守卫）
- R3：pure-static / self-review 样板下沉 shared（2 生成命令；product_id 不下沉）
- R4：移除 agent/MCP 产品删除（命令分支 + shared 指引 + MCP `delete_product`）+ 创建/删除守卫
- R5：删 `fm-rollback-design` 命令 + MCP `rollback_requirement_design` + 死 core `rollbackDesignPointerLocked`

**批次2 — fm-* 命令行为重构（agent/MCP/core）**
- B1：前置门槛三档明确化（+ B1 末"改页过期→不可归档"既有不变量）
- B2：`fm-refine-components` = 设计系统（Foundations + 产品 ICON + 固定基线组件集）
- B3：`fm-change-style` = 产品级样式切换（委托 refine）+ 移除 `change_artifact_style`
- B4：`fm-design` 缺组件库两段式停下（显式）
- B5：rule 1 — 样式/组件改动不回溯
- B6：`fm-design` 按需复用基线组件与产品 ICON
- B7：数据驱动设计系统上下文（core `component-baseline.ts` + `get_component_baseline` + 扩 `get_design_context`）

**批次3 — web 删版本/回退 UI（底层不改）**
- W1–W5：删 VersionCompare 页/路由/入口 + 版本号展示 + i18n；api/server/core 版本机制保留

**批次4 — web 无限画布功能**
- BC1：标注画布改白底（+ 点网/选中框/标签适配）
- BC2：设计画布增强（逐 tile 标题标签 + 选中框 + pan/zoom 对齐标注；增强 React Flow，不换引擎）
- BC3：产品页品牌资源入口 → 新画布页渲染 component-library HTML + 产品 ICON 图片 tile（复用 BC2；依赖 B2）

## 统一排期与依赖

- **fm-* 链路（批次1+2）**：R1/R4/R5 → B1–B7 → R3 → R2。R3 在 B 批之后（下沉的是被 B3/B1/B4 改动后的正文）；R2 守卫最后锁最终 6 命令集。
- **最终命令集（6）**：`fm-list-product`、`fm-status`、`fm-requirement`、`fm-design`、`fm-refine-components`、`fm-change-style`。
- **MCP 工具净变化**：+1（`get_component_baseline` / B7）；−1（`change_artifact_style` / B3）；−1（`rollback_requirement_design` / R5）；−1（`delete_product` / R4）。
- **web 链路（批次3+4）**：与 fm-* 解耦、可并行。`DesignView.tsx` 被批次3（删 compare 链接）与 BC2（增强画布）同改 → 同文件协调。
- **跨批依赖**：BC3 依赖 B2/B7（component-library 当前指针 + 设计系统工件 + 产品 ICON manifest 契约）。B2/B7 未落地时，BC3 最多可原型化渲染现有组件库；不能把“按更新时间猜最新组件库”作为正式行为。
- **既有不变量（不改）**：fm-requirement 改页 → 页 `expired` → 需求 `submitted` → 不可归档（重跑 fm-design 解除）；R/B 各项均不触碰该状态机。

---

## 批次1：Forma fm-* agent 命令集清理与加固 需求文档

- 日期：2026-06-08
- 来源：对 `packages/agent/templates/` 下 8 个 `fm-*` agent 命令的整体审查（本轮对话）→ 逐条源码核实 → 结合产品边界裁剪
- 状态：方向已定，待实施。R1 删 fm-develop-design-handoff；R2 方案 B；R3 下沉 pure-static + self-review；R4 移除 agent/MCP 产品删除；R5 删 fm-rollback-design（2026-06-09 追加）
- 原则：默认只动 agent 命令模板层与其安装/注册/测试；**R4/R5 是已确认的 MCP/core 例外**（R4 移除产品删除写工具但保留后台删除路径，R5 移除设计回退写工具与对应死 core）。不引入新的命令分档、代码生成框架等重抽象，除非问题确实需要。

### 背景与产品边界前提

Forma 的产品边界（产品方本轮明确）：

> Forma 主要**管理需求**，为需求提供**需求信息与 UI 信息**，消费方主要**通过 MCP 直接获取**，或将来通过**后台管理导出数据**。

由此推出本文档的两条定性：

- **设计交付物的"消费/落地"（照着 handoff 写前端）不在 Forma 的命令范围内**。谁要拿数据，直接调 MCP 读取工具，或等后台导出。
- **`get_design_handoff` / `get_page_ui` / `get_ui_node` / `search_page_ui` 这套 MCP 读取工具 = 产品本身**（"通过 MCP 提供需求/UI 信息"），必须保留。它们与上面要删的那个 agent 命令不是一回事：**能力在 MCP 工具里，命令只是多出来的壳。**

**产品生命周期规则（产品方本轮明确，作为不变量）**：

1. 产品**只能在后台管理页面创建**。
2. 产品**只能在后台管理页面删除**。

后台管理页面经 HTTP server（`POST` / `DELETE /api/products`，`packages/server/src/routes.ts`）落到 core。因此 agent/MCP 层**不得**提供产品的创建或删除：创建侧 MCP 本就无 `create_product` 工具（已满足）；删除侧 MCP 仍暴露 `delete_product`、`fm-list-product` 仍有删除分支（**违反**，见 R4 处理）。

8 个命令现状定位：`fm-list-product`（唯一入口/产品选择，含删除分支）、`fm-status`（只读状态）、`fm-requirement`（建/改需求）、`fm-design` / `fm-refine-components` / `fm-change-style`（三类"生成 HTML → 存版本 → 强制自检"）、`fm-rollback-design`（版本回退，本文档 R5 要删）、`fm-develop-design-handoff`（消费侧落地，本文档 R1 要删）。

### 范围

- R1：删除 `fm-develop-design-handoff` agent 命令（保留全部 MCP 工具）。**已确认。**
- R2：三平台模板防漂移，取**方案 B**（守卫 + 手补 gemini 缺段）。**已定。**
- R3：命令模板重复样板下沉到 shared（pure-static + self-review；product_id 不下沉）。**已定。**
- R4：产品删除收口到后台管理页面——移除 agent/MCP 层删除能力（`fm-list-product` 删除分支 + shared 删除指引 + MCP `delete_product` 工具）；创建侧确认已满足并加守卫。**已定（依据本轮产品规则，取代旧"强化 description"方案）。**
- R5：删除 `fm-rollback-design` agent 命令 + MCP `rollback_requirement_design` 工具 + 死掉的 core `rollbackDesignPointerLocked`（不提供设计回退；web 版本/回退 UI 见批次3；底层版本机制保留）。**已定（2026-06-09 追加）。**

预计涉及：agent 模板 3 个文件 + 注册/安装 2 处 + 相关测试若干（R1）；新增 1 个守卫测试或 1 个生成脚本（R2）；shared 指南 1 处 + 命令模板若干（R3）；MCP/core/tests 的删除面以 R4/R5 各自小节为准。全部可被现有 Vitest 覆盖。

### 非范围（明确不做）

| 项 | 不做的理由 |
|---|---|
| 删除/改动 `get_design_handoff` 等 4 个 MCP 工具、`design-handoff.ts`、`vzi-read-layer.ts` | 它们是"通过 MCP 提供 UI 信息"的产品能力，保留不动。 |
| 新增"内部/dev-only 命令"分档 | 为一个无消费者的命令引入新抽象；"内部使用"已由直接调 MCP 工具覆盖。 |
| 给 `fm-develop-design-handoff` 重新设计消费侧 agent 工作流 | 消费侧不在 Forma 命令范围内。 |
| 改 MCP **读取**工具行为、core 持久化、产品/需求数据模型 | 本轮默认只清理命令模板层；明确例外仅限 R4 移除 MCP `delete_product` **写**工具、R5 移除 MCP `rollback_requirement_design` **写**工具与其唯一调用的死 core。core 删除逻辑、HTTP 删除路由、底层版本机制均保留。 |

---

### R1 删除 `fm-develop-design-handoff` agent 命令（保留 MCP 工具）

**背景**：该命令 2026-06-02 随提交 `c7aec36 feat(agent,mcp): dev design-handoff templates + help workflow` 加入，作用是"读归档需求的设计 handoff，照着 page UI 树在使用方仓库里实现前端"。但：

- 它的运行上下文是**使用方的产品代码仓**（连着 Forma MCP），在 Forma 仓内永远不可用；其余 7 个命令都在创作侧（管理需求 / 产出设计）。
- 按产品边界，**消费/落地不在 Forma 命令范围**；要读 handoff 直接调 MCP 工具即可，命令对"内部使用"零增量。
- 它是 8 个命令里最薄、最投机的一个（仅"按序调 4 个只读工具 + 守归档闸门"），且使用场景与创作命令混在一起会产生歧义。

**现状**（命令的完整接线点，删除时全部处理）：

- 模板（3 平台）：
  - `packages/agent/templates/claude/fm-develop-design-handoff.md`
  - `packages/agent/templates/codex/fm-develop-design-handoff/SKILL.md`
  - `packages/agent/templates/gemini/fm-develop-design-handoff.toml`
- 注册/安装列表：
  - `packages/agent/src/index.ts:15`（`formaAgentCommands` 数组，8 → 7）
  - `packages/core/src/install.ts:19`（**真正的安装器命令列表**，决定是否复制到 `~/.claude/commands/` 等）
- 测试断言：
  - `packages/cli/tests/copy-assets.test.ts:22`（命令列表）+ `:46`（命令→描述映射）
  - `packages/cli/tests/design-commands.test.ts:183`（整个 `describe("fm-develop-design-handoff template")` 块，约 183–235 行）
  - `packages/core/tests/install.test.ts:15`（命令列表）

**保留不动**（一行不改）：

- MCP 工具 `get_design_handoff` / `get_page_ui` / `get_ui_node` / `search_page_ui`（注册于 `packages/mcp/src/tools.ts`）
- `packages/mcp/src/design-handoff.ts`、`packages/mcp/src/vzi-read-layer.ts`
- `packages/mcp/tests/tools.test.ts` 中对这些工具的测试

**需求**：

1. 删除上述 3 个平台模板文件。
2. 从 `formaAgentCommands`（agent/src/index.ts）和 `install.ts` 的安装列表中移除该命令（两处保持一致）。
3. 同步更新 `copy-assets.test.ts`（命令列表 + 描述映射）、`install.test.ts`（命令列表），删除 `design-commands.test.ts` 中该命令的整个 `describe` 块。
4. 不改动任何 MCP 工具、`design-handoff.ts`、`vzi-read-layer.ts` 及其测试。
5. MCP `help` 工具不枚举这些命令名、docs 已移出版本控制，无连带文案需改（已核实）。

**验收标准**：

- [ ] `pnpm typecheck` 与 `pnpm build` 通过（agent 包不再引用该命令）。
- [ ] `npx vitest run packages/cli/tests/copy-assets.test.ts packages/cli/tests/design-commands.test.ts packages/core/tests/install.test.ts` 全绿。
- [ ] 重新安装后 `~/.claude/commands/` 不再出现 `fm-develop-design-handoff.md`（其余 7 个命令仍在）。
- [ ] MCP 端 `get_design_handoff` / `get_page_ui` / `get_ui_node` / `search_page_ui` 仍可调用，`packages/mcp/tests/tools.test.ts` 不变且通过。
- [ ] `formaAgentCommands` 与 `install.ts` 安装列表均为 7 项且一致（R1 单独效果；R5 再删 `fm-rollback-design` 后为 6）。

---

### R2 三平台模板防漂移（含修复已发现的实锤漂移）

**背景 / 现状**：claude / codex / gemini 三平台模板是**手工分别维护**的（`packages/agent/src/index.ts:28 formaAgentPlatformMetadata` 定义三套格式：markdown-frontmatter / codex-skill / toml-prompt），没有单源生成。本轮做了归一化全量 diff：codex 与 claude 完全一致，gemini 仅一处漂移——

- **实锤**：`gemini/fm-design.toml` 第 5 步缺了 claude/codex 都有的 **`Scope fidelity (hard rule)`** 整段（`claude/fm-design.md:20`、`codex/fm-design/SKILL.md:23` 有；`gemini/fm-design.toml:18` 无）。该段是"禁止模型擅自增页/加功能、按 page spec 字面实现"的硬约束——Gemini 用户因此少了一条防护。这是行为缺失，不是风格不齐。

现有测试只锁了**命令列表**（`copy-assets.test.ts`）和**部分正文 contains**（`design-commands.test.ts` 断言各平台含某些关键串），**不保证三平台正文逐字一致**，所以这类漂移能逃过 CI。

**需求**（已定：取方案 B）：

1. 先补齐 `gemini/fm-design.toml` 缺失的 `Scope fidelity (hard rule)` 段，使三平台一致。
2. 新增一个 vitest 守卫：对每个命令，去除平台外壳（frontmatter / toml 包裹 / `$` 命令前缀）后断言三平台正文**逐字一致**，任一平台漂移即测试失败。

> 方案 A（claude 为 canonical 单源、build 时生成 codex/gemini）本轮**不做**——为命令集引入构建期生成器偏重；待手工维护成本确实变高时再考虑。

**验收标准**：

- [ ] `gemini/fm-design.toml` 含 `Scope fidelity (hard rule)` 段，与 claude/codex 一致。
- [ ] 存在守卫测试：对全部命令（R1+R5 删除后为 6 个）逐一校验三平台去壳正文一致并通过。
- [ ] 故意只改一个平台的某命令正文 → 守卫测试失败（手动验证一次）。

---

### R3 命令模板重复样板下沉到 shared 指南

**背景 / 现状**：`packages/agent/templates/shared/SKILL.md`（安装到 `~/.forma/skills/forma/SKILL.md`）已抽取部分公共规则，但命令文件仍各自重复整段：

- **product_id 前置**逐字重复 7 处（除 `fm-list-product` 外每个命令 step 1）。
- **pure-static 契约** 与 **self-review 协议** 在生成类命令里逐字重复。

> 注：R3 在 B 批**之后**执行（见排期）。B3 把 `fm-change-style` 改成"设样式 + 委托 refine"的薄命令、不再直接生成，因此 B 批后**直接生成命令只剩 `fm-design` 与 `fm-refine-components` 两个**带 pure-static/self-review；下沉时按这两个命令的**最终** step 重新定位（不要沿用本节早前的 step 5/6/7/8 旧编号）。

这正是 R2 漂移的温床——同一段话散落多处，改一处忘三处。

**需求**：

1. 把 pure-static 契约、self-review 协议各收敛为 shared 指南里一个带锚点的小节，**两类生成命令（`fm-design`、`fm-refine-components`）**改为引用而非各自抄写（`fm-change-style` 经 B3 已是薄委托，不再带这些块）。
2. product_id 前置**维持现状、本轮不下沉**——它已足够短，留在各命令 step 1 反而更自包含；不为它新增 shared 引用。
3. 在 shared 指南补一句说明：**为何生成类命令"先存后自检、不做存前确认"，而 `fm-requirement` 做存前确认**（HTML 体量大 + 版本不可变 + 自检环兜底），消除"看着不一致"的疑问。

**验收标准**：

- [ ] 两类生成命令（`fm-design`、`fm-refine-components`）模板不再各自重复 pure-static / self-review 整段，改为引用 shared 小节。
- [ ] shared 指南含上述权威小节与"存前确认不对称"的说明。
- [ ] 命令语义行为不变；R2 守卫测试仍通过。

---

### R4 产品创建/删除收口到后台管理页面（移除 agent/MCP 层删除能力）

**背景**：产品方本轮明确——产品**只能在后台管理页面创建/删除**（见"产品生命周期规则"）。本项把 agent/MCP 层与该规则对齐。注：这取代了本文档早前的"强化 `fm-list-product` description"方案——既然删除根本不该由 agent 触发，就不是"更显眼"而是"移除"。

**现状**：

- 创建侧（规则 1，**已满足**）：MCP **无** `create_product` 工具；创建仅经 HTTP `POST /api/products`（`packages/server/src/routes.ts:95,237`）→ `store.products.createProduct`（`packages/core/src/product.ts:160`），即后台管理页路径。agent 无法创建产品。
- 删除侧（规则 2，**被违反**）：
  - MCP 暴露 `delete_product` 工具（`packages/mcp/src/tools.ts:40` 名单、`:324` schema、`:356` 描述、`:419` handler → `store.deleteProduct`）。
  - `fm-list-product` 三平台模板含"删除分支"，`packages/agent/templates/shared/SKILL.md:16-17` 含产品删除指引。
  - 即 agent 存在删除产品的第二条路径，与规则冲突。
  - 后台删除路径独立存在并**保留**：HTTP `DELETE /api/products/...`（`routes.ts:87,250`）→ `store.deleteProduct`（`packages/core/src/store.ts:138`），web 有 `ConfirmDeleteDialog.tsx`。

**需求**：

1. 删除 `fm-list-product` 三平台模板（claude/codex/gemini）的"删除分支"，只保留"列出/选择产品"。
2. 删除 `shared/SKILL.md` 中**产品删除**相关指引（`:16` 删除确认流程、`:17` recovery_warnings 提示）。第 18 行"不暴露需求删除工具"是关于**需求**的独立约束，**保留**。
3. 从 MCP 移除 `delete_product` 工具：const 名单、schema 映射、描述、handler 四处，并调整/删除 `packages/mcp/tests/tools.test.ts` 中对它的断言。**`store.deleteProduct`、core 删除逻辑、HTTP `DELETE` 路由全部保留**——后台管理页仍走这条。
4. 新增守卫测试：断言 MCP 工具集**既不含 `create_product` 也不含 `delete_product`**，把两条产品规则固化进 CI。

**验收标准**：

- [ ] `fm-list-product` 三平台模板不再含删除分支；`shared/SKILL.md` 不再含产品删除指引（需求删除约束保留）。
- [ ] MCP 工具集不含 `delete_product`（也不含 `create_product`）；守卫测试存在并通过。
- [ ] `packages/mcp/tests/tools.test.ts` 更新后通过；core `deleteProduct`、HTTP `DELETE /api/products` 路由、web 删除对话框行为不变。
- [ ] `pnpm typecheck` / `pnpm build` 通过。

---

### R5 删除 `fm-rollback-design` 命令（含 MCP 工具与死掉的 core）

**背景**：产品方决定**不再提供设计稿回退**。agent/MCP 侧彻底移除（本项）；web 侧的版本/回退展示见**批次3**（本文件下方）；**底层版本机制保留**（不可变 `v{n}`、`current_version`、supersede 不动）。fm-rollback-design 与 R1 同性质——删一个无保留价值的 agent 路径。

**现状（接线点）**：

- 模板（3 平台）：`packages/agent/templates/{claude/fm-rollback-design.md, codex/fm-rollback-design/SKILL.md, gemini/fm-rollback-design.toml}`
- 注册/安装：`packages/agent/src/index.ts:11`、`packages/core/src/install.ts:15`
- 测试：`packages/cli/tests/copy-assets.test.ts:18`（列表）+ `:41`（描述）+ `:196`（模板读取）、`packages/cli/tests/design-commands.test.ts:155`（`describe` 块）、`packages/core/tests/install.test.ts:11`
- MCP 工具 `rollback_requirement_design`：`packages/mcp/src/tools.ts:56`（名单）、`:224`（schema）、`:340`（映射）、`:373`（描述）、`:445-446`（handler）、`:991-1017`（实现 `rollbackRequirementDesign`）
- core：`packages/core/src/product.ts:302 rollbackDesignPointerLocked`——删 MCP 工具后唯一调用者（`tools.ts:1017`）消失，变**死代码** → 一并删 + 其测试
- **保留**：底层版本机制。`packages/web/src/api.ts` 中仍有设计会话 `/rollback/plan` URL 构造，但当前 server 无对应路由（removed design session routes 返回 404），它不是可用回退路径，也不作为 R5 验收对象。

**需求**：

1. 删 3 平台模板；从 `formaAgentCommands` 与 `install.ts` 列表移除（两处一致）。
2. 删 MCP 工具 `rollback_requirement_design`（名单/schema/映射/描述/handler/实现 六处）。
3. 删 core `rollbackDesignPointerLocked` + 其测试；实施前 grep 复核无其它调用者。
4. 同步 `copy-assets`/`design-commands`/`install` 测试与 `mcp/tests/tools.test.ts`。
5. 不碰底层版本机制；不把 `api.ts` 的 `/rollback/plan` 客户端残留当作可用回退路径或验收对象。

**验收标准**：

- [ ] `formaAgentCommands` 与 `install.ts` 列表不含 `fm-rollback-design`；**R1+R5 后命令为 6**（list/status/requirement/design/refine-components/change-style）。
- [ ] MCP 工具集不含 `rollback_requirement_design`；core 无 `rollbackDesignPointerLocked`。
- [ ] `pnpm typecheck` / `pnpm build` 通过；相关 vitest 通过。
- [ ] 底层版本机制零改动；文档和测试不要求存在 server `/rollback/plan` 回退路由。

---

### 决策记录（2026-06-08）

- R1：删除 `fm-develop-design-handoff`，保留 MCP 工具。立项。
- R2：取方案 B（补 gemini 缺段 + 三平台去壳正文一致守卫）；方案 A 本轮不做。
- R3：下沉 pure-static 契约与 self-review 协议到 shared，补"存前确认不对称"说明；product_id 前置不下沉。
- R4：依据产品规则（创建/删除只在后台管理页），移除 agent/MCP 层产品删除能力（命令删除分支 + shared 删除指引 + MCP `delete_product` 工具），创建侧加守卫。取代旧"强化 description"方案。
- R5（2026-06-09）：删除 `fm-rollback-design` 命令 + MCP `rollback_requirement_design` 工具 + 死掉的 core `rollbackDesignPointerLocked`；web 版本/回退 UI 见批次3；底层版本机制保留。命令数连 R1 共 8→6。

### 实施备注（已确认）

- R4 的 MCP 删除范围（连同 `delete_product` 工具一并移除，而非只删命令分支）**已于 2026-06-08 确认**。
- 实施顺序（统一排期见本文件顶部"统一排期与依赖"）：**R1/R4/R5 → B1–B7 → R3 → R2**。R3 必须在 B 批**之后**——它下沉的正是被 B3/B1/B4 改动后的命令正文；R2 守卫最后锁住改完的最终 **6** 命令集。批次3（web 版本 UI 下线）与 fm-* 解耦、可并行。


---

## Forma fm-* agent 命令行为重构 需求文档（批次2）

- 日期：2026-06-08
- 来源：对 fm-* 命令「前置门槛 + 级联规则」的讨论（本轮）→ 逐条源码核实 → 产品方拍板
- 状态：方向已定（2026-06-08 讨论确认），待实施
- 与批次1的关系：批次1（R1–R5）是命令集**清理**（删命令、防漂移、下沉样板、移除产品删除、删回退）；本批（批次2）是命令**语义/行为重构**，会动到 core + MCP。
- 原则：尽量复用已有零件（`update_product_config`、`generate_components`、core 状态机）；不做"样式变更后批量重生成已有设计页"。**例外（B7）**：为"数据驱动的设计系统上下文"新增一个 Forma 内置的基线规格数据模块 + 扩展读取工具，属有意的 core 改动。

### 背景与模型前提

经源码核实，Forma 的职责切分（见记忆 `forma-product-lifecycle-rule` 与批次1背景）：

- **生命周期归后台管理页**：建产品（HTTP `POST /api/products`）、建需求（HTTP `POST /api/products/:id/requirements` → `createEmptyRequirement`，`packages/server/src/routes.ts:277,281`）、删产品。**MCP 无产品/需求的创建工具。**
- **agent/MCP 只做内容**：选产品、填需求、出设计、组件、换肤；回退路径按批次1 R5 删除。
- **"最新需求"语义**：`getLatestRequirement`（`packages/core/src/requirement.ts:511`）只返回最近的**非归档**需求，全归档或无需求则抛 `REQUIREMENT_NOT_FOUND`。即系统里"最新需求"天然非归档；归档的进历史。

由此，命令的前置门槛、级联与设计系统上下文按下面 B1–B7 明确。

### 范围

- B1：命令前置门槛三档明确化（含 NOT_FOUND/STATUS_INVALID 提示）。
- B2：`fm-refine-components` 产品级（档1）+ 生成产品设计系统（品牌资源 Foundations + 产品 ICON + 固定基线组件集）。
- B3：`fm-change-style` 重定义为**产品级样式切换 +（委托 refine）重生成设计系统**，并**移除**旧的单产物 `change_artifact_style`（MCP 工具 + core 函数）。
- B4：`fm-design` 缺组件库时**两段式停下**（显式提示，不静默自动生成）。
- B5：rule 1 精确表述——样式/组件改动**不回溯**已生成设计稿。
- B6：`fm-design` 按需复用基线组件与产品 ICON（不为复用而设计；沉浸式/定制页可省略通用件）。
- B7：**数据驱动的设计系统上下文**——新增 core 基线规格数据 + `get_component_baseline`（refine）+ 扩展 `get_design_context`（design）。

### 非范围（明确不做）

| 项 | 不做的理由 |
|---|---|
| 样式/组件变更后批量重生成已有设计页 | rule 1：已生成设计稿不可变、不回溯；新样式经后续 fm-design 才生效。 |
| 新增**样式**存储/产品级样式覆写 | 产品只引用 `brand_style`/`system_style` 名称、不覆写 token（`update_product_config`）。注：B7 的"基线规格数据"是 Forma 内置静态规格（非按产品/样式存储），不在此列。 |
| 保留单产物换肤 `change_artifact_style` | 产品级切换 + fm-design Described 模式（单页重生成）已覆盖；留两套语义打架。 |
| 改后台页/HTTP 的创建删除路径 | 属批次1与产品规则范围，本批不碰。 |
| 重写 product_id 前置措辞、self-review 下沉 | 属批次1 R3；本批只在语义层引用。 |

---

### B1 命令前置门槛三档明确化

**现状**：`product_id` 由模板强制；`save_requirement` 在 core 已拒 archived（`requirement.ts:321` → `REQUIREMENT_STATUS_INVALID`）；`getLatestRequirement` 返回非归档或 `REQUIREMENT_NOT_FOUND`。但门槛在命令模板里大多没明说，`fm-design` 也未声明"需组件库存在"。

**门槛三档**：

| 档 | 含义（判定） | 命令 |
|---|---|---|
| 1 产品存在 | 选定 product_id | `fm-status`（只读）、`fm-refine-components`、`fm-change-style` |
| 2 + 存在未归档需求 | `getLatestRequirement` 不抛 NOT_FOUND（empty/submitted/active 均可） | `fm-requirement` |
| 3 + 需求有内容 | 非空（submitted/active）且有 pages | `fm-design`（**另需组件库存在，见 B4**） |

> `fm-list-product` 是入口/选产品命令，本身不在门槛分档内（它**产生** product_id）；`fm-status` 只读、仅需产品（档1）。

**需求**：

1. 在各命令模板写明其门槛档位，并说明未满足时如何反应：
   - 缺未归档需求 → 收到 `REQUIREMENT_NOT_FOUND`，提示用户去**后台管理页建/激活需求**（agent 不创建需求）。
   - 改归档需求 → `REQUIREMENT_STATUS_INVALID`，如实上报。
2. 门槛判定依赖 core 现有错误码，不在 agent 侧另造状态判断；命令只负责"读 → 命中错误码 → 给出可执行提示"。

**验收标准**：

- [ ] 每个命令模板含其门槛档位说明（三平台一致，受批次1 R2 守卫覆盖）。
- [ ] 全归档/无需求的产品上跑 `fm-requirement`/`fm-design` → 命中 `REQUIREMENT_NOT_FOUND` 并提示去后台页，不臆造需求。
- [ ] 在归档需求上跑 `fm-requirement` → `REQUIREMENT_STATUS_INVALID`，如实上报。

**既有不变量（不改，记录防误碰）——改页过期 → 需求不可归档**：

fm-design 出稿后页面为 `done`、需求为 `active`；之后 `fm-requirement` 改某页时，**agent 按每页 `change_type` 声明改动**，core 据此把"原 `done` 且被改"的页置 `expired`（`requirement.ts:842 resolveSavedPage`）、新页置 `pending`。只要有 `expired`/`pending` 页，需求即 `submitted` 而非 `active`（`resolveRequirementStatus:907`、`doLogicOnlyUpdate:628`）；而归档要求 `active`（`archiveRequirementLocked:428`）——故**带过期页的需求无法归档**。解除：对 expired 页重跑 `fm-design`（`markPageDesignDone:469` 置回 `done`）→ 全 `done` → `active` → 可归档。

- "看哪页基线改了"由 **`fm-requirement`（agent）** 负责（打 `change_type` / `expired_pages`），core 只执行过期与状态转换。
- 本批 R1–R5、B1–B7 **均不触碰**此状态机；实施时保持不变。

### B2 `fm-refine-components`：产品级（档1）+ 产品设计系统（品牌资源 Foundations + 产品 ICON + 基线组件集）

**现状**：`generateComponents(productId, …)`（`packages/core/src/store.ts:220`）是产品级、无需求、无页面；模板已写 "component library is product-level — it has no requirement or page"。但**生成哪些组件无任何规范定义**——品牌样式的 `components.html` 是视觉展示页、`_system/system-styles.yaml` 是设计技能目录、`craft/` 是质量规则，都不是组件清单。讨论中该命令一度被误列为档2。

**需求（定位）**：

1. 明确 `fm-refine-components` 仅需产品（档1），**不依赖任何需求状态**；模板门槛标注档1。
2. 即使产品最新需求已归档（`get_requirement` 抛 NOT_FOUND），`fm-refine-components` 仍可正常工作（它根本不读需求）。

**需求（产出 = 产品设计系统：品牌资源 + 组件）**：

3. `fm-refine-components` 产出一个产品级**设计系统**工件（artifact kind `component-library`），含两区：**品牌资源（Foundations）区** + **基线组件区**。它是产品"设计系统"的唯一生成器；`fm-change-style` 切换品牌时通过它整体重生成（见 B3）。
4. **当前组件库语义（必须新增明确数据契约）**：每个产品最多只有一个**当前** `component-library` artifact 指针。首次 `fm-refine-components` 创建 artifact 并记录为当前组件库；后续 `fm-refine-components` / `fm-change-style` 必须在这个 artifact 上追加不可变新版本并更新当前版本指针，而不是每次创建一个并列的新 artifact。不得用 `updated_at`、列表顺序或需求级 `superseded` 推断当前组件库；若保留旧组件库 artifact，读取面必须通过产品级组件库指针过滤或标记其非当前状态。
5. **品牌资源（Foundations）区**，含两类：
   - **令牌可视化**（派生自所选 `brand_style` 的 `tokens.css`/`DESIGN.md`，模型不新决定、只呈现；产品只引用 `brand_style`、不覆写 token，`tools.ts:241-274`）：
     - 色彩：primary/accent、surface/bg、fg/text、border、semantic（success/warn/danger）、focus + 角色说明
     - 字体：字族 + 字阶（text-1..8）+ 行高/字距 specimen
     - 间距 / 圆角 / 高度（elev）/ 动效（motion·ease）：各刻度样例
     - 功能图标：仅**风格约定**（线性/填充、描边、尺寸网格），**不**附图标库
   - **品牌资产（产品级生成）**：**产品 ICON（品牌标识 / mark）**——首次生成时由**产品名 + brand_style**派生一个唯一 SVG mark；变体 **primary（彩色）+ monochrome（单色）**；形态体现产品身份、配色用品牌 token。`fm-design` 展示产品图标时复用这段 SVG（见 B6），保证全产品一致。ICON 必须结构化落盘：组件库保存时把 primary / monochrome SVG 写入 bundle assets，并在 manifest `forma.productIcon` 中记录两个可解析 asset path 和稳定 shape 元数据（如 geometry/shape id/source version）；web 和 `get_design_context` 只能读该 manifest 字段，不得从 HTML 文本临时解析 logo。后续 `fm-refine-components` / `fm-change-style` 若已有当前产品 ICON，必须复用既有 SVG geometry/shape，只按新 tokens 重新着色；只有无当前 ICON 时才创建新形态。favicon 由该 ICON 小尺寸渲染派生，不单独做。
6. **不生成（out of scope）**：通用功能图标库/图标字体/图标资产包（功能图标按页内联 SVG、归档时导出）；wordmark/lockup（产品名直接用品牌字体排，不做单独资产）；完整品牌 VI 规范（多版 logo 制图、印刷物）。注：产品 ICON mark **在范围内**（见上 item 5 品牌资产）。

**需求（基线组件区 = 固定基线组件集）**：

7. **来源（数据驱动，见 B7）**：基线清单 + foundations/ICON 规格作为 **Forma 内置 core 数据**（`component-baseline.ts`，按 platform 键入），**不镜像**品牌 `components.html`。`fm-refine-components` 经新工具 `get_component_baseline(product_id)` 拿到该 platform 的规格再生成。
8. **固定集，不自由发挥**：每个产品都生成**同一套**基线（按 platform 选变体），不让模型按需求随意增减，否则失去"通用"意义。本轮**不做**按产品域名补充专有组件（域内补充另列后续）。
9. **平台感知**：按产品 `platform`（`get_product`）选 web 或 mobile 变体。
10. **状态覆盖**：每个组件按 `craft/state-coverage` 覆盖适用状态（default/hover/focus/disabled/loading/empty/error）。

**优先级（brand_style / Forma 基线 / system_style 三方权威边界）**：① `brand_style` → 视觉 tokens + 组件长相（**权威**）；② Forma 固定基线（B2/B7）→ 组件清单 + 基础结构（**权威**）；③ `system_style`（"设计规范"，仅 name+description 元数据、无 tokens/组件）→ **可选软提示**，仅在 ①② 未规定处微调交互/约定，**永不覆盖** brand tokens 或基线结构，歧义时忽略。三者都不决定"有哪些"（由 ② 决定）。

**基线清单（精选档 · Web · 约 28 件 · 6 组）**：

| 组 | 组件 |
|---|---|
| 动作 | Button（primary/secondary/ghost/danger × 尺寸 × 带图标 × loading/disabled）、Icon Button、Link |
| 表单 | Text Input（含 label/help/error 字段容器 + 内联校验）、Textarea、Select、Checkbox、Radio、Switch |
| 数据展示 | Card、List/List Item、Table（表头/行/排序/空态）、Badge/Tag、Avatar、Tooltip |
| 导航 | Header/顶栏、Sidebar/菜单、Breadcrumb、Tabs、Pagination |
| 反馈/浮层 | Alert/Banner（info/success/warning/error）、Toast、Modal/Dialog、Drawer、Progress/Spinner、Skeleton |
| 通用三态 | Empty、Loading、Error（作为模式贯穿各组件） |

**Mobile 变体**：导航与交互层替换为移动件——Bottom Tab Bar（替 Sidebar+Pagination）、Top App Bar（替 Header）、List Row、Action Sheet（替 Dropdown/菜单）、Segmented Control（替 Tabs）、FAB、Pull-to-refresh；动作/表单/Card/Badge/Avatar/Toast/Alert/Progress/Skeleton/三态 沿用（按移动尺寸与触控目标）。

**验收标准**：

- [ ] `fm-refine-components` 模板不含任何需求门槛；最新需求已归档的产品上仍能精修设计系统。
- [ ] 设计系统工件含 Foundations 区（令牌可视化：色/字/距/圆角/高度/动效）+ **产品 ICON**（mark，primary + monochrome，由产品名 + brand_style 派生）。
- [ ] 产品有明确的当前 `component-library` 指针；重复 refine / change-style 会追加同一组件库 artifact 的新版本，不产生多个并列“当前组件库”。
- [ ] manifest `forma.productIcon` 记录 primary / monochrome 两个 SVG asset path + 稳定 shape 元数据；web 与 `get_design_context` 可直接解析，不依赖 HTML 解析。
- [ ] **不**生成通用功能图标库/图标字体/wordmark 资产；favicon 由产品 ICON 派生；换品牌时 ICON 复用既有 geometry/shape，只套色。
- [ ] 权威基线清单已沉淀在 `packages/core/src/component-baseline.ts`，定义 web 与 mobile 两套固定集；命令模板/shared 只引用 `get_component_baseline` 返回值，不复制清单正文；命令按 `platform` 交付对应清单。
- [ ] 同一产品生成的组件库覆盖清单上**全部**基线组件，不缺项、不随需求自由增减。
- [ ] 每个组件覆盖 `state-coverage` 的适用状态；样式仅由 tokens 决定，组件集不随品牌样式改变。

### B3 `fm-change-style` 重定义为产品级样式切换 +（委托 refine）重生成设计系统

**背景**：产品方明确——`fm-change-style` 应是**切换整个产品的样式**，而非给单个产物换肤；换样式后设计系统（含通用组件）也应随之刷新，否则旧页面用到的通用组件与新样式视觉冲突。

**与后台"新建样式"的区别（C3 厘清）**：后台管理创建产品时的"新建样式"**只写 `brand_style`/`system_style` 配置、不生成设计系统**（后台走 HTTP/core，无 AI）。后台样式配置路径可以复用 `update_product_config` 这类配置写入能力，但**不得**执行 AI 生成或委托 refine。`fm-change-style` 是 agent 命令，比后台配置多一步：设样式后**自动委托 `fm-refine-components` 重生成设计系统**。因此后台新建的产品**尚无设计系统**，首次 `fm-design` 会撞 B4 的"缺组件库"停下、提示先跑 refine。设计系统的实际生成始终归 `fm-refine-components`（见 B2）。

**现状**：

- `change_artifact_style(product_id, artifact_id, …)`（`packages/core/src/store.ts:240`）只针对**一个 artifact** 产出新版本，**不改产品配置、不碰组件库**。
- 产品配置存 `brand_style`/`system_style`，`update_product_config` 可改（schema `packages/mcp/src/tools.ts:241-274`）。
- `generate_components`（core `store.ts:220`）可重生成组件库。
- 即"产品级切换 + 级联刷新组件"的零件已齐，缺的是把它们串起来并去掉旧的单产物语义。

**需求**：

1. **重定义 `fm-change-style` 命令**为产品级样式切换，流程：
   1. 确认新 `brand_style`/`system_style`（未选则 `list_styles` 让用户选）。
   2. `update_product_config(product_id, brand_style, system_style)` 落产品配置。
   3. **级联：执行 `fm-refine-components` 的生成流程整体重生成产品设计系统**（Foundations + 产品 ICON + 基线组件）于新样式下——经 `get_component_baseline` 取规格、导出现有当前 `component-library` 源 HTML 为基线、套新 tokens 重生成（无当前指针则新建并记录当前组件库）；产品 ICON 若已存在，必须复用 manifest 中的稳定 geometry/shape，只重新套色；用 `generate_components` 保存为当前组件库的新版本 + self-review craftChecks 直到通过。fm-change-style 本身不另写生成逻辑，复用 refine 的流程（"命令不直接调命令"，指模板内执行同一套生成步骤）。
   4. **不触碰已有 design-page artifact**（rule 1）。
   5. **结束，无后续**：不重生成页面；用户若要某页采用新样式，后续自行 `fm-design`（Described 模式重生成该页）。
2. **移除旧单产物 `change_artifact_style`**（产品级切换 + fm-design 已覆盖其用途）：
   - MCP：`packages/mcp/src/tools.ts:59`（名单）、`:257`（schema）、`:343`（schema 映射）、`:377`（描述）、`:466-467`（handler）。
   - core：`packages/core/src/store.ts:84`（接口）、`:240-256`（`changeArtifactStyle` + 仅它使用的 `changeArtifactStyleWithManifest`）、`:307`（导出）。
   - 测试：`packages/core/tests/store-design-mutations.test.ts`、`packages/mcp/tests/tools.test.ts`、`packages/cli/tests/design-commands.test.ts` 中相关用例调整/删除。
   - 实施前 grep 复核无其它调用者。
3. 门槛：档1（产品）。

**验收标准**：

- [ ] `fm-change-style` 走 `update_product_config` + 调用 `fm-refine-components`（整体重生成设计系统），**不再调用** `change_artifact_style`。
- [ ] 切换后：产品配置样式更新、当前组件库 artifact 追加新版本并更新当前组件库版本指针、**已有 design-page artifact 一字不变**。
- [ ] MCP 工具集不含 `change_artifact_style`；core 无 `changeArtifactStyle`/`changeArtifactStyleWithManifest`。
- [ ] `store-design-mutations.test.ts` / `tools.test.ts` / `design-commands.test.ts` 更新后通过；`pnpm typecheck` / `pnpm build` 通过。

### B4 `fm-design` 缺组件库两段式停下（`fm-design` 内显式，无静默）

**现状**：`design-save` 不检查组件库是否存在，也无"先精修组件"的提示。原 rule 3 设想"自动补组件"，本批改为**显式停下**。

**需求**：

1. `fm-design` 生成前检查产品是否已有**当前组件库指针**（不能只看 `list_product_artifacts(product_id, kind="component-library")` 非空）。**不存在 → 停**，提示用户先跑 `fm-refine-components`，**不自动生成**。
2. `fm-refine-components` 生成完即结束（现状已是独立命令），用户审查/调整组件。
3. 用户再次 `fm-design`，组件库已在 → 正常生成页面。
4. `fm-design` 流程内无静默级联：缺组件库时只停下提示，不自动生成组件。组件生成只在用户显式跑 `fm-refine-components`，或显式跑 `fm-change-style` 后由其复用 refine 流程时发生。

**验收标准**：

- [ ] 无组件库的产品上跑 `fm-design` → 停并提示先精修组件，不产出任何设计。
- [ ] 有组件库时 `fm-design` 正常生成。
- [ ] 测试覆盖"无组件库 → 停下提示"分支。

### B5 rule 1 精确表述：样式/组件改动不回溯

**需求**：在 shared 指南与相关命令模板写明两句精确表述：

1. 改产品样式（`fm-change-style`）/ 精修组件库（`fm-refine-components`）**不回头重生成已有设计稿**，只作为后续 `fm-design` 的输入。
2. `fm-change-style` 是产品级切换；旧页面版本不可变、保持原样，直到被重新 `fm-design`。

**验收标准**：

- [ ] shared 指南含上述两句表述。
- [ ] 无任何命令在样式/组件变更后批量重生成已有设计页。

### B6 `fm-design` 按需复用基线组件（不为复用而设计）

**背景**：基线组件库（B2）只有被页面**真正复用**才有价值；但复用必须"按需"——页面需要某元素时优先用基线组件（保证视觉/行为一致），而不是为凑齐组件库硬塞。沉浸式/定制版式可不用某些通用件（例：顶部是整图的沉浸式页面，就没有通用 Header/Title）。

**现状**：`fm-design` 走 `get_design_context`（craft + style + page spec），**不含基线组件清单**；已有 "Scope fidelity (hard rule)"——只实现 page spec 声明的页面/区块/元素，不擅自增加。本条与该硬规则咬合，不得削弱它。

**需求**：

1. `fm-design` 经扩展后的 `get_design_context` 拿到两样（见 B7）：`componentBaseline`（该 platform 的基线规格）+ `componentLibrary`（产品**当前已生成**的组件库工件的引用/内容）。复用以后者的**真实 markup/tokens** 为准、规格为辅。
2. **按需复用**：页面 spec 需要某标准元素（按钮/输入/卡片/列表/导航/反馈等）时，优先复用对应基线组件（同 tokens、同状态、同交互），不另造一次性样式。**页面展示产品图标时，复用设计系统的产品 ICON（mark）SVG，不另画 logo。**
3. **不为复用而设计**：不得为"用满组件库"而往页面加 page spec 未声明的元素——与 Scope fidelity 硬规则一致。页面按设计意图决定用哪些；沉浸式/定制版式可省略或替代通用件（例：沉浸式页用整图 hero 替代 Header）。
4. 复用是"长相与行为一致"，非"结构强绑定"：页面可对组件做布局编排，但视觉 token 与状态来自基线。

**验收标准**：

- [ ] `fm-design` 上下文包含当前 `platform` 的基线组件清单。
- [ ] 页面需要的标准元素复用基线组件（同 tokens/状态），不出现与基线冲突的一次性按钮/输入等。
- [ ] 展示产品图标的页面复用设计系统的产品 ICON（同一 mark），不出现各页不一致的 logo。
- [ ] 不因复用而新增 page spec 未声明的元素（Scope fidelity 不被削弱）。
- [ ] 沉浸式/定制页可合理省略或替代通用件，不被强制套用。

### B7 数据驱动的设计系统上下文（core + MCP）

**背景**：B2/B6 要求基线规格（组件清单 + foundations + 产品 ICON 规格）有单一事实源，并同时投递给 `fm-refine-components`（要生成什么）与 `fm-design`（要复用什么）。选定**数据驱动**：规格沉淀为 core 数据、经读取工具交付，而非散落模板文本。

**现状**：`get_design_context`（`packages/core/src/design-context.ts`）返回 `craft / brandStyle / systemStyle / page / rules / platform / language`——不含基线规格，也不含产品**已生成**的组件库；`get_style` 返回品牌样式内容（非产品组件库）。`brand_style` 是完整视觉数据（DESIGN.md/tokens/components），`system_style` 只是元数据（name+description+category+upstream，无 tokens/组件）。

**需求**：

1. **新增 core 数据** `packages/core/src/component-baseline.ts`：按 `platform`（web/mobile）键入的结构化规格 `{ foundations 分类, productIcon 规格, components 清单 }`。单一事实源，测试可逐项断言齐全。
2. **refine 侧（独立工具）**：新增 MCP 工具 `get_component_baseline(product_id)`——由产品 `platform` 解析，返回对应规格。`fm-refine-components` 据此生成设计系统（替代旧模板里"自由发挥/镜像 components.html"的做法）；命令模板/shared 只引用该工具返回值，不复制基线清单正文。
3. **design 侧（扩 `get_design_context`）**：`buildDesignContext` 返回新增两字段——
   - `componentBaseline`：同上规格（让 design 知道哪些是规范件）；
   - `componentLibrary`：由产品级当前组件库指针解析出的 `component-library` 工件引用/内容（至少包含 `artifact_id`、`version`、bundle/preview 引用、manifest `forma.productIcon` 的 asset path 与稳定 shape 元数据、可供模型参考的当前 HTML 内容或等价读取面），供 B6 复用真实 markup + 产品 ICON。
4. **当前组件库指针（core / API 契约）**：新增或扩展产品级元数据记录当前 `component-library` 的 artifact id 与当前版本；`generate_components` 保存时负责创建/追加并更新该指针；`list_product_artifacts` / `get_product_artifact` / `get_design_context` 均以该指针作为“当前组件库”的唯一事实源，不按 `updated_at`、数组顺序或需求级 `superseded` 推断。
5. **system_style 厘清（G2）**：system_style 是**元数据**（name+description+category+upstream，无 tokens/组件，真内容在 upstream）。`get_style(name)` 对 system style 名会**正常返回该元数据（非 bug，`tools.ts:1032-1043` 先查品牌索引、再查系统目录）**；B7 选择经 `get_design_context.systemStyle` 结构化字段交付，更清晰一致。它是组件结构/交互约定的**软指导**，不进 foundations、不改清单；与 brand_style/基线的优先级见 B2 item10（**system_style 永不覆盖前两者**）。

**验收标准**：

- [ ] `component-baseline.ts` 定义 web/mobile 两套规格；单测断言清单 / foundations / ICON 项齐全。
- [ ] `get_component_baseline(product_id)` 返回该 platform 规格；`fm-refine-components` 模板改为读它。
- [ ] 当前组件库指针有 core/API/MCP 测试：首次生成创建指针，重复生成追加同一 artifact 新版本，读取面返回同一当前组件库。
- [ ] `get_design_context` 返回 `componentBaseline` + `componentLibrary`；`fm-design` 复用以 `componentLibrary` 为准。
- [ ] `componentLibrary` 含可解析的 `forma.productIcon` primary / monochrome asset path 与稳定 shape 元数据。
- [ ] system_style 经结构化字段（`systemStyle`）交付；模板改走该字段、无需再单独 `get_style(system_style)`（该调用本身不算错，只是统一改走结构化字段）。
- [ ] `pnpm typecheck` / `pnpm build` 通过；新增工具/字段有 MCP schema 与测试。

---

### 决策记录（2026-06-08，B2 基线清单/B6 于 2026-06-09 补）

- B1：门槛三档明确化（latest=非归档语义；缺需求→提示去后台页建）。
- B2：`fm-refine-components` = 档1（产品级）+ 生成产品**设计系统** = 品牌资源区（令牌可视化 色/字/距/圆角/高度/动效 + **产品 ICON mark**：首次由产品名+brand_style 派生、primary+mono，manifest 记录 asset path 与稳定 shape 元数据；后续 refine/change-style 复用 geometry/shape、只重新套色；favicon 由其派生；不生成通用功能图标库/wordmark/完整 VI）+ 固定基线组件集（web/mobile 变体、精选档约 28 件、状态覆盖；不镜像 components.html、不按需求自由增减）。新增产品级当前组件库指针；重复 refine/change-style 追加同一 component-library artifact 的新版本。**foundations 归 fm-refine-components，不归 fm-change-style**。
- B3：`fm-change-style` = 产品级样式切换（设定 style 配置 + **委托** `fm-refine-components` 整体重生成设计系统）；后台样式配置只写配置、不执行 AI/refine，不能等同于 fm-change-style；**移除**旧单产物 `change_artifact_style`（MCP + core + 测试）。
- B4：`fm-design` 缺组件库 → 停下提示先精修组件（显式，两段式；`fm-design` 流程内无静默生成组件）。
- B5：rule 1——样式/组件改动不回溯已生成设计。
- B6（2026-06-09）：`fm-design` 按需复用基线组件**与产品 ICON**——需要才复用、同 tokens/状态、同一产品图标；不为复用而设计，沉浸式/定制页可省略或替代通用件，Scope fidelity 不削弱。
- B7（2026-06-09）：数据驱动设计系统上下文——新增 core `component-baseline.ts` + `get_component_baseline`（refine）+ `get_design_context` 加 `componentBaseline`/`componentLibrary`（design）；system_style 经结构化字段交付（`get_style(system_style)` 本就返回元数据、非 bug，此处仅澄清）。
- system_style 取留+降级（2026-06-09）：**留** system_style（web "设计规范"功能 + manifest 留存），但严格从属——brand_style 长相权威、Forma 基线结构权威、system_style 仅软提示**永不覆盖**（见 B2 item10、B7 item5）。B2 后其"结构方法论"作用已被固定基线大部分架空，故定位为锦上添花。
- B8 取消（2026-06-09）：`fm-rollback-design` 改为**整体删除**而非规格化——agent/MCP 见清理批 R5、web 版本/回退 UI 见批次3、底层版本机制保留。
- C3（2026-06-09）：后台创建/后台样式配置只设样式不生成设计系统；`fm-change-style` 是 agent 命令，多一步委托 refine 生成。
- 既有不变量（2026-06-09 记录）：`fm-requirement` 改页 → 该页 `expired` → 需求退回 `submitted` → 不可归档；对 expired 页重跑 `fm-design` 置回 `done` 才能归档。判定改动由 agent（`change_type`）负责、core 执行状态机；R1–R5、B1–B7 不触碰（见 B1 末"既有不变量"）。

### 与批次1的关系与统一排期

- `fm-change-style` 同时被批次1 **R3**（样板下沉）与本批 **B3**（重写为产品级）触及。**B3 是该命令的最终形态**，R3 的 shared 下沉作用在 B3 之后；且 B3 后 `fm-change-style` 是薄委托、不再带 pure-static/self-review，R3 的下沉对象只剩 `fm-design`/`fm-refine-components` 两命令。
- `fm-design` 被本批 **B1/B4/B6/B7** 改动，`fm-refine-components` 被 **B2/B7** 改动，模板正文都会变；批次1 **R2 守卫**应在这些语义改完后再锁三平台正文。
- **统一排期**：批次1 **R1/R4/R5**（删命令、移除产品删除、删回退）→ 本批 **B1–B7**（语义重写 + core 数据驱动）→ 批次1 **R3**（样板下沉）→ **R2**（一致性守卫）覆盖最终命令集。批次3（web 版本 UI 下线）与本链路解耦、可并行。
- 命令数：本批不增删命令；命令总数由批次1 R1+R5 决定（删 `fm-develop-design-handoff`、`fm-rollback-design` 后为 **6**）。MCP 工具：B7 新增 1 个（`get_component_baseline`）；R4、B3、R5 各移除 1 个（`delete_product`、`change_artifact_style`、`rollback_requirement_design`）。


---

## Forma 后台设计版本/回退 UI 下线 需求文档（批次3）

- 日期：2026-06-09
- 来源：fm-rollback-design 删除讨论延伸——产品方决定 web 后台**不展示设计版本、不提供回退**
- 状态：方向已定（2026-06-09），待实施
- 关系：与 fm-* 批次（批次1/2）相对独立。agent/MCP 侧的回退删除在**批次1 R5**；本批（批次3）只管 **web 前端 UI** 下线。

### 边界（方案甲，关键）

- **只去 web 的版本/回退用户可见面**；**底层版本机制不改**——design-save 仍生成不可变 `v{n}`、`current_version` 指针、supersede、按版本服务 artifact 全部保留。
- **web 底层不改**——`api.ts` 方法、server 的 `/api/products/:pid/artifacts/:aid/versions/:v/*`、core 版本机制，**一律保留不动**，只删/改 UI 组件与文案。当前 server 无设计会话 `/rollback/plan` 路由；`api.ts` 中的 rollback URL 构造视为未暴露的客户端残留，不作为可用回退路径或验收对象。
- 经核实：web **没有**显式"回退"按钮（i18n 无 rollback 文案键），回退不在渲染层暴露；故"不显示回退"主要体现为**不渲染版本对比入口**。

### 现状（用户可见的版本面）

- `pages/VersionCompare.tsx`：版本对比页（用 `getProductArtifact` + `getArtifactVersionPreviewUrl`）。
- `routes.tsx:10/86/89/216-217`：路由 `/products/:productId/artifacts/:artifactId/compare` → `VersionCompareRoute` → `VersionCompare`。
- `pages/DesignView.tsx:59`：`version_count >= 2` 过滤；`:115/:118`：渲染"对比版本"链接（`design.compareVersions`）指向 compare 页。
- `pages/RequirementDetail.tsx:131`：`current_version` 仅用于 `isRenderableDesignArtifact` 内部判定，不是用户可见版本号展示。
- i18n（en+zh 各 6 键）：`design.compareEmpty / compareLeft / comparePreviewMissing / compareRight / compareTitle / compareVersions`。

### 范围

- W1：删 `VersionCompare.tsx` 页与其路由（`routes.tsx` 的 import、route 定义、`VersionCompareRoute`）。
- W2：删 `DesignView.tsx` 的"对比版本"入口（`:115-118`）与 `version_count >= 2` 过滤逻辑（`:59`）。
- W3：去掉面向用户的**版本号展示**（`DesignView.tsx` 任何版本标签，以及其它实际渲染给用户看的版本文本）。**保留** `current_version` 作为内部"活跃指针"用途（DesignView 用它选当前设计，`RequirementDetail.tsx` 用它判定 artifact 可渲染），只删"给用户看版本"的部分。
- W4：删上述 6 个版本对比 i18n 键（en + zh，共 12 条）及任何悬挂引用。
- W5：回退——web 无显式控件，无 UI 可删；确认渲染层不暴露回退即可。`api.ts` 的 `rollback` 操作类型与 `/rollback/plan` URL 构造作为未暴露客户端残留**保留不动**；不得把它描述为 server 已有路由或可用用户路径。

### 非范围（明确不做 / 保留）

| 项 | 处置 |
|---|---|
| 底层版本机制（不可变 `v{n}`、`current_version`、supersede、按版本服务） | **保留不改** |
| `api.ts` 的 `getArtifactVersionPreviewUrl`、`getProductArtifact`（返回 versions/current_version）、`rollback` 操作类型与 `/rollback/plan` URL 构造 | **保留**（web 底层不改；rollback URL 是未暴露客户端残留，当前 server 无对应路由） |
| server `/versions/:v/bundle`、`/versions/:v/preview` 路由 | **保留不改** |
| core / mcp 版本与回退（mcp 回退删除属清理批 R5，与本批独立） | 本批不碰 |

### 验收标准

- [ ] web 不再有版本对比页/路由/入口；后台只展示"当前设计"。
- [ ] 移除版本对比 i18n 键后无悬挂引用；`pnpm --filter @xenonbyte/forma-web build` 通过。
- [ ] `current_version` 作为内部活跃指针的逻辑不受影响（当前设计仍正确渲染，包括 current_version 不是最高版本号的情况）。
- [ ] `api.ts`、server 路由、core 版本机制零改动（diff 仅在 web 组件/路由/i18n）。

### 决策记录（2026-06-09）

- 方案甲：web 不展示版本、不显示回退；**底层版本机制与 web 底层（api/server/core）不改**，仅删前端版本对比 UI 与文案。
- agent/MCP 侧回退删除在清理批 R5；本批仅 web 前端。


---

## Forma 后台管理 无限画布功能 需求文档（批次4）

- 日期：2026-06-09
- 来源：后台管理（web）新功能——标注画布白底、需求设计画布交互对齐标注、产品页品牌资源画布
- 状态：方向已定（2026-06-09 确认），待实施
- 关系：纯 **web 前端**功能，与 fm-* 批次相对独立。与批次3（删版本对比 UI）同改 `DesignView.tsx` 但不冲突（批次3 删 compare 链接，本批增强画布）；BC3 依赖 B2 的 component-library 设计系统工件（见批次2）。

### 背景：两套画布引擎（现状）

| 画布 | 页面 | 引擎 | 现状 |
|---|---|---|---|
| 需求设计稿 | `web/src/pages/DesignView.tsx`（`:136` 用 viewer `Canvas` mode="design"） | **React Flow** 渲 HTML（`viewer/src/Canvas.tsx` → `tiles/DesignTile`） | 白底（`DesignView.tsx:126`）；React Flow 默认 pan/zoom/select；**无逐 tile 标题标签、无选中框** |
| 标注 | `web/src/pages/AnnotationPage.tsx` | **CanvasKit**（`@vzi-core/renderer` `CanvasKitSurface`）渲 VZI | 深底 `#2b2b2b`（`:311`）+ 白点网（`:317`）；有选中/hover、focus 磨砂框（`FocusFrame :421`）、逐页标题标签（`PageFrameOverlays :449`）、fit-to-content |

**关键约束**：两者渲染引擎不同（React Flow 渲 HTML vs CanvasKit 渲 VZI），**本批不换引擎**——只对齐**观感与交互**（白底、标题标签、选中框、pan/zoom 手感）。

路由（`web/src/routes.tsx`）：ProductDetail `/products/:productId`（`:65-68`）、DesignView `…/requirements/:reqId/design`（`:79-82`）、AnnotationPage `…/requirements/:reqId/annotation`（`:93-96`）。

### 范围

- BC1：标注画布底色 `#2b2b2b` → 白（含点网/选中框/标签的连带适配）。
- BC2：需求设计画布增强——逐 tile 标题标签 + 选中框 + pan/zoom 对齐标注（增强 React Flow `Canvas`，不换引擎）。
- BC3：产品页加品牌资源入口 → 新画布页渲染 component-library 设计系统工件（HTML）+ 产品 ICON 图片 tile，交互同标注（复用 BC2 增强）。

### 非范围（明确不做）

| 项 | 理由 |
|---|---|
| 统一/更换画布引擎（annotation 留 CanvasKit、design/brand 留 React Flow） | 引擎各有其渲染目标（VZI vs HTML），合并成本高；只对齐观感与交互。 |
| 改底层版本机制、artifact 存储、resolver 安全边界 | 本批纯前端展示。 |
| 版本对比/回退 UI | 由批次3 删除，本批不依赖。 |

---

### BC1 标注画布改白底（含连带适配）

**现状**（`AnnotationPage.tsx`）：容器深底 `background:"#2b2b2b"`（`:311`）、容器边 `border-zinc-700`（`:310`）；点网格白点 `rgba(255,255,255,0.12)`（`:317`）；focus 磨砂框 `background:rgba(255,255,255,0.06)` + `border-white/15`（`:428/435`）；标题标签色 `text-zinc-300`（默认）/ `text-sky-400`（聚焦）（`:488`）。直接把底色改白会让白点网、白磨砂框、浅色标签在白底上看不见。

**需求**：

1. 容器底色 `#2b2b2b` → 白（`#ffffff` 或 `#fafafa`）；容器边框改浅色（如 `border-zinc-200`）。
2. 点网格改**深点 on 白**（如 `rgba(0,0,0,0.06)`），保持低存在感。
3. focus 磨砂框改为白底可见——浅灰边 + 极浅磨砂/白（或改为浅色描边 frame），确保聚焦页仍有视觉区分。
4. 标题标签色适配白底：默认深灰（如 `text-zinc-600`）、聚焦蓝（如 `text-sky-600`）。
5. 仅改样式，不动 CanvasKit 渲染、选中/hover/fit 逻辑。

**验收标准**：

- [ ] 标注画布为白底；标题标签与选中/focus 等交互指示在白底清晰可见并满足 WCAG AA 对比；装饰性点网在白底可辨但保持低干扰。
- [ ] 选中/hover/聚焦/fit-to-content 行为不变；`AnnotationPage.test.tsx` 通过（更新涉及颜色的断言）。

### BC2 需求设计画布增强：标题标签 + 选中框 + 交互对齐标注

**现状**：`DesignView.tsx:136` 用 viewer `Canvas`（React Flow，mode="design"），白底；React Flow 默认交互（`Canvas.tsx`：`nodesDraggable={false}`、`elementsSelectable`、仅 `<Background/>`）。**无逐 tile 标题标签、无选中框高亮**——标注那套（`PageFrameOverlays` 标签 + `FocusFrame` 选中框）只在 AnnotationPage 里，设计画布没有。

**需求**（增强落在 `viewer/src/Canvas.tsx`，BC3 复用）：

1. **逐 tile 标题标签**：每个 tile 上方渲染标题小标签，观感对齐标注 `PageFrameOverlays`（默认灰、选中/聚焦蓝）。标题取自 tile/artifact（page name / title）。
2. **选中框**：选中 tile 时显示选中框/高亮，观感对齐标注 `FocusFrame`。React Flow `elementsSelectable` 已开，补选中态样式 + 选中框。
3. **pan/zoom 对齐**：滚轮缩放、拖拽平移手感尽量与标注一致。
4. 顶栏（`DesignView.tsx:102` 返回 + 需求 ID）保留；本条"顶部标签"指**逐 tile 标题**，非顶栏。
5. **不换引擎**：保持 React Flow + HTML `DesignTile`。

**验收标准**：

- [ ] 设计画布每个 tile 有标题标签；选中 tile 有可见选中框；白底。
- [ ] pan/zoom 与标注观感一致（人工核对）。
- [ ] `DesignView.test.tsx` 与 viewer `Canvas` 测试更新通过。

### BC3 产品页品牌资源入口 + 品牌资源画布

**现状**：ProductDetail（`routes.tsx:65` → `pages/ProductDetail.tsx`）无品牌资源入口；component-library 设计系统工件由 `fm-refine-components` 产出（B2）；无渲染它的画布页。`DesignView` 已示范"`listProductArtifacts` → viewer `Canvas`"的渲染链，但当前 `mapArtifactsToViewerInputs` 只接收 `design-page` 且要求 `page_id`/`variant`/`current_version`，不能直接用于 product-level `component-library`。

**需求**：

1. **入口**：`ProductDetail.tsx` 加"品牌资源"入口（卡片/链接）→ 新路由 `/products/:productId/brand`（`routes.tsx` 注册 + i18n 文案）。
2. **新页 `BrandResources`**：通过产品级当前组件库指针读取当前 `component-library` 工件（artifact id + current version + manifest），渲染其 HTML（设计元素 + 通用组件）于无限画布，**复用 BC2 增强后的 viewer `Canvas`**（mode="design" 或新增 mode）。不得用 `listProductArtifacts(... kind="component-library")` 的数组顺序、`updated_at` 或 `superseded` 推断当前组件库。
3. **product-level mapper**：新增或扩展 viewer/web 映射函数来生成品牌资源 tile 输入；不要把现有 `mapArtifactsToViewerInputs` 的 design-page 前提硬套到 `component-library`。品牌资源 tile 的分组键可固定为 `brand-resources`，标题取组件库标题。
4. **产品 ICON 图片 tile**：从当前组件库 manifest `forma.productIcon.primary`（必要时也可切换 monochrome）读取 SVG asset path，经 resolver 作为**单独图片 tile**摆上画布；不得从 HTML 文本解析 logo，也不得把 ICON 只嵌在组件库 HTML 里。
5. **交互**：同标注 / 同 BC2 增强（白底 + 标题标签 + 选中框 + pan/zoom）。
6. **空态**：产品无当前 component-library 指针时，空态提示去跑 `fm-refine-components`（呼应 B4“先有设计系统”）。

**验收标准**：

- [ ] ProductDetail 有"品牌资源"入口；新路由可达。
- [ ] BrandResources 通过当前组件库指针渲染 component-library HTML + 产品 ICON 图片 tile 于画布；交互与设计/标注一致。
- [ ] 存在 product-level viewer mapper 或等价扩展；测试覆盖 component-library 不具备 page_id/variant 时仍能渲染。
- [ ] 无当前组件库指针时显示空态提示。
- [ ] 新增页有测试；路由/ i18n 同步。

**依赖**：B2/B7（当前 component-library 指针 + foundations/组件/ICON + `forma.productIcon` asset path）。B2/B7 未落地时，本页可先做原型渲染，但正式验收必须走当前指针与 manifest ICON 契约。

---

### 决策记录（2026-06-09）

- BC1：标注画布白底 + 浅灰点网 + 适配后的选中框/标题标签；仅改样式。
- BC2：增强 React Flow 设计画布（逐 tile 标题标签 + 选中框 + pan/zoom 对齐标注），**不换引擎**；增强落 `viewer/Canvas.tsx`，BC3 复用。
- BC3：ProductDetail 加品牌资源入口 → 新画布页渲染 component-library HTML + 产品 ICON 图片 tile，交互同标注；依赖 B2。
- 边界：两套引擎不合并（annotation=CanvasKit/VZI，design+brand=React Flow/HTML），只对齐观感与交互。
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 96441, 'JavaScript': 22016}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
  - @xenonbyte/forma-cli workspace:* (npm)
  - @xenonbyte/forma-core workspace:* (npm)
  - @xenonbyte/forma-server workspace:* (npm)
  - @biomejs/biome 2.2.4 (npm, dev)
  - @types/js-yaml ^4.0.9 (npm, dev)
  - @types/node ^24.0.0 (npm, dev)
  - @vitest/browser 4.1.6 (npm, dev)
  - @vitest/browser-playwright 4.1.6 (npm, dev)
  - @xyflow/react 12.10.2 (npm, dev)
  - happy-dom ^20.9.0 (npm, dev)
  - js-yaml ^4.1.1 (npm, dev)
  - playwright 1.60.0 (npm, dev)
  - react ^19.2.6 (npm, dev)
  - react-dom ^19.2.6 (npm, dev)
  - tsup ^8.0.0 (npm, dev)
  - tsx ^4.20.0 (npm, dev)
  - typescript ^5.9.0 (npm, dev)
  - vitest ^4.0.7 (npm, dev)
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 96441, 'JavaScript': 22016}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
  - @xenonbyte/forma-cli workspace:* (npm)
  - @xenonbyte/forma-core workspace:* (npm)
  - @xenonbyte/forma-server workspace:* (npm)
  - @biomejs/biome 2.2.4 (npm, dev)
  - @types/js-yaml ^4.0.9 (npm, dev)
  - @types/node ^24.0.0 (npm, dev)
  - @vitest/browser 4.1.6 (npm, dev)
  - @vitest/browser-playwright 4.1.6 (npm, dev)
  - @xyflow/react 12.10.2 (npm, dev)
  - happy-dom ^20.9.0 (npm, dev)
  - js-yaml ^4.1.1 (npm, dev)
  - playwright 1.60.0 (npm, dev)
  - react ^19.2.6 (npm, dev)
  - react-dom ^19.2.6 (npm, dev)
  - tsup ^8.0.0 (npm, dev)
  - tsx ^4.20.0 (npm, dev)
  - typescript ^5.9.0 (npm, dev)
  - vitest ^4.0.7 (npm, dev)
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 96441, 'JavaScript': 22016}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
  - @xenonbyte/forma-cli workspace:* (npm)
  - @xenonbyte/forma-core workspace:* (npm)
  - @xenonbyte/forma-server workspace:* (npm)
  - @biomejs/biome 2.2.4 (npm, dev)
  - @types/js-yaml ^4.0.9 (npm, dev)
  - @types/node ^24.0.0 (npm, dev)
  - @vitest/browser 4.1.6 (npm, dev)
  - @vitest/browser-playwright 4.1.6 (npm, dev)
  - @xyflow/react 12.10.2 (npm, dev)
  - happy-dom ^20.9.0 (npm, dev)
  - js-yaml ^4.1.1 (npm, dev)
  - playwright 1.60.0 (npm, dev)
  - react ^19.2.6 (npm, dev)
  - react-dom ^19.2.6 (npm, dev)
  - tsup ^8.0.0 (npm, dev)
  - tsx ^4.20.0 (npm, dev)
  - typescript ^5.9.0 (npm, dev)
  - vitest ^4.0.7 (npm, dev)
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 96441, 'JavaScript': 22016}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
  - @xenonbyte/forma-cli workspace:* (npm)
  - @xenonbyte/forma-core workspace:* (npm)
  - @xenonbyte/forma-server workspace:* (npm)
  - @biomejs/biome 2.2.4 (npm, dev)
  - @types/js-yaml ^4.0.9 (npm, dev)
  - @types/node ^24.0.0 (npm, dev)
  - @vitest/browser 4.1.6 (npm, dev)
  - @vitest/browser-playwright 4.1.6 (npm, dev)
  - @xyflow/react 12.10.2 (npm, dev)
  - happy-dom ^20.9.0 (npm, dev)
  - js-yaml ^4.1.1 (npm, dev)
  - playwright 1.60.0 (npm, dev)
  - react ^19.2.6 (npm, dev)
  - react-dom ^19.2.6 (npm, dev)
  - tsup ^8.0.0 (npm, dev)
  - tsx ^4.20.0 (npm, dev)
  - typescript ^5.9.0 (npm, dev)
  - vitest ^4.0.7 (npm, dev)
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 96441, 'JavaScript': 22016}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
  - @xenonbyte/forma-cli workspace:* (npm)
  - @xenonbyte/forma-core workspace:* (npm)
  - @xenonbyte/forma-server workspace:* (npm)
  - @biomejs/biome 2.2.4 (npm, dev)
  - @types/js-yaml ^4.0.9 (npm, dev)
  - @types/node ^24.0.0 (npm, dev)
  - @vitest/browser 4.1.6 (npm, dev)
  - @vitest/browser-playwright 4.1.6 (npm, dev)
  - @xyflow/react 12.10.2 (npm, dev)
  - happy-dom ^20.9.0 (npm, dev)
  - js-yaml ^4.1.1 (npm, dev)
  - playwright 1.60.0 (npm, dev)
  - react ^19.2.6 (npm, dev)
  - react-dom ^19.2.6 (npm, dev)
  - tsup ^8.0.0 (npm, dev)
  - tsx ^4.20.0 (npm, dev)
  - typescript ^5.9.0 (npm, dev)
  - vitest ^4.0.7 (npm, dev)
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
