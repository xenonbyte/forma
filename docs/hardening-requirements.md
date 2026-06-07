# Forma 加固需求文档（第一批 + 第二批 + 功能增强候选）

- 日期：2026-06-07（v3：F3、F4 经产品决策立项）
- 来源：外部代码审查报告 → 逐条源码核实 → 裁剪后的正向优化清单 → 独立缺口审计补充（R10、R11、F1–F4）→ F3/F4 立项
- 状态：待实施
- 原则：保留现有架构，只在入口预算、token 管理、健壮性、边界测试上补薄薄一层。不引入数据库、用户系统、分布式锁、渲染微服务、插件系统。

## 背景与威胁模型前提

Forma 是单用户 local-first 工具：server 默认绑定 `127.0.0.1`，非 loopback 绑定强制要求 `FORMA_SERVER_TOKEN`（`packages/server/src/index.ts:21-42`）。因此本文档中：

- "AI 生成 HTML 缺预算" 定性为**健壮性问题**（本地 agent 把自己进程 OOM/挂死），不是对外 DoS。
- "token 暴露" 定性为**本机进程列表泄露**（`ps` 可见 argv），是低成本应修的小洞。
- 若未来部署形态变为多用户/常驻远程，需重新评估本文档"非范围"中砍掉的项（doctor、远程 UI 等）。

### 独立审计的正面结论（已核实、无需动作）

外部报告未覆盖以下区域，独立审计结论为**配置良好**，记录在此防止重复审查：

