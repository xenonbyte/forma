# DESIGN v8：设计能力从 Pencil 整体迁移至 open-design

## 背景

v6/v7 一直在收敛 Pencil 的运行时问题：v6 引入 session-owned staging `.pen` 与 controlled save，v7 进一步加 active editor 收敛、guard、double-channel 校验。问题没有真正消除：Pencil 桌面 app 行为不可控，MCP 交互可靠性差，每一轮收敛都在追加 fail-closed 检查而不是解决根因。

v8 放弃对 Pencil 的所有适配工作，把设计能力整体迁移到 open-design：

1. 不使用 open-design 桌面端本体，把 open-design 的内部 pure-TS 包 fork 进 forma 作为 vendored 依赖。
2. 设计相关 MCP 全部基于 vendored 包重写。
3. forma 后台管理（web）中的设计风格直接读 open-design design-system token，不再自维护 schema，去掉一键同步。
4. 后台管理需求页只展示设计稿 PNG，去掉标注预览。
5. 后台管理新建产品时选择的风格 / 平台 / 语言保留并写入 product config，供生成时使用。
6. fm-* 设计相关 skill 全部重写，对接 vendored open-design 运行时。

同时新增一个独立的设计展示桌面端，纯只读，所有修改入口收敛到 fm-* skill 触发的 MCP。

上游参考：`/Users/xubo/x-studio/forma2-cankao/open-design`（0.7.0 cut），fork 时锁最新 commit SHA。

## 目标

1. forma 仓库内完成 Pencil → open-design 迁移，过程中不引入 open-design daemon，不引入 open-design 桌面端。
2. 设计产物按 open-design artifact manifest v1 持久化，弃用 `.pen` 模型。
3. MCP 设计工具集对外语义层接口稳定（list_products、save_requirement、get_style 等保留），底层实现全部切到 vendored 运行时。
4. 7 个 fm-* skill（claude + codex 共 14 份模板）重写，去掉 session/guard/quality 多步流。
5. web admin 设计风格改只读 token 展示；需求页改 PNG 预览；ProductNew 风格/平台/语言选项保留。
6. 新增 `packages/desktop`（Electron 41 + Vite + React + TS 6），纯展示，只交付 dev mode。
7. 任何 mutation 都必须经 fm-* skill 触发 MCP，桌面端不暴露任何编辑入口。

## 非目标

- 不引入 open-design 桌面端本体，不嵌 webview。
- 不保留 Pencil 兼容代码、不保留 `.pen` 旧数据、不提供迁移脚本。
- 不引入 open-design daemon 作为常驻进程。
- 不在新桌面端实现任何编辑能力。
- 不做"同时支持 Pencil 与 open-design"的过渡 backend 或 feature flag。
- 不在本次交付桌面端打包、代码签名、自动更新；仅交付 `pnpm desktop:dev`。
- 不在 forma 上游同步 open-design 的后续变更；vendored 即冻结。

## 关键决策（已锁定）

| 决策 | 选择 | 备注 |
|---|---|---|
| 目标仓库 | 在当前 forma 仓库就地迁移 | forma2 已有成果不复用，但其架构思路可参考 |
| open-design 来源 | fork 内部 pure-TS 包到 `packages/od-*` | 不消费 daemon HTTP API |
| 桌面端形态 | 全新 `packages/desktop`，参考 open-design desktop 技术栈 | Electron 41 + TS 6 + Node ~24 |
| 设计产物模型 | open-design artifact manifest v1 | 见 §6 |
| 旧 `.pen` 数据 | 全部删除，无迁移、无兼容 | 阶段 C 前置一次性清空 |
| 上游锁定 | 最新 commit SHA | 阶段 A 执行时记录 |
| 桌面端范围 | 仅 dev mode | 打包/签名/分发另起 ticket |
| 双 backend | 不允许；阶段 C 末尾一次性删除 Pencil 代码 | 与全局规则"显式失败、不留 silent fallback"一致 |

## 最脆弱假设

**vendored `od-plugin-runtime` 能脱离 daemon 在 forma 进程内执行 artifact 生成。**

