# DESIGN v4

## 背景

Forma v3 完成了多语言 copy、BDD 规则、风格同步等核心功能后，实际使用中暴露了几个阻塞性问题和体验短板：

1. Claude 平台的 MCP 工具完全无法加载（配置写入位置错误，写到顶层而非 `mcpServers` 内）
2. 所有平台的 MCP server 启动失败（`forma` CLI 未全局安装时，硬编码的 `command: "forma"` 找不到可执行文件）
3. Agent 产品选择流程冗长，且首次选择产品时因组件未初始化而被错误拦截
4. Web 后台的风格展示过于抽象（纯文本变量），无法直观感知设计风格
5. 后台整体视觉和交互质量偏低，缺乏层次感和加载反馈
6. Web 后台缺少产品删除入口，测试或试验产品无法清理

## 目标

1. **修复 Claude MCP 配置结构**：确保 `forma install --platform claude` 生成正确的 `mcpServers` 配置，并清理旧版错误的顶层残留
2. **修复 MCP 可执行路径解析**：开发阶段未全局安装 `forma` 时，自动回退到 `process.execPath + CLI 绝对路径`，三平台统一
3. **优化 Agent 产品选择体验**：简化展示、支持编号选择、将组件初始化检查下沉到设计阶段
4. **风格可视化**：通过通用 UI 模板实时渲染样式变量，让用户一眼感知风格效果
5. **后台视觉升级**：增加视觉层次、loading skeleton、过渡动画，提升整体专业感
6. **产品删除**：Web 后台支持删除产品，删除前二次确认；删除当前产品时清空当前 session

## 非目标

- 除功能七新增 `delete_product` 外，不改变已有 MCP tool 的 API 接口和数据结构
- 不引入新的前端依赖或 UI 组件库
- 除功能七新增 `DELETE /api/products/:id` 外，不新增其他后端 API 接口
- 不新增需求删除 API、MCP tool 或 Web 入口。需求只能随产品删除被级联清理，不能被单独删除
- 不做产品软删除、回收站、批量删除或撤销恢复

---

## 功能一：修复 Claude MCP 配置写入位置

### 问题

`forma install --platform claude` 将 MCP 配置写入 `~/.claude/mcp.json` 顶层，而非 `mcpServers` 内：

```json
{
  "mcpServers": { "context7": {...} },
  "forma": { "command": "forma", "args": ["mcp"] }
}
```

Claude 无法识别顶层的 MCP 配置，导致 Forma MCP 工具未加载。

### 修复

文件：`packages/core/src/install.ts`

#### installMcpConfig — Claude 分支

当前代码（错误写入顶层）：

```typescript
await this.writeJsonConfig(platform, join(this.userHome, ".claude", "mcp.json"), (config) => ({
  ...config,
  forma: formaMcpConfig
}), record);
```

改为：

```typescript
await this.writeJsonConfig(platform, join(this.userHome, ".claude", "mcp.json"), (config) => {
  const next = { ...config };
  delete next.forma; // 清理旧版错误写入的顶层 forma
  return {
    ...next,
    mcpServers: { ...asRecord(next.mcpServers), forma: this.mcpCommand }
  };
}, record);
```

> 注：`this.mcpCommand` 由功能六引入，替代原硬编码的 `formaMcpConfig` 常量。

#### uninstallMcpConfig — Claude 分支

将：

```typescript
const config = await readJsonObject(configPath);
delete config.forma;
if (Object.keys(config).length > 0) {
  await writeJsonObject(configPath, config);
} else {
  await rm(configPath, { force: true });
}
```

改为：

```typescript
const config = await readJsonObject(configPath);
delete config.forma; // 清理旧版错误写入的顶层 forma
const mcpServers = asRecord(config.mcpServers);
delete mcpServers.forma;
if (Object.keys(mcpServers).length > 0) {
  config.mcpServers = mcpServers;
} else {
  delete config.mcpServers;
}
if (Object.keys(config).length > 0) {
  await writeJsonObject(configPath, config);
} else {
  await rm(configPath, { force: true });
}
```

#### mergeClaudeConfigBackup

将：

```typescript
function mergeClaudeConfigBackup(currentContent: string, backupContent: string, file: string): string {
  const current = parseJsonObject(currentContent, file);
  const backup = parseJsonObject(backupContent, file);
  const currentWithoutForma = { ...current };
  delete currentWithoutForma.forma;
  return formatJsonLikeBackup({ ...backup, ...currentWithoutForma }, backupContent);
}
```

改为：

```typescript
function mergeClaudeConfigBackup(currentContent: string, backupContent: string, file: string): string {
  const current = parseJsonObject(currentContent, file);
  const backup = parseJsonObject(backupContent, file);
  const currentMcpServers = { ...asRecord(current.mcpServers) };
  delete currentMcpServers.forma;
  const currentTopLevel = { ...current };
  delete currentTopLevel.mcpServers;
  delete currentTopLevel.forma; // 清理旧版错误写入的顶层 forma
  const merged = { ...backup, ...currentTopLevel };
  delete merged.forma; // 确保 backup 中的旧顶层 forma 也不保留
  const backupMcpServers = asRecord(backup.mcpServers);
  const mergedMcpServers = { ...backupMcpServers, ...currentMcpServers };
  if (Object.keys(mergedMcpServers).length > 0) {
    merged.mcpServers = mergedMcpServers;
  } else {
    delete merged.mcpServers;
  }
  return formatJsonLikeBackup(merged, backupContent);
}
```

#### 当前配置缺失时的 Claude 备份恢复

`uninstallMcpConfig` 当前逻辑在配置文件缺失且存在 backup 时会直接 `copyFile(backup, configPath)`。Claude 分支不能继续这样做，因为 backup 里可能保存了旧版错误写入的顶层 `forma`。

规则改为：

- 如果 `configPath` 缺失且 platform 是 `claude`，不要直接复制 backup。
- 读取 backup JSON，删除顶层 `forma`。
- 保留 backup 中合法的 `mcpServers` 配置，包括用户原本已有的 `mcpServers.forma`。
- 如果清理后对象为空，不恢复 `~/.claude/mcp.json`。

也就是说，旧版顶层 `forma` 一律视为 Forma 历史错误残留，不再作为用户配置恢复；合法的 `mcpServers.forma` 仍按用户配置保留。

### 验证

```bash
pnpm test -- packages/core/tests/install.test.ts
```

测试需要覆盖：

- 安装后 `~/.claude/mcp.json` 写入 `mcpServers.forma`，不再写入顶层 `forma`。
- 卸载无 backup 的 Claude 配置时，同时删除顶层 `forma` 和 `mcpServers.forma`，保留其他 `mcpServers`。
- 卸载并合并 backup 时，backup 和 current 中的顶层 `forma` 都被删除，backup 中合法的 `mcpServers.forma` 被保留。
- 当前配置文件缺失但 backup 存在时，Claude 备份恢复仍会清理顶层 `forma`。

安装后确认 `~/.claude/mcp.json` 的结构在两种环境下都正确：

`forma` 在 PATH 上：

```json
{
  "mcpServers": {
    "forma": { "command": "forma", "args": ["mcp"] }
  }
}
```

`forma` 不在 PATH 上：

```json
{
  "mcpServers": {
    "forma": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/packages/cli/bin/forma.js", "mcp"]
    }
  }
}
```

验收只固定结构和语义，不固定 command 一定是 `"forma"`。`command` 取值由功能六的 `resolveFormaMcpCommand()` 决定。

### 注意

修复后重新执行 `forma install --platform claude` 即可自动清理顶层 `forma` 并写入 `mcpServers.forma`。不要求用户手动迁移。

---

## 功能二：fm-list-product 展示简化 + 交互选择

### 问题

Agent 执行 `fm-list-product` 时展示过多产品详情（platform、style、languages 等），用户难以快速选择。

### 变更

Agent 模板（claude/codex/gemini 三平台）的 `fm-list-product` 执行步骤改为：

```markdown
Execution:
1. Call MCP `list_products` to get product list.
2. Display products as a numbered list, each line only showing: `序号. 产品名 (产品ID)`
   Example:
   ```
   1. 我的App (P-a3f8b2)
   2. 商城项目 (P-c7d1e4)
   ```
3. Ask user to select by number.
4. After selection, call `set_current_session` with the chosen product_id.
5. If `PRODUCT_CONFIG_INCOMPLETE` returned, handle missing fields per shared guidance.
6. When session is set successfully, fetch and display latest requirement summary.
7. Report stable error codes when returned.
```

