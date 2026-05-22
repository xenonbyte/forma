# DESIGN v7：Pencil 前台可见画布与会话源收敛

## 背景

v6 已经把设计绘制收敛到 app-bound session，并通过 session-owned staging `.pen`、受控保存、commit journal 和 guard 校验避免后台静默写正式画布。

当前仍存在一个运行时问题：在用户已经打开某个已有 `.pen` 画布的情况下，Forma 调用 `pencil interactive --app desktop --in <staging.pen>` 后，桌面 Pencil 不一定切到 `<staging.pen>`。实测 live smoke 失败在 `staging_document_check`：

```text
PENCIL_APP_REQUIRED
Pencil App session did not open the requested staging file
failed_phase: staging_document_check
```

这个失败是正确的 fail-closed：guard 没有出现在当前 active editor 中，说明继续写入会有误操作风险，所以必须阻断。但用户看到的现象是 Pencil 仍停在原来画布上，`staging.pen` 没有前台可见，设计流程不可用。

da-vinci `v1.4.4` 的相关处理方式不是信任某个打开命令，而是强制源收敛：

1. `pencil-session.js` 的 `assertSessionBeginsFromRegisteredPen()` 要求 session 目标必须是注册的 project-local `.pen`。
2. `save-current-design.js` 的 `validateBoundDesignSource()` 要求 registered pen、session pen、active editor 三者解析后是同一个 `.pen`。
3. `mcp-runtime-gate.js` 的 `evaluateSourceConvergence()` 在 active editor 与 registered `.pen` 不一致时返回 BLOCK。

Forma v7 采用同一原则：**任何会编辑设计稿的 session，Pencil 前台 active editor 必须收敛到该 session 的 staging `.pen`；不收敛时阻断，不允许写用户原来打开的画布。**

## 目标

1. 所有设计编辑 session 开始后，桌面 Pencil 必须前台可见，并展示本次 session 的 staging 画布。
2. `component` 生成、`requirement` 设计生成、refine、rebuild 和后续设计修改，都只能写 session-owned staging `.pen`。
3. `pencil interactive --app desktop --in <staging.pen>` 不能单独作为“已打开正确画布”的依据；必须通过 active editor 收敛校验。
4. 如果 Pencil 没有切到目标 staging，流程必须 fail-closed，不能写入用户原来打开的 `.pen`。
5. 缺产品组件库时，`beginRequirementDesignSession` 必须先返回 `required_action: generate_components`，不得先打开 Pencil 或 probe 画布。
6. 用户完成组件生成后，再开始需求页面设计时，前台 Pencil 必须从组件 staging 切换到需求 staging。
7. v7 不引入 headless 绘制 fallback；无 Pencil App 或前台打开失败时，不创建、修改、保存或提交设计稿。
8. 所有失败都必须带稳定 `failed_phase`、目标 `staging_path` 和可诊断 reason，方便 MCP/CLI/UI 给出明确提示。

## 非目标

- 不改变 v6 的 requirement-level `design.pen` 和 product-level component library 数据模型。
- 不删除现有 guard 校验；v7 是在 guard 之前增加前台打开与收敛流程。
- 不通过 Pencil MCP 工具实现运行时代码；运行时代码只能使用本地 CLI/系统能力。
- 不自动关闭用户原来打开的 Pencil 文档。
- 不在 mismatch 时尝试把当前 active editor 内容迁移到 staging。
- 不允许 agent 通过 `filePath`、`path`、`staging_path` 等参数覆盖 session-owned 文件边界。

## 根因

根因是 `PencilAppSessionAdapter` 把 `pencil interactive --app desktop --in <staging.pen>` 当作 app-bound session 的打开动作，但该命令不能保证桌面 Pencil 前台 active editor 已切换到 `<staging.pen>`。

现有 guard 证明了这个问题：当 active editor 仍是用户之前打开的 `.pen` 时，`batch_get` 读取不到 staging 中插入的 `formaSessionGuard*`，于是 `staging_document_check` 失败。

