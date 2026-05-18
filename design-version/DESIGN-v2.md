# Forma v0.2 设计方案

## 背景

v0.1 实现了完整的设计稿生产和管理核心流程，但存在以下局限：

1. **风格资源无法在线更新** — 50+ 风格以静态文件内置在 npm 包中，awesome-design-md 仓库持续更新但用户本地数据停留在安装时版本，更新需要重装 Forma
2. **风格预览图是预生成的静态文件** — v0.1 的 preview@2x.png 在开发阶段预先生成并打包，无法反映最新风格数据的实际渲染效果，新同步的风格也无法自动获得预览图
3. **基线概览只有列表形式** — v0.1 的基线概览页面（`/products/:productId/baseline`）展示的是"functional page list and navigation list"，用户无法直观看到页面间的跳转关系和整体产品结构

v0.2 解决这三个问题：一键同步风格资源、动态生成风格预览图、基线页面导航关系图。

## 目标

1. 实现 `POST /api/styles/sync` 接口，用户在 Web 后台一键从 GitHub 拉取最新风格数据
2. 同步完成后自动为每个风格渲染 preview@2x.png（使用 Pencil CLI + `_preview-template.pen`）
3. 基线概览页面新增可视化导航关系图，展示页面间的跳转关系

## 不做

- 不做定时自动同步（只支持手动触发）
- 不做同步进度的 WebSocket 实时推送（使用轮询查询状态）
- 不做 awesome-design-md 以外的风格源支持
- 不修改已有产品的 style 配置（同步只更新风格库，不影响已选风格的产品）
- 导航图不做拖拽编辑（只读展示）
- 导航图不做高级分层布局算法（如 Dagre），使用简单力导向布局

---

## 功能一：风格一键同步

### 整体流程

```
用户点击 [一键同步] 按钮
       │
       ▼
POST /api/styles/sync
       │
       ▼
后端在 Web Server 进程内启动异步任务（不 fork 子进程），返回 202 + task_id
       │
       ▼
┌──────────────────────────────────────────────────┐
│ 1. git clone --depth 1 awesome-design-md 到临时目录│
│ 2. 扫描所有风格目录（含 DESIGN.md 的子目录）       │
│ 3. 对每个风格：                                    │
│    a. 复制 DESIGN.md 到 ~/.forma/styles/{name}/   │
│    b. 正则提取设计变量                             │
│    c. 用变量渲染 _preview-template.pen            │
│    d. 导出 preview@2x.png                         │
│ 4. 更新 styles.yaml 索引                          │
│ 5. 清理临时目录                                    │
└──────────────────────────────────────────────────┘
       │
       ▼
前端轮询 GET /api/styles/sync/status
       │
       ▼
同步完成 → 前端刷新风格列表
```

同步任务在 Web Server 进程内以 `Promise`（async 函数）方式运行，不 fork 子进程。理由：
- 同步任务需要访问 `PencilService`（含锁管理），跨进程共享锁状态复杂
- 任务本身是 I/O 密集（git clone、文件读写、Pencil CLI 调用），不阻塞 Node.js 事件循环
- Web Server 崩溃时任务自然终止，通过 sync-state.yaml 恢复状态即可

### API 接口

#### POST /api/styles/sync

触发一键同步。

请求体：无

响应：

成功启动（202）：
```json
{
  "task_id": "sync-a1b2c3d4",
  "status": "running",
  "message": "Style sync started"
}
```

已有同步任务在运行（409）：
```json
{
  "error_code": "SYNC_ALREADY_RUNNING",
  "message": "A sync task is already in progress",
  "details": { "task_id": "sync-a1b2c3d4" }
}
```

Pencil 不可用（503）：
```json
{
  "error_code": "PENCIL_CLI_NOT_FOUND",
  "message": "Pencil CLI is not installed"
}
```

Git 不可用（503）：
```json
{
  "error_code": "SYNC_GIT_NOT_FOUND",
  "message": "Git is not installed"
}
```

#### GET /api/styles/sync/status

查询同步任务状态。

无任务或已完成（200）：
```json
{
  "status": "idle",
  "last_sync": {
    "completed_at": "2026-05-18T10:30:00Z",
    "styles_total": 52,
    "styles_updated": 3,
    "styles_added": 1,
    "styles_failed": 0,
    "duration_ms": 45000
  }
}
```

运行中（200）：
```json
{
  "status": "running",
  "task_id": "sync-a1b2c3d4",
  "progress": {
    "phase": "rendering_previews",
    "current": 28,
    "total": 52,
    "current_style": "notion"
  }
}
```

