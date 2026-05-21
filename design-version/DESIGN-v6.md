# DESIGN v6：需求级 Pencil 画布与可视化设计工作流

## 背景

v5 解决的是“页面设计生成后没有保存”的问题：把 `generate_page_design` 和 `save_designs` 合并为 `generate_and_save_page_design`，避免 agent 只生成临时 `page.pen` 却忘记持久化。

v5 的方向是必要的，但它把页面设计继续固化为“每个页面一个独立 `.pen`”。这和实际设计工作流不匹配。一个移动产品需求通常需要在同一个画布上同时观察首页、场景页、播放页、弹层、确认框和设置页，才能保持导航、组件、间距、底部栏、状态栏和视觉语言一致。

P-907011 / R-c9b123bf 暴露了这个问题：用户认可的完整设计稿已经按需求级目标路径放在 `/Users/xubo/.forma/data/P-907011/R-c9b123bf/design.pen`，其中有 37 个顶层节点：前 25 个是需求页面 frame，后 12 个是组件候选节点；组件候选里 11 个是 frame，`Divider` 是 `reusable: true` 的 rectangle。这个文件才是该需求的 canonical source。但当前后台只识别 `$FORMA_HOME/data/{product_id}/{requirement_id}/{design_id}/design.pen` 这种页面级文件，所以进入需求后仍会提示还有大量页面需要重新生成。历史上若存在产品目录级 `/Users/xubo/.forma/data/P-907011/design.pen`，它只作为人工来源说明；v6 运行时只识别需求目录级 `design.pen`。

另一个问题是设计过程不可见。当前实现通过 headless Pencil CLI 在后台生成临时 `.pen`。用户点击生成后，Pencil App 没有打开，也看不到当前需求的设计图和生成进度。即使后台进程正在运行，体验上也像“点击没反应”。

因此 v6 的核心调整是：**一个 UI 需求对应一个可打开的 Pencil 主画布 `.pen`，所有页面 frame、页面状态、预览索引和历史都归属这个需求目录；v6 不再创建或维护页面级 `D-*` 设计目录。**

通用组件的边界也要重新明确。组件库是产品级资产，所有需求共享同一个 canonical source；需求设计稿只嵌入开始设计时选定的组件版本快照。这样组件调整可以影响之后的新设计稿，而不会隐式改动已经开始或已经完成的需求画布。

设计稿质量也必须进入后端编排。当前代码只做基础 `.pen` 结构、truncation marker 和 PNG 签名检查，不能发现 `rgb()` / `rgba()` 颜色格式、无效属性类型、元素裁切、布局错乱、间距明显异常或截图层面的视觉问题。v6 需要在每页提交前使用 Pencil 原生能力做确定性质量检查，并把可选 AI 截图审查降级为 warning。

后台管理的设计展示和图谱画布也需要同步升级。当前设计页依赖截图叠加标注，容易出现元素框选不中或选错的问题；导航图谱又是固定视口，不能缩放、移动和快速定位。v6 需要把这些可视化入口统一到结构化 scene 渲染和无限画布交互上，截图只作为真实 Pencil 导出结果的人工对照入口。

## 目标

1. 每个 UI 需求拥有一个主设计稿：

   ```text
   $FORMA_HOME/data/{product_id}/{requirement_id}/design.pen
   ```

   这个 `.pen` 是该需求所有页面的 canonical source。受控生成或完成组件归一化后的主画布必须包含该需求钉住的组件库快照；用户手动放入的 unmanaged import 主画布在归一化前可以暂时缺少可映射快照，但必须显式记录为 unmapped，不能参与 `component_refresh`。

2. 设计阶段必须打开或连接 Pencil App，让用户能直观看到当前需求的完整设计图；Pencil App 不可用时不得后台绘制。

3. 页面生成、重生成、refine、rebuild 都在需求级主 `.pen` 上修改对应 frame，而不是生成互不关联的页面级 `.pen`。

4. 页面状态、frame 映射、预览路径、版本和历史都写入需求级 `design.yaml`。`requirement.yaml` 只保留页面的 `design_status`，不再保存或依赖页面级 `design_id`。

5. 如果需求目录中已经存在 `design.pen`，包括用户手动拷贝进去的旧完整设计稿，系统必须直接识别、扫描 frame、导出预览并建立需求级索引。

6. 后台 UI 必须显示明确状态，例如“Pencil App 正在绘制 scenes，已运行 03:12”，不能让用户误以为点击没有反应。

7. 保留 v5 的原子保存思想：任何设计会话结束时，必须由后端验证 `.pen`、导出预览、推进状态，避免只改了画布但 requirement 状态没有更新。

8. 通用组件库使用产品级版本化 `.pen` 作为 canonical source；需求主画布只记录并嵌入一个已钉住的组件版本。

9. 所有会修改 `.pen` 的设计动作必须是 app-bound session；后台只允许执行索引、校验、导出和状态写入。

10. 页面级设计入口统一为 `fm-design`。`fm-design` 根据页面状态、`change_type` 和用户明确意图决定 `generate`、`refine` 或 `rebuild`；不再保留独立 `fm-refine-design` 技能。

11. `fm-design` 只负责把已声明需求转化为视觉设计。新增组件、页面、入口、字段、交互、导航或业务 copy 必须先通过 `fm-requirement` 修改需求，再回到 `fm-design` 生成或调整设计稿。

12. 通用组件和页面实例必须建立稳定关联。页面中使用通用组件时必须保留 `component_key`、Pencil `ref` 关系和 usage index；用户在 `fm-design` 中明确要求“更新所有页面相关通用组件”时，只能刷新这些已关联实例。

13. 每个页面完成后必须运行 Design Quality Pipeline：优先使用 Pencil schema、guidelines、layout snapshot、export 和变量能力做硬校验；AI 多模态截图审查只作为非阻断 warning。

14. 后台设计页的主交互画布必须从需求级 `.pen` 场景树渲染，而不是把 `preview@2x.png` 或 screenshot 当作可点击底图。点击、hover、框选和属性面板都必须绑定 Pencil 内部 `node_id`。

15. 后台所有复杂可视化画布必须支持无限画布交互，包括设计场景、导航图谱和后续组件 usage 图。画布必须支持 pan、zoom、fit、reset 和选择定位；命中测试基于结构化节点 ID，而不是截图坐标猜测。

## 非目标

- 不再把“每页一个独立 `.pen`”作为主模型。
- 不保留页面级 `D-*` 目录、页面级 `design_id` 或旧格式快照作为 v6 数据模型的一部分。
- 不把 `preview@2x.png` 当作设计源。
- 不修改 PRD、需求页面定义、navigation 或 copy 的语义。
- 不允许 `fm-design` 自行新增需求外的业务组件、页面结构、入口、字段、交互、导航或业务文案；这些变更必须先通过 `fm-requirement` 修改需求。
- 不把页面里的 detached copy 当作可自动更新的通用组件实例；缺少稳定关联时必须显式报错，而不是猜测替换。
- 不让 AI 截图审查成为提交阻断点，也不允许 AI 截图审查自动改设计稿。
- 不用截图或 preview 反向覆盖 `.pen` 源文件；截图只用于审查和人工确认。
- 不把截图或 preview 作为后台设计页的主交互画布；它们只能作为历史缩略图、视觉对照、AI review 输入和渲染失败时的只读对照。
- 不把 LeaferJS 后台渲染器当作 Pencil 的像素级替代品，也不通过后台设计页编辑并保存 `.pen`。后台画布目标是结构级高保真查看、选中、标注和属性检查。
- 不支持设计绘制的 headless 替代路径；无 Pencil App 环境只允许通过非绘制 adapter 做索引、导出和检查，不得创建、修改、保存或提交设计稿。
- 不提供产品级 `.pen` 自动导入、移动或复制能力；外部完整设计稿必须由用户手动放到需求目录的 `design.pen`，随后按 v6 主画布导入规则索引。
- 不在 `fm-change-style` 或 `fm-refine-components` 中默认反向修改已有需求的 `design.pen`。
- 不保留 `fm-refine-design` 作为旧 alias；所有页面设计、页面 refine 和页面 rebuild 都走 `fm-design`。

## 当前模型的问题

当前页面级模型：

```text
$FORMA_HOME/data/{product_id}/{requirement_id}/{design_id}/design.pen
$FORMA_HOME/data/{product_id}/{requirement_id}/{design_id}/preview@2x.png
```

问题：

1. 一个需求的页面被拆成多个独立文件，设计师无法在同一个 Pencil 画布中检查整体一致性。
2. 组件和页面分离后，状态栏、底部栏、按钮、弹层样式容易漂移。
3. 用户手动保存的多页面 `.pen` 无法被识别为“需求设计已完成”。
4. 后台生成时 Pencil App 不打开，用户无法判断系统是在生成、卡住，还是按钮没生效。
5. 如果 headless 生成耗时较长，产品锁和 Pencil 锁会挡住后续点击，但 UI 没有足够解释。
6. `validatePenFile` 只检查 JSON、children 和 truncation marker；`saveDesigns` 只检查 preview PNG 签名，不能发现颜色格式、属性类型、布局裁切或视觉错乱。
7. 现有 agent 模板只要求 exact copy 和持久化路径，没有强制读取 Pencil guidelines，也没有结构化质量报告。

## 新数据模型

### 产品级组件库

通用组件库是产品级 canonical source：

```text
$FORMA_HOME/library/{product_id}.lib.pen
$FORMA_HOME/library/{product_id}.components.yaml
$FORMA_HOME/library/{product_id}.versions/{version}.lib.pen
```

`components.yaml` 记录组件库版本：

```yaml
schema_version: 1
product_id: P-907011
current_version: 3
latest_file: P-907011.lib.pen
versions:
  - version: 3
    file: P-907011.versions/3.lib.pen
    source: fm-refine-components
    created_at: '2026-05-20T00:00:00.000Z'
    checksum: sha256:<hash>
    components:
      - component_key: bottom_nav
        reusable_node_id: <pencil-node-id>
        name: bottom_nav
        semantic_contract_hash: sha256:<hash>
        visual_revision: 7
        allowed_instance_overrides:
          - geometry
          - selected_state
      - component_key: primary_button
        reusable_node_id: <pencil-node-id>
        name: primary_button
        semantic_contract_hash: sha256:<hash>
        visual_revision: 4
        allowed_instance_overrides:
          - geometry
          - label_from_requirement
```

产品级组件库由 `generate_components` agent macro、`fm-refine-components` 和 `fm-change-style` 维护。它不属于任何单个 requirement，也不从 requirement `design.pen` 反向同步。所有会创建或修改产品级组件库 `.pen` 的动作也必须是 app-bound session；不得继续通过 `PencilService.generateComponents()` 在后台 headless 写入组件库。

产品级组件库 session 使用固定落盘路径：

```text
$FORMA_HOME/library/{product_id}.sessions/{session_id}/design_session.yaml
$FORMA_HOME/library/{product_id}.sessions/{session_id}/operations.jsonl
$FORMA_HOME/library/{product_id}.sessions/{session_id}/staging.lib.pen
```

产品级并发 lease 使用固定路径：

```text
$FORMA_HOME/data/{product_id}/sessions/active-design-session.yaml
```

这个文件是同一产品内所有 requirement canvas session 和 product component library session 的互斥入口。每次 begin 都必须在持有 product mutation lock 时先创建或校验这个 lease，再创建 requirement/library 自己的 `active.yaml`；commit、discard 或 session 进入 terminal 状态时必须同时清理产品级 lease 和局部 `active.yaml`。

产品级组件库正式文件只能由 `commit_product_component_session` 通过 product component commit journal 推进：

```text
$FORMA_HOME/library/{product_id}.lib.pen
$FORMA_HOME/library/{product_id}.components.yaml
$FORMA_HOME/library/{product_id}.versions/{version}.lib.pen
```

产品删除也必须覆盖 v6 新增的产品级组件库文件。`delete_product` 和产品删除恢复不得只移动旧的 `{product_id}.lib.pen`；它必须在同一个 deletion journal 中移动或清理以下路径：

```text
$FORMA_HOME/library/{product_id}.lib.pen
$FORMA_HOME/library/{product_id}.components.yaml
$FORMA_HOME/library/{product_id}.versions/
$FORMA_HOME/library/{product_id}.sessions/
```

删除恢复成功时必须恢复或清理这些路径的全部候选文件；恢复失败时 `recovery_warnings[]` 必须列出残留路径。`ProductDeletionState.moved_paths[].kind` 必须拆出 `component_library_latest`、`component_library_metadata`、`component_library_versions` 和 `component_library_sessions`，不能把所有组件库状态压成一个旧 `component_library` 文件。

`delete_product` 遇到 v6 active design session 时必须先阻断，不能隐式 discard、kill Pencil 进程或移动 session 目录：

1. `delete_product` 在创建 deletion journal 前必须持有 product mutation lock，并读取 `$FORMA_HOME/data/{product_id}/sessions/active-design-session.yaml`。
2. 如果产品级 lease 指向 `running`、`recoverable`、`failed_operation`、`failed_commit`、`blocked_manual_edit` 或 `commit_recovery_required` session，直接返回 `DESIGN_SESSION_ACTIVE`，details 必须包含 `session_id`、`scope`、`owner_path`、`local_active_path`、`canvas_path`、`staging_path` 和 `status`；不得移动 `data/{product_id}`、`library/{product_id}.sessions/` 或任何正式组件库文件。
3. 如果产品级 lease 指向 terminal session，`delete_product` 只能在对应 `design_session.yaml.status` 为 `committed` 或 `discarded`、且审计链接已经写入正式 history 或 component version record 后清理 stale lease；否则返回 `DESIGN_SESSION_AUDIT_LINK_MISSING`。
4. 如果 active lease 损坏、路径越界、`session_id` 与局部 `active.yaml` 不一致，返回 `LOCK_CORRUPT` 或 `DESIGN_COMMIT_RECOVERY_REQUIRED`，不得猜测删除。
5. 用户必须先用同一 `session_id` 完成 commit/recovery/discard，使 active lease 进入可清理终态，再重试 `delete_product`。

产品组件初始化状态从 v6 开始不再存储在 `product.yaml` 的 `components_initialized` 布尔字段中。组件库是否已初始化由 `$FORMA_HOME/library/{product_id}.components.yaml` 决定：

1. `components.yaml.current_version` 存在且对应版本快照可读，视为 initialized。
2. `components.yaml` 缺失、`current_version` 缺失、版本快照缺失或 latest 校验失败，视为 missing component library。
3. v6 schema 归一化时如果发现旧字段 `components_initialized`，必须直接从 `product.yaml` 删除；v6 运行时 schema 不再接受该字段。
4. `complete_product_init` 在 v6 删除。产品组件初始化流程成功 commit 后，组件库初始化已经完成，不允许再通过独立工具标记完成。

v6 启动前必须执行一次破坏性 schema 归一化，不能把旧字段作为 v6 运行时继续保留。归一化只能作为显式 `forma v6-schema-cutover` 步骤运行；默认 `forma serve` 在发现未完成 cutover marker 时进入 read-only preflight 状态并提示执行 cutover，不得自动改写用户数据。实施分支的切换命令必须先完成 `forma schema-normalization-dry-run`，生成备份 manifest、影响统计和 strict schema 预校验报告；dry-run 通过后才允许执行真实写入：

1. 归一化读取使用 raw YAML object，不经过 v6 strict schema。
2. 删除 `product.yaml.components_initialized`。
3. 删除 `requirement.yaml.pages[].design_id`。
4. 删除旧页面级 `design_metadata`、页面级 `pen_path`、页面级 preview URL 中的 `design_id` 派生字段。
5. 为每个已有 `$FORMA_HOME/data/{product_id}/baseline/baseline.yaml` 的页面补齐 `semantic_contract`。旧 baseline 只能从 `copy[].text`、页面 `name` 和已存在的结构化 semantic 字段生成最小契约；不得从 `features`、`fields` 或 `interactions` 自由文本推断字段、动作或组件。
6. 写回完成后，后续所有 product、baseline、requirement、design API 都使用 v6 strict schema；再次出现旧字段或缺失必填 `semantic_contract` 必须返回 schema validation error。
7. 归一化不读取页面级 `D-*` 目录，不把旧页面级设计记录迁移成 v6 运行时状态。已有完整主画布只能通过用户手动放入需求目录的 `design.pen` 后再索引。

破坏性归一化必须自带一次性备份，不能只依赖外部运维口头备份。真实写入前的 hard gate 固定如下：

1. `forma schema-normalization-dry-run` 必须能枚举全部待改写 YAML，生成 candidate、运行 strict schema 校验，并写入 `$FORMA_HOME/normalization-preflight/v6-{timestamp}/report.yaml`；dry-run 不得改写运行时 YAML。
2. 真实 cutover 必须读取最近一次 dry-run report，且 `report.status === "passed"`、`report.normalizer_version` 等于当前 normalizer、`report.home_hash` 等于当前 `$FORMA_HOME` 数据清单 hash；不匹配时返回 `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED`。
3. 真实 cutover 必须先创建 `$FORMA_HOME/.v6-schema-cutover-active` marker，成功 committed 后改写为 `$FORMA_HOME/.v6-schema-cutover-committed`；启动时发现 active marker 时只进入 recovery-only，不进入正常 strict store。
4. 真实 cutover 成功前不得删除旧字段的备份，也不得删除页面级 `D-*` 目录；v6 运行时不读取它们，但它们保留为人工恢复材料。
5. rollback runbook 固定为 `restore_v6_normalization_backup(backup_dir)`：按 manifest sha256 恢复被改写 YAML、删除 `.v6-schema-cutover-committed` marker、保留 requirement-level `design.pen` 和产品级组件库文件为人工资产，然后启动旧版本服务。该 runbook 必须有单元测试覆盖 manifest 缺失、hash 不匹配和部分文件恢复失败。

最近一次 dry-run report 的选择规则必须和 journal 一样确定，不能依赖 mtime 或实现者临时判断：

1. 未显式传 `--preflight-report` 时，只扫描 `$FORMA_HOME/normalization-preflight/v6-*/report.yaml`。
2. 每个候选 report 必须包含 `created_at`、`report_dir`、`report_file`、`normalizer_version`、`home_hash`、`status`、`strict_schema_status` 和 `candidate_manifest_hash`。`created_at` 必须等于目录名 `v6-{timestamp}` 中的 timestamp，`report_dir` 和 `report_file` 必须是 `$FORMA_HOME` 相对路径，realpath 后仍位于当前 `$FORMA_HOME/normalization-preflight/` 下。
3. 候选 report 按 `created_at` ISO 时间降序、`report_dir` 字典序降序排序；不得使用文件修改时间。排序字段缺失、字段与目录名不一致、report 文件 YAML 不合法、report path 越界或存在两个候选解析成同一个 `created_at + report_dir` 时，cutover 返回 `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED`，`details.preflight_status: "stale"`，`details.preflight_reason: "report_selection_ambiguous"`。
4. 只有唯一最高优先级 report 可选，且 `status === "passed"`、`strict_schema_status === "passed"`、`normalizer_version` 等于当前 normalizer、`home_hash` 等于当前 `$FORMA_HOME` 数据清单 hash、`candidate_manifest_hash` 等于本次 cutover 重新计算出的 candidate manifest hash 时，真实 cutover 才能继续。
5. 若没有 report，返回 `details.preflight_status: "missing"`、`details.preflight_reason: "report_missing"`；若最高优先级 report `status !== "passed"` 或 `strict_schema_status !== "passed"`，返回 `details.preflight_status: "failed"`、`details.preflight_reason: "report_failed"`；若版本、home hash 或 candidate hash 不匹配，返回 `details.preflight_status: "stale"`、`details.preflight_reason: "report_stale"`。
6. 显式传入 `--preflight-report <path>` 时，该路径必须 realpath 位于 `$FORMA_HOME/normalization-preflight/` 下，且必须等于按上述规则选出的唯一最高优先级有效 report；路径越界时返回 `details.preflight_reason: "report_path_outside_home"`，不是最新有效 report 时返回 `details.preflight_reason: "explicit_report_not_latest"`，不得读取任意外部 report。

1. normalizer 第一次写入任何 YAML 前，必须在 `$FORMA_HOME/normalization-backups/v6-{timestamp}/` 下复制将被改写的 `product.yaml`、`requirement.yaml`、`baseline.yaml` 和相关 `copy-translations.yaml`。
2. 备份目录必须写入 `manifest.yaml`，记录原始相对路径、sha256、文件大小、备份时间、normalizer 版本和待删除字段统计。
3. 任一待改写文件备份失败、hash 校验失败或 manifest 写入失败时，normalizer 必须中止，不得改写任何运行时 YAML。
4. 备份目录必须同时写入 `normalization-journal.yaml`，路径固定为 `$FORMA_HOME/normalization-backups/v6-{timestamp}/normalization-journal.yaml`。journal 只能在所有待备份文件已复制、hash 已校验且 `manifest.yaml` 已写入并计算 `manifest_hash` 后创建；`created` 表示 manifest 已存在但尚未开始写任何运行时 YAML。状态机固定为 `created -> backed_up -> writing -> validating -> committed`，失败后只能进入 `recovery_required`，按 manifest 恢复成功后进入 `restored`。
5. `normalization-journal.yaml` 必须记录 `created_at`、`backup_dir`、`manifest_path`、`manifest_hash`、`normalizer_version`、`rewritten_files[]`、每个文件的 `runtime_path`、`backup_path`、`old_hash`、`candidate_hash`、`write_status`、`validation_status`、`restore_status` 和最近一次错误。`created_at` 必须等于目录名 `v6-{timestamp}` 中的 timestamp。`candidate_hash` 在 `write_status: not_started` 时固定为 `null`，不得省略；一旦写入 candidate 后必须更新为 `sha256:<hash>`。任一文件写入或 strict schema 校验失败后，journal 必须先写成 `recovery_required`，再返回错误。
6. 归一化成功后写入 `$FORMA_HOME/normalization_report.yaml`，其中必须包含 `status: committed`、`backup_dir`、`journal_path`、`manifest_hash`、被改写文件数和 strict schema 校验结果。
7. `createFormaStore(options)` 调用 strict schema service 前，必须先用 raw YAML 读取最新 `normalization-journal.yaml` 和 `$FORMA_HOME/normalization_report.yaml`。最新 journal 的选择规则固定：只扫描 `$FORMA_HOME/normalization-backups/v6-*/normalization-journal.yaml`，读取每个 journal 的 `created_at`、`backup_dir`、`manifest_hash` 和 `normalizer_version`；按 `created_at` ISO 时间降序、`backup_dir` 字典序降序排序。若最高优先级存在多个相同 `created_at + backup_dir`、任一 journal 缺少这些排序字段、排序字段与目录名 timestamp 不一致、或同时存在两个非 terminal journal，raw recovery reader 必须返回 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`，`details.restore_status: "journal_selection_ambiguous"`，不得依赖 mtime。只有唯一最新 journal 可选时才继续判断状态。如果发现 `created` 或 `backed_up` journal，且 manifest 可读、`manifest_hash` 匹配、所有备份文件 hash 匹配、`rewritten_files[]` 为空或所有 `write_status` 都是 `not_started`，说明运行时 YAML 尚未被改写；raw recovery reader 只能返回 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`，`details.restore_status: "no_runtime_writes"`，不得写 journal、不得恢复文件、不得重新执行 normalizer。若 manifest 缺失、`manifest_hash` 不匹配或备份 hash 不匹配，raw recovery reader 必须返回 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`，details.restore_status 固定为 `manifest_unavailable` 或 `backup_hash_mismatch`，不得猜测恢复。
8. 如果发现 `writing`、`validating` 或 `recovery_required` journal，raw recovery reader 只能返回 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`，并在 details 中列出 `backup_dir`、`journal_path`、`manifest_path`、`failed_files[]` 和 `restore_status`；不得在状态读取路径中按 manifest 恢复原文件。
9. `fm-status`、后台 recovery status 和启动错误页读取 normalizer 状态时，只能使用 raw recovery reader 读取 `normalization_report.yaml` 和最新 journal，不能先实例化 `ProductService`、`RequirementService` 或 v6 strict store，也不能产生任何写入副作用。这样即使 strict store 因半归一化数据无法启动，也能展示 `backup_dir`、`journal_path` 和恢复错误。
10. strict store 初始化失败时不能让 `forma serve` 无法监听端口。`buildServer(options)` 必须捕获 `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` 和 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`，注册对应 preflight-only 或 recovery-only API 与静态后台入口后继续返回 Fastify 实例。recovery-only 模式下，除 recovery/status API 外的产品、需求、设计、组件、MCP-backed Web API 必须统一返回 409 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`，details 包含 `backup_dir`、`journal_path`、`manifest_path`、`failed_files[]` 和 `restore_status`；preflight-only 模式下同类请求必须统一返回 409 `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED`。两种模式都不得实例化 `ProductService`、`RequirementService`、`DesignService`、`SyncService` 或 v6 strict store。
11. recovery-only API 固定为 `GET /api/recovery/schema-normalization`、`POST /api/recovery/schema-normalization/recover-journal`、`POST /api/recovery/schema-normalization/restore-backup` 和 `GET /api/status` 中的 `schema_normalization` 字段；preflight-only 至少注册 `GET /api/status` 并复用同一 `schema_normalization` 字段；`fm-status` 读取同一 raw recovery reader。后台 UI 在这两种模式只显示恢复/preflight 状态、相关路径和阻断原因，不显示产品/需求编辑入口；preflight-only 不注册 normalization 写 API。
12. MCP 也必须支持 schema normalization recovery-only 和 preflight-only 模式。`createFormaMcpServer(options)` 不能在 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED` 或 `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` 时直接失败退出；它必须注册一个 limited MCP server，其中只有 `fm-status` 对应的 raw status handler 可读取 `readSchemaNormalizationRecoveryState(home)` 并返回 `schema_normalization: SchemaNormalizationRecoveryState`。除 `fm-status` 之外的所有 Forma MCP tools 必须仍注册为同名 tool，但 handler 统一返回对应 normalization code，不得实例化 `ProductService`、`RequirementService`、`DesignService`、`SyncService` 或 v6 strict store。
13. limited MCP handler 的错误 payload 必须和 Web preflight/recovery-only API 使用同一个 `SchemaNormalizationRecoveryState`，MCP `isError: true`，code 固定为 `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` 或 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`。旧 MCP 工具名仍不得注册；显式调用旧名称继续走平台默认 unknown tool，不进入 limited handler。

`SchemaNormalizationRecoveryState` 是 Web recovery/preflight API、`GET /api/status.schema_normalization`、`fm-status.schema_normalization` 和 MCP limited handler error details 的唯一共享契约。结构固定如下；不可用字段必须省略，数组字段不可用时返回空数组，不允许各入口临时补字段或改名：

```typescript
type SchemaNormalizationMode = "normal" | "preflight_only" | "recovery_only";
type SchemaNormalizationStateCode =
  | "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED"
  | "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED";
type SchemaNormalizationStatus =
  | "committed"
  | "preflight_required"
  | "recovery_required"
  | "restored";
type SchemaNormalizationRestoreStatus =
  | "none"
  | "journal_selection_ambiguous"
  | "no_runtime_writes"
  | "manifest_unavailable"
  | "backup_hash_mismatch"
  | "restore_failed"
  | "restored";

interface SchemaNormalizationRecoveryState {
  mode: SchemaNormalizationMode;
  status: SchemaNormalizationStatus;
  code?: SchemaNormalizationStateCode;
  message: string;
  home: string;
  committed_marker_file?: string;
  active_marker_file?: string;
  preflight_report_file?: string;
  preflight_status?: "missing" | "stale" | "failed" | "passed";
  preflight_reason?:
    | "report_missing"
    | "report_failed"
    | "report_stale"
    | "report_selection_ambiguous"
    | "report_path_outside_home"
    | "explicit_report_not_latest";
  backup_dir?: string;
  journal_path?: string;
  manifest_path?: string;
  manifest_hash?: string;
  normalizer_version?: string;
  restore_status: SchemaNormalizationRestoreStatus;
  failed_files: Array<{
    runtime_path: string;
    backup_path?: string;
    reason: string;
    restore_status?: "pending" | "restored" | "already_restored" | "failed";
  }>;
  recovery_actions: Array<
    | "run_schema_normalization_dry_run"
    | "run_v6_schema_cutover"
    | "recover_v6_normalization_journal"
    | "restore_v6_normalization_backup"
  >;
  report?: {
    status?: "passed" | "failed" | "committed" | "restored";
    report_file?: string;
    backup_dir?: string;
    journal_path?: string;
    rewritten_file_count?: number;
    generated_requirement_contract_count?: number;
    generated_baseline_contract_count?: number;
    strict_schema_status?: "passed" | "failed";
  };
}
```

error payload 的 `details` 必须就是 `SchemaNormalizationRecoveryState`。`GET /api/status` 和 `fm-status` 只把同一对象包在 `schema_normalization` 字段下返回；不得在 status 路径中另行读取 strict store 或恢复 YAML。

归一化恢复的写操作必须由显式维护入口执行，不能混入状态读取：

1. `recover_v6_normalization_journal(backup_dir)` 是处理 `created`、`backed_up`、`writing`、`validating` 或 `recovery_required` journal 的唯一恢复入口；它可以把 `no_runtime_writes` journal 写为 `restored`，或按 manifest 恢复已经被改写的 YAML。
2. `restore_v6_normalization_backup(backup_dir)` 只用于用户明确回滚 cutover；它不能由 `readSchemaNormalizationRecoveryState(home)`、`fm-status`、`GET /api/status` 或后台状态页隐式触发。
3. recovery-only Web UI 可以提供显式“恢复 journal”动作；该动作必须调用 recovery API，并在请求 payload 中带 `backup_dir`。只打开状态页、刷新状态或调用 `fm-status` 不得改写任何文件。
4. TypeScript 导出使用 camelCase，内部 operation code 使用 snake_case，CLI subcommand 使用 kebab-case：`recoverV6NormalizationJournal(home, backupDir)` 对应内部 `recover_v6_normalization_journal(backup_dir)` 和 CLI `forma recover-v6-normalization-journal`；`restoreV6NormalizationBackup(home, backupDir)` 对应内部 `restore_v6_normalization_backup(backup_dir)` 和 CLI `forma restore-v6-normalization-backup`。

维护入口契约固定如下，不能由实现者临时命名：

| entrypoint | method | input | write behavior |
| --- | --- | --- | --- |
| `forma schema-normalization-dry-run` | CLI | `--home <path>` optional, default resolved `FORMA_HOME`; optional `--report-dir <path>` must stay under home | writes only `$FORMA_HOME/normalization-preflight/v6-{timestamp}/report.yaml` and candidate diagnostics; never rewrites runtime YAML |
| `forma v6-schema-cutover` | CLI | `--home <path>` optional; optional `--preflight-report <path>` must point to the latest valid report under home | creates backup, journal, active/committed marker and rewrites runtime YAML only after preflight gate passes |
| `forma recover-v6-normalization-journal` | CLI | `--home <path>` optional; required `--backup-dir <path>` under `$FORMA_HOME/normalization-backups/` | calls `recoverV6NormalizationJournal(home, backupDir)` and may write journal/runtime YAML according to manifest |
| `forma restore-v6-normalization-backup` | CLI | `--home <path>` optional; required `--backup-dir <path>` under `$FORMA_HOME/normalization-backups/`; required `--confirm restore_v6_backup` | calls `restoreV6NormalizationBackup(home, backupDir)` and rolls back cutover YAML according to manifest |
| `/api/recovery/schema-normalization` | `GET` | none | read-only; returns `SchemaNormalizationRecoveryState` |
| `/api/recovery/schema-normalization/recover-journal` | `POST` | `{ "backup_dir": "normalization-backups/v6-..." }` | recovery-only only; calls `recoverV6NormalizationJournal` |
| `/api/recovery/schema-normalization/restore-backup` | `POST` | `{ "backup_dir": "normalization-backups/v6-...", "confirm": "restore_v6_backup" }` | recovery-only only; calls `restoreV6NormalizationBackup` |

所有 `backup_dir` 输入在进入恢复函数前必须 realpath 校验位于当前 `$FORMA_HOME/normalization-backups/` 下；不允许相对路径逃逸、symlink 逃逸或读取其他 home 的备份。两个写 API 成功返回对应函数结果；失败按 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED` 或 `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` 的统一错误 payload 返回。preflight-only 状态页只能展示 CLI 操作提示，不暴露写 API 按钮；recovery-only 状态页可以展示 recover journal 按钮，restore backup 必须要求二次确认并传入 `confirm: "restore_v6_backup"`。

schema 归一化的实现落点必须固定，不能只停留在文档约定：

1. 新增 `packages/core/src/schema-normalization.ts`，导出 `normalizeFormaHomeForV6(home, options)`。`options.mode` 只能是 `"preflight"` 或 `"cutover"`：`preflight` 只生成 report 和 candidate 校验，不改写运行时 YAML；`cutover` 必须先验证最近一次 preflight report 后才允许真实备份和写回。普通 `forma serve`、`createFormaStore`、MCP server 和 Web route 注册链路不得调用未带 `mode` 的 `normalizeFormaHomeForV6(home)`。
2. 同文件导出 `readSchemaNormalizationRecoveryState(home)`，只能 raw-read cutover marker、`normalization_report.yaml`、最新 `normalization-journal.yaml` 和 manifest；它是 recovery-only server、preflight-only server、`fm-status` 和启动错误页读取归一化状态的唯一入口。该函数不得写 journal、不得恢复文件、不得调用 `normalizeFormaHomeForV6`。
3. 同文件导出 `recoverV6NormalizationJournal(home, backupDir)` 和 `restoreV6NormalizationBackup(home, backupDir)`；这两个函数是唯二允许根据 normalization manifest 写回 YAML 或 journal 的恢复入口。
4. `packages/core/src/store.ts` 的 store factory 必须改为 async：`createFormaStore(options)` 在构造 `ProductService`、`RequirementService`、v6 design services、`SyncService` 前先调用 raw recovery reader 检查 cutover marker 和 normalization state。它不得在普通启动中执行 `mode: "preflight"` 或 `mode: "cutover"`。如果 cutover 尚未 committed，返回 `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED`；如果发现 recovery-required journal，返回 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`。
5. 只有上表中的 `forma v6-schema-cutover` CLI 和恢复 API/CLI 允许调用会写入的 normalization 函数；其中 `forma v6-schema-cutover` 才允许调用 `normalizeFormaHomeForV6(home, { mode: "cutover" })`。该命令不启动 ProductService、RequirementService、DesignService 或 SyncService；只做 raw YAML preflight、backup、journal、写回、strict schema 校验和 report。
6. async store 切换必须和所有调用点迁移在同一个变更集中完成，不能把“store 已变 async、调用点仍按同步对象使用”的状态作为可运行中间版本。`packages/server/src/app.ts` 的 `buildServer(options)` 必须改为 `async`。正常模式下它 `await createFormaStore(...)` 后再 `registerRoutes`；如果捕获 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`，它必须改为 `registerRecoveryRoutes` 并继续启动 recovery-only server；如果捕获 `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED`，它必须注册 preflight-only status API 和静态后台入口，不注册 mutation routes。`packages/server/src/index.ts` 的 `main()` 必须 `await buildServer(options)` 后再 `listen`；server 测试、CLI 测试和脚本测试必须统一 `await buildServer(...)` 或传入已经构造好的 async store。`packages/server/src/routes.ts` 的 `FormaStore` 类型必须同步改为 `Awaited<ReturnType<typeof createFormaStore>> & { sync: StoreSync }`，不得继续使用裸 `ReturnType<typeof createFormaStore>`，否则类型会退化成 `Promise<Store>` 并掩盖未 `await` 的调用点。
7. `packages/mcp/src/index.ts` 的 `createFormaMcpServer`、`packages/server/src/app.ts` / `packages/server/src/index.ts` 的 `forma serve` 启动链路、`packages/cli/src/index.ts` 的所有会创建 store 的命令，以及 `scripts/live-style-sync.ts`、`scripts/smoke-pencil.ts` 等 workspace 脚本中所有 `createFormaStore(...)` 调用，都必须 await async store factory 后再注册正常 MCP tools、Fastify routes 或启动脚本逻辑。唯一例外是 `createFormaMcpServer` 捕获 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED` 或 `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED` 后进入 recovery/preflight-only MCP 模式：此时不得继续 await 或使用 strict store，只能调用 `readSchemaNormalizationRecoveryState(home)` 注册 raw `fm-status` 和统一 error handlers。
8. normalizer 在 preflight mode 只 raw-read YAML 并生成 candidate；在 cutover mode 才允许 raw-read 并原子写回。cutover 写回后立即用 v6 strict schema 重新读取验证。normalizer 和 raw recovery reader 是唯二允许读取旧 schema / 半归一化状态的入口；ProductService、RequirementService、v6 design services、route handler 和 MCP handler 不允许 raw-read 旧 schema。
9. normalizer 必须为缺失 `semantic_contract` 的 requirement 页面生成最小契约，来源只能是已有结构化字段：`copy[].text`、页面 `name`、`navigation[].to`、baseline page id，以及旧 YAML 中已经明确存在的 `declared_fields`、`declared_actions`、`declared_component_keys`；不得从 `copy-translations.yaml`、`features`、`fields`、`interactions` 自由文本推断动作、字段或业务能力。
10. normalizer 必须为缺失 `semantic_contract` 的 baseline 页面生成最小契约，来源只能是该 baseline page 的 `copy[].text`、`name` 和已存在的结构化 semantic 字段；旧 `fields`、`interactions` 字符串只保留为人类说明。
11. 如果最小契约无法覆盖旧需求真实交互，normalizer 仍写入最小契约，并在 `normalization_report.yaml.requirement_pages[].semantic_contract_coverage` 或 `normalization_report.yaml.baseline_pages[].semantic_contract_coverage` 标记为 `minimal`。后续 active session 的 strict Semantic Scope Guard 会按 `REQUIREMENT_UPDATE_REQUIRED` 或 `DESIGN_SCOPE_VIOLATION` 阻断新增语义；v6 strict schema 不能因为缺少旧语义而继续接受缺失 `semantic_contract` 的页面。
12. normalizer 必须记录 `normalization_report.yaml`，包含删除字段计数、生成 `semantic_contract` 的 requirement 页面数、生成 `semantic_contract` 的 baseline 页面数、覆盖等级、跳过原因和 schema 校验结果；后台 recovery status 和 `fm-status` 读取这个报告。

