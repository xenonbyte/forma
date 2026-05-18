# Forma v0.3 设计方案

## 背景

v0.1 实现了完整的设计稿生产和管理核心流程，v0.2 实现了风格同步、预览生成和导航关系图。但存在以下局限：

1. **产品无语言属性** — 产品模型中没有语言字段，设计稿生成时无法确定 UI 文字使用什么语言，多语言产品无法管理翻译文案
2. **新建产品表单过于简陋** — 后台新建产品时只收集 name 和 description，platform/style 显示为 disabled 占位，语言更是不存在
3. **Agent 命令缺少语言检测** — `fm-list-product` 的配置完整性检查不包含语言，无法在 Agent 侧兜底补全
4. **Web 后台无中文支持** — 所有 UI 文案硬编码英文，中文用户体验差
5. **需求入口割裂且门槛高** — `fm-upload-requirement` 和 `fm-update-requirement` 两个命令，用户必须提供完整需求文档才能操作，无法处理"改一个按钮"这种小需求
6. **设计稿文案不可控** — 设计稿上的文字由 AI 临场发挥，没有结构化的多语言文案管理
7. **无逻辑冲突检测** — 新需求与已有产品逻辑是否矛盾完全靠人工判断，缺少机器可检测的规则基线
8. **MCP 数据获取碎片化** — AI 开发者需要多次调用才能拿到完整产品数据，缺少一站式入口和使用指引
9. **项目文档简陋** — README 包含过时的 v0.1 Scope 章节，缺少 MCP 工具文档和 Agent 命令文档

## 目标

1. 产品模型新增 `languages`（多选）和 `default_language`（单选）字段
2. 后台新建产品时 platform、style、languages 三项必填
3. Agent `fm-list-product` 配置检测增加 languages 兜底补全
4. Web 后台支持中英文切换
5. 合并 `fm-upload-requirement` + `fm-update-requirement` 为统一入口 `fm-requirement`，支持任意粒度输入（完整 PRD / 一句话 / 几个功能点）
6. 需求阶段 AI 一次性生成结构化多语言文案（default_language 文案 + 所有语言翻译），设计稿生成时直接使用
7. AI 自动判断页面变化类型（new/patch/rebuild），patch 页面设计时复用旧设计稿做局部调整
8. 新增 BDD 逻辑规则基线（given/when/then），产品级累积，用于需求逻辑冲突检测
9. `get_requirement` 扩展为一站式数据入口，返回需求文档 + 页面功能 + 多语言文案 + 设计稿路径；`help` 工具新增 AI 开发者使用指南
10. 优化 README，新增 MCP 文档和 Agent 命令文档

## 不做

- 不做运行时动态切换设计稿语言（设计稿始终使用 default_language）
- 不做 Web 后台的日语/韩语等其他语言支持（只做中英切换）
- 不做已有产品的语言字段自动回填（已有产品通过 Agent 兜底补全或后台手动编辑）
- 不做多语言文案的版本历史管理（文案跟随需求版本）
- 不做数据迁移工具（假设当前 Forma home 中无生产数据，schema 破坏性变更直接生效）

---

## 功能零：需求文档有效性校验与格式化

### 背景

当前 `submit_requirement` 和 `update_requirement` 对 `document_md` 只做非空校验，用户传入的文档格式五花八门（纯文本、Word 粘贴、格式混乱的 Markdown、甚至非需求内容），导致：

1. 后续 AI 拆解页面时输入质量不稳定
2. Web 后台展示需求文档时渲染不一致
3. MCP 提供文档数据给其他 Agent 时可读性差
4. 多语言文案提取缺少结构化锚点

同时，v0.1 将需求上传和修改拆为两个 Agent 命令（`fm-upload-requirement` + `fm-update-requirement`），用户必须提供完整需求文档才能操作。实际场景中用户输入粒度差异很大：可能是一份完整 PRD，也可能只是"登录页加个手机号登录"。

### 方案

合并 `fm-upload-requirement` 和 `fm-update-requirement` 为统一入口 **`fm-requirement`**。用户输入任意粒度的需求，Agent 自动合并到当前需求文档中，重新生成格式化文档、页面清单、多语言文案。

后端不做语义校验，保持纯数据存储职责。

### 执行流程

```
用户: 任意粒度的需求输入（完整 PRD / 一句话修改 / 几个功能点）
       │
       ▼
┌─ Agent: fm-requirement ──────────────────────────────────────────┐
│                                                                   │
│ 1. MCP.get_current_session() → 获取当前产品                       │
│                                                                   │
│ 2. MCP.get_requirement_history(product_id)                        │
│    → 检查是否有 empty/submitted/active 状态的需求                  │
│    → 无 → block："请先在后台管理创建需求"                          │
│    → 有 → 获取当前需求（requirement_id + 已有 document_md）        │
│                                                                   │
│ 3. MCP.get_product_baseline(product_id) → 获取基线                │
│    MCP.get_product(product_id) → 获取 languages + default_language│
│    MCP.get_product_rules(product_id) → 获取已有 BDD 规则          │
│                                                                   │
│ 4. 接收用户需求输入（任意粒度）                                    │
│                                                                   │
│ 5. [AI] 有效性判断                                                │
│    → 不合格 → 拒绝："这不是有效的需求描述"                         │
│                                                                   │
│ 6. [AI] 合并 + 格式化 + 拆解 + 翻译 + 规则生成（单次 AI 调用）    │
│    │                                                              │
│    │ 输入：                                                       │
│    │   - 用户本次输入（任意粒度）                                  │
│    │   - 当前需求文档（如果已有，status=submitted/active）          │
│    │   - 产品基线（所有页面的完整功能描述）                         │
│    │   - languages + default_language                              │
│    │                                                              │
│    │ AI 行为：                                                    │
│    │   - 如果当前需求为 empty：以用户输入为基础生成全新格式化文档   │
│    │   - 如果当前需求已有文档：在已有文档基础上合并用户新输入       │
│    │                                                              │
│    │ 输出：                                                       │
│    │   - 格式化后的完整 document_md                                │
│    │   - pages[]（含 copy[] + change_type，只包含有变化的页面）     │
│    │   - navigation[]                                             │
│    │   - translations[]                                           │
│    │   - rules[]（当前需求的完整规则集）                            │
│    │   - remove_page_ids[]（需要删除的页面）                       │
│    │                                                              │
│    │ 其中 pages[] 每项包含：                                      │
│    │   { page_id, name, baseline_page, features, copy[],          │
│    │     fields, interactions, change_type, change_summary }       │
│    │                                                              │
│    │ change_type: "new" | "patch" | "rebuild"                     │
│    │ （unchanged 的页面不出现在 pages[] 中）                       │
│    │                                                              │
│                                                                   │
│ 7. [AI] 冲突检测（独立 AI 调用）                                   │
│    → 输入：已有 baseline rules + 本次生成的完整 rules[]             │
│    → 对比：same given+when → 检查 then 是否矛盾                   │
│    → 有冲突 → 展示给用户确认                                      │
│    → 无冲突 → 继续                                                │
│                                                                   │
│ 8. 确认交互                                                       │
│    → 展示给用户：                                                  │
│      "本次需求变更：                                               │
│       ✚ 新增页面：设置页                                           │
│       ✎ 局部调整：登录页（新增手机号登录入口）                      │
│       ↻ 重构页面：无                                               │
│       确认提交？"                                                  │
│    → 用户确认                                                      │
│                                                                   │
│ 9. 根据需求当前状态调用 MCP：                                      │
│    MCP.save_requirement(requirement_id, document_md, ui_affected,   │
│      pages[], navigation[], translations[], rules[], remove_rule_ids[],│
│      remove_page_ids[])                                                │
│    后端根据当前 status 自动处理：                                    │
│    - empty → 变为 submitted（ui_affected=false 时直接 active）      │
│    - submitted/active → 根据 change_type 设置 design_status         │
│      (new→pending, patch/rebuild→expired)                           │
│                                                                   │
│ 10. 报告结果                                                       │
└───────────────────────────────────────────────────────────────────┘
```

### 需求存在性门禁

Agent 在执行 `fm-requirement` 前必须检查产品是否有可操作的需求：

- 有 empty/submitted/active 需求 → 使用该 `requirement_id`
- 无可操作需求（所有需求已 archived 或无需求）→ block，提示用户去后台管理创建需求

此门禁确保需求创建（含 title 输入）只在后台管理完成，Agent 不负责创建需求。

**设计决策说明：** 这意味着用户首次使用 `fm-requirement` 前必须先在后台创建一个 empty 需求。这是有意的 tradeoff——将需求的"创建"（管理行为）和"填充"（AI 行为）分离，后台负责管理生命周期，Agent 负责内容生产。用户体验上，后台创建需求只需输入一个 title（1 秒操作），之后所有内容填充都在 Agent 侧完成。

### 页面变化类型（change_type）

| 类型 | 含义 | 设计阶段处理 |
|------|------|-------------|
| `new` | 全新页面，基线中不存在 | 全量生成设计稿 |
| `patch` | 老页面局部调整 | 拷贝老设计稿，在其基础上局部 refine |
| `rebuild` | 老页面重构 | 全量重新生成设计稿 |

unchanged 的页面不出现在 pages[] 中，不参与后续设计流程。

### change_type 判断约束规则

AI 根据以下规则判断页面变化类型。**核心标准：现有设计稿的布局结构是否还能复用。**

| 条件 | 判定 |
|------|------|
| 页面在基线中不存在 | `new` |
| 修改不影响页面整体布局结构（增删改个别 UI 元素、文案、字段） | `patch` |
| 修改导致页面布局结构必须重排 | `rebuild` |
| 页面核心交互流程改变（如"表单提交"变为"分步向导"） | `rebuild` |
| 页面主要内容区域类型改变（如"列表"变为"瀑布流"、"表格"变为"卡片"） | `rebuild` |
| 用户明确说"重新设计"、"重构"、"重做" | `rebuild` |

判断依据是**布局可复用性**，不设功能点数量阈值。

### change_type 与设计阶段的关联

```
fm-design 执行时：
  │
  ├─ new 页面 → design_status: pending → 全量生成设计稿（mode: "generate"）
  │
  ├─ patch 页面 → design_status: expired
  │   → 与 rebuild 使用相同的设计生成机制（stageExistingDesign，版本递增）
  │   → 区别在于 prompt：注明"基于当前页面设计，只修改以下部分：{change_summary}"
  │   → Agent 在 prompt 中附带旧设计的标注信息（通过 get_design_annotations 获取）
  │   → Pencil 根据 prompt 生成新设计，save_designs 时 mode: "refine"
  │   → DesignService 变更：refine 模式接受 expired + hasExistingDesign + change_type=patch
  │
  ├─ rebuild 页面 → design_status: expired → 全量重新生成设计稿（mode: "update"）
  │   → DesignService 变更：update 模式接受 expired + hasExistingDesign + change_type=rebuild
  │   → rebuild 复用同一 design_id，版本号递增（与 refine 一致的版本历史模型）
  │   → 旧版本通过 diff_designs 可查看
  │
  └─ unchanged 页面 → 不在 pages[] 中，不处理
```

**DesignService 需要变更的校验逻辑：**

当前 `assertSaveModeAllowed` 的模式校验：
- `generate` 模式：保持不变（只接受 `!hasExistingDesign`，用于 new 页面）
- `refine` 模式：只接受 `design_status=done && hasExistingDesign` → 变更为：也接受 `design_status=expired && hasExistingDesign && change_type=patch`
- `update` 模式：只接受 `design_status=done && hasExistingDesign` → 变更为：也接受 `design_status=expired && hasExistingDesign && change_type=rebuild`

当前 `stageExistingDesign`（design.ts:303）硬性要求 `design_status === "done"`：
- 变更为：也接受 `design_status === "expired"`（patch 和 rebuild 都走此路径，版本递增）

rebuild 与 patch 的区别：
- patch：基于旧设计标注做局部修改（prompt 指定只改变化部分），mode = "refine"
- rebuild：忽略旧设计内容全量重新生成，但复用同一 design_id 保持版本历史连续，mode = "update"