上游 README 自述 "No node:fs imports — daemon emits, web/CopilotKit consumes"，意味着 plugin-runtime 是协议层而非生成执行层。若假设不成立：

- **降级方案**：仅复用 open-design 的 artifact manifest schema（存储格式），生成执行由 forma 自实现（HTML 模板渲染）。
- **影响范围**：阶段 B 的 `od-runtime.ts` 实现路径变化，阶段 A、C、D 不受影响。
- **验证点**：阶段 A 末尾 spike（见 §5.3）。spike 失败立即触发降级，不进入阶段 B。

## 整体架构（迁移后）

```text
forma 仓库
├── packages/od-contracts             ── fork 自 open-design pure-TS
├── packages/od-plugin-runtime        ── fork
├── packages/od-host                  ── fork
├── packages/od-platform              ── fork
├── packages/od-diagnostics           ── fork
├── packages/od-sidecar(+proto)       ── fork
│
├── packages/core
│   ├── od-runtime.ts                 ── 基于 od-plugin-runtime 生成 artifact
│   ├── artifact-store.ts             ── manifest v1 持久化、ETag、并发 lock
│   └── styles.ts                     ── facade：从 design-system artifact 读 token
│
├── packages/server                   ── Fastify，复用 runProductMutation
├── packages/mcp                      ── 重写：删 14 个 pencil tool、新增 6 个 artifact tool
├── packages/web                      ── 简化：StyleLibrary 只读、DesignView 改 PNG 预览
├── packages/desktop                  ── 新增：Electron + Vite + React（dev mode）
├── packages/cli                      ── 不变
└── packages/agent                    ── 7 × 2 = 14 份 fm-* skill 模板重写

$FORMA_HOME 布局（after）
├── data/products/<pid>/
│   ├── product.yaml
│   ├── od-project/                   ── open-design project root
│   │   ├── manifest.json             ── project-level
│   │   └── artifacts/<aid>/
│   │       ├── manifest.json         ── artifact manifest v1
│   │       ├── preview/*.png         ── 给 web admin 与 desktop 展示用
│   │       └── ...supportingFiles
│   └── requirements/<rid>/...        ── 不再含 design.pen
├── data/designs/                     ── 阶段 C 前置删除
├── library/                          ── 阶段 C 前置删除
├── config.yaml
└── session.yaml
```

---

## 阶段 A：工程链对齐与 vendored 内部包

无业务变更。目标是把工程链拉齐到能编译/运行 vendored 包，并通过 spike 验证最脆弱假设。

### A.1 engines 升级

| 项 | 当前 | 目标 | 理由 |
|---|---|---|---|
| Node | `>=22` | `~24` | open-design desktop 实测基线（`apps/desktop/package.json: engines.node`） |
| pnpm | `10.33.0` | `10.33.2` | open-design workspace 实测基线 |
| TypeScript | 当前版本 | `6.x` | open-design 用 TS 6（`apps/desktop/package.json: devDependencies.typescript`） |
| Electron | n/a | `41.3.0` | 仅 `packages/desktop` 依赖；阶段 D 引入 |

执行：

- 修改 root `package.json` engines、pnpm-workspace、所有 `packages/*/package.json` 中 TS 版本与 `@types/node`。
- `pnpm install` 全量安装、`pnpm typecheck` 全绿、`pnpm test` 全绿。
- 任何 TS 5→6 破坏立刻列出并修复；如出现大批量破坏（>20 处）暂停升 TS，仅升 Node，留 issue 跟踪。

### A.2 vendored 6 个内部包

| forma 内路径 | 上游路径 | 上游 npm name | forma npm name |
|---|---|---|---|
| `packages/od-contracts` | `packages/contracts` | `@open-design/contracts` | `@xenonbyte/od-contracts` |
| `packages/od-plugin-runtime` | `packages/plugin-runtime` | `@open-design/plugin-runtime` | `@xenonbyte/od-plugin-runtime` |
| `packages/od-host` | `packages/host` | `@open-design/host` | `@xenonbyte/od-host` |
| `packages/od-platform` | `packages/platform` | `@open-design/platform` | `@xenonbyte/od-platform` |
| `packages/od-diagnostics` | `packages/diagnostics` | `@open-design/diagnostics` | `@xenonbyte/od-diagnostics` |
| `packages/od-sidecar` + `packages/od-sidecar-proto` | `packages/sidecar(+proto)` | `@open-design/sidecar(+proto)` | `@xenonbyte/od-sidecar(+proto)` |