`set_current_session` 在功能三之后只检查 `platform`、`style`、`languages`。其中 `languages` 字段的检查仍包含 `default_language` 是否存在、是否在 `languages` 内。因此 `fm-list-product` 只负责产品选择和基础配置补全，不再触发组件生成，也不再要求用户确认 default language 用于组件生成。

### 涉及文件

- `packages/agent/templates/claude/fm-list-product.md`
- `packages/agent/templates/codex/fm-list-product/SKILL.md`
- `packages/agent/templates/gemini/fm-list-product.toml`
- `packages/cli/tests/copy-assets.test.ts` — 断言同步更新
- `docs/AGENT.md` — 同步 `fm-list-product` 只展示编号列表并选择产品，不再展示完整配置状态

### 验证

```bash
pnpm test -- packages/cli/tests/copy-assets.test.ts
```

确认模板内容更新后，Agent 展示产品列表时只显示名称和 ID，用户通过编号选择。

> **注意**：`copy-assets.test.ts` 中对 `fm-list-product` 模板的断言（检查 `"missing languages"` 和 `"confirm default language"`）需同步更新，因为功能三会移除 "confirm default language" 相关内容。
> 新断言应检查编号选择、`list_products`、`set_current_session`、`latest requirement summary` 等内容；不再检查组件生成或 default language 确认文案。

---

## 功能三：组件初始化检查从 set_current_session 移至 fm-design

### 问题

`set_current_session` 检查 `["platform", "style", "languages", "components_initialized"]`，导致用户在 Web 后台配好 platform/style/languages 后，首次选择产品仍因组件未初始化而失败。组件初始化是设计生成的前置条件，不是选择产品的前置条件。

### 变更

#### 1. session.ts — 移除 components_initialized 检查

文件：`packages/core/src/session.ts`

将：

```typescript
assertProductConfig(product, productId, ["platform", "style", "languages", "components_initialized"]);
```

改为：

```typescript
assertProductConfig(product, productId, ["platform", "style", "languages"]);
```

#### 2. fm-design 模板 — 增加组件初始化兜底

三平台模板（claude/codex/gemini）的 `fm-design` 执行步骤改为：

```markdown
Execution:
1. Read current session through MCP.
2. Fetch latest requirement.
3. If `ui_affected === false`, print `当前需求无 UI 调整，无需设计` and stop.
4. Call `generate_page_design` or `generate_components` as needed.
   - If `PRODUCT_CONFIG_INCOMPLETE` returned with missing `components_initialized`:
     a. Confirm default language with user before continuing.
     b. Call `generate_components` with product config and default_language in prompt.
     c. Call `complete_product_init`.
     d. Retry the design generation.
5. Inject exact structured page copy into design prompts. Pencil/design generation must use exact structured page copy and must not improvise text.
6. Map `change_type` as `new -> generate`, `patch -> refine`, and `rebuild -> update`.
7. Confirm operation with product, requirement, and pending or expired pages, call Forma MCP tools, and report stable error codes when returned.
```

#### 3. fm-list-product 模板 — 移除组件生成相关内容

功能二已将 fm-list-product 模板重写为简化版本，不再包含以下内容（无需额外删除）：
- "When the user selects a product for component generation, confirm default language before continuing."
- "Use default language in component-generation prompt so generated components and labels match product language config."

`copy-assets.test.ts` 中对 `"confirm default language"` 的断言需更新为检查新模板内容。

### 涉及文件

- `packages/core/src/session.ts`
- `packages/core/tests/product-session-style.test.ts` — 断言从 `["platform", "style", "languages", "components_initialized"]` 改为 `["platform", "style", "languages"]`
- `packages/web/src/pages/ProductList.tsx` — `isListConfigurationComplete` 移除 `components_initialized` 条件，改为只检查 platform + style + languages + default_language。这个状态只表示“产品可被选择”，不表示组件库已经初始化。若 UI 文案出现 `Initialized`，需改为 `Configured` 或 `Ready for selection`，避免和组件初始化混淆。
- `packages/web/src/pages/ProductList.test.tsx` — 同步更新配置完整性断言
- `packages/agent/templates/claude/fm-design.md`
- `packages/agent/templates/codex/fm-design/SKILL.md`
- `packages/agent/templates/gemini/fm-design.toml`
- `packages/agent/templates/claude/fm-list-product.md`
- `packages/agent/templates/codex/fm-list-product/SKILL.md`
- `packages/agent/templates/gemini/fm-list-product.toml`
- `docs/MCP.md` — 产品配置完整性改为 platform/style/languages/default_language；组件初始化改为设计生成前置条件
- `docs/AGENT.md` — First-Time Setup Flow 同步：选择产品不要求组件已初始化，组件初始化由 fm-design 兜底触发

### 验证

```bash
pnpm test -- packages/core/tests
pnpm test -- packages/cli/tests/copy-assets.test.ts
pnpm test -- packages/web/src/pages/ProductList.test.tsx
```

确认：
- 选择已配置 platform/style/languages 的产品时 `set_current_session` 成功
- 产品列表中已配置 platform/style/languages/default_language 但 `components_initialized=false` 的产品显示为可选择/配置完整
- 首次执行 `fm-design` 时，若组件未初始化，Agent 触发组件生成流程
- `docs/AGENT.md` 不再描述 `fm-list-product` 负责展示完整配置状态或组件生成确认
- `docs/MCP.md` 不再写“产品配置完整必须包含 component initialization”

---

## 功能四：风格样式可视化增强

### 问题

1. **列表页 StyleCard**：只有一个 8x8 颜色小方块，无法直观区分不同风格
2. **新建产品页 ProductNew**：风格只能通过原生 select 选择，只能看到名字，无法判断它在当前产品类型下的实际效果
3. **详情页 StyleDetail**：variables 以纯键值对展示，DESIGN.md 以原始文本展示，无法感知风格实际效果
4. **数据利用不足**：多数新版 DESIGN.md 的 frontmatter 中包含完整颜色体系、字体层级、圆角层级、间距层级、组件样式定义，但当前只提取了 7 个基础变量；旧格式 DESIGN.md 仍可能只有纯文本说明，需要可降级渲染

### 变更

#### 1. StyleCard 列表卡片 — 迷你色板 + 字体预览

将单个颜色方块替换为一个迷你风格预览区：

```
┌─────────────────────────────────────┐
│ ┌───────────────────────────────┐   │
│ │  background 色底              │   │
│ │  ┌─primary─┐ ┌─text-primary─┐│   │
│ │  └─────────┘ └──────────────┘│   │
│ │  "Heading" (font-heading)     │   │
│ │  "Body text" (font-body)      │   │
│ └───────────────────────────────┘   │
│ Style Name                          │
│ Description...                      │
└─────────────────────────────────────┘
```

实现：在 StyleCard 内部用 inline style 渲染一个 48px 高的迷你预览条，展示：
- 背景色（background）
- 两个色块（primary + text-primary）
- 一行标题字体示例（font-heading 直接作为 CSS font-family 值应用）
- 圆角应用 border-radius 变量

#### 2. StylePreviewPanel 详情组件 — 解析 DESIGN.md 渲染丰富预览

新建 `packages/web/src/components/StylePreviewPanel.tsx`。

**数据源**：前端已通过 `getStyle` 获取完整 `designMd` 字符串。StylePreviewPanel 在前端解析 DESIGN.md 的 YAML-like frontmatter，提取：
- `colors`：完整颜色体系
- `typography`：所有字体层级（fontFamily、fontSize、fontWeight、lineHeight）
- `rounded`：所有圆角层级
- `spacing`：所有间距层级
- `components`：组件级样式定义

**解析器**：新建 `packages/web/src/utils/parseDesignMd.ts`，将 DESIGN.md 的 YAML-like frontmatter 解析为结构化对象。不引入 YAML 库，用简单的缩进解析；解析范围只限 `---` frontmatter 中的 `colors`、`typography`、`rounded`、`spacing`、`components`。

解析器必须支持以下兜底规则：