产品级组件库 session 的失败回滚契约：

1. `begin_product_component_session` 只打开或连接 Pencil App、建立 session、创建 staging `.pen`，不得推进 `components.yaml.current_version`。
2. `apply_product_component_operations` 是产品组件库唯一写入网关，写入前后都记录 `operations.jsonl` 和 `last_controlled_revision`。
3. `commit_product_component_session` 必须先校验 staging `.pen`、组件 metadata、`component_key` 唯一性和 `semantic_contract_hash`，再写 product component commit journal，把 staging 文件复制为新版本快照候选，最后通过 journal 推进 latest 和 `components.yaml.current_version`。
4. commit 任一步失败时，按 journal 恢复旧 latest、旧版本快照和旧 `components.yaml.current_version`；恢复成功后删除本 session 的 staging latest 候选，session 状态写为 `failed_commit`；恢复失败时写为 `commit_recovery_required`。
5. `discard_product_component_session` 只能关闭未提交 session 并删除该 session 的 staging 文件，不得删除任何正式版本。

Pencil node metadata 的通用契约必须符合当前 `.pen` schema：`metadata` 对象必须包含 `type: "forma"`，Forma 自己的节点类别写在 `metadata.kind`。所有 v6 规则读取 Forma metadata 时都必须先校验 `metadata.type === "forma"`；缺少 `type: "forma"` 的节点不能按 Forma 业务 metadata 处理，只能按 unmanaged import 或 metadata missing 规则处理。示例固定如下：

```yaml
metadata:
  type: forma
  kind: requirement_page
  page_id: home
```

因此文档中“`kind: ...` metadata”都表示 `.pen` node 上的 `metadata.type === "forma"` 且 `metadata.kind === "..."`，不能把 `kind` 写成 node 顶层字段，也不能省略 `metadata.type`。

每个产品级 reusable component 必须写入稳定 metadata：

```yaml
metadata:
  type: forma
  kind: product_component
  component_key: bottom_nav
  component_version: 3
  semantic_contract_hash: sha256:<hash>
```

`component_key` 是跨版本关联主键。纯视觉调整不能改 `component_key`；如果组件语义发生变化，例如新增入口、字段、动作或导航目标，必须生成新的语义契约 hash。旧 `component_key` 只能继续表示原语义，不能被复用成另一个产品能力。

### 需求级主画布

每个 UI 需求新增一个主设计稿：

```text
$FORMA_HOME/data/{product_id}/{requirement_id}/design.pen
$FORMA_HOME/data/{product_id}/{requirement_id}/design.yaml
$FORMA_HOME/data/{product_id}/{requirement_id}/previews/{page_id}@2x.png
$FORMA_HOME/data/{product_id}/{requirement_id}/history/canvas/canvas.c{canvas_version}.pen
$FORMA_HOME/data/{product_id}/{requirement_id}/history/canvas/canvas.c{canvas_version}.yaml
$FORMA_HOME/data/{product_id}/{requirement_id}/history/pages/{page_id}.p{page_version}.pen-fragment
$FORMA_HOME/data/{product_id}/{requirement_id}/history/previews/{page_id}.p{page_version}@2x.png
$FORMA_HOME/data/{product_id}/{requirement_id}/sessions/{session_id}/staging.design.pen
```

`design.pen` 是唯一正式主画布。所有 app-bound 设计 session 都必须先在同一需求目录下创建 `sessions/{session_id}/staging.design.pen`，Pencil App 打开的是这个 staging 文件，而不是直接打开正式 `design.pen`。commit 通过后，后端才通过 requirement commit journal 把 staging 文件推进为正式 `design.pen`，并同时写入 `design.yaml`、preview、history 和 `requirement.yaml` 状态。commit 失败时必须按 journal 恢复旧正式文件集合；discard 时正式 `design.pen` 不变，删除该 session 的 staging `.pen`，保留 `design_session.yaml`、`operations.jsonl`、失败摘要和 commit journal 作为审计材料。

术语固定如下：

- `canvas_path`：正式主画布路径，固定为 `$FORMA_HOME/data/{product_id}/{requirement_id}/design.pen`。
- `staging_path`：当前 active session 的 Pencil App 工作文件，固定为 `$FORMA_HOME/data/{product_id}/{requirement_id}/sessions/{session_id}/staging.design.pen`。
- commit 返回的 `canvas_path` 必须指向正式主画布；begin 返回的 `staging_path` 才是 Pencil App 当前打开的文件。

持久化路径策略固定如下，避免 schema、hash、迁移和跨机器恢复分叉：

1. `design.yaml`、`components.yaml`、`normalization_report.yaml`、`manifest.yaml`、`commit-journal.yaml`、`index-journal.yaml` 和 deletion journal 中的正式资源路径必须保存为 `$FORMA_HOME` 相对路径，例如 `data/P-907011/R-c9b123bf/design.pen`、`library/P-907011.versions/3.lib.pen`。字段名优先使用 `*_file`、`*_dir` 或 `*_relative_path`。
2. API/MCP 返回值可以包含解析后的绝对 `canvas_path`、`staging_path`、`preview_path`、`library_path`、`version_path`、`history_path`，这些路径只用于展示和审计，不能作为后续写工具输入。
3. `design_session.yaml` 是本机进程绑定审计文件，必须同时保存相对路径和绝对路径：相对路径用于恢复、manifest 校验和跨机器检查，绝对路径用于当前 `pencil interactive --in` child process。恢复器以相对路径为准，并校验绝对路径 realpath 必须仍位于当前 `$FORMA_HOME` 下。
4. revision hash、manifest hash 和 schema 校验只使用相对路径字段；不得把 `/Users/...` 这类机器绝对路径写入 hash 输入。
5. 文档示例中出现的 `/Users/xubo/.forma/...` 只表示 API/display 层绝对路径示例；如果示例字段属于持久化 canonical YAML，必须同时给出对应相对字段。
6. 章节说明或 UI 示例中可以使用 `previews/...`、`history/...` 这类 requirement-local shorthand 便于阅读；它们只表示展示文本或路径后缀。任何写入 `design.yaml`、`components.yaml`、manifest、journal 或 hash 输入的字段都必须使用 `$FORMA_HOME` 相对路径，例如 `data/P-907011/R-c9b123bf/previews/home@2x.png`。

`design.yaml` 记录主画布索引：

```yaml
schema_version: 2
source: requirement_canvas
product_id: P-907011
requirement_id: R-c9b123bf
pen_file: data/P-907011/R-c9b123bf/design.pen
preview_dir: data/P-907011/R-c9b123bf/previews
history_dir: data/P-907011/R-c9b123bf/history
canvas_version: 1
canvas_revision: sha256:<hash-of-design.pen>
last_commit:
  source: index
  index_journal_id: IDX-xxxxxxxx
  session_id: null
file_hashes:
  previews:
    data/P-907011/R-c9b123bf/previews/home@2x.png: sha256:<hash>
    data/P-907011/R-c9b123bf/previews/scenes@2x.png: sha256:<hash>
  history:
    data/P-907011/R-c9b123bf/history/canvas/canvas.c1.pen: sha256:<hash>
    data/P-907011/R-c9b123bf/history/canvas/canvas.c1.yaml: sha256:<hash>
    data/P-907011/R-c9b123bf/history/pages/home.p1.pen-fragment: sha256:<hash>
    data/P-907011/R-c9b123bf/history/pages/scenes.p1.pen-fragment: sha256:<hash>
    data/P-907011/R-c9b123bf/history/previews/home.p1@2x.png: sha256:<hash>
    data/P-907011/R-c9b123bf/history/previews/scenes.p1@2x.png: sha256:<hash>
updated_at: '2026-05-20T00:00:00.000Z'
component_library:
  source: product_library
  product_id: P-907011
  version: 3
  source_file: library/P-907011.versions/3.lib.pen
  snapshot_frame_name: Components - Snapshot v3
  snapshot_frame_id: <pencil-node-id>
  embedded_at: '2026-05-20T00:00:00.000Z'
  policy: pinned
  components:
    - component_key: bottom_nav
      snapshot_component_id: <pencil-node-id>
      source_reusable_node_id: <pencil-node-id>
      semantic_contract_hash: sha256:<hash>
    - component_key: primary_button
      snapshot_component_id: <pencil-node-id>
      source_reusable_node_id: <pencil-node-id>
      semantic_contract_hash: sha256:<hash>
pages:
  - page_id: home
    frame_id: <pencil-node-id>
    frame_name: Home - 首页
    metadata:
      type: forma
      kind: requirement_page
      page_id: home
    page_version: 1
    status: done
    preview_file: data/P-907011/R-c9b123bf/previews/home@2x.png
    component_usages:
      - component_key: bottom_nav
        binding_id: CINST-home-bottom-nav-1
        instance_node_id: <pencil-node-id>
        source_snapshot_component_id: <pencil-node-id>
        source_library_version: 3
        status: linked
        overrides:
          geometry: preserved
          selected_state: requirement_owned
          text: inherited
    quality_report:
      status: passed
      checked_at: '2026-05-20T00:00:00.000Z'
      hard_checks:
        pencil_schema: passed
        color_format: passed
        property_compatibility: passed
        layout_snapshot: passed
        preview_export: passed
        semantic_scope: passed
      ai_visual_review:
        status: skipped
        reason: not_requested
      warnings: []
    history:
      - page_version: 1
        canvas_version: 1
        source: index
        canvas_file: data/P-907011/R-c9b123bf/history/canvas/canvas.c1.pen
        canvas_yaml_file: data/P-907011/R-c9b123bf/history/canvas/canvas.c1.yaml
        frame_snapshot_file: data/P-907011/R-c9b123bf/history/pages/home.p1.pen-fragment
        preview_file: data/P-907011/R-c9b123bf/history/previews/home.p1@2x.png
        created_at: '2026-05-20T00:00:00.000Z'
  - page_id: scenes
    frame_id: <pencil-node-id>
    frame_name: Scenes - 场景
    metadata:
      type: forma
      kind: requirement_page
      page_id: scenes
    page_version: 1
    status: done
    preview_file: data/P-907011/R-c9b123bf/previews/scenes@2x.png
    history:
      - page_version: 1
        canvas_version: 1
        source: index
        canvas_file: data/P-907011/R-c9b123bf/history/canvas/canvas.c1.pen
        canvas_yaml_file: data/P-907011/R-c9b123bf/history/canvas/canvas.c1.yaml
        frame_snapshot_file: data/P-907011/R-c9b123bf/history/pages/scenes.p1.pen-fragment
        preview_file: data/P-907011/R-c9b123bf/history/previews/scenes.p1@2x.png
        created_at: '2026-05-20T00:00:00.000Z'
```

历史版本号必须拆成两类，避免多个页面争用同一个全画布文件名：

1. `canvas_version` 是需求主画布全局版本，每一次成功 `commit_requirement_design_session` 都递增一次，并对应一份 `history/canvas/canvas.c{canvas_version}.pen` 和 `canvas.c{canvas_version}.yaml`。
2. `page_version` 是单个页面的历史版本，只在该页面被 `generate`、`refine`、`rebuild` 或 `rollback` 成功提交时递增；组件刷新如果改变了该页面 preview 或 component usage，也必须为受影响页面递增 `page_version`。
3. `design.yaml.pages[].history[]` 记录 `page_version` 与当时的 `canvas_version` 绑定关系。页面回滚只能选择 `page_version`；系统用该条 history 中的 `frame_snapshot_file` 生成 rollback operations，并在 commit 时产生新的 `page_version` 和新的 `canvas_version`。
4. `design.yaml.canvas_version` 和 `design.yaml.pages[].page_version` 都必须单调递增，不能复用；不得再使用单个 `version` 字段同时表示全画布版本和页面版本。

`component_library` 只有一种正式运行时来源：产品级组件库快照。

```yaml
component_library:
  source: product_library
  product_id: P-907011
  version: 3
  source_file: library/P-907011.versions/3.lib.pen
  snapshot_frame_name: Components - Snapshot v3
  snapshot_frame_id: <pencil-node-id>
  embedded_at: '2026-05-20T00:00:00.000Z'
  policy: pinned
  components:
    - component_key: bottom_nav
      snapshot_component_id: <pencil-node-id>
      source_reusable_node_id: <pencil-node-id>
      semantic_contract_hash: sha256:<hash>
```

用户手动放入需求目录的 `design.pen` 如果不包含可映射到产品级组件库的 `Components - Snapshot v{version}`，不得写入第二种 runtime `component_library` 形态。`index_requirement_design_canvas` 只能把这些未归一化的顶层组件候选记录在 `design.yaml.import_report.unmanaged_component_nodes[]` 和返回值 `skipped_nodes[]`，用于人工复核；它们不是组件库快照，不能参与 `component_refresh`，也不能被页面扫描误标记为业务页面。

组件快照在需求主画布中必须使用固定顶层 frame 命名：正式版本快照使用 `Components - Snapshot v{version}`。页面扫描时必须跳过正式组件快照 frame。

组件刷新 session 允许在 `staging.design.pen` 中临时创建 `Components - Snapshot v{version} (staging)`。这个 staging frame 只属于当前 active session：成功提交前必须在同一次受控操作中提升为正式 `Components - Snapshot v{version}`，失败或 discard 时必须删除；它不能写入正式 `design.yaml.component_library.snapshot_frame_name`，不能保留在 committed `design.pen`，页面扫描也必须跳过这个临时 frame。

未归一化组件候选节点的规则：

1. 如果 `.pen` 中已经存在 `Components - Snapshot v{version}` 顶层 frame，且 frame metadata 能映射到 `$FORMA_HOME/library/{product_id}.components.yaml` 的同一版本，索引直接写入正式 `component_library.source: product_library`。
2. 如果存在 `Components - Snapshot` 但没有版本、没有 `component_key`，或不能映射到产品级组件库版本，索引只把它放入 `import_report.unmanaged_component_nodes[]`，reason 为 `unmanaged_component_snapshot`；不得把它写成 runtime `component_library`。
3. 如果没有正式 snapshot frame，但扫描到未匹配页面且符合“主画布组件候选节点识别”规则的顶层节点，例如 `TabBar`、`PrimaryButton`、`ToggleSwitch/On` 或 `Divider`，索引不得修改 `.pen` 或移动这些节点；必须把它们放入 `skipped_nodes[]`，reason 为 `unmanaged_component_node`，并同步记录到 `import_report.unmanaged_component_nodes[]`。
4. `component_refresh` 要求 `design.yaml.component_library.source === "product_library"`。如果主画布只有 unmanaged component nodes 或没有 `component_library`，直接返回 `COMPONENT_LIBRARY_UNMAPPED`，不得尝试 partial refresh。
5. 只有后续 app-bound session 通过受控写操作嵌入当前产品级组件库版本，并写入真实 `Components - Snapshot v{version}`、`component_key`、`ref` 关系和 usage metadata 后，`component_library` 才能成为正式 runtime 字段。这个步骤是 v6 数据归一化，不是旧模型兼容层。

`component_library.policy: pinned` 表示该需求继续使用开始设计时嵌入的组件快照。产品级组件库更新后，已有需求不会自动变化。

缺少正式产品级组件快照时返回：

```text
COMPONENT_LIBRARY_UNMAPPED
当前需求画布的组件快照无法映射到产品级组件库，不能安全刷新通用组件
```

### 通用组件关联模型

组件关联分三层：

1. 产品级组件库中的 reusable component 是 canonical definition，使用 `component_key` 作为稳定业务主键。
2. 需求主画布中的 `Components - Snapshot v{version}` 是该需求钉住的组件快照，快照内每个 reusable component 继续保留同一个 `component_key`。
3. 页面 frame 中的组件只能通过 Pencil `ref` instance 引用该需求快照内的 reusable component，不能直接引用产品级 latest，也不能依赖 detached copy。

需求快照组件必须写入 metadata：

```yaml
metadata:
  type: forma
  kind: requirement_component_snapshot
  component_key: bottom_nav
  source_library_version: 3
  source_reusable_node_id: <pencil-node-id>
  semantic_contract_hash: sha256:<hash>
```

页面组件实例必须写入 metadata：

```yaml
metadata:
  type: forma
  kind: component_instance
  component_key: bottom_nav
  owner_page_id: home
  binding_id: CINST-home-bottom-nav-1
  source_snapshot_component_id: <pencil-node-id>
  source_library_version: 3
  detached: false
```

`design.yaml.pages[].component_usages` 是可重建索引，不是唯一真相。索引时必须从 Pencil node metadata 和 `ref` 关系重新扫描页面 frame：

1. 找到 `metadata.type === "forma"` 且 `metadata.kind === "component_instance"` 的 node。
2. 校验它是 `ref`，且引用目标位于当前需求的 `Components - Snapshot v{version}`。
3. 校验 `component_key` 能在 `design.yaml.component_library.components` 中找到。
4. 写入或刷新 `component_usages`。

detached copy 识别也必须使用固定规则：页面 frame 内的非 `ref` 子树如果其 root name、metadata `component_key`、或规范化后的 `name` 命中当前 `design.yaml.component_library.components[].component_key` / component `name` / 主画布组件候选 allowlist 中任一项，但缺少合法 `component_instance` metadata 或 `ref` 关系，必须记录为不可自动更新：

```text
COMPONENT_USAGE_UNLINKED
页面 home 中存在未关联的 bottom_nav 副本，无法安全刷新通用组件
```

刷新动作默认不能部分成功。只要目标范围内存在 unlinked usage、缺失 `component_key`、语义契约冲突或 override 冲突，就必须阻断整个 refresh，保留旧组件快照和页面实例。

### 页面状态记录

`requirement.yaml` 仍然是需求页面清单和页面设计状态的入口，但页面设计相关字段只保留状态：

```yaml
pages:
  - page_id: home
    name: 首页
    baseline_page: home
    design_status: done
    semantic_contract:
      copy_texts:
        - 立即开始
      fields: []
      actions:
        - key: start_session
          label: 立即开始
      navigation_targets:
        - scenes
      component_keys:
        - bottom_nav
    semantic_contract_coverage: full
    declared_fields: []
    declared_actions:
      - key: start_session
        label: 立即开始
        source: requirement
    declared_component_keys:
      - bottom_nav
  - page_id: scenes
    name: 场景
    baseline_page: scenes
    design_status: pending
    semantic_contract:
      copy_texts: []
      fields: []
      actions: []
      navigation_targets: []
      component_keys: []
    semantic_contract_coverage: minimal
    declared_fields: []
    declared_actions: []
    declared_component_keys: []
```

`semantic_contract` 由 `RequirementService.saveRequirement` 在 `fm-requirement` 保存需求时生成，是页面语义边界的唯一结构化来源。生成输入只能是用户确认后的 requirement 结构化语义字段、navigation、默认语言 copy 和 product rules 结构化语义字段；不得把 baseline 聚合契约、`copy-translations.yaml` 翻译文本、`features`、`fields`、`interactions` 等自由文本作为机器语义来源。`features`、`fields`、`interactions` 等自由文本只能作为说明展示，不能由 `fm-design` 自行解析成允许动作或允许字段。v6 normalizer 之后，持久化 `requirement.yaml.pages[]` 必须都有 `semantic_contract`；如果调用方绕过 normalizer 写入缺失字段，严格 schema 直接返回 schema validation error。`RequirementService.saveRequirement` 新写入或重写入页面时必须把 `semantic_contract_coverage` 写为 `full`；这里的 `full` 只表示“已按当前结构化输入完整生成”，不表示自由文本中的业务含义都被机器理解。normalizer 为旧页面生成最小契约时写为 `minimal`。`SEMANTIC_CONTRACT_REQUIRED` 只用于 begin session 前发现当前页面的 `semantic_contract_coverage: minimal` 且用户请求的语义超出最小契约时，提示先运行 `fm-requirement` 重新确认结构化语义。

v6 必须把“人类说明”和“机器可校验语义”拆开。`fields`、`features`、`interactions` 继续保留为自由文本说明，不参与 `semantic_contract.fields[]` 或 `semantic_contract.actions[]` 生成。新增的结构化语义输入固定为 `declared_fields`、`declared_actions` 和 `declared_component_keys`：

```typescript
interface SemanticFieldEntry {
  key: string;
  label: string;
  source?: "requirement" | "baseline" | "product_rule";
}

interface SemanticActionEntry {
  key: string;
  label: string;
  source?: "requirement" | "baseline" | "product_rule";
}

interface RequirementPageSemanticInput {
  declared_fields?: SemanticFieldEntry[];
  declared_actions?: SemanticActionEntry[];
  declared_component_keys?: string[];
}
```

这些字段是 `save_requirement` external MCP payload 和 Web API 中唯一允许调用方提供的页面级机器语义输入。调用方仍不得传入 `semantic_contract` 本身。baseline 和 product rules 也必须显式拆出机器语义，不能继续把现有自由文本当作机器来源：

```typescript
interface BaselinePageSemanticContract {
  copy_texts: string[];
  fields: SemanticFieldEntry[];
  actions: SemanticActionEntry[];
  navigation_targets: string[];
  component_keys: string[];
}

interface ProductRuleSemanticInput {
  copy_texts?: string[];
  fields?: SemanticFieldEntry[];
  actions?: SemanticActionEntry[];
  component_keys?: string[];
}
```

`packages/core/src/baseline.ts` 的 `baselinePageSchema` 必须新增 `semantic_contract: BaselinePageSemanticContract`。这个字段是 baseline 对 source requirements 的聚合视图，只能从 requirement 页面已经生成的 `semantic_contract` 后置派生；它不得作为任何 requirement 页面 `semantic_contract` 的输入，避免兄弟需求的字段、动作、组件或 copy 通过 baseline 回灌。`fields` 和 `interactions` 字符串继续保留为人类说明，但不得参与机器契约生成。`packages/core/src/requirement.ts` 的 `ruleInputSchema` / `storedRuleSchema` 必须新增可选 `semantic: ProductRuleSemanticInput`；只有 `rule.semantic` 能进入 semantic builder，`given`、`when`、`then` 仍然只是人类说明。

`semantic_contract.navigation_targets` 固定为目标页面 `page_id` 字符串数组，不是完整 navigation edge。完整边仍然只保存在 requirement / baseline 的 `navigation[]` 中，结构沿用当前 `BaselineNavigation`：`{ from: string; to: string; label?: string }`。`label` 在 `AllowedSemanticSurface.allowed_navigation_targets[]` 中映射为 `trigger`；v6 不把持久化 navigation 字段改名为 `trigger`。

baseline page 可能聚合多个 `source_requirements[]`，因此 baseline 语义合并规则必须固定：

1. `BaselineService.updateFromRequirementLocked` 只能接收 `RequirementService.saveRequirement` 已生成的页面 `semantic_contract`，不得从 baseline 自己的 `features`、`fields` 或 `interactions` 字符串重建机器语义。
2. 同一个 `baseline_page` 的 `copy_texts`、`navigation_targets`、`component_keys` 按去重后字典序合并；`fields[]` 和 `actions[]` 按 `key` 合并并保留 `key + label + source`。
3. 多个 source requirement 给出同一个 field/action `key` 且 `label` 不一致时，整个 `saveRequirement` 必须失败并返回 `BASELINE_SEMANTIC_CONTRACT_CONFLICT`，details 包含 `baseline_page`、`key`、冲突 labels 和 `source_requirements[]`；不得写入 requirement、baseline 或 translations 的半成品。
4. requirement 被更新、归档或从该 baseline page 移除时，baseline page 的 `semantic_contract` 必须从剩余 active source requirements 重新计算，不能保留已经移除来源的字段、动作、组件或 copy。
5. 如果剩余 source requirements 为空，baseline page 从 `baseline.yaml.pages[]` 删除；如果只剩 normalizer 生成的 minimal 契约，baseline page 保留 minimal contract，但 active session 仍按 requirement 页面的 `semantic_contract_coverage` 决定是否阻断新增语义。

`RequirementService.saveRequirement` 必须从 `copy[]`、页面名、navigation、product rules `semantic`、baseline 等价 label、`declared_fields[]`、`declared_actions[]` 和 `declared_component_keys[]` 生成 `semantic_contract`。`copy-translations.yaml` 只在 begin design session 时按目标语言派生 `AllowedSemanticSurface.allowed_copy`，不写入 `semantic_contract.copy_texts`。`baseline.yaml.pages[].semantic_contract` 是聚合输出，不参与当前 requirement contract 生成。如果 product rules 或 requirement payload 中已经提供结构化语义，但字段缺失、key 为空、label 为空、同一 key 多个 label 冲突或 component key 格式非法，必须返回 `SEMANTIC_CONTRACT_BUILD_FAILED`；如果只有 `features`、`fields`、`interactions`、`given`、`when` 或 `then` 自由文本提到这些语义，builder 不推断、不失败，生成的 contract 对应数组保持为空，后续 `fm-design` 遇到相关设计请求时按 `REQUIREMENT_UPDATE_REQUIRED` 阻断。`declared_component_keys[]` 的 key 存在性在 `fm-design` 开始前结合当前产品组件库校验；组件库尚未生成时，`fm-design` 先执行产品级组件库初始化 macro，再用生成后的 `components.yaml` 校验 key。

`semantic_contract` 的写入落点固定如下：

1. 新增 `packages/core/src/semantic-contract.ts`，导出 `buildSemanticContractForPage({ product, requirement, page, navigation, baselinePageLabel, productRules })`。`baselinePageLabel` 只能提供当前页面的等价 label，不得携带或读取 baseline 聚合 `semantic_contract`。
2. `packages/core/src/requirement.ts` 新增 `semanticContractSchema`，`requirementPageSchema` 必须要求 `semantic_contract` 存在；v6 strict schema 不接受缺失该字段的页面。
3. `save_requirement` 的 external MCP payload 不接受调用方传入 `semantic_contract`。`packages/mcp/src/tools.ts` 的 `requirementPageInputSchema` 接收用户可编辑需求字段和 `declared_fields`、`declared_actions`、`declared_component_keys`；`RequirementService.saveRequirement` 在写入前统一生成并校验 `semantic_contract`，然后把它写入 `requirement.yaml.pages[]` 并在 `get_requirement` / Web API 响应中返回。
4. `copy_texts` 只能来自 page `copy[].text`、页面 `name`、baseline 等价 label、`semantic_contract.fields[].label`、`semantic_contract.actions[].label` 和 product rules `semantic.copy_texts`，并固定表示 product `default_language` 下的 canonical copy；`navigation_targets` 只能来自 requirement `navigation[]` 中 `from === page.page_id` 的边，并只保存这些边的 `to` page_id；`fields` 只能来自 `declared_fields[]` 或 product rules `semantic.fields[]`；`actions` 只能来自 `declared_actions[]` 或 product rules `semantic.actions[]`；`component_keys` 只能来自 `declared_component_keys[]` 或 product rules `semantic.component_keys[]`。`fm-design` 建立 session 时再把 `semantic_contract.component_keys[]` 与当前需求组件快照中的 `component_key` 取交集，得到 `allowed_component_keys[]`。以上字段都不能从 baseline 聚合契约、translations、`features`、`fields`、`interactions`、`given`、`when` 或 `then` 自由文本猜测。
5. `save_requirement` 只在结构化语义输入本身无效、冲突或引用缺失时失败并返回 `SEMANTIC_CONTRACT_BUILD_FAILED`，details 包含 `page_id`、字段路径和失败原因。自由文本说明中出现但未结构化声明的字段、动作、组件或导航不会触发保存失败，也不会进入 `semantic_contract`；后续设计请求如果需要这些语义，`fm-design` 必须返回 `REQUIREMENT_UPDATE_REQUIRED`。
6. schema 归一化为旧页面生成的最小契约也必须调用同一个 builder 的 minimal mode；normalizer 不能维护第二套推断规则。

多语言 copy 只在 session 语义面中展开，规则固定如下：

1. `begin_requirement_design_session` 输入可以携带 `design_language?: Language`；省略时使用 product `default_language`。
2. `semantic_contract.copy_texts` 始终保存 canonical default-language copy，不保存所有语言翻译。
3. `AllowedSemanticSurface.allowed_copy` 只包含本次 `design_language` 下允许出现的文本：当 `design_language === default_language` 时来自 `semantic_contract.copy_texts`；其他语言必须来自 `copy-translations.yaml` 中同一 page/context 且 `outdated !== true` 的翻译，缺失时返回 `SEMANTIC_CONTRACT_REQUIRED`，不得混用其他语言文本。
4. 非 default language 的 translation context 固定为：页面 `copy[].context` 原值、页面名 `page.name`、baseline 等价 label `baseline.label`、字段 label `semantic.field.{key}.label`、动作 label `semantic.action.{key}.label`、product rule 固定 copy `product_rule.{rule_id}.copy.{index}`。这些 context 缺失、语言 key 缺失或 `outdated: true` 时，不得回退到 default language。
5. `source_contract_hash` 必须包含 `design_language`、参与本次 session 的 translation entry hash 和 canonical `semantic_contract` hash；begin 后翻译或 canonical contract 改变时，commit 返回 `SEMANTIC_SCOPE_CHANGED`。

页面的 frame、预览和历史信息只能从需求级 `design.yaml` 读取。v6 不再写入页面级 `D-*` 目录，也不再把 `D-*` 当作状态、预览或历史索引。

v6 的 `requirement.yaml.pages[]` 字段契约：

1. 页面主键继续是 `page_id`，不得新增或接受 `id` alias。
2. `baseline_page` 保留为需求页面与 baseline 页面之间的业务映射字段；它不是设计稿主键，也不能替代 `page_id`。
3. `design_status` 是 `requirement.yaml` 中唯一允许保留的设计状态字段。
4. `semantic_contract` 是设计语义校验字段，不是设计状态字段；它必须在页面进入 `fm-design` 前存在。
5. `design_id` 必须从 v6 schema、保存路径、MCP payload、agent prompt 和后台 UI 中删除。schema 归一化后运行时不得接受它，也不得用它查找 preview、history 或 rollback。
6. `packages/core/src/requirement.ts` 的页面 schema 必须保留 `page_id`、`name`、`baseline_page`、`design_status`、`semantic_contract`、`semantic_contract_coverage`、`declared_fields`、`declared_actions`、`declared_component_keys` 以及需求描述所需的非设计字段，并删除 `design_id`。
7. `SEMANTIC_CONTRACT_REQUIRED` 不表示 strict schema 可接受缺失字段。它只在已归一化页面带有 `semantic_contract_coverage: minimal`，且本次设计请求需要的字段、动作、导航、组件或业务 copy 不在最小契约中时返回。真正缺失 `semantic_contract` 的 YAML 是数据损坏，必须返回 schema validation error 并指向 normalizer/recovery。

## Pencil App 可视化工作流

Pencil CLI 已确认支持 app-bound interactive 模式：

```text
pencil interactive --app desktop --in <staging.pen>
```

v6 对 Pencil CLI 的最低要求不是固定版本号，而是运行时能力。能力检查分两段，顺序不能合并：

1. **preflight probe**：在创建产品级 lease、局部 `active.yaml`、session 目录或 staging 文件之前执行，只验证 `pencil version` 可执行、`pencil status` 已认证、`pencil interactive --help` 支持 interactive shell，以及 desktop app adapter 可达但不打开业务 `.pen`。desktop adapter 探测必须使用一次性 probe 目录 `$FORMA_HOME/.pencil-preflight/{probe_id}/`：后端在其中写入最小合法 `probe.pen`，执行 `pencil interactive --app desktop --in <probe.pen>`，调用 `get_editor_state({ include_schema: true })` 和 shell 内 `save()`，确认进程存活、返回 schema、保存后的 `probe.pen` 可读且 Pencil schema 有效后终止该 shell 并删除 probe 目录。probe 目录不属于 session 目录，不能写产品级 lease、局部 `active.yaml`、`design_session.yaml` 或业务 staging 文件；清理失败只写 `preflight_cleanup_warning`，不得被后续设计路径读取。preflight 失败时返回 `PENCIL_CLI_NOT_FOUND`、`PENCIL_NOT_AUTHENTICATED`、`PENCIL_CAPABILITY_UNAVAILABLE` 或 `PENCIL_APP_REQUIRED`，不得创建任何 lease 或 session 文件。
2. **open probe**：begin transaction 创建 session-owned `staging.design.pen` 或 `staging.lib.pen` 后，执行 `pencil interactive --app desktop --in <staging.pen>` 打开或连接桌面 App。open probe 失败时必须按 begin rollback 规则清理本次创建的 lease、active file、staging 文件和空 session 目录，并返回 `PENCIL_APP_REQUIRED`，details 包含 `session_id`、`failed_phase: "open_app"`、command、reason、cleanup_status 和探测到的 Pencil version（如果可读取）。

Pencil probe 和 session wrapper 的超时必须固定，不能让 API 请求无限等待：

