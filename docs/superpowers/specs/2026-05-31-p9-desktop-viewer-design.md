# P9 — Desktop 接入共享 viewer + 外壳 dogfood 重做 设计

> 本文是 P9 的**设计 spec**(brainstorming 产出),供后续 `superpowers:writing-plans` 展开成实施计划。P8 决策已在总纲 `2026-05-29-open-design-design-capability-implementation.md` 锁定,无需另行 brainstorm;P9 的"外壳全重做"是创作型设计,经本次 brainstorm 敲定如下。

## Goal & Scope

`@xenonbyte/forma-desktop`(Electron 桌面端)**接入共享 `@xenonbyte/forma-viewer`** + **外壳信息架构(IA)重构 + 视觉全重样 + 自我 dogfood**,**纯只读**(无编辑入口;mutation 仅经 fm-* MCP;仅交付 `pnpm desktop:dev`)。中文文案。

依赖:P7(viewer,已并入 main)、P2(brand `tokens.css`,已迁移)、P5(craft lint,已就绪)。

## 锁定决策(本次 brainstorm)

- **D1 React 版本**:desktop 升 `react`/`react-dom`/`@types/react`/`@types/react-dom` → **19**(与 viewer/web 对齐)。消除 @types/react 18/19 串扰,结清 P7 final 评审 nit。`vitest` 保持 3(desktop 自身单测栈不动)。
- **D2 viewer peer 收窄**:两端均 React 19 → `packages/viewer/package.json` peer `react`/`react-dom` 收窄到 `^19.0.0`。`Canvas.tsx` 的 `const nodeTypes = {...} as NodeTypes` 断言:若升级后依赖树中已无 `@types/react@18`,可移除该断言;否则保留(无害)。**实现期核实**:`find node_modules/.pnpm -maxdepth 1 -name '@types+react@18*'`。
- **D3 IA = 统一工作区 + 左侧边栏**(取代现 SessionGate/ProductsHome/ProductView/ArtifactDetail 四屏跳转)。
- **D4 资源解析**:扩展只读 preload bridge 加**第 8 个只读方法** `formaServerBaseUrl()`;renderer 同步构造产品作用域 resolver,URL 路径与 web 完全一致。
- **D5 dogfood lint**:复用**根 vitest 4 browser project**(playwright/chromium)渲染各 shell 屏 → `extractSnapshotInPage()` → `lintCraft()` 断言;不动 desktop 自身 vitest 3。
- **D6 dogfood brand style** = **`clean`**(150 个里选,干净专业;可换 `vercel`/`stripe`/`cal`/`minimal`,仅换 tokens.css 导入)。
- **D7 width/height 来源**:后端 manifest 暂无 → 按产品 `platform` 取默认画布尺寸(`desktop`/`web` 1280×800;`mobile` 390×844;缺省 1280×800)。P8 复用同一映射;将来 manifest 增字段再读。

## 架构

### 组件清单(`packages/desktop/src/renderer/`)
- **`AppShell.tsx`**:外层布局 = 左 `Sidebar` + 顶 `TopBar` + 中 `WorkspacePane`;消费 brand `tokens.css`(CSS 变量),取代现有内联裸样式。
- **`Sidebar.tsx`**:产品切换(下拉/列表)+ 导航分区(需求 / 页面 / 风格)+ 底部连接状态指示。
- **`TopBar.tsx`**:面包屑 + 当前产品名。
- **`WorkspacePane.tsx`**:按当前选择渲染:
  - 选某需求 → `<Viewer model resolver />`,model 由该需求全部 artifact 规范化(entry `requirement`)。
  - 选某页面 → `<Viewer model resolver />`,model 仅该 page 的 variant(entry `page`)。
  - 选风格 → `StyleDetail`(DESIGN.md 文本 + tokens 预览 + `components.html` iframe)。
- **`ConnectionGate.tsx`**:`formaServerStatus()` 不可达时全屏遮罩(取代现 SessionGate 的全屏门);可达则进入 AppShell。
- **`StyleDetail.tsx`**:只读风格详情(复用 web 的展示约定:DESIGN.md + tokens + components.html iframe sandbox 无脚本)。
- **导航状态**:hash 路由(desktop 走 `file://`,与 web `routes.tsx` 同套思路,无新依赖);只读选择态。

### 现有四屏的归并
- SessionGate → 降为 `ConnectionGate`(状态 + 断连遮罩)。
- ProductsHome → 收进 Sidebar 产品切换 + 一个产品落地态。
- ProductView → 即 AppShell 工作区本身。
- ArtifactDetail → 查看主体换成中区 `<Viewer>`。
（旧组件文件按重构替换/删除,测试同步重写。）