失败（200）：
```json
{
  "status": "failed",
  "task_id": "sync-a1b2c3d4",
  "error": {
    "phase": "git_clone",
    "message": "Failed to clone repository: network timeout"
  }
}
```

### 同步任务状态机

```
idle ──(POST /api/styles/sync)──→ running ──(完成)──→ idle
                                     │
                                     └──(失败)──→ failed ──(POST /api/styles/sync)──→ running
```

状态持久化到 `~/.forma/sync-state.yaml`：

```yaml
status: idle
last_sync:
  completed_at: 2026-05-18T10:30:00Z
  styles_total: 52
  styles_updated: 3
  styles_added: 1
  styles_failed: 0
  duration_ms: 45000
```

运行中状态：

```yaml
status: running
task_id: sync-a1b2c3d4
started_at: 2026-05-18T10:29:15Z
progress:
  phase: rendering_previews
  current: 28
  total: 52
  current_style: notion
```

### 同步流程详细设计

#### 阶段 1：Git 拉取

```bash
git clone --depth 1 https://github.com/VoltAgent/awesome-design-md.git /tmp/forma-sync-{uuid}/awesome-design-md
```

超时：60 秒（通过 `child_process.spawn` 的 `timeout` 选项实现）。超时后 kill 子进程，标记任务失败，清理临时目录。

网络失败处理：记录错误到 sync-state.yaml，状态设为 `failed`，不影响现有 `~/.forma/styles/` 数据。

#### 阶段 2：扫描风格目录

扫描克隆目录下所有包含 `DESIGN.md` 文件的**一级子目录**。跳过 `_` 和 `.` 开头的目录。

如果仓库结构不符合预期（根目录下无任何含 DESIGN.md 的子目录），标记任务失败，错误信息为 "Repository structure changed: no style directories found"。

#### 阶段 3：变量提取

使用正则 + 启发式规则从 DESIGN.md 提取变量，不依赖外部 AI API。

理由：
- 同步操作不应依赖外部 AI API（避免网络双重依赖：GitHub + AI API）
- awesome-design-md 的 DESIGN.md 格式相对规范，正则可覆盖大部分情况
- 提取失败时有完整的 fallback 默认值兜底
- 确定性结果，相同输入永远产生相同输出

提取规则：

| 变量 | 匹配模式 | 默认值 |
|------|----------|--------|
| primary | `/primary[:\s]+([#][0-9a-fA-F]{6})/i` | #3b82f6 |
| secondary | `/secondary[:\s]+([#][0-9a-fA-F]{6})/i` | 无（可选） |
| background | `/background[:\s]+([#][0-9a-fA-F]{6})/i` | #FFFFFF |
| text-primary | `/text[- ]?primary[:\s]+([#][0-9a-fA-F]{6})/i` 或 `/foreground[:\s]+([#][0-9a-fA-F]{6})/i` | #111827 |
| font-heading | `/heading[- ]?font[:\s]+["']?([^"'\n,]+)/i` | Inter |
| font-body | `/body[- ]?font[:\s]+["']?([^"'\n,]+)/i` | Inter |
| border-radius | `/border[- ]?radius[:\s]+(\d+)/i` 或 `/corner[- ]?radius[:\s]+(\d+)/i` | 8 |
| spacing-unit | `/spacing[- ]?unit[:\s]+(\d+)/i` 或 `/base[- ]?spacing[:\s]+(\d+)/i` | 8 |

单个风格提取失败处理：不会发生"提取失败"——正则不匹配时直接使用默认值，所有变量都有 fallback。最终每个风格都会产出一组完整变量。

#### 阶段 4：预览图渲染（功能二的核心）

详见下方"功能二：风格预览生成"。

#### 阶段 5：更新索引

原子写入 `~/.forma/styles/styles.yaml`（临时文件 + rename）。

**风格更新判断标准：** 对比新旧 DESIGN.md 文件的 SHA-256 哈希值。哈希不同即为"已更新"，计入 `styles_updated`。新目录（本地不存在）计入 `styles_added`。

分类提取规则（从 DESIGN.md 内容关键词匹配）：

| 关键词 | 分类 |
|--------|------|
| AI、LLM、chat、assistant | AI 产品 |
| tool、productivity、project、task | 工具类 |
| shop、commerce、retail、store | 电商 |
| finance、bank、payment、trading | 金融 |
| social、community、message | 社交 |
| health、medical、fitness | 健康 |
| 以上均不匹配 | 其他 |