两者都走 `stageExistingDesign` 路径（版本递增），区别在于 prompt 内容。

**BaselineService 需要变更的逻辑：**

当前 `updateFromRequirement` 中 `activePages = input.pages.filter(p => p.design_status !== "expired")` 会过滤掉 expired 页面，导致 patch/rebuild 页面不更新基线。

变更为：**不再按 design_status 过滤**，而是按 change_type 判断活跃性。所有传入的 pages（无论 design_status）都视为活跃页面参与基线更新：

```typescript
// 变更前
const activePages = input.pages.filter((page) => page.design_status !== "expired");

// 变更后：所有传入的 pages 都参与基线更新
const activePages = input.pages;
```

**同步变更 `mapNavigationToBaseline`（requirement.ts:305）：** 该函数同样硬编码了 `pages.filter(p => p.design_status !== "expired")`，需要同步移除此过滤，确保 expired 页面（patch/rebuild）的导航关系也正确映射到基线。

```typescript
// requirement.ts:305 变更前
const activePages = pages.filter((page) => page.design_status !== "expired");

// 变更后
const activePages = pages;
```

这样 patch/rebuild 页面的基线数据（features、copy 等）会被更新为最新内容，旧设计稿路径仍可通过 `get_baseline_image` 找到（design_id 保留在 requirement.yaml 中）。
```

### change_type 存储

`change_type` 和 `change_summary` 存储在 requirement.yaml 的 pages[] 中：

```yaml
pages:
  - page_id: "login"
    name: "登录页"
    baseline_page: "login"
    design_status: expired
    design_id: "D-olddesign"    # patch/rebuild 保留旧 design_id，用于定位旧 .pen
    change_type: patch
    change_summary: "新增手机号验证码登录入口"
    features: "邮箱密码登录 + 手机号验证码登录 + Google/GitHub 第三方登录"
    copy:
      - context: "phone_tab"
        text: "手机号登录"
      - context: "sms_code_button"
        text: "获取验证码"
    fields: "phone(手机号), sms_code(验证码)"
    interactions: "切换到手机号 Tab，输入手机号，点击获取验证码，输入验证码登录"
  - page_id: "settings"
    name: "设置页"
    baseline_page: "settings"
    design_status: pending
    change_type: new
    change_summary: "全新页面"
    features: "个人信息修改 + 密码修改"
    copy:
      - context: "page_title"
        text: "设置"
      - context: "profile_section"
        text: "个人信息"
      - context: "password_section"
        text: "修改密码"
    fields: "nickname(昵称), avatar(头像), old_password(旧密码), new_password(新密码)"
    interactions: "修改个人信息实时保存，修改密码需要验证旧密码"
```

### 有效性判断规则

Agent 使用 AI 判断用户输入是否为有效需求描述。

**原则：宽松判断，只排除完全无关内容。** 任何粒度的产品相关描述都是合法输入，包括一句话的小改动。

判断标准（满足任一即合格）：
- 描述了产品功能、页面、交互、文案、样式中的任何一个方面
- 表达了对已有页面的修改意图
- 描述了新页面或新功能的需求
- 描述了业务逻辑的变更

不合格示例（完全无关的内容）：
- "hello world"
- 一段代码
- 一篇新闻文章
- 纯粹的闲聊内容

合格示例（任意粒度都行）：
- "登录页加个手机号登录"（一句话功能）
- "把按钮颜色改成蓝色"（一句话样式）
- "密码强度从6位改为8位"（纯逻辑，ui_affected=false）
- "把首页推荐列表改成瀑布流布局"（布局调整）
- 一份完整的 PRD 文档
- "新增设置页面，包含个人信息修改和密码修改功能"

### 格式化模板

格式化后的文档遵循统一 Markdown 结构。所有章节可选，AI 从原文中能解析出对应内容时才输出该章节：

```markdown
# {需求标题}

## 背景
{为什么要做这个需求}

## 目标
{这个需求要达成什么}

## 业务逻辑
{核心流程、规则、条件判断等}

## 页面

### {页面名称}
- **功能**: {功能点描述}
- **文案**: {页面上的关键文案}
- **字段**: {表单字段说明}
- **交互**: {交互行为说明}

### {页面名称2}
...

## 导航关系
- {页面A} → {页面B}：{触发条件}

## 补充说明
{非功能需求、约束、边界条件等}
```

### 格式化规则

1. **不删减信息** — 格式化是整理结构，不是删除内容。原文中的核心信息必须保留
2. **章节按需出现** — 只有能从原文解析出的内容才输出对应章节，不凭空编造
3. **合并而非覆盖** — 如果已有文档，新输入的内容合并进已有文档的对应章节
4. **保留结构** — 原文中的表格、列表等结构保留为 Markdown 对应格式
5. **语言保持** — 格式化不改变文档语言，用户用中文写就保持中文

### Agent 模板

`fm-requirement` 的 SKILL.md：

```markdown
Execution:
1. Read current session through MCP.
2. MCP.get_requirement_history(product_id): find operable requirement.
   - Multiple non-archived requirements → use the most recently updated one.
   - No operable requirement (all archived or none) → block: "请先在后台管理创建需求".
3. MCP.get_product_baseline(product_id): get baseline context.
   MCP.get_product(product_id): get languages + default_language.
   MCP.get_product_rules(product_id): get existing BDD rules.
4. Receive user's requirement input (any granularity: full doc, partial change, one-liner).
5. [AI] Validate: is this a valid requirement description? If not, reject.
6. [AI] Merge + format + extract + translate + rules (single AI call):
   - Input: user input + existing document (if any) + baseline + languages + existing rules
   - Output format: see "AI 输出格式约束" below
   - If output is too large, split into two calls (see "AI 输出量控制")
7. [AI] Conflict detection (separate AI call):
   - Input: existing baseline rules + new rules[] from step 6
   - Compare: same given+when → check if then contradicts
   - Output: list of conflicts (or empty)
   - Show conflicts to user if any, ask for resolution
8. Confirm with user:
   - Show change summary (new/patch/rebuild pages)
   - Show generated BDD rules for confirmation
   - User confirms or requests adjustments
9. Call MCP:
   - MCP.save_requirement(requirement_id, document_md, ui_affected, pages[], navigation[], translations[], rules[], remove_rule_ids[], remove_page_ids[])
   - Backend auto-handles status transition and design_status based on change_type
10. Report result or stable error codes.
```

### AI 输出格式约束

步骤 6 的 AI 调用必须输出以下 JSON 结构：

```json
{
  "document_md": "# 需求标题\n\n## 背景\n...",
  "ui_affected": true,
  "pages": [
    {
      "page_id": "login",
      "name": "登录页",
      "baseline_page": "login",
      "change_type": "patch",
      "change_summary": "新增手机号验证码登录入口",
      "features": "邮箱密码登录 + 手机号验证码登录",
      "copy": [
        { "context": "phone_tab", "text": "手机号登录" },
        { "context": "sms_code_button", "text": "获取验证码" }
      ],
      "fields": "phone(手机号), sms_code(验证码)",
      "interactions": "切换到手机号 Tab，输入手机号，点击获取验证码"
    }
  ],
  "navigation": [
    { "from": "login", "to": "home", "label": "登录成功" }
  ],
  "translations": [
    {
      "page_id": "login",
      "entries": [
        { "context": "phone_tab", "texts": { "en": "Phone Login", "ja": "電話ログイン" } },
        { "context": "sms_code_button", "texts": { "en": "Get Code", "ja": "コード取得" } }
      ]
    }
  ],
  "rules": [
    {
      "id": "rule-new-001",
      "page_id": "login",
      "given": "用户在登录页手机号 Tab",
      "when": "点击获取验证码",
      "then": "系统发送短信验证码，按钮变为60秒倒计时"
    }
  ],
  "remove_page_ids": []
}
```

**约束：**
- `pages[]` 只包含有变化的页面（new/patch/rebuild），unchanged 不出现
- `ui_affected`：pages[] 为空时为 false，非空时为 true
- `translations[]` 只包含非 default_language 的翻译
- `rules[]` 是 AI 生成的扁平数组，每条规则含 id/page_id(可选)/given/when/then，**不含** replaces_rule_id 和 source_requirement（这两个由后续步骤和后端填充）
- `ui_affected: false` 的需求也必须生成 rules（纯逻辑需求同样有行为规则，此时 page_id 可省略）

**AI 输出 → MCP 输入的转换（Agent 步骤 7-9）：**
1. AI 步骤 6 输出 `rules[]`（该需求的完整规则集，无 replaces_rule_id）+ `remove_page_ids[]`（用户需求明确要删除的页面）
2. 步骤 7 冲突检测后，Agent 根据用户确认为需要覆盖的规则添加 `replaces_rule_id`
3. 步骤 7 中用户确认删除的旧规则 ID 收集到 `remove_rule_ids[]`；被删除页面关联的规则也加入 `remove_rule_ids[]`
4. 步骤 9 调用 MCP 时传入：`rules[]` + `remove_rule_ids[]` + `remove_page_ids[]`
5. 后端收到后自动注入 `source_requirement: requirement_id` 到每条规则再存入 rules.yaml

### 需求优先级规则

当产品存在多个非 archived 需求时，Agent 使用 **最近更新的** 需求（按 `updated_at` 降序取第一个）。不会同时操作多个需求。

### 后端职责边界

后端 `assertDocument` 保持现有逻辑（非空校验）。语义校验、格式化、合并、change_type 判断完全由 Agent 侧负责。后端是数据存储层，不依赖 AI API。

**后端需要变更的校验逻辑：**

- `assertPages`：当 `ui_affected: false` 时允许 pages 为空数组，不再强制非空。变更为：

```typescript
function assertPages(pages: unknown[], uiAffected: boolean): void {
  if (uiAffected && pages.length === 0) {
    throw new FormaError("PAGES_EMPTY", "Pages are empty");
  }
}
```

### 无 UI 需求标识

部分需求纯改逻辑（如"修改密码强度规则"、"调整排序算法"），不涉及 UI 变化，不需要走设计流程。

需求级新增字段 `ui_affected: boolean`：

```yaml
id: R-1a2b3c4d
product_id: P-a3f8b2
title: "密码强度规则调整"
status: submitted
ui_affected: false
pages: []
navigation: []
```

**判断规则（AI 侧）：**
- AI 拆解后 pages[] 为空 → 输出 `ui_affected: false`
- AI 拆解后 pages[] 非空 → 输出 `ui_affected: true`
- `save_requirement` MCP 输入中 `ui_affected` 为必填，由 Agent 根据 AI 输出传入
- empty 创建时 schema 默认 `true`（占位值，不影响逻辑——empty 需求不会触发设计流程）

**联动影响：**
- `fm-design`：检测到 `ui_affected: false` → block："当前需求无 UI 调整，无需设计"
- `fm-refine-design`：同上
- 后台管理：需求详情页显示"无 UI 调整"标签，不展示设计相关操作入口
- **状态生命周期：** `ui_affected: false` 的需求状态根据已有页面决定：无页面或全部 done → active；有 pending/expired 页面 → 保持当前 status。归档流程正常（active → archived）。

`saveRequirement` 中的状态处理逻辑：

```typescript
async saveRequirement(input: SaveRequirementInput): Promise<Requirement> {
  const current = await this.readRequirementById(input.requirement_id);

  if (!input.ui_affected) {
    // 纯逻辑需求：只更新文档和规则，不触碰 pages/baseline 页面
    return this.doLogicOnlyUpdate(current, input);
  }

  if (current.status === "empty") {
    return this.doFirstSubmit(current, input);  // empty → submitted
  }
  if (current.status === "submitted" || current.status === "active") {
    return this.doPageUpdate(current, input);   // 合并页面，保持状态
  }
  throw new FormaError("REQUIREMENT_STATUS_INVALID", ...);
}

// 纯逻辑需求：更新 document_md + rules，不修改 pages/baseline/translations
private async doLogicOnlyUpdate(current: Requirement, input: SaveRequirementInput): Promise<Requirement> {
  // 写入 document_md、rules.yaml、requirement.yaml
  // 不调用 baseline.updateFromRequirement（不修改基线页面）
  // 不写入 copy-translations.yaml（纯逻辑需求无文案变更）
  // 不修改 current.pages（保留已有页面不变）
  // 状态处理：如果 current.pages 为空或全部 done → "active"
  //          如果 current.pages 有 pending/expired → 保持当前 status 不变
}

