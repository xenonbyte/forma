# fm-design 状态同步 Bug 修复需求

- 状态：已实现（核心状态同步修复）
- 日期：2026-06-05
- 类型：Bug fix
- 相关产品样例：`P-b5df70` / `R-3fd15635`

## 实现记录

2026-06-05 已完成：

- 在 `RequirementService` 增加 `markPageDesignDone()` / `markPageDesignDoneLocked()`，用于把指定 requirement page 标记为 `done` 并重新计算 requirement 状态。
- 在 `generateRequirementDesign()` 保存 artifact 和 design pointer 成功后调用状态同步，保持返回值契约不变。
- 新增 core 回归测试覆盖单页面、多页面顺序生成后的 `design_status` 与 requirement `status` 推进。
- 现有 Web 和 Server 逻辑无需改动：它们继续以 requirement read model 为唯一状态来源。

验证命令：

- `pnpm exec vitest run packages/core/tests/store-design-mutations.test.ts`
- `pnpm exec vitest run packages/web/src/pages/ProductDetail.test.tsx packages/web/src/pages/RequirementDetail.test.tsx`
- `pnpm exec vitest run packages/server/tests/routes.test.ts`
- `pnpm typecheck`
- `git diff --check`

## 背景

执行 `$fm-design` 后，需求下的 5 个页面都已经生成 `design-page` artifact，并且预览状态为 `ready`。其中首页首版因“设置”按钮对比度不足触发 `contrast-aa` 失败，修复后首页保存为 version 2，所有页面的 `contrast-aa`、`type-scale`、`color-palette`、`font-families` 均通过。

但是后台管理里的需求页面仍显示每个页面为“待处理”，产品详情页的“归档”按钮也不能点击。用户看到的状态与实际设计产物状态不一致。

## 问题

`generate_requirement_design` 成功保存设计后，只更新了设计 artifact 和 design pointer，没有同步更新 requirement 的页面状态。

当前状态分成了两套来源：

- artifact / design pointer：页面设计已经存在，pointer 的 `designStatus` 是 `active`。
- requirement read model：`requirement.yaml` 里的 `pages[].design_status` 仍是 `pending`，因此 requirement 状态仍是 `submitted`。

后台 UI 和归档接口都以 requirement read model 为准：

- 需求详情页直接渲染 `page.design_status`。
- 产品详情页只有在 `requirement.status === "active"` 时才启用归档按钮。
- 服务端归档接口也只允许 `active` 需求归档。

因此 artifact ready 不会自动让后台认为需求已可归档。

## 根因

根因是 `packages/core/src/store.ts` 的 `generateRequirementDesign()` 只调用 `saveDesignArtifact()`，没有在保存成功后调用 RequirementService 更新对应页面的 `design_status`。

关键证据：

- `packages/core/src/store.ts:160`：`generateRequirementDesign()` 校验需求和页面存在后，只保存 artifact 并返回 `{ artifact_id, version, preview_status }`。
- `packages/core/src/design-save.ts:246`：`saveDesignArtifact()` 对 `design-page` 只写 design pointer，且 pointer 状态为 `active`。
- `packages/core/src/requirement.ts:862`：需求状态由 `pages[].design_status` 推导，只要存在 `pending` 或 `expired` 页面，需求就是 `submitted`，否则是 `active`。
- `packages/web/src/pages/RequirementDetail.tsx:136`：需求详情页显示 `page.design_status`。
- `packages/web/src/pages/ProductDetail.tsx:290`：归档按钮要求 `requirement.status === "active"`。
- `packages/server/src/routes.ts:304`：归档接口同样要求 `requirement.status === "active"`，所以前端单独改按钮不足以修复。

## 目标

1. `generate_requirement_design` 成功生成并保存页面设计后，对应 requirement page 自动从 `pending` 或 `expired` 变为 `done`。
2. 当一个 UI 需求的所有页面均为 `done` 后，requirement 自动从 `submitted` 变为 `active`。
3. 后台需求详情页显示已完成状态。
4. 产品详情页归档按钮可点击，服务端归档接口允许归档。
5. 重新生成某个页面的新版本时，保持该页为 `done`，不要把已经完成的需求退回 `submitted`。