因此修复不能只是“忽略 guard”或“增加重试保存”。正确修复是先让目标 staging 在 Pencil 前台打开，再用 guard 验证 active editor 确实是目标 staging。

## 设计原则

1. **显式打开，不猜测。** session 开始时必须显式请求 Pencil 前台打开目标 staging。
2. **验证优先，不信任命令返回。** `open` 或 `interactive --in` 返回成功不代表 active editor 正确；必须读 guard。
3. **只写 session staging。** 所有 batch design、set variables 和 save 都只能通过已绑定的 session process 执行。
4. **失败可见。** 前台打开失败、active editor mismatch、guard 删除失败都必须暴露为不同 phase。
5. **无静默 fallback。** 不能在 foreground open 失败后退回 hidden/headless 修改。
6. **不扰动无关流程。** 缺组件、schema 校验失败、active lease 冲突等前置错误不得打开 Pencil。

## 整合策略

v7 必须作为一个完整行为变更落地，不能先提交“只有 guard、没有前台打开”的半步补丁。

半步 guard 补丁只能证明不会误写旧画布，但不能满足“设计稿在编辑时必须在前台 Pencil 可见并展示编辑画布”的目标；在已有 `.pen` 打开的真实场景中，它会更早 fail-closed，却仍然让用户看到旧画布。因此 guard 只能作为 v7 active editor 收敛校验的一部分，与 foreground open、preflight 拆分和缺组件前置检查一起提交。

实施时按以下边界整合：

1. `PencilAppSessionAdapter.preflight()` 只保留 capability preflight，不再创建或打开 probe `.pen`。
2. `openSession()` 负责真实 session 的 foreground open 和 guard 收敛校验。
3. 缺组件、锁冲突、schema 错误等前置失败不得调用 foreground open。
4. guard helper、fake process guard response、active-editor-mismatch 测试都在 v7 implementation 中重新引入，不作为独立提交保留。
5. live smoke 必须验证用户原先打开的 `.pen` 不被写入，并且 Pencil 前台先后展示组件 staging 和需求 staging。

## 目标流程

### 缺组件时的 requirement 入口

`beginRequirementDesignSession` 的顺序固定为：

1. 解析 `home`、`product_id`、`requirement_id`。
2. 读取产品组件库元数据。
3. 如果组件库不是 `complete`，直接抛出 `componentLibraryError()`，details 保持 `required_action: generate_components`。
4. 组件库 complete 后，才执行 Pencil capability preflight。
5. 创建 requirement session staging。
6. 调用 app-bound open，前台打开 staging 并完成收敛校验。

这样“先没检测到产品组件”的场景不会碰用户当前打开的 Pencil 画布。

### 组件生成入口

`beginProductComponentSession` 的顺序固定为：

1. 校验 `seed_components` 和 `newly_required_component_keys`。
2. 读取 component version plan。
3. 创建 `staging.lib.pen`。
4. 前台打开 `staging.lib.pen`。
5. 校验 active editor 收敛到 `staging.lib.pen`。
6. 写入 component session record。

用户在 Pencil 前台看到的是组件库 staging 画布。

### 需求设计入口

组件库 commit 完成后再次调用 `beginRequirementDesignSession`：

1. 组件库状态为 complete。
2. 创建 `staging.design.pen`。
3. 前台打开 `staging.design.pen`。
4. 校验 active editor 收敛到 `staging.design.pen`。
5. 写入 requirement session record。

用户在 Pencil 前台看到的是需求设计 staging 画布，不再停留在旧 canvas 或刚才的组件 staging。

## Pencil 前台打开机制

新增一个内部 helper，命名为 `openPencilDocumentInForeground(stagingPath)`。

macOS 运行时使用：

```text
open -a Pencil <stagingPath>
```

约束：

1. `stagingPath` 必须先 `realpath()`，且必须位于 session 目录内。
2. 只允许打开当前 session 的 staging `.pen`。
3. `open` 命令失败或超时，抛出：

   ```yaml
   code: PENCIL_APP_REQUIRED
   failed_phase: foreground_open
   staging_path: <real staging path>
   command: open -a Pencil <stagingPath>
   ```

