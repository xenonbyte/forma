# 移除 v6 Schema 迁移 / 兼容子系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除整套 v6 schema 迁移/兼容机制（dry-run / cutover / recovery / backup / journal / 启动门禁 / server·mcp limited 降级模式），保留 v6 strict 读模型校验，使代码以最新 v6 schema 为唯一事实来源。

**Architecture:** 自下游使用者向上删除以保持每步可编译可测：先删 cli → server → mcp 的迁移使用与测试，再删 core 启动门禁，最后删 core 迁移模块与 `export *`，随后清理测试残留标记并更新文档。删除面已通过安全核查（见 spec「移除前安全核查」节）：导出符号全为迁移专属、使用者集合闭合于 store/cli/server/mcp、保留清单三者独立、generate 与前端无耦合。

**Tech Stack:** TypeScript（pnpm monorepo）、Vitest、Fastify、MCP stdio server。

**Spec:** `docs/superpowers/specs/2026-06-05-remove-v6-schema-migration-design.md`

---

## File Structure

删除/修改的文件及职责：

| 文件 | 动作 | 职责（删除后） |
|---|---|---|
| `packages/core/src/schema-normalization.ts` | **删除** | — |
| `packages/core/src/index.ts` | 改 | 移除 `export *` 迁移行 |
| `packages/core/src/store.ts` | 改 | 移除启动门禁与 import，保留 `validateStrictStoreReadModels` |
| `packages/cli/src/index.ts` | 改 | 移除 4 个迁移命令、run 函数、`parseNormalizationArgs`、usage、import |
| `packages/server/src/routes.ts` | 改 | 移除 4 个 limited/recovery 函数与 import，保留 `normalizeKind`/`normalizeFormaExtension` |
| `packages/server/src/app.ts` | 改 | 移除 `limitedState` 链路与 import，保留 `recoverPendingProductDeletes` |
| `packages/mcp/src/index.ts` | 改 | 简化启动 try/catch，移除迁移 import |
| `packages/mcp/src/tools.ts` | 改 | 移除 `registerLimitedFormaTools`、`normalizationBlockedResult`、type import |
| `packages/*/tests/*.test.ts` | 改 | 删迁移用例，清理冗余 committed marker setup |
| `docs/...`、`design-version/DESIGN-v6.md`、`README.md`、`CLAUDE.md` 等 | 改/删 | 删迁移专属 spec，更新引用 |

---

## Commit Safety Protocol

- [ ] **Before Task 1: 确认工作树安全**

Run: `git status --short`
Expected: 无无关本地改动。若已有无关 dirty 文件，先停止并请用户 commit/stash/restore，避免后续分批 commit 混入非本计划改动。

- [ ] **Before any commit step: 确认本次允许提交**

Commit 步骤只在当前用户请求明确允许本次执行创建 commit 时运行。若用户没有要求 commit，执行到验证通过后停止，不运行 `git add` / `git commit`，并把 changed paths 与验证结果交还给用户。

- [ ] **Before every `git add` / `git rm`: 复查未暂存工作树**

Run: `git status --short`
Expected: 只出现当前 Task 将要修改/删除的路径。若出现无关路径，停止并请用户处理；不要把无关改动混入当前 Task。

- [ ] **Before every `git commit`: 核对暂存清单**

每次执行 `git add` / `git rm` 后、`git commit` 前运行：

```bash
git diff --cached --name-only
```

Expected: 输出只包含当前 Task 的 `Files:` 清单及该 Task 明确列出的文档/测试路径。若出现无关路径，停止并取消暂存无关文件后再继续。

---

## Task 1: 删除 CLI 迁移命令