fork 规则：

1. 源码**不修改**。
2. 每个包根目录新增 `UPSTREAM.md`：上游 commit SHA、cut date、license（Apache-2.0），明确"不双向同步"。
3. `package.json` 仅改 `name`、`version`、`workspace:*` 依赖名。
4. workspace 内交叉引用：`@open-design/plugin-runtime` → `@xenonbyte/od-plugin-runtime`，做一次性 sed 替换并提交。
5. 不引入 agui-adapter 与 registry-protocol（forma 当前用不到，留待后续 ticket 评估）。

### A.3 spike：daemon-less 生成 artifact

路径：`spikes/od-runtime-daemonless/`

内容：

- 用 `@xenonbyte/od-plugin-runtime` + `@xenonbyte/od-host` 在 Node 进程内执行一次最小 html artifact 生成。
- 落盘到临时目录，生成 `manifest.json` + 至少 1 个 supportingFile。
- 用 `validateArtifactManifest()`（fork 自 daemon `artifact-manifest.ts`）通过校验。

通过条件：

- spike 二进制单文件可独立运行（`node spikes/od-runtime-daemonless/run.mjs`）。
- 退出码 0，stdout 输出生成目录路径，目录内含合法 manifest。
- 不需要起 HTTP server，不需要 daemon。

失败处理：

- 立即停止阶段 B 推进，开 issue 评估降级方案。
- 降级方案：阶段 B 的 `od-runtime.ts` 改为"只用 manifest schema + forma 自写 HTML 生成器"。
- 降级仅影响 `od-runtime.ts` 内部实现，对外接口（artifact-store、MCP tools、桌面端）保持一致。

### A.4 验证

```bash
pnpm install
pnpm typecheck
pnpm test
node spikes/od-runtime-daemonless/run.mjs
```

### A.5 交付

单 PR。无业务变更，可独立 merge / revert。

---

## 阶段 B：core 设计子系统重写

### B.1 删除清单（13 个文件 / ~3700 行）

```
packages/core/src/pencil.ts                  (367)
packages/core/src/pencil-adapter.ts          (762)
packages/core/src/pencil-session-guard.ts    (241)
packages/core/src/pen-model.ts
packages/core/src/design-session.ts          (1587)
packages/core/src/design-quality.ts          (482)
packages/core/src/design-scene.ts            (92)
packages/core/src/annotate.ts
packages/core/src/baseline.ts
packages/core/src/baseline-preview.ts
packages/core/src/diff.ts
packages/core/src/semantic-contract.ts
packages/core/src/semantic-contract-schema.ts
packages/core/src/semantic-scope.ts
packages/core/src/component-session.ts
packages/core/src/component-usage.ts
packages/core/src/components.ts
packages/core/src/sync.ts                    （一键同步）
```

实际数量以阶段 B 实施前 `git ls-files packages/core/src` 为准；上面是预计删除集合。

### B.2 新增清单

```
packages/core/src/od-runtime.ts          基于 od-plugin-runtime 生成 artifact
packages/core/src/artifact-store.ts      manifest v1 持久化 / ETag / 锁
packages/core/src/artifact-manifest.ts   fork 自 daemon artifact-manifest.ts 的校验器
packages/core/src/artifact-paths.ts      $FORMA_HOME/.../od-project/... 路径常量
packages/core/src/preview-store.ts       artifact preview PNG 缓存与服务
```

### B.3 修改清单