1. `pencil version`、`pencil status`、`pencil interactive --help` 每个命令 timeout 固定为 10 秒；超时分别返回 `PENCIL_CLI_NOT_FOUND`、`PENCIL_NOT_AUTHENTICATED` 或 `PENCIL_CAPABILITY_UNAVAILABLE`，details.reason 固定为 `timeout`。
2. desktop adapter preflight probe timeout 固定为 45 秒，包含启动 shell、`get_editor_state({ include_schema: true })`、`save()` 和退出 shell；超时返回 `PENCIL_APP_REQUIRED`，details.failed_phase 为 `preflight_app_probe`。
3. open probe timeout 固定为 60 秒；超时必须执行 begin rollback，返回 `PENCIL_APP_REQUIRED`，details.failed_phase 为 `open_app_timeout`。
4. session wrapper 的进程存活检查 timeout 固定为 5 秒；受控 `save()` timeout 固定为 30 秒；`session_export_nodes` 单次导出 timeout 固定为 60 秒。超时不允许重试并继续写入，必须返回对应 stable error。
5. `session_get_editor_state` 单次调用 timeout 固定为 15 秒；prompt 前置检查或 open probe 中超时返回 `PENCIL_CAPABILITY_UNAVAILABLE`，details.failed_phase 固定为 `editor_state_timeout`。
6. `session_get_variables` 单次调用 timeout 固定为 15 秒；prompt 前置检查中超时返回 `PENCIL_CAPABILITY_UNAVAILABLE`，details.failed_phase 固定为 `variables_timeout`。
7. `session_get_guidelines` 单次调用 timeout 固定为 20 秒，包括列表读取和具体 guide/style 读取。必需 guide 的列表读取、内容读取、schema 校验或 timeout 失败都返回 `PENCIL_CAPABILITY_UNAVAILABLE`，details.failed_phase 固定为 `guideline_load`，details.missing_guidelines 必须列出受影响 guide。
8. `session_batch_get` 单次调用 timeout 固定为 15 秒；`session_snapshot_layout` 单次调用 timeout 固定为 15 秒；`session_get_screenshot` 单次调用 timeout 固定为 60 秒。它们在 Design Quality Pipeline 内超时时按对应质量门规则映射：layout / batch_get 证明不完整时返回 `DESIGN_LAYOUT_INVALID`，AI screenshot review 超时时只写 `AI_VISUAL_REVIEW_SKIPPED` warning；在普通 wrapper 调用中超时返回 `PENCIL_CAPABILITY_UNAVAILABLE`，details.failed_phase 使用 `{tool_name}_timeout`。
9. 所有 timeout 值必须在 `packages/core/src/pencil-adapter.ts` 中集中定义并由测试断言；不得散落在 route、MCP handler 或 agent 模板中。

Pencil interactive app session 协议固定为当前 Pencil CLI 已暴露的 shell 能力，不能假设 CLI 存在未验证的 JSON session API：

1. `PencilAppSessionAdapter` 在 begin transaction 内启动一个由 Forma 拥有的 child process：`pencil interactive --app desktop --in <staging.pen>`。`pencil_binding_id` 由 Forma 生成，只是本地 session binding 主键，不是 Pencil App 返回的远端 session id；它必须绑定 `session_id`、child process `pid`、`staging_path` realpath、启动命令、Pencil version 和探测到的 tool capabilities。
2. open probe 成功的判定是：interactive shell 进程仍存活，能够响应 `get_editor_state({ include_schema: true })`，且随后执行 shell 内 `save()` 后，`staging_path` 文件存在、可读、Pencil schema 有效。当前 Pencil CLI 不返回 document path，因此 Forma 只能信任“自己以该 `staging_path` 启动并持有的 shell 子进程”；禁止用任意 PID、窗口标题或用户当前前台文档反推 session。
3. `capabilities[]` 由 `pencil interactive --help` 输出和首次 probe tool call 共同派生。硬要求包含 `get_editor_state`、`get_guidelines`、`batch_get`、`batch_design`、`export_nodes`、`snapshot_layout` 和 shell 内 `save()`；`get_screenshot` 是可选能力；`set_variables` 只在产品组件库 session 中需要。缺失硬要求时 preflight 或 open probe 返回 `PENCIL_CAPABILITY_UNAVAILABLE` 或 `PENCIL_APP_REQUIRED`，不得创建可运行 session。
4. 后续每个 session-scoped wrapper、`apply_*_operations`、`commit_*_session` 和 `discard_*_session` 都必须先读取 `design_session.yaml` 中的 `pencil_binding_id`，确认对应 child process 仍存活且由当前 Forma 进程管理；如果进程已退出，session 进入 `recoverable`，返回 `PENCIL_APP_REQUIRED`，details 包含 `failed_phase: "session_check"`。恢复只能重新执行 open probe 并建立新的 `pencil_binding_id`，不能把未知外部进程接入旧 session。
5. 受控保存只能通过该绑定 shell 发送 `save()` 执行。保存成功后，Forma 重新读取并规范化 `staging_path` 的 `.pen` JSON，计算 `last_saved_revision`；所有 revision 判断以 Forma 计算的文件 hash 为准，不依赖 Pencil 暂未验证的结构化 session 或 revision API。
6. 如果未来 Pencil CLI 增加结构化 session API，adapter 可以在不改变 v6 外部契约的前提下用它增强校验；v6 当前设计不得依赖这些未验证能力。

禁止静默降级到 headless `pencil --out ... --prompt ...`。headless 只允许 `PencilReadExportAdapter` 做只读索引、检查和导出，不允许创建、修改、保存或提交设计稿。

Pencil 访问层必须拆成两个明确 adapter：

1. `PencilAppSessionAdapter`：只用于会创建或修改 `.pen` 的 app-bound session，底层命令是 `pencil interactive --app desktop --in <staging.pen>`。`begin_*_session`、`apply_*_operations`、`commit_*_session` 和 `discard_*_session` 只能通过它处理受控 mutation。
2. `PencilReadExportAdapter`：只用于后台索引、scene 解析、确定性检查、preview/export candidate 生成和只读截图。它可以在无桌面 App 时使用 Pencil interactive 的非绘制/headless 读取或导出能力，但必须把任何 `--out`、`outputDir` 和临时文件限制在 session-owned 或 index-owned staging 目录；不得对正式 `design.pen` / `*.lib.pen` 调用 `batch_design`、`set_variables`、`save()` 或任何会改变源文件的操作。

现有 `PencilService` 在 v6 中不能继续承担设计生成职责。`generatePageDesign()`、`generateComponents()`、`pencil --out ... --prompt ...` 和旧全局长生命周期 `pencil.lock` 写入路径都必须从 v6 设计写入链路移除。该类只保留为 CLI availability、规范化 `.pen` 校验、只读导出和短事务锁的底层 helper，被上述两个 adapter 包装使用。

`SyncService` 的 Pencil-backed style preview 生成在 v6 删除，不保留 headless 例外。样式同步只导入样式元数据、变量和 `DESIGN.md`；后台样式预览由 Web 端 `StylePreviewPanel` 从这些结构化变量确定性渲染，不创建、不修改、不导出任何 preview `.pen`，也不调用 `pencil --in ... --out ... --prompt ...`。`scripts/live-style-sync.ts` 改成验证样式元数据和 Web token preview 输入，不再要求 `$FORMA_HOME/styles/{style}/preview@2x.png` 存在。已有静态 preview 文件如果来自样式包，可以作为只读附加资源展示，但 v6 runtime 不生成或刷新它们。

v6 设计流程：

```text
fm-design / rollback UI / design UI
  -> begin_requirement_design_session(product_id, requirement_id, page_id?, operation: generate | refine | rebuild | rollback | component_refresh)
       -> run Pencil preflight probe before creating any lease or session file
       -> fail with PENCIL_APP_REQUIRED / PENCIL_CLI_NOT_FOUND / PENCIL_NOT_AUTHENTICATED if preflight fails
       -> ensure product component library metadata exists
       -> fail before creating lease with COMPONENT_LIBRARY_VERSION_MISSING / COMPONENT_LIBRARY_METADATA_MISSING / COMPONENT_LIBRARY_LATEST_MISSING / COMPONENT_LIBRARY_INVALID if product library is not initialized or invalid
       -> ensure requirement directory exists
       -> acquire product mutation lock for begin transaction only
       -> acquire pencil lock for begin transaction only
       -> create product active-design-session.yaml lease
       -> create sessions/active.yaml lease before opening the app
       -> if design.pen exists, copy it to sessions/{session_id}/staging.design.pen and record base_canvas_revision
       -> if design.pen is missing, write a minimal legal empty sessions/{session_id}/staging.design.pen before open probe and mark canvas_state as created_empty
       -> keep existing pinned component library version when formal design.pen and design.yaml.component_library exist
       -> open/connect Pencil App with staging.design.pen
       -> if App cannot be opened, run begin rollback and fail with PENCIL_APP_REQUIRED
       -> run a controlled save through the connected App, then compute started_revision from the saved staging file
       -> locate existing target page frame without creating or mutating frame nodes
       -> derive allowed semantic surface from requirement and write semantic_scope.yaml
       -> write design_session.yaml, release product mutation lock and pencil lock
       -> return session_id, pencil_binding_id, canvas_path, staging_path, canvas_state, component version, component snapshot requirement and page frame metadata

agent performs controlled Pencil operations in visible Pencil App on staging_path
  -> read Pencil context through session-scoped read/export tools
  -> if component snapshot or target page frame is missing, submit those bootstrap mutations through apply_requirement_design_operations
  -> submit every Pencil write through apply_requirement_design_operations(session_id, operations)
  -> user can visually inspect all pages in one canvas

commit_requirement_design_session(session_id, page_id?, frame_id?, ai_visual_review?)
       -> acquire product mutation lock for commit transaction only
       -> acquire pencil lock for commit transaction only
       -> flush/save the connected Pencil App document to staging.design.pen
       -> hash the persisted staging.design.pen and reject if it is not the last controlled revision
       -> reject if formal design.pen changed since base_canvas_revision
       -> validate staging.design.pen
       -> for page_commit, verify target frame by page_id + frame_id
       -> for component_refresh, verify every affected page frame by page_id + frame_id from planned_affected_pages
       -> run deterministic Design Quality Pipeline for target frame or affected component_refresh frames, including preview_export to session preview candidates
       -> merge optional agent-provided AI screenshot review as non-blocking quality metadata
       -> keep passed preview candidates for the commit journal promotion step
       -> write history candidate from staging.design.pen
       -> promote staging.design.pen, preview, history and design.yaml through requirement commit journal
       -> for page_commit, update requirement page design_status
       -> update requirement design.yaml, preserving component_library.version and quality_report
       -> clear product active-design-session.yaml lease and sessions/active.yaml lease, then release locks
```

需求级 begin 的组件库预检必须在创建产品级 lease 前完成。规则固定如下：

1. `begin_requirement_design_session` 直接读取 `get_product_component_library(product_id)` 的同一判定逻辑；如果 `initialized !== true`，不得创建 `active-design-session.yaml`、局部 `active.yaml`、session 目录或 staging 文件。
2. `status: "missing"` 或 `"version_snapshot_missing"` 返回 `COMPONENT_LIBRARY_VERSION_MISSING`，details 包含 `product_id`、`status`、`components_yaml_path` 和 `required_action: "generate_components"`。
3. `status: "metadata_missing"` 返回 `COMPONENT_LIBRARY_METADATA_MISSING`；`status: "latest_file_missing"` 返回 `COMPONENT_LIBRARY_LATEST_MISSING`；`status: "invalid"` 返回 `COMPONENT_LIBRARY_INVALID`。
4. `fm-design` 可以在 begin 前通过 `generate_components` agent macro 创建产品级组件库；但 begin API 本身不能自动启动 macro，也不能用临时页面组件绕过产品级组件库。
5. 如果当前产品和当前需求都没有声明任何 `semantic_contract.component_keys[]`、`declared_component_keys[]` 或 product rules `semantic.component_keys[]`，`generate_components` agent macro 仍必须创建一个空产品组件库版本，而不是跳过组件库初始化。空版本的 `components.yaml.components` 固定为 `[]`，对应版本 `.lib.pen` 可只包含最小合法空组件库文档；它视为 initialized，并允许需求主画布嵌入一个空的 `Components - Snapshot v{version}` frame。后续 `component_refresh` 在没有 linked usage 时按 `COMPONENT_REFRESH_PARTIAL_BLOCKED` 处理，不把空组件库视为 metadata 缺失。

锁和 session lease 的边界固定如下：

1. `product mutation lock` 和 `pencil lock` 只在单个 backend transaction 内持有：begin、apply、commit、discard 各自获取并释放，不能跨 MCP/tool/API 调用长期持有。
2. 跨调用并发由产品级 `active-design-session.yaml`、局部 `active.yaml`、`design_session.yaml.status`、`pencil_binding_id`、`staging_path` 和 revision hash 共同约束。
3. 只要产品级 `active-design-session.yaml` 或局部 `active.yaml` 指向非 terminal session，新 begin 必须返回 `DESIGN_SESSION_ACTIVE`。用户只能继续同一 session 的 apply/commit/retry，或 discard 后开始新 session。
4. `apply_requirement_design_operations`、`apply_product_component_operations`、`commit_*_session` 和 `discard_*_session` 每次执行前都必须短暂获取 product mutation lock 与 pencil lock，先校验产品级 lease，再校验局部 `active.yaml.session_id`，然后才能读写 `.pen`、`design.yaml`、`components.yaml` 或 session 状态。

`begin_requirement_design_session` 和 `begin_product_component_session` 的失败清理规则必须固定，避免 Pencil App 不可用后留下僵尸 lease：

1. `pencil version`、`pencil status`、`pencil interactive --help` 和不打开业务 `.pen` 的 desktop adapter preflight 必须先于产品级 `active-design-session.yaml` 写入执行。能力探测失败时直接返回 `PENCIL_APP_REQUIRED` / `PENCIL_CLI_NOT_FOUND` / `PENCIL_NOT_AUTHENTICATED`，不得创建 lease。
2. 一旦 begin transaction 已创建产品级 lease、局部 `active.yaml`、session 目录或 staging 文件，但尚未把 `design_session.yaml.status` 写为 `running`，任何写入最小空 staging、打开 App、受控 `save()` 或计算 `started_revision` 失败，都必须执行 begin rollback：只在 lease 中的 `session_id` 与本次 session 匹配时删除产品级 lease 和局部 `active.yaml`，删除本次创建的 staging 文件和空 session 目录，并把失败摘要写入 `sessions/failed-begins/{session_id}.yaml` 或 `$FORMA_HOME/library/{product_id}.sessions/failed-begins/{session_id}.yaml`。
3. begin rollback 成功后，该失败不占用产品级 lease；下一次 begin 可以重新开始。返回错误 details 必须包含 `session_id`、`failed_phase`、`command`、`reason` 和 `cleanup_status`。
4. 如果失败发生在 `design_session.yaml.status: running` 之后，说明已有可审计 session。此时不得删除 session 目录，必须按现有 session 状态机写为 `recoverable`、`failed_operation` 或 `blocked_manual_edit`，并继续占用 lease，直到同一 `session_id` 重试或 discard。
5. `canvas_state: created_empty` 的 begin rollback 只能删除本次创建的 empty staging；正式 `design.pen` 不存在时仍保持不存在。`canvas_state: existing` 的 begin rollback 只能删除从正式文件复制出的 staging，不能修改正式 `design.pen`。

### 组件库版本策略

默认策略是“产品级 latest，需求级 pinned”：

1. 产品组件初始化流程生成产品级组件库，写入 latest 和版本快照。
2. `fm-design` 第一次创建需求主画布时，通过 active session 的受控写操作把当前 latest 组件库嵌入 `staging.design.pen`，commit 成功后推进为正式 `design.pen`，并在 `design.yaml` 记录 `component_library.version`。
3. 需求主画布一旦存在，后续页面生成、refine、rebuild 默认继续使用这个 pinned 版本。
4. `fm-change-style` 和 `fm-refine-components` 只生成新的产品级组件库版本，默认只影响之后新建的需求主画布。
5. 如果用户在 `fm-design` 中明确要求当前需求使用最新组件，才调用显式刷新动作，把产品级 latest 应用到当前需求主画布和已关联页面实例。

产品级组件库生成和更新必须走产品级 app-bound session。本文中的 `generate_components` 只表示 agent route-level macro，不是一次性绘制 MCP handler：

```text
generate_components agent macro / fm-refine-components / fm-change-style
  -> begin_product_component_session(product_id, operation: generate | refine | change_style)
       -> require Pencil App desktop session
       -> acquire product mutation lock for begin transaction only
       -> acquire pencil lock for begin transaction only
       -> create product active-design-session.yaml lease
       -> create library active.yaml lease
       -> create/open staging.lib.pen in Pencil App
       -> write design_session.yaml, release product mutation lock and pencil lock
       -> return session_id, pencil_binding_id, canvas_path, staging_path, previous_version, operation_log_file

agent performs controlled Pencil operations in visible Pencil App
  -> read Pencil context through allowed read-only Pencil tools
  -> submit every Pencil write through apply_product_component_operations(session_id, operations)

commit_product_component_session(session_id, ai_visual_review?)
       -> acquire product mutation lock for commit transaction only
       -> acquire pencil lock for commit transaction only
       -> flush/save the connected Pencil App document to staging.lib.pen
       -> hash the persisted staging.lib.pen and reject if it is not the last controlled revision
       -> validate component metadata, component_key uniqueness and semantic_contract_hash
       -> write version snapshot {version}.lib.pen
       -> update latest lib.pen and components.yaml.current_version through product component commit journal
       -> clear product active-design-session.yaml lease and library active.yaml lease, then release locks
```

`generate_components` 在 v6 中不注册为一次性 MCP 写工具。它是 agent 模板中的宏流程：按顺序调用 `begin_product_component_session`、session-scoped Pencil read tools、`apply_product_component_operations` 和 `commit_product_component_session`。如果安装平台仍需要暴露同名 route，只能暴露 agent route，不能暴露会直接写 `.pen` 的 MCP handler；它不得直接调用 `PencilService.generateComponents()` 或 `pencil --out ... --prompt ...` 生成 headless 结果。

显式刷新当前需求组件时必须是可见、可回滚的操作：

```text
fm-design component_refresh
  -> index_component_usages(product_id, requirement_id, scope)
       -> read committed design.pen only
       -> fail fast before opening Pencil App if usage graph is unmapped or blocked
  -> begin_requirement_design_session(product_id, requirement_id, operation: component_refresh)
  -> refresh_requirement_components(session_id, product_id, requirement_id, version, scope)
       -> rescan component usages from staging.design.pen and ref metadata
       -> compare component_key and semantic_contract_hash
       -> verify current revision equals design_session.last_controlled_revision
       -> generate controlled operations for staging, rebind and cleanup
       -> return base_revision, planned_affected_pages and operations, or throw a stable refresh error
  -> apply_requirement_design_operations(session_id, operations)
  -> commit_requirement_design_session(session_id, ai_visual_reviews?)
       -> update design.yaml component_library and pages[].component_usages
       -> export only affected page previews
```

`index_component_usages` 是 committed canvas 的只读快速预检，用于在 unlinked usage、缺失 metadata、组件库无法映射等确定性失败时避免占用 Pencil App session 和产品级 lease。`refresh_requirement_components` 是 active session 内的权威预检和操作计划生成：它必须重新扫描 `staging.design.pen`，不能信任 preflight 的旧结果；它不直接修改 `.pen`、不导出 preview、不推进 `design.yaml.component_library.version`。实际 `.pen` 写入只能由 active session 中的 `apply_requirement_design_operations` 执行，实际状态推进只能由 `commit_requirement_design_session` 执行。

组件刷新操作计划必须使用 staging 策略：

1. 新组件快照先计划写入临时 frame，例如 `Components - Snapshot v4 (staging)`。
2. 完成 usage 扫描、语义契约校验和实例 rebind 后，再把 staging 快照提升为正式 `Components - Snapshot v4`。
3. 旧快照在同一 session 成功提交前不得删除；失败时删除 staging 快照并保留旧实例引用。
4. 只有所有目标页面 preview 导出成功，才推进 `design.yaml.component_library.version`。

用户在 `fm-design` 中说“更新所有页面相关的通用组件”时，语义等价于：

```text
component_refresh(scope: "all_pages", version: "latest")
```

该动作不是页面 redesign，也不是允许新增业务能力的入口。如果新组件版本改变了语义契约，必须返回 `COMPONENT_CONTRACT_CHANGED`，要求先通过 `fm-requirement` 更新需求。

禁止在 `fm-change-style` 或 `fm-refine-components` 成功后自动双写当前需求 `design.pen`。自动双写会让旧页面在用户无感知的情况下变样，也会制造“产品组件更新成功、需求画布更新失败”的半提交状态。

### Pencil App 强制要求

所有会创建或修改 `.pen` 的设计动作都必须在 Pencil App 中可见执行：

```text
pencil interactive --app desktop --in <staging.pen>
```

Pencil App 不可用时，动作必须失败，不允许后台绘制：

```text
PENCIL_APP_REQUIRED
Pencil App 未连接，无法开始设计
```

Pencil App 是受控可视化执行面，不是自由编辑入口。用户可以查看、取消、重试或确认，但不能手动编辑画布后让 Forma 直接认账。正式提交只能来自 active `design_session.yaml` 对应的受控 session。

如果提交时检测到 session 外修改，必须拒绝提交：

```text
MANUAL_EDIT_DETECTED
当前画布存在非受控修改，不能提交为正式设计
```

如果 agent payload 携带任何文件系统路径参数，必须拒绝执行：

```text
FORBIDDEN_PATH_PARAMETER
Pencil 文件路径和导出目录只能由 Forma session adapter 注入
```

必须使用 Pencil App 的动作：

- 创建需求 `design.pen`
- 生成页面 frame
- refine 页面
- rebuild 页面
- 生成产品级组件库
- refine 产品级组件库
- change style 后重建组件库
- 将最新组件刷新进当前需求画布

允许后台执行的非绘制动作：

- 校验 `.pen` 是否存在、可读、格式有效
- 扫描 frame 并建立 `design.yaml` 索引
- 通过 `PencilReadExportAdapter` 导出 preview candidate 或正式只读导出结果
- 通过 `PencilReadExportAdapter` 和 Forma 规则运行 Pencil 原生与确定性质量检查
- 通过 `PencilReadExportAdapter` 生成页面 screenshot 并执行可选 AI 视觉审查
- 写入 `requirement.yaml` 的 `design_status`
- 写入 `design.yaml` metadata、history、preview index 和 session 状态
- 读取 `.pen` node metadata
- 检查锁和恢复已有 session

写入 `.pen` node metadata 属于 `.pen` mutation，必须在 Pencil App session 中通过 `apply_requirement_design_operations` 执行。

### Design Quality Pipeline

Design Quality Pipeline 是提交前质量门。它只检查或修复当前受控 session 的目标 frame，不创建新页面语义，不绕过 Semantic Scope Guard。

质量流程分四层：

1. Prompt 和工具前置约束。
2. Pencil 原生结构和布局检查。
3. Forma 确定性规则检查。
4. 可选 AI screenshot review。

#### Prompt 和工具前置约束

`fm-design` 开始绘制前必须先完成 `begin_requirement_design_session` 或 `begin_product_component_session`，再通过 session-scoped adapter 加载 Pencil 上下文：

```text
session_get_editor_state(session_id, include_schema: true)
session_get_guidelines(session_id, category: "guide", name: "Design System")
session_get_guidelines(session_id, category: "guide", name: "Mobile App" | "Web App" | "Table")
session_get_variables(session_id)
```

Pencil interactive session 会自动绑定当前打开的 `staging.design.pen` 文件路径；agent 调用 session-scoped tools 时不得传 `filePath`、`file_path`、`canvas_path` 或 `staging_path` 参数。

Pencil 的 raw MCP/file-backed 工具可能暴露 `filePath`、`outputDir` 或其他文件系统路径参数；app-bound interactive shell 会自动绑定当前文件，部分只读工具不需要该参数。Forma 的规则统一为：凡底层工具 schema 存在文件路径或导出目录参数时，这些参数只能由 Forma session adapter 注入。对 requirement design session 注入 `design_session.staging_path` 和 session-owned output dir；对 product component session 注入 `component_session.staging_path` 和 session-owned output dir。

`FORBIDDEN_PATH_PARAMETER` 只适用于 agent 提供的输入，不适用于后端返回值。具体边界如下：

1. Agent-facing MCP/API 输入、agent prompt 中的 tool args、`apply_requirement_design_operations.operations[].args` 和 `apply_product_component_operations.operations[].args` 如果出现 `filePath`、`file_path`、`canvas_path`、`staging_path`、`outputDir`、`output_dir`、`path`、`pen_path`、`preview_path` 或 `history_path`，必须在执行前返回 `FORBIDDEN_PATH_PARAMETER`，不得把 agent 提供的路径传给 Pencil MCP。
2. 后端工具返回值可以包含 `canvas_path`、`staging_path`、`preview_path`、`library_path`、`version_path`、`history_path` 或 `path`，这些字段只能用于展示、审计和后续非路径主键调用；调用方不得把返回路径再作为写工具输入传回。
3. session-scoped read/export wrapper 是调用 Pencil 只读和导出工具的唯一 agent-facing 入口；`apply_requirement_design_operations` 和 `apply_product_component_operations` 是调用 Pencil 写工具的唯一位置。它们内部按底层 schema 需要注入路径或导出目录后再调用 Pencil MCP。

platform-specific guide 的映射：

| product platform | Pencil guide |
| --- | --- |
| `mobile` | `Mobile App` |
| `tablet` | `Mobile App` |
| `web` | `Web App` |
| `desktop` | `Web App` |
| dashboard/table-heavy page on `web` or `desktop` | `Table` + `Web App` |
| dashboard/table-heavy page on `mobile` or `tablet` | `Table` + `Mobile App` |

guide 加载失败是能力缺失，不允许静默跳过：

1. `get_guidelines()` 列表中必须存在 `Design System` 以及由 platform 映射出的 `Mobile App` 或 `Web App`；table-heavy 页面还必须存在 `Table`。
2. 任一必需 guide 缺失、返回空内容、返回 schema 不合法或超时，`begin_*_session` 后的 prompt 前置检查必须返回 `PENCIL_CAPABILITY_UNAVAILABLE`，details.missing_guidelines 列出缺失 guide；不得继续生成设计。
3. `Table` 只在页面被 requirement/baseline/product metadata 标记为 table-heavy 时是硬要求；是否 table-heavy 必须来自结构化字段或页面类型，不能由 agent 看自由文本后主观决定。

设计 prompt 必须包含颜色和属性约束：

- 颜色只能使用 `$--variable` 或 hex。
- 普通颜色使用 `#RRGGBB`。
- 需要透明度时使用 `#RRGGBBAA`。
- 禁止 `rgb()`、`rgba()`、`hsl()`、named color 和 CSS shorthand。
- `fill`、`stroke.fill`、`effect.color`、text/icon color 都必须遵守同一规则。
- `letterSpacing`、`padding`、`gap`、`cornerRadius` 等属性必须使用 Pencil schema 接受的类型；不能写数组值给只接受 scalar 的属性。

#### 硬校验

以下检查失败时必须阻断提交，不导出正式 preview，不推进 `design_status`：

| check | source | blocker |
| --- | --- | --- |
| `pencil_schema` | `session_get_editor_state(include_schema: true)` + Pencil operation validation | `.pen` 无法被 Pencil 打开、schema 不合法、batch operation rollback；blocker code 固定为 `PENCIL_SCHEMA_INVALID` |
| `color_format` | `session_batch_get` / property scan | 出现 `rgb()`、`rgba()`、`hsl()`、named color、无法解析变量或非法 hex |
| `property_compatibility` | Pencil schema + `batch_design` issues | 属性写到不支持的 node type，或属性类型错误 |
| `layout_snapshot` | `session_snapshot_layout(problemsOnly: false, parentId: frame_id, maxDepth: 8)` + 必要时分批扫描 descendants；`problemsOnly: true` 只作为附加 signal | 命中下方 `layout_snapshot` 阻断阈值 |
| `preview_export` | `session_export_nodes` to session preview candidate | 目标 frame 无法导出非空 PNG |
| `semantic_scope` | Semantic Scope Guard | 出现需求外业务元素 |

`layout_snapshot` 的阻断规则必须只依赖当前已验证的 Pencil 输出，不能假设存在未确认字段：

1. 当前质量门的必需输入是 `session_snapshot_layout(problemsOnly: false, parentId: frame_id, maxDepth: 8)` 返回的布局树字段：`id`、`x`、`y`、`width`、`height` 和 `children`；以及 `session_batch_get` 返回的 node type、metadata、`clip`、`rotation`、`textGrowth`、ref/component 信息和可见性字段。
2. v6 不依赖 Pencil 当前未暴露的 `absoluteBounds`、`visibleBounds`、`clipBounds`、`problemCode`、`parentId` 或 layout node `type`。如果未来 Pencil CLI 增加这些字段，必须先通过 adapter capability probe 标记为 `layout_bounds_v2`，补测试后才能让质量门使用；未探测到该 capability 时不得读取这些字段。
3. `critical node` 指满足任一条件的节点：非空 text、Forma metadata 中存在 `action_key`、`navigation_target`、`field_key`、`kind: component_instance`，Pencil/scene 类型为 form/input/button 语义，或 `metadata.type !== "forma"` / `metadata.kind !== "decorative"` 且可见面积大于 0。
4. `session_snapshot_layout` 返回目标 frame 自身负尺寸、零尺寸、缺少 `id/x/y/width/height`、`children` 结构无法解析，直接阻断。
5. adapter 通过累加父子 `x/y` 计算 axis-aligned absolute rect；面积固定为 `max(width, 0) * max(height, 0)`，重叠面积使用两个 absolute rect 的 intersection。这个计算只用于质量门，不写回 `.pen`。
6. critical node 超出目标页面 frame、在任一 `clip: true` 的 ancestor frame 内可见面积小于原面积 95%，或与另一个 critical node 的重叠面积超过较小节点面积 25%，返回 `DESIGN_LAYOUT_INVALID`。
7. decorative node 的 clip、超界或重叠只写 warning，除非它遮挡 critical node 超过该 critical node 面积 10%；无法用当前 layout tree 和 `clip` 信息证明遮挡面积小于 10% 时，按 blocker 处理，reason 为 `decorative_overlap_unproven`。
8. 如果 `problemsOnly: true` 返回的结果不是 `"No layout problems."` 且 adapter 无法用当前字段映射到具体可证明的 warning，critical node 相关问题按 blocker 处理；非 critical node 相关问题写 warning，并记录原始 Pencil 返回摘要。
9. `session_snapshot_layout` 自身失败、超时或无法读取目标 frame 时，`layout_snapshot` 视为 blocked，不能降级为 warning。

`layout_snapshot` 的扫描深度必须显式控制，不能依赖 Pencil CLI 省略 `maxDepth` 时只返回直接子节点的默认行为：

1. `validate_requirement_design_quality`、`commit_requirement_design_session` 和 index-mode quality pipeline 首次调用必须传 `maxDepth: 8`。
2. 如果返回结果中存在被截断的 descendants、`children: "..."`、`omitted_children_count > 0`、adapter 自己的 `truncated: true` 标记，或任一 node 表示还有未扫描子树，则必须对这些 node 继续调用 `session_snapshot_layout(problemsOnly: false, parentId: node_id, maxDepth: 8)`。
3. 分批扫描直到所有可能包含 critical node 的 descendants 都被覆盖。只读 `batch_get` 已确认某个子树没有 text、metadata action/navigation/field、component instance、form/input/button 语义、可见非 decorative node 时，才允许跳过该子树，并写入 `quality_report.warnings[]`，code 为 `LAYOUT_SUBTREE_SKIPPED_DECORATIVE_ONLY`。
4. 如果 adapter 或 Pencil CLI 无法证明扫描完整，例如连续分批后仍返回 truncation marker、某个子树读取失败、node id 不稳定或扫描超时，`layout_snapshot` 必须返回 `blocked`，blocker code 使用 `DESIGN_LAYOUT_INVALID`，reason 为 `layout_scan_incomplete`。
5. `session_snapshot_layout` agent-facing wrapper 可以允许调用方传 `maxDepth`，但质量门内部不得省略该字段；质量门选择的默认值固定为 8，后续调整必须改文档和测试。

`layout_snapshot` 的运行上限也必须固定：

1. 单个页面 quality scan 的 layout 阶段总 timeout 固定为 120 秒，包含初次 `session_snapshot_layout`、后续分批 `session_snapshot_layout` 和用于证明 decorative-only 的 `session_batch_get`。
2. 分批队列最多处理 500 个待展开 parent node，最多累计读取 5000 个 layout node。超过任一上限时返回 `DESIGN_LAYOUT_INVALID`，reason 为 `layout_scan_limit_exceeded`，不得把超限页面标记为 `done`。
3. 每个 `session_snapshot_layout` 子调用 timeout 固定为 15 秒；每个辅助 `session_batch_get` 子调用 timeout 固定为 15 秒。
4. adapter 必须在 `quality_report.hard_checks.layout_snapshot_details` 中记录 `scanned_node_count`、`expanded_parent_count`、`truncated_parent_count`、`elapsed_ms` 和命中的 limit；如果返回 `DESIGN_LAYOUT_INVALID` blocker，同一对象还可以复制到 `blocker.details.layout_snapshot_details`。UI 和测试只能依赖 `hard_checks.layout_snapshot_details`，不能只解析自然语言 message。
5. 如果产品确实需要超过这些上限的大型页面，必须先调整本文档和测试中的固定上限；实现不得用隐藏配置或环境变量绕过质量门。

`layout_snapshot` 的几何计算边界固定如下，避免不同实现主观判断：

1. 硬校验只使用当前 Pencil `snapshot_layout` 的布局树、`session_batch_get` 的 node 属性和 Forma/Pencil metadata；不得用 screenshot 像素或 LeaferJS 渲染结果反推 blocker。
2. 对存在 rotation、scale、skew、transform matrix、mask、non-rect clip、component ref 展开后 shadow bounds、字体裁切但当前 Pencil 未提供可验证 bounds 的 critical node，质量门必须返回 `DESIGN_LAYOUT_INVALID`，reason 为 `layout_geometry_unsupported`，不得降级为 warning。
3. 对存在上述 unsupported geometry 的 decorative node，只写 warning，除非它的 axis-aligned rect 与任一 critical node 相交且无法证明遮挡面积小于 10%；无法证明时按 critical blocker 处理，reason 为 `decorative_overlap_unproven`。
4. `visible_area_ratio` 在当前字段下固定为 `intersection(node_rect, nearest_clipping_ancestor_rect_or_page_rect).area / node_rect.area`。`node_rect.area === 0` 的 critical node 直接 blocked；decorative node 写 warning。
5. 文本裁切不靠字体实际渲染估算。只有 Pencil `snapshot_layout` / `batch_get` 明确返回 text overflow / clipped problem，或 critical text 使用 `textGrowth: "fixed-width-height"` 且当前 adapter 无法证明内容未溢出时，才作为 blocker；reason 为 `text_overflow_unverified`。`textGrowth: "auto"` 和 `"fixed-width"` 按当前 layout tree 返回的 `width/height` 参与普通 bounds 检查。
6. ref instance 默认不展开 descendants 做 blocker 计算；若 instance 本身是 critical，则检查 instance bounds。只有页面内显式 override 的 descendant 会作为独立 critical node 参与扫描。
7. 这些规则必须在 `design-quality` 单元测试中覆盖：普通重叠、clip 小于 95%、decorative 遮挡 critical、rotation unsupported、mask unsupported、fixed-width-height overflow unverified、ref instance 不展开、truncation 后分批扫描完整，以及缺少 `layout_bounds_v2` 时不得访问 `absoluteBounds` / `visibleBounds` / `problemCode`。

`preview_export` 的执行顺序固定为质量门内部步骤：导出目标 frame 到当前 session 目录下的临时 preview candidate，例如 `sessions/{session_id}/previews/{page_id}@2x.png`。只有该候选文件存在、非空且 PNG 签名有效时，`preview_export` 才算 passed。正式 `previews/{page_id}@2x.png` 只在 commit journal 的正式替换阶段替换；质量门不得先写正式 preview。

preview 相关错误码边界固定如下，不能互换：