// 首次提交（empty → submitted）：pages[] 为完整列表，所有 pending
private async doFirstSubmit(current: Requirement, input: SaveRequirementInput): Promise<Requirement> {
  // assertDocument + assertPages(ui_affected=true)
  // 所有页面 design_status = pending
  // status 设为 "submitted"
  // 更新 baseline + document + translations + rules
}

// 页面更新（submitted/active）：合并页面列表
private async doPageUpdate(current: Requirement, input: SaveRequirementInput): Promise<Requirement> {
  // 合并：传入的 pages 按 change_type 设 design_status
  // 旧 pages 中未传入的保留原样
  // remove_page_ids 中的页面移除
  // 状态处理：如果合并后存在 pending 或 expired 页面，status 设为 "submitted"
  //          如果所有页面都是 done，status 设为 "active"
  // 更新 baseline + document + translations + rules
}
```

### Schema 变更

`requirementSchema` 新增 `ui_affected` 字段，`requirementPageSchema` 新增 `change_type` 和 `change_summary` 字段：

```typescript
const requirementSchema = z.object({
  id: requirementIdSchema,
  product_id: z.string().regex(/^P-[a-f0-9]{6}$/),
  title: z.string().min(1),
  status: z.enum(requirementStatuses),
  ui_affected: z.boolean().default(true),       // ← 新增；empty 创建时默认 true（占位值），save_requirement 时由 Agent 传入实际值覆盖
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  pages: z.array(requirementPageSchema),
  navigation: z.array(baselineNavigationSchema)
}).strict();

const requirementPageSchema = z.object({
  page_id: z.string().min(1),
  name: z.string().min(1),
  baseline_page: z.string().min(1),
  design_status: z.enum(designStatuses),
  design_id: z.string().regex(/^D-[a-f0-9]{8}$/).optional(),
  change_type: z.enum(["new", "patch", "rebuild"]).optional(),
  change_summary: z.string().optional(),
  features: z.string().optional(),
  copy: z.array(copyItemSchema).optional(),
  fields: z.string().optional(),
  interactions: z.string().optional()
}).strict();
```

### BDD 逻辑规则

#### 概述

每次需求变更时，AI 同步生成该需求涉及的 BDD 规则（given/when/then 三段式）。规则存储在产品基线级别，累积所有需求的规则，用于后续需求的逻辑冲突检测。

#### 规则格式

```yaml
# data/{product_id}/baseline/rules.yaml
rules:
  - id: "rule-001"
    page_id: "login"
    given: "用户在登录页"
    when: "输入手机号并点击获取验证码"
    then: "系统发送短信验证码，按钮变为60秒倒计时"
    source_requirement: "R-1a2b3c4d"
  - id: "rule-002"
    page_id: "login"
    given: "验证码倒计时中"
    when: "用户再次点击获取验证码"
    then: "按钮不可点击，显示剩余秒数"
    source_requirement: "R-1a2b3c4d"
  - id: "rule-003"
    page_id: "login"
    given: "用户输入错误验证码3次"
    when: "第4次尝试"
    then: "锁定登录15分钟，显示锁定提示"
    source_requirement: "R-1a2b3c4d"
```

#### AI 生成约束规则

| 约束 | 说明 |
|------|------|
| 一条规则只描述一个行为 | 不允许 then 中包含多个不相关结果 |
| given 必须是可观测状态 | 不能是"用户想要..."这种主观描述 |
| when 必须是具体用户动作或系统事件 | 不能是"某种情况下" |
| then 必须是可验证的系统响应 | 不能是"系统正确处理" |
| 规则绑定到具体页面 | 通过 page_id 关联（纯逻辑规则无关联页面时 page_id 可省略） |
| 跨页面规则用导航关联 | given 在 A 页面，then 跳转到 B 页面 |
| 边界条件必须有规则 | 数量限制、时间限制、权限限制等 |
| 错误场景必须有规则 | 每个正向规则至少对应一个异常规则 |

#### 规则 Schema

```typescript
const ruleSchema = z.object({
  id: z.string().min(1),
  page_id: z.string().min(1).optional(),    // 纯逻辑规则可不绑定页面（如"密码强度≥8位"）
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
  source_requirement: z.string().min(1)
});

const rulesFileSchema = z.object({
  rules: z.array(ruleSchema)
});
```

#### 与 fm-requirement 流程的集成

AI 单次调用的输出新增 `rules[]`：

```
Agent: [AI] 合并 + 格式化 + 拆解 + 翻译 + 规则生成（单次 AI 调用）
       │
       │ 输出：
       │   - document_md
       │   - pages[]
       │   - navigation[]
       │   - translations[]
       │   - rules[]（当前需求的完整 BDD 规则集）
       │
       ▼
Agent: [AI] 冲突检测
       │ 输入：基线 rules.yaml（排除 source_requirement === 当前需求的规则）+ 本次生成的完整 rules[]
       │ 对比：same given+when → 检查 then 是否矛盾（只与其他需求的规则比较）
       │
       ├─ 有冲突 → 展示给用户：
       │   "逻辑冲突：
       │    规则 rule-005：用户输入错误3次 → 锁定15分钟
       │    新规则：用户输入错误 → 仅提示重试，不锁定
       │    → 确认：以新规则为准（覆盖旧规则）？还是保留旧规则？"
       │
       └─ 无冲突 → 继续
```

#### 冲突检测类型

**比较基准：当前最新的产品基线和产品逻辑规则。**

基线（`baseline.yaml` + `rules.yaml`）是实时累积的——每次 `save_requirement` 都会更新基线。冲突检测拿新输入和**已经包含所有历史需求变更的当前基线（排除当前需求贡献的规则后）**做对比，不是和某个归档需求的快照对比。这代表"产品当前的完整状态（不含本需求旧版本）"。

| 冲突类型 | 检测方式 | 示例 |
|----------|----------|------|
| 直接矛盾 | 同一 given+when 产生不同 then | 旧："错误3次→锁定" vs 新："错误→仅提示" |
| 条件覆盖 | 新规则的 given 是旧规则 given 的子集，但 then 不同 | 旧："登录页→可输入邮箱" vs 新："登录页→只能输入手机号" |
| 缺失依赖 | 新规则的 given 依赖一个被删除的 then | 旧规则产生状态 X，新需求删除了产生 X 的规则 |

AI 做文本语义匹配（规则格式统一，AI 可靠地做结构化对比），不需要形式化逻辑引擎。

#### 规则更新策略

`save_requirement` 时，基线 rules.yaml 同步更新：

**rules[] 语义：当前需求的完整规则集。** Agent 每次传入该需求应贡献的所有规则（不是增量 delta）。

后端处理策略：
1. 按 `source_requirement === current requirement_id` 从 rules.yaml 中移除该需求之前贡献的所有规则
2. 将本次传入的 `rules[]` 全部写入（后端自动注入 `source_requirement`）
3. 有 `replaces_rule_id` 的规则：额外删除被替换的旧规则（其他需求贡献的）
4. `remove_rule_ids[]` 中的规则：直接删除（其他需求贡献的）

这样同一需求多次调用 `save_requirement` 时，该需求的规则集被完整替换，不会重复也不会残留。`replaces_rule_id` 和 `remove_rule_ids` 只用于操作**其他需求**贡献的规则。

**rule.id 全局唯一性策略：** 后端在 save_requirement 收到 rules[] 时，对每条 rule 重写 id 为 `${requirement_id}-${ai_generated_id}`（如 `R-1a2b3c4d-rule-001`）。AI 不需要关心唯一性。`replaces_rule_id` 使用的是 rules.yaml 中已有规则的全局 id（其他需求贡献的规则）。

**replaces_rule_id 替换语义：** 删旧 + 插新。旧规则从 rules.yaml 中移除，新规则以新 id 插入。

**页面删除的识别：** 不能靠"基线中存在但 pages[] 中不存在"来推断删除（因为 unchanged 页面也不出现在 pages[] 中）。需要显式信号：

- AI 在步骤 6 输出中新增 `remove_page_ids: string[]`（用户需求明确要删除的页面）
- Agent 步骤 7 冲突检测时展示删除影响（关联规则、导航断裂）
- 步骤 9 调用 MCP 时传入 `remove_page_ids[]`
- 后端处理：从 requirement.pages 中移除、从基线中移除 source_requirement 引用、将关联规则 id 加入 remove_rule_ids

`save_requirement` schema 新增 `remove_page_ids` 字段：

```typescript
const saveRequirementSchema = z.object({
  // ... 已有字段
  remove_page_ids: z.array(z.string().min(1)).optional()
}).strict();
```

#### MCP 接口

const saveRequirementSchema = z.object({
  requirement_id: z.string().min(1),
  document_md: z.string(),
  ui_affected: z.boolean(),
  pages: z.array(requirementPageInputSchema),
  navigation: z.array(navigationInputSchema),
  translations: z.array(pageTranslationSchema).optional(),
  rules: z.array(z.object({
    id: z.string().min(1),
    page_id: z.string().optional(),
    given: z.string().min(1),
    when: z.string().min(1),
    then: z.string().min(1),
    replaces_rule_id: z.string().optional()
  })).optional(),
  remove_rule_ids: z.array(z.string()).optional(),
  remove_page_ids: z.array(z.string().min(1)).optional()
}).strict();
```

后端处理逻辑：
- `rules[]`：当前需求的完整规则集，后端先删除该需求旧规则再整体写入。有 `replaces_rule_id` 时额外删除其他需求的对应旧规则
- `remove_rule_ids[]`：直接从 rules.yaml 中删除对应 ID 的规则（其他需求贡献的）
- `remove_page_ids[]`：从 requirement.pages 中移除，从基线中移除 source_requirement 引用

**Agent 侧流程：** AI 步骤 6 输出该需求的完整 `rules[]`（无 replaces_rule_id）+ `remove_page_ids[]`。步骤 7 冲突检测后，Agent 根据用户确认结果为需要覆盖其他需求规则的条目添加 `replaces_rule_id`，为需要删除的其他需求规则收集 ID 到 `remove_rule_ids`。步骤 9 调用 MCP 时传入：rules[] + remove_rule_ids[] + remove_page_ids[]。

新增 MCP 工具 `get_product_rules`：

```typescript
const getProductRulesSchema = z.object({
  product_id: z.string().min(1)
}).strict();
```

返回产品基线的所有 BDD 规则，供 Agent 冲突检测时使用。

---

## 功能一：产品语言属性

### 语言枚举

```typescript
export const languages = [
  "zh-CN",   // 简体中文
  "zh-TW",   // 繁体中文
  "en",      // 英文
  "ja",      // 日语
  "ko",      // 韩语
  "pt",      // 葡萄牙语
  "fr",      // 法语
  "de",      // 德语
  "ru"       // 俄语
] as const;

export type Language = (typeof languages)[number];

export const languageLabels: Record<Language, { en: string; zh: string }> = {
  "zh-CN": { en: "Simplified Chinese", zh: "简体中文" },
  "zh-TW": { en: "Traditional Chinese", zh: "繁体中文" },
  "en":    { en: "English", zh: "英文" },
  "ja":    { en: "Japanese", zh: "日语" },
  "ko":    { en: "Korean", zh: "韩语" },
  "pt":    { en: "Portuguese", zh: "葡萄牙语" },
  "fr":    { en: "French", zh: "法语" },
  "de":    { en: "German", zh: "德语" },
  "ru":    { en: "Russian", zh: "俄语" }
};
```

### 产品模型变更

`packages/core/src/schemas.ts` 新增：

```typescript
export const languages = ["zh-CN", "zh-TW", "en", "ja", "ko", "pt", "fr", "de", "ru"] as const;
export type Language = (typeof languages)[number];
```

`packages/core/src/product.ts` 变更：