**Files:**
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/tests/cli.test.ts`

- [ ] **Step 1: 删除 import 中的迁移符号**

将 `packages/cli/src/index.ts` 顶部的 core import（约 line 8-19）由：

```ts
import {
  InstallService,
  formaCoreVersion,
  normalizeFormaHomeForV6,
  recoverV6NormalizationJournal,
  readYaml,
  restoreV6NormalizationBackup,
  type AgentInstallPlatform,
  type FormaMcpCommand,
  type InstallManifest,
  type InstallServiceOptions,
} from "@xenonbyte/forma-core";
```

改为：

```ts
import {
  InstallService,
  formaCoreVersion,
  readYaml,
  type AgentInstallPlatform,
  type FormaMcpCommand,
  type InstallManifest,
  type InstallServiceOptions,
} from "@xenonbyte/forma-core";
```

- [ ] **Step 2: 删除 4 个命令分支**

删除 `runCli` 中的这 4 个分支（约 line 162-176）：

```ts
    if (command === "schema-normalization-dry-run") {
      return await runSchemaNormalizationDryRun(args, runtimeEnv, output);
    }

    if (command === "v6-schema-cutover") {
      return await runV6SchemaCutoverCommand(args, runtimeEnv, output);
    }

    if (command === "recover-v6-normalization-journal") {
      return await runRecoverV6NormalizationJournal(args, runtimeEnv, output);
    }

    if (command === "restore-v6-normalization-backup") {
      return await runRestoreV6NormalizationBackup(args, runtimeEnv, output);
    }
```

- [ ] **Step 3: 删除 4 个 run 函数与 parseNormalizationArgs**

删除以下函数定义（整段连续，约 line 295-342 + 532-568）：
- `runSchemaNormalizationDryRun`
- `runV6SchemaCutoverCommand`
- `runRecoverV6NormalizationJournal`
- `runRestoreV6NormalizationBackup`
- `parseNormalizationArgs`

- [ ] **Step 4: 删除 usage 文本中的 4 行**

在 `usage()` 返回的命令清单中删除（约 line 889-892）：

```ts
    "  schema-normalization-dry-run [--home path]",
    "  v6-schema-cutover [--home path] [--preflight-report path]",
    "  recover-v6-normalization-journal [--home path] --backup-dir path",
    "  restore-v6-normalization-backup [--home path] --backup-dir path --confirm restore_v6_backup",
```

- [ ] **Step 5: 删除测试中的迁移用例与 helper**

在 `packages/cli/tests/cli.test.ts`：
- 删除标题含以下关键字的全部 `it` 块（共 7 个，约 line 68-230）：`schema-normalization-dry-run`、`v6-schema-cutover`、`recover-v6-normalization-journal`、`restore-v6-normalization-backup`。
- 删除仅被这些用例使用的 helper `seedLegacyRuntime`（约 line 833 起的 `async function seedLegacyRuntime`）。
- 删除 import 中的 `readYamlUnknown`（line 8，仅迁移用例使用）。

- [ ] **Step 6: 运行 CLI 测试确认通过**

Run: `pnpm exec vitest run packages/cli/tests/cli.test.ts`
Expected: PASS（迁移用例已移除，serve/install/status/version 等用例全绿）

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/tests/cli.test.ts
git commit -m "refactor(cli): remove v6 schema migration commands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 删除 server limited / recovery 模式

**Files:**
- Modify: `packages/server/src/routes.ts`, `packages/server/src/app.ts`
- Test: `packages/server/tests/routes.test.ts`

- [ ] **Step 1: 删除 routes.ts 的迁移 import**

在 `packages/server/src/routes.ts` 的 core import（line 5-31）中删除这 4 个标识符：`recoverV6NormalizationJournal`（line 6）、`restoreV6NormalizationBackup`（line 7）、`SchemaNormalizationRecoveryError`（line 8）、`type SchemaNormalizationRecoveryState`（line 30）。**保留** `normalizeKind`、`normalizeFormaExtension` 及其余全部。

- [ ] **Step 2: 删除 routes.ts 的 4 个迁移函数**

删除以下连续函数（约 line 155-197）：

```ts
export function registerPreflightOnlyRoutes(app: FastifyInstance, state: SchemaNormalizationRecoveryState): void {
  ...
}

export function registerRecoveryOnlyRoutes(app: FastifyInstance, state: SchemaNormalizationRecoveryState): void {
  ...
}

export function sendNormalizationBlocked(reply: FastifyReply, state: SchemaNormalizationRecoveryState): void {
  ...
}