1. `PREVIEW_EXPORT_FAILED` 只表示生成或校验 preview candidate 的写入流程失败：Design Quality Pipeline、index-mode quality pipeline、`commit_requirement_design_session` 或 `rollback` commit 中无法通过 `session_export_nodes` / `PencilReadExportAdapter` 导出目标 frame，或导出的 candidate 为空、不是有效 PNG、路径越界、hash 校验失败。它是当前候选设计无法提交的质量门错误，HTTP status 固定为 422；失败时不得替换正式 preview，不得推进 `design_status`。
2. `PREVIEW_NOT_EXPORTED` 只表示读取已提交数据时发现数据完整性缺口：`design.yaml.pages[].status === "done"`、history 或 scene payload 声称 preview 应可用，但 `preview_file` 缺失、不可读、hash 与 `design.yaml.file_hashes.previews` 不一致，或无法生成 `preview_url`。它不是一次导出尝试失败，HTTP status 固定为 409；读取 API 必须暴露缺失的 `page_id`、`preview_file` 和 `canvas_revision`，不得在读取路径中重新导出、修改 `.pen` 或推进页面状态。
3. `get_requirement_design_scene.pages[].preview_state` 使用 `missing` 时必须同时返回或记录 `PREVIEW_NOT_EXPORTED` 的数据完整性详情；使用 `pending` 或 `expired` 时不是错误码。

`color_format` 允许确定性自动修复：

```text
rgb(255, 56, 92)      -> #FF385C
rgba(0, 0, 0, 0.10)   -> #0000001A
```

自动修复不由 `validate_requirement_design_quality` 直接写入 `.pen`。该工具只返回 `repair_plan.operations[]`，调用方必须通过 `apply_requirement_design_operations(intent: "quality_repair")` 执行，之后再次调用 `validate_requirement_design_quality`。commit 阶段如果仍发现可修复但未应用的问题，必须失败并返回对应错误码，不能在 commit 内隐式修改 staging。

Pencil schema 不合法时返回：

```text
PENCIL_SCHEMA_INVALID
Pencil 文件结构不符合当前 Pencil schema，不能提交
```

不能确定性转换时返回：

```text
PENCIL_COLOR_INVALID
Pencil 颜色只能使用 $--variable、#RRGGBB 或 #RRGGBBAA
```

属性类型不合法时返回：

```text
PENCIL_PROPERTY_INVALID
Pencil 属性类型不合法：letterSpacing 不能使用数组值
```

布局硬错误返回：

```text
DESIGN_LAYOUT_INVALID
目标页面命中 layout_snapshot 阻断阈值
```

#### Warning 检查

以下检查只写入 `quality_report.warnings`，不阻断提交：

- 移动端触控目标小于 Pencil guide 推荐值，但不影响可读性。
- 页面 title 字号和同需求其他页面不完全一致。
- 间距没有完全落在当前组件库常用 scale 上，但视觉上未错乱。
- 截图审查发现轻微边距或层级建议。
- AI 视觉能力不可用或 review 超时。

`DesignQualityReport.status` 的汇总规则必须固定：

1. 任一 hard check 为 `blocked` 时，`status: "blocked"`，不得提交。
2. 所有 hard check 都通过或被受控修复后，如果 `warnings[]` 非空，`status: "warning"`，允许提交。
3. 所有 hard check 都通过或被受控修复、且 `warnings[]` 为空时，`status: "passed"`。
4. `ai_visual_review.status: "warning"` 必须写入 `warnings[]` 并让整体状态为 `warning`，但仍不阻断提交。
5. `ai_visual_review.status: "skipped"` 只有在 reason 为 `model_has_no_vision`、`screenshot_failed` 或 `timeout` 时写入 `warnings[]`，warning code 固定为 `AI_VISUAL_REVIEW_SKIPPED`；`not_requested` 不写 warning，不能单独让整体状态变成 `warning`。

#### 可选 AI Screenshot Review

AI screenshot review 在硬校验通过后执行：

```text
session_get_screenshot({ session_id, nodeId: frame_id })
```

执行条件：

1. 当前 agent 明确具备图片理解能力。
2. screenshot 获取成功。
3. 目标 frame 已通过 `session_snapshot_layout` 和 `preview_export`。

审查范围只包括：

- 排版是否明显错乱
- 元素是否明显重叠或贴边
- 文字是否明显溢出或不可读
- 关键内容是否被遮挡
- 页面边距和视觉层级是否明显异常

这些 AI screenshot review 项只生成自然语言 warning，不产生 stable blocker code，也不参与 `DesignQualityReport.status` 的 passed/blocked 硬判定；它们只会按上方汇总规则把整体状态从 `passed` 提升为 `warning`。硬阻断只能来自上方确定性检查。

AI screenshot review 不允许：

- 修改 requirement copy
- 新增业务入口或组件
- 覆盖 Pencil guideline 或 `session_snapshot_layout` 结果
- 自动触发 redesign
- 阻断提交

如果 agent 不具备视觉能力，`quality_report.ai_visual_review` 记录 `{ status: "skipped", reason: "model_has_no_vision" }`，并在 `quality_report.warnings[]` 写入：

```yaml
- code: AI_VISUAL_REVIEW_SKIPPED
  message: 当前 agent 无可用图片理解能力，已跳过非阻断截图审查
```

如果 screenshot 获取失败或 review 超时，同样写入 `AI_VISUAL_REVIEW_SKIPPED`，message 必须区分 `screenshot_failed` 或 `timeout`。如果本次未请求 AI review，只记录 `{ status: "skipped", reason: "not_requested" }`，不写 warning。

如果 AI review 和 Pencil guideline、Semantic Scope Guard 或 requirement 冲突，以 Pencil guideline、Semantic Scope Guard 和 requirement 为准，AI review 只作为 warning 保存。

#### 修复策略

硬校验失败时，`fm-design` 可以在同一 Pencil App session 内做一次 bounded repair：

1. 只修复质量问题，例如颜色格式、属性类型、命中 `layout_snapshot` 阻断阈值的裁切或重叠、preview export。
2. 不新增需求外业务元素。
3. 不修改非目标页面 frame。
4. 修复后必须重新运行 Design Quality Pipeline。

第二次仍失败时，返回对应错误码并保留 staging 文件，正式主 `.pen` 和页面状态不变。

### Semantic Scope Guard

`fm-design` 必须保护需求语义边界。它可以改视觉表达，但不能替需求新增产品能力或页面语义。

允许的设计调整：

- 背景、颜色、材质、阴影、布局、间距、视觉层级和动线强化
- 在语义不变的前提下替换图标、图片、装饰元素或组件外观
- 补齐已声明组件的视觉状态，例如 selected、disabled、loading、empty、error
- 把同一功能入口改成更合适的视觉形态，例如文字按钮改为图标按钮
- refine 或 rebuild 已声明页面的视觉结构，但保留 `page_id`、requirement copy 和原有交互语义

必须阻断的语义变更：

- 新增需求未声明的业务组件或功能控件
- 新增需求未声明的页面、页面分区或业务模块
- 新增反馈、帮助、分享、退款、收藏、评论等业务入口
- 新增表单字段、筛选条件、数据指标或操作按钮
- 新增导航目标、跳转路径、弹窗、抽屉、确认流程或状态机
- 新增不来自需求 copy 的业务文案
- 改变原交互语义，例如把“删除”改成“归档”，或把“提交”改成“保存草稿”

`fm-design` 开始设计前必须要求后端从 requirement page 的 `semantic_contract`、navigation、业务规则、已有 frame metadata、baseline 等价 label 和本次 `design_language` 构造允许语义面。用户要求新增组件或改变页面语义时，必须停止设计并返回：

```text
REQUIREMENT_UPDATE_REQUIRED
该变更会修改需求范围，请先运行 fm-requirement 更新需求，再回到 fm-design 设计。
```

允许语义面必须由后端从当前 requirement、product rules、当前页面 baseline 等价 label、选定语言的有效翻译和已提交 `design.yaml` 派生，不能由 agent 自行拼自由文本后传入。session 建立时写入 `semantic_scope.yaml`，后续 `validate_requirement_design_quality` 和 commit 都读取同一份 scope：

```typescript
interface AllowedSemanticSurface {
  product_id: string;
  requirement_id: string;
  page_id: string;
  design_language: Language;
  allowed_copy: Array<{
    text: string;
    language: Language;
    context?: string;
    source: "requirement" | "translation" | "baseline_label" | "product_rule" | "semantic_label";
  }>;
  allowed_page_ids: string[];
  allowed_navigation_targets: Array<{ from: string; to: string; trigger?: string }>;
  allowed_fields: SemanticFieldEntry[];
  allowed_actions: SemanticActionEntry[];
  allowed_component_keys: string[];
  allowed_states: Array<"default" | "selected" | "disabled" | "loading" | "empty" | "error">;
  existing_node_ids: string[];
  baseline_node_ids: string[];
  source_contract_hash: string;
}
```

`AllowedSemanticSurface` 的派生规则固定如下：

1. `allowed_copy` 只能来自本次 `design_language` 下的允许文本：default language 使用 `semantic_contract.copy_texts`、页面名、`semantic_contract.fields[].label`、`semantic_contract.actions[].label`、baseline 等价 label 和 product rules 明确允许的固定文案；非 default language 只能使用上方固定 context 对应的 `copy-translations.yaml` 非 outdated 翻译。缺失翻译不得回退到其他语言。
2. `allowed_fields` 只能来自 `semantic_contract.fields[]`，并按 `key` 做权限判断、按 `label` 做允许文案。
3. `allowed_actions` 只能来自 `semantic_contract.actions[]`，并按 `key` 做权限判断、按 `label` 做允许文案。
4. `allowed_navigation_targets` 只能来自 requirement `navigation[]` 中 `from === page_id` 的边，再与 `semantic_contract.navigation_targets[]` 按 `to` 做交集；输出对象固定为 `{ from, to, trigger: label }`，其中 `trigger` 来自 requirement navigation edge 的 `label`，没有 label 时省略。`semantic_contract.navigation_targets[]` 中没有对应 requirement navigation edge 的目标不得进入 allowed surface。
5. `allowed_component_keys` 只能来自 `semantic_contract.component_keys[]` 与当前需求组件快照中已有 `component_key` 的交集。
6. `source_contract_hash` 是上述字段、`design_language`、参与本次 session 的 translation entry hash 和 canonical requirement contract hash 规范化排序后的 hash；session commit 时如果 requirement contract 或本语言翻译 hash 已变化，返回 `SEMANTIC_SCOPE_CHANGED`，要求重新 begin session。

语义检查规则：

1. 文本节点如果没有 `metadata.type: "forma"` / `metadata.kind: "decorative"`，其 `content` 必须精确匹配 `allowed_copy.text`；不匹配返回 `DESIGN_SCOPE_VIOLATION`，`reason: "copy_not_allowed"`。
2. 会触发动作的节点必须写入 Forma metadata 的 `action_key`，且值必须存在于 `allowed_actions[].key`；缺失返回 `reason: "action_metadata_missing"`，未知值返回 `reason: "action_not_allowed"`。
3. 会触发导航的节点必须写入 Forma metadata 的 `navigation_target`，且目标必须存在于 `allowed_navigation_targets`；缺失返回 `reason: "navigation_metadata_missing"`，未知值返回 `reason: "navigation_not_allowed"`。
4. 展示业务字段的节点必须写入 Forma metadata 的 `field_key`，且值必须存在于 `allowed_fields[].key`；缺失返回 `reason: "field_metadata_missing"`，未知值返回 `reason: "field_not_allowed"`。
5. 通用组件实例必须使用 `allowed_component_keys` 中的 `component_key`，且该 key 必须位于 `metadata.type: "forma"` 的 metadata 内；未知组件 key 返回 `reason: "component_not_allowed"`。
6. 纯装饰节点必须写入 `metadata.type: "forma"` 和 `metadata.kind: "decorative"`，并且不能包含 action、navigation、field、component_key 或非空业务文本。
7. 无 Forma metadata 且有非空文本、点击行为、ref 关系或表单/按钮语义的节点一律按 `DESIGN_SCOPE_VIOLATION` 处理，`reason: "semantic_metadata_missing"`。
8. `existing_node_ids` 只允许保留上一次已提交设计中的旧元素；如果本次 session 修改了旧元素的 copy、action、navigation、field_key 或 component_key，仍必须重新校验。
9. Semantic Scope Guard 只用于阻断需求外语义，不负责判断视觉好坏；视觉问题交给 Design Quality Pipeline 的其他检查。

用户手动放入需求目录的主画布使用单独的 unmanaged import 语义模式。这个模式只适用于 `$FORMA_HOME/data/{product_id}/{requirement_id}/design.pen` 这个 v6 canonical path 的首次索引，不读取页面级 `D-*`，也不作为后续 active session 的宽松运行模式：

1. `index_requirement_design_canvas` 对没有 Forma metadata 的 imported page frame 不执行 `semantic_metadata_missing` 阻断，但必须把该页标记为 `semantic_mode: "unmanaged_import"`。
2. unmanaged import 的语义检查目标不是证明旧画布已经完全符合当前 requirement 语义，而是把旧画布安全纳入 v6 索引，并把无法确认的语义显式记录下来。页面自有文本清单必须按固定过滤器生成，不能靠实现者主观判断：
   - 只扫描已经匹配到 requirement page 的顶层 frame descendants。
   - 不扫描顶层组件候选节点、真实 `Components - Snapshot*` frame、`reusable: true` 组件源节点及其 descendants。
   - `session_batch_get` / scene 解析必须默认 `resolveInstances: false`；页面中的 `ref` instance 本身不展开成业务文本。只有该 ref instance 在页面内显式 override 了 descendant `content`，才进入文本清单。
   - 跳过固定系统 UI 文本 allowlist。allowlist 只能由下表规则命中，不能靠“看起来像系统文案”判断；这些跳过项必须写入 `quality_report.warnings[]`，code 为 `UNMANAGED_SYSTEM_TEXT_SKIPPED` 或 `UNMANAGED_COMPONENT_TEXT_SKIPPED`，方便后续人工复核。

unmanaged import 系统文本 allowlist 固定如下，所有匹配都在 NFC + trim 后执行：

| category | deterministic rule | warning code |
| --- | --- | --- |
| status bar time | text matches `^([01]?\\d|2[0-3]):[0-5]\\d$` | `UNMANAGED_SYSTEM_TEXT_SKIPPED` |
| battery percentage | text matches `^(100|[1-9]?\\d)%$` | `UNMANAGED_SYSTEM_TEXT_SKIPPED` |
| signal / network label | text exactly equals one of `Wi-Fi`、`Wifi`、`WIFI`、`5G`、`4G`、`LTE`、`No Service`、`无服务`、`信号`、`电量` | `UNMANAGED_SYSTEM_TEXT_SKIPPED` |
| app version label | text matches `^版本\\s*\\d+(\\.\\d+){1,3}$` or `^v\\d+(\\.\\d+){1,3}$` | `UNMANAGED_SYSTEM_TEXT_SKIPPED` |
| icon glyph name | node font family exactly equals one of `Material Icons`、`Material Symbols`、`SF Symbols`、`Lucide`、`IconFont` and text matches `^[a-z0-9][a-z0-9_-]{1,63}$` | `UNMANAGED_SYSTEM_TEXT_SKIPPED` |
| component demo label | text exactly equals one of `按钮`、`标题`、`菜单项`、`Button`、`Title`、`Menu Item`、`Label`、`Tab` | `UNMANAGED_COMPONENT_TEXT_SKIPPED` |

不在上表内的文本，即使实现者认为它是系统 UI 或组件示例，也必须进入 `imported_unverified_copy`。
3. 文本清单必须分成三类：`contract_copy`、`system_text` 和 `imported_unverified_copy`。只有精确匹配 `semantic_contract.copy_texts`、页面名、baseline 等价 label 或 product rules 固定文案的文本才能归类为 `contract_copy`；命中系统 allowlist 的文本归类为 `system_text`；其余文本归类为 `imported_unverified_copy`。
4. `imported_unverified_copy` 在首次 `index_requirement_design_canvas` 中不返回 `DESIGN_SCOPE_VIOLATION`，否则 P-907011 / R-c9b123bf 这类用户已认可的完整主画布无法被纳入 v6。它必须写入 `quality_report.import_adoption.unverified_copy_texts[]`，并在 `quality_report.warnings[]` 写入 `UNMANAGED_COPY_UNVERIFIED`。这些文本不是 allowed copy，后续 active session 不能继续使用它们作为新增或修改依据。
5. unmanaged import 不从无 metadata 节点推断 action、field、navigation 或 component usage；无法确认的交互只写入 `quality_report.warnings[]`，code 为 `UNMANAGED_SEMANTIC_METADATA_MISSING`。
6. 通过 unmanaged import 的页面在 `quality_report.hard_checks.semantic_scope` 中记录 `passed`，但必须额外写入 `quality_report.import_adoption: { mode: "unmanaged_import", missing_metadata_nodes: number, skipped_text_nodes: number, unverified_copy_count: number, unverified_copy_texts: string[] }`。`unverified_copy_texts[]` 按页面内首次出现顺序去重，最多保存 200 条；超过部分只增加 `unverified_copy_count` 并写入 `UNMANAGED_COPY_TRUNCATED` warning。
7. 只要页面经过 unmanaged import 但未完成 metadata normalization，后续 `generate`、`refine`、`rebuild`、`rollback` 或 `component_refresh` 的 active session 必须先调用 `plan_import_metadata_normalization({ session_id, page_id, frame_id })` 生成确定性 metadata 写入计划，再通过 `apply_requirement_design_operations(intent: "import_metadata_normalization")` 执行该计划；normalization 后重新运行 strict Semantic Scope Guard。
8. import metadata normalization 只能标注已有语义，不能新增页面元素、业务 copy、字段、动作或导航。若某个现有节点的 copy、action、field、navigation 或 component 无法唯一映射到当前 `semantic_contract` 和 `semantic_scope.yaml`，`plan_import_metadata_normalization` 返回 `UNMANAGED_METADATA_NORMALIZATION_REQUIRED`，details 必须列出 `unresolved_nodes[]`、`reason` 和可匹配的 allowed keys；若用户希望保留这些未声明语义，返回 `REQUIREMENT_UPDATE_REQUIRED`，要求先通过 `fm-requirement` 把它们结构化写入需求。

提交前必须再次检查目标 frame。只要发现需求外业务元素，就拒绝提交、不导出正式 preview、不推进 `design_status`：

```text
DESIGN_SCOPE_VIOLATION
目标页面包含需求外业务元素：feedback
```

## 页面 frame 映射规则

扫描已有主画布或生成页面时按以下顺序匹配页面：

1. 精确匹配 frame metadata 中的 `type: forma`、`kind: requirement_page` 和 `page_id`
2. 根据 frame name 匹配英文前缀，例如 `Home - 首页` -> `home`
3. 根据中文页面名匹配 requirement page 的 `name`
4. 未匹配的 frame 保留在主画布中，但不标记页面为 `done`

匹配必须是确定性的：

1. frame name 先做 Unicode NFC 归一化，trim 首尾空白，把连续空白压成一个空格。
2. 英文前缀只取第一个 ` - `、` — `、` – `、`:`、`：` 之前的文本；再转小写、把非字母数字替换为 `-`、合并连续 `-`、trim `-`，得到候选 slug。
3. 候选 slug 必须与 requirement page 的 `page_id` 完全一致才算命中；不能做包含匹配、模糊匹配或同义词推断。
4. 中文页面名匹配必须与 requirement page `name` 在 NFC + trim 后完全一致；不能用部分匹配。
5. 如果多个 frame 命中同一个 `page_id`，返回 `PAGE_FRAME_AMBIGUOUS`，该页进入 `blocked_pages[]`，不得任选一个标记 `done`。
6. 如果一个 frame 同时命中多个 page，返回 `PAGE_FRAME_AMBIGUOUS`，该 frame 进入 `skipped_nodes[]`，reason 为 `ambiguous_page_match`。
7. metadata 匹配优先级最高；如果 metadata 的 `page_id` 与 name 推导结果冲突，返回 `PAGE_FRAME_MISMATCH`，不得用 name 覆盖 metadata。

受控生成的新页面 frame 必须写入稳定业务 metadata：

```yaml
metadata:
  type: forma
  kind: requirement_page
  page_id: scenes
```

`design.yaml` 同时记录 Pencil 当前内部 `frame_id`。提交和导出 preview 时使用 `page_id + frame_id` 双重校验：

1. `frame_id` 找得到，且 metadata 的 `page_id` 一致：直接导出该 frame。
2. `frame_id` 找不到，但能通过 metadata `page_id` 找到唯一 frame：更新 `design.yaml.pages[].frame_id` 后导出。
3. `frame_id` 找得到但 metadata `page_id` 不一致：拒绝提交，返回 `PAGE_FRAME_MISMATCH`。
4. `frame_id` 和 metadata `page_id` 都找不到：该页不能标记 `done`，返回 `PAGE_FRAME_NOT_FOUND`。

P-907011 / R-c9b123bf 的旧 `design.pen` 顶层 frame 可映射为：

| frame name | page_id |
| --- | --- |
| `Splash - 启动页` | `splash` |
| `Login - 登录/注册页` | `login` |
| `Home - 首页` | `home` |
| `Scenes - 场景` | `scenes` |
| `Profile - 我的` | `profile` |
| `Player - 播放页` | `player` |
| `Nap Session - 小憩进行页` | `nap-session` |
| `Subscription - 订阅页` | `subscription` |
| `Settings - 设置页` | `settings` |
| `Alarm Clock - 闹钟页` | `alarm-clock` |
| `Alarm Ringing - 闹钟响铃页` | `alarm-ringing` |
| `Terms - 使用条款` | `terms` |
| `Privacy - 隐私协议` | `privacy` |
| `Auto Renewal - 自动续费说明` | `auto-renewal` |
| `About - 关于页` | `about` |
| `Player More Panel - 播放页更多操作面板` | `player-more-panel` |
| `Enhanced Sound Sheet - 增强音弹层` | `enhanced-sound-sheet` |
| `Timer Sheet - 定时器弹层` | `timer-sheet` |
| `Nap Sheet - 小憩弹层` | `nap-sheet` |
| `Light Alarm Sheet - 轻闹钟弹层` | `light-alarm-sheet` |
| `Light Alarm Override - 覆盖确认` | `light-alarm-override` |
| `Notification Permission - 通知权限引导` | `notification-permission` |
| `Delete Alarm Confirm - 删除闹钟确认` | `delete-alarm-confirm` |
| `Logout Confirm - 退出登录确认` | `logout-confirm` |
| `Delete Account Confirm - 删除账号确认` | `delete-account-confirm` |

组件候选顶层节点不能映射为页面：

```text
StatusBar/Light
StatusBar/Dark
NavBar
TabBar
MenuItem
Divider
PrimaryButton
DestructiveButton
OutlinedButton
BottomSheetHandle
ToggleSwitch/On
ToggleSwitch/Off
```

手动放入主画布的未归一化组件候选节点识别也必须是确定性的，不允许靠“看起来像组件”判断：

1. 顶层节点先按页面匹配规则尝试匹配 requirement page；只有 `type: "frame"` 的顶层节点可以匹配页面。已匹配页面的 frame 不能再归类为组件。
2. 顶层节点 metadata 为 `type: forma` 且 `kind: product_component` / `kind: requirement_component_snapshot`，或 Pencil node 标记 `reusable: true`，直接归类为组件候选节点。
3. 节点位于可映射的真实 `Components - Snapshot v{version}` 顶层 frame 内时，归类为组件 snapshot 子节点；未带版本或无法映射的 `Components - Snapshot` 只能进入 `import_report.unmanaged_component_nodes[]`。
4. 没有 metadata 时，只有顶层节点 name NFC + trim 后完全等于上方组件候选 allowlist 中的一个条目，且节点满足 `type === "frame"` 或 `reusable === true`，才可在 unmanaged import 中归类为 `unmanaged_component_node`。这覆盖 P-907011 / R-c9b123bf 中 `Divider` 这种顶层 reusable rectangle。
5. 未匹配页面、也未命中组件规则的顶层节点只写入 `skipped_nodes[]`，reason 为 `unmatched_top_level_node`，不得写入 runtime `design.yaml.component_library`，也不得标记为页面。
6. 如果一个顶层 frame 同时命中页面规则和组件规则，页面规则优先；但 metadata 冲突时返回 `PAGE_FRAME_MISMATCH` 或 `COMPONENT_METADATA_CONFLICT`，不得自动纠正。

## 已有主画布识别

不新增旧 `.pen` 自动导入动作。用户如果已有完整设计稿，直接手动放到：

```text
$FORMA_HOME/data/{product_id}/{requirement_id}/design.pen
```

Forma 只负责识别这个需求级主画布：

1. 检查 `design.pen` 是否存在且可读。
2. 扫描顶层节点；只有 frame 可进入页面匹配，组件候选可以是 frame 或 `reusable: true` 的非 frame 节点。
3. 按映射规则匹配 requirement pages。
4. 对每个匹配页面运行 index-mode Design Quality Pipeline：`pencil_schema`、`color_format`、`property_compatibility`、`layout_snapshot`、`preview_export` 必须通过；`semantic_scope` 使用 unmanaged import 模式，允许手动放入的主画布缺少 Forma metadata，也允许存在 `imported_unverified_copy`，但必须把这些文本写入 `quality_report.import_adoption` 和 warning。AI screenshot review 记录为 `{ status: "skipped", reason: "not_requested" }`。
5. `preview_export` 先导出到索引 staging 目录，全部通过后通过 `index-journal.yaml` 替换需求级 `previews/{page_id}@2x.png`、`design.yaml` 和 `requirement.yaml` 状态；索引失败时必须按 journal 恢复旧索引和旧 preview。
6. 只有质量硬校验通过的页面才写入需求级 `design.yaml`，记录 `page_id`、`frame_id`、`frame_name`、`status`、`page_version`、`canvas_version`、`preview_file`、`quality_report` 和 unmanaged import 状态。首次索引创建 `canvas_version: 1`，每个通过页面创建 `page_version: 1`，并在 `history[]` 写入 `source: index`、`canvas_file`、`canvas_yaml_file`、`frame_snapshot_file` 和历史 preview；后续重新索引如果正式 `design.pen` hash 未变，只能重建缺失索引和 preview，不能递增版本或追加 history。
7. 只有质量硬校验通过的页面才更新 `requirement.yaml` 中对应页面：

   ```yaml
   design_status: done
   ```

8. 匹配但质量硬校验失败的页面不得标记 `done`，写入返回值 `blocked_pages[]`，并在 `design.yaml.index_report.blocked_pages[]` 记录 `page_id`、`frame_id`、`blocker.code` 和 `blocker.message`；`requirement.yaml.pages[].design_status` 必须按固定规则写入：如果索引前不存在同一 `page_id` 的已提交 `design.yaml.pages[]` 记录，则写为 `pending`；如果索引前存在已提交记录且当前正式 `design.pen` hash 与 `design.yaml.canvas_revision` 相同，则保持原 `design_status`；如果索引前存在已提交记录但当前正式 `design.pen` hash 与 `design.yaml.canvas_revision` 不同，则写为 `expired`，并保留上一版 preview/history 作为 expired snapshot。
9. 未匹配 frame 保留在主画布中，但不写成页面状态。
10. 如果主画布来自用户手动拷贝且无法确认产品级组件库版本，`design.yaml` 不写 runtime `component_library`；未归一化的组件候选只写入 `import_report.unmanaged_component_nodes[]` 和 `skipped_nodes[]`，后续不自动替换为 latest。
11. unmanaged imported 页面可以被标记为 `done`，但 `design.yaml.pages[].quality_report.import_adoption.mode` 必须是 `unmanaged_import`；后续任何修改该页面的 active session 必须先完成 `import_metadata_normalization` 并把该页升级为 strict semantic scope。

索引 journal 写入 `$FORMA_HOME/data/{product_id}/{requirement_id}/.index-stage-{id}/index-journal.yaml`。它必须记录旧 `design.yaml`、旧 preview 文件 hash、旧 `requirement.yaml` hash、新候选文件和替换状态。索引 journal 未完成但仍可自动恢复时，`get_requirement_design_canvas.index_status` 返回 `stale`；恢复失败且需要人工处理时返回 `recovery_required`。后台 UI 显示“索引恢复中”或“索引恢复失败”，不能把部分预览当作完成状态。

识别动作的返回类型固定为 `RequirementDesignCanvasIndexResult`。`index_requirement_design_canvas` 和“已有主画布识别”章节不得各自维护不同字段：

```typescript
interface RequirementDesignCanvasIndexResult {
  product_id: string;
  requirement_id: string;
  canvas_path: string;
  design_yaml_path: string;
  component_library?: {
    source: "product_library";
    product_id: string;
    version: number;
    source_file: string;
    snapshot_frame_name: string;
    snapshot_frame_id?: string;
  };
  import_report?: {
    mode: "unmanaged_import";
    unmanaged_component_nodes: Array<{
      node_id: string;
      node_name: string;
      node_type: string;
      reason: "unmanaged_component_node" | "unmanaged_component_snapshot";
    }>;
  };
  matched_pages: Array<{
    page_id: string;
    frame_id: string;
    frame_name: string;
    page_version: number;
    canvas_version: number;
    preview_file: string;
    quality_report: DesignQualityReport;
  }>;
  blocked_pages: Array<{
    page_id: string;
    frame_id?: string;
    frame_name?: string;
    blocker: { code: string; message: string; node_ids?: string[] };
  }>;
  skipped_nodes: Array<{ node_id?: string; node_name: string; node_type?: string; reason: string }>;
  unmatched_pages: string[];
}
```

`design.yaml.index_report` 是最近一次成功或失败索引结果的唯一持久化入口。`get_requirement_design_canvas.index_status` 是读取时计算出的 live 状态，不能只信任持久化的 `index_report.status`。结构固定如下：

```yaml
index_report:
  status: complete # complete | incomplete | stale | recovery_required
  index_journal_id: IDX-xxxxxxxx
  indexed_at: '2026-05-20T00:00:00.000Z'
  source_canvas_revision: sha256:<hash-of-design.pen>
  matched_page_count: 25
  blocked_pages:
    - page_id: scenes
      frame_id: <pencil-node-id>
      blocker:
        code: DESIGN_LAYOUT_INVALID
        message: 目标页面命中 layout_snapshot 阻断阈值
        node_ids: []
  skipped_nodes:
    - node_name: TabBar
      node_type: frame
      reason: unmanaged_component_node
  unmatched_pages:
    - scenes
```

`get_requirement_design_canvas.index_status` 必须按以下优先级 live 计算：

1. 没有 `design.yaml` 时返回 `missing`。
2. 存在未完成 `index-journal.yaml` 且恢复失败或需要人工介入时返回 `recovery_required`。
3. 存在未完成但可自动恢复的 `index-journal.yaml`，或 `design.pen` hash 与 `index_report.source_canvas_revision` 不一致时返回 `stale`。
4. `index_report.blocked_pages[]` 或 `index_report.unmatched_pages[]` 非空时返回 `incomplete`。
5. 只有索引 journal 已 committed、hash 一致、`index_report.status === "complete"` 且没有 blocked/unmatched page 时才返回 `complete`。

持久化的 `index_report.status` 只能表达上一次索引写入时的结果；读取 API 必须把 journal 与当前 `design.pen` hash 叠加后再返回 `index_status`。

## MCP / Agent 工具调整

### 新工具

```text
begin_requirement_design_session
apply_requirement_design_operations
commit_requirement_design_session
discard_requirement_design_session
recover_design_commit_journal
begin_product_component_session
apply_product_component_operations
commit_product_component_session
discard_product_component_session
get_requirement_design_canvas
index_requirement_design_canvas
get_requirement_design_scene
get_requirement_design_history
rollback_requirement_design
diff_requirement_design_versions
export_requirement_design_asset
get_product_component_library
index_component_usages
refresh_requirement_components
plan_import_metadata_normalization
validate_requirement_design_quality
session_get_editor_state
session_get_guidelines
session_get_variables
session_batch_get
session_snapshot_layout
session_get_screenshot
session_export_nodes
```

### Session-scoped Pencil wrapper tools

agent 在 active design session 内不能直接调用 raw Pencil MCP 写工具，也不能给 raw Pencil MCP 传文件路径。Forma 必须提供 session-scoped wrapper，把 `session_id` 解析到 `design_session.yaml`，校验 `pencil_binding_id`、`staging_path`、产品级 lease 和局部 `active.yaml` 后，再由 adapter 注入底层 Pencil 所需的 `filePath` 或 `outputDir`。这些 wrapper 同时适用于 requirement canvas session 和 product component library session；`session_id` 必须全局唯一，不能只靠 `product_id` 推断。

所有 session-scoped wrapper 都共享以下输入规则：

1. 输入必须包含 `session_id`；可以包含 `pencil_binding_id` 作为额外校验，但不能包含 `filePath`、`file_path`、`canvas_path`、`staging_path`、`outputDir`、`output_dir`、`path`、`pen_path`、`preview_path` 或 `history_path`。
2. wrapper 执行前必须确认 session 处于 `running` 或 `failed_operation`、产品级 lease 和局部 `active.yaml` 都指向该 `session_id`，且 `pencil_binding_id` 对应的 Forma-owned interactive shell 进程仍存活并绑定该 session 的 `staging_path`。`failed_operation` 只允许 read/export wrapper 和下一次 `apply_*_operations` 重试；`commit_*_session` 在该状态下必须返回 `INVALID_INPUT`，details.required_action 固定为 `retry_failed_operation_or_discard`。
3. 只读 wrapper 不更新 `last_controlled_revision`，但如果底层 Pencil 工具可能触发保存或文档 mutation，必须拒绝并返回 `FORBIDDEN_PATH_PARAMETER` 或 `PENCIL_PROPERTY_INVALID`，不能静默执行。
4. `session_export_nodes` 只能导出到 session-owned output dir，例如 `sessions/{session_id}/exports/{request_id}/`；返回导出文件路径仅用于展示和审计，不允许调用方把这些路径传回写工具。

Wrapper 契约固定如下：

```typescript
session_get_editor_state(input: {
  session_id: string;
  pencil_binding_id?: string;
  include_schema: boolean;
}): PencilEditorState

session_get_guidelines(input: {
  session_id: string;
  pencil_binding_id?: string;
  category?: "guide" | "style";
  name?: string;
  params?: Record<string, unknown>;
}): PencilGuidelinesResult

session_get_variables(input: {
  session_id: string;
  pencil_binding_id?: string;
}): PencilVariablesResult

session_batch_get(input: {
  session_id: string;
  pencil_binding_id?: string;
  nodeIds?: string[];
  parentId?: string;
  patterns?: Array<Record<string, unknown>>;
  readDepth?: number;
  searchDepth?: number;
  resolveInstances?: boolean;
  resolveVariables?: boolean;
  includePathGeometry?: boolean;
}): PencilBatchGetResult

session_snapshot_layout(input: {
  session_id: string;
  pencil_binding_id?: string;
  parentId?: string;
  problemsOnly?: boolean;
  maxDepth?: number;
}): PencilSnapshotLayoutResult

session_get_screenshot(input: {
  session_id: string;
  pencil_binding_id?: string;
  nodeId: string;
}): PencilScreenshotResult

session_export_nodes(input: {
  session_id: string;
  pencil_binding_id?: string;
  nodeIds: string[];
  format?: "png" | "jpeg" | "webp" | "pdf";
  scale?: number;
  quality?: number;
}): {
  session_id: string;
  output_dir: string;
  files: Array<{ node_id: string; format: string; path: string }>;
}
```

底层 raw Pencil `batch_design` 和 `set_variables` 不作为 agent-facing tool 暴露；所有 `.pen` mutation 必须通过 `apply_requirement_design_operations` 或 `apply_product_component_operations`。

### 调整现有工具

`generate_components` 不再是一次性 MCP 写工具。产品组件库初始化入口改为 agent macro，底层只允许调用产品级 session 工具。macro 成功后的最终汇报必须原样来自 `commit_product_component_session`，字段固定如下：

```typescript
{
  product_id: string;
  session_id: string;
  pencil_binding_id: string;
  library_path: string;
  version: number;
  version_path: string;
  operation_log_file: string;
  mode: "app";
}
```

