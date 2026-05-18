# Forma 设计方案

> 产品设计稿生产和管理工具

## 背景

在产品开发过程中，设计稿的生成和管理存在以下痛点：

1. **设计稿与需求脱节** — 需求迭代后找不到对应的历史设计稿，无法追溯"当时设计的是什么"
2. **缺少统一的设计稿管理工具** — 设计稿散落在 Figma、本地文件、截图中，没有和需求绑定的结构化管理
3. **多平台设计风格不统一** — 移动端/网页端/桌面端各自为政，缺少统一的组件库和风格约束
4. **设计稿无法被 AI Agent 消费** — 开发时 AI 无法获取设计稿的结构化数据（尺寸、间距、颜色等），只能看截图猜
5. **设计稿标注信息查看不便** — 需要打开专业设计工具才能看标注，开发人员门槛高

**Forma 解决的核心场景：** 通过 AI Agent 驱动，从产品需求文档自动生成设计稿，并提供需求→设计稿的全链路管理、标注展示、和 MCP 数据服务，让设计稿成为产品开发流程中可追溯、可消费、可迭代的结构化资产。

## 目标

为移动端/网页端/平板端/桌面端产品开发提供：
1. 需求管理（上传、修改、归档、冲突检测）
2. 设计稿自动生成（从需求拆分页面原型并生成）
3. 设计稿局部精修（针对 UI 不满意的区域做增量调整）
4. 通用组件管理（统一风格的组件库）
5. 设计风格管理（内置 50+ 知名产品风格，可预览对比）
6. 设计稿标注展示（Web 后台可视化）
7. 产品基线维护（当前产品最新全貌）
8. MCP 数据服务（供外部 AI Agent 消费）

## 不做

- 不自建矢量设计引擎
- 不做实时协作编辑
- 不做代码生成（由下游 Agent 消费设计数据完成）
- 工具不生成需求
- 工具不修改需求（需求文档由用户在外部撰写，通过 Agent 上传）

## 要做

- 工具校验需求合理性（是否与历史需求产生冲突）
- 需求拆出页面原型
- 根据页面原型生成设计稿
- 设计稿局部精修
- 通用组件和设计风格管理
- 维护产品基线（所有已完成需求迭代后的产品当前状态）

## 核心原则：硬门禁必须 CLI 实现

**所有强制校验（硬门禁）必须在 CLI/MCP 代码层实现，绝不允许通过 prompt 指令做强门禁。**

理由：prompt 可以被跳过、忽略、改写，不具备强制性。只有代码级检查才能保证规则不可绕过。

适用范围：
- 产品配置完整性检查（`set_current_session` 内部）
- 需求状态校验（`submit_requirement` / `update_requirement` 内部）
- 页面归属校验（`save_designs` 内部）
- 节点存在性校验（`save_designs` refine 场景）
- 基线版本乐观锁（`save_designs` 内部）
- .pen 文件有效性验证（所有写入操作）

prompt 的职责仅限于：引导 AI 做分析、构造内容、交互确认。一切"必须满足才能继续"的条件，由 CLI 代码拦截。

## 核心原则：MCP Server 是唯一的 Pencil 执行者

Agent 不直接调用 Pencil CLI。所有 Pencil 操作（生成、精修、组件生成、导出）都通过 MCP tools 触发，由 MCP server 内部执行。

理由：
- MCP server 控制全局锁、临时目录、验证逻辑、原子写入
- Agent 直接调 Pencil 会绕过锁和校验
- 不同 Agent 平台（Claude/Codex/Gemini）的 shell 能力不一致，统一走 MCP 消除差异

## 两类决策的区分

| 类型 | 实现层 | 特征 | 示例 |
|------|--------|------|------|
| **硬门禁** | CLI/MCP 代码 | 确定性校验，不通过则 BLOCK | 状态检查、文件有效性、归属校验 |
| **AI 决策** | Agent prompt | 内容生成/分析决策，结果展示给用户 | 冲突检测、增量/全量选择、页面拆分、质量评估 |

AI 决策不是硬门禁——它们是 AI 的本职工作（分析、生成、判断），不需要也无法用代码穷举规则。硬门禁原则只约束"必须满足才能继续"的强制校验。

---

## 技术选型