描述提取规则：取 DESIGN.md 第一个非标题（不以 `#` 开头）、非空行的前 50 个字符。

#### 阶段 6：清理

无论同步成功或失败，临时目录 `/tmp/forma-sync-{uuid}/` 都必须清理。使用 `try/finally` 确保执行。

### 硬门禁

| 检查项 | 时机 | 失败响应 |
|--------|------|----------|
| Pencil CLI 已安装 | POST /api/styles/sync 入口 | 503 + PENCIL_CLI_NOT_FOUND |
| Pencil 已认证 | POST /api/styles/sync 入口 | 503 + PENCIL_NOT_AUTHENTICATED |
| 无正在运行的同步任务 | POST /api/styles/sync 入口 | 409 + SYNC_ALREADY_RUNNING |
| Git 可执行 | POST /api/styles/sync 入口 | 503 + SYNC_GIT_NOT_FOUND |

Git 可用性检查方式：`git --version`，超时 5 秒，返回非零退出码或超时则判定不可用。

### 并发安全

- **同步任务互斥：** 同一时间只允许一个同步任务运行，通过 `sync-state.yaml` 中的 status 字段判断。POST 入口先读取 status，如果为 `running` 且未超时（<10 分钟）则拒绝
- **与 Agent 操作的锁竞争：** 预览渲染需要 Pencil 全局锁，采用批次释放策略（每 5 个风格释放一次锁），给 Agent 操作插入的机会
- **文件写入原子性：** styles.yaml 使用 `writeYamlAtomic`，单个风格的 DESIGN.md 和 preview@2x.png 先写临时文件再 rename

### 进程崩溃恢复

如果同步过程中 Web Server 进程崩溃：

1. `sync-state.yaml` 中 status 为 `running`
2. 下次 Web Server 启动时检测：如果 status 为 `running` 且 `started_at` 超过 10 分钟，自动重置为 `failed`
3. 临时目录 `/tmp/forma-sync-*` 由通用清理逻辑处理（超过 1 小时自动清理）

### 前端交互

| 后端状态 | 按钮显示 | 按钮行为 |
|----------|----------|----------|
| idle | "一键同步" | 可点击，触发 POST |
| running | "同步中... (28/52)" | 置灰不可点击，显示进度 |
| failed | "同步失败，重试" | 可点击，触发 POST |

轮询策略：
- 触发同步后，每 2 秒轮询 `GET /api/styles/sync/status`
- 状态变为 `idle` 或 `failed` 后停止轮询
- 页面加载时查询一次状态，如果是 `running` 则开始轮询
- 同步完成后自动刷新风格列表，显示摘要："同步完成，共 52 个风格，新增 1 个，更新 3 个"

---

## 功能二：Web 后台风格预览生成

### 机制

使用 `_preview-template.pen`（v0.1 已内置的固定组件布局模板），注入风格变量后通过 Pencil CLI 渲染导出 2x PNG。

### 渲染流程

```
对单个风格：
1. 复制 ~/.forma/styles/_preview-template.pen 到临时文件 /tmp/forma-sync-{uuid}/{name}.pen
2. 使用 Pencil Agent Mode 注入变量并导出：
   pencil --in /tmp/.../{name}.pen \
          --out /tmp/.../{name}.pen \
          --prompt "Set these variables on the document: --primary=#5E6AD2, --background=#FFFFFF, ... Do not modify any nodes, only set variables."
3. 导出 2x PNG：
   pencil --in /tmp/.../{name}.pen \
          --export /tmp/.../{name}-preview@2x.png \
          --export-scale 2
4. 验证 PNG 文件存在且大小 > 0
5. rename 到 ~/.forma/styles/{name}/preview@2x.png
```

**为什么用 Agent Mode 而非 Interactive Mode 的 set_variables：**

v0.1 的 `PencilService` 已封装了 Agent Mode（`--in` + `--out` + `--prompt`）和 export（`--in` + `--export`）。Interactive Mode 的 `set_variables` 命令虽然 Pencil 支持，但需要新增 Interactive Mode 的进程管理（启动、发送命令、等待响应、退出），增加实现复杂度。Agent Mode 用一条 prompt 即可完成变量设置，复用 v0.1 已有的 `PencilService.runner.run()` 方法，无需新增接口。

Agent Mode prompt 构造：
```
Set the following variables on this document. Do not add, remove, or modify any nodes. Only update variable values:
--primary: #5E6AD2
--background: #FFFFFF
--text-primary: #111827
--font-heading: Inter
--font-body: Inter
--border-radius: 8
--spacing-unit: 8
```