agent macro 不得自行裁剪、改名或补造这些字段。Pencil App 不可用时返回 `PENCIL_APP_REQUIRED`；commit 失败时不得更新 `components.yaml.current_version`。

`generate_components` agent macro 必须在 begin 前构造产品组件 seed manifest。这个 manifest 是组件库生成的输入契约，不能只靠 prompt 里自然语言描述“需要底部栏和按钮”：

```typescript
interface ProductComponentSeed {
  component_key: string;
  name: string;
  required_by: Array<{ requirement_id: string; page_id: string }>;
  source: "requirement_semantic_contract" | "product_rule" | "existing_component_library";
  semantic_contract_hash: string;
  allowed_instance_overrides: Array<"geometry" | "selected_state" | "label_from_requirement">;
}
```

`ProductComponentSeed.name` 不是可由 agent 自由补造的展示文案。它的来源固定：从 requirement `declared_component_keys[]`、requirement `semantic_contract.component_keys[]` 或 product rules `semantic.component_keys[]` 生成新 seed 时，`name` 必须等于 `component_key` 原值；从已有 `components.yaml.components[]` 复制既有组件 seed 时，`name` 必须等于已有 metadata 中的 `name`。v6 不在 `features`、`fields`、`interactions`、prompt 自由文本或 frame name 中推断组件名称；如果未来需要人类可编辑组件显示名，必须先通过 `fm-requirement` 增加结构化字段并同步修改本文档。

`ProductComponentSeed.source` 也必须由后端确定，agent 不得自由填写。复制已有 `components.yaml.components[]` metadata 时固定为 `existing_component_library`；新 key 如果存在于 product rules `semantic.component_keys[]`，固定为 `product_rule`；其余来自当前 requirement `declared_component_keys[]` 或页面 `semantic_contract.component_keys[]` 的 key 固定为 `requirement_semantic_contract`。同一个 key 同时命中 requirement 和 product rules 时，以 `product_rule` 为准，保证同一输入集合不会因为遍历顺序得到不同 source。`required_by` 必须由后端从当前 requirement `pages[]` 反查：收集所有 `semantic_contract.component_keys[]` 包含该 key 的 `{ requirement_id, page_id }`，按 `requirement_id`、`page_id` 字典序排序；如果 key 只存在于 product rules 但没有被 materialize 到任何当前 requirement page 的 `semantic_contract.component_keys[]`，preflight 返回 `SEMANTIC_CONTRACT_BUILD_FAILED`，不能生成空 `required_by` seed。

seed manifest 的生成规则固定如下：

1. 当 `fm-design` 发现产品组件库缺失时，macro 必须读取当前 requirement 的 `semantic_contract.component_keys[]`、`declared_component_keys[]` 和 product rules `semantic.component_keys[]`，去重后按 `component_key` 字典序生成 `seed_components[]`，并按上方固定规则填充 `name`、`source` 和 `required_by`。不能从 `features`、`fields`、`interactions`、prompt 自由文本或旧 `.pen` frame name 推断新 key、name、source 或 required_by。
2. `component_key` 必须原样使用 requirement 或 product rule 中的 key，不允许 agent 改名、翻译、合并近义词或把多个 key 映射到一个组件。seed `name` 也不得被 agent humanize 或翻译。key 不符合 schema、重复 key 语义冲突、同 key 多个 label 冲突时，`save_requirement` 或 macro preflight 返回 `SEMANTIC_CONTRACT_BUILD_FAILED`。
3. 每个 seed 的 `semantic_contract_hash` 由 `component_key`、`name`、来源、允许 override 和引用它的 requirement/page 集合规范化排序后计算。纯视觉描述不进入 hash；如果组件语义变化，必须通过 `fm-requirement` 修改结构化语义后生成新 hash。
4. `begin_product_component_session(operation: "generate")` 必须把 `seed_components[]` 写入产品组件 session 的 `design_session.yaml.seed_components`。`apply_product_component_operations` 只能创建或修改这些 seed 对应的 reusable components；额外组件如果没有 seed，必须返回 `COMPONENT_SEED_REQUIRED`，不能悄悄进入产品组件库。
5. `commit_product_component_session` 必须校验 staging `.lib.pen` 中每个 seed 都有且只有一个 `metadata.type === "forma"`、`metadata.kind === "product_component"` 的 reusable node，metadata 中的 `component_key` 和 `semantic_contract_hash` 与 seed 一致。缺失、重复、hash 不一致或 component_key 改名时返回 `COMPONENT_LIBRARY_METADATA_MISSING` 或 `COMPONENT_CONTRACT_CHANGED`，不得推进 `components.yaml.current_version`。
6. 如果产品组件库已经存在但缺少当前 requirement 声明的 key，`fm-design` 不自动创建临时页面组件；必须启动 `begin_product_component_session(operation: "refine")`，传入缺失 key 的 seed manifest，commit 出新产品组件版本后，再回到 requirement design session。

`complete_product_init` 在 v6 中删除。它不得出现在 `help`、MCP tool registry、agent route 列表、技能模板、dispatcher 或用户可见运行文档中；调用方如果仍发送这个工具名，只会得到 MCP 层面的 unknown tool，不提供 Forma handler。旧的一次性 MCP `generate_components` handler 也必须删除；如果调用方直接发送该工具名，MCP 层返回 unknown tool。只有 agent route macro 可以继续叫 `generate_components`。

旧名称清理的范围必须精确：`README.md`、`docs/AGENT.md`、`docs/MCP.md`、安装后的模板、生成的 help、registry、dispatcher 和 Web route table 中不得把旧名称当作可用入口；`design-version/*` 迁移文档、changelog、删除说明和负向测试可以出现旧名称，但只能用于说明“已删除、应返回 404/unknown tool/unknown command”。验收命令必须排除这些允许位置，不能用全仓库裸 `rg "complete_product_init|generate_page_design|design_id"` 作为失败条件。

产品级组件库显式 session 工具：

```typescript
type BeginProductComponentSessionInput =
  | {
      product_id: string;
      operation: "generate";
      seed_components: ProductComponentSeed[];
    }
  | {
      product_id: string;
      operation: "refine" | "change_style";
      seed_components?: ProductComponentSeed[];
    };

begin_product_component_session(input: BeginProductComponentSessionInput): {
  product_id: string;
  session_id: string;
  pencil_binding_id: string;
  canvas_path: string;
  staging_path: string;
  previous_version?: number;
  operation_log_file: string;
  mode: "app";
}

apply_product_component_operations(input: {
  session_id: string;
  operations: Array<{
    tool: "batch_design" | "set_variables";
    args: Record<string, unknown>;
    target_node_ids?: string[];
    intent: "generate_components" | "refine_components" | "change_style" | "quality_repair";
  }>;
}): {
  session_id: string;
  sequence_start: number;
  sequence_end: number;
  before_revision: string;
  after_revision: string;
}

commit_product_component_session(input: {
  session_id: string;
  ai_visual_review?: AiVisualReviewResult;
}): {
  product_id: string;
  session_id: string;
  pencil_binding_id: string;
  library_path: string;
  version: number;
  version_path: string;
  operation_log_file: string;
  mode: "app";
}

discard_product_component_session(input: {
  session_id: string;
  reason: "user_cancelled" | "failed_generation" | "failed_operation_abandoned" | "failed_commit_abandoned" | "manual_edit_detected" | "recoverable_abandoned" | "commit_recovery_abandoned";
}): {
  session_id: string;
  status: "discarded";
}
```

产品级 session 工具和需求级 session 工具共享同一套 `design_session.yaml` 状态机、revision hash 和 manual edit 检测规则；区别只是 canvas path、commit 目标和正式状态文件不同。

`get_product_component_library` 只读取产品级组件库状态，不创建、不修改、不索引需求画布，也不打开 Pencil App：

```typescript
get_product_component_library(input: {
  product_id: string;
}): {
  product_id: string;
  initialized: boolean;
  status:
    | "missing"
    | "complete"
    | "metadata_missing"
    | "version_snapshot_missing"
    | "latest_file_missing"
    | "invalid";
  library_path: string;
  components_yaml_path: string;
  current_version?: number;
  latest_file?: string;
  latest_checksum?: string;
  versions: Array<{
    version: number;
    file: string;
    checksum?: string;
    created_at: string;
    source: "generate_components" | "fm-refine-components" | "fm-change-style";
    components: Array<{
      component_key: string;
      reusable_node_id: string;
      name: string;
      semantic_contract_hash: string;
      visual_revision: number;
      allowed_instance_overrides: string[];
    }>;
  }>;
  blockers: Array<{
    code:
      | "COMPONENT_LIBRARY_METADATA_MISSING"
      | "COMPONENT_LIBRARY_VERSION_MISSING"
      | "COMPONENT_LIBRARY_LATEST_MISSING"
      | "COMPONENT_LIBRARY_INVALID";
    message: string;
    path?: string;
  }>;
}
```

读取规则：

1. `product_id` 不存在时返回 `PRODUCT_NOT_FOUND`。
2. `$FORMA_HOME/library/{product_id}.components.yaml` 不存在时返回 `initialized: false`、`status: "missing"` 和 `blockers[]`，不自动调用 `generate_components`。
3. `components.yaml.current_version` 存在但对应 `$FORMA_HOME/library/{product_id}.versions/{version}.lib.pen` 缺失时返回 `initialized: false`、`status: "version_snapshot_missing"`。
4. `latest_file` 指向的 `$FORMA_HOME/library/{product_id}.lib.pen` 缺失或 checksum 不匹配时返回 `initialized: false`、`status: "latest_file_missing"` 或 `"invalid"`。
5. `components.yaml` 可读、current version 和 latest 文件存在，但当前版本缺少 `components` 字段、`components` 不是数组、某个组件缺少 `component_key` / `reusable_node_id` / `name` / `semantic_contract_hash`、`component_key` 重复、或 `semantic_contract_hash` 非 `sha256:<hash>` 格式时，返回 `initialized: false`、`status: "metadata_missing"`，并写入 `COMPONENT_LIBRARY_METADATA_MISSING` blocker。`components: []` 是合法空组件库版本，不属于 metadata missing。
6. `components.yaml` 不是合法 YAML、schema 不合法、version 非正整数、路径越界、版本快照 checksum 不匹配、latest checksum 不匹配或组件 metadata 与 `.lib.pen` 中 reusable node 无法对应时，返回 `initialized: false`、`status: "invalid"`，并写入 `COMPONENT_LIBRARY_INVALID` blocker。
7. 只有 `components.yaml.current_version`、对应版本快照、latest 文件和组件 metadata 全部可读且校验通过时，才返回 `initialized: true`、`status: "complete"`。
8. 该工具不能修改 `product.yaml.components_initialized`；v6 中组件初始化状态只从 `components.yaml` 和版本快照派生。

v6 删除页面级 `design_id` 工具面。旧工具不出现在 `help`、MCP tool registry、agent route 列表、dispatcher 或技能模板中，也不继续接受 `design_id` 作为设计主键：

- `generate_page_design`
- `save_designs`
- `generate_and_save_page_design`
- `rollback_design`
- `diff_designs`
- `get_design_annotations`
- `export_design_asset`

v6 不提供旧工具处理分支。旧工具名如果被调用，必须在 MCP 注册层或 dispatcher lookup 阶段直接表现为 unknown tool；任何 Forma handler 都不得创建页面级 `D-*` 目录、读取页面级 `design_id` 或返回旧 payload。

v6 替代关系：

| 旧工具 | v6 工具 |
| --- | --- |
| `generate_page_design` / `save_designs` / `generate_and_save_page_design` | `begin_requirement_design_session` + `apply_requirement_design_operations` + `commit_requirement_design_session` |
| `get_design_annotations` | `get_requirement_design_scene` |
| `rollback_design` | `begin_requirement_design_session(operation: "rollback")` + `rollback_requirement_design` + `apply_requirement_design_operations` + `commit_requirement_design_session` |
| `diff_designs` | `diff_requirement_design_versions` |
| `export_design_asset` | `export_requirement_design_asset` |

`begin_requirement_design_session` 输入：

```typescript
type ComponentRefreshScope =
  | "all_pages"
  | {
      page_ids?: string[];
      component_keys?: string[];
    };

{
  product_id: string;
  requirement_id: string;
  page_id?: string;
  operation: "generate" | "refine" | "rebuild" | "rollback" | "component_refresh";
  design_language?: Language; // omitted means product.default_language
  component_refresh?: {
    version: "latest" | number;
    scope?: ComponentRefreshScope;
  };
}
```

`ComponentRefreshScope` 的解析规则固定如下：

1. `operation: "component_refresh"` 且 `component_refresh.scope` 省略时，等价于 `"all_pages"`。
2. `"all_pages"` 表示所有 `design.yaml.pages[]` 中 `status === "done"` 且存在 linked usage 的页面；`pending` 和 `expired` 页面不进入候选范围，也不写入 `skipped_pages[]`。
3. object scope 中，`page_ids` 省略表示所有 done 页面，`component_keys` 省略表示当前需求 `design.yaml.component_library.components[]` 中的全部 key。
4. 如果 `page_ids` 和 `component_keys` 同时出现，候选范围是二者的交集：只刷新 `page_ids` 指定页面中命中 `component_keys` 的 linked usage。
5. `page_ids: []` 或 `component_keys: []` 是非法输入，返回 `INVALID_INPUT`；重复值先去重再处理。
6. `page_ids` 中任一页面不存在返回 `PAGE_FRAME_NOT_FOUND`；显式传入的 `page_ids` 中任一页面存在但 `design.yaml.pages[].status !== "done"` 时，component refresh begin 前预检必须返回 `COMPONENT_REFRESH_PARTIAL_BLOCKED`，details.blocked_pages[] 写入 `{ page_id, reason: "page_not_done" }`，不得打开 Pencil App，也不得把它作为成功 commit 的 `skipped_pages[]`。如果页面状态在 active session 建立后漂移为非 done，`refresh_requirement_components` 必须返回同一个 stable error，保留 session 等待重试或 discard。
7. `component_keys` 中任一 key 不存在于当前 pinned `design.yaml.component_library.components[]` 时返回 `COMPONENT_LIBRARY_UNMAPPED`，不得打开 Pencil App。
8. object scope 解析后没有候选 linked usage 时，`refresh_requirement_components` 返回 `COMPONENT_REFRESH_PARTIAL_BLOCKED`，details.candidate_pages 为空，`operations` 不存在。

返回值：

```typescript
{
  product_id: string;
  requirement_id: string;
  session_id: string;
  pencil_binding_id: string;
  canvas_path: string;
  staging_path: string;
  base_canvas_revision?: string;
  canvas_state: "existing" | "created_empty";
  component_library_version?: number;
  requires_component_snapshot: boolean;
  target_page?: {
    page_id: string;
    frame_id?: string;
    frame_name?: string;
    status: "existing" | "missing";
  };
  mode: "app";
}
```

### 受控 Pencil 写操作边界

`begin_requirement_design_session` 只负责打开或连接 Pencil App、建立锁、创建 `design_session.yaml`、准备 `staging.design.pen` 并返回 session。主画布存在时，它把正式 `design.pen` 复制到 `staging.design.pen`，并记录 `base_canvas_revision`。主画布不存在时，它必须在 open probe 之前写入一个最小合法空 `.pen` 作为 `staging.design.pen`，再用 `pencil interactive --app desktop --in <staging.design.pen>` 打开这个文件；open probe 成功后通过受控 `save()` 重新保存并计算 `started_revision`。这个空 staging 只是 session bootstrap，不是正式设计写入；除此之外，begin 不得创建页面 frame、嵌入组件快照、修改变量或写入 `.pen` node metadata。

组件快照嵌入、页面 frame 创建、页面 refine/rebuild、页面 rollback、组件 rebind 和质量修复都属于 `.pen` mutation，必须通过 `apply_requirement_design_operations`。它不允许 agent 直接绕过 Forma 调用 Pencil 写工具。

在 active design session 内，agent 面向的是 Forma session-scoped Pencil adapter，不是 raw Pencil MCP。adapter 负责绑定 `pencil_binding_id`、注入 `filePath` 并拒绝 agent payload 中的路径参数。Pencil 工具分为两类：

| 类型 | 工具 | 规则 |
| --- | --- | --- |
| 只读 / 导出工具 | `session_get_editor_state`、`session_get_guidelines`、`session_get_variables`、`session_batch_get`、`session_snapshot_layout`、`session_get_screenshot`、`session_export_nodes` | agent 可以通过 session-scoped adapter 调用，用于读取 schema、变量、布局、截图和 session-owned 导出结果 |
| 写工具 | `batch_design`、任何会创建、修改或删除 `.pen` node / page 的 Pencil 操作 | agent 禁止直接调用，必须通过 `apply_requirement_design_operations` |

`apply_requirement_design_operations` 是 Forma 的受控写入网关。它接收 agent 计划执行的 Pencil mutation，由 Forma 在同一个 Pencil App session 中调用 Pencil 写工具、记录 operation log、更新 revision，并返回写入结果。任何绕过该网关产生的 `.pen` 变化都会在下一次写入或提交时触发 `MANUAL_EDIT_DETECTED`。

需求级 session 不允许调用 `set_variables`。变量是整份 `.pen` 的文档级状态，可能影响非目标页面和组件快照；需求页面的 generate/refine/rebuild/rollback/component_refresh/quality_repair 只能通过 `batch_design` 修改目标 frame、组件快照或实例 rebind。产品级组件库 session 可以使用 `set_variables`，因为它提交的是新的产品组件库版本，后续需求只通过 pinned snapshot 或显式 component refresh 接收变化。

输入：

```typescript
{
  session_id: string;
  operations: Array<{
    tool: "batch_design";
    args: Record<string, unknown>;
    target_node_ids?: string[];
    intent: "generate" | "refine" | "rebuild" | "rollback" | "component_refresh" | "quality_repair" | "import_metadata_normalization";
  }>;
}
```

返回值：

```typescript
{
  session_id: string;
  sequence_start: number;
  sequence_end: number;
  before_revision: string;
  after_revision: string;
  applied_operations: Array<{
    sequence: number;
    tool: string;
    target_node_ids: string[];
    status: "applied";
  }>;
}
```

执行规则：

1. 执行前必须确认 `session_id` 对应的 `design_session.yaml` 处于 `running` 或 `failed_operation`，`pencil_binding_id` 对应的 Forma-owned interactive shell 进程仍存活并绑定同一个 `staging_path`。只有 `apply_requirement_design_operations` / `apply_product_component_operations` 可以在 `failed_operation` 状态下执行；其他写入或提交入口必须返回 `INVALID_INPUT`。
2. 执行前必须先通过 `pencil_binding_id` 对该 interactive shell 发送 `save()`，把 App 内存态刷新到 `staging_path`。随后重新计算规范化 `.pen` hash，并与 `last_controlled_revision` 一致；不一致时返回 `MANUAL_EDIT_DETECTED`，不得继续执行本次 mutation。
3. Forma 调用 Pencil 写工具前，必须把 `tool`、`args`、`target_node_ids`、`intent`、`before_revision` 写入 `operation_log_file` 的 pending entry。
4. 如果 session 当前是 `failed_operation`，本次 apply 是唯一允许的恢复动作。执行前必须读取 `operation_log_file` 中最新一条 `status: failed` 的 entry，并把新 pending entry 写入 `retry_of_sequence: <failed sequence>`；不得修改旧 failed entry，也不得跳过 revision 校验。
5. Pencil 写工具成功后，Forma 必须再次执行受控 `save()`，重新计算 `.pen` hash，把 `after_revision`、`status: applied` 和时间戳写回同一 entry，并更新 `last_controlled_revision`、`last_saved_revision` 和 `updated_at`。如果执行前状态是 `failed_operation`，成功后必须把 `design_session.yaml.status` 写回 `running`。
6. Pencil 写工具失败时，entry 标记为 `failed`，不更新 `last_controlled_revision`，并把 `design_session.yaml.status` 写为 `failed_operation`。后续 read/export wrapper 仍可用于排查；后续提交必须返回 `INVALID_INPUT`，直到用户用同一 `session_id` 再次调用 `apply_*_operations` 成功回到 `running`，或显式 discard。
7. `intent: quality_repair` 只能在 Design Quality Pipeline 第一次硬校验失败后使用，且只能修改目标 frame 的质量问题。
8. `intent: import_metadata_normalization` 只能用于 unmanaged imported 页面进入 active session 前的 metadata 归一化，只能写 Forma metadata，不得改节点几何、样式、copy、层级或业务结构。

`commit_requirement_design_session` 输入：

```typescript
type AiVisualReviewResult =
  | { status: "passed"; screenshot_path?: string }
  | { status: "warning"; screenshot_path?: string; warnings: string[] }
  | { status: "skipped"; reason: "not_requested" | "model_has_no_vision" | "screenshot_failed" | "timeout" };

{
  session_id: string;
  page_id?: string;
  frame_id?: string;
  ai_visual_review?: AiVisualReviewResult;
  ai_visual_reviews?: Array<{
    page_id: string;
    result: AiVisualReviewResult;
  }>;
}
```

`ai_visual_review` / `ai_visual_reviews` 的输入互斥规则固定如下：

1. 两个字段同时出现时返回 `INVALID_INPUT`。
2. `operation: generate | refine | rebuild | rollback` 的 page commit 只能接受 `ai_visual_review`；如果传入 `ai_visual_reviews[]`，返回 `INVALID_INPUT`。未传时按 `{ status: "skipped", reason: "not_requested" }` 记录。
3. `operation: component_refresh` 只能接受 `ai_visual_reviews[]`；如果传入 `ai_visual_review`，返回 `INVALID_INPUT`。
4. `ai_visual_reviews[]` 中 `page_id` 必须全部属于本次 `planned_affected_pages[]`；出现额外页面或重复 `page_id` 返回 `INVALID_INPUT`。
5. `component_refresh` 中某个 affected page 缺少 AI review 时，该页按 `{ status: "skipped", reason: "not_requested" }` 记录；这不写 warning。

返回值：

```typescript
type DesignQualityStatus = "passed" | "warning" | "blocked";

interface LayoutSnapshotDetails {
  scanned_node_count: number;
  expanded_parent_count: number;
  truncated_parent_count: number;
  elapsed_ms: number;
  max_parent_nodes: 500;
  max_layout_nodes: 5000;
  limit_hit?:
    | "layout_scan_incomplete"
    | "layout_scan_limit_exceeded"
    | "parent_node_limit"
    | "layout_node_limit"
    | "timeout";
}

interface DesignQualityReport {
  status: DesignQualityStatus;
  checked_at: string;
  hard_checks: {
    pencil_schema: "passed" | "blocked";
    color_format: "passed" | "fixed" | "blocked";
    property_compatibility: "passed" | "fixed" | "blocked";
    layout_snapshot: "passed" | "blocked";
    layout_snapshot_details?: LayoutSnapshotDetails;
    preview_export: "passed" | "blocked";
    semantic_scope: "passed" | "blocked";
  };
  ai_visual_review: AiVisualReviewResult;
  import_adoption?: {
    mode: "strict" | "unmanaged_import";
    missing_metadata_nodes?: number;
    skipped_text_nodes?: number;
    unverified_copy_count?: number;
    unverified_copy_texts?: string[];
  };
  warnings: Array<{
    code: string;
    message: string;
    node_id?: string;
  }>;
  blocker?: {
    code:
      | "PENCIL_COLOR_INVALID"
      | "PENCIL_SCHEMA_INVALID"
      | "PENCIL_PROPERTY_INVALID"
      | "DESIGN_LAYOUT_INVALID"
      | "DESIGN_SCOPE_VIOLATION"
      | "PREVIEW_EXPORT_FAILED";
    message: string;
    node_ids?: string[];
    details?: Record<string, unknown>;
  };
  repair_plan?: {
    operations: Array<{
      tool: "batch_design";
      args: Record<string, unknown>;
      target_node_ids?: string[];
      intent: "quality_repair";
    }>;
  };
}

type CommitRequirementDesignSessionResult =
  | {
      kind: "page_commit";
      product_id: string;
      requirement_id: string;
      page_id: string;
      page_version: number;
      canvas_version: number;
      canvas_path: string;
      pencil_binding_id: string;
      component_library_version?: number;
      frame_id: string;
      frame_name: string;
      preview_path: string;
      restored_from_page_version?: number;
      source_frame_snapshot_file?: string;
      mode: "app";
      quality_report: DesignQualityReport;
    }
  | {
      kind: "component_refresh_commit";
      product_id: string;
      requirement_id: string;
      canvas_path: string;
      canvas_version: number;
      pencil_binding_id: string;
      old_component_library_version?: number;
      new_component_library_version: number;
      affected_pages: Array<{
        page_id: string;
        frame_id: string;
        page_version: number;
        preview_path: string;
        updated_usages: Array<{
          component_key: string;
          binding_id: string;
          instance_node_id: string;
        }>;
        quality_report: DesignQualityReport;
      }>;
      skipped_pages: Array<{ page_id: string; reason: string }>;
      mode: "app";
    };
```

提交规则：

1. `operation: generate | refine | rebuild | rollback` 时，`page_id` 和 `frame_id` 必填，返回 `kind: "page_commit"`，必须包含单个 `page_id`、`frame_id`、`preview_path`、`page_version` 和 `canvas_version`。`page_version` 始终是本次提交后新生成的页面历史版本，`canvas_version` 始终是本次提交后新生成的全画布版本；二者都必须单调递增，不能复用旧版本号。rollback commit 必须在返回值和 `design.yaml.pages[].history` 中记录 `source: rollback`、`restored_from_page_version: target_page_version` 和 `source_frame_snapshot_file`。例如当前页面是 p3、回滚到 p2 时，本次提交写入 p4，并生成新的 canvas cN，`restored_from_page_version` 为 2，不覆盖已有 p2 历史文件。
2. `operation: component_refresh` 时，不要求传入 `page_id`，返回 `kind: "component_refresh_commit"`，必须包含本次全画布 `canvas_version`、`affected_pages[].page_version`、`affected_pages[]` 和 `updated_usages[]`，并只导出受影响页面 preview。
3. `commit_requirement_design_session` 必须重新运行确定性质量检查；`ai_visual_review` / `ai_visual_reviews[]` 只能作为 agent 提供的非阻断补充结果合并进对应页面的 `quality_report`。未提供时记录 `{ status: "skipped", reason: "not_requested" }`。
4. `component_refresh` 不走独立提交路径；它和页面生成一样必须通过 active `design_session.yaml`、`apply_requirement_design_operations` 和 `commit_requirement_design_session` 完成原子提交。
5. 任一受影响页面 preview 导出失败时，整个 `component_refresh_commit` 失败，不推进 `design.yaml.component_library.version`。
6. `component_refresh_commit.skipped_pages` 只能表示有效 scope 内重新扫描后没有匹配 linked usage 的页面，不能表示被跳过的失败页面或显式指定的非 done 页面。存在 unlinked usage、语义契约变化、override 冲突、显式指定页面不可更新或导出失败时必须整体失败。
7. `refresh_requirement_components` 只负责预检和生成受控写操作计划；真正写入 `.pen` 和推进状态必须由 active session 的 commit 完成。
8. commit 写正式 `design.pen` 前必须重新计算当前正式主画布 hash；如果它和 `base_canvas_revision` 不一致，返回 `DESIGN_CANVAS_CHANGED`，不覆盖正式文件，不导出新的正式 preview，不推进 `design.yaml` 或 `requirement.yaml`。
9. commit 的写入顺序必须是：验证 staging、导出到 session 临时 preview、计算新的 `canvas_version` 和受影响页面 `page_version`、写 history staging、生成包含最终页面 `design_status` 的 `requirement.yaml` candidate、生成包含最终 `canvas_revision` / preview hash / history hash 的 `design.yaml` candidate、写 requirement commit journal、执行正式文件替换、校验正式 `design.pen` 与 `design.yaml.canvas_revision` 匹配、校验 `requirement.yaml.pages[].design_status` 与本次 commit 结果一致，最后把 journal 标记为 `committed`。任一步失败时，必须通过 journal 恢复旧正式文件集合；如果恢复也失败，session 进入 `commit_recovery_required`，产品级 lease 不清理，所有 design API 返回 `DESIGN_COMMIT_RECOVERY_REQUIRED`，不得把半提交状态当作可用设计。

需求级 commit journal 规则：

1. journal 写入 `$FORMA_HOME/data/{product_id}/{requirement_id}/sessions/{session_id}/commit-journal.yaml`，记录每个正式文件的 old path、old hash、candidate path、candidate hash、replacement status 和 restore status。
2. 正式文件替换前，必须把当前 `design.pen`、`design.yaml`、目标 preview、history index 和即将写入的 `requirement.yaml` 复制到同一 session 的 `backup/` 目录并校验 hash。
3. 正式 `design.yaml` 必须记录 `canvas_revision`、`last_commit` 和每个 preview/history 文件 hash。`last_commit.source` 只能是 `index` 或 `session_commit`；`index` 必须记录 `index_journal_id`，`session_commit` 必须记录 `session_id`。后台 API 读取时如果 `design.pen` hash 与 `design.yaml.canvas_revision` 不一致，必须返回 `DESIGN_INDEX_STALE` 或 `DESIGN_COMMIT_RECOVERY_REQUIRED`，不能继续展示不一致数据。
4. 替换顺序固定为 preview/history candidates、`design.yaml` candidate、`design.pen` candidate、`requirement.yaml` candidate；`requirement.yaml` candidate 必须已经包含本次页面或组件刷新导致的最终 `design_status`，不得在正式替换后再单独写状态。每一步后写 journal。任何替换失败都必须按 journal 逆序恢复已替换文件。
5. `forma serve` 启动恢复必须先处理未完成 journal：`committing` 且未完成的 journal 优先恢复旧文件；`committed` journal 只做一致性校验；`commit_recovery_required` 保持阻断并在 UI 暴露人工恢复入口。该判断以 `commit-journal.yaml` 为准，即使相邻 `design_session.yaml` 缺失、损坏或无法通过 schema 校验，也必须先按 journal 进入恢复流程，不能因为 session 文件不可读而跳过半提交。
6. 产品组件库 commit 使用同一 journal 机制，路径为 `$FORMA_HOME/library/{product_id}.sessions/{session_id}/commit-journal.yaml`，覆盖 latest、版本快照和 `components.yaml.current_version` 的一致性。

`discard_requirement_design_session` 输入：

```typescript
{
  session_id: string;
  reason: "user_cancelled" | "failed_generation" | "failed_operation_abandoned" | "failed_commit_abandoned" | "manual_edit_detected" | "recoverable_abandoned" | "commit_recovery_abandoned";
}
```

返回值：

```typescript
{
  session_id: string;
  status: "discarded";
}
```

`discard_requirement_design_session` 只关闭 session、清空产品级 `active-design-session.yaml` 和对应局部 `active.yaml`、删除该 session 的 `staging.design.pen` 并保留当前 requirement-level `design.pen`；它不得删除用户已有主画布、不得推进 `design.yaml` 或 `requirement.yaml`。如果 session 创建了 product component staging 文件，必须拒绝并要求调用 `discard_product_component_session`。`reason: "commit_recovery_abandoned"` 只能在 commit journal 已恢复旧正式文件集合，或人工确认无法继续恢复且要放弃该 session 时使用；discard 必须保留 `commit-journal.yaml`、backup 和失败摘要作为审计凭据，不能删除恢复证据。

`get_requirement_design_canvas` 用于读取需求主画布状态，不创建、不索引、不导出：

```typescript
{
  product_id: string;
  requirement_id: string;
}
```

返回值：

```typescript
{
  product_id: string;
  requirement_id: string;
  exists: boolean;
  canvas_path: string;
  design_yaml_path: string;
  canvas_version?: number;
  index_status: "missing" | "complete" | "incomplete" | "stale" | "recovery_required";
  component_library?: {
    source: "product_library";
    version?: number;
    policy: "pinned";
  };
  pages: Array<{
    page_id: string;
    design_status: "pending" | "done" | "expired";
    page_version?: number;
    frame_id?: string;
    preview_file?: string;
  }>;
}
```

`index_requirement_design_canvas` 用于扫描已有需求主画布、建立或刷新 `design.yaml`，并导出已匹配页面的 preview：

```typescript
{
  product_id: string;
  requirement_id: string;
}
```

返回值固定为 `RequirementDesignCanvasIndexResult`：

```typescript
RequirementDesignCanvasIndexResult
```

`get_requirement_design_history` 输入：

```typescript
{
  product_id: string;
  requirement_id: string;
  page_id?: string;
}
```

返回值：

```typescript
{
  product_id: string;
  requirement_id: string;
  pages: Array<{
    page_id: string;
    current_page_version: number;
    versions: Array<{
      page_version: number;
      canvas_version: number;
      source: "index" | "generate" | "refine" | "rebuild" | "rollback" | "component_refresh";
      frame_id: string;
      frame_name: string;
      frame_snapshot_file: string;
      canvas_file: string;
      canvas_yaml_file: string;
      preview_file?: string;
      created_at: string;
      quality_status?: "passed" | "warning" | "blocked";
    }>;
  }>;
}
```

`rollback_requirement_design` 只生成 rollback 操作计划，不直接修改 `.pen`、不导出 preview、不推进 `design.yaml` 或 `requirement.yaml`。调用方必须先通过 `begin_requirement_design_session(product_id, requirement_id, page_id, operation: "rollback")` 打开 Pencil App session，再调用本工具。

`rollback_requirement_design` 输入：

```typescript
{
  session_id: string;
  product_id: string;
  requirement_id: string;
  page_id: string;
  target_page_version: number;
}
```

成功返回值：

```typescript
{
  session_id: string;
  product_id: string;
  requirement_id: string;
  page_id: string;
  target_page_version: number;
  base_revision: string;
  source_frame_snapshot_file: string;
  planned_frame_id: string;
  operations: Array<{
    tool: "batch_design";
    args: Record<string, unknown>;
    target_node_ids: string[];
    intent: "rollback";
  }>;
}
```

执行规则：

1. `session_id` 必须指向 `operation: rollback` 的 running `design_session.yaml`，且 `pencil_binding_id` 对应的 Forma-owned interactive shell 仍绑定同一个 session 的 `staging.design.pen`，不能直接连接或修改正式 `design.pen`。
2. 计划生成前必须校验当前 `staging.design.pen` revision 等于 `design_session.last_controlled_revision`；不一致时返回 `MANUAL_EDIT_DETECTED`。
3. 回滚源必须是需求级 `history/pages/{page_id}.p{page_version}.pen-fragment`。缺失时返回 `DESIGN_HISTORY_FRAME_SNAPSHOT_NOT_FOUND`，不能读取页面级 `D-*` 或从 preview 反推。
4. 目标页面版本缺失返回 `DESIGN_HISTORY_VERSION_NOT_FOUND`；当前页面 frame 校验失败返回 `PAGE_FRAME_MISMATCH`。
5. 返回的 `operations[]` 只能替换目标页面 frame，必须保留其他页面 frame、组件快照、usage metadata 和需求级 `design.pen` 的其他内容。
6. 真正 `.pen` 写入必须由 `apply_requirement_design_operations(session_id, operations)` 执行；任何直接替换 frame 的实现都违反 v6 app-bound mutation 规则。
7. rollback 写入完成后必须调用 `commit_requirement_design_session(session_id, page_id, frame_id)`。commit 负责重新运行 Design Quality Pipeline、导出 `previews/{page_id}@2x.png`、刷新 `design.yaml.pages[page_id]`，并把 `requirement.yaml.pages[page_id].design_status` 写为 `done`。
8. preview 导出失败或质量硬校验失败时，rollback commit 失败，不推进 `design.yaml` 或 `requirement.yaml`；session 状态写为 `failed_commit`，用户可以丢弃 session 后重试。

`diff_requirement_design_versions` 输入：

```typescript
{
  product_id: string;
  requirement_id: string;
  page_id: string;
  from_page_version: number;
  to_page_version: number;
}
```

返回值：