4. 非 macOS 环境直接返回同一错误，不允许 headless fallback。
5. `open` 成功后仍然不能视为已绑定成功，必须进入 active editor 收敛校验。

## Active Editor 收敛校验

收敛校验沿用现有 guard 思路，但作为 v7 的硬门禁。

`PencilAppSessionAdapter.openSession()` 固定流程：

1. `realpath(input.staging_path)`。
2. 在 staging `.pen` 插入临时 guard node：

   ```text
   formaSessionGuard<random>
   ```

3. 调用 `openPencilDocumentInForeground(stagingPath)`。
4. 启动 app-bound interactive process：

   ```text
   pencil interactive --app desktop --in <stagingPath>
   ```

5. 读取 editor schema：

   ```text
   get_editor_state({"include_schema":true})
   ```

6. 读取 guard：

   ```text
   batch_get({"nodeIds":["<guard_id>"],"readDepth":0})
   ```

7. 如果读取不到 guard，关闭当前 process，等待短间隔后重试步骤 3-6。
8. 超过最大尝试次数仍读取不到 guard，抛出：

   ```yaml
   code: PENCIL_APP_REQUIRED
   failed_phase: staging_document_check
   staging_path: <real staging path>
   guard_id: <guard id>
   ```

9. 读取到 guard 后，删除 guard：

   ```text
   batch_design({"input":"D(\"<guard_id>\")"})
   ```

10. 再次 `batch_get` 确认 guard 已删除。
11. `save()`。
12. 删除 staging 文件内残留 guard。
13. 注册 binding，并只允许后续操作使用该 binding。

重试参数固定为：

```text
foreground_open_timeout_ms: 10000
staging_document_check_attempts: 8
staging_document_check_retry_delay_ms: 750
```

这些参数是产品运行时常量，必须导出并在测试中固定，避免行为漂移。

## Preflight 调整

v7 把 Pencil preflight 拆成两层：

### Capability preflight

只检查：

```text
pencil version
pencil status
pencil interactive --help
```

并校验所需能力：

```text
get_editor_state
get_guidelines
batch_get
batch_design
export_nodes
snapshot_layout
save
```

Capability preflight 不打开任何 `.pen`，也不创建 probe `.pen`。

### Session open verification

只有真实 session 的 `openSession()` 才打开 Pencil 文档并做 guard 收敛校验。

这样避免 preflight probe 抢占用户当前画布，也避免“缺组件”这种前置错误触发 Pencil UI 变化。

## 错误码与 phase

保留 `PENCIL_APP_REQUIRED` 作为外层 code，新增或固定以下 `failed_phase`：

```text
foreground_open
open_app
editor_state_schema
staging_document_check
session_check
```

含义：

- `foreground_open`：系统无法让 Pencil 前台打开目标 staging。
- `open_app`：app-bound interactive process 无法启动或启动后不存活。
- `editor_state_schema`：当前 Pencil 能力不可读或 schema 返回为空。
- `staging_document_check`：active editor 没有收敛到目标 staging，guard 不存在或无法删除。
- `session_check`：已存在 binding 不可用或 staging path 与 binding 不一致。

所有 begin failure record 必须写入：

```yaml
session_id: <session id>
status: failed_begin
error_code: PENCIL_APP_REQUIRED
failed_phase: <phase>
staging_path: <real staging path>
command: <command>
reason: <message>
cleanup_status: <rollback result>
```

## 并发与锁

v7 不改变现有锁模型：

1. product mutation lock 仍保护同产品下 requirement/component session 互斥。
2. pencil mutation lock 仍保护本机 Pencil 写操作互斥。
3. product-level active lease 仍是 `data/{product_id}/sessions/active-design-session.yaml`。
4. 如果 foreground open 或 guard 校验失败，begin 必须 rollback lease、staging 和 session dir。
5. rollback 后不得保留 active lease 指向失败 session。