### 变量名对应关系

`_preview-template.pen` 中使用的变量引用名与注入的变量名必须一致。v0.1 创建 `_preview-template.pen` 时使用以下变量名（这是开发阶段的约定，写死在模板中）：

| 模板中的变量引用 | 注入时的变量名 | 含义 |
|-----------------|---------------|------|
| `$--primary` | `--primary` | 主色 |
| `$--background` | `--background` | 背景色 |
| `$--text-primary` | `--text-primary` | 主文字色 |
| `$--font-heading` | `--font-heading` | 标题字体 |
| `$--font-body` | `--font-body` | 正文字体 |
| `$--border-radius` | `--border-radius` | 圆角 |
| `$--spacing-unit` | `--spacing-unit` | 间距单位 |

这是固定约定，不存在不匹配的可能——模板和注入代码在同一个项目中维护。

### 锁策略

预览渲染需要 Pencil 全局锁（`~/.forma/pencil.lock`）。为避免长时间占用锁阻塞 Agent 的 design/refine 操作，采用批次释放策略：

```
每 5 个风格为一批：
  获取锁 → 渲染 5 个预览 → 释放锁 → 更新进度 → 获取锁 → 下一批...
```

批次间释放锁后，如果 Agent 正好有操作等待锁，Agent 操作优先执行完毕后同步任务再继续。

### 单个预览渲染失败处理

- 记录警告到同步结果的 `styles_failed` 计数
- 保留该风格的旧预览图（如果存在）
- 如果无旧预览图，该风格在前端显示占位图（灰色背景 + 风格名称文字，纯 CSS 实现，不依赖图片文件）
- 不中断整体同步流程

### 预览图规格

- 格式：PNG
- 尺寸：800×600 逻辑像素，导出为 1600×1200 物理像素（2x）
- 内容：`_preview-template.pen` 中的固定组件集（按钮、输入框、卡片、导航栏、列表项、标签）

---

## 功能三：基线概览页面导航图

### 现状（v0.1）

基线概览页面 `/products/:productId/baseline` 展示：
- 页面功能列表（表格形式：页面名、功能描述、关联需求）
- 导航关系列表（表格形式：from、to、trigger）

### v0.2 新增

在现有列表视图基础上新增 Tab 切换，添加**可视化导航关系图**，以节点-边的形式展示页面间跳转关系。

### 技术选型

使用 LeaferJS（v0.1 已引入）绘制导航图。不引入新的图形库依赖。

理由：
- v0.1 已经在标注画布中使用 LeaferJS，团队已熟悉
- 导航图的需求简单（节点 + 有向边 + 文字标签），不需要专业图可视化库
- 减少包体积和依赖复杂度

### 导航图渲染规则

#### 节点

每个基线页面渲染为一个圆角矩形节点：

```
┌─────────────┐
│   登录页     │
│  (3个功能)   │
└─────────────┘
```

- 宽度：120px 固定
- 高度：60px 固定
- 圆角：8px
- 填充：#F3F4F6（浅灰）
- 边框：#D1D5DB（灰色），1px
- 文字：页面名称（14px，居中）+ 功能数量（12px，灰色，居中）
- 功能数量 = features 字段中以"+"分隔的功能项数量

#### 边

每条导航关系渲染为一条有向边（带箭头）：

- 线条：#9CA3AF（灰色），1.5px
- 箭头：实心三角形，6px 大小，指向目标节点边缘
- 标签：trigger 文字（12px，灰色，显示在边的中点上方 8px 处）
- 边从源节点边缘出发，到目标节点边缘结束（不穿透节点）

#### 布局算法

使用力导向布局（force-directed layout），纯前端计算，自行实现（约 80 行代码），不引入第三方布局库。

```typescript
interface GraphNode {
  id: string;        // baseline page id
  name: string;      // 页面名称
  features: number;  // 功能数量
  x: number;         // 计算后的 x 坐标
  y: number;         // 计算后的 y 坐标
}

interface GraphEdge {
  from: string;      // source page id
  to: string;        // target page id
  trigger: string;   // 触发条件
}
```

力导向参数（固定值，不可配置）：
- 斥力常数：500（节点间互斥，防止重叠）
- 引力常数：0.01（有连接的节点互相吸引）
- 阻尼系数：0.9（每次迭代速度衰减）
- 最大迭代次数：100
- 画布尺寸：根据节点数量自适应（最小 600×400，每增加 5 个节点宽高各增 200，最大 1600×1200）