```
packages/core/src/store.ts             去掉 pencil/design-session 注入；注入 artifact-store
packages/core/src/product.ts           去掉 .pen 引用字段；保留风格/平台/语言
packages/core/src/styles.ts            改 facade：从 design-system artifact 读 token
packages/core/src/requirement-design.ts  改 facade：从 product 的 artifact-store 取 artifact
packages/core/src/install.ts           去掉 Pencil capability preflight 与 library 初始化
packages/core/src/errors.ts            新增 ARTIFACT_*、OD_RUNTIME_* 错误码；删除 PENCIL_* 错误码
packages/core/src/paths.ts             新增 od-project 路径常量
packages/core/src/index.ts             导出面收敛
packages/core/src/yaml.ts              保持
packages/core/src/schemas.ts           删除 pen/component 相关 schema；新增 artifact schema 包装
packages/core/src/product-mutation-lock.ts  保持（artifact-store 复用）
packages/core/src/file-hash.ts         保持（用于 artifact ETag）
```

### B.4 一次性数据清理（前置动作）

阶段 C 合并前执行一次（不写自动脚本，命令清单写入 PR description）：

```bash
rm -rf $FORMA_HOME/data/designs
rm -rf $FORMA_HOME/library
# product.yaml 内 .pen 引用字段：阶段 C 启动时由代码自动忽略（旧字段读不到即视为空）
```

用户已声明 .pen 旧数据全删，无需迁移工具。

### B.5 artifact 持久化结构

```
$FORMA_HOME/data/products/<pid>/od-project/
├── manifest.json                      ── project metadata（id, name, createdAt）
└── artifacts/<aid>/
    ├── manifest.json                  ── artifact manifest v1（见 §6）
    ├── preview/
    │   ├── 1x.png
    │   └── 2x.png
    └── <supportingFiles...>           ── HTML/JSX/SVG/MD/IMG，相对路径
```

artifact 写入约束：

1. 所有写入经 `artifact-store.writeArtifact(productId, artifact)`，内部走 `runProductMutation` 文件锁。
2. `aid` 由 `nanoid(16)` 生成，纯字母数字。
3. ETag = `sha256(manifest.json) + ":" + supportingFiles digest`。
4. 写入失败 → 不留半成品（atomic：先写 tmp 目录再 rename）。
5. 不允许覆盖写：替换语义为"写新 artifact + 更新 product 索引指针"，旧 artifact 保留。

### B.6 并发与锁

`runProductMutation` 已验证（见 v6 设计），复用。每个 product 一把锁，serialize 同 product 内所有 artifact 写入。

### B.7 验证

```bash
pnpm --filter @xenonbyte/forma-core test
# 新增覆盖：artifact-store 写入/读取/ETag、od-runtime 生成、并发 lock
```

### B.8 交付

单 PR。本阶段不动 MCP/web/skill，core 单元测试 + 直接 import 验证通过即可合。

---

## 阶段 C：MCP + fm-* skills 切换

### C.1 MCP 工具映射

#### 保留（语义层接口稳定，~18 个）

```
list_products, get_product, delete_product, confirm_product_id,
init_product_config, update_product_config, get_product_rules,
get_product_baseline, get_baseline_image, get_baseline_page,
save_requirement, get_requirement, get_requirement_history,
get_page_copy, update_page_copy,
get_style, list_styles, change_style
```

底层切换：`get_style` / `list_styles` 从 `styles.ts` facade 取 design-system artifact token。

#### 删除（22 个，全部 Pencil 强相关）

```
begin_product_component_session, commit_product_component_session, discard_product_component_session,
begin_requirement_design_session, commit_requirement_design_session, discard_requirement_design_session,
apply_product_component_operations, apply_requirement_design_operations,
batch_design,
get_requirement_design_canvas, get_requirement_design_history, get_requirement_design_scene,
index_requirement_design_canvas, index_component_usages,
validate_requirement_design_quality, recover_design_commit_journal,
refresh_requirement_components, rollback_requirement_design,
diff_requirement_design_versions, export_requirement_design_asset,
get_product_component_library, product_component_library, seed_components
```

#### 新增（6 个）