```typescript
const productSchema = productIndexEntrySchema.extend({
  platform: z.enum(platforms).optional(),
  style: styleMetadataSchema.optional(),
  languages: z.array(z.enum(languages)).min(1).optional(),
  default_language: z.enum(languages).optional(),
  components_initialized: z.boolean().optional()
}).refine(
  (data) => {
    // languages 和 default_language 必须同时存在或同时不存在
    if (data.languages && !data.default_language) return false;
    if (!data.languages && data.default_language) return false;
    // default_language 必须在 languages 中
    if (data.languages && data.default_language) {
      return data.languages.includes(data.default_language);
    }
    return true;
  },
  { message: "languages and default_language must be consistent" }
);
```

### 默认语言选择规则

当用户选择多个语言时，`default_language` 的默认值按以下规则确定：

1. 如果选择的语言中包含 `en`，默认展示 `en`
2. 如果不包含 `en`，默认展示选择列表中的第一个语言

用户可以手动修改 `default_language`，但必须是 `languages` 数组中的一个值。

### 数据约束

- `languages` 至少包含 1 个语言
- `default_language` 必须是 `languages` 数组中的一个值
- 两个字段同时存在或同时不存在（通过 `initProductConfig` 一起写入）

### 产品配置初始化变更

`initProductConfig` 接口扩展：

```typescript
const productConfigSchema = z.object({
  platform: z.enum(platforms),
  style: styleMetadataSchema,
  languages: z.array(z.enum(languages)).min(1),
  default_language: z.enum(languages)
}).refine(
  (data) => data.languages.includes(data.default_language),
  { message: "default_language must be one of the selected languages" }
);
```

### MCP 工具变更

**`init_product_config` 变更：** `languages` 和 `default_language` 为必填字段。项目未使用过，无需兼容旧调用方。MCP 层 schema 在 core 层基础上增加 `product_id` 字段：

```typescript
// MCP inputSchema（比 core 层多 product_id + strict）
const productConfigMcpSchema = z.object({
  product_id: z.string().min(1),
  platform: z.enum(["mobile", "desktop", "tablet", "web"]),
  style: styleMetadataSchema,
  languages: z.array(z.enum(languages)).min(1),
  default_language: z.enum(languages)
}).strict().refine(
  (data) => data.languages.includes(data.default_language),
  { message: "default_language must be one of the selected languages" }
);
```

`init_product_config` 和 `update_product_config` 的 inputSchema 新增 `languages` 和 `default_language` 字段：

```typescript
const productConfigMcpSchema = z.object({
  product_id: z.string().min(1),
  platform: z.enum(["mobile", "desktop", "tablet", "web"]),
  style: styleMetadataSchema,
  languages: z.array(z.enum(["zh-CN", "zh-TW", "en", "ja", "ko", "pt", "fr", "de", "ru"])).min(1),
  default_language: z.enum(["zh-CN", "zh-TW", "en", "ja", "ko", "pt", "fr", "de", "ru"])
}).strict().refine(
  (data) => data.languages.includes(data.default_language),
  { message: "default_language must be one of the selected languages" }
);
```

`get_product` 返回值新增 `languages` 和 `default_language` 字段。

`submit_requirement` 和 `update_requirement` 合并为统一的 `save_requirement`：

```typescript
// 变更前：submit_requirement + update_requirement 两个工具
// 变更后：统一为 save_requirement
const saveRequirementSchema = z.object({
  requirement_id: z.string().min(1),
  document_md: z.string(),
  ui_affected: z.boolean(),
  pages: z.array(requirementPageInputSchema),
  navigation: z.array(navigationInputSchema),
  translations: z.array(pageTranslationSchema).optional(),
  rules: z.array(z.object({
    id: z.string().min(1),
    page_id: z.string().min(1).optional(),   // 纯逻辑规则可不绑定页面
    given: z.string().min(1),
    when: z.string().min(1),
    then: z.string().min(1),
    replaces_rule_id: z.string().optional()
  })).optional(),
  remove_rule_ids: z.array(z.string()).optional(),
  remove_page_ids: z.array(z.string().min(1)).optional()
}).strict();
```

后端逻辑：
- 读取需求当前 status
- empty + `ui_affected: true` → 设为 submitted，传入的 pages[] 即为完整页面列表，所有页面 design_status = pending
- empty + `ui_affected: false` → pages 为空，直接设为 active（无页面 = 无设计工作）
- submitted/active + `ui_affected: true` → **合并页面列表**，状态根据合并后结果决定：
  - 合并后存在 pending 或 expired 页面 → status = "submitted"
  - 合并后所有页面 done → status = "active"
  - 传入的 pages[]（有变化的页面）：根据 change_type 设置 design_status（new→pending, patch/rebuild→expired）
  - 旧 requirement.yaml 中已有但本次未传入的页面（unchanged）：保留原样（design_status 不变）
  - `remove_page_ids[]` 中的页面：从 requirement.pages 中移除
  - 合并后的完整页面列表写入 requirement.yaml
- submitted/active + `ui_affected: false` → **不修改 pages（保留已有页面不变）**，只更新 document_md 和 rules。状态根据已有页面决定：全部 done 或无页面 → active，否则保持当前 status
- expired_pages 由后端从 change_type 自动推导，不需要 Agent 传

**navigation[] 语义：全量替换。** Agent 每次传入的 `navigation[]` 是合并后的完整导航关系列表（包含 unchanged 页面之间的导航），后端直接覆盖旧 navigation，不做增量合并。这与当前代码行为一致（requirement.ts:142、baseline.ts:102）。

**关键原则：`ui_affected: false` 的需求只更新文档和逻辑规则，不触碰 pages 和基线页面数据。** 这避免了纯逻辑需求意外清空 UI 基线。

`requirementPageInputSchema` 中 `copy` 字段从 `z.string().optional()` 变为结构化数组，新增 `change_type` 和 `change_summary`：

#### save_requirement 实现路径

**Core 层：** 新增 `RequirementService.saveRequirement(input)` 方法，三条路径（详见 Schema 变更章节的完整实现）：

- `!ui_affected` → `doLogicOnlyUpdate`：只更新文档和规则，不触碰 pages/baseline 页面
- `empty + ui_affected` → `doFirstSubmit`：首次提交，pages 全部 pending
- `submitted/active + ui_affected` → `doPageUpdate`：合并页面列表

**change_type → design_status 映射（替代旧的 expired_pages 参数）：**

```typescript
// doFirstSubmit（empty → submitted）：所有页面统一设为 pending
pages.map(p => ({ ...p, design_status: "pending" }));

// doPageUpdate（submitted/active）：根据 change_type 设置
function resolveDesignStatus(page: PageInput, existingPage?: RequirementPage): DesignStatus {
  switch (page.change_type) {
    case "new": return "pending";
    case "patch": return "expired";
    case "rebuild": return "expired";
    default: return existingPage?.design_status ?? "pending";
  }
}
```

旧的 `updateRequirement` 依赖 Agent 传入的 `expired_pages[]` 显式数组。新的 `doPageUpdate` 不再需要此参数，改为从 `change_type` 推导。`updateFromRequirement`（baseline 更新）和 `mapNavigationToBaseline` 都需要移除 expired 过滤（见 BaselineService 变更章节），确保 patch/rebuild 页面的基线数据和导航关系正确更新。

**patch 页面与 save_designs mode 的映射：**

| change_type | design_status | fm-design 行为 | save_designs mode |
|-------------|---------------|----------------|-------------------|
| new | pending | 全量生成 | `"generate"` |
| patch | expired | 基于旧设计标注做局部修改 | `"refine"` |
| rebuild | expired | 全量重新生成（版本递增） | `"update"` |

当前 DesignService 的 mode 校验需要放宽（见"change_type 与设计阶段的关联"章节）。

旧的 `submitRequirement` 和 `updateRequirement` 方法保留为 private，由 `saveRequirement` 内部调用。

**MCP 层：** 注册 `save_requirement` 工具，handler 调用 `store.requirements.saveRequirement(input)`。直接删除 `submit_requirement` 和 `update_requirement` 工具（无需兼容，项目未使用过）。

**HTTP 层：**

- `POST /api/products/:id/requirements`：只创建 empty 需求（只需 title）。不再支持一次性提交 document_md + pages。
- `POST /api/products/:id/requirements/:reqId/save`：新增路由，对应 `save_requirement` MCP 工具逻辑（接收 document_md + pages + navigation + translations + rules）。

```typescript
const copyItemSchema = z.object({
  context: z.string().min(1),
  text: z.string().min(1)
});

const requirementPageInputSchema = z.object({
  page_id: z.string().min(1),
  name: z.string().min(1),
  baseline_page: z.string().min(1),
  features: z.string().optional(),
  copy: z.array(copyItemSchema).optional(),
  fields: z.string().optional(),
  interactions: z.string().optional(),
  change_type: z.enum(["new", "patch", "rebuild"]),  // 输入时必填
  change_summary: z.string().optional()
}).strict();
```

### 硬门禁变更

`assertProductConfig` 函数新增 `languages` 检查：

```typescript
function assertProductConfig(product: unknown, productId: string, fields: Array<"platform" | "style" | "languages" | "components_initialized">): void {
  const record = isRecord(product) ? product : {};
  const missing = fields.filter((field) => {
    if (field === "components_initialized") return record.components_initialized !== true;
    if (field === "languages") return !Array.isArray(record.languages) || record.languages.length === 0;
    return !record[field];
  });
  if (missing.length > 0) {
    throw new FormaError("PRODUCT_CONFIG_INCOMPLETE", "Product config incomplete", {
      product_id: productId,
      missing
    });
  }
}
```

`generate_page_design` 和 `generate_components` 的门禁检查新增 `languages`：

```typescript
assertProductConfig(product, input.product_id, ["platform", "style", "languages", "components_initialized"]);
```

**SessionService 变更：**

当前 `SessionService.setCurrentProduct` 内部调用的配置完整性检查也需要新增 `languages`。

**设计决策：** 将 `assertProductConfig` 从 `packages/mcp/src/tools.ts` 提取到 `packages/core/src/product.ts` 导出为 public 函数，`session.ts` 和 `tools.ts` 共用同一份检查逻辑，避免两处维护不一致。

---

## 功能二：后台新建产品表单必填化

### 当前状态

`ProductNew.tsx` 只收集 name 和 description，platform 和 style 显示为 disabled select。

### 变更后

新建产品表单包含以下必填字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | text input | 是 | 产品名称 |
| description | textarea | 是 | 产品描述 |
| platform | select 单选 | 是 | 产品类型：mobile/desktop/tablet/web |
| style | select 单选（带搜索） | 是 | 设计风格，从 `GET /api/styles` 获取列表 |
| languages | multi-select 多选 | 是 | 支持语言，至少选 1 个 |
| default_language | select 单选 | 是（多语言时） | 默认语言，选项来自 languages 已选值 |

### 表单交互规则

1. **platform**：下拉单选，选项为 `移动端 / 桌面端 / 平板端 / 网页端`（中文模式）或 `Mobile / Desktop / Tablet / Web`（英文模式）
2. **style**：下拉单选，选项从 `GET /api/styles` 动态加载，显示风格名称
3. **languages**：多选复选框组或多选下拉，显示 9 种语言
4. **default_language**：
   - 当 languages 只选了 1 个时，自动设为该语言，不显示此字段
   - 当 languages 选了多个时，显示此字段，选项为 languages 已选值
   - 默认值规则：包含 `en` 则默认 `en`，否则默认第一个
   - 用户可手动修改

### 提交逻辑

表单提交时调用两个 API：

```
1. POST /api/products  → { name, description }  → 返回 product（含 id）
2. POST /api/products/:id/config  → { platform, style, languages, default_language }
```

新增 API `POST /api/products/:id/config`：

```typescript
app.post<{ Params: { id: string }; Body: unknown }>("/api/products/:id/config", async (request) => {
  const body = objectBody(request.body);
  const styleName = requiredString(body, "style");
  const style = await store.styles.getStyle(styleName);
  const languagesArr = requiredArray(body, "languages") as string[];
  const defaultLang = requiredString(body, "default_language");

  return store.products.initProductConfig(request.params.id, {
    platform: requiredString(body, "platform") as Platform,
    style: style.metadata,
    languages: languagesArr as Language[],
    default_language: defaultLang as Language
  });
});
```

