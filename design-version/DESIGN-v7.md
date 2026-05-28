# DESIGN v7：Pencil 前台可见画布与会话源收敛

## 背景

v6 已经把设计绘制收敛到 app-bound session，并通过 session-owned staging `.pen`、受控保存和 commit journal 避免后台直接写正式画布。但当前代码还没有可靠校验 Pencil active editor 是否就是 session staging，也没有保证目标 staging 在桌面 Pencil 前台可见。

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
- v7 新增 guard-based active editor 收敛校验；当前仓库没有可保留的运行时 guard 实现。
- 不通过 Pencil MCP 工具实现运行时代码；运行时代码只能使用本地 CLI/系统能力。
- 不自动关闭用户原来打开的 Pencil 文档。
- 不在 mismatch 时尝试把当前 active editor 内容迁移到 staging。
- 不允许 agent 通过 `filePath`、`path`、`staging_path` 等参数覆盖 session-owned 文件边界。

## 根因

根因是 `PencilAppSessionAdapter` 把 `pencil interactive --app desktop --in <staging.pen>` 当作 app-bound session 的打开动作，但该命令不能保证桌面 Pencil 前台 active editor 已切换到 `<staging.pen>`。

此前 guard spike 和 live smoke 证明了这个问题：当 active editor 仍是用户之前打开的 `.pen` 时，`batch_get` 读取不到 staging 中插入的 `formaSessionGuard*`，于是 `staging_document_check` 失败。

因此修复不能只是“忽略 guard”或“增加重试保存”。正确修复是先让目标 staging 在 Pencil 前台打开，再用 guard 验证 active editor 确实是目标 staging。

## 设计原则

1. **显式打开，不猜测。** session 开始时必须显式请求 Pencil 前台打开目标 staging。
2. **验证优先，不信任命令返回。** `open` 或 `interactive --in` 返回成功不代表 active editor 正确；必须读 guard。
3. **只写 session staging。** 所有 batch design、set variables 和 save 都只能通过已绑定的 session process 执行。
4. **失败可见。** 前台打开失败、active editor mismatch、sanitizer 失败和 cleanup 失败都必须暴露为不同 phase 或 warning。
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

## da-vinci 细节补充

继续阅读 da-vinci `v1.4.4` 后，v7 还必须吸收以下细节：

1. da-vinci 不只在 session begin 时校验 source，它在保存当前设计前后都做 source convergence，防止截图、读取、保存过程中 active editor 漂移。Forma v7 不能只在 `openSession()` 校验一次；每次受控写入、保存、导出或 commit 前后都必须重新确认 active editor 仍绑定到 session staging。
2. da-vinci 从多个 editor state 字段提取 active editor path：`activeEditorPath`、`activeEditor`、`filePath`、`editor.filePath`。Forma v7 也必须读取 `get_editor_state()` 并按这个优先级提取路径；如果字段存在，realpath 后必须等于 binding 的 `staging_path`。
3. da-vinci 会阻断 active editor 是 `new`、active editor path 缺失、registered/session/active path 越界、扩展名不是 `.pen`、registered `.pen` 在磁盘不可见等情况。Forma v7 对应规则是：session staging 必须 realpath 成功、必须是 `.pen`、必须位于 session 目录内；active editor path 如果可读，也必须是同一个 realpath。
4. da-vinci 会阻断空 `filePath` 操作。Forma 已有 `rejectPathLikeParameters()`，v7 必须继续拒绝任何用户或 agent 传入 `filePath`、`path`、`staging_path` 等路径参数，不能让外部参数绕过 session-owned staging。
5. da-vinci 的同步校验有 live snapshot hash 与 persisted snapshot hash。Forma v7 不引入完整 live snapshot persistence，但 commit 前必须把 session staging 的最新受控保存 hash 作为唯一候选来源，不能用 active editor 的隐式状态或用户当前可见旧画布作为候选。

Forma 与 da-vinci 的关键差异是：da-vinci 的 registered `.pen` 是长期 live source，而 Forma 的 live source 是短生命周期 session staging。由于 Pencil 当前不保证稳定暴露 active editor path，Forma v7 采用“双通道收敛”：

1. **Path channel**：如果 `get_editor_state()` 暴露 active editor path，必须与 `binding.staging_path` realpath 相同。
2. **Guard channel**：无论 path 是否存在，都必须能在 active editor 中读到 session binding guard。