## 资源解析(desktop ResourceResolver)

- `ResourceResolver.resolve(ref)` 返回 string(**同步**),故 renderer 必须同步持有 baseUrl。
- **preload bridge 加第 8 个只读方法** `formaServerBaseUrl(): Promise<string>`(对应 main 新增 IPC `forma:serverBaseUrl`,返回 `createFormaHttpClient` 的 baseUrl;保持"只读"性质)。
- renderer 启动时 `await window.forma.formaServerBaseUrl()` 取一次,构造**产品作用域** resolver:
  - `kind:"bundle"` → `${base}/api/products/${pid}/artifacts/${ref.artifactId}/versions/${ref.version}/bundle/index.html`
  - `kind:"asset"` → `${base}/api/products/${pid}/artifacts/${ref.artifactId}/versions/${ref.version}/bundle/${ref.path}`
  - `kind:"preview"` → `${base}/api/products/${pid}/artifacts/${ref.artifactId}/versions/${ref.version}/preview/${ref.density}`
- 路径方案与 **web 完全一致**(server 同一套路由);唯一差异:web 用同源相对 base、desktop 用绝对 forma server base。每个宿主各自实现 resolver(契约才是耦合点);路径构造极短,允许两端各写一份(或抽一个 ~5 行共享 helper,实现期定)。
- 现有 `forma-asset://` 自定义协议本期**不用**(spec 要求复用 server URL);不在 P9 触碰/移除。

## 接 viewer 数据映射

- `window.forma.listArtifacts(productId)` / `getRequirement(...)` 返回的 artifact 列表 → 映射为 `NormalizeArtifactInput[]`:`{ artifactId←id, kind, pageId←page_id, pageName, variant, title, version←current_version, width, height }`。
- 两入口:**按需求** = 过滤 `requirement_id === reqId`;**按页面** = 过滤 `page_id === pageId`。
- `width/height` 按 D7(platform 默认尺寸)。
- 调 `buildViewerModel({ entry, artifacts })` 得 model,连同 resolver 注入 `<Viewer>`。

## Dogfood craft lint(CI 可执行)

- 目的:外壳渲染产物过**与 artifact 同一套** P5 craft lint(机械规则:对比度 ≥4.5、字号取 type scale、`--accent` 可见使用 ≤N、token 遵循),CI 可执行、非人眼。
- 机制:新增**根级 vitest 4 browser project**(复用 P7 playwright/chromium + optimizeDeps 模式),测试文件渲染每个 shell 屏(mock `window.forma` 注入假数据)→ 调 `extractSnapshotInPage()` 取渲染后 DOM 快照 → `lintCraft(snapshot)` 断言无违规。
- desktop renderer 组件升 React 19 后与根 browser project(React 19 + chromium)一致,可被其渲染;desktop 自身 `vitest run`(vitest 3 / node 单测)**不动**。
- 测试文件落点(实现期定):`packages/desktop/src/renderer/*.dogfood.browser.test.tsx`,由根 vitest 的新 project include。

## 只读约束(DESIGN-v8 目标 7,不变)

无任何编辑入口;所有 mutation 仅经 fm-* MCP;desktop 仅交付 `pnpm desktop:dev`(不打包分发)。viewer 本就纯展示,符合。

## 测试策略

- 单元/组件(desktop 既有,vitest 3 node + happy-dom):Sidebar/WorkspacePane/导航/映射纯逻辑、ConnectionGate 状态、bridge 第 8 方法、main IPC handler。
- dogfood browser(根 vitest 4 / chromium):每屏渲染 + craft lint 断言。
- 映射纯函数(forma 数据 → NormalizeArtifactInput)单独 node 测。
- 全量不回退:`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm desktop:dev` 可跑。

## 依赖与不在范围

- 依赖:P7(viewer)✅、P2(brand tokens.css)✅、P5(craft lint)✅。
- 不在范围:标注内容(右 slot 仍占位)、桌面端打包分发、`forma-asset://` 改造、后端 manifest 加 width/height 字段(将来)。

## 验收

- 两视图(按需求 / 按页面)经共享 `<Viewer>` 可用,viewer 复用自包、未重写。
- 外壳 IA 重构为统一工作区 + 侧边栏,消费 `clean` brand tokens.css,**无内联裸样式**。
- 外壳每屏渲染成 DOM 后**跑同一套 craft lint 通过**(CI 可执行)。
- 仍纯只读;中文文案;`pnpm desktop:dev` 可跑;`pnpm test`/`typecheck`/`build` 全绿不回退。
- desktop React 19;viewer peer 收窄 `^19`;P7 React-18-未测 nit 结清。