| 名称 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `list_product_artifacts` | `product_id`, `kind?` | `artifacts[]: {id, kind, title, preview_url, updated_at}` | 桌面端 / web admin 列表用 |
| `get_product_artifact` | `product_id`, `artifact_id` | manifest + supportingFiles index + preview_url | 详情读取 |
| `generate_requirement_design` | `product_id`, `requirement_id`, `mode: generate \| rebuild` | 新 artifact_id + status | 一次性完成生成→预览→落盘 |
| `refine_requirement_design` | `product_id`, `requirement_id`, `instructions` | 新 artifact_id + status | 替换不可变；旧 artifact 保留 |
| `generate_components` | `product_id`, `seed_components[]` | 新 component artifact_id（kind: react-component / design-system） | 替代 begin_product_component_session 全流程 |
| `export_artifact` | `product_id`, `artifact_id`, `format: html\|svg\|png\|zip` | 输出文件路径 | 替代 export_requirement_design_asset |

设计原则：

- 所有 mutation tool 是**一次性同步调用**（生成 + 校验 + 落盘）。失败即返回 error code，不留半成品 session。
- 删除"session begin/commit/discard"概念。session-as-state 模型由 artifact 不可变替换提供等价保证。
- 错误码新前缀：`ARTIFACT_*`、`OD_RUNTIME_*`。旧 `PENCIL_*` 错误码全部删除。

### C.2 HTTP routes 同步

`packages/server/src/routes/*` 与 `packages/web/src/api.ts`：

- 删除 `/design/session/*`、`/design/canvas/*`、`/design/quality/*`、`/design/components/*` 等。
- 新增 `/products/:pid/artifacts`、`/products/:pid/artifacts/:aid`、`/products/:pid/artifacts/:aid/preview/:res`。
- preview 路由：以静态文件返回 PNG，附 ETag/Cache-Control。

### C.3 fm-* skill 模板重写（14 份）

7 个 skill × 2 平台（claude + codex）。

| skill | 旧步数（v7） | 新步数（v8） | 主要变化 |
|---|---|---|---|
| `fm-list-product` | ~6 | ~5 | 去 Pencil capability 检查 |
| `fm-status` | ~5 | ~4 | 去 Pencil/library 状态报告 |
| `fm-requirement` | ~10 | ~8 | 去 semantic contract 强校验，保留页结构 |
| `fm-design` | ~15 | ~7 | 一次性 `generate_requirement_design` 替代 session 流 |
| `fm-refine-components` | ~12 | ~6 | 一次性 `generate_components`；移除 refresh 子流 |
| `fm-change-style` | ~8 | ~5 | 风格切换 → design-system artifact 替换 |
| `fm-rollback-design` | ~6 | ~4 | artifact 不可变；rollback = 把 product 指针指回旧 artifact_id |

模板必须保持现有 SKILL.md 格式、frontmatter、调用约定。共享指引 `~/.forma/skills/forma/SKILL.md` 同步更新（去 Pencil 段落、加 artifact lifecycle 段落）。

### C.4 验证

```bash
pnpm --filter @xenonbyte/forma-mcp test
pnpm --filter @xenonbyte/forma-server test
# 手测：
#   forma serve
#   /fm-list-product → /fm-design → /fm-refine-components → /fm-rollback-design
# 期望：全程不触发任何 PENCIL_* 错误码，artifact 正确写入 $FORMA_HOME/data/products/<pid>/od-project/
```

### C.5 交付

单 PR。**前置动作**：在 PR 第一条 commit 内执行 §B.4 一次性数据清理（PR description 写明用户机器需手动 `rm -rf` 旧数据）。本 PR 同时删除 §B.1 中所有 Pencil 文件（v8 不允许双 backend 共存窗口）。

---

## 阶段 D：web admin 简化 + 设计桌面端 dev mode

### D.1 web admin 简化

| 文件 | 变更 |
|---|---|
| `packages/web/src/pages/StyleLibrary.tsx` | 改只读：渲染 design-system artifact 的 color / typography / spacing token，删 mutation UI、删一键同步按钮 |
| `packages/web/src/pages/StyleDetail.tsx` | 改只读：token 详情卡片 + 使用预览 |
| `packages/web/src/pages/DesignView.tsx` | 改为按 product 列设计稿 PNG grid（用 list_product_artifacts），点击放大；删 DesignSceneCanvas |
| `packages/web/src/pages/RequirementDetail.tsx` | 删 DesignSessionPanel；改为展示该需求的最新 artifact preview PNG + 进入桌面端深链按钮 |
| `packages/web/src/pages/ProductNew.tsx` | 保留风格/平台/语言选项，写入 product config |
| `packages/web/src/pages/ProductDetail.tsx` | 保留 |
| `packages/web/src/pages/ProductList.tsx` | 保留 |
| `packages/web/src/components/DesignSessionPanel.tsx` | 删除 |
| `packages/web/src/components/DesignSceneCanvas.tsx` | 删除 |
| `packages/web/src/components/PropertyPanel.tsx` | 删除 |