### 提交按钮状态

所有必填字段填写完毕且 style 列表加载成功后，按钮可点击。任一必填字段为空时按钮 disabled。

### 错误处理

- style 列表加载失败：显示错误提示，style 字段不可选，按钮 disabled
- 提交第一步（创建产品）失败：显示错误，不执行第二步
- 提交第二步（配置）失败：显示错误，但产品已创建（用户可在产品详情页补全配置，或通过 Agent 兜底）
- 配置未完成的产品在产品列表中显示"配置未完成"标签，点击进入详情页可补全配置

### 后台创建需求变更

当前后台 `POST /api/products/:id/requirements` 要求一次性提交 document_md + pages + navigation。v0.3 需要支持**只创建 empty 需求**（只输入 title），供 Agent 后续通过 `fm-requirement` 填充内容。

变更后的后台新建需求表单：
- 只需输入 title（必填）
- 不需要输入 document_md、pages、navigation
- 提交后创建 status=empty 的需求
- 产品详情页的需求列表中显示 empty 需求，标注"待填充"

HTTP API 变更：

```typescript
// POST /api/products/:id/requirements — 只创建 empty 需求
app.post<{ Params: { id: string }; Body: unknown }>("/api/products/:id/requirements", async (request) => {
  const body = objectBody(request.body);
  return store.requirements.createEmptyRequirement(request.params.id, requiredString(body, "title"));
});

// POST /api/products/:id/requirements/:reqId/save — 保存需求内容（对应 save_requirement MCP）
app.post<{ Params: { id: string; reqId: string }; Body: unknown }>("/api/products/:id/requirements/:reqId/save", async (request) => {
  const body = objectBody(request.body);
  return store.requirements.saveRequirement({ requirement_id: request.params.reqId, ...body });
});
```

---

## 功能三：Agent 命令语言兜底

### 当前 list-product 配置检测流程

```
Agent: MCP.set_current_session("P-a3f8b2")
       ← 失败: PRODUCT_CONFIG_INCOMPLETE, missing: ["platform", "style", "components"]
```

Agent 收到 `PRODUCT_CONFIG_INCOMPLETE` 后逐项交互补全。

### 变更后

`missing` 数组新增 `"languages"` 可能值。Agent 收到后按以下顺序补全：

```
[缺 platform]
Agent: "请选择产品类型：1.移动端 2.桌面端 3.平板端 4.网页端"
用户: 1

[缺 style]
Agent: [AI] 根据产品描述推荐风格 → 用户选择

[缺 languages]
Agent: "请选择产品支持的语言（可多选，用逗号分隔编号）：
  1. 简体中文
  2. 繁体中文
  3. 英文
  4. 日语
  5. 韩语
  6. 葡萄牙语
  7. 法语
  8. 德语
  9. 俄语"
用户: 1,3

Agent: "已选择：简体中文、英文。默认语言将设为：英文（因为包含英文）。是否确认？(Y/修改)"
用户: Y

[缺 components]
Agent: [AI] 根据 platform + style + default_language 生成通用组件
       → Pencil CLI 生成 library/{product_id}.lib.pen
Agent: MCP.complete_product_init(product_id)

[重试]
Agent: MCP.set_current_session("P-a3f8b2")
       ← 成功 ✓
```

### Agent 模板变更

`fm-list-product` 的 SKILL.md（所有平台：claude/codex/gemini）更新执行步骤：

```markdown
Execution:
1. Read current session through MCP.
2. If PRODUCT_CONFIG_INCOMPLETE returned, check missing fields:
   - platform: ask user to select product type (mobile/desktop/tablet/web)
   - style: recommend styles based on product description, let user choose
   - languages: ask user to select supported languages (multi-select), then confirm default_language
   - components: generate components via Pencil, then complete_product_init
3. Fetch latest requirement when a current product is available.
4. Confirm operation with product, requirement, and pending or expired pages.
5. Call Forma MCP tools.
6. Report stable error codes when returned.
```

### 组件生成 prompt 变更

通用组件生成时，prompt 中注入 `default_language` 信息：

```
Generate reusable UI components for a {platform} product.
Design style: {style.name} (see DESIGN.md for details).
UI text language: {default_language_label} ({default_language}).
All placeholder text, labels, and button text in the components should use {default_language_label}.
```

---

## 功能四：Web 后台中英切换

### 技术方案

不引入 i18n 库（如 react-i18next），使用轻量自实现方案。理由：
- Web 后台只需支持中/英两种语言
- 文案量有限（约 200 条），不需要复杂的命名空间、插值、复数规则
- 避免引入新依赖增加包体积

### 实现方式

新增 `packages/web/src/i18n.ts`：

```typescript
export type Locale = "en" | "zh";

export interface I18nMessages {
  [key: string]: string;
}

const messages: Record<Locale, I18nMessages> = {
  en: { /* English messages */ },
  zh: { /* Chinese messages */ }
};

let currentLocale: Locale = getInitialLocale();

export function t(key: string): string {
  return messages[currentLocale][key] ?? messages["en"][key] ?? key;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  localStorage.setItem("forma_locale", locale);
}

function getInitialLocale(): Locale {
  const stored = localStorage.getItem("forma_locale");
  if (stored === "en" || stored === "zh") return stored;
  return navigator.language.startsWith("zh") ? "zh" : "en";
}
```

### 语言切换 UI

在 `Layout.tsx` 的顶部导航栏右侧添加语言切换按钮：

```
┌─ Forma ──────────────────────────────────── [EN | 中] ─┐
│  Products  Styles  ...                                   │
└──────────────────────────────────────────────────────────┘
```

- 显示为两个紧凑按钮 `EN` 和 `中`，当前语言高亮
- 点击切换后立即生效（触发页面重新渲染）
- 选择持久化到 `localStorage`

### 初始语言检测

1. 优先读取 `localStorage` 中的 `forma_locale`
2. 如果没有，检测 `navigator.language`：以 `zh` 开头则默认中文，否则默认英文

### 文案组织

文案按页面/组件分组，key 使用 `page.component.label` 格式：

```typescript
const en = {
  "nav.products": "Products",
  "nav.styles": "Styles",
  "product.new.title": "Create Product",
  "product.new.name": "Name",
  "product.new.description": "Description",
  "product.new.platform": "Platform",
  "product.new.style": "Style",
  "product.new.languages": "Languages",
  "product.new.defaultLanguage": "Default Language",
  "product.new.submit": "Create product",
  "product.new.submitting": "Creating",
  "product.list.title": "Products",
  "product.list.empty": "No products yet",
  // ... 约 200 条
};

const zh = {
  "nav.products": "产品",
  "nav.styles": "风格库",
  "product.new.title": "新建产品",
  "product.new.name": "名称",
  "product.new.description": "描述",
  "product.new.platform": "产品类型",
  "product.new.style": "设计风格",
  "product.new.languages": "支持语言",
  "product.new.defaultLanguage": "默认语言",
  "product.new.submit": "创建产品",
  "product.new.submitting": "创建中",
  "product.list.title": "产品列表",
  "product.list.empty": "暂无产品",
  // ...
};
```

### 重新渲染机制

语言切换后需要触发整个应用重新渲染。使用 React Context + state：

```typescript
// packages/web/src/LocaleContext.tsx
import { createContext, useContext, useState, type ReactNode } from "react";
import { getLocale, setLocale as persistLocale, type Locale } from "./i18n.js";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {}
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  function handleSetLocale(next: Locale) {
    persistLocale(next);
    setLocaleState(next);
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale: handleSetLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
```

组件中使用：

```typescript
import { t } from "../i18n.js";
import { useLocale } from "../LocaleContext.js";

function MyComponent() {
  const { locale } = useLocale(); // 触发重新渲染
  return <h1>{t("product.list.title")}</h1>;
}
```

### 不翻译的内容

- 产品名称、描述（用户输入的内容）
- 风格名称（来自 awesome-design-md，保持英文原名）
- 错误码（保持英文 error_code）
- API 路径和技术标识符

---

## 功能五：多语言文案管理

### 目标

1. 需求上传/修改时，AI 从需求文档中分析出结构化的页面 UI 文案（使用 `default_language`）
2. 文案作为基线的一部分存储，设计稿生成时直接使用这些文案
3. MCP 提供产品文档数据时，可以附带多语言文案
4. 支持后续翻译写入

### 5.1 copy 字段结构化

#### 变更前（v0.1）

`copy` 是自由文本描述：

```yaml
pages:
  - page_id: "login"
    name: "登录页"
    copy: "登录按钮文案、欢迎语、错误提示"
```

#### 变更后（v0.3）

`copy` 变为结构化数组，每条文案绑定具体的 UI 元素，文本使用产品的 `default_language`：

```yaml
pages:
  - page_id: "login"
    name: "登录页"
    baseline_page: "login"
    features: "邮箱密码登录 + Google/GitHub 第三方登录"
    copy:
      - context: "page_title"
        text: "登录"
      - context: "email_label"
        text: "邮箱地址"
      - context: "password_label"
        text: "密码"
      - context: "submit_button"
        text: "登录"
      - context: "forgot_password_link"
        text: "忘记密码？"
      - context: "third_party_divider"
        text: "或使用以下方式登录"
    fields: "email(邮箱), password(密码)"
    interactions: "点击登录按钮提交表单，成功跳转首页"
```

#### Schema 变更

```typescript
const copyItemSchema = z.object({
  context: z.string().min(1),   // UI 元素标识（如 "submit_button"）
  text: z.string().min(1)       // default_language 的文案文本
});

// requirementPageSchema 中 copy 字段变更
const requirementPageSchema = z.object({
  page_id: z.string().min(1),
  name: z.string().min(1),
  baseline_page: z.string().min(1),
  design_status: z.enum(designStatuses),
  design_id: z.string().regex(/^D-[a-f0-9]{8}$/).optional(),
  features: z.string().optional(),
  copy: z.array(copyItemSchema).optional(),   // ← 从 string 变为结构化数组
  fields: z.string().optional(),
  interactions: z.string().optional()
}).strict();
```

基线页面的 `copy` 字段同步变更：

```typescript
const baselinePageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  features: z.string(),
  copy: z.array(copyItemSchema),   // ← 从 string 变为结构化数组
  fields: z.string(),
  interactions: z.string(),
  source_requirements: z.array(z.string().min(1))
}).strict();
```

### 5.2 文案产生时机

文案在 **需求上传/修改时** 由 AI 一次性分析产生所有语言的翻译，不是设计稿生成后提取。

AI 翻译时的上下文输入：
- 产品基线（`MCP.get_product_baseline`）— 提供整个产品的术语体系和已有页面文案风格
- 当前需求文档 — 提供完整语境
- 产品 `languages` 列表 + `default_language` — 确定需要输出哪些语言

流程：

```
Agent: MCP.get_product_baseline(product_id)  → 获取基线上下文
Agent: MCP.get_product(product_id)           → 获取 languages + default_language
       │
       ▼
Agent: [AI] 格式化 + 拆解 + 翻译（单次 AI 调用）
       │
       │ 输出：
       │   - 格式化后的 document_md
       │   - pages[]（含 copy: [{context, text}]，text 为 default_language）
       │   - navigation[]
       │   - translations: [{page_id, context, texts: {en: "...", ja: "..."}}]
       │
       ▼
MCP.save_requirement(requirement_id, document_md, ui_affected, pages[], navigation[], translations[], rules[], remove_rule_ids[], remove_page_ids[])
       │
       ▼
Core: 写入 requirement.yaml（含结构化 copy）
      写入 copy-translations.yaml（该需求的多语言翻译）
      更新 baseline.yaml（基线页面的 copy 同步更新）
```

AI 在拆解页面时，根据功能描述推导出该页面需要的 UI 文案，并结合产品基线上下文一次性输出所有语言的翻译。例如：
- features 提到"邮箱密码登录" → 推导出 email_label、password_label、submit_button 等文案
- 结合基线中已有页面的文案风格，保持术语一致性
- 一次性输出 default_language 文案 + 其他语言翻译

### 5.3 设计稿生成时使用文案

Agent 在构造设计 prompt 时，从需求页面的 `copy` 字段读取文案，注入到 prompt 中：