function recoveryInputError(error: unknown): RouteHttpError {
  ...
}
```

- [ ] **Step 3: 删除 app.ts 的迁移 import**

在 `packages/server/src/app.ts`：
- core import（line 6-11）删除 `isSchemaNormalizationStartupError`（line 9）、`type SchemaNormalizationRecoveryState`（line 10）。
- routes import（line 12-19）删除 `registerPreflightOnlyRoutes`（line 13）、`registerRecoveryOnlyRoutes`（line 14）、`sendNormalizationBlocked`（line 17）。

- [ ] **Step 4: 简化 createFormaStore 调用（去掉 limited 捕获）**

将 `buildServer` 中（约 line 45-59）：

```ts
  let store: FormaServerStore | undefined = options.store;
  let limitedState: SchemaNormalizationRecoveryState | undefined;
  if (!store) {
    try {
      store = await createFormaStore({
        home: options.home ?? defaultFormaHome(),
        bundledStylesDir: options.bundledStylesDir,
      });
    } catch (error) {
      if (!isSchemaNormalizationStartupError(error)) {
        throw error;
      }
      limitedState = error.state;
    }
  }
```

改为：

```ts
  let store: FormaServerStore | undefined = options.store;
  if (!store) {
    store = await createFormaStore({
      home: options.home ?? defaultFormaHome(),
      bundledStylesDir: options.bundledStylesDir,
    });
  }
```

- [ ] **Step 5: 删除 notFoundHandler 的 limited 分支**

在 `app.setNotFoundHandler` 内删除（约 line 67-71）：

```ts
    if (limitedState && isApiRequest(request.url)) {
      sendNormalizationBlocked(reply, limitedState);
      return;
    }

```

- [ ] **Step 6: 删除 limited 路由注册块**

在 `registerRoutes` 调用之前删除（约 line 93-100）：

```ts
  if (limitedState) {
    if (limitedState.mode === "recovery_only") {
      registerRecoveryOnlyRoutes(app, limitedState);
    } else {
      registerPreflightOnlyRoutes(app, limitedState);
    }
    return app;
  }

```

保留其后的 `if (!store) { throw new Error("Forma store was not initialized"); }`（TS 类型收窄需要）。

- [ ] **Step 7: 删除测试中的 limited startup describe**

在 `packages/server/tests/routes.test.ts` 删除整个 `describe("schema normalization limited startup", ...)` 块（约 line 250-357，结束于下一个 `describe("Fastify API routes")` 之前）。

> 注：`markNormalizationCommitted` helper 及其在 line 193/1338 的调用此步**保留**（此时 core 门禁尚在，非迁移用例仍需 committed marker）；将在 Task 6 清理。

- [ ] **Step 8: 运行 server 测试确认通过**

Run: `pnpm exec vitest run packages/server/tests/routes.test.ts`
Expected: PASS（limited startup 用例已移除，其余路由用例全绿）

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/routes.ts packages/server/src/app.ts packages/server/tests/routes.test.ts
git commit -m "refactor(server): remove schema normalization limited/recovery modes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 删除 mcp limited tools

**Files:**
- Modify: `packages/mcp/src/index.ts`, `packages/mcp/src/tools.ts`
- Test: `packages/mcp/tests/index.test.ts`, `packages/mcp/tests/tools.test.ts`

- [ ] **Step 1: 简化 index.ts 启动并删除迁移 import**

在 `packages/mcp/src/index.ts`：

将 import（line 5-6）：

```ts
import { createFormaStore, formaCoreVersion, isSchemaNormalizationStartupError } from "@xenonbyte/forma-core";
import { createFormaTools, registerFormaTools, registerLimitedFormaTools } from "./tools.js";
```

改为：

```ts
import { createFormaStore, formaCoreVersion } from "@xenonbyte/forma-core";
import { createFormaTools, registerFormaTools } from "./tools.js";
```

将 `createFormaMcpServer` 中的 try/catch（约 line 32-45）：

```ts
  let store;
  try {
    store = await createFormaStore({
      home,
      bundledStylesDir: options.bundledStylesDir,
    });
  } catch (error) {
    if (!isSchemaNormalizationStartupError(error)) {
      throw error;
    }
    const server = new McpServer({ name: "forma", version: formaCoreVersion });
    registerLimitedFormaTools(server, error.state);
    return server;
  }