| 层 | 选择 | 理由 |
|----|------|------|
| 设计引擎 | [Pencil](https://www.pencil.dev/)（.pen 格式） | MCP 工具链完整、JSON 格式可 Git 管理、免费、支持本地模型 |
| 后端 | Node.js + Fastify + TypeScript | 与 Pencil CLI（npm 包）生态一致 |
| 前端 | React + Vite + Tailwind CSS | 交互密集型标注场景，组件模型适合 |
| Canvas 渲染 | [LeaferJS](https://github.com/leaferjs/LeaferJS) | 高性能 Canvas 引擎，内置缩放/平移/事件系统，标注交互精确，中文文档好 |
| 需求管理 | 目录结构 + YAML | 轻量、Git 友好、无额外依赖 |
| 风格统一 | .lib.pen 组件库 + Pencil 变量 | Pencil 原生能力，变量类似 CSS custom properties |
| 风格资源 | [awesome-design-md](https://github.com/VoltAgent/awesome-design-md)（MIT 开源） | 50+ 知名产品设计风格，Markdown 格式 AI 可直接消费 |
| 会话状态 | `~/.forma/session.yaml` | 持久化，不依赖工作目录 |

---

## 数据模型

### ID 规范

| 实体 | 格式 | 示例 |
|------|------|------|
| 产品 | `P-{6位}` | `P-a3f8b2` |
| 需求 | `R-{8位}` | `R-c1d4e5f6` |
| 设计稿 | `D-{8位}` | `D-b2c1d4e5` |

### 实体关系

```
产品 (Product)
├── id: P-{6位}
├── name: string
├── description: string
├── platform: mobile | desktop | tablet | web  ← 单选，不同平台需求不同应建不同产品
├── style: { name, description, variables, design_md_path }
├── components_initialized: boolean
├── created_at: date
│
└── 需求 (Requirement)  ← 线性迭代链，同一时间只有一个活跃需求
    ├── id: R-{8位}
    ├── product_id: P-{6位}
    ├── title: string
    ├── status: empty | submitted | active | archived
    ├── document: markdown（用户上传）
    ├── created_at: date
    ├── updated_at: date
    │
    └── 页面 (Page)
        ├── page_id: string
        ├── name: string
        ├── design_status: pending | done | expired
        │
        └── 设计稿 (Design)
            ├── id: D-{8位}
            ├── page_id: string
            ├── platform: mobile | web | tablet | desktop
            ├── version: number
            ├── pen_file: path
            ├── preview: path（2x PNG）
            ├── created_at: date
            └── history: []
```

### 产品配置（product.yaml）

```yaml
id: P-a3f8b2
name: 商城 App
description: 移动端电商应用
created_at: 2026-05-17

# 以下为必填配置（硬门禁检查）
platform: mobile
style:
  name: linear                                    # 风格名称
  description: "极简、紫色调、高效工具风格"         # 风格描述
  design_md_path: styles/linear/DESIGN.md         # 原始 DESIGN.md 路径
  variables:
    primary: "#5E6AD2"
    secondary: "#6B7280"
    background: "#FFFFFF"
    surface: "#F9FAFB"
    text-primary: "#111827"
    text-secondary: "#6B7280"
    font-heading: "Inter"
    font-body: "Inter"
    border-radius: 8
    spacing-unit: 8
components_initialized: true
```

### 需求状态机

```
empty ──(upload-requirement)──→ submitted ──(design 全部完成)──→ active ──(归档)──→ archived
                                    │                              │
                              (update-requirement)           (update-requirement)
                                    │                              │
                                    ▼                              ▼
                               submitted                      submitted
                          (受影响页面 expired)            (受影响页面 expired)
```

| 状态 | 含义 | 可执行操作 |
|------|------|-----------|
| `empty` | 后台新建，无文档 | upload-requirement |
| `submitted` | 有文档和页面拆分，设计稿未全部完成 | design、update-requirement、refine（对 done 页面） |
| `active` | 所有页面设计稿已完成 | update-requirement、refine、后台归档 |
| `archived` | 已归档，不可修改 | 无 |

### 页面设计状态

| 状态 | 含义 | 触发 |
|------|------|------|
| `pending` | 需求已拆分出该页面，尚未生成设计稿 | upload-requirement / update-requirement 新增页面 |
| `done` | 设计稿已生成 | design / refine 成功 |
| `expired` | 需求修改后该页面内容有变化，设计稿过期 | update-requirement |

### page_id 命名规则

格式：`{需求id}-{页面名}`，如 `R-c1d4e5f6-login`、`R-c1d4e5f6-forgot-password`

- 需求 ID 前缀确保全局唯一（不同需求可能有同名页面如"首页"）
- 页面名部分：小写英文 + 连字符
- AI 页面拆分时在 prompt 中约束输出格式

### 基线页面关联

每个需求页面通过 `baseline_page` 字段关联到基线中的页面（纯页面名，不带前缀）：

```yaml
# requirement.yaml 中
pages:
  - page_id: R-c1d4e5f6-login       # 需求级 ID（全局唯一）
    name: 登录页
    baseline_page: login              # 关联到基线的哪个页面
    design_status: done
    design_id: D-b2c1d4e5

# baseline/pages.yaml 中
pages:
  - id: login                         # 基线页面 ID（纯页面名，产品内唯一）
    name: 登录页
    source_requirements: [R-c1d4e5f6, R-a1b2c3d4]
```

- 不同需求修改同一个页面时，`baseline_page` 指向同一个基线页面 ID
- AI 页面拆分时，如果识别到是修改已有页面（基线中已存在），使用已有的 baseline_page 名称
- 新页面则创建新的 baseline_page 名称

### 后台操作约束

| 操作 | 条件 | 不满足时 |
|------|------|----------|
| 新建需求 | 产品下无需求 **或** 最后一个需求状态为 `archived` | 按钮置灰不可点击 |
| 归档需求 | 需求状态为 `active`（所有页面 done） | 按钮置灰不可点击 |

---

## 设计风格系统

### 风格资源来源

项目**内置** [awesome-design-md](https://github.com/VoltAgent/awesome-design-md)（MIT 协议）的全部设计风格数据，无需网络即可使用。后台"一键同步"功能仅用于更新到最新版本（需要网络），不影响已有风格的正常使用。

### 风格预览机制

使用一套固定的**预览组件集**，在不同设计风格下渲染出不同样式，让用户直观对比。

预览组件集（固定不变）：
- 按钮（主要/次要/文字）
- 输入框
- 卡片
- 导航栏
- 列表项
- 标签/徽章

每个风格的预览 = 这套组件用该风格变量渲染后的 2x 截图。

### 风格预览生成

```
一键同步时自动生成：
1. 拉取 awesome-design-md 最新数据
2. 对每个风格：
   a. [AI] 从 DESIGN.md 提取变量
   b. Pencil CLI: 用变量渲染 _preview-template.pen → 导出 preview@2x.png
3. 更新 styles.yaml 索引
```

### 风格存储结构

```
styles/
├── _preview-template.pen          # 预览模板（固定组件布局）
├── styles.yaml                    # 风格索引（名称、分类、描述、预览图路径）
├── claude/
│   ├── DESIGN.md                  # 风格定义（原始 Markdown）
│   └── preview@2x.png            # 预览图（自动生成）
├── linear/
│   ├── DESIGN.md
│   └── preview@2x.png
├── airbnb/
│   ├── DESIGN.md
│   └── preview@2x.png
└── ...
```

### styles.yaml 示例

```yaml
last_synced: 2026-05-17
styles:
  - name: claude
    category: AI 产品
    description: "暖色调、简洁编辑布局"
    preview: styles/claude/preview@2x.png
  - name: linear
    category: 工具类
    description: "极简、紫色调、高效"
    preview: styles/linear/preview@2x.png
  - name: airbnb
    category: 电商
    description: "圆润、温暖、粉红调"
    preview: styles/airbnb/preview@2x.png
```

### 风格在设计稿生成中的使用

每次调用 Pencil CLI 生成设计稿时，将产品的 DESIGN.md 内容作为 prompt context 附加：

```bash
pencil --out design.pen \
  --prompt "[DESIGN SYSTEM]\n$(cat styles/linear/DESIGN.md)\n\n[TASK]\n创建登录页..." \
  --workspace ./library
```

确保 AI 生成的设计稿始终符合选定风格。

---

## Pencil 高质量生成策略

### Pencil 内置能力利用

Pencil 提供了三层内置能力，Forma 应充分利用以提升设计稿质量：

| 能力 | MCP Tool | 用途 |
|------|----------|------|
| **Guides（指南）** | `get_guidelines({ category: "guide" })` | 按场景提供设计规范（Mobile App、Web App、Landing Page、Design System 等） |
| **Styles（视觉风格）** | `get_guidelines({ category: "style" })` | 26 种内置视觉风格模板，含颜色、圆角、阴影、字体配置 |
| **Design System（组件系统）** | `get_guidelines({ category: "guide", name: "Design System" })` | 组件组合模式（Sidebar、Card、Table、Form 等） |

### 生成流程中的 Pencil 能力调用顺序

```
Agent 构造 Pencil prompt 时：

1. 加载平台指南
   → get_guidelines({ category: "guide", name: "Mobile App" })  // 或 Web App
   → 获得布局规范、间距规则、组件层级

2. 加载组件组合指南
   → get_guidelines({ category: "guide", name: "Design System" })
   → 获得 Slot 使用方式、组件组合模式

3. 读取产品风格 DESIGN.md
   → ~/.forma/styles/{name}/DESIGN.md
   → 获得品牌颜色、字体、调性

4. 组合为完整 prompt：
   [PLATFORM GUIDE] + [DESIGN SYSTEM GUIDE] + [DESIGN.md] + [TASK]
```

### Pencil 内置 Guides 与 Forma 平台的映射

| Forma 产品平台 | Pencil Guide | 关键规范 |
|---------------|-------------|----------|
| 移动端 | "Mobile App" | 状态栏 62px、底部导航栏、单列垂直布局、触摸目标尺寸 |
| 网页端 | "Web App" | 响应式、信息层级、渐进式披露、密度控制 |
| 桌面端 | "Web App" | 同网页端，密度可更高 |
| 平板端 | "Mobile App" + 平板适配 | 分栏布局、侧边栏可折叠 |

### Pencil 内置 Styles 的使用策略

**Pencil Styles 不暴露给用户，当前版本不使用。**

理由：awesome-design-md 已经提供了完整的品牌视觉系统（颜色、字体、间距、调性），与 Pencil Styles 的颜色/字体定义会冲突。两者二选一，Forma 选择 awesome-design-md 作为唯一风格源。

**Pencil Guides 始终使用。** Guides 提供的是平台设计规范（布局结构、间距规则、组件层级），不涉及品牌调性，与 awesome-design-md 不冲突。

**最终 prompt 组合：**
```
prompt = [Pencil Guide（平台规范）] + [awesome-design-md DESIGN.md（品牌风格）] + [任务描述]
```

不包含 Pencil Style。

### 组件库与 Pencil Design System Guide 的配合

Pencil 的 Design System Guide 定义了组件组合模式（如何用 Slot 填充 Sidebar、Card、Table）。Forma 的通用组件库（`.lib.pen`）应遵循这些模式：

- 组件使用 `reusable: true` 标记
- 可定制区域使用 Slot（`placeholder: true` + `slot` 数组）
- 组件内使用变量引用（`$--primary`、`$--font-primary`）而非硬编码值
- 组件命名遵循 Pencil 约定（如 `Button/Primary`、`Input/Default`）

### batch_design 操作质量规则

| 规则 | 说明 |
|------|------|
| 每次 batch ≤ 12 ops | 超过容易 rollback |
| 回滚两次降到 ≤ 6 ops | micro-batch 降级 |
| 先结构后内容 | 第一个 batch 建立布局骨架，后续 batch 填充内容 |
| 每个 batch 后 get_screenshot 验证 | 确认视觉效果符合预期 |
| 使用 $-- 变量引用 | 不硬编码颜色/字体，确保风格一致 |
| 优先使用组件库 ref | 而非从零创建 frame |

### 生成质量保障流程

```
design 命令内部：

1. 构造 prompt（含 Pencil Guide + DESIGN.md + 任务）
2. Pencil CLI Agent Mode 生成
3. 验证 .pen 文件有效性（JSON + 非空 + 无截断）
4. 用 pencil interactive + get_screenshot 截图检查
5. [AI] 评估截图质量（布局合理性、风格一致性）
   ├─ 质量通过 → 导出 2x PNG → 保存
   └─ 质量不通过 → 自动 refine 一次（最多重试 1 次）
       └─ 仍不通过 → 保存当前版本，提示用户可 refine 调整
```

---

## 产品配置硬门禁

### Pencil CLI 数据保存方案

#### Pencil MCP 已知坑（来自 [da-vinci v1.5.0](https://github.com/xenonbyte/da-vinci/tree/v1.5.0) 实践）

| 坑 | 说明 | 对策 |
|----|------|------|
| `save()` 不可靠 | headless interactive 的 `save()` 不能作为落盘确认 | 生成后用 `batch_get` 重新验证文件完整性 |
| batch_design rollback | batch 中一个操作失败，整个 batch 回滚 | 保持 batch ≤ 12 ops；回滚两次降级到 ≤ 6 ops |
| 节点树截断 | `batch_get` 深度不够时返回 `"..."` | 检测截断标记，用更深 readDepth 重读 |
| 全局锁 | 多进程同时写 Pencil 会冲突 | Forma MCP server 内部加全局锁 |
| Agent Mode `--out` | 相对可靠（Pencil 内部完整流程），但仍需验证 | 生成后验证 .pen 文件有效性 |

#### Pencil CLI 文件 I/O 机制

| 模式 | 保存方式 | 适用场景 |
|------|----------|----------|
| Agent Mode | `--in` 读入 + `--out` 写出，执行完自动保存 | 一次性生成/修改（主要方式） |
| Interactive Mode (Headless) | `--in` 读入 + `--out` 指定路径，手动 `save()` | 多步骤精细操作（备选） |
| Interactive Mode (App) | 连接运行中的 Pencil 桌面应用，实时修改 | 开发调试 |

#### 核心原则：先临时后正式 + 验证

所有 Pencil CLI 操作先写入临时目录，**验证通过后**再原子移动到正式目录。

```
Pencil CLI → /tmp/forma-{uuid}/
                │
                ▼
           验证阶段（硬门禁，CLI 代码实现）：
             1. .pen 文件存在且 JSON 可解析
             2. 节点树非空（children.length > 0）
             3. 无截断标记（递归检测 "..."）
             4. PNG 文件存在且大小 > 0
             5. 可选：用 pencil interactive + batch_get 重新打开验证
                │
                ├─ 失败 → 清理临时目录，返回错误码，释放锁
                └─ 通过 → mv 到正式目录 → 更新元数据 → 释放锁
```

#### 全局锁

```
~/.forma/pencil.lock
```

防止并发 Pencil CLI 调用冲突。MCP server 在**调用 Pencil CLI 之前**获取锁，整个操作完成（含验证和 mv）后释放。锁超时 5 分钟自动释放（防死锁）。

完整流程：Pencil 可用性检查 → 获取锁 → 调用 Pencil CLI → 验证 → mv 到正式目录 → 释放锁。

#### Pencil 可用性硬门禁

所有调用 Pencil 的 MCP tools（`generate_page_design`、`generate_components`）在执行前必须通过 Pencil 可用性检查：

| 检查项 | 说明 | 失败错误码 |
|--------|------|-----------|
| Pencil CLI 已安装 | `pencil version` 可执行 | `PENCIL_CLI_NOT_FOUND` |
| Pencil 已认证 | `pencil status` 返回已登录状态 | `PENCIL_NOT_AUTHENTICATED` |

**Pencil CLI 可 headless 运行，不需要 Pencil 桌面应用。** Agent Mode 和 Interactive Mode 都内置编辑器引擎，无需 GUI。

**不提供降级路径。** Pencil 不可用时用户必须先解决（安装 CLI、登录认证），所有依赖 Pencil 的命令会 BLOCK 直到问题解决。

**检查时机：** 在以下命令执行时检查（这些命令需要调用 Pencil）：
- `fm-list-product`（仅当触发通用组件生成时）
- `fm-design`
- `fm-refine-design`
- `fm-refine-components`
- `fm-change-style`
- `fm-rollback-design`（重新导出 PNG 需要 Pencil）

**失败处理：**
```
Agent 调用 MCP.generate_page_design(...)
  ← 失败: PENCIL_CLI_NOT_FOUND

Agent: "Pencil CLI 未安装。请执行 npm install -g @pencil.dev/cli 安装后重试。"
```

```
Agent 调用 MCP.generate_page_design(...)
  ← 失败: PENCIL_NOT_AUTHENTICATED

Agent: "Pencil 未登录。请执行 pencil login 完成认证后重试。"
```

```typescript
// 锁结构
{
  "pid": 12345,
  "acquired_at": "2026-05-17T12:00:00Z",
  "operation": "design",
  "product_id": "P-a3f8b2"
}
```

#### 各场景的 CLI 调用方式

**全新页面生成（design 命令，pending 页面）：**

```bash
# 获取全局锁
pencil --out /tmp/forma-{uuid}/design.pen \
  --workspace /tmp/forma-{uuid}/workspace \
  --prompt "[DESIGN SYSTEM]\n...\n[TASK]\n创建登录页..."

# 导出截图
pencil --in /tmp/forma-{uuid}/design.pen \
  --export /tmp/forma-{uuid}/preview@2x.png \
  --export-scale 2

# 验证 → mv 到正式目录 → 释放锁
```

**过期页面增量更新（design 命令，expired 页面）：**

```bash
pencil --in ~/.forma/data/P-xxx/R-xxx/D-xxx/design.pen \
  --out /tmp/forma-{uuid}/design.pen \
  --workspace /tmp/forma-{uuid}/workspace \
  --prompt "在登录页添加验证码登录选项"
```

**局部精修（refine 命令）：**

```bash
pencil --in ~/.forma/data/P-xxx/R-xxx/D-xxx/design.pen \
  --out /tmp/forma-{uuid}/design.pen \
  --workspace /tmp/forma-{uuid}/workspace \
  --prompt "修改节点 frame-social-buttons 为横排布局"
```

**通用组件生成（初始化 / change-style）：**

```bash
pencil --out /tmp/forma-{uuid}/components.lib.pen \
  --prompt "根据以下设计系统生成移动端通用组件：\n[DESIGN.md 内容]"
# 验证通过后 mv 到 ~/.forma/library/{product_id}.lib.pen
```

#### 组件库引用（--workspace）

每次生成设计稿前，将当前产品的 `.lib.pen` 复制到临时 workspace 目录，确保 Pencil 只看到当前产品的组件：

```bash
mkdir -p /tmp/forma-{uuid}/workspace
cp ~/.forma/library/P-xxx.lib.pen /tmp/forma-{uuid}/workspace/
pencil --out /tmp/forma-{uuid}/design.pen --workspace /tmp/forma-{uuid}/workspace --prompt "..."
```

#### 验证逻辑（MCP save_designs 内部）

```typescript
function validatePenFile(filePath: string): boolean {
  const content = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(content);
  if (!json.children || json.children.length === 0) return false;
  if (hasTruncatedChildren(json.children)) return false;  // 递归检测 "..."
  return true;
}

function hasTruncatedChildren(value: any): boolean {
  if (value === "...") return true;
  if (Array.isArray(value)) return value.some(hasTruncatedChildren);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(hasTruncatedChildren);
  }
  return false;
}
```

#### Interactive Mode 备选方案

对于需要多步骤精细操作的场景（如 refine 需要先查询节点再修改），可用 Interactive Mode。注意 batch 大小限制：

```bash
pencil interactive -i design.pen -o /tmp/forma-xxx/design.pen

> batch_get({ nodeIds: ["frame-social-buttons"], readDepth: 3 })  # 查看节点（注意深度）
> batch_design({ input: '...' })   # ≤ 12 ops，回滚两次降到 ≤ 6 ops
> save()                            # 不作为最终确认，仍需验证
> exit()
```

**重要：** 即使 interactive mode 的 `save()` 返回成功，仍需用验证逻辑确认文件有效。

---

### 检查时机

`list-product` → 用户选择产品 → `MCP.set_current_session` → **CLI 硬门禁检查**

### 硬门禁逻辑（MCP 代码级强制，非 prompt）

```typescript
function setCurrentSession(productId) {
  const product = readProductYaml(productId);

  const missing = [];
  if (!product.platform) missing.push("platform");
  if (!product.style) missing.push("style");
  if (!product.components_initialized) missing.push("components");

  if (missing.length > 0) {
    return {
      success: false,
      error: "PRODUCT_CONFIG_INCOMPLETE",
      missing: missing
    };
  }

  writeSession({ current_product: productId });
  return { success: true };
}
```

### 配置补全流程

Agent 收到 `PRODUCT_CONFIG_INCOMPLETE` 后逐项交互补全（**缺什么补什么**）：

```
Agent: MCP.set_current_session("P-a3f8b2")
       ← 失败: PRODUCT_CONFIG_INCOMPLETE, missing: ["platform", "components"]
       （style 已在后台新建时选择，不缺）

[缺 platform]
Agent: "请选择产品类型：1.移动端 2.桌面端 3.平板端 4.网页端"
用户: 1

[缺 components]
Agent: [AI] 根据 platform + style 生成通用组件
       → Pencil CLI 生成 library/{product_id}.lib.pen
Agent: MCP.complete_product_init(product_id)
       → components_initialized = true

[重试]
Agent: MCP.set_current_session("P-a3f8b2")
       ← 成功 ✓
```

如果后台新建时**暂不选择**风格，则 Agent 侧还需补全 style：

```
[缺 style]
Agent: 读取 product.yaml 中的 description
       [AI] 根据产品描述从风格库中推荐 3 个最匹配的风格

Agent: "根据产品描述，为您推荐以下设计风格："

  1. linear - 极简高效，适合工具类产品（推荐理由：产品描述中提到效率和专业）
  2. notion - 内容优先，黑白简洁（推荐理由：产品偏向信息管理）
  3. airbnb - 圆润温暖，用户友好（推荐理由：面向 C 端用户）
  4. 手动选择（查看全部风格列表）

请输入编号：

[用户选 1-3] → 直接使用推荐风格
[用户选 4] → 展示完整风格列表：

     AI 产品
       1. claude - 暖色调、简洁编辑布局
       2. cohere - 企业级 AI 平台
       3. cursor - 深色极客风
     工具类
       4. linear - 极简、紫色调、高效
       5. notion - 黑白为主、内容优先
     ...

     请输入编号或名称：

Agent: [AI] 从 styles/{name}/DESIGN.md 提取变量
       → MCP.init_product_config(product_id, { style })
```

---

## 通用组件

### 按平台的默认组件清单

| 平台 | 通用组件 |
|------|----------|
| 移动端 | 标题栏（含返回按钮）、底部导航栏、状态栏、Toast、弹窗、加载态、空状态 |
| 桌面端 | 顶部导航栏、侧边栏、面包屑、弹窗、表格、分页 |
| 平板端 | 标题栏、侧边栏（可折叠）、分栏布局、弹窗 |
| 网页端 | Header、Footer、导航栏、面包屑、弹窗、卡片 |

### 组件使用规则

- 通用组件不是每个页面都强制使用（如沉浸式顶部图片页面不用标题栏）
- 设计稿生成时 AI 根据页面内容判断是否引用通用组件
- 组件存储在 `~/.forma/library/{product_id}.lib.pen`
- 组件风格由产品的 style 决定

### 组件生成时机

- 产品配置初始化时（首次 list-product 触发）
- `change-style` 重新选择风格后（自动重新生成）

---

## 产品基线（Baseline）

### 定义

产品基线 = 产品当前的**功能形态**（页面清单 + 功能描述 + 交互关系），不是设计稿。

回答："产品现在有哪些页面？每个页面有什么功能？页面间怎么跳转？"

### 基线包含

| 数据 | 说明 |
|------|------|
| 功能点（features） | 每个页面有什么功能 |
| 交互/导航（interactions + navigation） | 页面内交互 + 页面间跳转关系 |
| 文案（copy） | 关键文案（标题、按钮、提示语等） |
| 数据字段（fields） | 页面展示/输入的数据字段 |
| 需求溯源（source_requirements） | 每个页面由哪些需求叠加而成 |

### 基线不包含

- ❌ .pen 设计稿文件（设计稿在需求目录下）
- ❌ PNG 截图（截图在设计稿目录下）
- ❌ 视觉风格信息（风格在 product.yaml 中）

### 基线更新时机

- `upload-requirement` 成功时更新基线（新增页面 + 导航）
- `update-requirement` 成功时更新基线（页面变更 + 导航变更）
- `design` / `refine` / `change-style` **不更新基线**（它们只影响设计稿视觉，不影响功能形态）

### baseline.yaml 示例

```yaml
version: 5
updated_at: 2026-05-18
pages:
  - id: login
    name: 登录页
    features: "邮箱密码登录 + Google/GitHub 第三方登录 + 验证码登录"
    interactions: "登录成功→跳转首页；点击忘记密码→跳转忘记密码页"
    copy: "标题：欢迎回来；按钮：登录；链接：忘记密码？；分隔：或使用以下方式登录"
    fields: "邮箱输入框、密码输入框、验证码输入框（切换后显示）"
    source_requirements: [R-c1d4e5f6, R-a1b2c3d4]
  - id: home
    name: 首页
    features: "商品推荐列表 + 搜索 + 分类导航 + 购物车入口"
    interactions: "点击商品→商品详情页；点击搜索→搜索结果页；点击分类→分类列表页"
    copy: "标题：推荐好物；搜索框：搜索商品；Tab：推荐/新品/热销"
    fields: "搜索输入框、商品卡片（图片+标题+价格）、分类 Tab"
    source_requirements: [R-e5f6a7b8]
  - id: settings
    name: 设置页
    features: "个人信息编辑 + 通知设置 + 退出登录"
    interactions: "点击个人信息→编辑页；点击退出→确认弹窗→返回登录页"
    copy: "标题：设置；按钮：退出登录；开关：推送通知"
    fields: "头像、昵称、手机号、通知开关"
    source_requirements: [R-e5f6a7b8, R-a1b2c3d4]
navigation:
  - from: login
    to: home
    trigger: "登录成功"
  - from: home
    to: settings
    trigger: "点击设置图标"
```

---

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                         forma                               │
├──────────────┬───────────────┬──────────────┬───────────────┤
│  Agent 技能  │  Web 后台     │  MCP Server  │  核心模块     │
│  (AI 逻辑)  │  (展示+管理)  │  (独立进程)  │  (数据处理)   │
│             │               │              │               │
└──────┬───────┴───────┬───────┴──────┬───────┴───────┬───────┘
       │               │              │               │
  Pencil CLI       LeaferJS       MCP stdio       ~/.forma/data/
  (设计稿生成)    (Canvas 标注)   (Agent 连接)     (数据存储)
```

### 进程模型

| 进程 | 启动方式 | 职责 |
|------|----------|------|
| MCP Server | `forma mcp`（独立进程，stdio 模式） | 供 Agent 调用所有 MCP tools |
| Web Server | `forma serve`（独立进程） | 提供后台管理 HTTP API + 前端静态资源 |

### CLI 命令

| 命令 | 功能 |
|------|------|
| `forma mcp` | 启动 MCP Server（stdio 模式） |
| `forma serve` | 前台启动 Web 后台服务（Ctrl+C 停止） |
| `forma serve start` | 后台启动 Web 后台服务（PID: `~/.forma/serve.pid`，日志: `~/.forma/serve.log`） |
| `forma serve stop` | 停止后台 Web 服务 |
| `forma install --platform claude,codex,gemini` | 安装 Agent 命令 + MCP 配置到各平台 |
| `forma uninstall --platform claude,codex,gemini` | 卸载 Agent 命令 + MCP 配置 |
| `forma status` | 查看安装状态（已安装平台、数据目录、Pencil CLI 可用性、认证状态、Web 服务运行状态） |
| `forma version` | 显示版本号 |

两个进程独立运行，不启动 Web 服务也可以正常在 Agent 里使用所有命令。共享同一份 `~/.forma/data/` 数据目录。

### MCP Server 连接方式

Agent 平台通过 stdio 连接 MCP server。安装时自动写入 Agent 的 MCP 配置：

**Claude（`~/.claude/mcp.json`）：**
```json
{
  "forma": {
    "command": "forma",
    "args": ["mcp"]
  }
}
```

**Gemini（`~/.gemini/settings.json` 中 mcpServers）：**
```json
{
  "forma": {
    "command": "forma",
    "args": ["mcp"]
  }
}
```

安装命令 `forma install --platform claude` 会自动注入上述配置；卸载时自动移除。

### 职责划分

| 操作 | 入口 | 理由 |
|------|------|------|
| 新建产品（含可选风格选择） | Web 后台 ✅ | 元数据 + 风格预览选择 |
| 新建需求（空） | Web 后台 ✅ | 只创建 ID 和标题 |
| 归档需求 | Web 后台 ✅ | 状态变更 |
| 风格资源同步 | Web 后台 ✅ | 一键同步按钮 |
| 风格预览浏览 | Web 后台 ✅ | 只读展示 |
| 产品配置初始化 | **Agent only**（硬门禁触发） | 涉及 AI 生成组件 |
| 上传/修改需求 | **Agent only** | 涉及 AI 冲突检测、页面拆分 |
| 生成设计稿 | **Agent only** | 涉及 AI 构造 prompt + Pencil CLI |
| 精修设计稿 | **Agent only** | 涉及 AI 定位节点 + 增量 prompt |
| 调整组件 | **Agent only** | 涉及 AI + Pencil CLI |
| 更换设计风格 | **Agent only** | 涉及 AI 重新生成组件 |
| 查看产品/需求/设计稿/基线 | Web 后台 ✅ | 只读展示 |
| 获取基线数据 | MCP ✅ | 供外部 Agent 消费 |

---

## Agent 技能

### 会话状态

持久化到 `~/.forma/session.yaml`（固定位置，不依赖工作目录）：

```yaml
current_product: P-a3f8b2    # 只存产品，不存需求
```

每个命令执行时动态获取：`最新需求 = 该产品下最后一个需求`（按创建时间排序的最后一个）。

### 命令清单

| 命令 | 功能 | 前置条件 | 需要确认 |
|------|------|----------|----------|
| `fm-list-product` | 展示所有产品，用户选择后切换（触发配置硬门禁检查） | 无 | 否 |
| `fm-status` | 展示当前产品 ID/名称、最新需求 ID/标题/状态、页面列表及设计状态 | 无 | 否 |
| `fm-upload-requirement` | 上传需求文档 + 冲突检测 + 页面拆分 | session 已设置 + 需求 empty | 是 |
| `fm-update-requirement` | 修改需求文档 + 冲突检测 + 标记过期页面 | session 已设置 + 需求 submitted/active | 是 |
| `fm-design` | 生成/更新所有 pending/expired 页面设计稿 | session 已设置 + 存在 pending/expired 页面 | 是 |
| `fm-refine-design` | 对某页面设计稿做局部 UI 精修 | session 已设置 + 页面 done + 属于当前需求 | 是 |
| `fm-refine-components` | 微调通用组件（只影响后续生成） | session 已设置 + 组件已初始化 | 是 |
| `fm-change-style` | 重新选择设计风格 + 重新生成通用组件（只影响后续生成） | session 已设置 | 是 |
| `fm-rollback-design` | 回退某页面设计稿到上一个版本 | session 已设置 + 页面 done + 版本 > 1 | 是 |

### 需求文档输入方式

用户执行 `upload-requirement` / `update-requirement` 时，通过**指定文件路径**传入需求文档：

```
用户: /fm-upload-requirement --file ./docs/login-requirement.md
```

Agent 读取该文件内容作为需求文档。文件必须是 Markdown 格式。

### rollback 命令

回退某页面设计稿到上一个版本（从 design.yaml history 中恢复）。

```
用户: /fm-rollback-design 登录页

Agent:
  1. 校验：页面属于当前需求（硬门禁）
  2. 校验：页面状态为 done（硬门禁）
  3. 校验：版本 > 1（硬门禁，版本 1 无法回退）
  4. 展示当前版本和上一版本信息
  5. 确认交互
  6. MCP.rollback_design(design_id)
     → 恢复上一版本的 .pen 文件
     → 重新导出 2x PNG
     → 更新 design.yaml（版本号 -1，history 移除最后一条）
```

**硬门禁（MCP `rollback_design` 内部）：**
- design_id 存在
- 页面属于当前需求
- 版本 > 1
- 上一版本的 .pen 文件存在（历史文件保留）

**历史文件保留策略：** 每次 design/refine 成功时，旧版本 .pen 文件重命名为 `design.v{N}.pen` 保留在同目录下，供 rollback 使用。

### 确认交互

所有写操作执行前展示确认：

```
当前操作上下文：
  产品：商城 App (P-a3f8b2)
  需求：用户登录功能 (R-c1d4e5f6)
  操作：[具体操作描述]

确认执行？(y/n)
```

### change-style 执行流程

```
用户: change-style

Agent:
  1. 展示当前风格："当前风格：linear"
  2. 读取产品描述，[AI] 推荐 3 个风格：

     "根据产品描述，为您推荐以下设计风格："
       1. airbnb - 圆润温暖（推荐理由：...）
       2. shopify - 绿色商务（推荐理由：...）
       3. figma - 多彩活泼（推荐理由：...）
       4. 手动选择（查看全部风格列表）

     请输入编号：

  3. 用户选择新风格（选 4 则展开完整列表）
  4. 确认交互：
     ┌──────────────────────────────────────────┐
     │ 产品：商城 App (P-a3f8b2)                │
     │ 当前风格：linear → 新风格：airbnb         │
     │                                          │
     │ ⚠️ 通用组件将重新生成                     │
     │ ⚠️ 只影响后续新生成的设计稿               │
     │                                          │
     │ 确认？(y/n)                              │
     └──────────────────────────────────────────┘
  5. 用户确认
  6. 读取 styles/{name}/DESIGN.md
  7. [AI] 提取变量 → 更新 product.yaml style
  8. 重新生成通用组件 → 覆盖 library/{product_id}.lib.pen
  9. 完成
```

### change-style vs refine-components

| | change-style | refine-components |
|---|---|---|
| 做什么 | 整体更换设计风格 | 微调某个组件 |
| 组件影响 | **全部重新生成** | 只改指定组件 |
| 风格变量 | 全部替换 | 可能改某个变量 |
| 触发条件 | 想换整体风格 | 对某个组件不满意 |
| 对已有设计稿 | 不影响 | 不影响 |

### 命令强门禁（CLI 代码级，非 prompt）

所有门禁在 MCP server 内部实现，Agent 调用 MCP tool 时由代码强制检查，不通过则返回错误码。

| 命令 | 门禁 1 | 门禁 2 | 门禁 3 | 门禁 4 | 门禁 5 |
|------|--------|--------|--------|--------|--------|
| `fm-list-product` | — | — | — | 选择后：产品配置完整性检查 | 触发组件生成时：Pencil 可用性检查 |
| `fm-status` | 已选产品 | 最新需求已归档→提示（非 BLOCK，只读查询） | — | — | — |
| `fm-upload-requirement` | 已选产品 | 最新需求状态 ≠ empty→BLOCK | — | — | — |
| `fm-update-requirement` | 已选产品 | 最新需求状态 = empty→BLOCK | 最新需求已归档→BLOCK | — | — |
| `fm-design` | 已选产品 | 最新需求已归档→BLOCK | 无 pending/expired 页面→BLOCK | Pencil 可用性检查 | — |
| `fm-refine-design` | 已选产品 | 最新需求已归档→BLOCK | 目标设计稿存在 | 目标页面状态 = done | Pencil 可用性检查 |
| `fm-refine-components` | 已选产品 | 组件已初始化 | Pencil 可用性检查 | — | — |
| `fm-change-style` | 已选产品 | Pencil 可用性检查 | — | — | — |
| `fm-rollback-design` | 已选产品 | 最新需求已归档→BLOCK | 目标设计稿存在 + 页面状态 = done | 版本 > 1 + 历史文件存在 | Pencil 可用性检查（重新导出 PNG） |

**"已选产品"** = `~/.forma/session.yaml` 中 `current_product` 存在且对应产品存在。

**"最新需求"** = 该产品下按创建时间排序的最后一个需求。

### 错误场景（门禁触发时的报错信息）

| 操作 | 条件 | 报错 |
|------|------|------|
| 所有命令（除 list-product） | 未选择产品 | "请先执行 fm-list-product 选择产品" |
| `fm-status` | 最新需求已归档 | "当前产品所有需求已归档，请到后台新建需求" |
| `fm-upload-requirement` | 最新需求非 empty | "当前需求已上传文档，请使用 fm-update-requirement" |
| `fm-update-requirement` | 最新需求为 empty | "当前需求尚未上传文档，请使用 fm-upload-requirement" |
| `fm-update-requirement` | 最新需求已归档 | "当前需求已归档，不可修改" |
| `fm-design` | 最新需求已归档 | "当前需求已归档，不可操作" |
| `fm-design` | 无 pending/expired 页面 | "所有页面设计稿已是最新" |
| `fm-refine-design` | 最新需求已归档 | "当前需求已归档，不可操作" |
| `fm-refine-design` | 目标设计稿不存在 | "设计稿不存在" |
| `fm-refine-design` | 目标页面状态非 done | "页面尚未生成设计稿，请先执行 fm-design" |
| `fm-refine-design` | 指定节点不存在 | "节点 {node_id} 不存在于该设计稿中" |
| `fm-refine-components` | 组件未初始化 | "产品组件尚未初始化" |
| `fm-rollback-design` | 最新需求已归档 | "当前需求已归档，不可操作" |
| `fm-rollback-design` | 目标设计稿不存在 | "设计稿不存在" |
| `fm-rollback-design` | 版本为 1 | "当前为初始版本，无法回退" |
| `fm-rollback-design` | 历史文件不存在 | "历史版本文件丢失，无法回退" |

### list-product 行为

```
1. MCP.list_products() → 展示产品列表
2. 用户选择产品
3. MCP.set_current_session(product_id)
   ├─ 失败 PRODUCT_CONFIG_INCOMPLETE → 逐项交互补全 → 重试
   └─ 成功 → 获取最新需求状态并展示
4. 根据最新需求状态提示：
   - 无需求 → "当前产品无需求，请到后台新建需求"
   - empty → "当前需求待上传文档，请使用 fm-upload-requirement"
   - submitted → "当前需求有待生成的页面，请使用 fm-design"
   - active → "当前需求已完成，可使用 fm-refine-design 精修或到后台归档"
   - archived（最新需求已归档） → "所有需求已归档，请到后台新建需求"
```

---

## Agent 命令执行流程

### upload-requirement

```
1. 确认交互（产品 + 需求 + 操作）
2. MCP.get_product_baseline(product_id)         → 获取当前基线
3. MCP.get_requirement_history(product_id)       → 获取历史需求
4. [AI] 冲突检测（基线 + 历史 vs 新文档）        → 展示冲突分析给用户，用户确认后继续（非硬门禁，AI 建议）
5. [AI] 页面拆分（从文档中识别涉及的页面）        → page_id + name + 描述
6. [AI] 导航关系提取（页面间跳转关系）            → navigation[]
7. MCP.submit_requirement(product_id, req_id,
     title, document_md, pages[], navigation[]) → 写入文档 + 页面清单 + 导航 + 更新基线（状态 pending）
```

### update-requirement

```
1. 确认交互（产品 + 需求 + 操作）
2. MCP.get_product_baseline(product_id)         → 获取当前基线
3. MCP.get_requirement_history(product_id)       → 获取历史需求
4. MCP.get_requirement(req_id)                   → 获取当前需求页面清单
5. [AI] 冲突检测（基线 + 历史需求 vs 修改后文档）→ 展示冲突分析给用户，用户确认后继续
6. [AI] 重新页面拆分 + 对比旧页面清单，确定哪些页面有变化
7. MCP.update_requirement(req_id, document_md,
     pages[], expired_pages[])                  → 更新文档 + 标记过期页面 + 更新基线
   （新数据成功写入后才替换旧数据，原子性保证）
```

### design

```
1. 确认交互（产品 + 需求 + 待处理页面列表）
2. MCP.get_requirement(req_id)                   → 获取页面清单和状态
3. 筛选 pending / expired 页面
4. MCP.get_product_baseline(product_id)          → 获取基线（作为设计参考）
5. 读取产品 DESIGN.md 作为风格 context
6. 对每个待处理页面：
   - pending: [AI] 基于需求文档 + 基线 + DESIGN.md 构造完整 prompt → MCP.generate_page_design(product_id, page_id, prompt, mode: "full")
   - expired: [AI] 根据增量/全量决策规则选择策略 → MCP.generate_page_design(product_id, page_id, prompt, mode: "incremental" | "full")
7. MCP 内部：获取锁 → Pencil CLI 生成 → 验证 → 导出 2x PNG → mv 到正式目录 → 释放锁
8. MCP.save_designs(req_id, designs[{page_id, pen_path, png_path, type}])
   → 写入设计稿 + 页面状态设为 done
9. 如果所有页面 done → 需求状态自动变为 active
```

### refine

```
1. 校验：页面属于当前需求（硬门禁）
2. 校验：页面状态为 done（硬门禁）
3. 如果指定了节点 ID：
   MCP.get_design_annotations(design_id) → 获取节点树
   校验：节点存在于节点树中（硬门禁）
4. 确认交互（产品 + 需求 + 页面 + 调整内容）
5. [AI] 定位目标区域 + 构造增量 prompt
6. MCP.generate_page_design(product_id, page_id, prompt, mode: "refine", node_id?)
   → MCP 内部：获取锁 → Pencil CLI --in → 验证 → 导出 2x PNG → mv → 释放锁
7. MCP.save_designs(req_id, designs[{page_id, pen_path, png_path, type: "refine"}])
   → 覆盖设计稿 + 更新版本历史
```

### refine-components

```
1. 确认交互（产品 + 调整内容）
2. 读取当前 ~/.forma/library/{product_id}.lib.pen
3. [AI] 构造增量 prompt
4. MCP.generate_components(product_id, prompt, mode: "refine")
   → MCP 内部：获取锁 → Pencil CLI --in → 验证 → mv → 释放锁
5. 如果涉及风格变量变更：
   MCP.update_product_config(product_id, { style })
6. 导出组件预览图展示给用户

⚠️ 只影响后续新生成的设计稿，已有设计稿保持不变
```

### change-style

```
1. 展示当前风格
2. MCP.list_styles() → 列出风格名称供选择
3. 用户选择新风格
4. 确认交互（含警告：组件将重新生成）
5. 读取 styles/{name}/DESIGN.md
6. [AI] 提取变量
7. MCP.update_product_config(product_id, { style: { name, variables, ... } })
8. MCP.generate_components(product_id, prompt, mode: "full")
   → MCP 内部：获取锁 → Pencil CLI 生成 → 验证 → mv → 释放锁
9. 完成

⚠️ 只影响后续新生成的设计稿，已有设计稿保持不变
```

---

## MCP Tools

| Tool | 类型 | 功能 | 硬校验 |
|------|------|------|--------|
| `help` | 读 | 返回所有 MCP tools 的用法、参数说明和示例 | — |
| `list_products` | 读 | 产品列表（含每个产品最新需求 ID 和状态） | — |
| `get_product` | 读 | 获取产品详情（含 description、platform、style、配置状态） | product_id 存在 |
| `get_product_baseline` | 读 | 获取基线（页面清单 + 功能描述 + 导航关系） | product_id 存在 |
| `get_baseline_page` | 读 | 获取某页面的功能描述和关联需求 | product_id + page_id 存在 |
| `get_baseline_image` | 读 | 获取某页面最新设计稿截图（从需求目录读取） | product_id + page_id 存在 |
| `get_requirement_history` | 读 | 获取产品所有历史需求文档 | product_id 存在 |
| `get_requirement` | 读 | 获取需求详情；传 requirement_id 查指定需求，传 product_id 不传 requirement_id 返回最新需求 | product_id 或 requirement_id 存在 |
| `get_current_session` | 读 | 读取当前会话状态 | — |
| `set_current_session` | 写 | 设置当前产品（**含产品配置硬门禁**） | product_id 存在 + 配置完整 |
| `init_product_config` | 写 | 写入 platform + style 到 product.yaml | product_id 存在、字段合法 |
| `complete_product_init` | 写 | 标记 components_initialized = true | product_id 存在、lib.pen 文件存在 |
| `update_product_config` | 写 | 更新产品配置（风格变量等） | product_id 存在 |
| `list_styles` | 读 | 返回风格库列表（名称、分类、描述） | — |
| `get_style` | 读 | 获取某个风格的 DESIGN.md 内容 | 风格名存在 |
| `submit_requirement` | 写 | 写入需求文档 + 页面拆分结果 + 更新基线（页面状态 pending） | 见下方 |
| `update_requirement` | 写 | 更新文档 + 标记受影响页面为 expired + 更新基线 | 见下方 |
| `generate_page_design` | 写 | 调用 Pencil CLI 生成/更新单个页面设计稿到临时目录（含锁 + 验证），不提交正式存储 | product_id + page_id 存在 + Pencil 可用 |
| `generate_components` | 写 | 调用 Pencil CLI 生成通用组件库到临时目录（含锁 + 验证），不提交正式存储 | product_id 存在 + style 已设置 + Pencil 可用 |
| `save_designs` | 写 | 将临时目录中的设计稿 mv 到正式目录 + 更新页面状态 done | 见下方 |
| `rollback_design` | 写 | 回退设计稿到上一版本 | 见下方 |
| `diff_designs` | 读 | 对比两个版本的设计稿结构差异 | design_id 存在、版本号有效 |
| `get_design_annotations` | 读 | 获取设计稿标注节点树 | design_id 存在 |
| `export_design_asset` | 读 | 导出指定节点切图 | design_id 存在 |

### set_current_session 硬门禁

| 校验项 | 说明 |
|--------|------|
| product_id 存在 | 产品必须已创建 |
| product.platform 已设置 | 缺失返回 PRODUCT_CONFIG_INCOMPLETE |
| product.style 已设置 | 缺失返回 PRODUCT_CONFIG_INCOMPLETE |
| product.components_initialized == true | 缺失返回 PRODUCT_CONFIG_INCOMPLETE |

### submit_requirement 硬门禁

| 校验项 | 说明 |
|--------|------|
| product_id 存在 | 产品必须已创建 |
| requirement_id 状态为 empty | 只能对空需求提交 |
| document_md 非空 | 文档不能为空 |
| pages 非空 | 必须提供至少一个页面 |

### update_requirement 硬门禁

| 校验项 | 说明 |
|--------|------|
| requirement_id 存在且状态为 submitted/active | 不能对 empty/archived 修改 |
| document_md 非空 | 文档不能为空 |
| 新数据成功写入后才替换旧数据 | 原子性保证 |

### save_designs 硬门禁

| 校验项 | 说明 |
|--------|------|
| requirement_id 存在 | 需求必须存在 |
| 每个 page_id 属于该需求 | 不能越界写入其他需求的页面 |
| .pen 文件可解析 | 设计稿文件有效 |
| type == "refine" 时页面状态必须为 done | 不能精修未生成的页面 |

### rollback_design 硬门禁

| 校验项 | 说明 |
|--------|------|
| design_id 存在 | 设计稿必须存在 |
| 页面属于当前需求 | 不能越界回退 |
| 版本 > 1 | 版本 1 无法回退 |
| 上一版本 .pen 文件存在 | 历史文件必须保留 |

### 错误码定义

| 错误码 | 触发位置 | 含义 |
|--------|----------|------|
| `PRODUCT_CONFIG_INCOMPLETE` | set_current_session | 产品配置不完整（返回 missing 列表） |
| `REQUIREMENT_STATUS_INVALID` | submit/update_requirement | 需求状态不允许该操作 |
| `DOCUMENT_EMPTY` | submit/update_requirement | 文档内容为空 |
| `PAGES_EMPTY` | submit_requirement | 未提供页面拆分结果 |
| `PAGE_NOT_OWNED` | save_designs / rollback | 页面不属于该需求 |
| `PEN_FILE_INVALID` | save_designs | .pen 文件无法解析或节点树为空 |
| `PAGE_NOT_DONE` | save_designs (refine) / rollback | 页面未生成设计稿 |
| `NODE_NOT_FOUND` | save_designs (refine) | 指定节点不存在于设计稿中 |
| `VERSION_TOO_LOW` | rollback_design | 版本 1 无法回退 |
| `HISTORY_FILE_MISSING` | rollback_design | 历史版本文件不存在 |
| `PRODUCT_NOT_FOUND` | 多处 | 产品 ID 不存在 |
| `REQUIREMENT_NOT_FOUND` | 多处 | 需求 ID 不存在 |
| `DESIGN_NOT_FOUND` | 多处 | 设计稿 ID 不存在 |
| `STYLE_NOT_FOUND` | get_style | 风格名不存在 |
| `PENCIL_CLI_NOT_FOUND` | generate_page_design / generate_components | Pencil CLI 未安装 |
| `PENCIL_NOT_AUTHENTICATED` | generate_page_design / generate_components | Pencil 未登录认证 |

### 临时目录清理策略

- Pencil CLI 操作使用 `/tmp/forma-{uuid}/` 临时目录
- 操作成功：临时目录在文件移动到正式目录后立即删除
- 操作失败：临时目录立即清理
- 兜底：MCP server 启动时清理所有超过 1 小时的 `/tmp/forma-*` 目录

### 冲突检测定位

**冲突检测是 AI 建议，不是硬门禁。** AI 分析新需求与基线/历史需求的潜在冲突，展示给用户确认。用户可以选择忽略冲突继续提交。

理由：冲突检测是语义判断，无法用代码穷举规则。硬门禁原则只适用于可编码的确定性校验。

流程：
```
AI 分析冲突 → 展示冲突点（如有）→ 用户确认"继续提交"或"取消"
```

### update-requirement 页面变更规则

需求修改后 AI 重新拆分页面，与旧页面清单对比：

| 变更类型 | 处理规则 |
|----------|----------|
| 新增页面 | 创建新 page_id + 新 baseline_page，状态 pending |
| 页面内容变化 | 保持 page_id 不变，标记 expired |
| 页面删除 | 从需求页面清单中移除，基线中保留（其他需求可能也贡献了该页面） |
| 页面改名 | 视为删除旧页面 + 新增新页面 |
| 页面拆分 | 视为删除旧页面 + 新增多个新页面 |

### expired 页面增量 vs 全量决策

| 条件 | 策略 |
|------|------|
| 需求变动涉及该页面的局部功能（如"登录页增加验证码"） | 增量更新（--in 旧.pen） |
| 需求变动涉及该页面的整体重设计（如"登录页改为扫码登录为主"） | 全量重建（不传 --in） |

决策由 AI 在构造 prompt 时判断：对比新旧需求文档中该页面的描述变化幅度。

### fm-refine-design 参数格式

```
/fm-refine-design --page 登录页 --node frame-social-buttons --desc "改为横排布局"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --page | 是 | 页面名称或 page_id |
| --node | 否 | 节点 ID（从后台标注画布复制） |
| --desc | 是 | 调整描述 |

不传 --node 时，AI 根据 --desc 自行定位目标区域。

---

## Web 后台

### 页面结构

| 页面 | 路由 | 功能 | 操作 |
|------|------|------|------|
| 产品列表 | `/products` | 展示所有产品卡片 | 新建产品 |
| 新建产品 | `/products/new` | 名称 + 描述 + 设计风格选择（可选） | 写 |
| 产品详情 | `/products/:productId` | 需求列表 + 基线概览 | 新建需求、归档需求 |
| 基线概览 | `/products/:productId/baseline` | 当前产品所有页面功能清单 + 导航关系图 | 只读 |
| 需求详情 | `/products/:productId/requirements/:reqId` | Tab 1: 需求文档；Tab 2: 设计稿列表（含页面状态） | 只读 |
| 设计稿标注 | `/products/:productId/requirements/:reqId/designs/:designId` | LeaferJS 画布 + 标注交互 + 属性面板 | 只读 |
| **风格资源库** | `/styles` | 所有风格预览网格 + 一键同步按钮 | 同步 |
| **风格详情** | `/styles/:name` | 预览大图 + DESIGN.md 内容 + 变量列表 | 只读 |

### 新建产品页面

```
┌─ 新建产品 ──────────────────────────────────────────────┐
│                                                          │
│  产品名称：[________________]                            │
│  产品描述：[________________]                            │
│                                                          │
│  设计风格：                                              │
│    ○ 选择设计风格                                        │
│    ○ 暂不选择（后续通过 Agent 配置）                      │
│                                                          │
│  ┌─ 风格选择面板（选择"选择设计风格"后展开）─────────────┐ │
│  │                                                      │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │ │
│  │  │ [预览图] │  │ [预览图] │  │ [预览图] │  ...     │ │
│  │  │  Claude  │  │  Linear  │  │  Airbnb  │          │ │
│  │  │  暖色简洁 │  │  极简紫调 │  │  圆润温暖 │          │ │
│  │  └──────────┘  └──────────┘  └──────────┘          │ │
│  │                                                      │ │
│  │  [搜索/筛选分类]                                     │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                          │
│  [创建产品]                                              │
└──────────────────────────────────────────────────────────┘
```

预览图 = 预览组件集在该风格下渲染的截图，让用户直观看到风格效果。

### 风格资源库页面

```
┌─ 风格资源库 ─────────────────────────────────────────────┐
│                                                           │
│  [一键同步]  上次同步：2026-05-17                          │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ [预览图] │  │ [预览图] │  │ [预览图] │  ...          │
│  │  Claude  │  │  Linear  │  │  Airbnb  │               │
│  └──────────┘  └──────────┘  └──────────┘               │
│                                                           │
│  分类筛选：[全部] [AI产品] [工具类] [电商] [金融] ...      │
└───────────────────────────────────────────────────────────┘
```

### 后台不提供的操作

❌ 上传需求、修改需求、生成设计稿、精修设计稿、调整组件、更换风格、手动合入基线、产品配置初始化

### ID 复制按钮

后台 UI 中所有 ID 旁边提供复制按钮（点击复制到剪贴板），方便用户在 Agent 命令中使用：

| 位置 | 可复制的 ID |
|------|------------|
| 产品卡片/详情页 | 产品 ID（P-xxx） |
| 需求列表/详情页 | 需求 ID（R-xxx） |
| 设计稿列表/详情页 | 设计稿 ID（D-xxx） |
| 标注画布（点击节点时） | 节点 ID/路径 |

### 标注渲染方案（LeaferJS）

```
┌─ LeaferJS Canvas ──────────────────────────┐
│  Layer 0: 2x PNG 底图（视觉参考）            │
│  Layer 1: 节点骨架（透明矩形，用于 hit-test）│
│  Layer 2: 标注线/间距线（动态绘制）          │
└─────────────────────────────────────────────┘
```

交互：
- 缩放/平移：LeaferJS 内置 viewport
- Hover 节点：高亮边框 + 显示宽高标注
- Click 节点：侧边面板显示完整属性（颜色、字体、间距等）+ **节点 ID/路径（可复制，用于 refine 命令）**
- 选中两个节点：显示间距标注线

### 截图分辨率

统一导出 2x PNG（`--export-scale 2`），放大查看不模糊。

---

## 后端 API 接口

### 供 Web 后台调用

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/products` | 产品列表 |
| `POST` | `/api/products` | 新建产品（含可选 style_name） |
| `GET` | `/api/products/:id` | 产品详情（含配置状态） |
| `GET` | `/api/products/:id/requirements` | 需求列表 |
| `POST` | `/api/products/:id/requirements` | 新建空需求（title）→ 返回 requirement_id |
| `PUT` | `/api/products/:id/requirements/:reqId/archive` | 归档需求 |
| `GET` | `/api/products/:id/requirements/:reqId` | 需求详情（元数据 + 文档 + 页面列表 + 设计稿） |
| `GET` | `/api/products/:id/baseline` | 基线（页面清单 + 功能描述 + 导航） |
| `GET` | `/api/products/:id/baseline/pages/:pageId/image` | 该页面最新设计稿截图（从需求目录读取） |
| `GET` | `/api/products/:id/baseline/pages/:pageId/annotations` | 该页面最新设计稿标注数据 |
| `GET` | `/api/designs/:designId/annotations` | 设计稿标注节点树 |
| `GET` | `/api/designs/:designId/image` | 设计稿 2x 预览图 |
| `GET` | `/api/designs/:designId/history` | 设计稿版本历史列表 |
| `GET` | `/api/designs/:designId/diff` | 版本对比（query: v1, v2，返回两版本 PNG 路径 + 结构差异） |
| `GET` | `/api/designs/:designId/export` | 导出切图（query: nodeId, format） |
| `GET` | `/api/styles` | 风格列表（含预览图路径） |
| `GET` | `/api/styles/:name` | 风格详情（DESIGN.md + 变量 + 预览图） |
| `GET` | `/api/styles/:name/preview` | 风格预览图 |
| `POST` | `/api/styles/sync` | 一键同步（拉取最新 + 重新生成预览图） |

### 后台 API 硬门禁

后台 API 同样需要代码级硬校验，不能只靠前端按钮置灰：

| API | 硬门禁 |
|-----|--------|
| `POST /api/products/:id/requirements` | 产品下无需求 **或** 最后一个需求状态为 `archived` |
| `PUT /api/.../archive` | 需求状态为 `active`（所有页面 done） |

---

## 存储结构

所有数据存放在 `~/.forma/` 独立目录下，不在项目目录中存放任何 Forma 数据。用户在任何目录使用 Agent 命令，数据都读写同一个位置。

**核心原则：Forma 没有"项目目录"概念。**
- 无论用户在哪个目录执行 Agent 命令，都不会在该目录产生任何 Forma 文件
- 外部项目如果需要读取产品需求或设计稿数据，通过 MCP tools 按 ID 查询（如 `get_design_annotations(design_id)`）
- Forma 源码中的 `styles/` 目录是**内置资源**，随 npm 包分发，首次安装时复制到 `~/.forma/styles/`
- `~/.forma/` 目录在任何命令首次需要时**自动创建**，无需手动初始化

### 全局配置

```
~/.forma/
├── config.yaml                                    # 全局配置
├── session.yaml                                   # Agent 会话状态
├── pencil.lock                                    # Pencil 全局锁
├── manifests/                                     # Agent 平台安装清单
│   ├── claude.manifest
│   ├── gemini.manifest
│   └── codex.manifest
├── skills/                                        # 共享核心技能
│   └── forma/
│       └── SKILL.md
├── commands/
│   └── forma.md
├── data/                                          # 产品/需求/设计稿数据
│   ├── products.yaml                              # 产品索引
│   ├── P-a3f8b2/                                  # 产品目录
│   │   ├── product.yaml                           # 产品元数据
│   │   ├── baseline/                              # 产品基线（功能形态，非设计稿）
│   │   │   └── baseline.yaml                      # 页面清单 + 功能描述 + 导航关系
│   │   ├── R-c1d4e5f6/                            # 需求目录
│   │   │   ├── requirement.yaml
│   │   │   ├── document.md
│   │   │   ├── D-b2c1d4e5/
│   │   │   │   ├── design.yaml
│   │   │   │   ├── design.pen                     # 当前版本
│   │   │   │   ├── design.v1.pen                  # 历史版本
│   │   │   │   ├── design.v2.pen
│   │   │   │   └── preview@2x.png
│   │   │   └── D-f6e5d4c3/
│   │   │       └── ...
│   │   └── ...
│   └── ...
├── library/                                       # 各产品组件库
│   └── P-a3f8b2.lib.pen
└── styles/                                        # 风格资源库（内置）
    ├── _preview-template.pen
    ├── styles.yaml
    ├── claude/
    │   ├── DESIGN.md
    │   └── preview@2x.png
    ├── linear/
    │   ├── DESIGN.md
    │   └── preview@2x.png
    └── ...
```

### 基线存储策略

基线只存 YAML 元数据（页面功能描述 + 导航关系），不存设计稿文件。设计稿始终在需求目录下管理。

### requirement.yaml 示例

```yaml
id: R-c1d4e5f6
product_id: P-a3f8b2
title: 用户登录功能
status: active
created_at: 2026-05-17
updated_at: 2026-05-18
pages:
  - page_id: R-c1d4e5f6-login
    name: 登录页
    baseline_page: login
    design_status: done
    design_id: D-b2c1d4e5
  - page_id: R-c1d4e5f6-forgot-password
    name: 忘记密码页
    baseline_page: forgot-password
    design_status: done
    design_id: D-f6e5d4c3
navigation:
  - from: R-c1d4e5f6-login
    to: R-c1d4e5f6-forgot-password
    trigger: "点击忘记密码链接"
```

### design.yaml 示例

```yaml
id: D-b2c1d4e5
page_id: R-c1d4e5f6-login
baseline_page: login
requirement_id: R-c1d4e5f6
platform: mobile
version: 3
created_at: 2026-05-17
updated_at: 2026-05-18
history:
  - version: 1
    type: generate
    prompt: "创建登录页，包含邮箱输入、密码输入、登录按钮"
    date: 2026-05-17
  - version: 2
    type: design_update
    prompt: "添加 Google 和 GitHub 第三方登录按钮"
    date: 2026-05-18
  - version: 3
    type: refine
    prompt: "第三方登录按钮改为横排布局"
    target_node: "frame-social-buttons"
    date: 2026-05-18
```

### 设计稿目录文件（含历史版本）

```
D-b2c1d4e5/
├── design.yaml              # 元数据
├── design.pen               # 当前版本（v3）
├── design.v1.pen            # 历史版本 1（供 rollback）
├── design.v2.pen            # 历史版本 2（供 rollback）
└── preview@2x.png           # 当前版本预览图
```

---

## 完整工作流示例

```
1. 后台：一键同步风格资源 → 50+ 风格预览图生成完毕

2. 后台：新建产品"商城 App"，选择设计风格"linear"
   → P-a3f8b2，style 已写入

3. 后台：新建需求"用户登录功能"
   → R-c1d4e5f6 (empty)

4. Agent: list-product → 选择"商城 App"
   → MCP.set_current_session → 失败: missing ["platform", "components"]
   → "请选择产品类型：1.移动端 2.桌面端 3.平板端 4.网页端"
   → 用户选 1
   → 生成通用组件（使用 linear 风格）→ library/P-a3f8b2.lib.pen
   → 重试 set_current_session → 成功 ✓

5. Agent: upload-requirement（附带需求文档）
   → 冲突检测通过
   → 页面拆分：[登录页, 忘记密码页]
   → 需求状态: submitted

6. Agent: design
   → 全量生成（Pencil prompt 附加 linear DESIGN.md 作为风格 context）
   → 页面状态: [done, done]
   → 需求状态: active

7. 后台：查看设计稿标注 → 复制节点 ID

8. Agent: refine 登录页，节点 frame-social-buttons 改为横排
   → 局部精修

9. Agent: change-style → 选择 airbnb
   → 通用组件重新生成（只影响后续）

10. Agent: update-requirement（登录页增加验证码）
    → 登录页 expired → 需求状态: submitted

11. Agent: design
    → 登录页增量更新（使用新的 airbnb 风格）
    → 需求状态: active

12. 后台：归档需求 → archived
13. 后台：新建下一个需求...
```

---

## 项目文件结构（Forma 源码）

```
forma/                                  # 项目源码目录（npm 包）
├── package.json
├── tsconfig.json
├── install.sh                          # 安装入口
├── uninstall.sh                        # 卸载入口
├── bin/
│   └── forma.js                           # CLI 入口（install/uninstall/mcp/serve）
├── commands/                           # 各平台命令源文件
│   ├── claude/
│   │   ├── fm-list-product.md
│   │   ├── fm-status.md
│   │   ├── fm-upload-requirement.md
│   │   ├── fm-update-requirement.md
│   │   ├── fm-design.md
│   │   ├── fm-refine-design.md
│   │   ├── fm-refine-components.md
│   │   ├── fm-change-style.md
│   │   └── fm-rollback-design.md
│   ├── gemini/
│   │   └── ...（.toml 格式）
│   └── codex/
│       └── skills/
│           └── ...（SKILL.md 格式）
├── src/
│   ├── core/
│   │   ├── spec.ts                     # 需求 YAML 读写
│   │   ├── product.ts                  # 产品配置管理
│   │   ├── annotate.ts                 # .pen → 标注数据提取
│   │   ├── baseline.ts                 # 基线管理
│   │   ├── styles.ts                   # 风格资源管理
│   │   ├── install.ts                  # 平台安装/卸载逻辑
│   │   └── session.ts                  # 会话状态管理
│   ├── server/
│   │   ├── index.ts                    # Fastify 服务入口
│   │   └── routes.ts                   # API 路由
│   └── mcp/
│       └── server.ts                   # MCP 服务（含硬门禁逻辑）
├── skills/
│   └── forma/
│       ├── SKILL.md                    # 共享核心技能（安装到 ~/.forma/skills/）
│       └── references/
├── web/
│   ├── index.html
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── ProductList.tsx         # 产品列表
│   │   │   ├── ProductNew.tsx          # 新建产品（含风格选择）
│   │   │   ├── ProductDetail.tsx       # 产品详情（需求列表）
│   │   │   ├── BaselineView.tsx        # 基线概览
│   │   │   ├── RequirementDetail.tsx   # 需求详情
│   │   │   ├── DesignView.tsx          # 设计稿标注
│   │   │   ├── StyleLibrary.tsx        # 风格资源库
│   │   │   └── StyleDetail.tsx         # 风格详情
│   │   └── components/
│   │       ├── Canvas.tsx              # LeaferJS 画布容器
│   │       ├── AnnotationLayer.tsx     # 标注渲染层
│   │       ├── PropertyPanel.tsx       # 属性面板
│   │       └── StyleCard.tsx           # 风格预览卡片
│   └── vite.config.ts
├── styles/                             # 内置风格资源（随 npm 包分发，安装时复制到 ~/.forma/styles/）
│   ├── _preview-template.pen
│   ├── styles.yaml
│   └── {name}/
│       ├── DESIGN.md
│       └── preview@2x.png
├── library/                            # 不存放数据，仅作为组件生成的临时 workspace
└── designs/                            # 不存放数据，所有数据在 ~/.forma/data/
```

---

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | Pencil 为唯一设计引擎 | MCP 完整、JSON 格式、免费、可本地模型 |
| 2 | 目录 + YAML 管理，无数据库 | 轻量、Git 友好、无额外依赖 |
| 3 | 每个产品独立 .lib.pen 组件库 | 不同产品风格不同 |
| 4 | LeaferJS Canvas 渲染标注 | 高性能、内置缩放平移、事件精确 |
| 5 | 2x PNG 导出 | 放大不模糊 |
| 6 | React + Vite + Tailwind | 交互密集、生态成熟 |
| 7 | Fastify API 层 | 轻量、TypeScript 友好 |
| 8 | 需求/设计/精修/组件/风格操作只能通过 Agent | 涉及 AI 能力 |
| 9 | 每个产品同一时间只有一个活跃需求 | 线性迭代，简化管理 |
| 10 | Agent 会话状态固定在 ~/.forma/session.yaml | 不依赖工作目录，任何位置可用 |
| 11 | 写操作前必须确认交互 | 防误操作 |
| 12 | update 新数据成功后才替换旧数据 | 原子性保证 |
| 13 | ID 带类型前缀（P-/R-/D-） | 自描述 |
| 14 | 设计稿生成与需求提交分离 | 需求只管文档+拆分，设计稿独立生成 |
| 15 | refine 严格校验页面和节点归属 | 不能越界修改 |
| 16 | 产品配置为 CLI 硬门禁 | 代码级强制，prompt 无法绕过 |
| 17 | refine-components / change-style 只影响后续生成 | 已有设计稿保持不变 |
| 18 | change-style 触发通用组件重新生成 | 风格变了组件必须跟着变 |
| 19 | 内置 awesome-design-md 风格资源 | 50+ 现成风格，MIT 开源 |
| 20 | 后台新建产品可提前选风格 | 减少 Agent 侧交互步骤 |
| 21 | 风格预览用固定组件集渲染 | 直观对比不同风格效果 |
| 22 | 多平台 Agent 安装（Claude/Codex/Gemini） | 覆盖主流 AI Agent 平台 |
| 23 | 参照 [openspec](https://github.com/xenonbyte/opsx) 的 install/uninstall + manifest 模式 | 成熟方案，精确追踪安装文件 |
| 24 | MCP Server 与 Web Server 独立进程 | 不启动 Web 也能用 Agent 命令 |
| 25 | 产品单平台 | 不同平台需求不同，分产品管理更清晰 |
| 26 | 需求文档通过文件路径传入 | 简单直接，支持大文档 |
| 27 | 导航关系由 AI 从需求文档自动提取 | 页面拆分时同步输出 |
| 28 | rollback 命令支持版本回退 | 精修/更新效果不好时可恢复 |
| 29 | 历史版本 .pen 文件保留在设计稿目录 | 供 rollback 使用 |
| 30 | 风格资源内置，无需网络即可使用 | 同步只是更新，不是必须 |
| 31 | 所有数据存放在 ~/.forma/ 独立目录 | 不污染项目目录，任何位置可用 |
| 32 | 基线是功能基线（页面+功能+导航），不存设计稿 | 风格变更不影响基线，基线只在需求提交/修改时更新 |
| 33 | page_id = 需求id + 页面名，baseline_page = 纯页面名 | 需求级唯一 + 跨需求追踪同一页面 |
| 34 | Pencil 全局锁防并发 | 防止多进程同时写 Pencil |
| 35 | 生成后验证 .pen 完整性（含截断检测） | Pencil save 不完全可靠 |
| 36 | batch_design ≤ 12 ops，回滚两次降到 ≤ 6 | [da-vinci](https://github.com/xenonbyte/da-vinci/tree/v1.5.0) 实践验证的安全阈值 |

---

## Agent 平台安装

### 支持平台

| 平台 | 命令格式 | 安装位置 |
|------|----------|----------|
| Claude | Markdown（frontmatter + prompt） | `~/.claude/commands/fm-*.md` |
| Gemini | TOML（description + prompt） | `~/.gemini/commands/fm-*.toml` |
| Codex | Skills 目录 | `~/.codex/prompts/skills/fm-*/SKILL.md` |

### 安装/卸载命令

```bash
# 安装（支持多平台逗号分隔）
forma install --platform claude,codex,gemini

# 卸载
forma uninstall --platform claude,codex,gemini
```

### 安装机制（参照 [openspec](https://github.com/xenonbyte/opsx) 模式）

1. CLI 入口 `bin/forma.js` 处理 install/uninstall 子命令
2. 按平台生成对应格式的命令文件，写入平台命令目录
3. 共享核心技能安装到 `~/.forma/skills/forma/SKILL.md`
4. manifest 文件追踪已安装文件，卸载时按 manifest 精确清理
5. 安装前备份已有文件，防止覆盖丢失

### 共享目录结构

```
~/.forma/
├── skills/
│   └── forma/
│       ├── SKILL.md                        # 核心工作流指导（所有命令共享）
│       └── references/                     # 参考文档
├── commands/
│   └── forma.md                         # 共享命令索引
└── manifests/
    ├── claude.manifest                     # 已安装文件清单
    ├── gemini.manifest
    └── codex.manifest
```

### 平台命令文件

每个 Agent 命令对应一个平台命令文件：

| 命令 | Claude 文件 | Gemini 文件 |
|------|-------------|-------------|
| list-product | `fm-list-product.md` | `fm-list-product.toml` |
| query | `fm-status.md` | `fm-status.toml` |
| upload-requirement | `fm-upload-requirement.md` | `fm-upload-requirement.toml` |
| update-requirement | `fm-update-requirement.md` | `fm-update-requirement.toml` |
| design | `fm-design.md` | `fm-design.toml` |
| refine | `fm-refine-design.md` | `fm-refine-design.toml` |
| refine-components | `fm-refine-components.md` | `fm-refine-components.toml` |
| change-style | `fm-change-style.md` | `fm-change-style.toml` |
| rollback | `fm-rollback-design.md` | `fm-rollback-design.toml` |

### 命令文件示例

**Claude 格式（`~/.claude/commands/fm-list-product.md`）：**

```markdown
---
description: Select product and switch to its latest requirement.
---
# Forma route: list-product

Use Forma workflow guidance. Shared skill at `~/.forma/skills/forma/SKILL.md`.

Workflow action: `list-product`
Route: `/fm-list-product`

Execution rules:
- Call MCP tool `list_products` to get all products.
- Present product list to user for selection.
- Call MCP tool `set_current_session` with selected product + latest requirement.
- If returns PRODUCT_CONFIG_INCOMPLETE, interactively complete missing config (platform, style, components).
- Report current requirement status after successful session setup.
```

**Gemini 格式（`~/.gemini/commands/fm-list-product.toml`）：**

```toml
description = "Select product and switch to its latest requirement."
prompt = """
# Forma route: list-product
...（同 Claude 内容）
"""
```

**Codex 格式（`~/.codex/prompts/skills/fm-list-product/SKILL.md`）：**

```markdown
# Forma route: list-product
...（同 Claude 内容，无 frontmatter）
```

### 项目命令目录结构

```
forma/
├── bin/
│   └── forma.js                              # CLI 入口
├── commands/
│   ├── claude/                             # Claude 命令源文件
│   │   ├── fm-list-product.md
│   │   ├── fm-status.md
│   │   ├── fm-upload-requirement.md
│   │   ├── fm-update-requirement.md
│   │   ├── fm-design.md
│   │   ├── fm-refine-design.md
│   │   ├── fm-refine-components.md
│   │   ├── fm-change-style.md
│   │   └── fm-rollback-design.md
│   ├── gemini/                             # Gemini 命令源文件
│   │   ├── fm-list-product.toml
│   │   └── ...
│   └── codex/                              # Codex 命令源文件
│       └── skills/
│           ├── fm-list-product/
│           │   └── SKILL.md
│           └── ...
├── install.sh
└── uninstall.sh
```

### package.json

```json
{
  "name": "@xenonbyte/forma",
  "version": "0.1.0",
  "bin": { "forma": "bin/forma.js" },
  "scripts": {
    "postinstall": "node scripts/postinstall.js"
  }
}
```

---

## 外部依赖

| 依赖 | 说明 |
|------|------|
| `@pencil.dev/cli` | 设计稿生成和导出核心引擎 |
| Pencil 账号 | CLI 认证（免费） |
| AI 模型 API | Pencil agent 模式 + Agent 技能内的分析 |
| `leafer-ui` | Canvas 渲染引擎 |
| `fastify` | Web API 服务 |
| `react`, `vite` | 前端框架和构建 |
| `js-yaml` | YAML 解析 |
| awesome-design-md | 风格资源（MIT，通过 git clone 同步） |

---

## 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Pencil CLI headless 稳定性 | 复杂页面生成质量不可控 | refine 命令做局部精修 |
| Pencil batch_design rollback | 大 batch 操作可能整体回滚 | 限制 batch 大小，micro-batch 降级 |
| Pencil save() 不可靠 | 文件可能未完整落盘 | 生成后独立验证 .pen 完整性 |
| .pen 格式变更 | 标注解析可能失效 | annotate 模块做版本适配层 |
| LeaferJS 渲染与 .pen 节点映射 | 骨架层定位偏差 | 只做矩形骨架 + hit-test |
| AI 冲突检测准确性 | 可能漏报或误报 | 冲突结果展示给用户确认 |
| 增量设计稿更新质量 | expired 页面局部更新可能破坏整体布局 | 保留历史版本，可 rollback |
| 通用组件生成质量 | 初始组件可能不满意 | refine-components 命令调整 |
| awesome-design-md 仓库变更 | 风格数据格式可能变化 | 同步时做格式校验，异常跳过 |
| Pencil prompt 长度限制 | DESIGN.md + 需求 + 基线拼接后可能超限 | 对 DESIGN.md 做摘要提取，基线只传相关页面 |

---

## 历史版本策略

### 保留规则

- **全部保留**，不限制版本数量
- .pen 文件是 JSON 文本，单个通常几十 KB，存储成本可控

### 清理时机

**仅在需求归档时清理。** 后台点击"归档需求"时：

```
归档操作内部：
1. 需求状态 → archived
2. 清理该需求下所有设计稿的历史版本文件：
   - 保留：design.pen（当前版本）、preview@2x.png
   - 删除：design.v1.pen、design.v2.pen、...
3. 基线中该需求贡献的页面保持不变（基线只存最新版本）
```

归档后不可回退（已无历史文件），这是合理的——归档意味着需求已完成，不再修改。

---

## 设计稿 Diff 对比

### 功能

对比同一页面设计稿的两个版本差异，支持视觉对比和结构对比。

### 两种对比模式

| 模式 | 展示方式 | 用途 |
|------|----------|------|
| 视觉对比 | 两张 PNG 并排/叠加/滑动对比 | 给人看，直观发现 UI 变化 |
| 结构对比 | 节点树差异（新增/删除/修改的节点和属性） | 给 AI 看，用于增量更新参考 |

### 触发场景

- **Web 后台**：需求详情页，选择两个版本对比（视觉对比）
- **Agent design 命令**：expired 页面增量更新时，AI 内部使用结构对比确定变更点
- **Agent refine 后**：展示精修前后差异供用户确认

### 结构对比输出格式

```yaml
diff:
  added:
    - node_id: "frame-captcha"
      parent: "frame-login-form"
      type: frame
      properties: { width: 320, height: 48 }
  removed: []
  modified:
    - node_id: "frame-social-buttons"
      changes:
        layout: { from: "vertical", to: "horizontal" }
        gap: { from: 16, to: 12 }
```

### API / MCP

| 接口 | 功能 |
|------|------|
| `GET /api/designs/:designId/diff?v1=2&v2=3` | Web 后台视觉对比（返回两个版本的 PNG 路径） |
| MCP `diff_designs(design_id, v1, v2)` | 返回结构对比 JSON（供 AI 使用） |

### 硬门禁

- design_id 存在
- v1、v2 版本号有效且对应 .pen 文件存在

---

## 扩展性设计

### 项目管理工具集成（预留）

当前不实现，但架构预留扩展点：

- `requirement.yaml` 中预留 `external_id` 字段（用于关联 Jira/Linear/飞书 issue ID）
- `product.yaml` 中预留 `integrations` 字段
- 后续可通过 webhook 或 MCP tool 实现双向同步

```yaml
# requirement.yaml 预留字段
external_id: ""          # 未来关联外部系统 ID
external_url: ""         # 未来关联外部系统链接
```

### 多用户/权限（预留）

当前单人使用，但架构预留：

- 所有数据操作通过 MCP tools / API 统一入口，未来加权限层只需在入口处拦截
- `product.yaml` 预留 `owner` 字段
- Web 后台路由结构已按产品隔离，未来加登录态不影响现有结构

```yaml
# product.yaml 预留字段
owner: ""                # 未来多用户时标识所有者
```

---

## 实现阶段补充设计

### annotate.ts 解析算法

输入：.pen 文件路径
输出：扁平化节点列表（含 resolved 属性）

```
1. 读取 .pen JSON，提取 children 树和 variables 段
2. 递归遍历 children：
   - 对每个节点输出：{ id, name, type, x, y, width, height, fill, stroke, fontSize, fontFamily, cornerRadius, padding, gap, layout, content }
   - 嵌套 frame 的坐标：累加父节点的 x/y 得到绝对坐标
   - 变量引用（$--primary）：查 variables 段 resolve 为实际值
   - ref 节点（组件实例）：读取 ref 指向的 reusable 节点，合并 descendants 覆盖属性
3. 输出扁平化数组（含 parentId 字段表示层级关系）
```

### LeaferJS 标注转换层

.pen 节点 → LeaferJS 图形的映射：

| .pen type | LeaferJS 图形 | 用途 |
|-----------|--------------|------|
| frame | Rect（透明填充 + 边框） | 布局容器骨架 |
| rectangle | Rect | 矩形 |
| text | Text（不渲染，只占位） | 文本区域 |
| ellipse | Ellipse | 圆形 |
| 其他 | Rect（fallback） | 通用占位 |

所有图形默认透明，仅在 hover/click 时显示边框高亮。底层是 2x PNG 提供视觉参考。

### 风格变量提取与 fallback

AI 从 DESIGN.md 提取变量后，MCP `init_product_config` 硬门禁检查必填字段：

```yaml
# 必填变量（缺失时使用默认值）
primary: "#3b82f6"
background: "#FFFFFF"
text-primary: "#111827"
font-heading: "Inter"
font-body: "Inter"
border-radius: 8
spacing-unit: 8
```

如果 AI 提取结果缺少必填字段，自动用默认值填充。`init_product_config` 校验颜色值格式（#RRGGBB）和数值合法性。

### 基线页面清理规则

`update_requirement` 内部在更新基线时检查：如果某个 baseline_page 的 source_requirements 列表变为空（没有任何活跃需求引用它），则从基线中移除该页面及其导航关系。

### 锁的 pid 存活检查

获取锁时，如果锁文件已存在：
1. 读取锁中的 pid
2. 检查该 pid 是否仍存活（`process.kill(pid, 0)`）
3. 不存活 → 抢占锁（覆盖锁文件）
4. 存活且未超时 → 返回 `PENCIL_LOCK_HELD` 错误
5. 存活但已超时（>5分钟）→ 强制抢占

### _preview-template.pen

随 npm 包内置，首次发布前由开发者用 Pencil 手动创建。包含固定组件集的布局：
- 上半部分：按钮行（主要 + 次要 + 文字）+ 输入框
- 下半部分：卡片 + 导航栏 + 列表项 + 标签

尺寸固定 800x600，导出为 400x300 的 2x 预览图。

## 实现规划

### MVP 范围（v0.1）

| 模块 | 范围 |
|------|------|
| CLI | `forma install/uninstall/mcp/serve/status/version` |
| MCP Server | 全部 MCP tools |
| Agent 命令 | 全部 9 个命令，先支持 Claude 单平台 |
| Web 后台 | 产品管理 + 需求查看 + 设计稿标注 + 风格资源库 |
| 风格 | 内置 awesome-design-md，暂不做一键同步（手动更新） |
| 平台 | 先支持移动端 |

### 后续版本

- v0.2：一键同步、Web 后台风格预览生成、基线概览页面导航图
- v0.3：多用户/权限、项目管理工具集成

### 外部依赖验证状态

| 依赖 | 验证状态 |
|------|----------|
| Pencil MCP tools（batch_design/batch_get/get_screenshot/export_nodes/get_guidelines 等） | ✅ 已验证（当前环境可用） |
| Pencil CLI（--in/--out/--prompt/--export/--export-scale/interactive） | ✅ 已验证（官方文档确认） |
| awesome-design-md 数据格式 | ✅ 已验证（抓取确认每个风格含 DESIGN.md） |
| LeaferJS Canvas 渲染 | ✅ 已验证（官方文档确认支持 Rect/Text/事件/缩放） |
| Pencil --workspace 参数 | ✅ 已验证（官方 CLI 文档列出） |

### 归档后不可操作规则

需求归档后：
- 需求状态变为 `archived`，不可修改
- 该需求下的设计稿历史版本被清理（只保留当前版本）
- 归档后无法 rollback（历史文件已删除）
- 基线中该需求贡献的页面信息保留（source_requirements 保留 archived 需求 ID）
- Agent 命令的硬门禁会检测"最新需求已归档"并 BLOCK 所有写操作（除 fm-list-product 和 fm-status）

---

## 参考资料

| 名称 | 链接 | 用途 |
|------|------|------|
| Pencil 官网 | https://www.pencil.dev/ | 设计引擎 |
| Pencil 文档 | https://docs.pencil.dev/ | .pen 格式、CLI、MCP tools |
| Pencil CLI 文档 | https://docs.pencil.dev/for-developers/pencil-cli | CLI 命令参考 |
| Pencil .pen 格式 | https://docs.pencil.dev/for-developers/the-pen-format | 文件格式规范 |
| Pencil 设计库 | https://docs.pencil.dev/core-concepts/design-libraries | 组件库机制 |
| Pencil 变量 | https://docs.pencil.dev/core-concepts/variables | 设计 token / 主题 |
| Pencil AI 集成 | https://docs.pencil.dev/getting-started/ai-integration | MCP 连接方式 |
| LeaferJS | https://github.com/leaferjs/LeaferJS | Canvas 渲染引擎 |
| LeaferJS 文档 | https://www.leaferjs.com/ui/ | API 和示例 |
| awesome-design-md | https://github.com/VoltAgent/awesome-design-md | 设计风格资源库 |
| da-vinci v1.5.0 | https://github.com/xenonbyte/da-vinci/tree/v1.5.0 | Pencil 交互实践参考（坑和对策） |
| openspec (opsx) | https://github.com/xenonbyte/opsx | Agent 平台安装模式参考 |