`packages/web/src/api.ts`：跟随 §C.2 调整。

### D.2 packages/desktop（新增）

技术栈：Electron 41 + Vite + React 18 + TypeScript 6 + Node ~24。

#### 目录结构

```
packages/desktop/
├── package.json
├── tsconfig.json
├── vite.config.ts                  ── renderer dev server
├── electron.vite.config.ts         ── main/preload 构建（或独立 tsc）
├── src/
│   ├── main/
│   │   ├── index.ts                ── BrowserWindow、IPC、forma-asset:// 协议
│   │   └── forma-client.ts         ── 调用本机 forma server HTTP
│   ├── preload/
│   │   └── index.ts                ── 暴露 window.forma readonly API
│   └── renderer/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes/
│       │   ├── ProductsHome.tsx    ── 第一屏：产品网格
│       │   └── ProductView.tsx     ── tabs：需求 / 资源
│       ├── views/
│       │   ├── RequirementsList.tsx
│       │   ├── RequirementDesigns.tsx  ── 某需求下所有设计稿 PNG
│       │   ├── AssetsView.tsx          ── 通用组件 + 品牌资源
│       │   └── ArtifactDetail.tsx      ── 单图大图、缩放、信息侧栏
│       └── components/
│           ├── ProductCard.tsx
│           ├── ArtifactThumbnail.tsx
│           └── EmptyState.tsx
└── tests/
    └── routes.test.tsx
```

#### 通信

- 主进程不主动 IPC，渲染端通过 `window.fetch` 调本机 forma server（默认 `http://127.0.0.1:7591`，端口由 `forma serve` 写入 `$FORMA_HOME/session.yaml`，preload 注入到 renderer）。
- 主进程注册 `forma-asset://` 协议，把 `forma-asset://<pid>/<aid>/preview/2x.png` 映射到 `$FORMA_HOME/data/products/<pid>/od-project/artifacts/<aid>/preview/2x.png`，避免大图通过 HTTP。
- 渲染端**不持有任何 mutation API**。preload 只暴露 readonly endpoints。

#### 页面规约

**ProductsHome（第一屏）：**

- 产品网格，每卡：缩略图（最近一个 artifact preview）+ 产品名 + 产品描述。
- 缩略图缺失 → 显示首字母占位（基于 design-system token）。
- 点击进 ProductView。

**ProductView：**

- 顶部 tabs：`需求` / `资源`。
- `需求`：左侧需求列表（按状态分组），右侧选中需求的所有设计稿 PNG grid。
- `资源`：左侧分类（`通用组件` / `品牌资源`），右侧 artifact grid。
  - `通用组件` = list_product_artifacts(kind: react-component | design-system)
  - `品牌资源` = list_product_artifacts(kind: image)
- 点击 artifact 进 ArtifactDetail（全屏大图 + 元信息侧栏 + 关闭）。

**ArtifactDetail：**

- 大图（forma-asset:// 加载）、缩放/平移、键盘 esc 关闭。
- 侧栏：artifact id / kind / title / 更新时间 / 来源 skill / 关联需求。
- 不显示编辑按钮。

#### 启动脚本

```jsonc
// packages/desktop/package.json scripts
{
  "dev": "concurrently \"vite\" \"wait-on tcp:5173 && electron .\"",
  "typecheck": "tsc -p tsconfig.json --noEmit"
}

// root package.json scripts 新增
{
  "desktop:dev": "pnpm --filter @xenonbyte/forma-desktop dev"
}
```

#### 不交付

