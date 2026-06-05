# 移除 v6 Schema 迁移 / 兼容子系统

- 状态：草案（待评审）
- 日期：2026-06-05
- 分支：`refactor/remove-v6-schema-migration`
- 取代：本设计移除 `2026-05-21-forma-v6-01-preflight-normalization-design.md` 与 `2026-05-21-forma-v6-03-cutover-normalization-design.md` 所定义的功能

## 背景

Forma v6 在引入「strict schema 读模型」（运行时启动强制校验所有 on-disk YAML）的同时，配套实现了一整套**显式 schema 迁移机制**，用于把 v6 之前写入磁盘的旧数据规范化到 v6 格式。这套机制由以下部分组成：

- **核心模块** `packages/core/src/schema-normalization.ts`（约 2525 行）：dry-run（preflight）扫描与候选校验、cutover 落盘、备份（`normalization-backups/`）、journal、manifest、恢复（recover/restore）、回滚。
- **启动门禁** `packages/core/src/store.ts`：`createFormaStore` 启动时读取迁移状态（`readSchemaNormalizationRecoveryState`），未完成迁移则抛 `SchemaNormalizationStartupError`。
- **CLI 命令**（4 个）：`schema-normalization-dry-run`、`v6-schema-cutover`、`recover-v6-normalization-journal`、`restore-v6-normalization-backup`。
- **server / mcp 降级模式**：捕获 `SchemaNormalizationStartupError` 后进入 limited 模式——server 挂 preflight-only / recovery-only 路由（含 `/api/recovery/schema-normalization*`），mcp 注册 limited tools。

这套子系统横跨 `core` / `cli` / `server` / `mcp` 四个包，并让启动路径、约 12 个测试文件的 setup 都背上了「必须先迁移才能用」的包袱。

按仓库现状（见根 `CLAUDE.md`），v6 与 `od-*` 子系统仍处于 in-progress，**尚未发布、无真实存量旧数据**需要迁移。继续维护这套「兼容旧格式」的迁移机制收益低、维护成本高，且与「代码以最新 v6 为唯一事实来源」的方向相悖。

## 目标

1. **移除整套「迁移旧数据」机制**——dry-run / cutover / recovery / backup / journal / 启动门禁 / server·mcp limited 降级模式，代码以最新 v6 strict schema 为唯一事实来源。
2. **保留 v6 strict 读模型校验本身**（`validateStrictStoreReadModels`）：数据若不符合 v6 schema，启动时**直接 fail loud**，不再有迁移工具去「救」旧数据。
3. **简化 server / mcp 启动路径**：去掉 limited 降级分支，`createFormaStore` 失败即普通启动失败。
4. **同步清理**受影响的测试与文档，保持代码与文档一致。

## 非目标

- 不修改 v6 strict schema 本身的字段定义或校验规则。
- 不动 `recoverPendingProductDeletes`（产品删除恢复，与 schema 迁移无关）。
- 不动 `normalizeKind` / `normalizeFormaExtension`（artifact manifest 字段规范化，名字撞词但与迁移无关）。
- 不提供任何替代的旧数据自动升级工具——**明确不再支持**旧格式数据的迁移。
- 不处理用户磁盘上 `$FORMA_HOME` 内已存在的迁移产物残留（`.v6-schema-cutover-*` 标记、`normalization-backups/`、`normalization-preflight/`、`normalization_report.yaml`）；代码不再读写它们，留作无害残留。

## 已确认的边界决策

| 决策点 | 结论 |
|---|---|
| v6 strict schema 校验（`validateStrictStoreReadModels`） | **保留**。只删「迁移旧数据」机制。 |
| server / mcp limited 降级模式 | **一并删除**。启动失败即普通失败。 |
| 文档处理 | 删除迁移专属 spec（01-preflight、03-cutover），同步更新其它引用处。 |
| `store-startup-validation.test.ts` | 读内容后处理：仅删迁移/门禁用例，保留纯 strict 读模型校验用例（若有）。 |
| `v6-01-preflight` spec | 与 03-cutover 一起删除（preflight 是迁移机制的一环）。 |

## 删除范围

> 行号为撰写时快照，实现时以符号为准（可能因前序编辑漂移）。

### ① core

- **删除整文件** `packages/core/src/schema-normalization.ts`。
- `packages/core/src/index.ts`：删 `export * from "./schema-normalization.js"`。
- `packages/core/src/store.ts`：
  - 删 `schema-normalization.js` 的 import；
  - 删启动门禁（读取迁移状态并抛 `SchemaNormalizationStartupError` 的分支）；
  - 清理相关注释；
  - **保留** `createStrictFormaStore` 与 `validateStrictStoreReadModels`。

行为变化：`createFormaStore` 不再读取迁移状态、不再检查 `.v6-schema-cutover-committed` 标记；旧格式数据改由 strict 读模型校验直接 fail loud。

### ② cli（`packages/cli/src/index.ts`）

- 删 import 中的迁移符号（`normalizeFormaHomeForV6`、`recoverV6NormalizationJournal`、`restoreV6NormalizationBackup`）。
- 删 4 个命令分支（`schema-normalization-dry-run` / `v6-schema-cutover` / `recover-v6-normalization-journal` / `restore-v6-normalization-backup`）。
- 删对应的 4 个 run 函数与 `parseNormalizationArgs` 辅助函数。
- 删 usage 文本中对应的 4 行。
- 保留 serve / install / uninstall / status / mcp / version。