- 如果 DESIGN.md 没有 frontmatter，或没有上述结构化字段，返回空结构，不抛错。现有 `styles/linear/DESIGN.md` 属于这种情况。
- 如果某个字段解析失败，只丢弃该字段，其他字段继续使用。
- 支持 key 中包含字母、数字、连字符、下划线和点号，例如 `display-2xl`、`body_md`、`surface.raised`。不能只匹配字母开头的 key。
- 只承诺解析 2 空格缩进的对象层级和普通 scalar 值，包括带引号字符串、未加引号字符串、数字、`transparent`、`0`、`9999px` 这类 token 值。
- block scalar（`|` / `>`）、数组、复杂嵌套对象、跨行字符串和未知 section 不进入结构化 token；解析器跳过它们并记录 warning。
- parser 返回值包含 `warnings: string[]`。UI 使用 fallback 时不静默吞掉原因，StylePreviewPanel 在预览区底部显示非阻塞提示，例如 `Partial style parsing, fallback variables used`。
- `"{colors.primary}"`、`"{typography.body-md}"`、`"{rounded.lg}"` 这类 token 引用在渲染层解析；解析器只保留原始值。
- UI 渲染时先用解析出的结构化 token；缺失时回退到 metadata 中已有的 7 个基础变量：`primary`、`background`、`text-primary`、`font-heading`、`font-body`、`border-radius`、`spacing-unit`。
- 不新增 YAML 依赖，也不要求把所有历史 DESIGN.md 改成 frontmatter。

**产品类型切换**：面板顶部提供产品类型 tab 切换（mobile / desktop / tablet / web），不同类型渲染不同的通用模板：

| 产品类型 | 模板内容 |
|----------|----------|
| mobile | 手机壳框架内：顶部导航栏 + 搜索栏 + 卡片列表 + 底部 tab bar |
| desktop | 宽屏布局：侧边栏 + 顶部 header + 内容区卡片网格 |
| tablet | 中等宽度：分栏布局 + 列表/详情 |
| web | 全宽：顶部导航 + hero 区 + 三列特性卡片 + footer |

每个模板中的 UI 元素直接使用 DESIGN.md 中解析出的样式：
- 按钮优先使用组件名包含 `button-primary` 的定义；没有时使用第一个包含 `button` 的组件；仍没有时回退到基础 7 变量
- 卡片使用对应的 rounded、spacing、surface 颜色
- 标题使用 `typography.display-lg` 或 `typography.title-md`
- 正文使用 `typography.body-md`
- 导航栏优先使用组件名包含 `nav` 的定义，比如 `top-nav`、`global-nav`、`nav-bar-on-mesh`
- 缺失的组件定义 fallback 到基础 7 变量

**布局结构**：

```
┌─ StylePreviewPanel ──────────────────────────────────────┐
│                                                          │
│  [Mobile] [Desktop] [Tablet] [Web]  ← 产品类型 tab      │
│                                                          │
│  ┌─ Preview Area ──────────────────────────────────────┐ │
│  │                                                      │ │
│  │  (根据选中的产品类型渲染对应模板)                      │ │
│  │  所有颜色、字体、圆角、间距从 DESIGN.md 实时应用       │ │
│  │                                                      │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Color Palette ─────────────────────────────────────┐ │
│  │  ■ primary  ■ ink  ■ muted  ■ canvas  ■ surface ... │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Typography Scale ──────────────────────────────────┐ │
│  │  display-xl: 28px/700  "The quick brown fox"         │ │
│  │  title-md:   16px/600  "The quick brown fox"         │ │
│  │  body-md:    16px/400  "The quick brown fox"         │ │
│  │  caption:    14px/500  "The quick brown fox"         │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Spacing & Radius ─────────────────────────────────┐  │
│  │  xs:4  sm:8  md:12  base:16  lg:24  xl:32          │  │
│  │  ◻xs  ◻sm  ◻md  ◻lg  ◻xl  ●full                   │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**字体渲染**：样式变量中的 font-family 值直接作为 CSS `font-family` 属性应用。不动态加载 Google Fonts——变量本身已是完整 font stack，浏览器按 stack 顺序 fallback。

#### 3. StyleDetail 页面集成

StylePreviewPanel 与现有 preview PNG 的关系：
- 如果服务端 preview PNG 存在：顶部展示 PNG 图片，下方展示 StylePreviewPanel 作为交互式变量可视化
- 如果 preview PNG 不存在：StylePreviewPanel 替代 "Preview unavailable" 占位区域

即 StylePreviewPanel 始终展示（它是变量的实时渲染，不依赖服务端），PNG 是额外的静态预览。两者并存，不互斥。

#### 4. ProductNew 风格选择器 — 平台感知预览

新建产品时，风格选择不再使用原生 select。改为“已选风格摘要 + 更换风格”入口，打开一个平台感知的选择弹窗。

交互结构：

```
ProductNew
  platform 选择
      │
      ▼
  StylePickerDialog
    左侧：搜索框 + 风格列表/迷你卡片
    右侧：StylePreviewPanel，previewType 固定等于当前 platform
      │
      ▼
  点击“使用此风格”后回填 selected style