任一通道明确 mismatch 都必须阻断；path 缺失但 guard 存在时可以继续，因为 guard 是当前环境更可靠的收敛证据。

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

`pencil --help` 和 `pencil interactive --help` 当前没有专门的 foreground-open 子命令；`open -a Pencil` 是 macOS desktop adapter 的启动策略，不是可信校验点。可信证据只能来自后续 path channel 和 guard channel 收敛校验。

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

收敛校验是 v7 新增硬门禁，包含 path channel 和 guard channel。

`PencilAppSessionAdapter.openSession()` 固定流程：

1. `realpath(input.staging_path)`。
2. 校验 staging 是 session 目录内的 `.pen` 文件。
3. 在 staging `.pen` 插入 session binding guard node：

   ```text
   formaSessionBindingGuard<session_id>_<random>
   ```

   guard 必须是合法 Pencil node，而不是 name-only 标记或 schema 外对象。固定 payload：

   ```json
   {
     "id": "formaSessionBindingGuard<session_id>_<random>",
     "type": "frame",
     "name": "__forma_session_binding_guard__",
     "x": -100000,
     "y": -100000,
     "width": 1,
     "height": 1,
     "visible": false,
     "metadata": {
       "type": "forma",
       "kind": "session_binding_guard",
       "session_id": "<session_id>"
     },
     "children": []
   }
   ```

   `id` 只允许 `[A-Za-z0-9_-]`，随机段至少 96 bit。插入方式固定为 `insertSessionBindingGuard(stagingPath, guard)`：用现有 `.pen` 结构化读写能力解析 JSON，确认 top-level `children[]` 存在、guard id 不存在、同 session guard 不存在，然后把 guard 作为 top-level child 追加到 staging。不能用字符串拼接，也不能把 guard 插到用户节点 children 里。

   这个 guard 是 session-owned staging 的非设计哨兵节点，只能由 `openSession()` 在 foreground open 前写入 active staging；它保留到 live session terminal，用于后续 drift detection。它不是用户设计内容，不能进入正式 `design.pen` 或 `{product_id}.lib.pen`。

4. 调用 `openPencilDocumentInForeground(stagingPath)`。
5. 启动 app-bound interactive process：

   ```text
   pencil interactive --app desktop --in <stagingPath>
   ```

6. 读取 editor state：

   ```text
   get_editor_state({"include_schema":true})
   ```

7. 从 editor state 提取 active editor path，优先级固定为：

   ```text
   activeEditorPath
   activeEditor
   filePath
   editor.filePath
   ```

8. 如果 active editor path 存在但 realpath 后不是 `stagingPath`，抛出 `staging_document_check`。
9. 读取 session binding guard：

   ```text
   batch_get({"nodeIds":["<binding_guard_id>"],"readDepth":0})
   ```

10. 如果读取不到 guard，关闭当前 process，等待短间隔后重试步骤 4-9。
11. 超过最大尝试次数仍读取不到 guard，抛出：

   ```yaml
   code: PENCIL_APP_REQUIRED
   failed_phase: staging_document_check
   staging_path: <real staging path>
   guard_id: <guard id>
   ```

12. 读取到 guard 后，注册 binding。guard 不在 open 成功时删除；它保留到 session terminal，用于后续 drift detection。

### 会话期间漂移校验

da-vinci 会在 live snapshot 前后检查 active editor 是否漂移；Forma v7 必须在所有 session tool 入口复用同一校验。

每次执行以下操作前必须调用 `assertActiveStagingBinding(bindingId)`：

```text
controlledSave
executeWriteTool
sessionGetEditorState
sessionGetGuidelines
sessionGetVariables
sessionBatchGet
sessionSnapshotLayout
sessionGetScreenshot
sessionExportNodes
commit session
discard session
```

`assertActiveStagingBinding()` 必须：

1. 确认 binding 存活且 `binding.staging_path` 仍等于请求 session 的 staging realpath。
2. 调用 `get_editor_state({"include_schema":false})`，如果 path channel 可读，必须与 staging realpath 相同。
3. 调用 `batch_get({"nodeIds":["<binding_guard_id>"],"readDepth":0})`，必须读到 guard。
4. 如果 path 或 guard 在操作前 mismatch，抛出：

   ```yaml
   code: PENCIL_APP_REQUIRED
   failed_phase: active_editor_drift
   ```