```

改为：

```ts
  const store = await createFormaStore({
    home,
    bundledStylesDir: options.bundledStylesDir,
  });
```

- [ ] **Step 2: 删除 tools.ts 的迁移代码**

在 `packages/mcp/src/tools.ts`：
- import（line 4-22）删除 `type SchemaNormalizationRecoveryState`（line 21）。**保留** `normalizeFormaExtension`、`normalizeKind`。
- 删除 `registerLimitedFormaTools` 函数（约 line 506-528）。
- 删除 `normalizationBlockedResult` 函数（约 line 1075-1090）。

- [ ] **Step 3: 删除 MCP limited 测试覆盖**

在 `packages/mcp/tests/index.test.ts`：
- 删除 hoisted mock 中的 `readSchemaNormalizationRecoveryState: vi.fn(),`（line 5）。
- 在 `vi.mock("@xenonbyte/forma-core", ...)` 中删除 `class SchemaNormalizationStartupError`（line 26-34）、返回对象里的 `SchemaNormalizationStartupError,`（line 38）、`isSchemaNormalizationStartupError: ...`（line 44）、`readSchemaNormalizationRecoveryState: mocks.readSchemaNormalizationRecoveryState,`（line 45）。
- 删除 `describe("MCP server startup")` 的 `beforeEach` 中的 `mocks.readSchemaNormalizationRecoveryState.mockResolvedValue({ ... });`（line 131-139）。
- 删除整个 `it("registers limited status and blocked tool handlers when schema normalization preflight blocks startup", ...)` 用例（line 233 起，至其闭合 `});`）。

在 `packages/mcp/tests/tools.test.ts`：
- 检查是否存在 direct limited tools 覆盖：
  ```bash
  rg -n "registerLimitedFormaTools|normalizationBlockedResult|schema normalization.*limited|limited.*schema normalization" packages/mcp/tests/tools.test.ts
  ```
- 当前预期：无 direct limited tools 用例；若实现时出现命中，随本 Task 删除对应用例、mock/helper，并保留与 `recoverPendingProductDeletes`、`normalizeKind`、`normalizeFormaExtension` 无关的正常工具用例。
- 不在本 Task 清理 `.v6-schema-cutover-committed` marker；core 启动门禁尚未删除，marker 清理由 Task 6 统一处理。

- [ ] **Step 4: 运行 mcp 测试确认通过**

Run: `pnpm exec vitest run packages/mcp/tests/index.test.ts packages/mcp/tests/tools.test.ts`
Expected: PASS（limited 启动/工具覆盖已移除或确认不存在；delete-recovery、工具 schema 与正常 handler 用例全绿）

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/index.ts packages/mcp/src/tools.ts packages/mcp/tests/index.test.ts packages/mcp/tests/tools.test.ts
git commit -m "refactor(mcp): remove schema normalization limited tools

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 删除 core 启动门禁

**Files:**
- Modify: `packages/core/src/store.ts`
- Test: `packages/core/tests/store-startup-validation.test.ts`

- [ ] **Step 1: 删除 store.ts 的迁移 import**

删除 `packages/core/src/store.ts` line 26：

```ts
import { readSchemaNormalizationRecoveryState, SchemaNormalizationStartupError } from "./schema-normalization.js";
```

- [ ] **Step 2: 删除启动门禁**

将 `createFormaStore` 中（约 line 111-115）：

```ts
  const normalization = await readSchemaNormalizationRecoveryState(options.home);
  if (normalization.mode !== "normal") {
    throw new SchemaNormalizationStartupError(normalization);
  }
  const store = createStrictFormaStore({ ...options, productMutationLock });
```

改为：

```ts
  const store = createStrictFormaStore({ ...options, productMutationLock });