```
Design this page with the following UI text (in {default_language_label}):
- Page title: "登录"
- Email label: "邮箱地址"
- Password label: "密码"
- Submit button: "登录"
- Forgot password link: "忘记密码？"
- Third party divider: "或使用以下方式登录"

Use these exact texts on the corresponding UI elements. Do not invent other text.
```

这样设计稿上的文字有据可依，不是 AI 临场发挥。

### 5.4 多语言翻译存储

翻译数据跟着需求走，每个需求独立维护一份翻译文件：

`data/{product_id}/{requirement_id}/copy-translations.yaml`：

```yaml
translations:
  - page_id: "login"
    entries:
      - context: "page_title"
        texts:
          en: "Login"
          ja: "ログイン"
      - context: "email_label"
        texts:
          en: "Email address"
          ja: "メールアドレス"
      - context: "submit_button"
        texts:
          en: "Login"
          ja: "ログイン"
  - page_id: "home"
    entries:
      - context: "welcome_message"
        texts:
          en: "Welcome back"
          ja: "おかえりなさい"
```

- 翻译文件按需求维度存储，需求间互不干扰
- 只存储非 `default_language` 的翻译（default_language 的文案在 requirement.yaml 的 pages[].copy 中）
- 需求归档后翻译数据完整保留
- 产品只有一种语言时不生成此文件

#### 需求级存储的好处

1. 需求间互不干扰，一个需求的文案修改不影响其他需求
2. 需求归档后翻译数据完整保留
3. 回滚需求时翻译也跟着回滚
4. 每次 save_requirement 只需更新当前需求的翻译文件

#### 翻译 Schema

```typescript
const translationEntrySchema = z.object({
  context: z.string().min(1),
  texts: z.record(z.string(), z.string()),  // 部分语言的翻译，key 为语言代码，不要求所有语言都存在
  outdated: z.boolean().optional()    // 源语言文案变化后标记为 true
});

const pageTranslationSchema = z.object({
  page_id: z.string().min(1),
  entries: z.array(translationEntrySchema)
});

const copyTranslationsFileSchema = z.object({
  translations: z.array(pageTranslationSchema)
});
```

#### MCP 接口变更

旧的 `submit_requirement` 和 `update_requirement` 已删除，统一为 `save_requirement`（详见功能一 MCP 工具变更章节）。`translations` 作为 `save_requirement` 的可选字段传入。

Core 层 `saveRequirement` 收到 `translations` 后，原子写入 `copy-translations.yaml`（与 requirement.yaml、document.md、baseline.yaml 同属一个事务）。

### 5.5 文案更新策略

当需求修改（`save_requirement`）导致页面 copy 变化时：

1. 新增的 copy 条目：翻译文件中无对应条目，其他语言为空
2. 删除的 copy 条目：翻译文件中对应条目保留（不主动删除，避免误删有效翻译）
3. text 变化的 copy 条目：翻译文件中对应条目标记为 `outdated: true`

```yaml
translations:
  - page_id: "login"
    entries:
      - context: "submit_button"
        outdated: true          # 源语言文案已变化，翻译可能需要更新
        texts:
          en: "Login"           # 旧翻译
          ja: "ログイン"
```

### 5.6 MCP 文案工具

新增 MCP 工具 `get_page_copy`：

```typescript
const getPageCopySchema = z.object({
  product_id: z.string().min(1),
  page_id: z.string().min(1),
  requirement_id: z.string().min(1).optional()  // 不传则取最新需求
}).strict();
```

返回：该需求中该页面的 `copy`（default_language 文案）+ `copy-translations.yaml` 中该页面的翻译数据。合并为完整的多语言文案视图。

MCP handler 实现：

```typescript
get_page_copy: tool("get_page_copy", async (input) => {
  const requirement = input.requirement_id
    ? await store.requirements.getRequirement({ requirement_id: input.requirement_id })
    : await store.requirements.getRequirement({ product_id: input.product_id });
  const page = requirement.pages.find(p => p.page_id === input.page_id || p.baseline_page === input.page_id);
  if (!page) throw new ToolError("PAGE_NOT_FOUND", ...);
  const translations = await store.copy.getTranslations(requirement.product_id, requirement.id);
  const pageTranslations = translations.find(t => t.page_id === input.page_id);
  return {
    page_id: input.page_id,
    default_language_copy: page.copy ?? [],
    translations: pageTranslations?.entries ?? []
  };
}),
```

新增 MCP 工具 `update_page_copy`：

```typescript
const updatePageCopySchema = z.object({
  requirement_id: z.string().min(1),
  page_id: z.string().min(1),
  translations: z.array(z.object({
    context: z.string().min(1),
    texts: z.record(z.string(), z.string())  // 部分语言
  }))
}).strict();
```

用于手动修正翻译。写入后自动清除对应条目的 `outdated` 标记。

### 5.7 Web 后台文案查看

在基线页面详情中展示多语言文案表格：

```
┌─ 页面文案 ────────────────────────────────────────────────┐
│                                                            │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 元素              │ 简体中文  │ 英文     │ 日语       │ │
│  │───────────────────│──────────│─────────│───────────│ │
│  │ page_title        │ 登录     │ Login   │ ログイン   │ │
│  │ email_label       │ 邮箱地址  │ Email.. │ メール...  │ │
│  │ submit_button     │ 登录     │ Login   │ ログイン   │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                            │
│  ⚠️ 标记为 outdated 的条目高亮显示                          │
└────────────────────────────────────────────────────────────┘
```

文案表格为只读展示。翻译通过 MCP 工具 `update_page_copy` 写入。

### 5.8 `get_requirement` 一站式数据返回

MCP 的核心消费场景是 AI 开发者获取完整产品数据来写代码。`get_requirement` 扩展为一站式入口，一次调用返回 AI 开发所需的全部信息：

```typescript
// get_requirement 返回值
{
  id: "R-1a2b3c4d",
  product_id: "P-a3f8b2",
  title: "登录功能优化",
  status: "active",
  ui_affected: true,
  document_md: "# 登录功能优化\n\n## 背景\n...",
  navigation: [{ from: "login", to: "home", label: "登录成功" }],

  pages: [
    {
      page_id: "login",
      name: "登录页",
      baseline_page: "login",
      design_status: "done",
      design_id: "D-a1b2c3d4",
      change_type: "patch",
      change_summary: "新增手机号登录",
      features: "邮箱密码登录 + 手机号验证码登录 + 第三方登录",
      copy: [
        { context: "submit_button", text: "登录" },
        { context: "phone_tab", text: "手机号登录" }
      ],
      copy_translations: [
        { context: "submit_button", texts: { en: "Login", ja: "ログイン" } },
        { context: "phone_tab", texts: { en: "Phone Login", ja: "電話ログイン" } }
      ],
      fields: "email, password, phone, sms_code",
      interactions: "...",
      design: {
        pen_path: "/path/to/design.pen",
        preview_path: "/path/to/preview@2x.png",
        version: 3,
        updated_at: "2026-05-18T10:30:00Z"
      }
    }
  ]
}
```

**AI 开发者的完整数据获取路径：**

```
1. get_requirement(product_id)
   → 需求文档 + 页面功能 + 多语言文案 + 设计稿路径/版本
   → 一次调用获得 80% 所需数据

2. get_design_annotations(design_id)
   → 设计稿节点树（组件结构、布局、样式属性）
   → 用于理解 UI 结构

3. export_design_asset(design_id, node_id, format)
   → 具体节点的切图文件
   → 用于获取图标、图片等资源

4. get_product_rules(product_id)
   → BDD 逻辑规则
   → 用于理解业务逻辑约束
```

**实现路径：MCP 层聚合。**

数据聚合在 MCP 工具的 handler 中完成。`RequirementService` 不变，但 `DesignService` 新增 public `getDesignMetadata` 方法（从 server routes 的 `readDesignMetadata` 私有 helper 提升并重构）：

```typescript
// packages/core/src/design.ts 新增方法
interface DesignMetadata {
  id: string;
  pen_path: string;        // 绝对路径，拼接自 dataDir + product_id + requirement_id + design_id
  preview_path: string;    // 绝对路径
  version: number;
  created_at: string;
  updated_at: string;
}

async getDesignMetadata(designId: string): Promise<DesignMetadata> {
  const design = await this.readDesignById(designId);
  const designDir = join(this.dataDir, design.product_id, design.requirement_id, design.id);
  return {
    id: design.id,
    pen_path: join(designDir, "design.pen"),
    preview_path: join(designDir, "preview@2x.png"),
    version: design.version,
    created_at: design.created_at,
    updated_at: design.updated_at
  };
}
```

MCP handler 聚合逻辑：

```typescript
get_requirement: tool("get_requirement", async (input) => {
  const requirement = await store.requirements.getRequirement(input);
  const translations = await store.copy.getTranslations(requirement.product_id, requirement.id);
  const pagesWithDesign = await Promise.all(requirement.pages.map(async (page) => {
    const design = page.design_id
      ? await store.designs.getDesignMetadata(page.design_id)
      : undefined;
    const pageTranslations = translations.find(t => t.page_id === page.page_id);
    return { ...page, copy_translations: pageTranslations?.entries ?? [], design };
  }));
  return { ...requirement, pages: pagesWithDesign };
}),
```

设计决策：聚合在 MCP 层而非 RequirementService 中，避免 RequirementService 依赖 DesignService 产生循环依赖。

---

## 功能六：项目文档优化

### 6.1 README 优化

移除 "v0.1 Scope" 章节。新增以下章节：

```markdown
## Architecture

Forma is a pnpm monorepo with the following packages:

| Package | Path | Description |
|---------|------|-------------|
| @xenonbyte/forma-core | packages/core | Persistence, services, schemas |
| @xenonbyte/forma-cli | packages/cli | CLI entrypoint (serve, install, status) |
| @xenonbyte/forma-server | packages/server | Fastify Web API + static UI |
| @xenonbyte/forma-mcp | packages/mcp | MCP server for agent integration |
| @xenonbyte/forma-agent | packages/agent | Agent command templates |
| web | packages/web | React admin UI (Vite + Tailwind) |

## Agent Integration

Forma installs `fm-*` commands for Claude, Codex, and Gemini. See [docs/AGENT.md](docs/AGENT.md) for the full command reference.

## MCP Tools

Forma exposes an MCP server with 25+ tools for product, requirement, design, style, and session management. See [docs/MCP.md](docs/MCP.md) for the tool reference.
```

移除 "v0.1 Scope" 的 "Included in v0.1" 和 "Not included in v0.1" 两个列表。

### 6.2 MCP 文档

新增 `docs/MCP.md`：