## 非目标

- 不从前端临时推导状态，不把 artifact 是否存在作为 UI 状态的替代来源。
- 不绕过服务端归档校验。
- 不改变 `save_requirement` 的页面变更语义：新页面仍初始化为 `pending`，patch / rebuild 仍按现有规则让页面过期。
- 不改变 design pointer 的 `designStatus: "active"` 语义。
- 不修改 `$fm-design` agent 模板的自检流程。

## 修复方案

### 1. 在 RequirementService 增加完成页面设计的明确方法

新增一个窄方法，例如：

```typescript
markPageDesignDone(requirementId: string, pageId: string): Promise<Requirement>
```

或带锁版本：

```typescript
markPageDesignDoneLocked(requirementId: string, pageId: string): Promise<Requirement>
```

行为：

1. 读取 requirement。
2. 拒绝 `empty` 和 `archived` 状态。
3. 找到目标 page；找不到时抛稳定错误，例如 `REQUIREMENT_PAGE_NOT_FOUND`。
4. 将目标 page 的 `design_status` 设为 `done`。
5. 保留页面的 semantic contract、copy、change_type、change_summary 等现有字段。
6. 用现有的 `resolveRequirementStatus(pages)` 推导 requirement 状态：
   - 仍有 `pending` / `expired`：保持或变为 `submitted`。
   - 全部为 `done`：变为 `active`。
7. 原子写回 requirement 文件。

这个方法应只更新 requirement 状态文件，不改 baseline、copy translations、product rules。页面设计完成是设计产物状态变更，不是需求内容变更。

### 2. 在 generateRequirementDesign 成功保存后调用状态同步

在 `packages/core/src/store.ts` 的 `generateRequirementDesign()` 中：

1. 继续先执行现有校验。
2. 调用 `saveDesignArtifact()` 保存 HTML artifact。
3. 只有当 `saveDesignArtifact()` 成功返回后，才调用 `requirements.markPageDesignDone(...)`。
4. 返回原有 `{ artifact_id, version, preview_status }` 形状，不改变 MCP / Web API 调用方契约。

关键点：不要在保存 artifact 前标记 done。否则 artifact 保存失败时 requirement 会误显示完成。

### 3. 使用同一个产品级 mutation lock 避免状态竞争

当前 `saveDesignArtifact()` 内部会用 `runProductMutation({ operation: "save_design_pointer" })` 更新 design pointer。如果再单独调用 `markPageDesignDone()`，需要避免同一流程中出现锁嵌套或竞态。

实现时应选择一种清晰策略：

- 方案 A：`generateRequirementDesign()` 外层持有一次 product mutation lock，内部调用 locked 版本写 pointer 和 requirement。
- 方案 B：保持 artifact 版本写入在现有路径中完成，随后用单独的 requirement mutation 写 done 状态，并确保不会在已有锁内再次申请同一锁。

推荐方案 A，如果现有 `saveDesignArtifact()` 内部锁结构不易调整，则先做最小安全改动：在 artifact 保存完成后调用非嵌套的 requirement mutation，并用测试覆盖多页面顺序生成的最终状态。

本次实现采用最小安全改动：保存 artifact / design pointer 成功后，再用非嵌套 requirement mutation 写入 `done` 状态，避免在现有 `saveDesignArtifact()` 锁结构上引入嵌套锁风险。

### 4. 保持状态来源单一

后台 UI 不应改成“如果 artifact 存在就显示 done”。UI 应继续读取 requirement 状态。修复完成后，`get_requirement` / `list_requirements` 返回的 requirement read model 就会反映真实状态，Web UI 和服务端归档自然一致。

## 状态流

### 修复前