- 打包（electron-builder / vite-plugin-electron 等）
- 代码签名（macOS notarization / Windows authenticode）
- 自动更新（autoUpdater）
- 系统托盘 / 全局快捷键
- 多窗口
- i18n（首版 zh-CN 即可，结构上预留 locale provider）

### D.3 验证

```bash
pnpm --filter @xenonbyte/forma-web build
pnpm --filter @xenonbyte/forma-web test
pnpm --filter @xenonbyte/forma-desktop typecheck
pnpm --filter @xenonbyte/forma-desktop test

# 手测 cold path：
# 1. forma serve（背景）
# 2. pnpm desktop:dev
# 3. 见产品网格 → 点产品 → 切需求/资源 tab → 点 artifact → 大图
# 4. 不见任何编辑按钮；F12 检查 window.forma 无 mutation 方法
```

### D.4 交付

建议拆 2 个 PR：
- D-1：web admin 简化（独立可 merge，依赖阶段 C）
- D-2：packages/desktop 新增 dev mode（独立可 merge，依赖阶段 C）

---

## 6. artifact 模型详细规约

直接 fork `apps/daemon/src/artifact-manifest.ts` 进 `packages/core/src/artifact-manifest.ts`，做以下 forma-side 调整：

### 6.1 ALLOWED_KINDS

```
保留：html, design-system, react-component, markdown-document, svg
新增：image          ── 品牌资源（store/banner/icon），supportingFiles 内含一个 PNG/JPG/SVG
新增：preview-only   ── 仅作 PNG 展示，无可执行渲染（占位 / 截图导入）
弃用：deck, diagram, code-snippet, mini-app  ── forma 业务无需求
```

### 6.2 ALLOWED_RENDERERS

```
保留：html, design-system, react-component, markdown, svg
新增：image, preview-only
```

### 6.3 manifest 字段（v1）

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `version` | int | ✓ | == 1 |
| `id` | string | ✓ | nanoid(16) |
| `kind` | string | ✓ | ALLOWED_KINDS |
| `renderer` | string | ✓ | ALLOWED_RENDERERS |
| `title` | string | ✓ | ≤ 200 |
| `entry` | string | ✓ | 相对路径，≤ 260，无 `..`、无绝对路径、无 null byte |
| `supportingFiles` | string[] | ✓ | ≤ 128 条，每条 ≤ 260，约束同 entry |
| `sourceSkillId` | string | optional | ≤ 128，例：`fm-design` |
| `designSystemId` | string | optional | ≤ 128，绑定的 design-system artifact id |
| `metadata` | object | optional | JSON 序列化后 ≤ 16KB |
| `status` | enum | ✓ | `complete \| error`（forma 同步模式无 `streaming`） |
| `createdAt` | ISO8601 | ✓ | |
| `updatedAt` | ISO8601 | ✓ | |
| `requirementId` | string | optional | forma 扩展字段：关联需求 |

### 6.4 supportingFiles 路径校验

复用上游 `validateSupportingPath()`：

- 必须相对路径
- 不允许 `..` 段
- 不允许 null byte
- 不允许 `.` / `..` 段名
- Windows 绝对路径前缀也拒绝

### 6.5 不可变与替换

- artifact 一旦写入即不可变（manifest + supportingFiles 都不可改）。
- "更新设计稿" 语义 = 写新 artifact + 更新 product 索引指针。
- 旧 artifact 保留，作为天然的历史版本。
- 桌面端不显示历史 artifact 列表（避免视觉嘈杂），但 MCP `list_product_artifacts` 支持 `include_superseded: true` 查全集。

---

## 7. 验证策略

| 阶段 | 自动化验证 | 手动验证 |
|---|---|---|
| A | `pnpm install && pnpm typecheck && pnpm test`；spike 退出码 0 + 合法 manifest | 无 |
| B | `pnpm --filter @xenonbyte/forma-core test`（含新增 artifact-store / od-runtime 覆盖） | 无 |
| C | `pnpm --filter @xenonbyte/forma-mcp test`、`pnpm --filter @xenonbyte/forma-server test` | `forma serve` + 走一遍 fm-design → fm-refine-components → fm-rollback-design，不见 PENCIL_* 错误 |
| D | web build + 各包 typecheck/test | `pnpm desktop:dev` cold path：产品网格→需求/资源→大图；检查无编辑入口 |