## 测试计划

### Unit tests

1. `beginRequirementDesignSession` 在组件库 missing 时不调用 `PencilAppSessionAdapter.preflight()`、不调用 `processFactory()`、不创建 Pencil probe。
2. `PencilAppSessionAdapter.preflight()` 只调用 `version`、`status`、`interactive --help`，不创建 app-bound probe。
3. `openSession()` 在启动 app-bound process 前调用 foreground open。
4. `openSession()` foreground open 失败时返回 `failed_phase: foreground_open`，并清理 staging guard。
5. `openSession()` active editor 不含 guard 时重试；最终成功时 binding 生效。
6. `openSession()` 重试耗尽时返回 `failed_phase: staging_document_check`，并清理 staging guard。
7. 旧的“active Pencil document 不是 staging 时拒绝 session”测试保留。
8. 组件生成后再生成 requirement 的序列测试必须断言：
   - 缺组件时没有 opened path。
   - component session opened path 是 `staging.lib.pen`。
   - requirement session opened path 是 `staging.design.pen`。
   - 用户原来打开的 `.pen` 没被写入。

### Live smoke

新增 live smoke 命令：

```text
pnpm smoke:pencil:foreground
```

执行条件：

1. 本机已安装并登录 Pencil。
2. 运行前让用户手动打开一个非 Forma 的 `.pen`。
3. smoke 创建临时 `FORMA_HOME`。
4. 先调用 requirement begin，确认缺组件时不切换 Pencil。
5. 调用 component begin，确认 Pencil 前台切到 `staging.lib.pen`。
6. commit component。
7. 调用 requirement begin，确认 Pencil 前台切到 `staging.design.pen`。
8. 所有 session 结束后清理临时 home。

该 smoke 是 live integration，不进入普通 `pnpm test`。

## 实施顺序

1. 先调整 `beginRequirementDesignSession` 的前置顺序：组件库检查必须早于 Pencil preflight。
2. 拆分 `PencilAppSessionAdapter.preflight()`，移除 probe `.pen` app-bound 打开。
3. 在 `openSession()` 增加 foreground open helper。
4. 在 `openSession()` 增加 foreground open + guard check retry。
5. 补充 unit tests。
6. 新增 live smoke 脚本。
7. 用用户描述的序列做 live 验证：已有 `.pen` 打开时，缺组件不切画布；组件生成切到组件 staging；需求生成切到需求 staging。

## 验收标准

1. 用户打开任意已有 `.pen` 后，调用缺组件的 requirement begin，Pencil UI 不变化，返回 `required_action: generate_components`。
2. 调用 component begin 后，Pencil 前台显示 `staging.lib.pen`。
3. component commit 后调用 requirement begin，Pencil 前台显示 `staging.design.pen`。
4. 如果 Pencil 无法打开 staging，流程失败在 `foreground_open` 或 `staging_document_check`，不会写用户原来打开的 `.pen`。
5. `pnpm test packages/core/tests/pencil.test.ts packages/core/tests/design-session.test.ts` 通过。
6. `pnpm typecheck` 通过。
7. `pnpm smoke:pencil:foreground` 在本机 Pencil 环境通过。

## 与 da-vinci 的对应关系

da-vinci 的 registered `.pen` 是长期 live source；Forma 的 live editing source 是 session staging `.pen`，正式 source 是 commit 后的 `design.pen` 或 `{product_id}.lib.pen`。

对应关系：

```text
da-vinci registeredPenPath  -> Forma session staging_path
da-vinci sessionPenPath     -> Forma binding.staging_path
da-vinci activeEditorPath   -> Pencil active editor containing guard node
```

v7 不要求 Pencil 能直接报告 active editor path；只要 guard 只存在于 staging `.pen`，`batch_get` 能读到 guard 就等价证明 active editor 已收敛到 staging。

如果未来 Pencil `get_editor_state` 稳定返回 `filePath`，可以在 guard 之外再增加 path realpath 校验；但 v7 不依赖该字段，避免引入未确认能力。