1. `save_requirement` 创建新页面：`design_status = pending`，requirement = `submitted`。
2. `generate_requirement_design` 保存 artifact：artifact ready，pointer active。
3. requirement 仍是 `submitted`，pages 仍是 `pending`。
4. UI 显示待处理，归档按钮禁用。

### 修复后

1. `save_requirement` 创建新页面：`design_status = pending`，requirement = `submitted`。
2. 每次 `generate_requirement_design` 成功保存一个页面：
   - 对应 page 变为 `done`。
   - requirement 根据所有页面状态重新计算。
3. 最后一个 pending 页面完成后：
   - 所有 pages 都是 `done`。
   - requirement 变为 `active`。
4. UI 显示完成，归档按钮可点击。

## 错误处理

- artifact 保存失败：不更新 requirement page 状态。
- requirement 不属于 product：沿用现有 `REQUIREMENT_PRODUCT_MISMATCH`。
- page 不存在：沿用或新增稳定错误 `REQUIREMENT_PAGE_NOT_FOUND`。
- requirement 已归档：抛 `REQUIREMENT_STATUS_INVALID`。
- requirement 为空：抛 `REQUIREMENT_STATUS_INVALID`。
- 状态同步失败但 artifact 已保存：应返回错误，而不是假装设计流程成功。否则用户仍会遇到本 bug。错误信息需指向 requirement 状态同步失败，方便重试。

## 测试要求

### Core

新增或扩展 `packages/core/tests/store-design-mutations.test.ts`：

1. 单页面 requirement：
   - 初始 `submitted` + page `pending`。
   - 调用 `generateRequirementDesign()`。
   - 断言 page `design_status` 为 `done`，requirement `status` 为 `active`。
2. 多页面 requirement：
   - 生成第一个页面后，只有该页 `done`，requirement 仍为 `submitted`。
   - 生成最后一个页面后，所有页面 `done`，requirement 为 `active`。
3. artifact 保存失败时，不应把 page 标记为 `done`。
4. 对已 `done` 页面再次生成新版本，page 保持 `done`，requirement 保持 `active`。
5. page 不存在时仍报 `REQUIREMENT_PAGE_NOT_FOUND`，不写 artifact / 不改 requirement。

### Server

新增或扩展归档路由测试：

1. 在所有页面设计完成后，`PUT /api/products/:id/requirements/:reqId/archive` 返回成功。
2. 仍有页面未完成时，归档接口继续返回 `REQUIREMENT_STATUS_INVALID`。

### Web

扩展 `ProductDetail` / `RequirementDetail` 相关测试：

1. 当 API 返回 requirement `active` 且页面 `done` 时，页面状态显示完成。
2. `ProductDetail` 中归档按钮在 `active` requirement 上可点击。
3. `submitted` requirement 归档按钮仍禁用。

### MCP

扩展 `generate_requirement_design` 相关测试：

1. 工具调用成功后，store 的 `generateRequirementDesign()` 被调用且返回原有形状。
2. 如果 core 层返回同步状态错误，MCP 透传稳定错误码。

## 验收标准

1. 对 `P-b5df70` / `R-3fd15635` 这类 5 页面需求，重新生成 5 个页面后：
   - `get_requirement` 返回每个页面 `design_status: "done"`。
   - requirement `status: "active"`。
2. 后台需求详情页不再显示“待处理”。
3. 产品详情页归档按钮可点击。
4. 调用归档接口可以成功生成 handoff assets 并归档 requirement。
5. 所有新增测试通过。
6. `pnpm typecheck` 和相关测试通过；最终合入前跑 `pnpm test`。

## 风险与注意点

- 不要用前端推导规避后端状态问题，否则归档接口仍失败。
- 注意 product mutation lock，不要引入死锁。
- 要保证 artifact 写入和 requirement 状态同步的顺序：只有 artifact 成功后才能标记 done。
- 如果 requirement 状态同步失败，调用方必须看到错误，避免再次产生“artifact ready 但需求 pending”的静默不一致。
- `save_requirement` 后续 patch / rebuild 仍会让页面进入 `expired`，这是正确行为；修复不能破坏这条状态机。