**初始位置：** 节点按圆形均匀分布在画布中心周围，半径为 `min(canvasWidth, canvasHeight) * 0.3`。这样力导向算法有一个合理的起点，避免所有节点从同一点出发导致的震荡。

**节点数量上限：** 基线页面数量不设硬上限。力导向算法在 100 次迭代内对 50 个以下节点性能良好（<100ms）。超过 50 个节点时仍正常渲染，但布局可能不够美观（可接受，因为实际产品很少超过 50 个页面）。

#### 交互

- **缩放/平移：** 使用 LeaferJS 内置 viewport 能力（与标注画布一致）
- **Hover 节点：** 高亮该节点边框为蓝色（#3B82F6），同时高亮所有与该节点关联的边为蓝色
- **Click 节点：** 在画布下方固定区域显示该页面的功能描述（features 字段完整内容）
- **无拖拽编辑：** 节点位置由布局算法决定，不可手动调整

### 页面布局

基线概览页面使用 Tab 切换：

```
┌─ 基线概览 ──────────────────────────────────────────────┐
│                                                          │
│  [列表视图]  [导航图]                                     │
│  ─────────────────────────────────────────────────────── │
│                                                          │
│  Tab 1 - 列表视图（v0.1 已有）：                          │
│    页面功能表格 + 导航关系表格                             │
│                                                          │
│  Tab 2 - 导航图（v0.2 新增）：                            │
│    ┌──────────────────────────────────────────────────┐  │
│    │                                                  │  │
│    │    [登录页] ──登录成功──→ [首页]                   │  │
│    │       │                    │                     │  │
│    │    忘记密码              点击设置                  │  │
│    │       ▼                    ▼                     │  │
│    │  [忘记密码页]           [设置页]                   │  │
│    │                                                  │  │
│    └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ 页面详情（点击节点后显示）──────────────────────────┐  │
│  │  登录页：邮箱密码登录 + Google/GitHub 第三方登录      │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 数据来源

导航图的数据完全来自已有的基线 API：

```
GET /api/products/:id/baseline
```

返回的 `pages[]` 和 `navigation[]` 字段即为导航图的节点和边数据。不需要新增后端 API。

### 空状态

- 无页面时：显示"暂无基线数据，请通过 Agent 上传需求"
- 有页面但无导航关系时：只显示节点（按圆形布局），无边，提示"暂无页面间导航关系"
- 只有 1 个页面时：居中显示单个节点

---

## 新增错误码

| 错误码 | 触发位置 | 含义 |
|--------|----------|------|
| `SYNC_ALREADY_RUNNING` | POST /api/styles/sync | 已有同步任务在运行 |
| `SYNC_GIT_NOT_FOUND` | POST /api/styles/sync | Git CLI 未安装 |

注：`PENCIL_CLI_NOT_FOUND` 和 `PENCIL_NOT_AUTHENTICATED` 复用 v0.1 已有错误码。

---

## 文件变更清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `packages/core/src/sync.ts` | SyncService：同步流程核心逻辑 |
| `packages/core/tests/sync.test.ts` | 同步服务单元测试 |
| `packages/server/src/routes/sync.ts` | 同步 API 路由（POST + GET） |
| `packages/server/tests/sync.test.ts` | 同步 API 集成测试 |
| `packages/web/src/components/NavigationGraph.tsx` | 导航关系图组件 |
| `packages/web/src/components/NavigationGraph.test.tsx` | 导航图组件测试 |
| `packages/web/src/lib/force-layout.ts` | 力导向布局算法 |
| `packages/web/src/lib/force-layout.test.ts` | 布局算法测试 |

### 修改文件

| 文件 | 变更内容 |
|------|----------|
| `packages/core/src/store.ts` | 新增 `sync: SyncService` 到 FormaStore |
| `packages/core/src/index.ts` | 导出 SyncService |
| `packages/core/src/errors.ts` | 新增错误码 `SYNC_ALREADY_RUNNING`、`SYNC_GIT_NOT_FOUND` |
| `packages/server/src/routes.ts` | 注册 `/api/styles/sync` 和 `/api/styles/sync/status` 路由 |
| `packages/web/src/pages/StyleLibrary.tsx` | 添加同步按钮、进度显示、状态轮询 |
| `packages/web/src/pages/BaselineView.tsx` | 添加 Tab 切换 + 导航图视图 |
| `packages/web/src/api.ts` | 新增 `syncStyles()` 和 `getSyncStatus()` 方法 |

---

## SyncService 接口

```typescript
export class SyncService {
  constructor(private deps: {
    home: string;
    pencilService: PencilService;
    runner: CommandRunner;
  }) {}