```markdown
# Forma MCP Tools

Forma exposes an MCP (Model Context Protocol) server that agents use to interact with product data, requirements, designs, and styles.

## Connection

The MCP server is started alongside the Web server via `forma serve`. Agent platforms connect through the configuration installed by `forma install --platform <platform>`.

## Tool Reference

### Session

| Tool | Description | Input |
|------|-------------|-------|
| `get_current_session` | Read the current product session | — |
| `set_current_session` | Set the current product session | `product_id` |

### Products

| Tool | Description | Input |
|------|-------------|-------|
| `list_products` | List all products | — |
| `get_product` | Read product details | `product_id` |
| `init_product_config` | Write platform, style, languages config | `product_id`, `platform`, `style`, `languages`, `default_language` |
| `complete_product_init` | Mark components as initialized | `product_id` |
| `update_product_config` | Update product config | same as init_product_config |

### Requirements

| Tool | Description | Input |
|------|-------------|-------|
| `get_requirement_history` | List product requirement history | `product_id` |
| `get_requirement` | Read a requirement | `requirement_id` or `product_id` (latest) |
| `save_requirement` | Save requirement (submit or update, auto-detects by status) | `requirement_id`, `document_md`, `ui_affected`, `pages[]`, `navigation[]`, `translations[]?`, `rules[]?`, `remove_rule_ids[]?`, `remove_page_ids[]?` |

### Baseline

| Tool | Description | Input |
|------|-------------|-------|
| `get_product_baseline` | Read product functional baseline | `product_id` |
| `get_baseline_page` | Read one baseline page | `product_id`, `page_id` |
| `get_baseline_image` | Read baseline page preview metadata | `product_id`, `page_id` |
| `get_product_rules` | Read product BDD logic rules | `product_id` |

### Designs

| Tool | Description | Input |
|------|-------------|-------|
| `generate_page_design` | Generate a page design via Pencil | `product_id`, `prompt`, `workspace` |
| `generate_components` | Generate product components via Pencil | `product_id`, `prompt`, `workspace` |
| `save_designs` | Persist validated design outputs | `requirement_id`, `designs[]` |
| `rollback_design` | Rollback to previous version | `design_id` |
| `diff_designs` | Diff between two design versions | `design_id`, `v1`, `v2` |
| `get_design_annotations` | Read design annotations | `design_id` |
| `export_design_asset` | Export a design node | `design_id`, `node_id`, `format` |

### Styles

| Tool | Description | Input |
|------|-------------|-------|
| `list_styles` | List installed styles | — |
| `get_style` | Read style metadata and DESIGN.md | `name` |

### Copy (v0.3)

| Tool | Description | Input |
|------|-------------|-------|
| `get_page_copy` | Read page multilingual copy | `product_id`, `page_id` |
| `update_page_copy` | Write translated copy entries | `requirement_id`, `page_id`, `translations[]` |

### Utilities

| Tool | Description | Input |
|------|-------------|-------|
| `help` | List available tools and usage guide for AI developers | — |

`help` 工具返回值扩展（v0.3）：除了工具列表，新增 `usage_guide` 字段，告诉 AI 开发者如何获取完整产品数据：

```json
{
  "tools": ["get_current_session", "list_products", ...],
  "usage_guide": {
    "description": "Forma MCP provides product requirement, design, and multilingual copy data for AI-assisted development.",
    "workflows": {
      "develop_frontend": {
        "description": "Get all data needed to develop a product page",
        "steps": [
          "1. get_requirement(product_id) → requirement doc, pages, multilingual copy, design paths",
          "2. get_design_annotations(design_id) → UI component tree and layout structure",
          "3. export_design_asset(design_id, node_id, format) → icon/image assets",
          "4. get_product_rules(product_id) → BDD business logic rules"
        ],
        "per_page_data": {
          "features": "pages[].features — functional description",
          "copy": "pages[].copy — UI text in default language",
          "copy_translations": "pages[].copy_translations — translations for all languages",
          "fields": "pages[].fields — form field definitions",
          "interactions": "pages[].interactions — interaction behaviors",
          "design_structure": "get_design_annotations(pages[].design_id) — component tree",
          "logic_rules": "get_product_rules → filter by page_id"
        }
      }
    }
  }
}
```

## Error Codes

All tools return structured errors with `error_code`, `message`, and `details`:

| Code | Meaning |
|------|---------|
| `PRODUCT_NOT_FOUND` | Product ID does not exist |
| `PRODUCT_CONFIG_INCOMPLETE` | Product missing required config fields |
| `REQUIREMENT_NOT_FOUND` | Requirement ID does not exist |
| `STYLE_NOT_FOUND` | Style name does not exist |
| `DESIGN_NOT_FOUND` | Design ID does not exist |
| `PEN_FILE_INVALID` | .pen file failed validation |
| `VALIDATION_ERROR` | Tool input schema validation failed |
| `INTERNAL_ERROR` | Unexpected server error |
```

### 6.3 Agent 命令文档

新增 `docs/AGENT.md`：

```markdown
# Forma Agent Commands

Forma installs `fm-*` commands for supported agent platforms (Claude, Codex, Gemini). These commands guide agents through product design workflows using Forma MCP tools.

## Installation

```bash
forma install --platform claude,codex,gemini
```

This installs command templates and MCP configuration for each platform.

## Command Reference

| Command | Description | Triggers |
|---------|-------------|----------|
| `fm-list-product` | List products, select one, check config completeness | User wants to switch product or start working |
| `fm-requirement` | Add or modify requirement (any granularity) | User has a PRD, feature spec, or one-line change |
| `fm-design` | Generate page designs for pending/expired pages | After requirement is submitted |
| `fm-refine-design` | Refine an existing page design | User wants to adjust a specific page |
| `fm-refine-components` | Refine the product component library | User wants to adjust shared components |
| `fm-change-style` | Change the product design style | User wants a different visual style |
| `fm-rollback-design` | Rollback a design to previous version | User wants to undo a design change |
| `fm-status` | Show current product and requirement status | User wants an overview |

## Workflow

### First-time Setup (fm-list-product)

When a product is missing configuration, `fm-list-product` triggers interactive setup:

1. **Platform** — Select product type (mobile/desktop/tablet/web)
2. **Style** — AI recommends styles based on product description, user selects
3. **Languages** — Select supported languages (multi-select), confirm default language
4. **Components** — Auto-generate shared component library via Pencil

### Design Flow

```
fm-requirement → fm-design → fm-refine-design (iterate)
```

### Iterative Requirement Changes

```
fm-requirement (add/modify) → fm-design (for new/patch/rebuild pages) → fm-refine-design (iterate)
```

## Configuration Completeness

Before any design operation, the agent checks that the product has:
- `platform` — product type
- `style` — design style with variables
- `languages` — at least one supported language
- `components_initialized` — shared component library generated

Missing fields trigger interactive prompts to complete configuration.
```

---

## 新增 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/products/:id/config` | 初始化/更新产品配置（platform + style + languages + default_language） |

已有 `init_product_config` MCP 工具和 `ProductService.initProductConfig` 方法，新增 HTTP 路由即可。

## 变更 API/MCP 接口

| 接口 | 变更内容 |
|------|----------|
| `init_product_config` MCP | 新增 `languages`、`default_language` 必填字段 |
| `update_product_config` MCP | 同上 |
| `submit_requirement` MCP | **删除**，合并为 `save_requirement` |
| `update_requirement` MCP | **删除**，合并为 `save_requirement` |
| `save_requirement` MCP | **新增**，统一入口：接受 `requirement_id`, `document_md`, `ui_affected`, `pages[]`（含结构化 copy、change_type、change_summary）, `navigation[]`, `translations[]?`, `rules[]?`（扁平数组，含可选 replaces_rule_id）, `remove_rule_ids[]?`, `remove_page_ids[]?`。后端根据需求当前 status 和 ui_affected 分三条路径处理。**移除旧的 `expired_pages` 参数**，由后端从 change_type 自动推导 |
| `get_product` MCP | 返回值新增 `languages`、`default_language` 字段 |
| `get_requirement` MCP | 返回值扩展：pages[] 中自动附带 `copy_translations`（多语言翻译）和 `design`（设计稿路径、版本信息），一站式返回 AI 开发所需全部数据 |
| `help` MCP | 返回值新增 `usage_guide`，包含 AI 开发者的数据获取工作流指引 |
| `generate_page_design` MCP | 门禁检查新增 `languages` |
| `generate_components` MCP | 门禁检查新增 `languages` |
| `get_baseline_image` MCP | 移除 `design_status === "done"` 过滤，允许返回 expired 页面的旧预览图（patch/rebuild 场景需要定位旧设计） |
| `POST /api/products/:id/requirements` HTTP | 简化为只创建 empty 需求（只需 title） |
| `POST /api/products/:id/requirements/:reqId/save` HTTP | **新增**，对应 `save_requirement` MCP 逻辑 |

## 新增 MCP 工具

| 工具名 | 说明 | 输入 |
|--------|------|------|
| `get_page_copy` | 读取页面多语言文案（default_language 文案 + 翻译） | `product_id`, `page_id`, `requirement_id?` |
| `update_page_copy` | 手动修正翻译 | `requirement_id`, `page_id`, `translations[]` |
| `get_product_rules` | 读取产品 BDD 逻辑规则（供冲突检测） | `product_id` |

---

## 文件变更清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `packages/web/src/i18n.ts` | 国际化消息定义和 t() 函数 |
| `packages/web/src/LocaleContext.tsx` | 语言切换 React Context |
| `packages/web/src/i18n.test.ts` | i18n 单元测试 |
| `packages/core/src/copy.ts` | CopyService：文案管理 |

#### CopyService 接口定义

```typescript
export class CopyService {
  constructor(private deps: { home: string }) {}

  /** 读取需求的翻译文件 */
  async getTranslations(productId: string, requirementId: string): Promise<PageTranslation[]>;

  /** 保存翻译文件（原子写入） */
  async saveTranslations(productId: string, requirementId: string, translations: PageTranslation[]): Promise<void>;

  /** 更新单个页面的翻译（合并写入，清除 outdated） */
  async updatePageTranslations(productId: string, requirementId: string, pageId: string, translations: TranslationEntry[]): Promise<void>;

  /** 合并翻译：对比新旧 copy，标记 outdated */
  async mergeTranslations(
    productId: string,
    requirementId: string,
    oldCopy: Record<string, CopyItem[]>,
    newCopy: Record<string, CopyItem[]>,
    newTranslations: PageTranslation[]
  ): Promise<PageTranslation[]>;
}
```
| `packages/core/tests/copy.test.ts` | 文案服务单元测试 |
| `docs/MCP.md` | MCP 工具参考文档 |
| `docs/AGENT.md` | Agent 命令参考文档 |

### 修改文件