```

- [ ] **Step 3: 更新指向迁移的注释**

将 `validateStrictStoreReadModels` 上方注释（约 line 308-314）：

```ts
// Strict-by-default startup contract: the store refuses to come up if ANY
// product's read models (product.yaml, requirement history, copy translations)
// fail to load. This is intentional — it surfaces on-disk corruption loudly
// rather than serving partial/inconsistent data, and it is paired with the
// schema-normalization recovery path (see readSchemaNormalizationRecoveryState)
// for migrating legacy layouts. We do NOT degrade to "skip the bad product"
// here; changing that is a deliberate product decision, not a bug fix.
```

改为：

```ts
// Strict-by-default startup contract: the store refuses to come up if ANY
// product's read models (product.yaml, requirement history, copy translations)
// fail to load. This is intentional — it surfaces on-disk corruption (including
// any non-v6 legacy layout) loudly rather than serving partial/inconsistent
// data. We do NOT degrade to "skip the bad product" here; changing that is a
// deliberate product decision, not a bug fix.
```

- [ ] **Step 4: 清理 startup 测试的冗余 committed marker**

在 `packages/core/tests/store-startup-validation.test.ts`：
- 删除 helper `markNormalizationCommitted`（line 7-9）。
- 删除两处 `await markNormalizationCommitted(home);`（line 14、line 38）。

两个 `it` 用例（corrupt → fail loud / intact → 正常启动）**保留不动**——删门禁后它们直接验证 strict 校验行为。

- [ ] **Step 5: 运行 startup 测试确认 fail-loud 行为不变**

Run: `pnpm exec vitest run packages/core/tests/store-startup-validation.test.ts`
Expected: PASS（corrupt 产品仍抛 `FormaError` 并带 `product_id`；intact 正常启动）

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store.ts packages/core/tests/store-startup-validation.test.ts
git commit -m "refactor(core): drop schema normalization startup gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 删除 core 迁移模块

**Files:**
- Delete: `packages/core/src/schema-normalization.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 删除迁移模块文件**

```bash
git rm packages/core/src/schema-normalization.ts
```

- [ ] **Step 2: 删除 index.ts 的 re-export**

删除 `packages/core/src/index.ts` line 19：

```ts
export * from "./schema-normalization.js";
```

- [ ] **Step 3: 构建 + 类型检查（验证无残留 import）**

Run: `pnpm build && pnpm typecheck`
Expected: PASS（若任何包仍引用迁移符号，此处会报 TS2305/找不到导出——回到对应 Task 修复）

- [ ] **Step 4: 全量测试**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "refactor(core): delete schema-normalization module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 清理测试中残留的 committed marker

> 删门禁后这些 `.v6-schema-cutover-committed` 标记纯属冗余，且会被最终 grep 命中。逐文件删除写标记的行；这些测试本就准备 v6 合规数据，删标记后 `createFormaStore` 仍通过 strict 校验。

**Files:**
- Test: 见下列各文件

- [ ] **Step 1: 清理 core 测试的 committed marker**

在以下文件中删除写 `.v6-schema-cutover-committed` 的语句（通常是各文件顶部 setup helper 内的一行 `writeFile`/`writeFileSync`，若该行是 helper 唯一语句则连 helper 一并删并移除其调用）：
- `packages/core/tests/product-design-pointer.test.ts:9`
- `packages/core/tests/backfill-design-artifacts.test.ts:36`
- `packages/core/tests/design-context.test.ts:9`
- `packages/core/tests/product-session-style.test.ts:145`
- `packages/core/tests/product-config.test.ts:11`
- `packages/core/tests/design-save.test.ts:21`
- `packages/core/tests/store-design-mutations.test.ts:21`
- `packages/core/tests/artifact-tmp-cleanup.test.ts:123`（`writeFileSync`）

- [ ] **Step 2: 清理 server 测试的 committed marker**

在 `packages/server/tests/routes.test.ts`：删除 helper `markNormalizationCommitted`（line 241-243）及其全部调用（line 193、line 1338）。

- [ ] **Step 3: 清理 mcp 测试的 committed marker**