```

具体行为：

1. 用户先选择产品类型：web / mobile / desktop / tablet。
2. 风格字段显示为一个摘要卡片：
   - 未选择时显示“选择风格”入口和 2-3 个推荐/最近风格的迷你预览。
   - 已选择时显示风格名、描述、迷你色板，以及“更换风格”按钮。
3. 点击入口打开弹窗。左侧展示可搜索的风格列表，每一项复用 StyleCard 的迷你预览能力，至少显示名称、描述、主色、背景、标题/正文字体。
4. 右侧展示 `StylePreviewPanel`。它不再显示产品类型 tab，而是由 ProductNew 传入 `previewType={platform}`，强制使用用户选中的产品类型模板。
5. 点击左侧风格只更新右侧预览和候选状态，不立即改表单值。点击“使用此风格”后才写入 `styleName`。
6. 如果用户切换产品类型，已选风格保留，但摘要和弹窗中的预览模板跟随新 platform 切换。
7. 如果用户还没选 platform，风格入口禁用，并提示先选择产品类型。这样 previewType 不会落到默认值。

数据与性能：

- ProductNew 当前只调用 `listStyles()`，它只能拿到 metadata 和 7 个基础变量。弹窗右侧需要完整 `designMd`，因此 ProductNew client 需要增加现有 API `getStyle(name)`。
- `getStyle` 只在用户点击/键盘 focus 某个风格时触发，不在打开弹窗时批量拉取所有 DESIGN.md。
- 按 style name 做前端缓存。用户来回切换同一风格时复用已加载的 detail。
- detail 加载前先用 metadata 的 7 个基础变量渲染降级预览，加载完成后无闪烁替换为完整 token 预览。
- `getStyle` 失败时保留降级预览，并在右侧显示轻量错误提示，不阻塞用户选择该风格。

可访问性：

- 弹窗使用 `role="dialog"` 和明确标题。
- 左侧列表支持键盘上下移动和 Enter 预览。
- “使用此风格”是唯一会提交选择的主按钮，Esc/关闭按钮不修改当前表单值。

### 涉及文件

- `packages/web/src/components/StyleCard.tsx` — 迷你色板改造
- `packages/web/src/components/StyleCard.test.tsx` — 覆盖迷你预览使用颜色、字体和 fallback 变量
- `packages/web/src/components/StylePreviewPanel.tsx` — 新建
- `packages/web/src/components/StylePreviewPanel.test.tsx` — 新建，覆盖模板切换、fallback、warning 提示和组件 heuristic
- `packages/web/src/components/StylePickerDialog.tsx` — 新建，ProductNew 使用的平台感知风格选择弹窗
- `packages/web/src/components/StylePickerDialog.test.tsx` — 新建，覆盖键盘预览、候选状态和确认提交
- `packages/web/src/utils/parseDesignMd.ts` — 新建，DESIGN.md 前端解析器
- `packages/web/src/utils/parseDesignMd.test.ts` — 新建，覆盖 frontmatter、数字/连字符/下划线/点号 key、block scalar warning 和复杂结构跳过
- `packages/web/src/pages/StyleDetail.tsx` — 集成 PreviewPanel
- `packages/web/src/pages/StyleDetail.test.tsx` — 更新静态 preview PNG 与 StylePreviewPanel 并存/替代逻辑
- `packages/web/src/pages/ProductNew.tsx` — 将风格 select 替换为 StylePickerDialog 入口，传入当前 platform 作为 previewType
- `packages/web/src/pages/ProductNew.test.tsx` — 覆盖平台未选时禁用、选择风格确认、切换 platform 后预览模板更新
- `packages/web/src/i18n.ts` — 增加风格弹窗、parser warning、加载失败和确认按钮的中英文文案
- `packages/web/src/i18n.test.ts` — 覆盖新增文案 key，避免缺失语言导致 UI 回退到裸 key

### 验证

```bash
pnpm test -- packages/web
```

新增或更新测试时需覆盖：

- 有 frontmatter 的 DESIGN.md 能解析 `colors`、`typography`、`rounded`、`spacing`、`components`。
- 无 frontmatter 的 DESIGN.md 返回空结构，StylePreviewPanel 仍使用 7 个基础变量渲染，不显示错误态。
- 组件名不叫 `button-primary` 或 `top-nav` 时，heuristic 能选中可用的 button/nav 组件。
- parser 遇到 block scalar、未知复杂结构、无法解析的 section 时返回 warning，UI 显示非阻塞 fallback 提示。
- key 以数字或包含连字符/下划线/点号时不会被丢弃。
- ProductNew 未选择 platform 时不能打开风格选择；选择 platform 后打开弹窗，右侧模板与 platform 一致。
- ProductNew 点击左侧风格只改变候选预览，点击“使用此风格”后才写入表单选择。

手动验证：
- 列表页卡片色板可视化
- 详情页 PreviewPanel 正确解析 DESIGN.md 并渲染完整颜色、字体、圆角、间距
- 产品类型 tab 切换后模板布局变化，样式保持一致
- 新建产品页选择不同产品类型时，风格弹窗右侧预览模板随产品类型变化

---

## 功能五：后台管理页面视觉与交互优化

### 当前状态

- 卡片纯白底 + 1px 边框，视觉层次弱
- 交互仅有 hover 变色和 active:scale-95，无过渡动画
- 空状态/加载态纯文字
- 侧边栏和内容区视觉区分不够明显
- 无 loading skeleton，页面加载时跳动

### 优化范围

#### 1. 全局视觉层次

| 元素 | 当前 | 优化后 |
|------|------|--------|
| 侧边栏 | `bg-[#fbfbfc]` 平面 | 微渐变底色 + 更明显的分割线 |
| 内容区 header | `bg-[#fdfdfd]/95` | 加 `shadow-sm` 底部阴影，增强浮层感 |
| 卡片 | `border-zinc-200 bg-white shadow-sm` | hover 时 `shadow-md` + `border-amber-100` 过渡，增加 `transition-all duration-200` |
| 按钮 | 无过渡 | 统一 `transition-all duration-150` |

#### 2. Loading Skeleton

新建 `packages/web/src/components/Skeleton.tsx`：

- `SkeletonCard`：卡片形状的脉冲占位（`animate-pulse`）
- `SkeletonList`：3 个 SkeletonCard 组成的网格
- `SkeletonDetail`：左右两栏的骨架屏

替换当前 `StatePanel state="loading"` 的纯文字展示。

#### 3. ProductCard 视觉增强

- 左侧加一条 4px 宽的竖色条，颜色映射配置状态：
  - `configured` → emerald
  - `configuration_incomplete` → amber
  - `not_loaded` → zinc
- 产品名加粗加大（`text-base`），ID 用 `font-mono text-xs` 弱化
- 需求数和状态用 inline badge 展示，不用 dl/dt/dd 表格布局

这里的 `configured` 只表示 platform/style/languages/default_language 已完整，产品可以被 Agent 选中；不要继续使用 `initialized` 命名，避免误解为组件库已经初始化。

#### 4. 侧边栏导航增强

- 当前激活项加左侧 3px amber 色条指示器
- 导航项增加图标（Products 用文件夹 SVG，Styles 用调色板 SVG），使用 inline SVG 确保无外部依赖

#### 5. 空状态视觉

- 空状态增加插图/图标（简单 SVG 线条画）
- 引导文案加粗，操作按钮更突出

#### 6. 页面切换过渡

- 内容区切换时加 `opacity` 淡入（CSS `@keyframes fadeIn`）
- 避免 JS 动画库依赖，纯 CSS 实现

### 不做的事

- 不引入新 UI 组件库（保持 Tailwind 手写）
- 不改变路由结构和数据流
- 不增加新的 API 调用
- 不改变业务断言逻辑。加载态从纯文字变为 skeleton 后，涉及 `StatePanel state="loading"` 文案的测试需要同步改为检查 skeleton 结构或可访问标签；这属于 UI 呈现断言更新，不是业务逻辑变更。

### 涉及文件

- `packages/web/src/styles.css` — 全局动画 keyframes
- `packages/web/src/components/Layout.tsx` — 侧边栏、header 视觉调整
- `packages/web/src/components/Skeleton.tsx` — 新建
- `packages/web/src/components/StyleCard.tsx` — 已在功能四覆盖
- `packages/web/src/pages/ProductList.tsx` — ProductCard 视觉增强 + skeleton
- `packages/web/src/pages/ProductNew.tsx` — 风格选择入口视觉升级，具体预览逻辑归属功能四
- `packages/web/src/pages/ProductDetail.tsx` — skeleton
- `packages/web/src/pages/StyleLibrary.tsx` — skeleton
- `packages/web/src/pages/StyleDetail.tsx` — 已在功能四覆盖

### 验证

```bash
pnpm test -- packages/web
```

手动验证：
- 页面加载时显示骨架屏而非纯文字
- 卡片 hover 有平滑阴影过渡
- 侧边栏激活项有色条指示
- 空状态有视觉引导

---

## 功能六：MCP 配置自动解析 forma 可执行路径

### 问题

`forma install` 写入 MCP 配置时硬编码 `command: "forma"`，但开发阶段 `forma` CLI 未全局安装（不在 PATH 上），导致所有平台的 MCP server 启动失败。部分 MCP 客户端不是从交互式 shell 启动，即使本机有 `node`，也不能假设 `node` 一定在客户端 PATH 中。

```
MCP client for `forma` failed to start: MCP startup failed: No such file or directory (os error 2)
```

### 变更

#### 1. InstallServiceOptions 新增 mcpCommand 选项

文件：`packages/core/src/install.ts`

```typescript
export interface InstallServiceOptions {
  formaHome?: string;
  userHome?: string;
  templatesDir?: string;
  mcpCommand?: { command: string; args: string[] };
}
```

`InstallService` 构造时保存 `mcpCommand`，`installMcpConfig` 中使用它替代硬编码的 `formaMcpConfig` 常量。

默认值为 `{ command: "forma", args: ["mcp"] }`，这样直接在 core 测试或外部代码中构造 `new InstallService()` 时仍保持原行为。CLI 会显式传入解析后的 `mcpCommand`。

#### 2. CLI 负责解析并传入 mcpCommand

文件：`packages/cli/src/index.ts`

CLI 已有 `packageCliEntrypoint()` 返回 `packages/cli/bin/forma.js` 的绝对路径。在构造 `installServiceOptions` 时增加：

```typescript
const installServiceOptions = {
  formaHome,
  templatesDir: packageAgentTemplatesDir(),
  mcpCommand: resolveFormaMcpCommand()
};

function resolveFormaMcpCommand(): { command: string; args: string[] } {
  if (isOnPath("forma")) {
    return { command: "forma", args: ["mcp"] };
  }
  return { command: process.execPath, args: [packageCliEntrypoint(), "mcp"] };
}
```

`resolveCliEnv` 当前是同步函数，因此 `resolveFormaMcpCommand` 也保持同步，避免把 CLI runtime 初始化改成异步链路。`isOnPath` 可通过 `spawnSync("which", ["forma"], { stdio: "ignore" })` 或等价同步实现完成，失败则回退到 `process.execPath`。

#### 3. 三平台写入逻辑统一使用 mcpCommand

- **Claude JSON**：`mcpServers.forma` 的值直接使用 `this.mcpCommand`
- **Gemini JSON**：同上
- **Codex TOML**：`appendCodexManagedSection` 改为接收 `mcpCommand` 参数，动态生成 TOML：

```typescript
function appendCodexManagedSection(content: string, mcpCommand: { command: string; args: string[] }): string {
  const trimmed = content.trimEnd();
  const commandToml = JSON.stringify(mcpCommand.command);
  const argsToml = JSON.stringify(mcpCommand.args);
  const section = `${codexMcpStart}
[mcp_servers.forma]
command = ${commandToml}
args = ${argsToml}
${codexMcpEnd}
`;
  return trimmed ? `${trimmed}\n\n${section}` : section;
}
```

`command` 和 `args` 都用 `JSON.stringify` 生成 TOML 字符串/数组，避免绝对路径中出现空格、反斜杠或引号时写出非法 TOML。

#### 4. 删除顶层 formaMcpConfig 常量

不再需要 `const formaMcpConfig = { command: "forma", args: ["mcp"] }`，由实例属性 `this.mcpCommand` 替代。

### 涉及文件

- `packages/core/src/install.ts` — InstallServiceOptions 扩展 + 三平台写入逻辑改用动态 mcpCommand
- `packages/cli/src/index.ts` — 新增 `resolveFormaMcpCommand()` 并传入 installServiceOptions
- `packages/core/tests/install.test.ts` — 更新 Claude 配置结构、backup 合并、动态 mcpCommand 断言；删除旧顶层 `forma` 可恢复的断言
- `packages/cli/tests/cli.test.ts` — 更新 install service options 断言，确认 CLI 传入 `mcpCommand`

### 验证

```bash
pnpm test -- packages/core/tests/install.test.ts
pnpm test -- packages/cli/tests/cli.test.ts
```

验证内容：

- core install test 覆盖三平台使用传入的 `mcpCommand`。
- core install test 不再恢复 Claude 顶层 `forma`。
- CLI test 覆盖 `createInstallService` 收到 `mcpCommand`。
- 在未全局安装 forma 的环境下执行 `node bin/forma.js install --platform codex`，确认 `~/.codex/config.toml` 中生成的是 `command = process.execPath` 的绝对路径 + CLI bin 绝对路径形式。同样验证 Claude 和 Gemini 配置。

---

## 功能七：产品删除与二次确认

### 问题

Web 后台可以创建产品，但没有删除产品的入口。开发和试验过程中会产生临时产品，用户只能手动清理 Forma home 里的文件，容易漏删索引、组件库或 session。

### 边界

- 只新增产品删除能力。
- 不新增需求删除 API。
- 不新增需求删除 MCP tool。
- 不新增需求删除 Web 入口。
- 如果暴露 MCP，只暴露 `delete_product`，不暴露 `delete_requirement`。
- 产品删除会级联清理该产品名下的数据，包括需求、基线、设计稿记录、页面 copy、组件库等；这些数据不能被单独删除。

### 变更

#### 1. Core 删除编排

产品删除不能由 `ProductService.deleteProduct()` 直接 `rm` 多个路径。Core 必须在 `createFormaStore()` 返回值上暴露单一编排入口，Server、MCP 和 Web 都只能通过这个入口删除产品：

```typescript
type DeleteProductInput = {
  product_id: string;
  confirm_product_id: string;
};

type DeleteProductResult = {
  product_id: string;
  deleted: true;
  session_cleared: boolean;
  cleanup_pending: boolean;
  recovery_warnings: string[];
};

type ProductDeletionRecoveryResult = {
  recovered: number;
  cleaned: number;
  warnings: string[];
};

type ProductDeletionState = {
  schema_version: 1;
  operation_id: string;
  product_id: string;
  created_at: string;
  updated_at: string;
  committed: boolean;
  phase: "created" | "backed_up" | "session_written" | "index_written" | "moved" | "committed";
  backups: {
    products_yaml: "backups/products.yaml";
    session_yaml?: "backups/session.yaml";
  };
  moved_paths: Array<{
    kind: "product_data" | "component_library";
    original_path: string; // relative to formaHome
    staged_path: string;   // relative to operation dir
    required: boolean;
  }>;
  missing_paths: string[];
  session_was_current: boolean;
  warnings: string[];
};

type ProductMutationContext = {
  operation: string;
  product_id?: string;
  warnings: string[];
};

type GenerateComponentsInput = {
  product_id: string;
  prompt: string;
  workspace: string;
};

deleteProduct(input: DeleteProductInput): Promise<DeleteProductResult>;
recoverPendingProductDeletes(): Promise<ProductDeletionRecoveryResult>;
generateComponents(input: GenerateComponentsInput): Promise<GeneratedComponents>;
runProductMutation<T>(
  input: { operation: string; product_id?: string },
  fn: (context: ProductMutationContext) => Promise<T>
): Promise<T>;
```

确认规则：

- `confirm_product_id` 必须等于 `product_id`。
- Core 新增 `INVALID_INPUT` 到 `FormaErrorCode`。
- `store.deleteProduct` 必须先做纯输入校验：`confirm_product_id` 缺失或不匹配时，直接抛 `FormaError("INVALID_INPUT", ...)`。
- 纯输入校验失败时，不获取 product mutation lock，不调用 `recoverPendingProductDeletesLocked()`，不校验产品是否存在，也不进入任何文件操作。
- 删除不存在的产品在纯输入校验通过、抢到 lock 并完成 pending deletion recovery 后抛 `PRODUCT_NOT_FOUND`。

入口错误码决策：

- Core 层使用 `INVALID_INPUT`，因为当前 `packages/core/src/errors.ts` 没有 `VALIDATION_ERROR`，新增后也应和 Server 输入错误命名保持一致。
- Server 层继续使用现有 `RouteInputError`，返回 `error_code = "INVALID_INPUT"` 和 HTTP 400；不要在 Server 删除接口里返回 `VALIDATION_ERROR`。
- MCP 层继续沿用现有 wrapper 行为：tool schema 解析失败或 `.refine()` 发现 `confirm_product_id !== product_id` 时返回 `VALIDATION_ERROR`。这只表示 MCP tool 入参 schema 错误，不要求 Core 增加同名错误码。

#### 2. Product mutation lock

所有以 `productId` 为作用域、会写 `data/<productId>/**`、`library/<productId>.lib.pen`、`data/products.yaml` 或 `session.yaml` 的入口，都必须通过同一个 product mutation lock 串行化。否则删除移动整个产品目录时，仍可能和需求保存、设计保存、copy 翻译、组件生成或 session 切换并发，造成半删除、丢写或恢复覆盖。

实现要求：

- 新增 `packages/core/src/product-mutation-lock.ts`，不引入外部依赖。
- `createFormaStore()` 构造一个 `ProductMutationLock` 实例，并把同一个实例传给 `ProductService`、`SessionService`、`BaselineService`、`CopyService`、`RequirementService`、`DesignService`、`PencilService` 和 store 级删除编排。
- `createFormaStore()` 返回值必须新增 `generateComponents()` 和 `runProductMutation()`。
- `PencilService` 保持低层 Pencil 适配器，不负责读取产品配置。组件生成的业务编排只放在 `store.generateComponents()`：加 product mutation lock、重新读取产品配置、校验 `platform/style/languages`、调用低层 Pencil 生成组件库。
- `createFormaStore()` 可以接受测试用 `pencilService` 注入，但该实例只由 `store.generateComponents()` 调用；不能把低层 `PencilService` 直接暴露给 MCP 绕过 store 编排。
- lock 作用域是单个 `formaHome`，锁路径固定为 `<formaHome>/tmp/locks/product-mutations.lock`。
- 用 `mkdir` 原子创建 lock 目录获取跨进程锁，并写入 `owner.json`，包含 `pid`、`operation`、`product_id`、`created_at`、`updated_at`。
- 同一进程内也走同一队列，避免两个 async 调用同时争抢文件锁。
- 获取 lock 后必须用 `try/finally` 释放；释放失败要记录 warning。
- 固定参数：
  - stale 阈值：120000ms。`owner.json.updated_at` 距当前时间超过 120000ms 时视为 stale。
  - 等待超时：30000ms。超过后抛 `FormaError("PRODUCT_MUTATION_LOCKED", ...)`。
  - 重试间隔：100ms，允许最多 25ms jitter，避免多进程同步重试。
  - 心跳：持有 lock 时每 5000ms 原子更新 `owner.json.updated_at`；每次进入删除事务 phase 变化前也更新一次。
- 如果发现 lock 目录残留，先读取 `owner.json`：owner 进程不存在或 `updated_at` 超过 stale 阈值时，可以移除 stale lock，并把该事件加入 warning；owner 仍存活且未超时则继续等待。
- 如果 lock 长时间无法获取，抛 `FormaError("PRODUCT_MUTATION_LOCKED", ...)`，`details` 至少包含 `operation`、`product_id`、`lock_path`、`waited_ms`。`packages/core/src/errors.ts` 同步增加该错误码。
- Server `statusForError` 必须把 `PRODUCT_MUTATION_LOCKED` 映射为 HTTP 409。MCP 透传 `error_code = "PRODUCT_MUTATION_LOCKED"`，Web 显示可重试提示。
- lock 只保护 mutation，不包住纯读接口。

必须串行化的入口：

- `ProductService.createProduct`
- `ProductService.initProductConfig`
- `ProductService.markComponentsInitialized`
- `SessionService.setCurrentProduct`
- `RequirementService.createEmptyRequirement`
- `RequirementService.submitRequirement`
- `RequirementService.updateRequirement`
- `RequirementService.saveRequirement`
- `RequirementService.archiveRequirement`
- `BaselineService.updateFromRequirement`
- `CopyService.saveTranslations`
- `CopyService.updatePageTranslations`
- `CopyService.mergeTranslations`
- `DesignService.saveDesigns`
- `DesignService.rollbackDesign`
- `DesignService.exportDesignAsset`
- `store.generateComponents`
- `store.deleteProduct`
- `store.recoverPendingProductDeletes`

上面这些 public mutation 方法负责抢锁，然后调用对应 locked helper。服务之间的内部调用不能重复抢锁，必须传入已持有的 lock context，避免死锁。例如 `RequirementService.submitRequirement` / `updateRequirement` / `saveRequirement` 抢锁后调用 `BaselineService.updateFromRequirementLocked` 和 `CopyService.saveTranslationsLocked`；`CopyService.updatePageTranslations` 必须把读取旧翻译、合并 entry、写回新翻译放在同一把 lock 内，不能只给最后的 `saveTranslations` 加锁；`DesignService.rollbackDesign` 抢锁后调用内部文件 helper；`store.deleteProduct` 抢锁后调用内部删除和恢复 helper。

组件生成的落地接口：

- `store.generateComponents(input)` 是唯一允许写 `library/<productId>.lib.pen` 的业务入口。
- `store.generateComponents(input)` 内部流程固定为：`runProductMutation({ operation: "generate_components", product_id })` → `products.getProduct(product_id)` → `assertProductConfig(product, product_id, ["platform", "style", "languages"])` → 调用低层 Pencil 适配器写组件库。
- `PencilService.generateComponents` 若继续存在，只能作为低层 helper，由 store 私有持有；MCP、Server、Agent tool 不能直接调用它。
- `createFormaTools()` 的 `generate_components` 必须调用 `store.generateComponents(input)`。
- `CreateFormaToolsOptions.pencil` 不能再影响 `generate_components`。需要替换低层 Pencil 的测试，应通过 `createFormaStore({ pencilService })` 或测试 store 的 `generateComponents` mock 注入。
- 不能存在绕开 `store.generateComponents()` 的组件库写入路径。

`recoverPendingProductDeletes()` 的公开方法负责抢锁，然后调用内部 `recoverPendingProductDeletesLocked()`。`deleteProduct()` 抢到 lock 后只能调用内部 locked helper，不能再调用公开 `recoverPendingProductDeletes()`。

验证必须覆盖：

- 两个 `createProduct` 并发执行后，`data/products.yaml` 保留两个产品。
- `createProduct` 与 `deleteProduct` 并发时，最后的 index 同时反映两个操作，不丢另一边更新。
- `initProductConfig` 与 `deleteProduct` 并发时，要么配置先完成后删除，要么删除先完成后配置返回 `PRODUCT_NOT_FOUND`，不能写入 staging 或已删除目录。
- `createEmptyRequirement`、`submitRequirement`、`updateRequirement`、`saveRequirement`、`saveDesigns`、`updatePageTranslations` / `update_page_copy`、`generate_components` 与 `deleteProduct` 并发时串行执行；不能在 staging 或已删除目录下继续写入。
- `set_current_session` 与删除当前产品并发时串行执行；最终 session 不能指向已删除产品。
- deletion recovery 与 create/config/requirement/design/copy/component/delete 并发时串行执行。

删除范围：

- 实现层以移动整个 `data/<productId>/` 为准，避免遗漏当前或未来挂在产品目录下的数据。
- 当前真实布局中，需求、文档、copy 翻译和设计都在 `data/<productId>/<requirementId>/...` 下，不存在 `data/<productId>/requirements/**`、`data/<productId>/designs/**` 或 `data/<productId>/copy/**` 目录。
- `data/<productId>/product.yaml`
- `data/<productId>/baseline/baseline.yaml`
- `data/<productId>/baseline/rules.yaml`
- `data/<productId>/<requirementId>/requirement.yaml`
- `data/<productId>/<requirementId>/document.md`
- `data/<productId>/<requirementId>/copy-translations.yaml`
- `data/<productId>/<requirementId>/<designId>/design.yaml`
- `data/<productId>/<requirementId>/<designId>/design.pen`
- `data/<productId>/<requirementId>/<designId>/preview@2x.png`
- `data/<productId>/<requirementId>/<designId>/design.v*.pen`、`preview.v*.png`、`exports/**` 等设计历史和导出文件
- `library/<productId>.lib.pen`
- `data/products.yaml` 中对应的 product index entry
- 当前 session 指向该产品时，`session.yaml` 写回 `{ current_product: null }`

#### 3. 可恢复删除事务

删除操作使用 staging 目录，不直接删除 active 文件：

```text
<formaHome>/tmp/deletions/<operationId>/
  state.json
  backups/
    products.yaml
    session.yaml           # 如果原本存在
  staged/
    data/<productId>/
    library/<productId>.lib.pen
```

`state.json` 必须符合上面的 `ProductDeletionState`，并在每个 phase 变化后原子写入。恢复逻辑只能依据 `state.json` 决策，不能通过重新猜测目录结构来判断原路径。

删除事务以 `data/products.yaml` 作为读可见性边界，因为纯读接口不持有 product mutation lock。`ProductService.getProduct(productId)` 必须先确认 `productId` 仍在 `data/products.yaml` 中；如果 index 已移除该产品，即使 `data/<productId>/product.yaml` 仍为回滚暂留，也必须返回 `PRODUCT_NOT_FOUND`。删除事务在清空当前 session（如需要）并从 `products.yaml` 移除产品之前，不允许移动 `data/<productId>/` 或 `library/<productId>.lib.pen`。

执行顺序：

1. 先做纯输入校验：`confirm_product_id` 必须存在且等于 `product_id`。失败时直接返回 `INVALID_INPUT`，不抢锁、不恢复、不读写文件。
2. 获取 product mutation lock。
3. 在 lock 内调用内部 `recoverPendingProductDeletesLocked()`，先处理上次遗留的 deletion staging。
4. 通过先查 index 的 `ProductService.getProduct()` 校验 product 存在。
5. 创建 `tmp/deletions/<operationId>`，写入初始 `state.json`，`phase = "created"`。
6. 读取 `data/products.yaml` 和 `session.yaml`，原子写入 `backups/products.yaml` 和可选的 `backups/session.yaml`；预计算完整 `moved_paths` / `missing_paths`，然后更新 `state.json.phase = "backed_up"`。
7. 如果原 session 指向该产品，写回 `{ current_product: null }`，然后更新 `state.json.phase = "session_written"`。
8. 写入新的 `data/products.yaml`，移除该产品索引，然后更新 `state.json.phase = "index_written"`。这是对未加锁读接口的公开可见性边界。
9. 将 `data/<productId>` 和 `library/<productId>.lib.pen` 移动到 staging；缺失的可选路径记录在 `state.json.missing_paths`，不抛错。成功后更新 `state.json.phase = "moved"`。
10. 标记 `state.json.committed = true` 且 `phase = "committed"`。
11. 删除 staging 目录。

失败处理：

- 第 1 步失败：不获取 lock，不触发 recovery，不读写任何文件。
- 第 2 步失败：不触发 recovery，不读写任何文件，返回 `PRODUCT_MUTATION_LOCKED`。
- 第 3 步恢复失败：如果 `recoverPendingProductDeletesLocked()` 返回 warning 但未抛错，合并 warning 后继续；一旦抛 `PRODUCT_DELETION_RECOVERY_FAILED`，`deleteProduct()` 直接透传错误，不创建新 staging，不修改 active files。
- 第 4 步失败：不创建 staging，不修改任何文件。
- 第 5 步失败：删除未完整创建的 operation 目录，不修改 active 文件。
- 第 6-9 步任一步失败：按 `state.json.phase` 决定恢复动作；恢复 `products.yaml`、`session.yaml`，把已移动的产品目录和组件库移回原位置，然后抛错。
- 第 11 步失败：不回滚，因为 active 状态已经一致；返回 `cleanup_pending: true`，并保留 staging 目录供后续清理。
- `recoverPendingProductDeletes()` 扫描 `tmp/deletions`：
  - `committed !== true` 的 staging 尝试恢复。
  - `committed === true` 的 staging 尝试清理。
  - 清理或恢复失败时记录 warning，不能静默吞掉。
- `deleteProduct()` 调用内部恢复 helper 时，必须把 `ProductDeletionRecoveryResult.warnings` 放进 `DeleteProductResult.recovery_warnings`。
- Server 启动时不能 fire-and-forget。`buildServer()` 增加 Fastify `onReady` hook，并在 hook 中 `await store.recoverPendingProductDeletes()`：
  ```typescript
  app.addHook("onReady", async () => {
    const recovery = await store.recoverPendingProductDeletes();
    for (const warning of recovery.warnings) {
      app.log.warn({ warning }, "Product deletion recovery warning");
    }
  });
  ```
  这样 `app.ready()`、`listen()` 和第一次 `inject()` 都会等待 deletion recovery 完成。若 recovery 抛错，启动失败，不对外服务。`createFormaStore()` 仍保持同步构造，不在构造函数里执行异步恢复。
- MCP 启动也必须等待 deletion recovery。`packages/mcp/src/index.ts` 将 `createFormaMcpServer()` 改为 async：
  ```typescript
  export async function createFormaMcpServer(options: CreateFormaMcpServerOptions = {}): Promise<McpServer> {
    const store = createFormaStore({ ... });
    await store.recoverPendingProductDeletes();
    const server = new McpServer({ name: "forma", version: formaCoreVersion });
    registerFormaTools(server, createFormaTools(store));
    return server;
  }
  ```
  `main()` 必须 `await createFormaMcpServer(options)` 后再连接 transport。若 recovery 抛错，MCP 不连接 stdio transport。这样“下一次启动会处理 staging”同时覆盖 Server 和 MCP。

一致性要求：

- 删除成功后，产品不能同时存在于 index 和 staging。
- 删除失败后，index、产品目录、组件库、session 必须回到删除前状态。
- 删除当前产品时，session 清空和 index 更新同属提交阶段；如果 session 写入失败，删除提交失败并回滚。

#### 4. Server 产品删除接口

文件：`packages/server/src/routes.ts`

新增：

```http
DELETE /api/products/:id
```

请求 body 必填：

```json
{ "confirm_product_id": "P-123abc" }
```

返回：

```json
{
  "product_id": "P-123abc",
  "deleted": true,
  "session_cleared": true,
  "cleanup_pending": false,
  "recovery_warnings": []
}
```

语义：

- 只删除产品，不提供需求删除接口。
- `confirm_product_id` 缺失或不匹配时返回 400，错误码使用现有 Server 输入错误 `INVALID_INPUT`。
- 删除不存在的产品返回现有错误结构，`error_code = "PRODUCT_NOT_FOUND"`。
- 删除当前 session 产品时，返回 `session_cleared: true`。
- 删除非当前产品时，返回 `session_cleared: false`。
- `recovery_warnings` 非空时，Server 不吞掉；响应原样返回，Web 可展示，日志也可记录。

#### 5. MCP 只暴露 delete_product

文件：`packages/mcp/src/tools.ts`

`formaToolNames` 新增 `delete_product`，输入只接受：

```json
{ "product_id": "P-123abc", "confirm_product_id": "P-123abc" }
```

返回：

```json
{
  "product_id": "P-123abc",
  "deleted": true,
  "session_cleared": true,
  "cleanup_pending": false,
  "recovery_warnings": []
}
```

约束：

- 不新增 `delete_requirement`。
- 不允许通过 `delete_product` 参数指定局部删除需求、页面或设计稿。
- `confirm_product_id` 必须等于 `product_id`，否则 MCP wrapper 返回 `VALIDATION_ERROR`。
- Agent 模板必须写明：调用 `delete_product` 前，先向用户复述产品名、产品 ID 和删除范围，并取得明确确认；确认后将同一个 ID 同时传给 `product_id` 和 `confirm_product_id`。
- Agent 收到 `session_cleared: true` 后，应提示用户重新执行 `fm-list-product` 选择产品。
- Agent 收到非空 `recovery_warnings` 后，必须把 warning 摘要告诉用户，不能只报告删除成功。

#### 6. Web 后台删除入口

涉及页面：

- `packages/web/src/pages/ProductList.tsx`
- `packages/web/src/pages/ProductDetail.tsx`

入口：

- 产品列表卡片增加一个低权重 danger 按钮：`Delete` / `删除`。
- 产品详情页增加 `Danger zone` 区块，显示删除产品按钮。

二次确认：

- 使用自定义确认弹窗，不使用 `window.confirm`。
- 弹窗展示产品名、产品 ID 和删除范围。
- 用户必须输入产品 ID 后，确认按钮才可用。使用产品 ID 而不是产品名，避免重名产品误删。
- Esc 或关闭按钮只关闭弹窗，不触发删除。
- 删除请求只在用户点击最终确认按钮时发送。

删除后行为：

- 在产品列表页删除成功后，从列表中移除该产品并刷新 summary 状态。
- 在产品详情页删除成功后跳转 `/products`。
- 如果返回 `session_cleared: true`，页面显示短提示：当前选择已清空，需要重新选择产品。
- 如果返回 `cleanup_pending: true`，页面显示 warning：产品已从可用列表删除，但后台清理有残留，建议稍后重试或查看日志。
- 如果返回 `recovery_warnings.length > 0`，页面显示 warning 摘要，不把恢复异常静默吞掉。

### 涉及文件

- `packages/core/src/product.ts` — 增加产品删除所需的路径解析、索引更新、staging 移动/恢复 helper
- `packages/core/src/product-mutation-lock.ts` — 新增跨 async / 跨进程的 product mutation lock，串行化 create/config/delete/recovery
- `packages/core/src/session.ts` — 增加 session 读取/条件清空 helper，并让 `setCurrentProduct` 进入 product mutation lock
- `packages/core/src/requirement.ts` — `createEmptyRequirement`、`submitRequirement`、`updateRequirement`、`saveRequirement`、`archiveRequirement` 进入 product mutation lock；内部调用 baseline/copy locked helper
- `packages/core/src/baseline.ts` — `updateFromRequirement` 增加 locked helper，避免在 requirement 持锁时重复抢锁
- `packages/core/src/copy.ts` — `saveTranslations`、`updatePageTranslations`、`mergeTranslations` 进入 product mutation lock，并暴露 locked helper 给 requirement/update_page_copy 使用；`updatePageTranslations` 的读-改-写必须整体持锁
- `packages/core/src/design.ts` — `saveDesigns`、`rollbackDesign`、`exportDesignAsset` 进入 product mutation lock，保护 `data/<productId>/<requirementId>/<designId>` 写入
- `packages/core/src/pencil.ts` — 保持低层 Pencil 适配器；`generateComponents` 不再承担产品配置校验，组件库写入只能由 store 编排调用
- `packages/core/src/errors.ts` — 增加 `INVALID_INPUT` 和 `PRODUCT_MUTATION_LOCKED` 错误码，供 Core 删除编排和 product mutation lock 使用
- `packages/core/src/store.ts` — 暴露单一 `deleteProduct` 编排入口，统一产品、组件库、session、staging 处理；新增 `generateComponents()` 和 `runProductMutation()`，组件生成在 store 层完成加锁、配置校验和低层 Pencil 调用
- `packages/core/tests/product-mutation-lock.test.ts` — 新建，覆盖锁获取、释放、stale 清理、heartbeat、超时和跨 async 串行化参数
- `packages/core/tests/product-session-style.test.ts` — 覆盖删除产品、索引更新、组件库清理、session 清空、失败回滚、cleanup_pending、state.json schema、recovery_warnings、`ProductService.getProduct()` 先查 `products.yaml` 的读可见性边界、删除 phase 暂停时不会暴露 index/session 指向已移动目录、create/config/session 并发串行化，以及 `store.generateComponents` 配置校验、写组件库与删除并发串行化
- `packages/core/tests/requirement-baseline.test.ts` — 覆盖 `createEmptyRequirement`、`submitRequirement`、`updateRequirement`、`saveRequirement`、baseline 写入与删除/recovery 并发串行化
- `packages/core/tests/copy.test.ts` — 覆盖 `saveTranslations`、`updatePageTranslations`、`mergeTranslations` 与删除/recovery 并发串行化，尤其覆盖 updatePageTranslations 读-改-写期间不能被删除夹入
- `packages/core/tests/design.test.ts` — 覆盖 save/rollback/export design 与删除并发串行化
- `packages/core/tests/pencil.test.ts` — 保留低层 Pencil 适配器测试；组件配置校验不在 PencilService 单测里断言
- `packages/server/src/app.ts` — 使用 Fastify `onReady` hook 等待 `store.recoverPendingProductDeletes()` 完成，不能 fire-and-forget
- `packages/server/src/routes.ts` — 新增 `DELETE /api/products/:id`
- `packages/server/tests/routes.test.ts` — 覆盖删除接口、confirm_product_id、`INVALID_INPUT`、`PRODUCT_MUTATION_LOCKED -> 409`、session_cleared、cleanup_pending、recovery_warnings、startup recovery onReady 等待，以及删除 phase 暂停时 `GET /api/products`、`GET /api/products/:id` 和 session 读不出现 index/session 指向已移动目录
- `packages/mcp/src/index.ts` — `createFormaMcpServer()` 改为 async，创建 store 后先 await `store.recoverPendingProductDeletes()`，再注册工具和连接 transport
- `packages/mcp/src/tools.ts` — 新增 `delete_product`；`generate_components` 必须调用 `store.generateComponents(input)`，不能默认 `new PencilService({ home: store.home })`
- `packages/mcp/tests/index.test.ts` — 新建，覆盖 MCP startup 会 await deletion recovery，recovery 失败时不连接 transport
- `packages/mcp/tests/tools.test.ts` — 覆盖 MCP 删除产品确认字段、`VALIDATION_ERROR` schema 校验、`PRODUCT_MUTATION_LOCKED` 透传、recovery_warnings 返回、`generate_components` 调用 `store.generateComponents`、不新增需求删除
- `packages/agent/templates/shared/SKILL.md` — 增加 delete_product 前必须复述删除范围并获得用户确认的约束
- `packages/web/src/api.ts` — 新增 `deleteProduct(productId, { confirm_product_id })`
- `packages/web/src/api.test.ts` — 覆盖 DELETE 请求 body、session_cleared、cleanup_pending、recovery_warnings 解析
- `packages/web/src/components/ConfirmDeleteDialog.tsx` — 新建二次确认弹窗
- `packages/web/src/components/ConfirmDeleteDialog.test.tsx` — 新建，覆盖输入产品 ID 才能确认、Esc/关闭不触发删除
- `packages/web/src/pages/ProductList.tsx` — 产品卡片删除入口
- `packages/web/src/pages/ProductList.test.tsx` — 覆盖列表页删除入口、删除成功移除产品、session 清空提示、warning 展示
- `packages/web/src/pages/ProductDetail.tsx` — Danger zone
- `packages/web/src/pages/ProductDetail.test.tsx` — 覆盖详情页删除后跳转 `/products`、错误态和 warning 展示
- `packages/web/src/i18n.ts` — 中英文删除文案
- `packages/web/src/i18n.test.ts` — 覆盖删除弹窗、session 清空、cleanup_pending、recovery_warnings 文案 key
- `docs/AGENT.md` — 说明产品删除需要用户确认，删除当前产品会清空选择
- `docs/MCP.md` — 新增 `delete_product`，明确没有 `delete_requirement`

### 验证

```bash
pnpm test -- packages/core/tests/product-session-style.test.ts
pnpm test -- packages/core/tests/product-mutation-lock.test.ts
pnpm test -- packages/core/tests/requirement-baseline.test.ts
pnpm test -- packages/core/tests/copy.test.ts
pnpm test -- packages/core/tests/design.test.ts
pnpm test -- packages/core/tests/pencil.test.ts
pnpm test -- packages/server/tests/routes.test.ts
pnpm test -- packages/mcp/tests/index.test.ts
pnpm test -- packages/mcp/tests/tools.test.ts
pnpm test -- packages/web
```

确认：

- 删除存在的产品后，`list_products` 不再返回该产品。
- 删除产品会删除产品目录和组件库文件。
- `confirm_product_id` 缺失或不匹配时，不获取 lock，不触发 pending deletion recovery，不修改 index、产品目录、组件库或 session。
- Core 直接调用 `deleteProduct` 时，`confirm_product_id` 缺失或不匹配返回 `INVALID_INPUT`。
- product mutation lock 串行化 create/config/delete/recovery；并发 create/delete 不会丢失 `data/products.yaml` 更新。
- product mutation lock 使用固定参数：stale 阈值 120000ms、等待超时 30000ms、重试间隔 100ms + 最多 25ms jitter、持锁心跳 5000ms。
- `PRODUCT_MUTATION_LOCKED` 在 Server 返回 HTTP 409，MCP 透传同名 `error_code`。
- `createEmptyRequirement`、`submitRequirement`、`updateRequirement`、requirement、baseline、`updatePageTranslations`、copy、design、component library、session 写入与 delete/recovery 并发时必须串行化。
- MCP startup 会等待 deletion recovery 完成；recovery 失败时不连接 stdio transport。
- MCP `generate_components` 调用 `store.generateComponents`；组件生成的配置读取、`platform/style/languages` 校验、加锁和组件库写入都在 store 层完成，不能新建未加锁的 `PencilService` 绕开 store 编排。
- `state.json` 包含 `schema_version`、`operation_id`、`product_id`、`committed`、`phase`、`backups`、`moved_paths`、`missing_paths`、`session_was_current` 和时间戳。
- deletion staging 的执行顺序必须先创建 operation 目录和初始 `state.json`，再写入 backups，不能先备份到尚未创建的目录。
- 删除事务必须先清当前 session（如果指向待删产品）、再从 `products.yaml` 移除产品，最后移动产品目录和组件库；未加锁读接口不得观察到 index 或 session 指向已移动到 staging 的产品目录。
- `ProductService.getProduct()` 必须先查 `products.yaml`，产品不在 index 时返回 `PRODUCT_NOT_FOUND`，即使产品目录还暂时存在。
- Server `onReady` 会等待 deletion recovery 完成；恢复失败时 app 不进入 ready 状态。
- recovery 成功但有 warnings 时，Server log、Delete API、MCP 和 Web 都能看到 warning，不静默吞掉。
- Server 删除接口对 `confirm_product_id` 缺失或不匹配返回 `INVALID_INPUT`。
- MCP 删除工具对 `confirm_product_id` 缺失或不匹配返回现有 schema 校验错误 `VALIDATION_ERROR`。
- 删除提交前任一步失败时，index、产品目录、组件库、session 回到删除前状态。
- staging 清理失败时返回 `cleanup_pending: true`，active index/session 不回滚。
- 下一次 Server 启动、下一次 MCP 启动或下一次删除前会处理 stale deletion staging。
- 删除当前产品后，`get_current_session` 返回 `{ current_product: null }`。
- 删除非当前产品后，当前 session 保持不变。
- Server 删除接口返回 `session_cleared: true | false`、`cleanup_pending: true | false` 和 `recovery_warnings: string[]`。
- MCP 只有 `delete_product`，没有 `delete_requirement`。
- MCP `delete_product` 必须带 `confirm_product_id`。
- Agent 共享模板要求删除前复述删除范围并获得用户确认。
- Web 删除弹窗必须输入产品 ID 才能确认。
- `docs/AGENT.md` 和 `docs/MCP.md` 与新增删除能力及“不提供需求删除”保持一致。