每阶段未通过即不进下一阶段。

---

## 8. 风险与回滚

| 风险 | 触发条件 | 缓解 | 回滚动作 |
|---|---|---|---|
| TS 5→6 大批量破坏 | 阶段 A typecheck 报错 >20 处 | 暂停升 TS，仅升 Node | revert 阶段 A 中 TS 版本相关 commit |
| spike 失败 | 阶段 A 末尾 spike 无法生成合法 manifest | 切降级方案（自实现生成器） | 不进阶段 B；阶段 B 重做实现 |
| Pencil 旧数据未清 | 阶段 C 部署后 product.yaml 仍带 .pen 字段 | 代码层显式忽略未知字段（forwardCompat 读 schema） | n/a |
| MCP 接口回归 | 阶段 C 上线后 fm-* skill 流程报错 | 手测覆盖 7 个 skill cold path | revert 阶段 C PR；阶段 A/B 已合可独立保留 |
| Electron + Vite 版本不兼容 | 阶段 D dev 启动失败 | 锁 Electron 41 + Vite 5.x + electron-vite 1.x（开工时核 npm 最新兼容矩阵） | revert 阶段 D；不影响 A/B/C |
| 桌面端误触发 mutation | 渲染端意外引入 fetch 到 mutation endpoint | preload 不暴露 mutation；server 端额外加 CSRF-like origin 校验 | n/a（编译期可拦） |

回滚单位：每阶段独立 PR。阶段间不耦合，可单独 revert。

---

## 9. 交付清单

| PR | 阶段 | 主要内容 | 依赖 |
|---|---|---|---|
| #1 | A | engines 升级 + 6 个 vendored 包 + spike | 无 |
| #2 | B | core 设计子系统重写 + 新增 artifact-store/od-runtime | #1 |
| #3 | C | MCP/server 切换 + 14 份 fm-* skill 模板 + 删 Pencil 文件 + 旧数据清理（手动） | #2 |
| #4 | D-1 | web admin 简化 | #3 |
| #5 | D-2 | packages/desktop dev mode | #3 |

PR #3 是不可逆切换点（删除 Pencil 代码 + 删旧数据）。合并前必须：

1. 用户机器执行一次性 `rm -rf $FORMA_HOME/data/designs $FORMA_HOME/library`
2. 手测覆盖 7 个 fm-* skill cold path
3. spike 已在 #1 通过（如降级则 #2 已验证降级实现）

---

## 10. Open Items（执行时确定，不阻塞方案）

| Item | 决策时机 |
|---|---|
| A.2 上游 commit SHA | 阶段 A 执行时 `git ls-remote` 取最新，写入 UPSTREAM.md |
| A.1 TS 5→6 升级是否一次完成 | 阶段 A typecheck 报错数量决定 |
| 6.1 是否需要 `react-component` kind | 阶段 B 实现 generate_components 时决定（取决于 forma 组件库形态） |
| D.2 渲染端是否需要本地 i18n | 阶段 D 落地后用户决定 |
| 桌面端打包/签名/分发 | 另起 ticket，不在本次 v8 范围 |

---

## 附录 A：MCP 工具数量统计

```
旧（v7）：~42 个，其中 Pencil 强相关 22 个
新（v8）：~24 个 = 保留 18 + 新增 6
净减少：~18 个工具，~50% MCP surface 收敛
```

## 附录 B：core 代码量预估

```
删除：~3700 行（13 个 Pencil 文件）
新增：~800 行（artifact-store + od-runtime + manifest 校验 + 路径常量 + preview-store）
净减少：~2900 行 core 代码
```

## 附录 C：上游 open-design 锁定记录（阶段 A 执行时填写）

```
upstream: https://github.com/<owner>/open-design
commit:   <SHA>
date:     <ISO8601>
cut:      0.7.0
license:  Apache-2.0
packages: contracts, plugin-runtime, host, platform, diagnostics, sidecar, sidecar-proto
```