在 `packages/mcp/tests/tools.test.ts`：删除写 `.v6-schema-cutover-committed` 的两行（line 567、line 3127）。

- [ ] **Step 4: 全量测试确认仍全绿**

Run: `pnpm test`
Expected: PASS（所有 store 仍能在无 marker 情况下通过 strict 校验启动）

- [ ] **Step 5: Commit**

```bash
git add \
  packages/core/tests/product-design-pointer.test.ts \
  packages/core/tests/backfill-design-artifacts.test.ts \
  packages/core/tests/design-context.test.ts \
  packages/core/tests/product-session-style.test.ts \
  packages/core/tests/product-config.test.ts \
  packages/core/tests/design-save.test.ts \
  packages/core/tests/store-design-mutations.test.ts \
  packages/core/tests/artifact-tmp-cleanup.test.ts \
  packages/server/tests/routes.test.ts \
  packages/mcp/tests/tools.test.ts
git commit -m "test: drop obsolete v6 cutover committed markers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 更新文档

**Files:**
- Delete: 两个迁移专属 spec
- Modify: 其余引用文档

- [ ] **Step 1: 删除迁移专属 spec**

```bash
git rm docs/superpowers/specs/2026-05-21-forma-v6-03-cutover-normalization-design.md
git rm docs/superpowers/specs/2026-05-21-forma-v6-01-preflight-normalization-design.md
```

- [ ] **Step 2: 更新活文档中的迁移引用**

逐个打开并改写/删除以下文件中描述「迁移命令 / 启动门禁 / limited 模式」的段落，使其反映「不再有迁移机制、启动直接 strict 校验、非 v6 数据 fail loud」：
- `README.md`
- `CLAUDE.md`（根）
- `design-version/DESIGN-v6.md`（删除或 supersede schema-normalization/cutover/preflight/recovery-only 设计段落；保留与本删除目标无关的 v6 设计内容）
- `docs/AGENT.md`
- `docs/MCP.md`
- `docs/tech-debt.md`
- `packages/desktop/VERIFICATION.md`（删除「5 pre-existing failures … v6-schema-cutover」一段）

- [ ] **Step 3: 更新引用迁移的 v6 spec**

在以下 spec 中删除/标注迁移相关内容（这些是设计快照，按需最小改写或加 superseded 注记，指向本删除 spec）：
- `docs/superpowers/specs/2026-05-21-forma-v6-index-design.md`
- `docs/superpowers/specs/2026-05-21-forma-v6-02-async-startup-design.md`
- `docs/superpowers/specs/2026-05-21-forma-v6-04-legacy-surface-removal-design.md`
- `docs/superpowers/specs/2026-05-21-forma-v6-05-strict-schema-read-model-design.md`
- `docs/superpowers/specs/2026-05-21-forma-v6-08-mcp-tools-design.md`
- `docs/superpowers/specs/2026-05-21-forma-v6-10-server-web-routes-design.md`
- `docs/superpowers/specs/2026-05-21-forma-v6-11-ui-canvas-design.md`（仅 `recovery/preflight pages`，**勿动** `component refresh preflight result`）
- `docs/superpowers/specs/2026-05-21-forma-v6-12-verification-design.md`

> **勿改（误命中）**：`v6-06` 的 `.pencil-preflight` Pencil 探针、`v6-09` 的 agent 设计会话 preflight。
> **勿改（历史）**：`plans/` 目录下的实现快照。

- [ ] **Step 4: Commit**

```bash
git add \
  README.md \
  CLAUDE.md \
  design-version/DESIGN-v6.md \
  docs/AGENT.md \
  docs/MCP.md \
  docs/tech-debt.md \
  packages/desktop/VERIFICATION.md \
  docs/superpowers/specs/2026-05-21-forma-v6-03-cutover-normalization-design.md \
  docs/superpowers/specs/2026-05-21-forma-v6-01-preflight-normalization-design.md \
  docs/superpowers/specs/2026-05-21-forma-v6-index-design.md \
  docs/superpowers/specs/2026-05-21-forma-v6-02-async-startup-design.md \
  docs/superpowers/specs/2026-05-21-forma-v6-04-legacy-surface-removal-design.md \
  docs/superpowers/specs/2026-05-21-forma-v6-05-strict-schema-read-model-design.md \
  docs/superpowers/specs/2026-05-21-forma-v6-08-mcp-tools-design.md \
  docs/superpowers/specs/2026-05-21-forma-v6-10-server-web-routes-design.md \
  docs/superpowers/specs/2026-05-21-forma-v6-11-ui-canvas-design.md \
  docs/superpowers/specs/2026-05-21-forma-v6-12-verification-design.md