所有写入和保存操作完成后还必须再次调用 `assertActiveStagingBinding()`。如果操作后 mismatch，也抛出 `active_editor_drift`，并把 session 标记为 `recoverable` 或 `failed_operation`，不得继续 commit。

### Guard 清理与正式提交

session binding guard 保留在 staging 期间，因此 commit 不能直接把带 guard 的 staging promoted 到正式文件。

关键约束：**commit 不得在 active staging 中删除 guard 后再继续用 `assertActiveStagingBinding()` 校验。** guard channel 的安全证据来自 active staging 中仍可被 `batch_get` 读到的 guard；删除 guard 后再保存会让漂移校验失去主要证据。

因此 v7 引入 offline sanitizer：

```text
createSanitizedCommitCandidate({
  source_staging_path,
  candidate_path,
  binding_guard_id,
  expected_source_hash
})
```

它只能在 session dir 内生成 candidate，不能修改 active staging，也不能调用 Pencil App。实现必须用结构化 `.pen` 解析器读取 source staging，校验 source hash 等于 `expected_source_hash`，删除且只删除 `id === binding_guard_id` 的 top-level guard node，确认没有任何 `formaSessionBindingGuard` 或 `metadata.kind=session_binding_guard` 残留，然后写入 `candidate_path` 并返回 candidate hash。

commit 固定顺序：

1. 在 product/pencil locks 内重新读取 session record。
2. `assertActiveStagingBinding()`。
3. `controlledSave()`；该方法内部仍必须在保存前后调用 `assertActiveStagingBinding()`，所以 active staging 中的 guard 必须仍存在。
4. 再次计算 active staging hash，并比对 `last_controlled_revision`，确认没有 uncontrolled manual edit。
5. 调用 `createSanitizedCommitCandidate()` 从 active staging 生成 `commit-candidates/staging.no-guard.pen`，不修改 active staging。
6. 用结构化读模型校验 candidate 不含 binding guard，且除 guard 以外的节点内容与 active staging 等价。
7. 以 candidate hash 作为 commit candidate hash。
8. 推进 commit journal，把 sanitized candidate promoted 到正式 `design.pen` 或 `{product_id}.lib.pen`。
9. terminal cleanup 关闭 binding；active staging 可以随 session dir 删除。若需要保留 failed/diagnostic staging，必须先用同一个 sanitizer 生成 no-guard 副本，或在记录里标记原始 staging 含 transient guard 且不得作为正式候选。