```typescript
{
  product_id: string;
  requirement_id: string;
  page_id: string;
  from_page_version: number;
  to_page_version: number;
  added_nodes: string[];
  removed_nodes: string[];
  changed_nodes: Array<{
    node_id: string;
    changes: Array<{ property: string; before: unknown; after: unknown }>;
  }>;
}
```

`export_requirement_design_asset` 输入：

```typescript
{
  product_id: string;
  requirement_id: string;
  node_id: string;
  format: "png" | "svg" | "pdf";
}
```

返回值：

```typescript
{
  product_id: string;
  requirement_id: string;
  node_id: string;
  format: "png" | "svg" | "pdf";
  export_source: "pencil_export_nodes" | "forma_scene_svg";
  path: string;
  source: "requirement_canvas";
}
```

执行规则：

1. `node_id` 必须存在于 `get_requirement_design_scene.nodes[]`，且属于当前 requirement canvas。
2. 导出时只能读取需求级 `design.pen`，不得读取页面级 `D-*`。
3. `format: "png" | "pdf"` 必须通过 `PencilReadExportAdapter` 调用 Pencil interactive `export_nodes({ nodeIds: [node_id], outputDir, format })` 导出，`export_source` 返回 `pencil_export_nodes`。如果导出发生在 active app-bound session 内，adapter 绑定当前 `staging_path`；如果导出已提交的正式画布，adapter 只能以只读/headless export session 打开正式 `design.pen` 并把输出写入请求专属临时目录，不得保存或替换正式 `.pen`。
4. `format: "svg"` 不走 Pencil `export_nodes`。当前 Pencil interactive `export_nodes` 不支持 SVG；SVG 必须由 Forma 基于 `get_requirement_design_scene` 的结构化 scene payload 生成，`export_source` 返回 `forma_scene_svg`。
5. SVG 导出只能覆盖 scene payload 明确支持的 frame、rect、text、image、基础 fill、stroke、圆角、opacity、层级和 transform。遇到 `unsupported_properties` 时仍可导出，但必须在返回结果或日志中暴露 warning，不能声称与 Pencil App 像素一致。
6. `node_id` 不存在返回 `NODE_NOT_FOUND`；节点不属于当前需求返回 `NODE_NOT_OWNED`。

`get_requirement_design_scene` 返回后台设计页和 agent 可共同消费的结构化场景。它不是 raw `.pen` dump，也不是截图 OCR；它是从需求级 `design.pen` 解析出的稳定只读 scene payload：

```typescript
interface DesignSceneNode {
  node_id: string;
  parent_node_id?: string;
  name: string;
  type: string;
  page_id?: string;
  frame_id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  z_index: number;
  text?: {
    content: string;
    font_family?: string;
    font_size?: number;
    font_weight?: string | number;
    line_height?: number;
  };
  fill?: string | { type: "image"; url: string; mode?: string } | { type: "gradient"; value: unknown };
  stroke?: string;
  corner_radius?: number | [number, number, number, number];
  component?: {
    component_key?: string;
    ref_node_id?: string;
    source_snapshot_component_id?: string;
  };
  unsupported_properties: string[];
}

interface RequirementDesignScene {
  product_id: string;
  requirement_id: string;
  canvas_path: string;
  source: "requirement_canvas";
  coordinate_space: "pencil";
  bounds: { x: number; y: number; width: number; height: number };
  pages: Array<{
    page_id: string;
    frame_id: string;
    frame_name: string;
    design_status: "pending" | "done" | "expired";
    preview_state: "available" | "pending" | "expired" | "missing";
    preview_file?: string;
    preview_url?: string;
    preview_version?: number;
  }>;
  nodes: DesignSceneNode[];
  unsupported_properties: Array<{
    node_id: string;
    property: string;
    reason: string;
  }>;
}
```

AI 需要理解设计结构时必须读取 `get_requirement_design_scene`；需要判断真实视觉效果时才读取 screenshot，并且 screenshot review 仍然是非阻断 warning。

`index_component_usages` 用于重新扫描需求主画布中的组件实例关联：

```typescript
{
  product_id: string;
  requirement_id: string;
  page_ids?: string[];
  component_keys?: string[];
}
```

返回值：

```typescript
{
  product_id: string;
  requirement_id: string;
  indexed_usages: Array<{
    page_id: string;
    component_key: string;
    binding_id: string;
    instance_node_id: string;
    source_snapshot_component_id: string;
    source_library_version: number;
    status: "linked";
  }>;
  unlinked_usages: Array<{
    page_id: string;
    component_key?: string;
    node_id: string;
    reason: "missing_ref" | "missing_metadata" | "snapshot_mismatch";
  }>;
}
```

`refresh_requirement_components` 必须支持 scoped refresh 预检，并生成受控写操作计划。它不直接修改 `.pen`，不导出 preview，不推进 `design.yaml.component_library.version`：

```typescript
{
  session_id: string;
  product_id: string;
  requirement_id: string;
  version: "latest" | number;
  scope?: ComponentRefreshScope;
}
```

成功返回值：

```typescript
{
  session_id: string;
  product_id: string;
  requirement_id: string;
  base_revision: string;
  old_component_library_version?: number;
  target_component_library_version: number;
  planned_affected_pages: Array<{
    page_id: string;
    frame_id: string;
    planned_usages: Array<{
      component_key: string;
      binding_id: string;
      instance_node_id: string;
    }>;
  }>;
  operations: Array<{
    tool: "batch_design";
    args: Record<string, unknown>;
    target_node_ids?: string[];
    intent: "component_refresh";
  }>;
}
```

`refresh_requirement_components` 的阻断语义必须是 stable error，不允许“部分成功 result”：

1. 只要预检发现目标 scope 内存在 unlinked usage、缺失 `component_key`、existing canvas synthetic snapshot、组件库无法映射、语义契约变化、override 冲突或任一目标页面不可更新，工具必须 throw stable error，不返回上述成功 payload。
2. 错误 code 分别使用 `COMPONENT_USAGE_UNLINKED`、`COMPONENT_LIBRARY_UNMAPPED`、`COMPONENT_CONTRACT_CHANGED`、`COMPONENT_OVERRIDE_CONFLICT` 或 `COMPONENT_REFRESH_PARTIAL_BLOCKED`；错误 details 必须包含 `blocked_pages[]`、`blocked_usages[]`、`candidate_pages[]` 和 `scope`，方便 UI 展示，但 `operations` 必须为空或不存在。`candidate_pages[]` 只表示预检阶段发现“如果没有阻断本会受影响”的页面，不是成功计划。
3. `planned_affected_pages[]` 和 `operations[]` 只出现在无阻断的成功返回中。成功返回后必须继续调用 `apply_requirement_design_operations` 和 `commit_requirement_design_session`，否则不得推进 `design.yaml.component_library.version`。
4. `component_refresh_commit.skipped_pages` 只能由 commit 阶段报告“有效 scope 内重新扫描后没有匹配 linked usage”的页面，不能承载失败页面、显式指定的非 done 页面或导出失败页面。失败页面只能走 stable error。

`plan_import_metadata_normalization` 必须为 unmanaged imported 页面生成 metadata 标注计划。它只读 active session 的 staging `.pen`、`semantic_scope.yaml` 和当前页面 frame，不直接修改 `.pen`，不导出 preview，不推进 `design.yaml` 或 `requirement.yaml`：

```typescript
{
  session_id: string;
  product_id: string;
  requirement_id: string;
  page_id: string;
  frame_id: string;
}
```

成功返回值：

```typescript
{
  session_id: string;
  product_id: string;
  requirement_id: string;
  page_id: string;
  frame_id: string;
  base_revision: string;
  normalization_plan_id: string;
  mapped_nodes: Array<{
    node_id: string;
    metadata: Record<string, unknown>;
    source:
      | "page_frame"
      | "allowed_copy"
      | "allowed_action"
      | "allowed_field"
      | "allowed_navigation"
      | "component_ref";
  }>;
  operations: Array<{
    tool: "batch_design";
    args: Record<string, unknown>;
    target_node_ids: string[];
    intent: "import_metadata_normalization";
    normalization_plan_id: string;
  }>;
}
```

计划规则固定如下：

1. `session_id` 必须指向 running requirement canvas session，且目标页的上一版 `quality_report.import_adoption.mode === "unmanaged_import"`。当前 `staging.design.pen` revision 必须等于 `design_session.last_controlled_revision`；不一致时返回 `MANUAL_EDIT_DETECTED`。
2. planner 必须读取 session 内固定的 `semantic_scope.yaml`，并用 `session_batch_get(resolveInstances: false, parentId: frame_id)` 扫描目标 frame。它不得从 requirement 自由文本、baseline 聚合契约、translations 以外的语言文本或截图推断语义。
3. page frame root 固定写入 `metadata.type: "forma"`、`metadata.kind: "requirement_page"` 和 `metadata.page_id`。非交互静态文本只有在 `content` 精确匹配 `allowed_copy.text` 时才可写入 `metadata.type: "forma"`、`metadata.kind: "requirement_copy"`；无法匹配的非空文本必须进入 unresolved。
4. action、field 和 navigation 只能在现有节点文本、控件语义或已存在 Pencil 行为能唯一匹配一个 `allowed_actions[].key`、`allowed_fields[].key` 或 `allowed_navigation_targets[]` 时写入对应 metadata。出现多个候选、没有候选或候选来自未声明语义时返回 `UNMANAGED_METADATA_NORMALIZATION_REQUIRED`。
5. component metadata 只能标注已经是 `ref`、且引用目标位于当前需求 `Components - Snapshot v{version}` 内的节点；detached copy、缺失 ref、snapshot 不匹配或 component key 不在 `allowed_component_keys[]` 时返回 `UNMANAGED_METADATA_NORMALIZATION_REQUIRED` 或对应组件 stable error。
6. planner 返回的 `operations[]` 只能写 node metadata，不得改变节点几何、样式、层级、copy、ref target 或 children。`apply_requirement_design_operations(intent: "import_metadata_normalization")` 只能执行带有最近一次 `normalization_plan_id` 的 metadata-only operations；plan 生成后 staging revision 改变时，旧 plan 失效，必须重新生成。
7. 如果所有需要语义 metadata 的节点都能唯一映射，planner 返回成功 payload；如果任一节点无法唯一映射，planner 必须 throw `UNMANAGED_METADATA_NORMALIZATION_REQUIRED`，details 包含 `unresolved_nodes[]`、`allowed_copy[]`、`allowed_actions[]`、`allowed_fields[]`、`allowed_navigation_targets[]` 和 `allowed_component_keys[]`，且不返回 `operations`。
8. 执行返回的 operations 后，调用方必须重新运行 `validate_requirement_design_quality` 或 commit 内置质量门；Semantic Scope Guard 不得因为页面曾经是 unmanaged import 而放宽 active session 提交规则。

`validate_requirement_design_quality` 只运行 active session 内的 Pencil 原生和 Forma 确定性质量检查，不修改 `.pen`，不调用 AI。发现可确定性修复的问题时，它只能返回 `quality_report.repair_plan`：

```typescript
{
  session_id: string;
  product_id: string;
  requirement_id: string;
  page_id: string;
  frame_id: string;
}
```

返回值：

```typescript
{
  session_id: string;
  product_id: string;
  requirement_id: string;
  page_id: string;
  frame_id: string;
  quality_report: DesignQualityReport;
}
```

执行前必须确认 `session_id` 处于 `running`，且当前 `staging.design.pen` revision 等于 `design_session.last_controlled_revision`；不一致时返回 `MANUAL_EDIT_DETECTED`。如果 `quality_report.status === "blocked"`，调用方只能选择执行 `repair_plan` 后重新校验、丢弃 session 或把错误返回用户；不能调用 commit 试图跳过质量门。

### Web / Server API 调整

后台 Web API 也必须从 `design_id` 模型切到 requirement-level 模型。`packages/web/src/api.ts`、页面路由和 server routes 不能继续把 `design_id` 暴露给前端。

`RequirementPage` API 字段调整：

```typescript
interface RequirementPage {
  page_id: string;
  name: string;
  baseline_page: string;
  design_status: "pending" | "done" | "expired";
  semantic_contract: {
    copy_texts: string[];
    fields: SemanticFieldEntry[];
    actions: SemanticActionEntry[];
    navigation_targets: string[];
    component_keys: string[];
  };
  semantic_contract_coverage: "full" | "minimal";
  change_type?: "new" | "patch" | "rebuild";
  change_summary?: string;
  copy?: CopyItem[];
  declared_fields?: Array<{ key: string; label: string; source?: "requirement" | "baseline" | "product_rule" }>;
  declared_actions?: Array<{ key: string; label: string; source?: "requirement" | "baseline" | "product_rule" }>;
  declared_component_keys?: string[];
  fields?: string;
  features?: string;
  interactions?: string;
}
```

禁止字段：

- `design_id`
- `design_metadata.design_id`
- `image_url` 中的 design id
- 页面级 `pen_path`

新增 requirement-level routes：

| route | method | source |
| --- | --- | --- |
| `/api/products/:productId/requirements/:requirementId/design/canvas` | `GET` | `get_requirement_design_canvas` |
| `/api/products/:productId/requirements/:requirementId/design/index` | `POST` | `index_requirement_design_canvas` |
| `/api/products/:productId/requirements/:requirementId/design/scene` | `GET` | `get_requirement_design_scene` |
| `/api/products/:productId/requirements/:requirementId/design/history?page_id=` | `GET` | `get_requirement_design_history` |
| `/api/products/:productId/requirements/:requirementId/design/preview/:pageId/file?page_version=` | `GET` | `design.yaml.pages[].preview_file` 或 history preview |
| `/api/products/:productId/requirements/:requirementId/design/export?node_id=&format=` | `GET` | `export_requirement_design_asset` |
| `/api/products/:productId/requirements/:requirementId/design/diff?page_id=&from_page_version=&to_page_version=` | `GET` | `diff_requirement_design_versions` |
| `/api/products/:productId/design/session/active` | `GET` | product-level `active-design-session.yaml` |
| `/api/products/:productId/requirements/:requirementId/design/session/active` | `GET` | requirement-level `sessions/active.yaml` |

新增 requirement-level mutation routes：

| route | method | source |
| --- | --- | --- |
| `/api/products/:productId/requirements/:requirementId/design/session/begin` | `POST` | `begin_requirement_design_session` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/operations` | `POST` | `apply_requirement_design_operations` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/quality` | `POST` | `validate_requirement_design_quality` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/component-refresh/plan` | `POST` | `refresh_requirement_components` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/import-metadata-normalization/plan` | `POST` | `plan_import_metadata_normalization` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/rollback/plan` | `POST` | `rollback_requirement_design` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/commit` | `POST` | `commit_requirement_design_session` |
| `/api/products/:productId/requirements/:requirementId/design/session/:sessionId/discard` | `POST` | `discard_requirement_design_session` |

新增 product component library routes：

| route | method | source |
| --- | --- | --- |
| `/api/products/:productId/component-library` | `GET` | `get_product_component_library` |
| `/api/products/:productId/component-library/session/begin` | `POST` | `begin_product_component_session` |
| `/api/products/:productId/component-library/session/:sessionId/operations` | `POST` | `apply_product_component_operations` |
| `/api/products/:productId/component-library/session/:sessionId/commit` | `POST` | `commit_product_component_session` |
| `/api/products/:productId/component-library/session/:sessionId/discard` | `POST` | `discard_product_component_session` |
| `/api/products/:productId/design/session/:sessionId/recover-commit-journal` | `POST` | `recover_design_commit_journal` |

这些 mutation routes 和 MCP tools 使用同一套输入 schema、路径参数禁令、stable error code 和 product/pencil lock 规则。preflight-only 和 recovery-only 模式下，上述 mutation routes 不注册或统一返回对应 409 normalization error。后台 UI 的生成、refine、rebuild、rollback 和 component refresh 按钮必须调用这些 routes 或同名 MCP-backed Web adapter；点击后必须立即获得 `session_id` 或 stable error，并通过 active session routes 轮询状态。后台 UI 不得直接调用 raw Pencil MCP，不得向 mutation payload 传入 `canvas_path`、`staging_path`、`outputDir` 或任何文件路径字段。

baseline preview 也必须切到 requirement-level 索引，不能继续从 `requirement.yaml.pages[].design_id` 反查：

1. `get_baseline_image` 和 `/api/products/:productId/baseline/pages/:pageId/image` 先读取 baseline page 的 `source_requirements[]`，再读取该产品所有 requirements。
2. 候选 requirements 必须满足：`id` 在 `source_requirements[]` 内、`status !== "archived"`，并且存在 `pages[].baseline_page === pageId` 且该 requirement page 的 `design_status === "done"`。`pending`、`expired` 和 archived requirement 都不能作为 baseline preview 来源。
3. 候选排序必须固定为 `updated_at desc, id desc`，不能依赖 `getRequirementHistory()` 当前返回顺序。实现层应复用或新增 `compareUpdatedAtDesc`，并在 server、MCP 和 Web API 测试中覆盖同 timestamp 的 id tie-break。
4. 对每个候选 requirement，读取 `$FORMA_HOME/data/{product_id}/{requirement_id}/design.yaml`；如果 `design.yaml.pages[]` 中存在同一 `page_id`、`status === "done"` 且 `preview_file` 可读，返回 requirement-level payload：

   ```typescript
   {
     product_id: string;
     baseline_page_id: string;
     requirement_id: string;
     requirement_page_id: string;
     preview_url: string;
     preview_path: string;
     canvas_path: string;
     page_version: number;
     canvas_version: number;
   }
   ```

5. baseline image payload 不得包含 `design_id`、页面级 `pen_path` 或 `/api/designs/:designId/*` URL。
6. 如果 source requirements 都没有可用 requirement-level preview，返回 `BASELINE_IMAGE_NOT_FOUND`；不得扫描页面级 `D-*` 目录作为 fallback。

旧 Web routes 必须从 Fastify route table 和前端 route table 删除，不提供 redirect、不提供 Forma 错误 handler。启用 `webAssetsDir` 时，server 的 SPA fallback 也必须排除旧设计详情路径 `/products/:productId/requirements/:requirementId/designs/:designId`，否则该路径会返回 `index.html` 并伪装成可用页面；它必须表现为 default 404，和旧 `/api/designs/:designId/*` routes 一致。

| old route | v6 behavior |
| --- | --- |
| `/api/designs/:designId/annotations` | not registered; default 404 |
| `/api/designs/:designId/image` | not registered; default 404 |
| `/api/designs/:designId/image/file` | not registered; default 404 |
| `/api/designs/:designId/history` | not registered; default 404 |
| `/api/designs/:designId/diff` | not registered; default 404 |
| `/api/designs/:designId/export` | not registered; default 404 |
| `/products/:productId/requirements/:requirementId/designs/:designId` | not registered; default 404 |

前端页面调整：

1. `RequirementDetail` 的页面列表不再从 `page.design_id` 生成设计链接；每个页面链接到 `/products/{productId}/requirements/{requirementId}/design?page_id={page_id}`。
2. `DesignView` 的 route 参数从 `designId` 改为 `productId + requirementId + optional page_id`。
3. `DesignView` 首屏必须先读 `design/canvas`。只有 `index_status === "complete"`，或 `index_status === "stale"` 且 `design.yaml` 与 preview 仍可读时，才继续读取 `design/scene`。如果 `index_status` 是 `missing` 或 `incomplete`，直接显示“建立主画布索引”动作，不读取 scene，也不在 render 阶段触发写操作；如果是 `recovery_required`，只显示索引恢复错误、journal 路径和受影响文件，不读取 scene、不触发重新索引。
4. `DiffViewer` 改为 requirement-level diff，输入从 `designId + version` 改为 `productId + requirementId + page_id + from_page_version + to_page_version`，并读取 `design/diff?page_id=&from_page_version=&to_page_version=`。
5. `PropertyPanel` 的导出链接改用 requirement-level `design/export`，参数是真实 `node_id` 和 `format`。
6. 所有前端类型、测试 fixture 和 API client 中的 `design_id` 必须删除；旧 route 和旧字段名只允许在迁移文档、删除说明或 404/unknown 负向断言测试中以字符串形式出现。

### Agent 模板要求

`fm-design` / `$fm-design` 模板改为：

1. 先调用 `get_requirement_design_canvas` 检查是否已有需求主画布。
2. 如果已有主画布但缺少 `design.yaml` 或页面索引不完整，先调用 `index_requirement_design_canvas` 扫描并建立索引。
3. 如果产品组件库不存在，先执行 `generate_components` agent macro；该 macro 必须先从当前 requirement 的 `semantic_contract.component_keys[]`、`declared_component_keys[]` 和 product rules `semantic.component_keys[]` 生成 `seed_components[]`，再显式调用 `begin_product_component_session(seed_components)`、`apply_product_component_operations` 和 `commit_product_component_session`。成功 commit 写入 `components.yaml.current_version` 后即视为组件库初始化完成，不再调用 `complete_product_init`。
4. 根据页面状态、`change_type` 和用户意图为每个目标页面确定动作类型。
5. 读取 `get_requirement` 返回的页面 `semantic_contract` 和 `semantic_contract_coverage`，并确定本次 `design_language`；用户没有明确要求语言时使用 product `default_language`。agent 不自行拼装 allowed surface。真正的允许语义面由 `begin_requirement_design_session` 在后端从 `semantic_contract`、navigation、业务规则、已有 frame metadata、baseline 等价 label 和本语言有效翻译派生并写入 `semantic_scope.yaml`。如果 `semantic_contract` 在 strict schema 下缺失，这是数据损坏，返回 schema validation error；如果 `semantic_contract_coverage: minimal` 且用户请求超出最小契约，返回 `SEMANTIC_CONTRACT_REQUIRED`，要求先运行 `fm-requirement`。
6. 如果用户请求新增组件、页面、入口、字段、交互、导航或业务 copy，返回 `REQUIREMENT_UPDATE_REQUIRED`，要求先运行 `fm-requirement`。
7. 如果用户请求“更新当前需求/所有页面/指定页面的通用组件”，把动作类型改为 `component_refresh`，先调用 `index_component_usages` 做只读预检并确定刷新范围；不得在 active session 之前生成写操作计划。
8. `component_refresh` 发现 unlinked usage、缺失 `component_key`、组件库无法映射、语义契约变化或 override 冲突时，必须阻断并返回对应错误，不进入页面 redesign。
9. 展示目标页面、动作类型、组件刷新范围、`semantic_contract` 覆盖范围和质量检查策略，等待用户确认。
10. 调用 `begin_requirement_design_session`，确保 Pencil App 打开当前 session 的 `staging.design.pen`。如果没有主画布，由 begin 创建并打开最小空 staging；当前产品组件库快照必须在随后通过 `apply_requirement_design_operations` 嵌入，不能由 begin 隐式写入。
11. begin 返回 `session_id`、`pencil_binding_id` 和 `staging_path` 后，agent 才能调用 `session_get_editor_state(include_schema: true)`、`session_get_guidelines`、`session_get_variables` 和其他 session-scoped read/export wrapper，把 Pencil schema、平台 guide、Design System guide、变量和颜色格式约束写入设计 prompt。
12. 如果目标页面来自 unmanaged import 且 `import_adoption.mode === "unmanaged_import"`，先调用 `plan_import_metadata_normalization({ session_id, page_id, frame_id })`。只有该工具返回完整 `operations[]` 时，才通过 `apply_requirement_design_operations(intent: "import_metadata_normalization")` 执行 metadata-only operations，然后运行 strict Semantic Scope Guard；planner 返回 `UNMANAGED_METADATA_NORMALIZATION_REQUIRED` 或 `REQUIREMENT_UPDATE_REQUIRED` 时停止，不进入视觉修改。
13. `generate`、`refine`、`rebuild` 的所有写入，包括创建缺失页面 frame、写入 page metadata 和嵌入缺失组件快照，都通过 `apply_requirement_design_operations` 提交；agent 不得直接调用 Pencil 写工具。
14. `component_refresh` 只更新组件快照和已关联实例，不允许新增需求外页面元素；active session 建立后必须调用 `refresh_requirement_components(session_id, ...)` 生成写操作计划，并把 `operations[]` 交给 `apply_requirement_design_operations`。
15. 每个页面完成后先执行 semantic scope check 和 `validate_requirement_design_quality(session_id, ...)`。
16. 如果质量硬校验失败且 `quality_report.repair_plan.operations[]` 非空，允许在同一 session 内通过 `apply_requirement_design_operations(intent: "quality_repair")` 执行一次 bounded repair，然后重新运行 `validate_requirement_design_quality(session_id, ...)`。
17. 第二次质量硬校验仍失败时，返回对应错误，不导出正式 preview，不推进页面状态。
18. 硬校验通过后，agent 按能力执行可选 AI screenshot review；单页提交把结果作为 `commit_requirement_design_session.ai_visual_review` 提交，组件刷新把结果按页面写入 `ai_visual_reviews[]`；无视觉能力时记录 `AI_VISUAL_REVIEW_SKIPPED`，不阻断。
19. 调用 `commit_requirement_design_session`；`page_commit` 写入单页 preview、页面状态和 `quality_report`，`component_refresh_commit` 写入受影响页面 previews、usage index 和组件库版本。
20. 汇报 `kind`、`canvas_path`、`pencil_binding_id` 和提交结果；`page_commit` 必须汇报 `page_id`、`frame_id`、`frame_name`、`preview_path`、`quality_report`，`component_refresh_commit` 必须汇报 `affected_pages` 和 `updated_usages`。

`fm-design` 的页面动作决策表：

| 页面状态 | change_type | 用户意图 | 动作 |
| --- | --- | --- | --- |
| `pending` | `new` | 默认 | `generate` |
| `expired` | `patch` | 默认 | `refine` |
| `expired` | `rebuild` | 默认 | `rebuild` |
| `done` | 任意 | 明确要求调整 | `refine` |
| `done` | 任意 | 明确要求重做 | `rebuild` |
| 任意 | 任意 | 明确要求更新通用组件 | `component_refresh` |

动作含义：

- `generate`：创建或补齐目标页面 frame。
- `refine`：保留页面结构和 requirement copy，在目标页面 frame 上做局部调整。
- `rebuild`：保留 `page_id` metadata 和需求 copy，重做目标页面 frame 的视觉结构。
- `component_refresh`：刷新需求主画布中的组件快照，并把页面中已关联的 `ref` 实例重新绑定到新快照组件；不新增页面语义。

`fm-refine-design` 删除，不作为独立 route、skill 或旧 alias。删除落点必须明确：

1. `packages/agent/src/index.ts`、agent template manifest、`help`、安装后的 route 列表和 docs 都不得继续把 `fm-refine-design` 当作可用 route 暴露。
2. 低层 route dispatcher 不保留 `fm-refine-design` handler；显式输入旧 route 名时按 agent 平台默认 unknown command 处理。
3. Codex 模板源目录删除 `packages/agent/templates/codex/fm-refine-design/`；Claude/Gemini 模板源文件删除对应 `fm-refine-design` 文件。
4. `forma install` 的 managed manifest 不再包含 `fm-refine-design`。安装升级时如果发现由 Forma 管理的旧目标文件，直接删除该目标文件和 manifest entry；非 Forma 管理文件不处理。

`fm-rollback-design` 保留，但必须改造为 v6 requirement-level rollback route，不属于旧 route：

1. `packages/agent/src/index.ts` 继续保留 `fm-rollback-design`，但模板必须删除所有 `design_id` 输入、`rollback_design` 调用和页面级 `D-*` 路径。
2. route 输入必须是 `product_id`、`requirement_id`、`page_id` 和 `target_page_version`；如果用户只给旧 `design_id`，返回 `REQUIREMENT_DESIGN_CONTEXT_REQUIRED`，要求选择 requirement 和 page，不做兼容查询。
3. 执行流程固定为 `get_requirement_design_history` -> `begin_requirement_design_session(operation: "rollback")` -> `rollback_requirement_design` -> `apply_requirement_design_operations` -> `commit_requirement_design_session`。
4. 成功汇报 `page_version`、`canvas_version`、`restored_from_page_version`、`preview_path` 和 `canvas_path`；不得汇报 `design_id` 或页面级 `pen_path`。
5. `fm-rollback-design` 的 Codex、Claude、Gemini 模板、docs 和 installer manifest 都必须更新；旧 MCP `rollback_design` 仍然删除，显式调用旧工具名按 unknown tool 处理。

`fm-change-style` / `$fm-change-style` 模板改为：

1. 更新产品 style 配置。
2. 打开 Pencil App，重新生成产品级组件库 latest 和版本快照。
3. 不自动修改任何已有 requirement `design.pen`。
4. 汇报新的 `component_library_version` 和 `library_path`。
5. 如果用户要求当前需求同步最新组件，提示用户回到 `fm-design` 执行 `component_refresh`；不得只调用 `refresh_requirement_components`，因为它只生成预检和受控写操作计划。

`fm-refine-components` / `$fm-refine-components` 模板改为：

1. 基于当前产品配置和用户反馈 refine 产品级组件库。
2. 打开 Pencil App，生成新的产品级组件库 latest 和版本快照。
3. 不自动修改任何已有 requirement `design.pen`。
4. 汇报新的 `component_library_version` 和 `library_path`。
5. 如果用户要求当前需求同步最新组件，提示用户回到 `fm-design` 执行 `component_refresh`；不得只调用 `refresh_requirement_components`，因为它只生成预检和受控写操作计划。

## 后台 UI 调整

需求详情页需要显示：

- 主设计稿入口：打开 `design.pen`
- 当前需求钉住的组件库版本
- 产品级 latest 组件库版本
- 当前设计会话状态
- Pencil App 正在绘制的页面
- 已运行时间
- Pencil App session 状态
- 锁占用信息
- 最近一次主画布索引结果
- 最近一次组件 usage index 结果
- 组件刷新预检结果，例如 affected pages、unlinked usages、contract conflicts
- 最近一次 Design Quality Pipeline 结果
- AI screenshot review 状态，例如 skipped、warning、passed

页面列表继续展示 `design_status`，但设计历史区域要从“散落的页面设计记录”升级为需求主画布版本和页面 frame 预览：

```text
需求主画布
  design.pen
  component library v3 (pinned)
  component usages indexed at 2026-05-20T00:00:00.000Z

页面预览
  splash    done       quality passed    previews/splash@2x.png
  login     done       quality warning   previews/login@2x.png
  scenes    pending    quality pending

组件使用
  bottom_nav        used by 12 pages     linked
  primary_button    used by 7 pages      linked
  sound_card        used by 3 pages      1 unlinked

质量报告
  color_format       passed
  layout_snapshot    passed
  preview_export     passed
  ai_visual_review   skipped (not_requested)
```

当锁存在时，按钮不能只是无响应。必须显示：

```text
Pencil App 正在绘制 scenes，Pencil 进程 PID 70604，已运行 03:12
```

### 后台图谱画布交互模型

后台管理里的导航图谱、需求页面关系图和未来的组件 usage 图都必须使用可平移、可缩放的无限画布交互。图谱画布不是 `.pen` 设计稿渲染源，但它和 `DesignSceneCanvas` 要保持一致的基础操作习惯，避免节点多时只能看固定视口。

图谱画布规则：

1. 使用 LeaferJS 作为图谱 scene runtime，节点和边仍由 Forma 的 layout 数据驱动，不从 screenshot 或 preview 反推。
2. 支持滚轮缩放、拖拽平移、fit graph、fit selection、100% 缩放和 reset view。
3. 缩放和平移后，节点点击、hover 高亮、边高亮和选中详情必须继续稳定。
4. 画布外层可以裁切视口，但不能限制 scene 的可移动范围；图谱节点超出初始视口时用户必须能移动到对应区域。
5. 保留无障碍替代入口：图谱下方或隐藏区域仍提供页面节点列表，键盘和屏幕阅读器可以选择页面。
6. 图谱布局算法只负责生成初始节点和边坐标；用户视图状态（pan/zoom/fit）不应回写 baseline、requirement 或 `.pen` 数据。

### 后台设计页画布渲染模型

后台设计页必须使用 `.pen` 的场景树作为主渲染源。旧的扁平 `AnnotationNode[]` 抽取只能表达节点 id、层级、坐标、尺寸、文案和基础样式，不足以表达完整视觉语义。v6 使用 scene 级读取契约，让后台 UI 和 agent 都能读取更完整的结构化设计信息。

主画布渲染规则：

1. 使用 LeaferJS 渲染 `.pen` 中的 frame、rect、text、image、基础 fill、stroke、圆角、opacity、层级和绝对坐标。
2. 画布区域是无限画布，支持拖拽平移、滚轮缩放、fit page、fit selection、100% 缩放和按页面 frame 定位。
3. 点击、hover 和框选必须命中 Leafer 元素本身，选中状态绑定 Pencil `node_id`，不能通过截图坐标反推。
4. 属性面板展示选中节点的 Pencil 路径、`node_id`、几何信息、文字、图片、fill/stroke、组件/ref 信息、usage index 和 unsupported properties。
5. 多选时支持测量间距；测量基于 `.pen` 坐标，不基于截图像素。
6. `DesignSceneCanvas` 标题区必须提供“打开真实截图”入口，打开 `get_requirement_design_scene.pages[]` 返回的 `preview_url`。这个 URL 指向当前页面 frame 由 Pencil `export_nodes` 导出的 `preview_file`，用于人工对照 LeaferJS 渲染和 Pencil 真实截图差异，不参与点击、hover、框选或属性解析。
7. `preview@2x.png` 和 screenshot 只用于历史缩略图、视觉对照、AI screenshot review 和渲染失败时的只读对照。

真实截图入口的数据规则：

1. 对 `done` 页面，`get_requirement_design_scene.pages[].preview_state` 必须是 `available`，且 `preview_file` 和 `preview_url` 必须存在；缺失时 `preview_state` 返回 `missing`，并按上文 preview 错误码边界返回或记录 `PREVIEW_NOT_EXPORTED` 数据完整性错误。
2. 对 `pending` 页面，`preview_state` 必须是 `pending`，入口禁用或隐藏，并显示页面尚未导出 preview。
3. 对 `expired` 页面，`preview_state` 必须是 `expired`，入口打开该页面上一版已导出的 `preview_url`，并在 UI 中标记为 expired snapshot。
4. 不允许为了打开截图而重新导出、修改 `.pen` 或推进页面状态。

渲染精度目标是结构级高保真，不是 Pencil 像素级替代。以下能力需要显式标记支持状态，不能静默忽略：

- component `ref` 展开关系和 descendants
- auto layout / flex / constraints
- transform matrix、rotation、scale
- clip、mask、overflow
- 图片填充模式、裁切和缩放
- gradient、shadow、blur、blend mode
- 字体加载、字重、行高、换行和文本裁切
- Pencil 默认值和未知属性

不支持的属性必须进入 scene payload 的 `unsupported_properties`，并在 UI 中显示 warning。后台画布仍可继续用于定位和选中，但不能声称与 Pencil App 像素一致。

当 LeaferJS 结构级渲染与 Pencil 导出的真实截图不一致时，UI 必须把差异归类为 `scene_unsupported_property`、`preview_expired`、`preview_export_failed` 或 `possible_renderer_bug`。属于 `unsupported_properties` 覆盖范围的差异不是设计生成失败，页面状态不应因此回退；UI 必须提示用户以“打开真实截图”作为视觉验收来源。只有基础能力范围内的 frame、rect、text、image、fill、stroke、圆角、opacity、层级、绝对坐标或 node hit-test 出错时，才标记为 renderer bug 并进入修复队列。

后台设计页的可访问性、响应式和本地化边界固定如下：