git commit -m "docs: drop v6 schema migration references

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 最终验证

- [ ] **Step 1: 全仓 grep 确认无残留迁移引用**

Run:
```bash
git grep -nE "schema-normalization|SchemaNormalization|SCHEMA_NORMALIZATION|v6-schema-cutover|recover-v6-normalization-journal|restore-v6-normalization-backup|normalization-preflight|normalization-backups|normalization_report|\.v6-schema-cutover" -- ':!docs/superpowers/plans/*' ':!docs/superpowers/specs/2026-06-05-remove-v6-schema-migration-design.md'
```
Expected: 无输出（plans 历史快照与本删除 spec/plan 自身允许出现）。若有命中，回到对应 Task 清理。

- [ ] **Step 2: 全量 build / typecheck / test**

Run: `pnpm build && pnpm typecheck && pnpm test`
Expected: 全部 PASS

- [ ] **Step 3: 冒烟核验保留功能**

确认以下符号仍存在且被正常使用（grep 应有命中）：
```bash
git grep -n "validateStrictStoreReadModels" -- packages/core/src/store.ts
git grep -n "recoverPendingProductDeletes" -- packages/core/src packages/server/src packages/mcp/src
git grep -n "normalizeKind" -- packages/core/src packages/server/src packages/mcp/src
git grep -n "normalizeFormaExtension" -- packages/core/src packages/server/src packages/mcp/src
```
Expected: 每条命令均在源代码路径中有命中（保留清单未被误删，且不会只靠文档/plan/spec 文本误通过）。

- [ ] **Step 4: 标记 spec 状态为已实现**

将 `docs/superpowers/specs/2026-06-05-remove-v6-schema-migration-design.md` 状态行改为 `已实现`，commit：

```bash
git add docs/superpowers/specs/2026-06-05-remove-v6-schema-migration-design.md
git commit -m "docs: mark removal spec implemented

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage（逐节核对）：**
- core 删模块/门禁/index export → Task 4、5 ✅
- cli 4 命令/run/parseNormalizationArgs/usage → Task 1 ✅
- server routes 4 函数 + app.ts limited 链路 → Task 2 ✅
- mcp index/tools limited → Task 3 ✅
- 测试（startup 用例保留、迁移用例删除、MCP tools 覆盖核查、committed marker 清理）→ Task 1/2/3/4/6 ✅
- 文档（删 01/03、更新 index/02/04/05/08/10/11/12 + README/CLAUDE.md/AGENT/MCP/tech-debt + design-version/DESIGN-v6.md + desktop/VERIFICATION）→ Task 7 ✅
- 保留清单（strict 校验、产品删除恢复、normalizeKind/normalizeFormaExtension）→ Task 8 Step 3 冒烟核验 ✅
- 验证策略（build/typecheck/test + grep 正则）→ Task 5/8 ✅

**Placeholder scan：** 无 TBD/TODO；所有代码改动给出完整 old/new；删除块给出唯一定位（签名/标题/行号）。

**Type consistency：** 删除的符号名（`registerPreflightOnlyRoutes`/`registerRecoveryOnlyRoutes`/`sendNormalizationBlocked`/`recoveryInputError`/`registerLimitedFormaTools`/`normalizationBlockedResult`/`readSchemaNormalizationRecoveryState`/`SchemaNormalizationStartupError`）与各 Task 引用一致；保留符号（`validateStrictStoreReadModels`/`recoverPendingProductDeletes`/`normalizeKind`/`normalizeFormaExtension`/`createStrictFormaStore`）全程未被删除步骤触及。