discard 或 begin rollback 不需要为了安全而在 live active staging 中删除 guard；默认关闭 binding 后删除 session dir。若 rollback 失败导致 staging 被保留，必须在保留前生成 no-guard diagnostic copy，或写入 `cleanup_warning` 明确该文件含 transient guard、不能 promoted。

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
get_variables
batch_get
batch_design
set_variables
export_nodes
snapshot_layout
get_screenshot
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
active_editor_drift
session_check
```

含义：

- `foreground_open`：系统无法让 Pencil 前台打开目标 staging。
- `open_app`：app-bound interactive process 无法启动或启动后不存活。
- `editor_state_schema`：当前 Pencil 能力不可读或 schema 返回为空。
- `staging_document_check`：session open 阶段 active editor 没有收敛到目标 staging，path channel mismatch、guard 不存在或 guard 无法读取。
- `active_editor_drift`：session 已经打开后，后续读、写、保存、导出、commit 或 discard 前后发现 active editor 不再绑定到目标 staging。
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
4. `openSession()` foreground open 失败时返回 `failed_phase: foreground_open`；如果 session dir 不能删除，必须留下 cleanup warning，标明 retained staging 含 transient guard。
5. `openSession()` active editor path 可读且不等于 staging realpath 时返回 `failed_phase: staging_document_check`。
6. `openSession()` active editor 不含 binding guard 时重试；最终成功时 binding 生效且 guard 保留在 staging。
7. `openSession()` 重试耗尽时返回 `failed_phase: staging_document_check`；失败 cleanup 不得把带 guard 的 staging promoted 或复用为正式候选。
8. `assertActiveStagingBinding()` 在后续操作前后发现 path mismatch 或 guard missing 时返回 `failed_phase: active_editor_drift`，并把 session 标记为 recoverable/failed。
9. commit 保持 active staging 中的 binding guard 到 terminal close，通过 offline sanitizer 生成 no-guard candidate，再 promoted 到正式文件；正式 `design.pen` / `{product_id}.lib.pen` 不含 guard。
10. `insertSessionBindingGuard()` 和 `createSanitizedCommitCandidate()` 覆盖：合法 guard node schema、重复 guard 拒绝、非 top-level guard 拒绝、candidate 只删除目标 guard、candidate hash 固定。
11. discard、begin rollback 和 failed commit cleanup 会删除 session dir 或生成 no-guard diagnostic copy；清理失败写 warning，且 retained staging 不得作为正式候选。
12. 旧的“active Pencil document 不是 staging 时拒绝 session”测试以 v7 guard/path 方式重建。
13. 组件生成后再生成 requirement 的序列测试必须断言：
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
5. 调用 component begin，自动断言 guard/path 收敛，并人工确认 Pencil 前台显示 `staging.lib.pen`。
6. commit component。
7. 调用 requirement begin，自动断言 guard/path 收敛，并人工确认 Pencil 前台显示 `staging.design.pen`。
8. 所有 session 结束后清理临时 home。

该 smoke 是 live integration，不进入普通 `pnpm test`。如果没有 OS 级窗口检查能力，脚本只能证明 active editor 收敛；“前台窗口肉眼可见”必须作为人工验收项输出。

## 实施顺序

1. 先调整 `beginRequirementDesignSession` 的前置顺序：组件库检查必须早于 Pencil preflight。
2. 拆分 `PencilAppSessionAdapter.preflight()`，移除 probe `.pen` app-bound 打开。
3. 在 `openSession()` 增加 foreground open helper。
4. 在 `openSession()` 增加 foreground open + path/guard check retry，并把 binding guard 保存到 binding record。
5. 增加 `assertActiveStagingBinding()`，让所有 read/write/save/export/commit/discard session 入口都复用同一漂移校验。
6. 新增 guard node 结构化插入与 offline sanitizer，调整 commit/discard/rollback cleanup，保证 guard 不进入正式文件。
7. 补充 unit tests。
8. 新增 live smoke 脚本。
9. 用用户描述的序列做 live 验证：已有 `.pen` 打开时，缺组件不切画布；组件生成切到组件 staging；需求生成切到需求 staging。

## 验收标准

1. 用户打开任意已有 `.pen` 后，调用缺组件的 requirement begin，Pencil UI 不变化，返回 `required_action: generate_components`。
2. 调用 component begin 后，Pencil 前台显示 `staging.lib.pen`。
3. component commit 后调用 requirement begin，Pencil 前台显示 `staging.design.pen`。
4. session 打开后用户手动切到另一个 `.pen`，下一次读、写、保存、导出或 commit 必须失败在 `active_editor_drift`，不会写用户原来打开的 `.pen`。
5. component 和 requirement commit 后，正式 `{product_id}.lib.pen`、`components.yaml`、`design.pen` 不包含 `formaSessionBindingGuard` 或 `metadata.kind=session_binding_guard`。
6. 如果 Pencil 无法打开 staging，流程失败在 `foreground_open` 或 `staging_document_check`，不会写用户原来打开的 `.pen`。
7. `pnpm test packages/core/tests/pencil.test.ts packages/core/tests/design-session.test.ts` 通过。
8. `pnpm typecheck` 通过。
9. `pnpm smoke:pencil:foreground` 在本机 Pencil 环境通过；如果脚本不能自动读取窗口前台状态，输出人工验收步骤并记录 operator 确认。

## 与 da-vinci 的对应关系

da-vinci 的 registered `.pen` 是长期 live source；Forma 的 live editing source 是 session staging `.pen`，正式 source 是 commit 后的 `design.pen` 或 `{product_id}.lib.pen`。

对应关系：

```text
da-vinci registeredPenPath  -> Forma session staging_path
da-vinci sessionPenPath     -> Forma binding.staging_path
da-vinci activeEditorPath   -> Forma get_editor_state path channel + binding guard channel
```

v7 不要求 Pencil 必须报告 active editor path；只要 binding guard 只存在于 staging `.pen`，`batch_get` 能读到 guard 就能证明 active editor 已收敛到 staging。若 `get_editor_state()` 同时返回 active editor path，则 path channel 必须与 guard channel 一致；不一致时以 mismatch 处理并阻断。