1. `DesignSceneCanvas` 的 pan、zoom、fit page、fit selection、100% 缩放、reset view、打开真实截图、页面定位和清空选中都必须是可聚焦按钮或菜单项，不能只有鼠标手势入口。键盘操作固定为：方向键平移 48px，`Shift + 方向键` 平移 240px，`+` / `-` 缩放一级，`0` 回到 100%，`F` fit 当前 page 或 selection，`Esc` 清空选中。
2. 画布容器必须暴露 `role="application"` 或等效可访问区域标签，并通过 `aria-describedby` 指向当前页面、缩放比例、选中节点数量和 renderer warning 摘要。所有 icon-only 控件必须有本地化 `aria-label` 和 tooltip。
3. `DesignSceneCanvas` 旁边必须保留页面 frame 列表和节点列表作为非画布替代入口。键盘和屏幕阅读器用户可以从列表选中页面或节点；列表选中必须同步到画布和 `PropertyPanel`，画布选中也必须同步回列表。
4. `PropertyPanel` 必须能只用键盘浏览选中节点的路径、几何、文本、组件/ref、usage index、unsupported properties 和导出动作；多选间距结果必须同时以可读文本展示，不能只画辅助线。
5. 宽度低于 768px 时，`DesignView` 使用单列布局：顶部显示页面选择和 session 状态，中间是固定最小高度 360px 的画布，下方是 `PropertyPanel`、质量报告和截图入口。画布控件换成两行工具条，任何按钮文本或状态文案不得溢出容器。
6. 宽度 768px 及以上时，画布和属性面板使用双栏布局；属性面板最小宽度 320px，画布可以收缩但不能小于 480px。页面列表、质量报告和锁状态不得覆盖画布交互层。
7. 所有新增 Web UI 文案必须进入 `packages/web/src/i18n.ts` 的 `en` / `zh` message map，并通过 `useT()` 读取。不得在 `DesignSceneCanvas`、`DesignView`、`PropertyPanel`、recovery/preflight 状态页或 session 状态组件中硬编码中文或英文 UI 文案。API error code 保持英文 technical literal，UI 展示文案使用本地化 message key。
8. 后台设计页状态文本必须来自结构化 API 字段，例如 `session_id`、`pencil_binding_id`、`pid`、`elapsed_ms`、`page_id`、`operation` 和 lock details。UI 可以格式化显示时间，但不能把自由文本日志当作唯一状态来源。

## 锁与失败恢复

### 服务启动恢复边界

`forma serve` 必须优先保证后台管理可启动。启动链路不得同步等待设计生成、Pencil session、产品删除恢复或页面设计索引恢复完成；这些恢复只能作为后台任务执行，并通过日志、状态接口或 UI warning 暴露结果。

禁止把需要获取产品级 mutation lock 的恢复任务放进 Fastify `onReady` 等阻塞启动的 hook。原因是设计生成、MCP 调用、样式同步和产品删除都会共享产品级 mutation lock；如果启动阶段等待该锁，后台任务持锁时会触发 `onReady` 超时，导致 `forma serve` 无法启动。

schema 归一化是唯一允许出现在 strict store 之前的启动前置检查，但普通启动不得自动执行 preflight 或 cutover 写入。启动模式固定为四类：

1. `normal`：raw recovery reader 确认 `$FORMA_HOME/.v6-schema-cutover-committed` 存在且没有未恢复 journal，`createFormaStore` 成功，注册完整 API、MCP-backed Web routes 和后台恢复任务。
2. `preflight_only`：raw recovery reader 返回 `SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED`，表示 cutover 尚未 committed 或最近 preflight report 缺失/过期。`buildServer` 继续监听端口，只注册 preflight status API、静态后台入口和默认 409 handler；不注册 mutation routes，不启动 `SyncService`，不实例化 strict store。
3. `recovery_only`：raw recovery reader 返回 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`。`buildServer` 继续监听端口，只注册 recovery-only API、静态后台入口和默认 409 handler；不注册产品、需求、设计、组件、style sync 或 mutation routes，不启动 `SyncService`，不实例化 strict store。
4. `fatal_startup_error`：Fastify 自身、端口监听、静态资源目录越界或 preflight/recovery-only route 注册失败。这类错误才允许让 `forma serve` 启动失败。

recovery-only 模式的默认 409 handler 必须覆盖所有 `/api/*` 非 recovery 请求，payload 固定为：

```typescript
{
  error_code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
  message: "Schema normalization recovery required",
  details: SchemaNormalizationRecoveryState
}
```

`SchemaNormalizationRecoveryState` 来自 `readSchemaNormalizationRecoveryState(home)`，不得从 `ProductService`、`RequirementService`、`DesignService` 或 strict schema reader 派生。

preflight-only 模式的默认 409 handler 必须覆盖所有 `/api/*` 非 status 请求，payload 固定为：

```typescript
{
  error_code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
  message: "Schema normalization preflight required",
  details: SchemaNormalizationRecoveryState
}
```

preflight-only Web UI 只能显示 cutover 前置状态、最近 preflight report 路径、缺失项和执行 `forma schema-normalization-dry-run` / `forma v6-schema-cutover` 的操作提示；不得展示产品/需求编辑入口，也不得触发任何 normalizer 写操作。

启动恢复规则：

1. 产品删除恢复在后台启动；成功后写入 recovery warnings，失败时写入 recovery error，不阻断服务监听。
2. 设计 session 恢复在后台检查；Pencil App 不可用时返回 `PENCIL_APP_REQUIRED`，不触发 headless 绘制。
3. 页面设计索引恢复不得依赖页面级 `D-*` 目录。v6 只检查需求级 `design.pen`、`design.yaml`、frame mapping 和 preview index。
4. 启动恢复不读取旧 `requirement.yaml.pages[].design_id`，也不根据页面级 `D-*` 推断状态。v6 schema 归一化必须在恢复任务前完成；归一化后仍出现旧字段时，记录 schema validation error 并跳过该 requirement 的设计恢复，不影响服务监听。
5. 后台恢复任务不得静默失败。最小可观测要求是日志；后台管理 UI 和 `fm-status` 应展示最近一次恢复结果。

启动恢复只扫描以下路径，并且 commit journal 扫描必须先于 session 状态扫描：

```text
$FORMA_HOME/data/*/sessions/active-design-session.yaml
$FORMA_HOME/data/*/*/.index-stage-*/index-journal.yaml
$FORMA_HOME/data/*/*/sessions/active.yaml
$FORMA_HOME/data/*/*/sessions/*/commit-journal.yaml
$FORMA_HOME/data/*/*/sessions/*/design_session.yaml
$FORMA_HOME/library/*.sessions/active.yaml
$FORMA_HOME/library/*.sessions/*/commit-journal.yaml
$FORMA_HOME/library/*.sessions/*/design_session.yaml
```

恢复扫描不得递归读取页面级 `D-*` 目录，不得扫描系统临时目录，也不得根据 `operations.jsonl` 反推出不存在的 session。如果扫描到 orphan `commit-journal.yaml`，但对应 `design_session.yaml` 缺失或损坏，恢复状态必须记录 `DESIGN_COMMIT_RECOVERY_REQUIRED`、journal 路径和受影响正式文件；恢复器仍按 journal 的 old/candidate hash 执行恢复或一致性校验。恢复结果写入后台 recovery status，且只影响对应产品或需求的 UI 状态，不阻塞 `forma serve` 监听。

`design_session.yaml` 的落盘位置必须固定，不能由调用方猜测。

需求级 session：

```text
$FORMA_HOME/data/{product_id}/{requirement_id}/sessions/{session_id}/design_session.yaml
$FORMA_HOME/data/{product_id}/{requirement_id}/sessions/{session_id}/operations.jsonl
$FORMA_HOME/data/{product_id}/{requirement_id}/sessions/{session_id}/staging.design.pen
$FORMA_HOME/data/{product_id}/{requirement_id}/sessions/{session_id}/semantic_scope.yaml
$FORMA_HOME/data/{product_id}/{requirement_id}/sessions/{session_id}/commit-journal.yaml
$FORMA_HOME/data/{product_id}/{requirement_id}/sessions/active.yaml
$FORMA_HOME/data/{product_id}/sessions/active-design-session.yaml
```

产品组件库 session：

```text
$FORMA_HOME/library/{product_id}.sessions/{session_id}/design_session.yaml
$FORMA_HOME/library/{product_id}.sessions/{session_id}/operations.jsonl
$FORMA_HOME/library/{product_id}.sessions/{session_id}/staging.lib.pen
$FORMA_HOME/library/{product_id}.sessions/{session_id}/commit-journal.yaml
$FORMA_HOME/library/{product_id}.sessions/active.yaml
```

产品级 `active-design-session.yaml` 保存当前 active `session_id`、`scope`、`owner_path`、`local_active_path`、`canvas_path`、`staging_path`、`status` 和 `updated_at`。局部 `active.yaml` 保存当前 active `session_id`、`scope`、`canvas_path`、`staging_path`、`status` 和 `updated_at`。需求级 session 的 `canvas_path` 是正式 `$FORMA_HOME/data/{product_id}/{requirement_id}/design.pen`，产品组件库 session 的 `canvas_path` 是正式 `$FORMA_HOME/library/{product_id}.lib.pen`；两类 session 的 `staging_path` 都必须指向对应 `sessions/{session_id}` 目录下的 staging `.pen` 文件。commit、discard 或 session 进入 terminal 状态后必须清空或标记产品级 lease 和局部 `active.yaml`，不得让新 session 依赖扫描 operation log 才知道是否有 active session。

新增需求级 `design_session.yaml`：

```yaml
schema_version: 1
session_id: S-xxxxxxxx
scope: requirement_canvas
product_id: P-907011
requirement_id: R-c9b123bf
session_dir_relative: data/P-907011/R-c9b123bf/sessions/S-xxxxxxxx
session_dir: /Users/xubo/.forma/data/P-907011/R-c9b123bf/sessions/S-xxxxxxxx
operation: generate | refine | rebuild | rollback | component_refresh
page_id: scenes # component_refresh with all pages may omit page_id
component_refresh:
  version: latest
  scope: "all_pages"
quality:
  status: pending
  include_ai_visual_review: true
  ai_visual_review: skipped | warning | passed
mode: app
canvas_file: data/P-907011/R-c9b123bf/design.pen
canvas_path: /Users/xubo/.forma/data/P-907011/R-c9b123bf/design.pen
staging_file: data/P-907011/R-c9b123bf/sessions/S-xxxxxxxx/staging.design.pen
staging_path: /Users/xubo/.forma/data/P-907011/R-c9b123bf/sessions/S-xxxxxxxx/staging.design.pen
pencil_binding_id: B-xxxxxxxx
pencil_command: pencil interactive --app desktop --in /Users/xubo/.forma/data/P-907011/R-c9b123bf/sessions/S-xxxxxxxx/staging.design.pen
pencil_version: <version>
base_canvas_revision: sha256:<hash> # formal design.pen at begin; omitted only when canvas_state is created_empty
started_revision: sha256:<hash>
last_saved_revision: sha256:<hash>
last_controlled_revision: sha256:<hash>
operation_log_file_relative: data/P-907011/R-c9b123bf/sessions/S-xxxxxxxx/operations.jsonl
operation_log_file: /Users/xubo/.forma/data/P-907011/R-c9b123bf/sessions/S-xxxxxxxx/operations.jsonl
semantic_scope_file_relative: data/P-907011/R-c9b123bf/sessions/S-xxxxxxxx/semantic_scope.yaml
semantic_scope_file: /Users/xubo/.forma/data/P-907011/R-c9b123bf/sessions/S-xxxxxxxx/semantic_scope.yaml
started_at: '2026-05-20T00:00:00.000Z'
updated_at: '2026-05-20T00:00:00.000Z'
pid: 12345
status: running
```

新增产品组件库 `design_session.yaml`：

```yaml
schema_version: 1
session_id: S-yyyyyyyy
scope: product_component_library
product_id: P-907011
session_dir_relative: library/P-907011.sessions/S-yyyyyyyy
session_dir: /Users/xubo/.forma/library/P-907011.sessions/S-yyyyyyyy
operation: generate | refine | change_style
seed_components:
  - component_key: bottom_nav
    name: bottom_nav
    source: requirement_semantic_contract
    semantic_contract_hash: sha256:<hash>
    allowed_instance_overrides:
      - geometry
      - selected_state
    required_by:
      - requirement_id: R-c9b123bf
        page_id: home