| 文件 | 变更内容 |
|------|----------|
| `packages/core/src/schemas.ts` | 新增 `languages` 枚举和 `Language` 类型 |
| `packages/core/src/product.ts` | productSchema 新增 `languages`、`default_language` 字段；`initProductConfig` 接受新字段；新增导出 `assertProductConfig` 函数（从 mcp/tools.ts 提取，session.ts 和 tools.ts 共用） |
| `packages/core/src/store.ts` | 新增 `copy: CopyService` 到 FormaStore；`RequirementService` 构造函数新增 `copy: CopyService` 依赖注入（`commitRequirementAndBaseline` 内部调用 `copy.saveTranslations`） |
| `packages/core/src/index.ts` | 导出 CopyService、Language、languages、copyItemSchema |
| `packages/core/src/requirement.ts` | `requirementPageSchema` 的 `copy` 字段从 `z.string()` 变为 `z.array(copyItemSchema)`；新增 `change_type`、`change_summary`、`ui_affected` 字段；新增 `saveRequirement` 方法；`getLatestRequirement` 改为按 `updated_at` 降序且排除 archived 状态；`mapNavigationToBaseline` 移除 expired 过滤 |
| `packages/core/src/session.ts` | `setCurrentProduct` 的配置完整性检查新增 `languages` |
| `packages/core/src/baseline.ts` | `baselinePageSchema` 的 `copy` 字段从 `z.string()` 变为 `z.array(copyItemSchema)`；`updateFromRequirement` 移除 expired 过滤；`BaselineSourcePage` 接口的 `copy` 字段从 `string?` 变为 `CopyItem[]?`；内部 `page.copy ?? ""` 改为 `page.copy ?? []` |
| `packages/core/src/design.ts` | `save_designs` 模式校验放宽：update 接受 expired+rebuild、refine 接受 expired+patch；`stageExistingDesign` 接受 expired；新增 public `getDesignMetadata(designId)` 方法（从 server routes 私有 helper 提升） |
| `packages/mcp/src/tools.ts` | `init_product_config` schema 新增 languages/default_language；删除 `submit_requirement` 和 `update_requirement`；新增 `save_requirement`（统一入口）；新增 `get_page_copy`、`update_page_copy`、`get_product_rules` 工具；`assertProductConfig` 新增 languages 检查 |
| `packages/server/src/routes.ts` | 新增 `POST /api/products/:id/config` 路由 |
| `packages/web/src/pages/ProductNew.tsx` | 表单新增 platform、style、languages、default_language 必填字段 |
| `packages/web/src/pages/ProductDetail.tsx` | 显示产品语言配置；新增配置补全表单（platform/style/languages 缺失时显示）；需求创建表单简化为只输入 title（移除 document_md/pages/navigation 字段）；需求列表显示 empty 需求为"待填充" |
| `packages/web/src/pages/BaselineView.tsx` | 新增多语言文案表格展示（Tab 或内嵌在页面详情中） |
| `packages/web/src/components/Layout.tsx` | 顶部导航栏新增语言切换按钮 |
| `packages/web/src/App.tsx` | 包裹 LocaleProvider |
| `packages/web/src/api.ts` | 新增 `configureProduct()`、`getPageCopy()`、`saveRequirement()` 方法；`RequirementPage` 接口 copy 从 string 变为 CopyItem[]，新增 change_type/change_summary；`BaselinePage` 接口 copy 从 string 变为 CopyItem[]；删除 `createRequirement()`（改为 `createEmptyRequirement(title)` + `saveRequirement()`） |
| `packages/agent/templates/shared/SKILL.md` | 新增语言相关指引、需求文档格式化模板、change_type 判断规则 |
| `packages/agent/templates/claude/fm-list-product.md` | 新增 languages 兜底步骤 |
| `packages/agent/templates/claude/fm-upload-requirement.md` | 删除，合并为 fm-requirement.md |
| `packages/agent/templates/claude/fm-update-requirement.md` | 删除，合并为 fm-requirement.md |
| `packages/agent/templates/claude/fm-requirement.md` | 新增：统一需求入口 |
| `packages/agent/templates/claude/fm-design.md` | 新增 patch/rebuild 模式支持：注入 change_summary 和 copy 文案到 prompt |
| `packages/agent/templates/codex/fm-list-product/SKILL.md` | 新增 languages 兜底步骤 |
| `packages/agent/templates/codex/fm-upload-requirement/SKILL.md` | 删除，合并为 fm-requirement |
| `packages/agent/templates/codex/fm-update-requirement/SKILL.md` | 删除，合并为 fm-requirement |
| `packages/agent/templates/codex/fm-requirement/SKILL.md` | 新增：统一需求入口 |
| `packages/agent/templates/codex/fm-design/SKILL.md` | 新增 patch/rebuild 模式支持 |
| `packages/agent/templates/gemini/fm-list-product.toml` | 新增 languages 兜底步骤 |
| `packages/agent/templates/gemini/fm-upload-requirement.toml` | 删除，合并为 fm-requirement |
| `packages/agent/templates/gemini/fm-update-requirement.toml` | 删除，合并为 fm-requirement |
| `packages/agent/templates/gemini/fm-requirement.toml` | 新增：统一需求入口 |
| `packages/agent/templates/gemini/fm-design.toml` | 新增 patch/rebuild 模式支持 |
| `packages/agent/templates/claude/fm-status.md` | 产品配置摘要新增 languages 展示 |
| `packages/agent/templates/codex/fm-status/SKILL.md` | 同上 |
| `packages/agent/templates/gemini/fm-status.toml` | 同上 |
| `packages/agent/src/index.ts` | `formaAgentCommands` 数组：删除 `fm-upload-requirement`、`fm-update-requirement`，新增 `fm-requirement` |
| `packages/core/src/install.ts` | Agent 命令注册列表同步更新 |
| `README.md` | 移除 v0.1 Scope，新增 Architecture、Agent Integration、MCP Tools 章节 |

---

## 事务与原子性

### save_requirement 的事务范围

`save_requirement` 的事务文件集根据执行路径不同：

| 路径 | 事务文件 |
|------|----------|
| `doFirstSubmit` / `doPageUpdate` | requirement.yaml + document.md + copy-translations.yaml + baseline.yaml + rules.yaml（5 个） |
| `doLogicOnlyUpdate` | requirement.yaml + document.md + rules.yaml（3 个，不触碰 baseline 和 translations） |

快照列表根据路径动态确定。`commitRequirementAndBaseline` 方法拆分为：
- `commitWithBaseline(files: 5)`：有 UI 变更时
- `commitLogicOnly(files: 3)`：纯逻辑变更时

**testHooks 扩展：** 当前 `RequirementService` 使用 `testHooks`（`afterBaselineUpdate`、`afterDocumentWrite`）来验证原子回滚。扩展后新增 hook 点：

- `afterTranslationsWrite`：copy-translations.yaml 写入后触发
- `afterRulesWrite`：rules.yaml 写入后触发

确保测试可以在任意步骤注入失败来验证回滚完整性。

---

## AI 输出量控制

### 问题

`fm-requirement` 的单次 AI 调用需要输出：格式化文档 + pages[] + navigation[] + translations[] + rules[] + remove_page_ids[]。对于大文档（10+ 页面、5+ 语言），输出可能超出单次 AI 调用的 token 限制。

### 降级策略

1. **分批输出**：当 `语言数 × 页面数 > 10` 时，强制分两次调用：
   - 第一次：格式化文档 + pages[] + navigation[] + rules[] + remove_page_ids[]
   - 第二次：translations[]（以第一次的 pages[].copy 为输入翻译）

2. **触发条件**：硬阈值 `语言数 × 页面数 > 10`。例如 3 种语言 × 4 个页面 = 12 > 10，触发分批。

3. **验证机制**：Agent 收到 AI 输出后校验 JSON 结构完整性（document_md 非空、pages[] 每项含必要字段、rules[] 格式正确）。校验失败时提示 AI 重新输出（最多重试 1 次）。

这不影响 MCP 接口（`save_requirement` 仍然一次性接收所有数据），只影响 Agent 侧的 AI 调用策略。

---

## 已知限制与闭环缓解

以下是 AI 能力边界导致的已知限制，每项都有闭环的缓解机制确保不阻塞用户：

| 限制 | 闭环缓解（不依赖后续版本） |
|------|--------------------------|
| BDD 规则 AI 生成质量不可控 | 步骤 8 强制展示规则让用户审核确认，用户可修改或删除不合理的规则。冲突检测结果是建议而非硬门禁，用户可忽略继续。**最终规则质量由用户把关。** |
| AI change_type 误判 | 步骤 8 展示 change_type 判断结果，用户可要求调整（Agent 模板明确指引"用户指定优先"）。即使误判为 patch，设计结果不满意时用户可通过 fm-refine-design 继续调整。**用户有完整的纠正路径。** |
| 设计稿文案与 copy 不完全一致 | prompt 使用强约束语言。如果 Pencil 生成的文案与指定不符，用户通过 fm-refine-design 修正。**不阻塞流程，用户可迭代修正。** |
| Web 语言切换可能遗漏组件 | 所有使用 `t()` 的组件必须调用 `useLocale()` hook。实现时通过 grep 检查覆盖率。**开发阶段可验证，不是运行时风险。** |
| Pencil CLI patch 与 rebuild 使用相同生成机制 | patch 和 rebuild 都通过 `generate_page_design` 生成新设计，通过 `save_designs`（mode=refine/update）保存到同一 design_id（版本递增）。区别仅在 prompt 内容（patch 附带旧设计标注并指定只改变化部分，rebuild 全量重新生成）。**无未验证假设。** |
| AI 单次输出 6 类数据的结构一致性（document_md + pages + navigation + translations + rules + remove_page_ids） | Agent 收到 AI 输出后做 JSON 结构校验（必要字段存在性、page_id 引用一致性）。校验失败时重试 1 次。重试仍失败则报错让用户简化输入。**硬阈值分批（语言数×页面数>10）已降低单次输出复杂度。** |
| 页面合并依赖 Agent 正确传入 changed pages | 后端合并逻辑信任 Agent 只传有变化的页面。如果 Agent 遗漏了一个 changed 页面，该变更静默丢失。**缓解：步骤 8 确认交互中展示完整的变更摘要（new/patch/rebuild 列表），用户可发现遗漏并要求补充。** |

---

## 测试策略

### 单元测试

| 测试 | 覆盖内容 |
|------|----------|
| `productSchema` 验证 | languages 和 default_language 的约束（min 1、default 在 languages 中） |
| `initProductConfig` | 正确写入 languages 和 default_language |
| `assertProductConfig` | languages 缺失时返回 PRODUCT_CONFIG_INCOMPLETE |
| `requirementPageSchema` | copy 字段为 `z.array(copyItemSchema)`，拒绝 string |
| `baselinePageSchema` | copy 字段为结构化数组，正确存储和读取 |
| `CopyService.getPageCopy` | 合并基线 copy + 翻译文件，返回完整多语言数据 |
| `CopyService.updateTranslations` | 正确写入翻译，清除 outdated 标记 |
| `i18n.t()` | 中英文消息正确返回，fallback 到 key |
| `LocaleContext` | 切换语言触发重新渲染 |
| `ProductNew` 表单 | 必填校验、default_language 自动选择逻辑 |

### 集成测试

| 测试 | 覆盖内容 |
|------|----------|
| `POST /api/products/:id/config` | 正确写入配置，校验 languages 约束 |
| `init_product_config` MCP | 新 schema 校验通过，languages 写入 |
| `save_requirement` MCP | 统一入口：empty→submitted 转换正确；submitted/active 时根据 change_type 设置 design_status；接受结构化 copy 和 translations |
| `get_page_copy` MCP | 返回基线 copy + 翻译数据 |
| `update_page_copy` MCP | 正确写入翻译，清除 outdated |
| `save_requirement` 基线更新 | 结构化 copy 正确写入 baseline.yaml |
| `get_product_rules` MCP | 返回产品 BDD 规则列表 |
| `save_requirement` 原子回滚（UI 路径） | rules.yaml 写入失败时全部 5 个文件回滚 |
| `save_requirement` 原子回滚（logic-only 路径） | rules.yaml 写入失败时 3 个文件回滚（不含 baseline 和 translations） |
| `save_requirement` ui_affected=false | 不修改 pages；状态根据已有页面决定（无页面→active，有 pending→保持） |
| `save_requirement` patch 页面 | design_status=expired，保留旧 design_id |
| `save_designs` patch mode | refine 模式接受 expired + change_type=patch |
| `save_designs` rebuild mode | update 模式接受 expired + hasExistingDesign + change_type=rebuild |

### 需要更新的测试文件

以下测试文件中构造了 `copy` 为字符串的测试数据，需要更新为结构化数组格式：

- `packages/core/tests/requirement-baseline.test.ts`（第 245 行 `copy: "Cart copy"`、第 263 行 `copy: "Updated cart copy"` 等）
- `packages/mcp/tests/tools.test.ts`（submit_requirement/update_requirement 相关用例删除，新增 save_requirement 用例）

不受影响的测试文件：
- `packages/core/tests/design.test.ts`（不直接构造 copy 字段）

### 手动验证

1. 后台新建产品：填写所有必填字段，验证创建成功
2. 后台新建产品：不选语言，验证按钮 disabled
3. 后台切换中英文：验证所有页面文案正确切换
4. Agent fm-list-product：选择缺少 languages 的旧产品，验证语言兜底流程
5. Agent fm-requirement：无可操作需求时验证 block 提示
6. Agent fm-requirement：传入无效内容，验证拒绝提示
7. Agent fm-requirement：传入有效需求（完整文档或一句话），验证格式化输出 + 结构化 copy + change_type 判断正确
8. Agent fm-design：验证生成的设计稿 UI 文字使用需求中的 copy 文案
9. 基线页面详情：验证多语言文案表格正确展示

---

## 验证标准

- `pnpm test` 通过（含新增测试）
- `pnpm build` 通过
- `pnpm typecheck` 通过
- 后台新建产品时 platform、style、languages 为必填，缺一不可提交
- 选择多语言时 default_language 自动推导正确（含 en 则默认 en）
- Agent 收到 `PRODUCT_CONFIG_INCOMPLETE` 且 missing 含 `languages` 时能正确引导用户补全
- `init_product_config` MCP 工具正确校验 `default_language ∈ languages`
- `save_requirement` MCP 工具正确处理 empty→submitted 和 submitted/active 的状态转换
- Agent fm-requirement 无可操作需求时 block 提示
- Agent fm-requirement 对无效输入拒绝，对有效输入输出格式化文档 + 结构化 copy + change_type
- 需求提交后基线页面的 `copy` 字段为结构化数组
- Web 后台中英切换即时生效，刷新后保持选择
- `get_page_copy` 和 `update_page_copy` MCP 工具正常工作
- README 无 v0.1 Scope 章节
- `docs/MCP.md` 和 `docs/AGENT.md` 存在且内容完整