- **desktop Electron 安全配置**：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`（`packages/desktop/src/main/index.ts:174-177`），并有 origin-guard 测试拦截 null origin。
- **web/viewer 嵌入 artifact 的 iframe 均带 sandbox 且无 `allow-scripts`**：`StyleDetail.tsx:96`（`sandbox="allow-same-origin"`）、`viewer/src/tiles/DesignTile.tsx:24`（`sandbox="allow-same-origin allow-forms"`）。这是外部报告漏掉的缓解层——"无 CSP" 的实际防线是**静态校验器 + iframe sandbox** 两层（见 R7）。
- **vzi-parser 的 Puppeteer 默认 `sandbox: true`**，带 `allowNoSandboxFallback()` env/测试门控（`packages/vzi-parser/src/puppeteer-parser.ts`）；core 的 `requirement-vzi-capture.ts:358` 实例化时未关闭 sandbox，即归档捕获走沙箱。不一致的只有 `preview-renderer.ts`（见 R11）。
- **product-deletion 恢复流**：pending-delete marker + `recoverPendingProductDeletesLocked` + 告警通道，结构完整。

## 范围

第一批 7 项（R1–R6、R10）+ 第二批 4 项（R7–R9、R11）+ 第三批已立项功能 2 项（F3、F4）+ 功能增强候选 2 项（F1、F2，仍需产品决策）。加固项预计涉及约 8 个源文件，每项改动 5–30 行；F3/F4 为功能开发，规模见各自小节。全部可被现有 Vitest 基础设施覆盖。

## 非范围（明确不做）

| 项 | 不做的理由 |
|---|---|
| lock 校验 process start time | 需平台相关代码 + 时间容差窗口；防的是本地机器上近乎不发生的 PID 复用。 |
| `forma doctor --repair` | repair 模式是膨胀斜坡；只读诊断已立项为 F4，repair 仍明确不做。 |
| preview-renderer 浏览器实例复用/池化 | 本地工具、保存频率低；浏览器生命周期管理（僵尸进程、崩溃恢复）的复杂度高于每次冷启的代价。 |
| `requirements.index.yaml` 缓存 | 新增需维护一致性的不变量，优化的是本地规模下测不出来的扫描。 |
| 远程 Web UI token 输入 | 产品方向未定；先用 R8 一行文档收口。 |
| 跨包收敛路径边界 helper | 重构正在工作的安全代码，回归风险大于收益；只在顺手时做。 |
| 数据库/ORM、RBAC、分布式锁、渲染微服务、插件系统 | 与 local-first 定位不匹配。 |

---

## 第一批：确定正向、改动小、无架构影响

### R1 serve token 暴露面收敛

**现状**（`packages/cli/src/index.ts`）：

- 启动后台 server 时 token 同时进入 argv（`--serve-token <token>`，:876）和 env（`FORMA_SERVE_TOKEN`，:892）。
- `defaultVerifyServerProcess` 通过 `ps` 输出匹配 `--serve-token <token>` 来确认进程归属（:1023 `commandIncludesArgPair`）。
- serve state 文件用 `writeFile(file, content, "utf8")` 写入，无显式 mode（:526）。

**需求**：

1. 移除 `--serve-token` argv 传递，token 只通过 env（`FORMA_SERVE_TOKEN`）传给子进程。
2. state/pid 文件写入加 `mode: 0o600`。
3. `defaultVerifyServerProcess` 改为匹配 entrypoint + foreground marker + home + `started_at`，不再以 token 作为进程指纹。归属强校验依赖 state 文件中的 token（文件本身已 `0600`）。
4. 不引入密钥管理系统、不改 daemon 协议。

**验收标准**：

- [ ] `ps` 输出（即子进程 argv）中不再出现 token。
- [ ] state 文件权限为 `0600`（测试中断言 `stat.mode & 0o777`）。
- [ ] `forma serve start/stop/status` 全链路行为不变（现有 `packages/cli/tests/cli.test.ts` 通过，并更新其中对 `--serve-token` 的断言）。
- [ ] server 进程仍能通过 env 拿到 token 并启用 Bearer 校验。

### R2 product ID 碰撞防护与孤儿清理

**现状**（`packages/core/src/product.ts:164-178`、`packages/core/src/ids.ts`）：

- product ID 为 `P-` + 6 hex（24-bit 空间）。
- `createProductLocked` 不检查 ID 是否已存在，直接 `writeYamlAtomic(productFile(id))` —— **碰撞时静默覆盖已有产品的 `product.yaml`，属于数据丢失**（比审查报告描述的更严重）。
- 先写 product 文件、再写 `products.yaml` index；第二步失败会留下未入索引的孤儿文件。

**需求**：

1. `createProductLocked` 生成 ID 后检查 index 成员与 `productFile(id)` 是否已存在；碰撞则重新生成，最多重试 5 次，仍碰撞则抛 `FormaError`（复用或新增合适的 code，不得静默覆盖）。
2. index 写入失败时 best-effort 删除本次刚创建的 product 文件/目录（清理失败不掩盖原始错误）。
3. 不拉长 ID、不改 ID 格式（避免破坏现有 schema/数据兼容）。

**验收标准**：

- [ ] 测试：mock `createId` 返回已存在 ID 时，新建产品拿到不同 ID，且原产品文件内容不变。
- [ ] 测试：连续碰撞超过重试上限时抛出明确 `FormaError`。
- [ ] 测试：index 写入抛错时，本次创建的 product 文件被清理，错误向上抛出。
- [ ] 现有 `product-*.test.ts` 全部通过。

### R3 core 单点资源预算（瘦身版：3 常量 + sharp 像素上限）

**现状**：

- `saveDesignArtifact`（`packages/core/src/design-save.ts:100`）→ `localizeArtifactAssets`（`packages/core/src/artifact-asset-pipeline.ts:433`）链路对 HTML 长度、data URL 字节数、asset 数量、总字节数均无上限；仅 manifest metadata 有 16KB 预算（`artifact-manifest.ts:31`）。
- MCP `generate_requirement_design` / `generate_components` / `change_artifact_style` 的 `html` 仅要求非空字符串。
- sharp 处理 raster 图片（`artifact-asset-pipeline.ts` 下采样段、`artifact-icon-extraction.ts`），未显式设置 `limitInputPixels`。

**需求**：

1. 在 core 的 `saveDesignArtifact` / `localizeArtifactAssets` 入口（单点，MCP/HTTP/Web 共享）加 3 个常量预算，不做可配置项：
   - `MAX_HTML_BYTES`
   - `MAX_TOTAL_ASSET_BYTES`
   - `MAX_ASSET_COUNT`
2. 超限统一抛 `FormaError("ARTIFACT_INVALID_INPUT", ...)`，`details` 中包含超限项与上限值。
3. sharp 调用显式传 `limitInputPixels`（一行级，防像素炸弹），不另设 `MAX_IMAGE_PIXELS` 常量预算。
4. **不要**在 MCP、HTTP、Web 三层分别重复写大小限制。
5. 常量取值在实施时定（建议量级：HTML 单页 MB 级、总 asset 数十 MB 级、asset 数百级），写为带注释的命名常量。

**验收标准**：

- [ ] 测试：超大 HTML / 超量 asset / 超总字节分别触发 `ARTIFACT_INVALID_INPUT`，错误 details 可定位超限项。
- [ ] 测试：正常尺寸输入不受影响（现有 `design-save.test.ts`、`artifact-asset-pipeline.test.ts` 全部通过）。
- [ ] 超大尺寸恶意图片被 sharp 拒绝并被包装为 `FormaError`（非裸异常）。

### R4 `parseDataUrl` 异常归类

**现状**（`packages/core/src/artifact-asset-pipeline.ts:88-112`）：url-encoded 分支的 `decodeURIComponent(body)`（:108）遇 malformed payload 抛裸 `URIError`，最终变成笼统 INTERNAL_ERROR。

**需求**：`decodeURIComponent` 包 try/catch，malformed payload 抛 `FormaError("ARTIFACT_INVALID_INPUT", ...)`，details 含 mime 与失败原因。

**验收标准**：

- [ ] 测试：含 malformed url-encoded data URL 的 HTML 走保存链路得到 `ARTIFACT_INVALID_INPUT`，而非 INTERNAL_ERROR。

### R5 专用 `/api/health` 端点

**现状**：无 health 端点；desktop 的 `serverStatus()` 用 `fetch("/api/products")` 探活（`packages/desktop/src/main/index.ts:89-95`），每次探活都读 YAML index。

**需求**：

1. server 新增 `GET /api/health`：只读、不触盘（或仅最小化检查），返回固定 JSON（如 `{ status: "ok" }`）。
2. 与现有 `/api/*` Bearer 校验策略保持一致（设置 token 时同样要求认证，不开例外）。
3. desktop 探活切换到 `/api/health`；列表数据获取仍用 `/api/products`。

**验收标准**：

- [ ] 测试：`/api/health` 返回 200 与预期 body；设置 `FORMA_SERVER_TOKEN` 时无 Bearer 返回 401。
- [ ] desktop 探活逻辑指向 `/api/health`，现有 desktop 测试通过。

### R6 mutation origin 日志走 Fastify logger

**现状**（`packages/server/src/routes.ts:197`）：`console.log(JSON.stringify(...))` 直出，不经 Fastify logger，无级别区分。

**需求**：改为 `request.log.info`（或 `debug`，按现有日志习惯），只记录必要字段；确保不输出 token、完整路径或用户内容。

**验收标准**：

- [ ] `packages/server/src` 中该处不再有 `console.log`。
- [ ] 日志字段经人工确认不含敏感值。
- [ ] 现有 server 路由测试通过。

### R10 core 内 stdout 日志污染 MCP stdio 协议（bug 级，独立审计新发现）

**现状**：

- MCP server 走 stdio 传输，JSON-RPC 消息占用 stdout；MCP 包自身的日志已正确使用 `console.error`（stderr，`packages/mcp/src/index.ts:65,71`）。
- 但 core 的 `artifact-store.ts:194` 有 `console.log("[artifact-store] written:", artifactId)` —— 该代码在 MCP 进程内执行（`generate_requirement_design` → `saveDesignArtifact` → artifact 写入），**每次设计保存都向 stdout 写一行非 JSON 文本，与 MCP JSON-RPC 流交错**，依客户端解析器严格程度可能导致协议解析失败。
- core 其余 `console.*` 均为 `console.warn`（stderr，安全）：`artifact-tmp-cleanup.ts:11`、`requirement-vzi-capture.ts:369`、`artifact-icon-extraction.ts:309`。

**需求**：

1. 删除 `artifact-store.ts:194` 的 `console.log`（疑似调试遗留），或改为 `console.warn`/注入式 sink（参考 `product.ts` 已有的 `onProductMutationWarning` sink 模式）。
2. 加守护：测试或 lint 规则确保 `packages/core/src` 中不出现 `console.log`（`console.warn`/`console.error` 允许）。

**验收标准**：

- [ ] `grep -rn "console\.log" packages/core/src` 零结果。
- [ ] 守护测试/规则就位，新增 `console.log` 会被 CI 拦截。
- [ ] 现有 `artifact-store.test.ts` 通过。

---

## 第二批：正向但不紧急

### R7 静态校验器恶意输入回归测试

**定位**：`artifact-static-validation.ts` 是承重墙，用测试钉住它。实际防线分布：web/viewer 嵌入侧已有无 `allow-scripts` 的 iframe sandbox（见"正面结论"），UI 层是 校验器 + iframe sandbox 双层；唯一单层依赖校验器的面是 Puppeteer 渲染（由 R11 对齐 sandbox 默认值后也成为双层）。

**现状**：校验器已拒绝 `<script>`、事件属性、iframe/object/embed、远程资源、CSS remote/data URL、SVG script/event/href；`artifact-static-validation.test.ts` 已存在但未覆盖较冷门的可执行面。

**需求**：在 `packages/core/tests/artifact-static-validation.test.ts` 中补一组安全回归用例，每条断言被拒绝（或被证明无害并注释原因）：

- `<meta http-equiv="refresh">`
- `srcdoc` 属性
- SVG `<foreignObject>`
- SVG animation（`<animate>`/`<set>` 配 `href`/`xlink:href`）
- CSS `image-set()` 中的远程/`data:` URL
- `@font-face src` 远程 URL
- 转义/混淆形态的 `javascript:`（HTML entity、大小写、空白符变体）

**验收标准**：

- [ ] 上述每个向量都有独立用例；当前校验器若存在漏放，先修校验器再让用例转绿（修复属于本需求范围）。
- [ ] 测试文件中注明：本组用例是 no-sandbox 渲染与无 CSP 嵌入的安全前提，删改需安全评审。

### R8 README 注明远程模式边界

**现状**：非 loopback 模式下 bundled Web UI 不附带 token，实际只能程序化 API 或反代注入 auth；README 未明确告知。

**需求**：README 认证段落加一行：远程（非 loopback + token）模式当前仅支持程序化 API 访问，bundled Web UI 不可用；如需远程 UI 请使用反向代理注入 `Authorization` 头。不写任何代码。

**验收标准**：

- [ ] README 更新且表述与 `requireAuthTokenForHost` 实际行为一致。

### R9 lint 转 blocking（既定计划确认）

**现状**：CI 中 Biome lint step 带 `continue-on-error: true`（`.github/workflows/ci.yml:45-47`），注释已说明 backlog（约 33 条 recommended 规则，见 `docs/tech-debt.md`）。

**需求**：清完 lint backlog 后，移除 `continue-on-error: true`，lint 失败即红。这是确认既有计划并给出完成判据，不是新增工程。

**验收标准**：

- [ ] `pnpm lint` 在仓库根目录零报错。
- [ ] CI lint step 不再有 `continue-on-error: true`。

### R11 preview-renderer sandbox 对齐仓库既有模式（修订早前"不做"判断）

**修订说明**：v1 文档曾把"Puppeteer sandbox 开关"列入非范围。独立审计发现两个事实推翻该判断：

1. **仓库内已有现成模式**：`vzi-parser` 默认 `sandbox: true`，仅在 `VZI_PARSER_ALLOW_NO_SANDBOX_FALLBACK=1` / `VITEST` / `NODE_ENV=test` 时降级（`puppeteer-parser.ts` 的 `allowNoSandboxFallback()`）。core 归档捕获链路已实际运行在沙箱下。
2. **preview 失败非致命**：`design-save.ts:146-199` 中渲染失败仅置 `previewStatus: "failed"`，设计保存照常完成——默认开 sandbox 的最坏后果是冷门环境预览失败，不会阻断主流程。

因此这不是"新增配置面"，而是把 `preview-renderer.ts:40` 的硬编码 `--no-sandbox` 对齐到仓库已有的安全默认。

**需求**：

1. `preview-renderer.ts` 默认保留 Chromium sandbox；复用与 vzi-parser 相同的降级门控语义（CI/测试环境自动降级，或同名风格的显式 env）。
2. 不引入用户级配置项；不改变 preview 失败非致命的现有行为。

**验收标准**：

- [ ] 默认（非测试 env）launch args 不含 `--no-sandbox`。
- [ ] CI 与 `npx vitest run packages/core/tests/preview-renderer.test.ts` 在现有环境通过。
- [ ] sandbox 启动失败的环境中，设计保存仍成功且 `previewStatus: "failed"`（已有行为，加用例钉住）。

---

## 第三批：已立项功能增强（F3、F4）

2026-06-07 经产品决策立项。两项均依托既有能力，不引入新依赖或新架构层。

### F3 设计版本对比视图（web）

**现状**：

- 版本不可变（`v{n}/`），每版已有 `preview/1x.png` 与 `2x.png`。
- **server 侧版本化路由已存在**：`GET /api/products/:pid/artifacts/:aid/versions/:v/preview/:res`（`packages/server/src/routes.ts:730`）与 `/versions/:v/bundle/*`（:678）。
- 唯一的 server 缺口：artifact 详情响应（`GET /api/products/:pid/artifacts/:aid`，routes.ts:620-631）只返回 `manifest + preview_url`，**不含版本列表**；core 的 `listArtifactVersions(productId, artifactId): Promise<number[]>` 现成（store 接口）。
- web：`DesignView.tsx` 已存在；API 客户端为 `packages/web/src/api.ts`（`apiRequest`）；路由为 `routes.tsx` 的 hash 路由 `RouteDefinition[]`。

**需求**：

1. **server（加法改动）**：artifact 详情响应新增 `versions: number[]`（来自 `listArtifactVersions`）与 `current_version`（来自 pointer，响应中已有条件字段，对齐即可）。不新增路由。
2. **web**：新增版本对比视图——双栏并排展示同一 artifact 的 v{n} 与 v{m} preview（用既有 `/versions/:v/preview/:res` URL），提供两个版本选择器；入口放在 DesignView。双栏为首选形态；滑块对比不做（额外交互复杂度，无对应诉求）。
3. 对比视图为只读；不在对比视图内提供回滚操作（回滚仍走既有 agent/MCP 流程），避免 web 引入新的写路径。
4. 单版本 artifact（仅 v1）不显示对比入口。

**验收标准**：

- [ ] artifact 详情 API 返回 `versions` 数组，现有消费方（web/desktop）不受影响（加法字段）。
- [ ] web 对比视图可选任意两个版本并排显示 preview；版本切换不整页刷新。
- [ ] 仅 v1 时无对比入口；preview 缺失（`previewStatus: "failed"` 的版本）有明确占位提示而非裂图。
- [ ] 路由遵循现有 hash 路由模式（`routes.tsx`），含路由测试；组件测试覆盖版本选择与 URL 构造。
- [ ] `npx vitest run packages/web/src/pages/DesignView.test.tsx` 与 server 路由测试通过。

**规模**：server ~10 行 + 测试；web 一个新组件/页面 + DesignView 入口 + 测试。

### F4 `forma doctor` 只读诊断

**现状**：

- `createFormaStore`（`packages/core/src/store.ts:101-113`）在构建后立即调用 `validateStrictStoreReadModels`（:387）——遍历产品→需求→翻译，**首错即抛**（fail-fast），错误归因到 product_id。
- **结构性约束**：doctor 不能用 `createFormaStore`（扫描开始前就会因 fail-fast 崩掉）；非校验版工厂 `createStrictFormaStore` 目前未导出。
- `forma status` 已存在且只读；CLI 命令注册模式为 `packages/cli/src/index.ts:141-171` 的 command 分发链。

**需求**：

1. **core 新增导出 `diagnoseWorkspace(home)`**（命名实施时定，语义固定）：构建**不带启动校验门**的 store（内部复用 `createStrictFormaStore`），执行与 `validateStrictStoreReadModels` 同构的扫描，但**收集全部错误而非首错即抛**。返回结构化报告：`{ findings: Array<{ product_id?, requirement_id?, file?, error_code, message, details }> }`。
2. 扫描范围与启动校验一致：products index → 每个 product → 每个 requirement → translations；`products.yaml` 自身损坏作为顶层 finding 报告而非崩溃。
3. **附带孤儿检测**（承接 R2 的诊断面）：`data/<productId>/` 目录存在但不在 index 中的，报告为 `orphan` finding（只读报告，不清理）。
4. **CLI 新增 `doctor` 命令**：调用 `diagnoseWorkspace`，逐条输出 finding（文件路径 + 错误码 + 说明）；无 finding 输出 clean 并 exit 0，有 finding exit 1。注册进 usage()。
5. **严格只读**：不取锁、不写任何文件、无 `--repair`（见非范围）。
6. `serve`/MCP 的 fail-fast 行为**不变**；doctor 的错误信息中可提示用户运行 `forma doctor` 的话术由 serve 启动失败路径顺带补充（一行）。

**验收标准**：

- [ ] 构造含 2+ 个坏 product 的 workspace，`forma doctor` 报告全部问题（非首错即停），exit 1。
- [ ] 干净 workspace 输出 clean，exit 0。
- [ ] `products.yaml` 损坏时 doctor 仍能运行并报告，不崩溃。
- [ ] 孤儿 product 目录被报告且未被修改（前后目录内容一致）。
- [ ] doctor 全程无写操作（测试断言 mtime/内容不变）。
- [ ] `createFormaStore` 的 fail-fast 行为回归测试不变绿转红。

**规模**：core 一个新导出函数（~60-100 行，大部分复用既有校验逻辑）+ CLI 命令分发与输出（~40 行）+ 测试。

---

## 功能增强候选（未立项，需产品决策）

### F1 Web UI artifact 导出下载（低成本）

**依托**：core/MCP 已有完整导出能力——`export_artifact` 支持 `html / svg / png / zip（自包含 bundle）/ icons / vzi`（`packages/mcp/src/tools.ts:55,372`）。
**缺口**：web UI 无导出入口，设计交接只能走 MCP/agent。
**形态**：DesignView 加一个下载按钮 + server 加一条复用 core 导出路径的只读路由。
**价值**：把已实现的能力暴露给最直接的使用场景（拿到 zip/png 去交接）。

### F2 磁盘占用报告（低成本），可选 `forma gc`（需单独设计）

**依托**：版本目录 `v{n}/` 不可变、只增不减；`forma status` 已存在。
**缺口**：长期使用后 `$FORMA_HOME` 持续膨胀，用户无可见性。
**形态**：第一步只做只读报告——`forma status` 输出 per-product / per-artifact 磁盘占用与版本数。**`gc` 清理不在本项内**：删旧版本与 rollback 语义（回滚依赖历史版本指针）耦合，需要单独的需求文档。
**价值**：local-first 工具的磁盘可见性；为将来是否需要 gc 提供数据。

---

## 实施顺序与依赖

1. R4 → R3（同文件，先小修再加预算，避免冲突）。
2. R1、R2、R5、R6、R10 相互独立，可并行；R10 最小（删一行 + 守护），建议最先合入。
3. R7 独立；若发现校验器漏放，修复合入同一变更。R11 与 R7 相邻（同一防线主题），可同批。
4. R8 随 R5 或单独提交皆可。
5. R9 依赖 lint backlog 清理完成，单独排期。
6. F3 内部顺序：server 加 `versions` 字段 → web 对比视图（前者是后者的数据依赖）。与加固批次无依赖，可并行。
7. F4 内部顺序：core `diagnoseWorkspace` → CLI `doctor` 命令。与 R2 有主题交集（孤儿检测）：若 R2 先合入，其 orphan 清理逻辑不变，F4 仍报告残余孤儿；无硬依赖。
8. F1、F2 待产品决策；F2 的只读报告部分可随任意批次搭车。

## 统一验证

```bash
pnpm typecheck
pnpm test
# 定点回归：
npx vitest run packages/core/tests/design-save.test.ts
npx vitest run packages/core/tests/artifact-asset-pipeline.test.ts
npx vitest run packages/core/tests/artifact-static-validation.test.ts
npx vitest run packages/core/tests/artifact-store.test.ts
npx vitest run packages/core/tests/preview-renderer.test.ts
npx vitest run packages/cli/tests/cli.test.ts
# F3/F4 定点回归：
npx vitest run packages/web/src/pages/DesignView.test.tsx
npx vitest run packages/web/src/routes.test.ts
npx vitest run packages/core/tests/design.test.ts
```

## 回滚

所有变更（含 F3、F4）均无数据格式/on-disk layout 变更，无迁移：F3 仅新增 API 响应字段与前端视图，F4 为严格只读命令。任一项可独立 revert，不影响其余项。