### ③ server

- `packages/server/src/routes.ts`：
  - 删迁移相关 import（`recoverV6NormalizationJournal`、`restoreV6NormalizationBackup`、`SchemaNormalizationRecoveryError`、`SchemaNormalizationRecoveryState`）；
  - 删 `registerPreflightOnlyRoutes`、`registerRecoveryOnlyRoutes`、`sendNormalizationBlocked`、`mapRecoveryError` 及 3 个 `/api/recovery/schema-normalization*` 路由；
  - **保留** `normalizeKind` / `normalizeFormaExtension`。
- `packages/server/src/app.ts`：
  - 删迁移相关 import；
  - 删 `limitedState` 链路：`createFormaStore` 的 try/catch 简化为直接 `await`（不再 catch normalization 错误），删 notFoundHandler 中的 limited 分支，删末尾 limited 路由注册块；
  - **保留** `recoverPendingProductDeletes`。

### ④ mcp

- `packages/mcp/src/index.ts`：删 import 中的 `isSchemaNormalizationStartupError`、`registerLimitedFormaTools`；`createFormaStore` 的 try/catch 简化为直接 `await`（不再进入 limited）。
- `packages/mcp/src/tools.ts`：删 `SchemaNormalizationRecoveryState` type import、`registerLimitedFormaTools`、`normalizationBlockedResult`；保留其余 tools 与 `normalizeKind` / `normalizeFormaExtension`。

### ⑤ 测试

- `packages/core/tests/store-startup-validation.test.ts`：删迁移/门禁用例；若含纯 strict 读模型校验用例则保留（必要时拆分或重命名文件）。
- 清理以下测试中「先 cutover / 写 committed 标记以便 store 能启动」的 setup 样板（删门禁后不再需要，且会因调用被删符号而报错）：`product-design-pointer`、`backfill-design-artifacts`、`design-context`、`product-config`、`store-design-mutations`、`product-session-style`、`design-save`、`artifact-tmp-cleanup` 等。
- 删 `packages/cli/tests/cli.test.ts` 的 4 命令用例。
- 删 `packages/server/tests/routes.test.ts` 的 recovery 路由用例。
- 删 `packages/mcp/tests/tools.test.ts`、`packages/mcp/tests/index.test.ts` 的 limited tools 用例。

### ⑥ 文档

- 删除 `docs/superpowers/specs/2026-05-21-forma-v6-03-cutover-normalization-design.md`。
- 删除 `docs/superpowers/specs/2026-05-21-forma-v6-01-preflight-normalization-design.md`。
- 更新其它引用迁移命令 / 启动门禁 / limited 模式之处：v6-02 / 04 / 05 / 10 specs、`README.md`、根 `CLAUDE.md`、`docs/AGENT.md`、`docs/MCP.md`、`docs/tech-debt.md`。更新方式为删除/改写相关段落，使其反映「不再有迁移机制、启动直接 strict 校验」的现状。

## 保留清单（明确不碰）

- `validateStrictStoreReadModels` —— v6 strict 读模型校验。
- `recoverPendingProductDeletes` —— 产品删除恢复。
- `normalizeKind` / `normalizeFormaExtension` —— artifact manifest 字段规范化。

## 行为变化对照

| 场景 | 改动前 | 改动后 |
|---|---|---|
| 启动遇到非 v6 格式数据 | 抛 `SchemaNormalizationStartupError` → 引导迁移；server/mcp 进 limited 模式 | strict 校验抛普通错误 → 启动直接失败 |
| `forma serve` / mcp 启动 | 捕获迁移错误后挂降级路由 / limited tools | 不捕获，错误直接冒泡 |
| 4 个迁移 CLI 命令 | 可用 | 移除（`Unknown command`） |
| `/api/recovery/schema-normalization*` | 可用 | 移除（404） |
| `.v6-schema-cutover-committed` 标记 | 启动前提条件 | 不再检查（残留无害） |

## 验证策略

- `pnpm build`、`pnpm typecheck`、`pnpm test` 全绿。
- 重点确认：
  - `createFormaStore` 在 v6 合规数据上正常构建并通过 strict 校验；
  - server `buildServer` / mcp `createFormaMcpServer` 启动路径在去掉 limited 分支后正常；
  - 删除迁移命令后 CLI 其余命令不受影响（`status` / `serve` / `install` 等）。
- 全仓 grep 确认无残留引用：`schema-normalization`、`SchemaNormalization`、`cutover`、`preflight`、`normalization-backups`、被删的 4 个 CLI 命令名。

## 风险与缓解

- **风险**：误删与迁移同名但无关的代码（`normalizeKind` / `normalizeFormaExtension` / `recoverPendingProductDeletes`）。
  **缓解**：保留清单 + typecheck + 测试覆盖。
- **风险**：删启动门禁牵动约 12 个测试的 setup，遗漏会导致编译或运行失败。
  **缓解**：单批原子改动，最后统一跑全量测试；grep 兜底确认无残留符号引用。
- **风险**：旧数据用户升级到此版本后启动直接报错且无迁移路径。
  **缓解**：这是预期且已确认的取舍（v6 未发布、无存量数据）；错误信息由 strict 校验给出。