mode: app
canvas_file: library/P-907011.lib.pen
canvas_path: /Users/xubo/.forma/library/P-907011.lib.pen
staging_file: library/P-907011.sessions/S-yyyyyyyy/staging.lib.pen
staging_path: /Users/xubo/.forma/library/P-907011.sessions/S-yyyyyyyy/staging.lib.pen
pencil_binding_id: B-yyyyyyyy
pencil_command: pencil interactive --app desktop --in /Users/xubo/.forma/library/P-907011.sessions/S-yyyyyyyy/staging.lib.pen
pencil_version: <version>
previous_version: 3
target_version: 4
started_revision: sha256:<hash>
last_saved_revision: sha256:<hash>
last_controlled_revision: sha256:<hash>
operation_log_file_relative: library/P-907011.sessions/S-yyyyyyyy/operations.jsonl
operation_log_file: /Users/xubo/.forma/library/P-907011.sessions/S-yyyyyyyy/operations.jsonl
started_at: '2026-05-20T00:00:00.000Z'
updated_at: '2026-05-20T00:00:00.000Z'
pid: 12345
status: running
```

session 并发规则：

1. 同一 `product_id` 同一时间最多一个 running app-bound design session，无论它是 requirement canvas 还是 product component library。实现上 begin transaction 必须先短暂获取 product mutation lock，再写产品级 `active-design-session.yaml` 和局部 `active.yaml` lease，然后释放 lock。
2. 同一个正式 `canvas_path` 或同一个 `staging_path` 不能有两个 running session；如果发现 active session 尚未进入 `committed` 或 `discarded`，新 begin 必须返回 `DESIGN_SESSION_ACTIVE`。
3. `apply_requirement_design_operations`、`apply_product_component_operations`、`commit_*_session` 和 `discard_*_session` 必须各自短暂获取 product mutation lock 与 pencil lock，并校验产品级 lease 与局部 `active.yaml.session_id` 都和输入 `session_id` 一致。
4. 任何实现都不得把 process-local lock、file lock 或 Fastify request 生命周期持有到下一次 MCP/API 调用；跨调用状态只能存入 session 文件、产品级 `active-design-session.yaml` 和局部 `active.yaml`。

lock 的实现契约必须固定，不能只使用概念名：

1. product mutation lock 路径固定为 `$FORMA_HOME/data/{product_id}/locks/product-mutation.lock`；pencil lock 路径固定为 `$FORMA_HOME/locks/pencil.lock`。
2. lock acquire 必须用 atomic create-directory 或 atomic create-file-with-exclusive-flag 实现；不得使用只在当前进程内有效的 mutex 作为跨 MCP/server/CLI 互斥。
3. lock 文件内容必须包含 `lock_id`、`owner_pid`、`owner_process_start_time`、`hostname`、`command`、`scope`、`product_id?`、`session_id?`、`acquired_at`、`expires_at` 和 `heartbeat_at`。
4. begin/apply/commit/discard 单次 backend transaction 的 lock TTL 固定为 120 秒；持锁期间每 15 秒 heartbeat 一次。正常路径必须在 transaction 结束前释放；超过 TTL 且 owner pid 不存在、或 pid 存在但 `owner_process_start_time` 不匹配时，下一次 acquire 可以把旧 lock 标记为 `stale_reclaimed` 后接管。
5. 如果 lock 未过期且 owner 可确认存活，begin 返回 `PRODUCT_MUTATION_LOCKED` 或 `PENCIL_LOCK_HELD`；details 必须包含 `lock_path`、`owner_pid`、`scope`、`session_id?`、`acquired_at`、`expires_at` 和 `heartbeat_at`。
6. 如果 lock 文件损坏、缺少必填字段、路径不是 realpath 后的 `$FORMA_HOME` 子路径，acquire 必须返回 `LOCK_CORRUPT`，HTTP 409，MCP `isError: true`；不得删除或覆盖未知 lock。
7. lease 文件不是 lock。`active-design-session.yaml` 和局部 `active.yaml` 只能表达跨调用 session 占用；每次读写正式文件、staging 文件、journal 或 session 状态前仍必须重新获取上述短事务 lock。
8. lock release 只能删除 `lock_id` 与当前 transaction 匹配的 lock；如果 lock 已被 stale reclaim 或被其他 owner 替换，release 不得删除新 owner 的 lock，必须记录 `LOCK_RELEASE_MISMATCH` warning。

session 生命周期：

```text
created -> running -> committing -> committed
created -> running -> discarded
running -> blocked_manual_edit -> discarded
running -> recoverable -> running | discarded
running -> failed_operation -> running | discarded
running -> committing -> failed_commit -> committing | discarded
committing -> commit_recovery_required -> failed_commit | discarded
```

terminal 状态只有 `committed` 和 `discarded`。`failed_operation`、`failed_commit`、`blocked_manual_edit`、`recoverable` 与 `commit_recovery_required` 都是非成功的可处理状态；它们继续占用产品级 lease 和对应局部 `active.yaml`，新 begin 必须返回 `DESIGN_SESSION_ACTIVE`。用户只能选择用同一个 `session_id` 重试失败步骤并回到 `running`/`committing`，或显式 discard 后开始新 session。

`failed_operation` 只表示上一条 `apply_requirement_design_operations` 或 `apply_product_component_operations` 的 Pencil mutation 失败，且 staging revision 仍等于 `last_controlled_revision`。该状态下允许 read/export wrapper 读取上下文，也允许下一次同类 `apply_*_operations` 写入新的 retry entry；retry 成功后状态回到 `running`，retry 失败后保持 `failed_operation`。`commit_*_session`、`refresh_requirement_components`、`rollback_requirement_design` 和 `plan_import_metadata_normalization` 在 `failed_operation` 下必须返回 `INVALID_INPUT`，details.required_action 固定为 `retry_failed_operation_or_discard`。

`commit_recovery_required` 必须先通过 `recover_design_commit_journal` 完成 journal 恢复并转为 `failed_commit`，或用 `reason: "commit_recovery_abandoned"` 人工确认放弃并保留恢复证据后转为 `discarded`，不能直接开始新 session。

`recover_design_commit_journal` 是唯一显式 journal 恢复入口，同时用于 requirement canvas 和 product component library session。它不打开 Pencil App，不读取或写入 staging `.pen`，只读取对应 `commit-journal.yaml`、backup 和正式文件 hash：

```typescript
recover_design_commit_journal(input: {
  session_id: string;
  scope: "requirement_canvas" | "product_component_library";
}): {
  session_id: string;
  scope: "requirement_canvas" | "product_component_library";
  status: "failed_commit" | "commit_recovery_required";
  restored_files: Array<{ path: string; old_hash: string; restore_status: "restored" | "already_restored" }>;
  failed_files: Array<{ path: string; reason: string }>;
}
```

恢复规则固定如下：

1. 只接受 `commit_recovery_required` session，或启动扫描发现的 orphan `commit-journal.yaml`；其他 session 状态返回 `INVALID_INPUT`。
2. journal 中每个已替换正式文件必须按 journal 逆序恢复到 old hash；文件已经等于 old hash 时记录 `already_restored`。
3. 所有正式文件恢复并校验成功后，journal 写为 `restored`。如果 `design_session.yaml` 可读，session 状态写为 `failed_commit`，产品级 lease 和局部 `active.yaml` 继续保留，用户可以重试 commit 或 discard；如果是 orphan journal 且 session 文件缺失，恢复状态写入后台 recovery status，只有当产品级 lease 和局部 `active.yaml` 的 `session_id` 都等于该 orphan `session_id` 时才清理 lease。
4. 任一文件无法恢复或 hash 校验失败时，session 保持 `commit_recovery_required`，返回 `DESIGN_COMMIT_RECOVERY_REQUIRED`，不得清理 lease，也不得读取半提交设计。

非受控手动编辑检测规则：

1. `begin_requirement_design_session` 打开 `staging.design.pen` 后，必须通过 `pencil_binding_id` 对 Forma-owned interactive shell 执行一次受控 `save()`，再对规范化后的 staging `.pen` JSON 计算 `started_revision`，并把 `last_saved_revision` 和 `last_controlled_revision` 初始化为同一个 hash；同时记录正式 `design.pen` 的 `base_canvas_revision`。`begin_product_component_session` 同理针对 `staging.lib.pen` 计算 revision。
2. 每一次由 Forma 发起的 Pencil mutation 都必须来自 `apply_requirement_design_operations` 或 `apply_product_component_operations`，并写入 `operation_log_file`，包含 `sequence`、`tool`、`target_node_ids`、`before_revision`、`after_revision`、`pencil_binding_id` 和时间戳。
3. mutation 执行前，Forma 必须先受控 `save()` 当前 App 文档；保存后的 staging `.pen` hash 必须等于 `last_controlled_revision`；不相等时立即返回 `MANUAL_EDIT_DETECTED`，不继续执行 mutation。
4. mutation 成功后，Forma 必须再次受控 `save()`，重新计算 `.pen` hash，把结果写入该 log entry 的 `after_revision`，并更新 `last_controlled_revision`。
5. revision hash 必须基于规范化 `.pen` JSON：排序稳定、忽略纯文件保存时间、窗口状态、最近打开记录、selection/cursor、view zoom/pan 和 Pencil App 自动写入的非语义 volatile metadata。除此之外，任何 node tree、variables、component/ref、page/frame、image fill、style 属性、Pencil node metadata 或 Forma metadata 的变化都必须计入 hash。
6. Pencil App auto-save 如果只写入上述 volatile metadata，不得触发 `MANUAL_EDIT_DETECTED`。如果 auto-save 后 hash 变化，说明它包含语义变化，仍按非受控修改处理；v6 不提供“接受当前 App 内容并纳入受控 revision 链”的入口，用户只能 discard 后重新开始。已经存在于正式 `design.pen` 的人工主画布只允许通过 `index_requirement_design_canvas` 重新建立索引；active session 的非受控 staging 变化不能被 import、reindex 或提升为正式状态。
7. `commit_requirement_design_session` 提交事务内必须先通过 `pencil_binding_id` 对 Forma-owned interactive shell 执行受控 `save()`，再计算当前 `staging.design.pen` hash。只有它等于 `last_controlled_revision`，且正式 `design.pen` 仍等于 `base_canvas_revision` 时，才允许继续质量检查、导出 preview 或推进正式状态。`commit_product_component_session` 同理校验当前 `staging.lib.pen` hash。
8. 如果 agent 在 active session 中直接调用 Pencil 写工具，下一次 `apply_*_operations` 或 `commit_*_session` 必须因 hash 不一致返回 `MANUAL_EDIT_DETECTED`。
9. 检测到外部修改时，保留当前 staging `.pen` 文件，写入 session 状态 `blocked_manual_edit`，UI 提供“丢弃本次 session 并重新开始”入口；不得把非受控修改合并进 `design.yaml` 或 `requirement.yaml`。

规范化 `.pen` revision hash 的字段白名单和忽略规则固定如下；实现不得再自行扩展“volatile metadata”：

1. hash 输入只包含 document root、node tree、node `metadata`、`variables`、themes、component/ref 关系、styles、assets/image fill references 和 Forma-owned metadata。
2. 只允许忽略这些顶层或节点级字段名：`updatedAt`、`modifiedAt`、`lastOpenedAt`、`savedAt`、`editorState`、`viewport`、`viewState`、`selection`、`cursor`、`history`、`undoStack`、`redoStack`、`recentFiles`、`windowState`、`previewCache`、`thumbnailCache`、`cache`、`debug`。
3. 只允许忽略 `metadata` 下这些 Pencil/App 私有 key：`pencil:viewport`、`pencil:selection`、`pencil:lastOpenedAt`、`pencil:autosaveAt`、`pencil:windowState`。任何 `metadata.type`、`metadata.forma:*`、`metadata.kind`、`metadata.page_id`、`metadata.component_key`、`metadata.action_key`、`metadata.navigation_target`、`metadata.field_key`、`metadata.component_instance` 都必须参与 hash。
4. 如果 Pencil schema 新增未知顶层字段、未知 node 字段或未知 metadata key，默认参与 hash；只有在测试 fixture 证明该字段只影响编辑器视图且不会改变导出、scene、layout、semantic scope 或 component/ref 关系后，才能把字段加入上方忽略表，并同步更新本文档。
5. 规范化必须稳定排序 object keys；数组顺序必须保留，不能排序 node children、variables theme entries、styles 或 operations history 中会影响语义的数组。
6. `computePenSemanticRevision(pen)` 必须有 fixture 测试：仅改变 viewport/selection 不改变 hash；改变 text content、node bounds、fill、variables、component ref、Forma metadata 或 image fill reference 必须改变 hash。

恢复规则：

1. session 仍在运行：UI 显示运行状态，不重复启动生成。
2. session 进程已死但 `staging.design.pen` 或 `staging.lib.pen` 存在：标记为 recoverable，允许用户重新连接 Pencil App 后提交或丢弃更改。
3. Pencil App 不可用：返回 `PENCIL_APP_REQUIRED`，显示明确错误，不启动后台绘制。
4. 导出 preview candidate 失败：页面不标记 done，正式 `design.pen` 保留，并提示可重试导出。
5. commit 失败：按 commit journal 恢复旧正式文件集合；恢复成功时不推进 requirement page 状态和 `design.yaml` 中本次 session 写入的页面索引，保留 staging 文件、journal 和 session log 供用户重试或丢弃；恢复失败时进入 `commit_recovery_required` 并阻断对应设计 API。
6. 产品级组件库 commit 失败：按产品组件库 commit journal 恢复 latest、版本快照和 `components.yaml.current_version`；恢复成功时删除本 session 的 staging latest 候选，不更新 `components.yaml.current_version`，不覆盖 `{product_id}.lib.pen`，不删除旧版本快照；恢复失败时进入 `commit_recovery_required`。
7. 组件库刷新失败：不更新需求 `component_library.version`，产品级 latest 不回滚，UI 显示当前需求仍使用旧 pinned 版本。
8. 检测到非受控手动编辑：返回 `MANUAL_EDIT_DETECTED`，不导出正式 preview，不推进页面状态。
9. 目标页面缺少 `semantic_contract`：这只能发生在绕过 normalizer 或手工写坏 YAML 的情况下，读取 requirement 时返回 schema validation error 并指向 normalizer/recovery，不启动设计 session。已归一化页面如果只有 `semantic_contract_coverage: minimal` 且用户请求超出契约，才返回 `SEMANTIC_CONTRACT_REQUIRED`，提示先运行 `fm-requirement`。
10. 用户要求 `fm-design` 新增组件或修改页面语义：返回 `REQUIREMENT_UPDATE_REQUIRED`，提示先运行 `fm-requirement`，不启动设计 session。
11. active session 开始后 requirement `semantic_contract` 发生变化：返回 `SEMANTIC_SCOPE_CHANGED`，不提交旧 session。
12. 提交前发现需求外业务元素：返回 `DESIGN_SCOPE_VIOLATION`，不导出正式 preview，不推进页面状态。
13. 组件实例缺少 `ref` 关系或 metadata：返回 `COMPONENT_USAGE_UNLINKED`，不刷新任何页面实例。
14. 需求画布组件快照无法映射到产品级组件库：返回 `COMPONENT_LIBRARY_UNMAPPED`，不刷新任何页面实例。
15. 新组件版本改变 `semantic_contract_hash`：返回 `COMPONENT_CONTRACT_CHANGED`，提示先运行 `fm-requirement` 确认需求语义变化。
16. 产品组件库生成或 refine 试图创建没有 seed 的组件，或 seed 中声明的组件未在 staging `.lib.pen` 中生成：返回 `COMPONENT_SEED_REQUIRED`，不推进 `components.yaml.current_version`。
17. 页面实例存在不允许迁移的 override：返回 `COMPONENT_OVERRIDE_CONFLICT`，保留旧组件快照和旧实例引用。
18. scoped refresh 中部分页面不可更新：返回 `COMPONENT_REFRESH_PARTIAL_BLOCKED`，默认不做部分提交；用户必须缩小 scope 后重试。
19. 颜色格式无法规范化：返回 `PENCIL_COLOR_INVALID`，不导出正式 preview，不推进页面状态。
20. Pencil 属性类型或 node type 适配错误：返回 `PENCIL_PROPERTY_INVALID`，不导出正式 preview，不推进页面状态。
21. `session_snapshot_layout` 命中 `layout_snapshot` 阻断阈值：返回 `DESIGN_LAYOUT_INVALID`，不导出正式 preview，不推进页面状态。
22. AI screenshot review 不可用、超时或失败：写入 `quality_report.ai_visual_review.status: skipped`，并在 `quality_report.warnings[]` 写入 `AI_VISUAL_REVIEW_SKIPPED`；不阻断提交。未请求 AI review 时只写 `reason: not_requested`，不写 warning。
23. 正式 `design.pen` 在 session 开始后被其他进程修改：返回 `DESIGN_CANVAS_CHANGED`，不覆盖正式文件，不推进页面状态，用户必须丢弃或重新开始 session。
24. 启动恢复发现未完成 commit journal：先恢复旧正式文件集合并校验 `design.yaml.canvas_revision`；恢复失败返回 `DESIGN_COMMIT_RECOVERY_REQUIRED`，后台 UI 必须显示 journal 路径和受影响文件，不允许继续读半提交设计。

Server 和 MCP 的错误映射必须显式维护，不能让新增 v6 错误码落到默认 400。`packages/server/src/app.ts` 的 `statusForError`、MCP tool error payload、Web `formatApiError` 和相关测试必须按下表覆盖：

| code | HTTP status | MCP behavior | UI meaning |
| --- | --- | --- | --- |
| `PENCIL_APP_REQUIRED`、`PENCIL_CLI_NOT_FOUND`、`PENCIL_NOT_AUTHENTICATED`、`PENCIL_CAPABILITY_UNAVAILABLE` | 503 | `isError: true`，保留 code/details | 外部 Pencil 能力不可用，可重试 |
| `DESIGN_SESSION_ACTIVE`、`PRODUCT_MUTATION_LOCKED`、`PENCIL_LOCK_HELD` | 409 | `isError: true` | 同产品或 Pencil 资源已有运行中的受控操作 |
| `MANUAL_EDIT_DETECTED`、`DESIGN_CANVAS_CHANGED`、`SEMANTIC_SCOPE_CHANGED`、`DESIGN_INDEX_STALE` | 409 | `isError: true` | 会话基线或索引已变化，必须重开、重建索引或丢弃 |
| `DESIGN_COMMIT_RECOVERY_REQUIRED`、`SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`、`SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED`、`LOCK_CORRUPT`、`PREVIEW_NOT_EXPORTED`、`DESIGN_SESSION_AUDIT_LINK_MISSING` | 409 | `isError: true` | 本地状态需要恢复、preflight 未满足、lock 不可信或数据完整性阻断对应设计 API |
| `REQUIREMENT_UPDATE_REQUIRED`、`SEMANTIC_CONTRACT_REQUIRED`、`COMPONENT_CONTRACT_CHANGED`、`BASELINE_SEMANTIC_CONTRACT_CONFLICT`、`UNMANAGED_METADATA_NORMALIZATION_REQUIRED` | 409 | `isError: true` | 需求语义不满足，先回到 `fm-requirement` 或完成 metadata normalization |
| `COMPONENT_USAGE_UNLINKED`、`COMPONENT_LIBRARY_UNMAPPED`、`COMPONENT_OVERRIDE_CONFLICT`、`COMPONENT_REFRESH_PARTIAL_BLOCKED`、`COMPONENT_METADATA_CONFLICT`、`COMPONENT_SEED_REQUIRED`、`COMPONENT_LIBRARY_METADATA_MISSING`、`COMPONENT_LIBRARY_VERSION_MISSING`、`COMPONENT_LIBRARY_LATEST_MISSING`、`COMPONENT_LIBRARY_INVALID` | 409 | `isError: true` | 组件库或组件刷新不可原子完成 |
| `PAGE_FRAME_AMBIGUOUS`、`PAGE_FRAME_MISMATCH` | 409 | `isError: true` | 画布 frame 映射不确定或和 metadata 冲突 |
| `PENCIL_SCHEMA_INVALID`、`PENCIL_COLOR_INVALID`、`PENCIL_PROPERTY_INVALID`、`DESIGN_LAYOUT_INVALID`、`DESIGN_SCOPE_VIOLATION`、`PREVIEW_EXPORT_FAILED`、`SEMANTIC_CONTRACT_BUILD_FAILED` | 422 | `isError: true` | 当前候选设计或结构化语义输入不满足质量/语义门 |
| `FORBIDDEN_PATH_PARAMETER`、`INVALID_INPUT`、`REQUIREMENT_DESIGN_CONTEXT_REQUIRED`、schema validation error | 400 | `isError: true` | 调用输入非法或缺少 v6 requirement-level 上下文 |
| `PRODUCT_NOT_FOUND`、`REQUIREMENT_NOT_FOUND`、`PAGE_FRAME_NOT_FOUND`、`NODE_NOT_FOUND`、`NODE_NOT_OWNED`、`DESIGN_HISTORY_VERSION_NOT_FOUND`、`DESIGN_HISTORY_FRAME_SNAPSHOT_NOT_FOUND`、`BASELINE_IMAGE_NOT_FOUND` | 404 | `isError: true` | 请求的本地资源不存在或不属于当前 requirement canvas |

旧 MCP 工具名和旧 agent route 名在 registry/dispatcher 中不存在，因此显式调用旧名称时不是上表的 Forma error，而是平台默认 unknown tool / unknown command。

session 清理规则：

1. v6 不自动删除 session 目录。`design_session.yaml` 和 `operations.jsonl` 是审计凭据，默认保留。
2. `commit_*_session` 成功后必须把 session 状态写为 `committed`，清空产品级 `active-design-session.yaml` 和对应局部 `active.yaml`，并把 `session_id` 写入 `design.yaml.pages[].history[]` 或 `components.yaml.versions[]`。
3. `discard_requirement_design_session` 和 `discard_product_component_session` 必须把状态写为 `discarded`，删除仅属于该 session 的 staging 文件，清空产品级 lease 和局部 `active.yaml`，但不得删除正式 `design.pen`、正式组件库 latest 或版本快照。
4. 已结束 session 可以由显式维护命令清理；清理命令只能删除状态为 `committed` 或 `discarded` 且 `updated_at` 早于 30 天的 session 目录。`failed_*`、`blocked_manual_edit` 和 `recoverable` session 必须保留，直到用户重试成功或 discard。
5. 清理 session 目录前必须确认对应 `session_id` 已写入正式 history 或 component version record；否则返回 `DESIGN_SESSION_AUDIT_LINK_MISSING`，不得删除。

## 与 v5 的关系

v5 的有效结论保留：

- 不能让 agent 只生成临时 `.pen` 而不保存。
- 保存动作要由后端编排。
- 成功结果必须返回正式路径。
- 失败不能留下半保存状态。

v6 修正 v5 的存储假设：

- v5 的正式路径是页面级 `D-*/design.pen`。
- v6 的正式源路径是需求级 `{requirement_id}/design.pen`。
- v6 不再保留页面级 `D-*` 旧模型；页面状态、frame 映射、预览和历史都在需求目录及需求级 `design.yaml` 中维护。
- 旧 `D-*` 目录在 v6 运行时完全忽略；不会被扫描、迁移、导入、回滚或作为 preview/history 来源。
- v5 只用 `components_initialized` 表示组件已生成；v6 需要记录产品级组件库版本，并让每个需求显式钉住其中一个版本。

## 验收标准

1. P-907011 / R-c9b123bf 手动放置主画布后，Forma 可以识别：

   ```text
   /Users/xubo/.forma/data/P-907011/R-c9b123bf/design.pen
   ```

2. 索引后，匹配到且通过 index-mode Design Quality Pipeline 的 25 个页面在 `requirement.yaml` 中变为 `design_status: done`，对应 frame、预览、质量报告、unmanaged import 状态和历史索引写入需求级 `design.yaml`；任一页面存在质量硬校验失败时，该页面进入 `blocked_pages[]`，不得标记 done。导入页中无法映射到 requirement copy 的文本必须进入 `quality_report.import_adoption.unverified_copy_texts[]` 和 `UNMANAGED_COPY_UNVERIFIED` warning，不阻断首次索引，也不能成为后续 active session 的 allowed copy。

3. 顶层组件候选节点不会被误标记为页面；P-907011 / R-c9b123bf 中 11 个组件 frame 和 `Divider` reusable rectangle 都进入组件候选或 skipped node 结果。

4. 打开需求设计时，Pencil App 能显示同一个需求主画布，而不是一个空白页或单页临时文件。

5. 点击生成页面时，后台 UI 显示 Pencil App 正在绘制的页面、Pencil App session、耗时和锁状态。

6. `begin_requirement_design_session` 和 `commit_requirement_design_session` 返回的路径不能是系统临时目录。begin 必须包含 requirement-level `canvas_path` 和 session-level `staging_path`；`page_commit` 必须包含正式 `canvas_path` 和 `preview_path`；`component_refresh_commit` 必须在 `affected_pages[].preview_path` 中返回 requirement-level preview 路径；二者都不返回 `design_id` 或页面级 `pen_path`。

7. 重启 Forma 后，需求仍能识别主 `.pen` 和每页设计状态。

8. 导出预览失败时，主 `.pen` 不丢失，页面状态不会被错误标记为 `done`。

9. 新索引、新生成、重生成、refine 和 rebuild 都不会创建页面级 `D-*` 目录；状态、预览和历史只写入需求级路径。

10. 运行中的需求设计 session 只写 `sessions/{session_id}/staging.design.pen` 和 session commit candidates；commit 成功前正式 `design.pen` 不被覆盖，commit 失败时通过 commit journal 恢复正式 `design.pen`、旧 preview、旧 `design.yaml` 和 `requirement.yaml`，恢复失败则返回 `DESIGN_COMMIT_RECOVERY_REQUIRED` 并阻断读取半提交设计。

11. 如果正式 `design.pen` 在 session 开始后被其他进程修改，commit 返回 `DESIGN_CANVAS_CHANGED`，不覆盖正式文件。

12. 产品组件库存在 latest 和版本快照；新需求主画布创建时会嵌入当前 latest，并在 `design.yaml` 记录 `component_library.version`。没有任何声明组件的产品仍会生成合法空组件库版本，`components.yaml.components: []` 视为 initialized，新需求画布嵌入空 `Components - Snapshot v{version}` frame，后续 component refresh 无 linked usage 时返回 `COMPONENT_REFRESH_PARTIAL_BLOCKED`。

13. `components_initialized` 不再写入 `product.yaml`；组件库初始化状态由 `components.yaml.current_version` 和版本快照派生，`complete_product_init` 不在 MCP registry、dispatcher、agent 模板或用户可见运行文档中出现；只允许在迁移文档、删除说明和负向测试中作为“已删除入口”出现。

14. `fm-change-style` 和 `fm-refine-components` 只更新产品级组件库版本，不自动修改已有需求的 `design.pen`。

15. `SyncService` 不再调用 Pencil 生成 style preview，不写 `$FORMA_HOME/styles/{style}/preview@2x.png`，也不创建任何 preview `.pen`。样式同步完成后，Web `StylePreviewPanel` 能从样式变量和 `DESIGN.md` 渲染确定性 token preview；`scripts/live-style-sync.ts` 验证元数据和 token preview 输入，不再把 PNG preview 作为成功条件。

16. 显式执行 `fm-design component_refresh` 并完成 `begin_requirement_design_session`、`refresh_requirement_components` 预检、`apply_requirement_design_operations` 和 `commit_requirement_design_session` 后，当前需求 `design.pen` 的组件快照和 `design.yaml.component_library.version` 同步到指定版本，页面 frame 不被删除。

17. 关闭或断开 Pencil App 后，所有创建或修改 `.pen` 的设计动作返回 `PENCIL_APP_REQUIRED`，不会启动 headless 绘制。

18. 需求主画布中的真实组件快照 frame 使用 `Components - Snapshot v{version}` 命名；手动放入的主画布缺少可映射 snapshot frame 时，顶层组件候选只记录为 `import_report.unmanaged_component_nodes[]` 和 `skipped_nodes[]`，页面扫描和页面完成状态不会把它当成业务页面。

19. 每个受控生成的页面 frame 都写入 `metadata.type: "forma"`、`metadata.kind: "requirement_page"` 和 `metadata.page_id`；提交时通过 `page_id + frame_id` 校验，frame 丢失或错配时返回 `PAGE_FRAME_NOT_FOUND` 或 `PAGE_FRAME_MISMATCH`。

20. 用户在 Pencil App 中手动编辑画布后，Forma 不会把非受控修改提交为正式设计；检测到 session 外修改时返回 `MANUAL_EDIT_DETECTED`。

21. `fm-refine-design` 不再出现在 agent route 列表、技能模板、installer manifest、dispatcher 和文档中；页面级 refine/rebuild 通过 `fm-design` 的动作决策表执行。

22. 用户要求 `fm-design` 新增反馈入口、业务组件、页面分区、字段、导航或业务 copy 时，系统返回 `REQUIREMENT_UPDATE_REQUIRED`，要求先通过 `fm-requirement` 更新需求。

23. 修改背景、布局、图标样式、组件视觉状态或同一功能入口的视觉形态时，只要语义不变，`fm-design` 不会误拦截。

24. active session 提交前如果目标页面包含需求外业务元素，系统返回 `DESIGN_SCOPE_VIOLATION`，不导出正式 preview，不推进 `design_status`；错误 details 包含 `node_id`、`node_name` 和 `reason`。首次 unmanaged import 只记录 `UNMANAGED_COPY_UNVERIFIED`，不把未声明 copy 自动纳入 allowed copy。

25. 产品级组件库中的 reusable component 都有稳定 `component_key` 和 `semantic_contract_hash`；纯视觉更新不会改变 `component_key`。

26. 需求主画布嵌入组件快照后，`design.yaml.component_library.components` 能记录每个 `component_key` 对应的 snapshot component node。

27. 页面中使用通用组件时，节点必须是指向需求组件快照的 Pencil `ref` instance，并写入 `component_instance` metadata；索引后 `design.yaml.pages[].component_usages` 能列出页面组件使用关系。

28. 用户在 `fm-design` 中要求“更新所有页面相关的通用组件”时，系统执行 `component_refresh(scope: "all_pages", version: "latest")`，打开 Pencil App，可见刷新组件快照和相关页面实例。

29. `component_refresh` 只更新已关联实例，保留页面 frame id、位置、尺寸、约束和允许的 overrides；只导出受影响页面 preview。

30. 如果目标范围内存在 detached copy、缺失 metadata、组件库无法映射、组件语义契约变化、override 冲突，或用户显式指定了非 done 页面，component refresh 直接返回 stable error，错误 details 带 `blocked_pages[]`，成功 payload 不包含 `blocked_pages`，不会半提交。

31. `generate_components` agent macro、`fm-refine-components` 或 `fm-change-style` 必须通过产品级 app-bound session 写入组件库，`operations.jsonl` 可审计，commit 失败不推进 `components.yaml.current_version`；MCP registry 不得保留旧的一次性 `generate_components` 写入 handler。

32. `fm-refine-components` 或 `fm-change-style` 发布新产品组件版本后，已有需求不会自动变化；只有显式 `fm-design component_refresh` 会更新当前需求画布。

33. `rollback_requirement_design` 必须在 `operation: rollback` 的 active Pencil App session 中生成操作计划，实际 frame 替换只能通过 `apply_requirement_design_operations` 执行，最终由 `commit_requirement_design_session` 导出 preview 并推进状态；rollback 产生新的单调递增 `page_version` 和新的 `canvas_version`，并在 history 中记录 `restored_from_page_version`，不得覆盖被回滚到的旧版本文件。

34. 每个页面提交前都会运行 Design Quality Pipeline；`design.yaml.pages[].quality_report` 写入 `pencil_schema`、`color_format`、`property_compatibility`、`layout_snapshot`、`preview_export`、`semantic_scope` 和 `ai_visual_review` 结果。

35. Pencil 生成的 `rgb()` / `rgba()` 颜色会在提交前以 `repair_plan` 形式返回，必须通过 `apply_requirement_design_operations(intent: "quality_repair")` 写入；无法规范化时返回 `PENCIL_COLOR_INVALID`，不会推进 `design_status`。

36. `letterSpacing` 等 Pencil 属性出现 schema 不接受的类型时返回 `PENCIL_PROPERTY_INVALID`，不会出现仅在 DESIGN.md 里提示 skipped 但页面仍被标记 done 的情况。

37. `session_snapshot_layout(problemsOnly: false, parentId: frame_id, maxDepth: 8)` 和后续分批 descendant 扫描命中 `layout_snapshot` 阻断阈值，或无法证明扫描完整时，返回 `DESIGN_LAYOUT_INVALID`，页面不标记 done；`problemsOnly: true` 只作为附加 signal，不能替代完整布局树扫描。

38. Web API 不再暴露 `/api/designs/:designId/*`；baseline image、RequirementDetail、DesignView、PropertyPanel、ProductList 和 API client 全部使用 requirement-level design routes 或 product component library 状态。

39. AI screenshot review 只在硬校验通过后运行；agent 无视觉能力或截图失败时记录 `AI_VISUAL_REVIEW_SKIPPED`，不会阻断提交。

40. AI screenshot review 的 warning 不会自动触发 redesign，也不会覆盖 Pencil guideline、Semantic Scope Guard 或 requirement copy。

41. 后台设计页主画布由 `get_requirement_design_scene` 的 `.pen` scene payload 通过 LeaferJS 渲染；点击、hover、框选和属性面板选中都使用真实 `node_id`，不再依赖 screenshot overlay 的坐标命中。

42. 后台设计页支持无限画布交互，包括拖拽平移、滚轮缩放、fit page、fit selection 和 100% 缩放；页面 frame 列表可以定位到对应 frame。

43. 后台设计页所有画布操作都有键盘等价入口；页面列表和节点列表可作为屏幕阅读器与键盘替代入口；`PropertyPanel`、真实截图入口、质量报告和 session/lock 状态都能只用键盘访问。

44. 后台设计页在小于 768px 的窄屏下使用单列布局，在 768px 及以上使用双栏布局；画布、工具条、页面列表、属性面板、质量报告和锁状态不得互相遮挡，按钮和状态文案不得溢出容器。

45. 新增后台设计页、session 状态、recovery/preflight 和图谱文案都进入 `packages/web/src/i18n.ts` 的 `en` / `zh` message map，并通过 `useT()` 读取；API error code 只作为 technical literal 展示，不替代本地化说明。

46. `.pen` 中无法结构化渲染的属性会进入 `unsupported_properties` 并在 UI 中提示；截图和 preview 只作为历史缩略图、视觉对照、AI review 输入或 Leafer 渲染失败时的只读对照。

47. `DesignSceneCanvas` 旁边提供“打开真实截图”按钮，打开当前页面 frame 的 Pencil 导出 preview；该按钮只用于对照真实截图，不改变主交互画布、选中逻辑或 `.pen` 状态。

48. 导航图谱使用 LeaferJS 无限画布交互，支持拖拽平移、滚轮缩放、fit graph、fit selection、100% 缩放和 reset view；缩放和平移后节点点击、hover 高亮和选中详情仍然可用。

49. `begin_requirement_design_session` 和 `begin_product_component_session` 在创建 lease 前先执行不打开业务 `.pen` 的 Pencil preflight probe；创建 session-owned staging 文件后再执行 `pencil interactive --app desktop --in <staging.pen>` open probe。preflight 失败不得留下 lease；open probe 失败必须 begin rollback。两类失败都不回退到 headless 生成，并在 details 中包含 command、reason、phase、cleanup_status 和可读取的 Pencil version。

50. Agent 提供的工具输入、prompt tool args 或 `apply_*_operations.operations[].args` 中出现 `filePath`、`file_path`、`canvas_path`、`staging_path`、`outputDir`、`output_dir`、`path`、`pen_path`、`preview_path` 或 `history_path` 时返回 `FORBIDDEN_PATH_PARAMETER`；后端返回 payload 可以展示这些路径，但调用方不得把返回路径作为写工具输入传回。底层 Pencil MCP 的路径参数只由 Forma session adapter 从 active session 的 `staging_path` 和 session-owned output dir 注入。

51. 组件刷新期间可以出现 `Components - Snapshot v{version} (staging)`，但成功提交后正式 `design.pen` 只保留 `Components - Snapshot v{version}`；失败或 discard 后 staging snapshot 不会进入正式 `design.yaml` 或页面索引。

52. Pencil App auto-save 只修改 volatile metadata 时不会触发 `MANUAL_EDIT_DETECTED`；任何 node、variables、component/ref、frame、style 或 Forma metadata 的语义变化仍会阻断 commit。LeaferJS 与真实截图的差异会按 supported/unsupported 能力分类，unsupported 差异不会让页面状态回退。

53. v6 schema 归一化会删除 `product.yaml.components_initialized`、`requirement.yaml.pages[].design_id` 和页面级设计派生字段，并为旧 `requirement.yaml.pages[]` 与旧 `baseline/baseline.yaml.pages[]` 补齐最小 `semantic_contract`；归一化后 strict schema 不再接受这些旧字段或缺失契约。

54. `delete_product` 会在 deletion journal 中覆盖 `library/{product_id}.lib.pen`、`library/{product_id}.components.yaml`、`library/{product_id}.versions/` 和 `library/{product_id}.sessions/`；如果产品级 `active-design-session.yaml` 指向非 terminal session，删除直接返回 `DESIGN_SESSION_ACTIVE`，不会移动产品数据、组件库或 session 目录；删除恢复不会留下孤儿组件库 metadata、版本快照或 stale active session lease。

55. begin/apply/commit/discard 都只在单个 backend transaction 内持有 product mutation lock 和 pencil lock；跨调用并发由产品级 `active-design-session.yaml`、局部 `active.yaml`、session 状态、`pencil_binding_id` 和 revision hash 控制。同一产品同时启动第二个 requirement 或组件库设计 session 时必须返回 `DESIGN_SESSION_ACTIVE`。

56. 旧 MCP 工具名和被删除的旧 agent route 名（例如 `fm-refine-design`）不在 registry、dispatcher、installer manifest 或用户可见运行文档中作为可用入口出现；迁移文档、删除说明和负向测试可以引用旧名称，但必须明确它们应返回 unknown tool/unknown command 或默认 404。显式调用这些旧名称时按平台默认 unknown tool/unknown command 处理，不进入 Forma handler。`fm-rollback-design` 是保留并改造的 v6 route，不按旧 route 删除。

57. v6 strict schema 下缺少 `semantic_contract` 的页面不能被读取为有效 requirement，必须返回 schema validation error 并指向 normalizer/recovery；`semantic_contract_coverage: minimal` 且用户请求超出契约时，`fm-design` 返回 `SEMANTIC_CONTRACT_REQUIRED`，要求先运行 `fm-requirement`。

58. 手动放入的主画布通过 unmanaged import 标记 done 后，后续修改该页面前必须先调用 `plan_import_metadata_normalization` 生成 metadata-only 操作计划，再执行 `import_metadata_normalization` 并通过 strict Semantic Scope Guard；缺少 metadata 不会阻断初次索引，但无法唯一映射的节点会以 `UNMANAGED_METADATA_NORMALIZATION_REQUIRED` 阻断 active session 中的提交。

59. `readSchemaNormalizationRecoveryState(home)`、`fm-status`、`GET /api/status` 和 preflight/recovery-only 状态页只读 raw normalization state；它们不会写 journal、不会恢复 YAML、不会重新执行 normalizer。`recover_v6_normalization_journal(backup_dir)` 和 `restore_v6_normalization_backup(backup_dir)` 是唯一允许写回 normalization 恢复状态的入口。

60. `forma serve` 在 cutover 未 committed 时进入 `preflight_only`，在 journal/recovery 阻断时进入 `recovery_only`；两种模式都能监听端口、返回状态 API，并阻断产品/需求/设计 mutation routes。

61. `design.yaml`、`components.yaml`、manifest 和 journal 中的正式资源路径使用 `$FORMA_HOME` 相对路径；API/MCP 可以返回绝对路径供展示；session YAML 同时保存相对路径和绝对路径，revision hash 只使用相对路径字段。

62. `begin_requirement_design_session` 在产品组件库 missing、metadata invalid、latest 缺失或版本快照缺失时，在创建任何 lease/session/staging 文件前返回稳定组件库错误码，并提示先执行 `generate_components` agent macro。

63. Pencil preflight/open probe、受控 save、export、layout scan 和 guide 加载都有固定 timeout；`layout_snapshot` 超时、超过 500 个待展开 parent node 或 5000 个 layout node 时返回 `DESIGN_LAYOUT_INVALID`，页面不标记 done。

## 回滚策略

v6 不内置回滚到页面级 `D-*` 模型的旧模型写入；但 schema cutover 必须可恢复，不能只依赖口头备份。回滚入口和验收固定如下：

1. `restore_v6_normalization_backup(backup_dir)` 是唯一数据回滚入口。它只能读取 `$FORMA_HOME/normalization-backups/v6-{timestamp}/manifest.yaml` 和 `normalization-journal.yaml`，按 manifest 中的 runtime path、backup path、sha256 和 size 恢复被改写 YAML。
2. 回滚前必须把当前运行时 YAML 复制到 `$FORMA_HOME/normalization-backups/v6-{timestamp}/rollback-capture/` 并记录 hash，避免回滚过程丢失排障证据。
3. 任一 backup 文件缺失、hash 不匹配、runtime path 越界、manifest_hash 不匹配或 restore 写入失败时，回滚中止并返回 `SCHEMA_NORMALIZATION_RECOVERY_REQUIRED`；不得继续启动旧服务，也不得删除 cutover marker。
4. 全部 YAML 恢复并通过旧 schema smoke check 后，删除 `.v6-schema-cutover-committed`，写入 `normalization_report.yaml.status: restored`，并允许旧版本服务启动。
5. requirement-level `design.pen`、产品级组件库 latest 和版本快照不删除；它们作为人工设计资产保留。旧版本服务不读取这些 v6 路径，也不承诺把它们转换成 v5 页面级 `D-*` 输出。
6. 回滚验收必须包含自动测试：成功恢复、manifest 缺失、backup hash mismatch、runtime path 越界、部分文件写入失败、旧 schema smoke check 失败。缺少这些测试时不得发布 cutover。

## 当前代码冲突清单

以下是 v6 文档和当前仓库运行代码之间的已知冲突。它们不是兼容层，也不能作为 v6 发布后的可接受状态；实施顺序必须逐项删除或替换：

| 冲突点 | 当前代码位置 | v6 处理 |
| --- | --- | --- |
| store factory 是同步函数，server/MCP/scripts/tests 直接使用同步 `createFormaStore(...)` 或同步 `buildServer(...)` | `packages/core/src/store.ts`、`packages/server/src/app.ts`、`packages/mcp/src/index.ts`、`scripts/*.ts`、`packages/*/tests/**/*.test.ts*` | 第 2 步把 `createFormaStore`、`buildServer` 和所有调用点一次性改为 async；未 await 的调用点不能留下可运行中间态 |
| `product.yaml.components_initialized` 仍在 schema、创建产品、配置检查、Web 类型和 UI 中使用 | `packages/core/src/product.ts`、`packages/web/src/api.ts`、`packages/web/src/pages/ProductList.tsx`、`packages/web/src/pages/ProductDetail.tsx`、agent shared templates | 第 3 步 cutover 备份并删除旧字段；第 5 步组件库状态全部切到 `components.yaml` 和版本快照 |
| 页面级 `design_id` 仍在 requirement page schema、DesignService、server routes、Web API、Web 页面和 tests 中使用 | `packages/core/src/requirement.ts`、`packages/core/src/design.ts`、`packages/server/src/routes.ts`、`packages/web/src/api.ts`、`packages/web/src/pages/RequirementDetail.tsx`、相关 tests | 第 3 步 cutover 删除旧字段；第 4 步删除 public 旧入口；第 5、7、10 步用 requirement-level `design.yaml`、preview index 和新 routes 替换 |
| MCP registry 仍暴露旧工具：`complete_product_init`、`generate_page_design`、`generate_and_save_page_design`、`save_designs`、`rollback_design`、`diff_designs`、`get_design_annotations`、`export_design_asset` | `packages/mcp/src/tools.ts`、`docs/MCP.md`、MCP tests | 第 4 步从 registry 和 help 删除旧工具；第 8 步只注册 v6 新工具；显式调用旧名称走平台 unknown tool |
| agent command 列表和安装模板仍暴露 `fm-refine-design`，`fm-design` 模板仍调用页面级设计工具 | `packages/agent/src/index.ts`、`packages/agent/templates/*/fm-design.*`、`packages/agent/templates/*/fm-refine-design.*`、`packages/core/src/install.ts`、CLI installer tests | 第 4 步先删除 `fm-refine-design` public surface；第 9 步把 `fm-design` 等模板改成 app-bound session 流程 |
| server/Web 仍注册或消费 `/api/designs/:designId/*` 和页面级设计详情 route | `packages/server/src/routes.ts`、`packages/web/src/routes.tsx`、`packages/web/src/pages/DesignView.tsx`、`packages/web/src/components/PropertyPanel.tsx` | 第 4 步删除旧 route；第 10 步新增 requirement-level design routes；SPA fallback 必须让旧设计详情路径返回 default 404 |
| 当前 `PencilService.generatePageDesign()` / `generateComponents()` 仍通过 `pencil --out ... --prompt ...` 后台写 `.pen` | `packages/core/src/pencil.ts`、`packages/core/src/store.ts`、MCP tools/tests | 第 6 步把写入链路迁到 `PencilAppSessionAdapter`；第 8 步确保 MCP 不暴露旧 headless handler；`PencilService` 只保留 availability、校验和只读 helper |
| `SyncService` 样式预览仍通过 `pencil --in ... --out ... --prompt ...` headless 改写 preview `.pen` | `packages/core/src/sync.ts`、`scripts/live-style-sync.ts`、sync tests | 第 6 步删除 Pencil-backed style preview renderer：`SyncService` 只同步样式元数据、变量和 `DESIGN.md`，Web `StylePreviewPanel` 从结构化变量确定性渲染 preview；`scripts/live-style-sync.ts` 不再要求 `preview@2x.png`，sync tests 断言 `SyncService` 不调用 Pencil prompt 写入路径 |
| baseline preview 仍可从页面级 `design_id` 或 deterministic `D-*` preview fallback 取图 | `packages/server/src/routes.ts`、`packages/mcp/src/tools.ts`、`packages/web/src/pages/BaselineView.tsx`、server/MCP/Web tests | 第 5 步切换为 requirement-level `design.yaml` preview lookup；没有 v6 preview 时返回 `BASELINE_IMAGE_NOT_FOUND`，不得扫描 `D-*` |
| README、docs 和 agent shared guidance 仍把旧工具描述为可用入口 | `README.md`、`docs/AGENT.md`、`docs/MCP.md`、`packages/agent/templates/shared/SKILL.md` | 第 4 步和 public legacy surface removal 同步更新；旧名称只保留在迁移/删除说明和负向测试 |
| smoke 和 live scripts 仍同步创建 store 或调用旧 Pencil 写入路径 | `scripts/smoke-pencil.ts`、`scripts/live-style-sync.ts`、`scripts/smoke-pencil-error.ts` | 第 2 步迁移 async store；第 6 步 smoke 改为 app-bound session 或只读 adapter smoke，不能再调用 `generatePageDesign()` |
| product deletion 只覆盖旧 `{product_id}.lib.pen`，没有覆盖 v6 component metadata、versions、sessions 和 active design lease 阻断 | `packages/core/src/product-deletion.ts`、`packages/core/tests/product-session-style.test.ts`、server/MCP deletion tests | 第 5 步扩展 deletion journal，并在删除前按产品级 `active-design-session.yaml` 阻断 active session |
| Pencil lock 路径和语义仍是旧 `$FORMA_HOME/pencil.lock` 长生命周期锁 | `packages/core/src/paths.ts`、`packages/core/src/pencil.ts`、`packages/core/tests/pencil.test.ts`、`packages/core/tests/foundation.test.ts` | 第 6 步迁移到 `$FORMA_HOME/locks/pencil.lock` 短事务锁，并保留旧 lock 只作为 cutover 前兼容检测 |
| Web 旧 `AnnotationCanvas`、Diff/PropertyPanel 测试和 API fixtures 仍依赖 screenshot overlay 与 `/api/designs/:designId/*` | `packages/web/src/components/AnnotationCanvas.tsx`、`packages/web/src/components/*test.tsx`、`packages/web/src/pages/*Design*.test.tsx`、`packages/web/src/api.test.ts` | 第 9、10 步替换为 `DesignSceneCanvas` 和 requirement-level routes；旧 overlay 代码不得留在生产源码中 |

## 实施顺序

v6 必须按以下顺序落地，不能先暴露新入口再保留旧模型并行运行。每一步都必须能独立通过测试；只有带 `cutover` 标记的步骤允许改写真实 `$FORMA_HOME` 数据。

1. Preflight-only 基础设施：新增 `packages/core/src/semantic-contract.ts`、`packages/core/src/schema-normalization.ts`、side-effect-free `readSchemaNormalizationRecoveryState(home)`、dry-run candidate builder 和 journal selection checker。只实现 raw YAML 读取、candidate 生成、strict schema 预校验、backup manifest 生成模拟和 semantic contract builder minimal mode；不改写运行时 YAML，不启用 strict v6 schema，不改变 store 同步/异步接口。验收：dry-run 测试、journal ambiguity 测试、read-only recovery reader 无写入测试、semantic contract builder minimal mode 测试通过。
2. Async startup skeleton：把 `createFormaStore`、`buildServer`、MCP/server/CLI/script/test 入口改为 async，并注册 `normal`、`preflight_only`、`recovery_only` 三种非 fatal 启动路径。此步骤的 `normal mode 下仍读取旧运行模型` 只是第 2 步过渡态，用于先完成 async 调用点迁移；它不是最终 v6 发布行为。第 3 步 cutover gate 和第 5 步 strict schema 启用后，普通启动必须按上文启动模式执行：cutover 未 committed 时进入 `preflight_only`，recovery 阻断时进入 `recovery_only`。第 2 步普通启动只调用 raw recovery reader，不运行 normalizer；dry-run/preflight 仍只能由显式维护命令触发且不删除旧字段。验收：`rg "createFormaStore\\(" packages scripts` 中所有运行调用点都有 `await` 或返回 promise 链，preflight/recovery-only Web 和 MCP 状态测试通过，现有旧模型 tests 通过。
3. Cutover-gated schema 归一化：加入显式 `forma schema-normalization-dry-run`、`forma v6-schema-cutover`、`forma recover-v6-normalization-journal`、`forma restore-v6-normalization-backup`，以及 recovery-only Web API `/api/recovery/schema-normalization`、`/api/recovery/schema-normalization/recover-journal`、`/api/recovery/schema-normalization/restore-backup`；实现真实备份、journal、marker、写回、strict schema 校验和显式恢复；默认 `forma serve` 不自动 preflight/cutover/recover。验收：cutover 成功、journal 显式恢复成功、恢复失败、rollback 成功、rollback 失败、preflight-only/recovery-only 状态测试通过，且所有 `backup_dir` 输入 realpath 校验不能逃逸当前 `$FORMA_HOME/normalization-backups/`。
4. Public legacy surface removal：在启用 v6 strict schema 前，先从 MCP registry、agent route list、installer manifest、server route table、SPA route table、README/docs/agent templates 和 Web API client 删除旧 public 入口：`complete_product_init`、旧一次性 `generate_components` 写入 handler、`generate_page_design`、`save_designs`、`generate_and_save_page_design`、`rollback_design`、`diff_designs`、`get_design_annotations`、`export_design_asset`、`fm-refine-design`、`/api/designs/:designId/*` 和 `/products/:productId/requirements/:requirementId/designs/:designId`。内部旧 `DesignService` 可以暂时保留为未导出的迁移测试 helper，但任何 public call 必须 unknown tool/default 404。验收：负向 public surface tests 通过，docs/help/install 输出不再暴露旧入口。
5. v6 strict schema 与 core read model：在 cutover committed 后启用 v6 strict schema，删除运行时代码对 `components_initialized`、`design_id`、页面级设计派生字段和 deterministic `D-*` preview fallback 的依赖；新增 requirement-level `design.yaml`、产品级 `components.yaml`、baseline image requirement-level lookup、产品删除 v6 component library 路径和 active design session 阻断。仍不注册新设计写入工具。验收：旧字段重新出现时 schema validation error；旧页面级 `D-*` 不参与状态读取；baseline image 不扫描旧 preview。
6. Pencil adapter 与 Session 编排：实现 `PencilAppSessionAdapter`、`PencilReadExportAdapter`、固定 timeout、短事务 product/pencil locks、产品级 `active-design-session.yaml`、局部 `active.yaml` lease、begin/apply/commit/discard、manual edit 检测、commit journal recovery 和 recovery status；旧 `PencilService.generatePageDesign()` / `generateComponents()` 写入路径删除或改为测试不可达；删除 `SyncService` 的 Pencil-backed style preview renderer，保留 Web token preview。验收：app-bound session tests、lock stale/corrupt tests、manual edit tests、commit journal recovery tests、Pencil preflight/open timeout tests 通过；sync tests 断言 `packages/core/src/sync.ts` 和 `scripts/live-style-sync.ts` 不调用 `pencil --in ... --out ... --prompt ...` 生成 preview `.pen`。
7. Core design model and quality gates：实现 requirement-level `design.yaml` 写入、index journal、history、scene payload、unmanaged import adoption、`plan_import_metadata_normalization`、component usage index、component refresh plan、Design Quality Pipeline 和 Semantic Scope Guard。验收：已有主画布索引、unmanaged import、metadata normalization plan、component usage、component refresh preflight、quality repair、layout scan limit、semantic scope tests 通过。
8. MCP 工具面：注册 v6 新工具；所有写入工具只调用 session adapter 和 core v6 model，不暴露 raw Pencil 路径参数。验收：新工具 schema/error payload tests 通过；旧工具名仍 unknown tool。
9. Agent 模板：把 `fm-design`、`fm-change-style`、`fm-refine-components` 和保留的 `fm-rollback-design` 改到 app-bound session 流程；删除 `fm-refine-design` 模板源和 managed 旧安装目标。验收：installer/copy-assets tests 通过，模板中没有旧工具作为可用入口。
10. Server/Web：新增 requirement-level design routes；替换 baseline image、`RequirementDetail`、`DesignView`、`PropertyPanel`、`ProductList`、API client 和测试 fixture；旧设计详情路径被 SPA fallback 排除并返回 default 404。验收：server routes、web API、route tests 通过。
11. UI 画布：以 `get_requirement_design_scene` 驱动 `DesignSceneCanvas`，用 requirement-level preview 作为只读对照；删除 `AnnotationCanvas` 运行时代码和测试导入，不能把它降级为测试夹具。原 `AnnotationCanvas` 中仍需要的 spacing 类型、spacing 计算和 Leafer runtime 测试 helper 必须迁移到 `packages/web/src/components/DesignSceneCanvas.tsx` 或独立 scene util，`PropertyPanel` 只能消费 `DesignSceneCanvas` / scene util 暴露的类型；所有新增文案进入 `packages/web/src/i18n.ts`。验收：scene hit-test、pan/zoom/fit、键盘等价操作、页面/节点列表替代入口、窄屏单列布局、真实截图入口、unsupported properties UI 和 `i18n` tests 通过。
12. 验证：先跑 core/mcp/server targeted tests，再跑 web typecheck/test，最后跑 Pencil interactive smoke；同时运行 `rg "createFormaStore\\(" packages scripts` 确认所有调用点都已 await async store factory；运行 `rg "\"--prompt\"|previewPencilModel|renderStylePreview|preview@2x\\.png" packages/core/src/sync.ts scripts/live-style-sync.ts`，必须无结果，以确认 style sync 不再调用 Pencil prompt 写入路径或 PNG preview 生成路径；确认运行时代码、用户可见 docs、agent 模板和 Web/API payload 中没有页面级 `D-*` 新写入、没有 `design_id` API payload、没有被删除的旧 route/skill 可发现入口。迁移文档和负向测试中的旧名称引用必须单独断言为删除说明或 404/unknown 行为。

## 实施范围

预计会涉及这些模块：

- `packages/core/src/design.ts`
- `packages/core/src/design-session.ts`
- `packages/core/src/design-scene.ts`
- `packages/core/src/pencil-adapter.ts`
- `packages/core/src/annotate.ts`（删除旧扁平 annotation 公开路径；如果测试仍需 annotation fixture，迁移到 test fixture，不保留生产源码入口）
- `packages/core/src/diff.ts`（删除旧 annotation diff 公开路径，v6 diff 改为 requirement-level version diff）
- `packages/core/src/store.ts`
- `packages/core/src/sync.ts`
- `packages/core/src/paths.ts`
- `packages/core/src/pencil.ts`
- `packages/core/src/design-quality.ts`
- `packages/core/src/component-library.ts`
- `packages/core/src/semantic-contract.ts`
- `packages/core/src/schema-normalization.ts`
- `packages/core/src/baseline.ts`
- `packages/core/src/product.ts`
- `packages/core/src/product-deletion.ts`
- `packages/core/src/requirement.ts`
- `packages/core/src/install.ts`
- `packages/core/src/index.ts`
- `packages/mcp/src/tools.ts`
- `packages/mcp/src/index.ts`
- `packages/cli/src/index.ts`
- `scripts/live-style-sync.ts`
- `scripts/smoke-pencil.ts`
- `scripts/smoke-pencil-error.ts`
- `packages/server/src/app.ts`
- `packages/server/src/index.ts`
- `packages/server/src/routes.ts`
- `packages/web/src/api.ts`
- `packages/web/src/routes.tsx`
- `packages/web/src/pages/ProductList.tsx`
- `packages/web/src/pages/ProductDetail.tsx`
- `packages/web/src/pages/RequirementDetail.tsx`
- `packages/web/src/pages/DesignView.tsx`
- `packages/web/src/components/NavigationGraph.tsx`
- `packages/web/src/components/DesignSceneCanvas.tsx`
- `packages/web/src/components/DiffViewer.tsx`
- `packages/web/src/components/AnnotationCanvas.tsx`（删除，由 `DesignSceneCanvas.tsx` 替代）
- `packages/web/src/components/PropertyPanel.tsx`
- `packages/agent/src/index.ts`
- `packages/agent/templates/shared/SKILL.md`
- `packages/agent/templates/*/fm-change-style.*`
- `packages/agent/templates/*/fm-refine-components.*`
- `packages/agent/templates/*/fm-design.*`
- `packages/agent/templates/*/fm-rollback-design.*`
- `packages/agent/templates/*/fm-status.*`
- `packages/agent/templates/*/fm-refine-design.*`（删除模板源；managed 旧安装目标在升级安装时删除）
- `docs/AGENT.md`
- `docs/MCP.md`
- `README.md`
- `packages/core/tests/product-deletion.test.ts`
- `packages/core/tests/product-session-style.test.ts`
- `packages/core/tests/pencil.test.ts`
- `packages/core/tests/foundation.test.ts`
- `packages/core/tests/semantic-contract.test.ts`
- `packages/core/tests/*design*.test.ts`
- `packages/core/tests/install.test.ts`
- `packages/cli/tests/copy-assets.test.ts`
- `packages/cli/tests/smoke-pencil-script.test.ts`
- `packages/mcp/tests/*tools*.test.ts`
- `packages/server/tests/routes.test.ts`
- `packages/web/src/api.test.ts`
- `packages/web/src/routes.test.ts`
- `packages/web/src/**/*.test.tsx`

这不是小修。它会改变 Forma 的设计源文件模型，需要配套迁移测试、已有主画布索引测试、unmanaged import adoption 测试、组件库版本测试、组件 usage index 测试、组件 refresh 原子性测试、commit journal 恢复测试、Design Quality Pipeline 测试、Pencil App session 测试、Semantic Scope Guard 测试和 UI 状态测试。