  /** 启动同步任务，返回 task_id。如果已有任务运行则抛出 SYNC_ALREADY_RUNNING */
  async startSync(): Promise<{ task_id: string }>;

  /** 查询当前同步状态 */
  async getStatus(): Promise<SyncStatus>;

  /** Web Server 启动时调用，检测并恢复崩溃状态 */
  async recoverFromCrash(): Promise<void>;
}

export type SyncPhase =
  | "git_clone"
  | "scanning"
  | "extracting_variables"
  | "rendering_previews"
  | "updating_index"
  | "cleanup";

export interface SyncStatus {
  status: "idle" | "running" | "failed";
  task_id?: string;
  progress?: {
    phase: SyncPhase;
    current: number;
    total: number;
    current_style?: string;
  };
  last_sync?: {
    completed_at: string;
    styles_total: number;
    styles_updated: number;
    styles_added: number;
    styles_failed: number;
    duration_ms: number;
  };
  error?: {
    phase: SyncPhase;
    message: string;
  };
}
```

---

## 外部依赖

| 依赖 | 说明 | v0.1 已有 |
|------|------|-----------|
| Git CLI | 克隆 awesome-design-md 仓库 | 否（新增） |
| 网络连接 | 访问 GitHub | 否（新增） |
| Pencil CLI | 渲染预览模板（Agent Mode + export） | 是 |
| LeaferJS | 导航图渲染 | 是 |
| awesome-design-md 仓库 | 风格数据源，固定 URL：`https://github.com/VoltAgent/awesome-design-md.git` | 否（新增） |

---

## 测试策略

### 单元测试（不需要网络和 Pencil）

| 测试 | 覆盖内容 |
|------|----------|
| `scanStyles` | 正确识别含 DESIGN.md 的目录，跳过 `_` 和 `.` 开头的目录 |
| `extractVariablesFromDesignMd` | 各种格式的 DESIGN.md 正确提取变量，缺失字段使用默认值 |
| `updateStylesIndex` | 原子写入 styles.yaml，内容格式正确 |
| `startSync` 互斥 | 已有 running 任务时抛出 SYNC_ALREADY_RUNNING |
| `recoverFromCrash` | running 状态超过 10 分钟自动重置为 failed |
| 分类提取 | 关键词匹配正确分类 |
| 描述提取 | 正确取第一个非标题非空行 |
| 更新判断 | SHA-256 哈希变化正确识别为 updated |
| `forceLayout` | 节点不重叠，连接的节点距离更近，初始圆形分布 |
| `NavigationGraph` | 正确渲染节点和边，hover 高亮，空状态提示 |

### 集成测试（使用 fake runner）

| 测试 | 覆盖内容 |
|------|----------|
| POST /api/styles/sync | 正常启动返回 202 |
| POST /api/styles/sync（重复） | 返回 409 |
| GET /api/styles/sync/status | 各状态正确返回 |
| Pencil 不可用时 | 返回 503 |
| Git 不可用时 | 返回 503 |

### 端到端验证（手动）

1. 启动 `forma serve`
2. 打开风格资源库页面，点击"一键同步"
3. 观察进度更新，完成后验证新风格出现在列表中且预览图可显示
4. 打开基线概览页面，切换到"导航图" Tab
5. 验证节点和边正确渲染，hover/click 交互正常
6. 验证无基线数据时显示空状态提示

---

## 验证标准

- `pnpm test` 通过（含新增的同步和导航图相关测试）
- `pnpm build` 通过
- `POST /api/styles/sync` 返回 202 并启动异步任务
- `GET /api/styles/sync/status` 正确反映各阶段进度
- 同步完成后 `~/.forma/styles/styles.yaml` 的 `last_synced` 更新
- 同步完成后新风格的 DESIGN.md 和 preview@2x.png 存在于 `~/.forma/styles/{name}/`
- 重复触发同步返回 409
- Pencil/Git 不可用时返回 503
- 同步过程中 Agent 的 design/refine 操作不被永久阻塞
- 单个风格失败不中断整体同步
- 进程崩溃后重启能正确恢复状态
- 基线概览页面导航图正确展示页面节点和跳转关系
- 导航图支持缩放/平移/hover/click 交互
- 无基线数据时显示空状态提示
