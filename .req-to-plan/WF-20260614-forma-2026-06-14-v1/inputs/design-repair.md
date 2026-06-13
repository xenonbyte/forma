# Design

## Design Summary
在既有媒体子系统（`packages/core/src/media/` + `brand-assets.ts` + `brand-asset-render.ts` + 品牌资产画布）上做治理迭代，核心是把"品牌资产生成"从分散的 preset/单一规格，收敛为一个 **core 拥有的确定性契约 + agent 软约束执行** 的架构：

1. **唯一的 platform→surface 映射** 决定每种资产生成几套（mobile/tablet→{android,ios}；web/desktop→单套）。
2. **每资产类型一张经核实的分辨率表**（store-shot / banner / poster / app-icon），值附官方来源 URL + 核实日期（沿用 `STORE_SHOT_PRESETS` 既有 provenance 约定），未核实前以 UNCONFIRMED 候选存在且不进测试断言。
3. **`getBrandAssetPlan(product)`** 取代 `listStoreShotPresets`，按产品平台 + 设置块（数量/开关）算出"目标资产计划"（每项含 kind/surface/variant/尺寸/数量）。计划＝目标态，manifest＝现状态，二者解耦。
4. **应用图标本地派生流水线**：mobile/tablet 生成 3 张 1080² 母图（a 透明 logo / b 不透明背景 / c 666² 安全区 logo），web/desktop 生成 2 张（a/b）；全部平台变体（Android 前景/背景/单色/standard；iOS standard 多档/深色/着色前景；web/desktop 圆角 standard 多档）经 sharp composite/tint/greyscale/resize/圆角遮罩本地确定性派生，不逐变体生图。
5. **数据模型扩展**：`BrandAssetRecord` 增 `surface?`/`variant?`，新增 `banner` kind；product schema 增 `brand_assets` 设置块。
6. **MCP/UI 同步**：新增 `get_brand_asset_plan` / `delete_brand_asset`，移除 `list_store_shot_presets`；`save_brand_asset(app-icon)` 改判别联合；后台产品页加设置入口；画布按 surface 分组 + banner。
7. **agent/craft/CLAUDE.md 同步**：三平台模板更新保持 parity，删除 `fm-rollback-design`，明确 fm-* 纯命令＝全量重生成＋确认。

破坏式、无历史包袱、单分支一次性交付。

## Current Code Evidence
- `packages/core/src/schemas.ts:4` — `platforms = ["mobile","desktop","tablet","web"]`（单字段，无 surface 概念）。
- `packages/core/src/product.ts:55,116` — `productSchema`（`.strict()`），含 `platform`/`brand_style`/`system_style`/`languages`/`default_language`；无 `brand_assets` 块。`ProductConfigField`（:136）= `"platform"|"brand_style"|"languages"`。
- `packages/core/src/brand-assets.ts`:
  - `APP_ICON_SIZES`（:55）= ios[1024,180,120] / android[512,192,144,96,72,48] / web[512,192,32,16]——当前**只能从单张方图缩放派生**，无分层/主题变体能力。
  - `STORE_SHOT_PRESETS`（:87）仅 ios-6.9 / android-phone / web-og 三档，带 `source`+`verifiedAt` provenance；`PLATFORM_PRESET_MAP`（:121）tablet/desktop 退化到 web-og。
  - `BRAND_ASSET_KINDS`（:144）= ["app-icon","store-shot","poster"]；`KIND_SUBDIR`（:136）同三项。
  - `BrandAssetRecord`（:156）= {kind,name,files,brand_style,model?,generated_at}——无 surface/variant。
  - `SaveBrandAssetInput`（:195）= {product_id,kind,name,brand_style,source,platform?,model?,target?}；`source` 为 image_ref XOR html。
  - `listStoreShotPresets`（:692）按 `PLATFORM_PRESET_MAP` 过滤返回；`resolveBrandImageRef`（:710）在 :741 用 `records.find(r => r.name === "primary") ?? records.at(-1)` 做 name="primary" 回退。
  - `SHARP_PIXEL_LIMIT`（:133）64MP 解码上限；`MASTER_SIZE`（:129）2048。
- `packages/core/src/media/image-models.ts` — `IMAGE_PROVIDERS`（volcengine/openai/gemini/stub），`IMAGE_MODELS` 当前 openai 仅 `gpt-image-1`(default)、gemini 仅 `gemini-2.5-flash-image`(default)；`MODEL_SIZE_TABLES` + `resolveSize`（:223，未注册模型抛 `MEDIA_INVALID_INPUT`）。
- `packages/core/src/media/image-generate.ts` — `RENDERERS.gemini = (input,cfg) => renderOpenAICompatibleImage(input,cfg,"gemini")`（走 OpenAI 兼容 `/images/generations`）；`stub` 渲染器供测试。
- `packages/web/src/pages/BrandAssets.tsx` — `groupByKind`（:177）已按 kind 动态分组（M5 注释说 store-shot/poster 自动出现）；`AssetTile` 渲染；stale 徽标比对 `asset.brand_style !== product.brand_style`。无 surface 子分组。
- `packages/web/src/i18n.ts` — 仅 `en`/`zh` 两个 locale 块（实测）。
- `packages/agent/templates/{claude,codex,gemini}/` — 三平台模板，`template-parity.test.ts` 强制 parity；claude 现 8 命令（含 `fm-app-icon`/`fm-brand-assets`/`fm-design`）。

## Requirements Coverage
| AC | 覆盖它的设计 |
|---|---|
| AC-001 | DES-ARCH-001 |
| AC-002 | DES-ARCH-002 + DES-ARCH-005 + DES-ARCH-006 |
| AC-003 | DES-ARCH-005 + DES-ARCH-009 |
| AC-004 | DES-ARCH-007 + DES-ARCH-008 |
| AC-005 | DES-ARCH-008 |
| AC-006 | DES-ARCH-004 |
| AC-007 | DES-ARCH-003 |
| AC-008 | DES-ARCH-010 |
| AC-009 | DES-ARCH-011 |
| AC-010 | DES-ARCH-012 |
| AC-011 | DES-ARCH-012 |
| AC-012 | 全部（lint/typecheck/test/vzi-boundary 兜底） |

## Options Considered
- **图标产出（承重）**：A) 逐平台逐变体各生一张图（被否：贵、慢、不一致、难测）；B) **3 母图 + sharp 本地派生（选中，D16/D17）**——确定、可不依赖 stub 测试、便宜、跨变体一致。
- **分辨率契约形态**：A) 沿用 preset id 表 + 平台映射过滤（被否：不区分 surface、无法表达数量/开关、tablet 退化）；B) **结构化分辨率表 + `getBrandAssetPlan` 计算计划（选中）**——把 surface/variant/count/开关一次性算清。
- **设置存储位置**：A) 全局 `config.yaml`（被否：是 per-product 偏好）；B) **product schema `brand_assets` 块（选中）**——随产品走，经 `runProductMutation` 串行化。
- **孤儿清理**：A) 保存时自动删多余（被否：隐式、易误删、与"计划/现状解耦"冲突）；B) **显式 `delete_brand_asset`（选中，D15）**——可观察、可测。
- **破坏式 vs 兼容**：按 ASSUME-001 选破坏式，零 shim、零迁移。

## Chosen Design

### DES-ARCH-001 生图模型目录扩充
在 `image-models.ts`：`IMAGE_MODELS` 增 `gpt-image-2`、`gpt-image-1.5`（openai）与 `gemini-3-pro-image`、`gemini-3.1-flash-image`（gemini）；provider 内默认 `default:true` 迁移到 `gpt-image-1.5` / `gemini-3.1-flash-image`（旧默认降为非默认条目）。`MODEL_SIZE_TABLES` 为每个新模型登记 size 表；新模型的精确 model id、允许尺寸、Gemini renderer 兼容性**实现期经官方文档核实**后写入，附 source URL + verifiedAt provenance 注释；未核实值不进断言（RISK-DEP-002）。volcengine 仍全局优先。Gemini renderer 兼容性见 DECISION-002。

### DES-ARCH-002 platform→surface 唯一映射
新增单一映射（core，brand-assets 或新 plan 模块）：`mobile→["android","ios"]`、`tablet→["android","ios"]`、`web→[null]`(单 surface)、`desktop→[null]`。所有资产计划（store-shot/banner/icon）复用它决定生成套数；poster 例外（平台无关，固定 3 样式，见 DES-ARCH-006）。单测覆盖四端。`surface` 落到 `BrandAssetRecord.surface`，画布据此分组（DES-ARCH-011）。

### DES-ARCH-003 数据模型：surface/variant + banner kind
`BrandAssetRecord` 增可选 `surface?: "android" | "ios"`（单 surface 端不写）与 `variant?: string`（app-icon 层名/poster 样式/banner 套）。`BRAND_ASSET_KINDS` 增 `"banner"`，`KIND_SUBDIR` 增 `banner: "banners"`，`brandAssetRecordSchema` 同步（zod strict，新增字段 `.optional()`）。无迁移：直接更新 fixtures（RISK-DATA-003）。

### DES-ARCH-004 product brand_assets 设置块
`productSchema` 增 `brand_assets` 可选块（`.strict()`）：`store_shot_count: z.number().int().min(3).max(8).default(3)`、`banner: z.boolean().default(false)`、`poster_portrait/poster_landscape/poster_square: z.boolean()`（默认值见 DECISION-001 附带的开关默认）。`ProductService.updateBrandAssetSettings(productId, patch)` 经 `runProductMutation` 串行化写入；`ProductConfigField` 视需要扩展或单列设置入口。读取时缺省套用 default。

### DES-ARCH-005 getBrandAssetPlan 契约（取代 presets）
新增 `getBrandAssetPlan(product): BrandAssetPlan`：输入 product（平台 + brand_assets 设置），输出每资产类型的计划条目数组 `{kind, surface?|null, variant?, width, height, count}`：
- store-shot：对每个 surface 生成 `store_shot_count` 条（surface 端 × 数量）。
- banner：banner 开关开时对每个 surface 1 条。
- poster：按 3 开关各 0/1 条（portrait/landscape/square），surface=null。
- app-icon：每个 surface 一组变体计划（变体清单见 DES-ARCH-007）。
彻底删除 `STORE_SHOT_PRESETS`/`PLATFORM_PRESET_MAP`/`listStoreShotPresets`/`StoreShotPreset`（破坏式，RISK-DATA-001 先 codegraph_impact 扫引用）。尺寸取自 DES-ARCH-006 的表。计划是纯函数、易测（结构断言，不断言未核实像素）。

### DES-ARCH-006 分辨率表（store-shot / banner / poster / app-icon）
每资产类型一张结构化表，键为 (platform, surface)（poster 为样式名），值 `{width,height,source,verifiedAt}`。源文档 §6.4 候选值作为 UNCONFIRMED 起点，**实现期逐项核实官方文档后定稿**（OVERFLOW-002：核实是 PLAN 内独立步骤，先结构后数值）。poster 固定 3 样式（竖 1080×1920 / 横 1920×1080 / 方 1080×1080，平台无关）。两处可疑源值（Android 安全区 66×66、桌面 720×72/358×358）见 DECISION-001。沿用 `SHARP_PIXEL_LIMIT`/render ≤16384 边界（RISK-SEC-003）。

### DES-ARCH-007 应用图标 sharp 本地派生流水线
新增 `brand-icon-derive.ts`（core）：输入母图引用，归一化到 1080² 工作画布，按平台派生全套变体（确定性，sharp composite/tint/greyscale/resize/圆角 SVG 遮罩 dest-in）。母图：mobile/tablet 需 a(透明 logo)/b(不透明背景)/c(666² 安全区 logo)，web/desktop 需 a/b。变体矩阵：
- Android：图标=a 合成 b 缩放；前景层=c；背景层=b；单色=a→greyscale+tint(纯黑)+透明；standard 512。
- iOS：standard 多档（1024/180/120，tablet 167/152——尺寸待核实）；深色=a+tint+深色底；着色前景=c+tint+透明。
- web/desktop：仅一张圆角 standard 最大图（web 512 / desktop 1024），其余档由它缩放（D17，ASSUME-003 圆角本地加）。
首步做最小派生 spike + 不依赖 stub 单测验证 tint/greyscale/圆角/alpha（RISK-DEP-003）。

### DES-ARCH-008 save_brand_asset(app-icon) 判别联合 + delete_brand_asset
`SaveBrandAssetInput` 对 `kind:"app-icon"` 改判别联合输入 `{logo_ref, bg_ref, safe_logo_ref?, colors?}`（不再要 caller 传 name/surface/variant/target）；core 调 DES-ARCH-007 派生整套记录、**原子替换**该 product 的全部 app-icon 记录，返回 `{assets:[...]}`。store-shot/banner/poster 保持 html→PNG 路径，但带上 surface/variant。新增 `deleteBrandAsset(deps, {product_id, kind, name})`：路径边界校验（限定 brand-assets/ 内）+ `runProductMutation` 锁，删 manifest 记录与磁盘文件（RISK-SEC-002）。移除 `resolveBrandImageRef` 的 `name==="primary"` 回退，改用确定的 variant/name 解析。

### DES-ARCH-009 MCP 工具集变更
新增 `get_brand_asset_plan`（返回 DES-ARCH-005 计划）、`delete_brand_asset`（DES-ARCH-008）；移除 `list_store_shot_presets`。`save_brand_asset` schema 改判别联合（DES-ARCH-008）。新工具**不读 media-config**，加无凭证外泄断言（RISK-SEC-001）。server 路由若有对应项同步（preset 列表路由如存在则移除/替换）。

### DES-ARCH-010 后台设置 UI + i18n
`ProductDetail.tsx`（后台产品页）加"品牌资产设置"区：store_shot_count 下拉(3–8)、banner 勾选、3 个 poster 勾选；保存调 `update_product_config`/新设置端点 → `updateBrandAssetSettings`。`i18n.ts` en/zh 两块加文案键。保存后 `getBrandAssetPlan` 结果随之变化（AC-008）。

### DES-ARCH-011 品牌资产画布 surface 分组 + banner
`BrandAssets.tsx` 沿用 `groupByKind` 动态分组；在组内或组上按 `asset.surface` 再分子组，mobile/tablet 显示"Android商店截图/iOS商店截图""Android横幅/iOS横幅""Android应用ICON/iOS应用ICON"，其余端显示无 surface 标签（"商店截图/横幅/应用ICON"）。banner kind 自动作为新组出现（动态分组天然支持）。stale 徽标沿用。en/zh 文案补齐。

### DES-ARCH-012 agent 模板 + craft + CLAUDE.md 同步
三平台（claude .md / codex SKILL.md / gemini .toml）更新 `fm-app-icon`（母图 a/b/c + 派生说明，retire 旧"逐尺寸"措辞）、`fm-brand-assets`（store-shot 数量/横幅/海报 3 样式 + 按设置/计划执行）、`fm-design`（如涉及）；保持 `template-parity.test.ts` 通过。删除三平台 `fm-rollback-design` 残留模板（OQ-001；DesignView 回滚保留）。模板明确 fm-* 纯命令重跑＝全量重生成对应资产 + 执行前二次确认（OQ-002/D12）。`craft/image-prompts.md` 补 banner/poster-style/icon-母图 per-purpose scaffold。同步根 `CLAUDE.md`（banners kind、`get_brand_asset_plan`/`delete_brand_asset` 工具集、移除 list_store_shot_presets/name="primary" 描述、画布 surface 分组）。

## Decision Requests

### DECISION-001 可疑源尺寸定稿 + 海报开关默认
Question: 源需求两处尺寸疑似笔误，且 3 个海报开关的默认开/关需定。如何定稿？
Options: A) 尺寸按 D16 用 Android 前景安全区 666×666（66×66 系笔误）+ 桌面图标集用标准档 {1024,512,256,128,64,32,16}（丢弃可疑的 358×358 与 720×72），且 3 个海报开关默认全开。 / B) 严格保留源文档所有值（含 66×66 / 358×358 / 720×72），海报默认仅竖屏开。 / C) 尺寸同 A，但海报默认全关由用户按需开。
Recommended: A
Selected: A
Rationale: 用户拍板（2026-06-14）：修正两处笔误（Android 安全区 666×666、桌面用标准档丢弃 358/720），3 个海报开关默认全开。最贴合平台规范且开箱即用；最终像素值仍以实现期官方核实为准（RISK-DEP-002）。
Status: selected

### DECISION-002 Gemini 3 默认切换策略（依赖兼容性）
Question: gemini-3-pro-image / gemini-3.1-flash-image 是否仍走现有 OpenAI 兼容 /images/generations renderer 未核实。若不兼容，如何处理默认？
Options: A) 仅当实现期核实兼容后才把 provider 默认切到 gemini-3.1-flash-image；不兼容则目录登记新模型但默认仍保 gemini-2.5-flash-image，原生 generateContent renderer 单列后续任务（不扩本批范围）。 / B) 本批直接实现原生 generateContent renderer 以保证默认切换（范围扩张，OVERFLOW-001）。
Recommended: A
Selected: A
Rationale: 用户拍板（2026-06-14）：核实后再切默认。不阻塞其余 9 项，避免范围扩张；renderer 不兼容是外部依赖不确定性，应核实后再切而非预先扩范围。
Status: selected

## Rollback
单分支、测试数据、零迁移、零运行时配置变更。回滚＝放弃/`git revert` 本分支即恢复旧契约与 catalogue；磁盘上的测试品牌资产可按 ASSUME-001 直接清理重生成。唯一运行时破坏性操作 `delete_brand_asset` 受路径边界校验 + per-product 锁约束，误删面被框死在 brand-assets/ 内。真实 provider 调用计费但仅人工验收触发，不在自动路径。

## Observability
- 新模型/分辨率值入表附 source URL + verifiedAt provenance 注释（沿用 STORE_SHOT_PRESETS 约定），核实可审计。
- 图标派生 spike 单测 + 全变体单测（不依赖 stub）使派生确定性可观察。
- `getBrandAssetPlan` 纯函数，计划可被测试断言（结构）。
- `delete_brand_asset` 经 `FormaError` code 报错（路径越界/不存在），不静默。
- 渲染失败（缺 renderHtml、越界尺寸、out-of-bundle ref）沿用既有 fail-loud。

## SPEC Handoff
SPEC 阶段需把以下落成可验证规格：
- 各 DES-ARCH 的精确签名（`getBrandAssetPlan` 返回类型、`BrandAssetPlan` 结构、`brand-icon-derive` 接口、判别联合输入类型、`updateBrandAssetSettings` 签名、`deleteBrandAsset` 签名）。
- product `brand_assets` zod schema 字段 + 默认（待 DECISION-001 海报默认）。
- 分辨率表骨架（键集固定，像素值标 UNCONFIRMED 待核实，含 source/verifiedAt 字段位）。
- MCP 工具 JSON schema（get_brand_asset_plan / delete_brand_asset / 改版 save_brand_asset）。
- 测试矩阵：四端 × {store-shot,banner,poster,app-icon} 的 plan 结构断言；图标派生算子单测；破坏式移除的引用清零（typecheck）；template-parity；画布 surface 分组；i18n 键齐全。
- 两个 DECISION 的结论需在 SPEC 前 selected。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| DES-ARCH-001 | SCOPE-IN-001, AC-001, RISK-DEP-001/002 | active |
| DES-ARCH-002 | RISK-CORR-001, AC-002 | active |
| DES-ARCH-003 | SCOPE-IN-006, AC-007, RISK-DATA-003 | active |
| DES-ARCH-004 | SCOPE-IN-006/008, AC-006 | active |
| DES-ARCH-005 | SCOPE-IN-007, AC-002/003, RISK-DATA-001/002 | active |
| DES-ARCH-006 | SCOPE-IN-002/003/004, AC-002, RISK-DEP-002, RISK-CORR-002/003 | active |
| DES-ARCH-007 | SCOPE-IN-005, AC-004, RISK-DEP-003 | active |
| DES-ARCH-008 | SCOPE-IN-007, AC-004/005, RISK-SEC-002 | active |
| DES-ARCH-009 | SCOPE-IN-007, AC-003, RISK-SEC-001 | active |
| DES-ARCH-010 | SCOPE-IN-008, AC-008 | active |
| DES-ARCH-011 | SCOPE-IN-009, AC-009, D11 | active |
| DES-ARCH-012 | SCOPE-IN-010, AC-010/011, OQ-001/002 | active |
| DECISION-001 | RISK-CORR-003, OQ-005/006, D6 | selected:A |
| DECISION-002 | RISK-DEP-001, ASSUME-005, OQ-004 | selected:A |

## Upstream Summary (read-only)
# Risk Discovery

## Risks

### RISK-SEC-001 凭证泄露面随新工具/路由扩大
Status: mitigated
新增 `get_brand_asset_plan` / `delete_brand_asset` MCP 工具与品牌资产设置读写路径，必须维持 `media-config.yaml` 既有不变量：永不经静态服务/zip 导出/od-diagnostics/日志/`FormaError.details` 暴露。计划工具仅消费 product schema，不触碰凭证；缓解＝新工具不读 media-config，复用既有 masked-read 边界并加单测断言无凭证字段外泄。

### RISK-SEC-002 delete_brand_asset 路径越界 / 误删
Status: mitigated
删除资产文件若不做路径边界校验可越出 `brand-assets/` 删到任意文件。缓解＝复用既有 brand-asset 文件服务的 path-boundary 校验（解析后必须落在 `data/products/<pid>/od-project/brand-assets/` 内），删除走 `runProductMutation` 串行化，仅按 manifest 记录删除其登记文件，拒绝绝对/`..` 路径；单测覆盖越界拒绝。

### RISK-SEC-003 大分辨率渲染资源放大
Status: mitigated
新增大尺寸（如 iOS 横幅候选 4320×2160）经 puppeteer / sharp 渲染可能放大内存。缓解＝沿用 brand-asset-render ≤16384 边界；分辨率值经核实后入表（ASSUME-004），不接受任意外部尺寸；渲染沙箱 request 拦截 allowlist 不放宽。

### RISK-DEP-001 Gemini 3 新模型可能不兼容现有 OpenAI 兼容 renderer
Status: open
现 gemini renderer 走 OpenAI 兼容 `/images/generations`（`image-generate.ts` `renderOpenAICompatibleImage(...,"gemini")`）。`gemini-3-pro-image` / `gemini-3.1-flash-image` 是否仍走该端点未核实（ASSUME-005）。若不兼容需原生 `generateContent` renderer＝范围扩张。缓解＝切默认前先核实；不兼容则该项降级为"目录登记但默认不切换"并单列后续任务，不阻塞其余 9 项。

### RISK-DEP-002 新模型 ID / 尺寸约束为 UNCONFIRMED
Status: open
`gpt-image-2` / `gpt-image-1.5` / 两个 gemini-3 模型的精确 model id 与允许尺寸未经官方文档核实，错误 id 会运行时失败。缓解＝实现期经官方文档核实后再写入 catalogue 与 size 表，来源 URL + 核实日期记入 `image-models.ts` provenance 注释（沿用现有约定）；未核实值不进测试断言。

### RISK-DEP-003 sharp 派生算子可行性
Status: open
图标派生依赖 sharp 的 greyscale+tint（单色/着色）、composite(blend dest-in) 圆角遮罩、透明背景 PNG 合成、resize 到多档。需核实已装 sharp 版本支持这些算子且输出符合预期（尤其 tint 染色与 alpha 保留）。缓解＝实现首步写一个最小派生 spike + 单测（不依赖 stub）验证全部算子，再铺开全变体。

### RISK-DATA-001 破坏式移除的引用残留
Status: mitigated
移除 `STORE_SHOT_PRESETS` / `listStoreShotPresets` / `list_store_shot_presets` / `name="primary"` 回退后，任何残留调用方（core/mcp/server/web/tests/docs）会断裂。缓解＝实现前用 codegraph_impact + 全仓 grep 扫清全部引用，纳入 PLAN 的删除清单；`pnpm typecheck` + 全量测试兜底。

### RISK-DATA-002 设置下调产生孤儿资产
Status: mitigated
store_shot_count 调低或关闭 poster/banner 开关后，磁盘已存在的多余资产成孤儿。缓解＝D15 的 `delete_brand_asset` 提供清理路径；画布与计划按"实际存在的资产"渲染，不假设计划项一定有文件，反之亦然（plan 是目标、manifest 是现状，二者解耦）。

### RISK-DATA-003 BrandAssetRecord schema 变更使既有 fixtures 失效
Status: accepted
新增 `surface`/`variant` 与 `banner` kind 会使既有测试 fixtures / 磁盘 manifest 不匹配。按无历史包袱原则（ASSUME-001）接受：直接更新 fixtures、清理测试数据，不写迁移。

### RISK-CORR-001 platform→surface 映射是承重单点
Status: mitigated
mobile/tablet→{android,ios}、web/desktop→单 surface 的映射错误会直接产出错误资产数量/套数。缓解＝单一映射函数为唯一真源，被 plan 全资产类型复用；单测覆盖四端 × {商店图,横幅,海报,图标} 的 surface/count 期望。

### RISK-CORR-002 UNCONFIRMED 分辨率值污染测试断言
Status: mitigated
若把未核实像素值写进断言，会把猜测固化成"通过"。缓解＝测试只断言结构（surface 套数、variant 齐全、count、aspect 方向），具体像素值在核实前不进断言（ASSUME-004 / RISK-DEP-002）。

### RISK-CORR-003 源需求中的尺寸笔误
Status: open
源痛点把 Android 前景安全区写成"66×66 像素"，而 D16 定为 666×666（1080² 的核心区，≈61.7%，符合 Android 66/108dp 安全区）——66×66 系笔误，以 D16 的 666² 为准。桌面端列出的"720 x 72"疑为笔误（应为 720×720 或 72×72）。缓解＝实现前就这两处与用户确认/按合理值定稿（见 OQ）；不把可疑值写死。

## Boundaries
- **契约/执行边界**：core 拥有确定性契约（分辨率表 / 设置 schema / `getBrandAssetPlan` / 图标 sharp 派生）；agent 仅按计划执行生成（数量/安全区/透明度为软约束）；web 仅展示。三者不互相越权。
- **凭证边界**：`media-config.yaml`（0600，env 覆盖，masked read）不经任何导出/日志/诊断/错误详情外泄；新工具不得打穿此边界（RISK-SEC-001）。
- **文件路径边界**：品牌资产读写/删除限定在 `data/products/<pid>/od-project/brand-assets/` 内（RISK-SEC-002）。
- **vzi 后端边界**：`@vzi-core/renderer` + canvaskit-wasm 不得进入 Node 后端运行时（`pnpm check:vzi-boundary`）；本变更不触碰 vzi，仅需保证不回退。
- **plan vs manifest 边界**：计划＝目标态、manifest＝现状态，解耦；画布/导出读现状，不依赖计划（RISK-DATA-002）。
- **写串行化边界**：所有 product 状态写（设置更新 / 保存 / 删除资产）经 `runProductMutation` per-product 文件锁。

## Scope Overflow Risks
- **OVERFLOW-001 Gemini 原生 renderer**：RISK-DEP-001 若成立，新增 `generateContent` renderer 会显著扩张范围。控制＝降级为目录登记不切默认 + 单列后续任务，不并入本批。
- **OVERFLOW-002 分辨率核实工作量**：跨 4 端 × 4 资产类型 × Android/iOS ≈ 20+ 个官方尺寸的逐项核实可能膨胀。控制＝核实是 PLAN 内显式独立步骤，产出一张带来源 URL 的表；先结构后数值，数值未定不阻塞契约骨架与测试。
- **OVERFLOW-003 渲染模板美术**：海报 3 样式 / 横幅安全区等"设计建议"易被误读为要重做渲染模板美术。控制＝SCOPE-OUT-005 明确仅扩尺寸/样式契约，不重做美术。
- **OVERFLOW-004 图标变体矩阵**：多平台 × 多变体易把"逐变体生图"重新引回。控制＝D16/D17 锁定"母图 + 本地派生"，禁止逐变体生图。

## Mitigations
- 实现前用 codegraph_impact + grep 扫清破坏式移除的全部引用（RISK-DATA-001），形成删除清单进 PLAN。
- 分辨率/模型 ID 经官方文档核实后入表 + provenance 注释；未核实值不进断言（RISK-DEP-002 / RISK-CORR-002 / ASSUME-004）。
- 图标派生首步做最小 sharp spike + 不依赖 stub 的单测，验证 tint/greyscale/圆角/alpha 后再铺开（RISK-DEP-003）。
- platform→surface 单一映射函数 + 四端全资产类型单测（RISK-CORR-001）。
- 新工具不读 media-config 并加无凭证外泄断言；delete 走路径边界校验 + 锁（RISK-SEC-001/002）。
- 两处可疑尺寸（66×66、720×72）实现前定稿（RISK-CORR-003，OQ-005/OQ-006）。
- 回滚：单分支、测试数据、零迁移；回滚＝`git revert` 分支；唯一运行时破坏性操作 `delete_brand_asset` 受路径边界 + 锁约束。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| RISK-SEC-001 | SCOPE-IN-007, 凭证边界 | mitigated |
| RISK-SEC-002 | SCOPE-IN-007 (delete_brand_asset) | mitigated |
| RISK-SEC-003 | SCOPE-IN-002/003 (大尺寸) | mitigated |
| RISK-DEP-001 | SCOPE-IN-001, ASSUME-005, OQ-004 | open |
| RISK-DEP-002 | SCOPE-IN-001, ASSUME-004, OQ-003 | open |
| RISK-DEP-003 | SCOPE-IN-005, ASSUME-002 | open |
| RISK-DATA-001 | SCOPE-IN-007, SCOPE-OUT-001 | mitigated |
| RISK-DATA-002 | SCOPE-IN-007 (D15), SCOPE-IN-009 | mitigated |
| RISK-DATA-003 | SCOPE-IN-006, ASSUME-001 | accepted |
| RISK-CORR-001 | SCOPE-IN-002/003/004/005 | mitigated |
| RISK-CORR-002 | AC-002, ASSUME-004 | mitigated |
| RISK-CORR-003 | SCOPE-IN-005 | open |
| OVERFLOW-001 | RISK-DEP-001 | controlled |
| OVERFLOW-002 | SCOPE-IN-002/003, OQ-003 | controlled |
| OVERFLOW-003 | SCOPE-OUT-005 | controlled |
| OVERFLOW-004 | SCOPE-IN-005 (D16/D17) | controlled |

## Upstream Summary (read-only)
# Requirement Brief

## Goal
治理 Forma 品牌资产生成子系统，使其产出符合各平台官方规范、数量可配、规格完整的资产。具体：扩充生图模型目录（OpenAI/Gemini 新模型）；为商店图/横幅/海报/应用图标建立按"产品平台所在端"驱动的确定性分辨率契约与生成计划；新增横幅资产类型；以"3 张 1080² 母图 + 本地 sharp 派生"产出应用图标的全部分层/主题变体；在后台管理产品页提供品牌资产设置入口；品牌资产画布按 surface（Android/iOS）分组展示。core 提供确定可测的契约（分辨率表 + 设置 + 资产计划），agent 照计划执行（数量/安全区/透明度为软约束）。无历史包袱：测试数据，破坏式清理，零迁移、零兼容 shim。

## In-Scope
- SCOPE-IN-001 生图模型目录扩充：OpenAI 增 `gpt-image-2` + `gpt-image-1.5`（provider 默认改 `gpt-image-1.5`）；Gemini 增 `gemini-3-pro-image` + `gemini-3.1-flash-image`（provider 默认改 `gemini-3.1-flash-image`）；含各模型 size 表与 Gemini renderer 可行性核实。(D1)
- SCOPE-IN-002 商店图治理：按平台所在端给官方推荐分辨率表；数量可配（下拉 3-8，默认 3，per-surface）；mobile/tablet 生成 Android+iOS 双套，画布显示"Android商店截图/iOS商店截图"，其余端"商店截图"。(D3, D5)
- SCOPE-IN-003 新增横幅（banner）资产类型：按平台所在端分辨率表；生成开关（勾选）；mobile/tablet 双套；新增 `banner` kind 与画布分组。(D4)
- SCOPE-IN-004 海报治理：3 固定样式（竖 1080×1920 / 横 1920×1080 / 方 1080×1080），平台无关，3 个独立生成开关。(D6)
- SCOPE-IN-005 应用图标治理：按平台产出多变体（Android 前景/背景/单色、iOS 深色/着色前景、standard）；产出方式为 mobile/tablet 生成 3 张 1080² 母图（a 透明 logo / b 不透明背景 / c 安全区 logo），web/desktop 生成 2 张（a/b），全部变体经 sharp composite/tint/greyscale/resize/圆角本地派生。(D16, D17)
- SCOPE-IN-006 数据模型：`BrandAssetRecord` 增 `surface?: "android"|"ios"` 与 `variant?: string`；product schema 增 `brand_assets` 设置块（store_shot_count、banner 开关、3 个 poster 开关）；`ProductService.updateBrandAssetSettings`。(D8, D9)
- SCOPE-IN-007 契约/MCP：`getBrandAssetPlan` / `get_brand_asset_plan` 取代 `listStoreShotPresets` / `list_store_shot_presets`（破坏式，无 shim）；`save_brand_asset(app-icon)` 改判别联合输入 `{logo_ref,bg_ref,safe_logo_ref?,colors?}`，core 派生整套记录原子替换并返回 `{assets:[...]}`；新增 `delete_brand_asset` 工具清理孤儿。(D10, D14, D15)
- SCOPE-IN-008 后台管理产品页"品牌资产设置"UI（store_shot_count 下拉 + banner/海报开关），en/zh 两个 locale 块文案。
- SCOPE-IN-009 品牌资产画布：按 kind 动态分组保持，新增 surface 子标签（Android/iOS）与 banner kind 展示；"may be stale" 徽标沿用。
- SCOPE-IN-010 agent 命令 + craft + CLAUDE.md 同步：三平台（claude/codex/gemini）`fm-app-icon`/`fm-brand-assets`/`fm-design` 模板更新并保持 parity；`craft/image-prompts.md` per-purpose scaffold；删除 `fm-rollback-design`（OQ-001）；明确 fm-* 纯命令重跑＝全量重生成＋确认（OQ-002, D12）；同步根 `CLAUDE.md` 相关行。

## Out-of-Scope
- SCOPE-OUT-001 现有测试数据/磁盘资产的迁移与向后兼容（无历史包袱，破坏式清理）。
- SCOPE-OUT-002 真实 provider 计费调用进 CI（仅 stub 测试；真实模型调用仅人工验收）。
- SCOPE-OUT-003 DesignView 的版本回滚能力（与 `fm-rollback-design` 命令删除无关，保留）。
- SCOPE-OUT-004 新增 provider（仅在既有 volcengine/openai/gemini 目录内扩模型）。
- SCOPE-OUT-005 海报/横幅的渲染模板美术再设计（沿用既有 HTML→PNG 渲染管线，仅扩尺寸/样式契约）。

## Non-Goals
- 不引入新的图像生成第三方依赖或新运行时（沿用 sharp + puppeteer）。
- 不把 base64 经 LLM 传图（沿用 `forma-image://` 引用管线）。
- 不为旧 `STORE_SHOT_PRESETS` / `name="primary"` 约定保留任何回退路径。

## Assumptions
- ASSUME-001 当前 `$FORMA_HOME` 下均为测试数据，可破坏式清理，无需迁移。[USER]
- ASSUME-002 图标的组合渲染、缩放、tint 可用本地 sharp 工具确定性完成（D16/D17），无需逐变体生图。[USER]
- ASSUME-003 web/desktop 系统不自动裁圆角，需本地为 standard 图标加圆角（按平台通用规范）。[USER]
- ASSUME-004 各平台官方推荐分辨率值在实现前必须经官方文档核实；文档中现列值标记 UNCONFIRMED 候选，未经核实不得进测试断言。[ASSUMPTION]
- ASSUME-005 Gemini 3 新模型沿用现有 OpenAI 兼容 `/images/generations` renderer 的可行性需在切默认前核实；若不兼容需原生 generateContent renderer。[CODE]
- ASSUME-006 三 agent 平台模板 parity 是硬约束（`template-parity.test.ts`）。[CODE]

## Acceptance Criteria
- AC-001 `IMAGE_MODELS`/`MODEL_SIZE_TABLES` 含 4 个新模型且 provider 默认指向新默认；`resolveSize` 对新模型不抛错；现有 image-models 测试更新通过。
- AC-002 `getBrandAssetPlan(product)` 按 platform→surface 映射返回商店图/横幅/海报/图标的目标尺寸 + surface + variant + count；mobile/tablet 商店图与横幅各含 android+ios 两套；海报受 3 开关控制；单测覆盖四端 × 各资产类型。
- AC-003 `get_brand_asset_plan` MCP 工具返回 AC-002 计划；`list_store_shot_presets`/`listStoreShotPresets` 已删除且无引用残留。
- AC-004 `save_brand_asset(app-icon)` 接受 `{logo_ref,bg_ref,safe_logo_ref?,colors?}`，core 经 sharp 派生 Android（前景/背景/单色/standard）/iOS（standard 多档/深色/着色前景）或 web/desktop（圆角 standard 多档）全套记录、原子替换并返回 `{assets:[...]}`；派生路径单测不依赖 stub。
- AC-005 `delete_brand_asset` 可删除指定资产记录与磁盘文件；降低 store_shot_count 后孤儿可清理。
- AC-006 product schema `brand_assets` 设置块（store_shot_count∈[3,8] 默认 3、banner 开关、3 poster 开关）通过 zod 校验；`updateBrandAssetSettings` 经 `runProductMutation` 串行化写入。
- AC-007 `BrandAssetRecord` 含可选 `surface`/`variant`；新增 `banner` ∈ `BRAND_ASSET_KINDS`。
- AC-008 后台管理产品页可设置上述选项，en/zh 文案齐全；保存后计划随之变化。
- AC-009 品牌资产画布对 mobile/tablet 显示 Android/iOS 子分组标签、显示 banner 分组；其余端单组；现有 BrandAssets 测试更新通过。
- AC-010 三平台 agent 模板更新且 `template-parity.test.ts` 通过；`fm-rollback-design` 三平台模板删除；fm-* 纯命令重跑＝全量重生成＋二次确认在模板中明确。
- AC-011 根 `CLAUDE.md` 同步（banners kind、计划工具名、MCP 工具集、画布分组、移除 name="primary" 描述）。
- AC-012 `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿；`pnpm check:vzi-boundary` 不回退。

## Open Questions
- OQ-001 `fm-rollback-design` 是否删除？— 已决：删除（源已移除，仅旧安装残留模板需清理；DesignView 回滚另存，保留）。(开放问题 1)
- OQ-002 fm-* 纯命令（无描述）重跑行为？— 已决：全量重生成对应资产 + 执行前二次确认。(D12, 开放问题 2)
- OQ-003 各平台官方分辨率值终值 — 待实现期逐项核实官方文档后定稿（ASSUME-004）；当前为 UNCONFIRMED 候选。
- OQ-004 Gemini 3 新模型 renderer 兼容性 — 待切默认前核实（ASSUME-005）。

## Sources
- `docs/brand-assets-optimization-requirements.md`（本需求源文档 v1.1，commit 989624c；D1–D17 + 附录 A/B）
- `docs/image-generation-requirements.md`（生图能力 v1 上游）
- 代码锚点：`packages/core/src/media/image-models.ts`、`image-generate.ts`、`brand-assets.ts`、`brand-asset-render.ts`、`product.ts`、`schemas.ts`；`packages/web/src/pages/BrandAssets.tsx`、`ProductDetail.tsx`、`i18n.ts`；`packages/agent/templates/{claude,codex,gemini}/`；根 `CLAUDE.md`

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| SCOPE-IN-001 | D1 | active |
| SCOPE-IN-002 | D3, D5 | active |
| SCOPE-IN-003 | D4 | active |
| SCOPE-IN-004 | D6 | active |
| SCOPE-IN-005 | D7, D16, D17 | active |
| SCOPE-IN-006 | D8, D9 | active |
| SCOPE-IN-007 | D10, D13, D14, D15 | active |
| SCOPE-IN-008 | D9 | active |
| SCOPE-IN-009 | D11 | active |
| SCOPE-IN-010 | D12, 开放问题 1/2 | active |
| SCOPE-OUT-001 | 无历史包袱原则 | active |
| AC-001 | D1 | active |
| AC-002 | D3, D4, D5, D6 | active |
| AC-003 | D10 | active |
| AC-004 | D14, D16, D17 | active |
| AC-005 | D15 | active |
| AC-006 | D9 | active |
| AC-007 | D8 | active |
| AC-009 | D11 | active |
| AC-010 | D12, 开放问题 1/2 | active |
| OQ-001 | 开放问题 1 | resolved |
| OQ-002 | 开放问题 2, D12 | resolved |
| OQ-003 | 附录 A | open |
| OQ-004 | 附录 A | open |

## Upstream Summary (read-only)
# Forma 品牌资产生成治理需求设计文档

- 日期：2026-06-14（v1，待审查）
- 分支：`feat/brand-assets-optimization`
- 来源：品牌资产能力上线后的问题优化立项（生图模型偏少 → 商店图/海报无分辨率标准、数量太少 → 缺横幅 → 应用图标规格冗杂单一 → 两项开放性问题）
- 状态：方案已决策完备，待用户审查后实施
- 上游文档：`docs/image-generation-requirements.md`（生图能力 v1，本文是其落地后的治理迭代）
- 原则：**无历史包袱**——当前均为测试数据，允许破坏式清理，零迁移、不留兼容 shim、不写"旧记录回退"分支；core 提供确定可测的契约（分辨率表 + 设置 + 资产计划），agent 照计划执行生成（数量/安全区/透明度为 agent 软约束）；分辨率值必须经平台官方文档核实并记录来源；单分支一次性交付。

## 1. 背景与痛点

Forma 在 `docs/image-generation-requirements.md`（生图能力 v1）中已建成完整的媒体子系统：`packages/core/src/media/`（provider 目录 / 凭证 / 调度 / 暂存）+ `brand-assets.ts`（应用图标 sharp 派生、商店图/海报 HTML→PNG 渲染、zip 导出、预设表）+ `brand-asset-render.ts`（puppeteer 沙箱）+ 品牌资产画布。`fm-app-icon` / `fm-brand-assets` 已可经 MCP 生成并持久化资产。

但上线后暴露出五类问题：

1. **生图模型太少**：OpenAI 仅 `gpt-image-1`，Gemini 仅 `gemini-2.5-flash-image`。两家各自已发布更强/更快的新模型（见 §6.1 核实记录），目录未跟进。
2. **商店图无分辨率标准、数量太少**：`STORE_SHOT_PRESETS` 仅 3 档（`ios-6.9` / `android-phone` / `web-og`），且 tablet/desktop 退化映射到 web OG，未按"产品平台所在端"给出官方推荐分辨率；数量不可配。
3. **缺横幅图**：完全没有 banner 资产类型（Google Play 顶部、网页首屏大图等场景无供给）。
4. **海报无分辨率标准、数量太少**：海报固定单一 `1080×1920` 竖版（`fm-brand-assets.md:25`），无横屏/方形样式，无生成开关。
5. **应用图标规格冗杂、数量过多、规格单一**：当前 Android 派生 `512/192/144/96/72/48` 六档、iOS `1024/180/120` 三档，尺寸冗余；且只能从"单张方图母版"缩放派生，无法产出平台真正需要的**分层图标**（Android 前景层/背景层/单色）与**主题图标**（iOS 深色/着色前景）。

另有两项开放性问题（立项输入）：

- **fm-rollback-design**：用户在已安装命令里仍能看到它，疑似应删除。
- **fm-* 命令纯命令重跑行为**：`fm-design` / `fm-brand-assets` / `fm-refine-components` / `fm-app-icon` 无描述重跑时是全量重生成还是别的，需确认。

## 2. 决策记录（全部已用户拍板）

| # | 决策 | 取代/否决的方案 |
|---|---|---|
| D1 | 生图模型目录扩充：OpenAI 加 `gpt-image-2` + `gpt-image-1.5`（provider 内默认改 `gpt-image-1.5`）；Gemini 加 `gemini-3-pro-image` + `gemini-3.1-flash-image`（provider 内默认改 `gemini-3.1-flash-image`）；全局仍 volcengine 优先。默认选择是用户决策；速度/成本/发布日期等外部事实以附录 A 的核实状态为准。 | 默认改成最贵的旗舰（默认偏向中档/flash，旗舰留给质量场景） |
| D2 | 资源治理范式：**core 给契约（分辨率表 + 设置 + 派生的资产计划），agent 照计划执行**；数量/安全区/透明度是 agent 软约束 | core 接管生成调度做硬保证（成本数倍，与现架构冲突） |
| D3 | 新增 `banner` kind；商店图 / 横幅 / 海报 / 应用图标四类全部做分辨率治理 | 只治理商店图 |
| D4 | 商店图数量可配（下拉 3–8，默认 3），**按 surface 计**：设 3 张 → Android 3 + iOS 3 | 全产品共 N 张 |
| D5 | 横幅一个开关（默认关）；海报三样式独立开关（竖屏默认开、横屏/方形默认关） | 海报固定全开/全关 |
| D6 | 按 `product.platform` 分端：mobile / tablet → Android + iOS **双 surface**；web / desktop → **单 surface** | 不分端（产品仅单 `platform` 字段，分端语义清晰） |
| D7 | 应用图标**全量多版本**（产出物）：standard + Android(foreground/background/monochrome) + iOS(dark/tinted)，各变体齐全、各自尺寸集；**产出方式见 D16/D17**（基图 + 本地派生，非每变体生图） | 仅尺寸规范化保持单母版（无法产出分层/单色/深色，不达需求） |
| D8 | 单一事实源 `getBrandAssetPlan` / MCP `get_brand_asset_plan` **取代** `listStoreShotPresets` / `list_store_shot_presets`，无弃用 shim | 保留预设工具并叠加新工具（双事实源） |
| D9 | 设置持久化到 `product.yaml` 的 `brand_assets` 块；后台新增**始终可编辑**的独立面板；专用 `PUT /api/products/:id/brand-asset-settings`；**不开放 MCP 写**（沿用"产品设置仅后台"规则） | 复用 configureProduct（强制四件套齐全，无法单改设置）；开 MCP 写（违反后台唯一原则） |
| D10 | **无历史包袱**：删 `name="primary"` 约定与 resolver 回退、删整套预设体系、`surface`/`variant` 按真实语义建模、相关测试直接重写、零迁移、不写旧记录兼容分支 | 保留兼容/迁移（当前是测试数据，无须背包袱） |
| D11 | `fm-rollback-design`：源码模板已删除，仅需清理旧安装残留；**保留** 网页端 DesignView 的 artifact 版本回滚（另一套独立功能） | 连版本回滚一起删（会丢失有用能力） |
| D12 | `fm-*` 无描述重跑维持**全量重生成**语义，重跑前增加明确确认；对 `fm-brand-assets`，确认必须同时列出"将删除 Y、将重新生成/覆盖 X"，且确认后才执行删除 | 改为勾选式增量（改 5 个模板交互，收益不足） |
| D13 | **不新增 IMAGE_PURPOSE**：横幅背景复用 `hero`；图标各层复用 `app-icon`，透明/单色/深色靠 prompt 控制 | 为 banner/各图标层新增 purpose（核心 churn 大） |
| D14 | 画布按 `kind → surface → variant` 分组展示："Android 商店截图 / iOS 商店截图 / 商店截图"等 | 仅按 kind 分组（无法区分 Android/iOS） |
| D15 | **孤儿记录清理**（已采纳）：新增最小 `delete_brand_asset(product_id, kind, name)` MCP 工具；fm-brand-assets 重跑时按计划清理"超出当前数量/已关闭样式"的旧 store-shot/banner/poster 记录（如 count 由 5 降 3，确认后删 `*-4`/`*-5`） | 静默残留孤儿（manifest 与磁盘越积越多，画布显示已废弃资产）——当前**无任何删除路径**，save 仅按名覆盖 |
| D16 | **图标产出方式（用户优化，已采纳）**：mobile/tablet 下 AI 只生成 **3 张方形基图**——`a` 透明背景 LOGO、`b` 纯色/渐变背景、`c` LOGO 缩于约 61.7% 安全区+透明背景；core 将 provider 返回方图归一化到 1080×1080 工作画布，其余变体全部由 sharp **合成 / tint / 缩放派生**，零额外生图（映射见 §6.5）。web/desktop 由 D17 细化为只生成 a/b 两张。一次 `save_brand_asset(app-icon)` 传基图 + 颜色，core 产出该平台整套变体记录并**整组替换**（图标天然无孤儿，不依赖 D15） | 每版本独立生图（mobile ~21 张生成+逐张视检，慢/贵/各版本不一致） |
| D17 | **Web/桌面图标（用户细化，已采纳）**：web/desktop 无系统遮罩，只产**一张 standard**（`composite(a over b)`），core 按平台通用规范**加圆角**（desktop ≈ macOS ~22% 超椭圆、web ≈ 中等圆角，常量化、可调），再缩放出尺寸集；这两端**不生成 `c`**（无自适应前景），只需 a/b 两张基图。mobile/tablet 的 standard 保持**方形不加圆角**（iOS 超椭圆 / Android 遮罩由系统自动施加，预切角会双重圆角） | web/desktop 也方形不切角（成品在桌面/标签页显示为直角，不符通用观感） |

## 3. 范围

单分支 `feat/brand-assets-optimization` 一次性交付，约 **30+ 个文件**，按十个改造项组织（§6）：

- 6.1 生图模型目录扩充（core + 测试，~2 文件）
- 6.2 数据模型与存储：`surface`/`variant` 字段、`banner` kind、`brand_assets` 设置块
- 6.3 资产计划：`getBrandAssetPlan` / `get_brand_asset_plan`（取代预设体系）
- 6.4 四类资产分辨率标准（core 内表）
- 6.5 应用图标多版本重构
- 6.6 后台「品牌资产设置」入口
- 6.7 品牌资产画布分组
- 6.8 agent 命令改造（fm-app-icon / fm-brand-assets / fm-design ×3 平台 = 9 文件）
- 6.9 craft 提示词脚手架扩展（+ `craft.test.ts` / `template-parity.test.ts`）
- 6.10 文档同步：`CLAUDE.md` 媒体子系统章节

涉及 5 个子系统（core / mcp / server / web / agent）+ 文档。**无新服务、无运行时新 npm 依赖**（sharp / puppeteer / zip 能力已有）；新增 MCP 工具 `delete_brand_asset`（D15）；破坏性变更是删除 `list_store_shot_presets`（重装 agent 命令即生效）。

## 4. 非范围（明确不做）

| 项 | 不做的理由 |
|---|---|
| core 接管生成调度做数量/质量硬保证 | 见 D2，维持 agent 驱动软约束 |
| 移除 DesignView 版本回滚 | 见 D11，仅清 `fm-rollback-design` 旧安装残留 |
| fm-* 重跑改勾选式增量 | 见 D12，仅加删除/覆盖确认 |
| 新增 IMAGE_PURPOSE | 见 D13，复用 hero / app-icon |
| 资产/设置的历史版本与回滚 | 覆盖式更新，无版本树；如需另立需求 |
| 桌面图标非标尺寸（`720×72`、`358×358`） | 明显笔误/非标，按标准 .ico/.icns 集落地 |
| 旧数据迁移 / 兼容 shim | 见 D10，当前为测试数据 |
| i2i 图片编辑、视频/音频 | 延续 v1 非范围 |

## 5. 总体架构

```
            后台 产品详情「品牌资产设置」面板（始终可编辑）
              │ PUT /api/products/:id/brand-asset-settings
              ▼
   ProductService → product.yaml
     { platform, brand_assets: { store_shot_count, banner_enabled,
                                 poster_portrait, poster_landscape, poster_square } }
              │
              ▼   getBrandAssetPlan(product)            ◄── 单一事实源（core/brand-assets.ts）
   MCP: get_brand_asset_plan(product_id)                    （取代 list_store_shot_presets）
              │  {
              │    app_icon : { base_images:["a","b"("c")], variants:[{ surface?, variant, sizes[], alpha }] },
              │    store_shots: [ { surface?, width, height, count } ],
              │    banners  : [ { surface?, width, height } ],     // [] 当关闭
              │    posters  : [ { variant(style), width, height } ] // 仅开启样式
              │  }
              ▼
   agent (fm-app-icon / fm-brand-assets) 照计划循环
     │  generate_image(staging) → Read 视检 → save_brand_asset(kind, surface?, variant?, …)
     ▼
   brand-assets.ts → manifest.json(+surface/variant) + 文件
     │   app-icon: 按 (platform, surface, variant) 派生尺寸集，foreground/monochrome/tinted 保 alpha
     │   store-shot/banner/poster: puppeteer 按精确像素渲染 PNG
     │
     ├─► server toBrandAssetView → Web 画布（kind → surface → variant 分组）
     └─► forma-image://brand/app-icon → resolveBrandImageRef(standard 变体最大主图)
                                       → fm-design / 渲染沙箱
```

无环，单向 DAG。

### 5.1 平台 → surface 映射（核心约定）

产品是**单一 `platform` 字段**（`mobile` / `tablet` / `web` / `desktop`，见 `packages/core/src/schemas.ts:4`）。"按平台所在端生成"映射为：

| platform | surface 集 | 画布分组标签 |
|---|---|---|
| `mobile` | `android` + `ios` | Android XXX / iOS XXX |
| `tablet` | `android` + `ios` | Android XXX / iOS XXX |
| `web` | 单（无 surface） | XXX |
| `desktop` | 单（无 surface） | XXX |

### 5.2 `surface` / `variant` 数据模型

`BrandAssetRecord` 描述持久化 manifest 记录；`SaveBrandAssetInput` 是调用输入，二者字段约束不完全相同。manifest 记录新增两个字段（按真实语义建模，**非为兼容保留**）：

- `surface?: "android" | "ios"`——仅 mobile/tablet 存在；驱动画布分组。
- `variant?: string`——kind 内子类型：
  - app-icon：层（`standard` / `foreground` / `background` / `monochrome` / `dark` / `tinted`），派生后的 manifest 记录中**必填**；`save_brand_asset(app-icon)` 输入禁止调用方传 `name` / `surface` / `variant`。
  - poster：样式（`portrait` / `landscape` / `square`），**必填**。
  - store-shot / banner：无 `variant`（同 surface 下多张靠 `name` 区分）。

记录身份键仍为 `(kind, name)`（覆盖语义不变）；除 app-icon 由 core 按计划派生命名外，其他 kind 的 `name` 必须由 agent 确定性命名并避免 surface 冲突：

- app-icon：调用方不传 `name`；core 按计划派生 `android-standard` / `android-foreground` / `ios-standard` / `standard` 等记录名（web/desktop 无 surface 时用 `standard`）。
- store-shot：mobile/tablet 用 `android-1`…`android-N`、`ios-1`…`ios-N`；web/desktop 用 `shot-1`…`shot-N`。
- banner：mobile/tablet 用 `android` / `ios`；web/desktop 用 `primary`。
- poster：用 `portrait` / `landscape` / `square`。

### 5.3 `forma-image://brand/app-icon` 解析变更

删除 `name === "primary"` → 最近记录的回退链。改为：**解析 `variant === "standard"` 的记录，取其最大主图**（mobile 同时有 android/ios standard 时取像素更大者）。`@<size>` 形态仍取 standard 集中匹配宽度的派生图。`fm-design` 现有 `forma-image://brand/app-icon` 引用不破。

### 5.4 存储布局（变更部分）

```
$FORMA_HOME/data/products/<productId>/od-project/brand-assets/
├── manifest.json            # 记录新增 surface? / variant?
├── app-icon/                # 按 (surface,variant) 多版本：
│   ├── android-standard/    # icon-512.png …
│   ├── android-foreground/  # icon-1080.png（alpha）
│   ├── android-background/  # icon-1080.png
│   ├── android-monochrome/  # icon-1080.png（alpha）
│   ├── ios-standard/        # icon-1024.png / icon-180.png / icon-120.png
│   ├── ios-dark/            # icon-1024.png
│   └── ios-tinted/          # icon-1024.png（alpha）
├── store-shots/             # android-1 … ios-3（按 surface×count）
├── banners/                 # 新增 kind
└── posters/                 # portrait / landscape / square
```

### 5.5 错误码

复用既有 `BRAND_ASSET_INVALID_INPUT`（含未知 kind、source 配对错误、非法尺寸、非法 surface/variant）、`MEDIA_*`、`PRODUCT_CONFIG_INCOMPLETE`。**不新增错误码**；`banner` 复用 store-shot 的渲染与校验路径。

## 6. 分改造项详细设计

### 6.1 生图模型目录扩充（D1）

`packages/core/src/media/image-models.ts` 的 `IMAGE_MODELS` 与 `MODEL_SIZE_TABLES` 新增四个模型；`image-models.test.ts` 同步 provenance 与尺寸断言。

| Provider | 新增 Model ID | provider 内默认 | 说明 |
|---|---|---|---|
| openai | `gpt-image-2` | | 旗舰图像生成/编辑；官方页已确认模型 ID 与 Image generation / Image edit 端点，发布日期/snapshot/推理能力细节待实现期复核 |
| openai | `gpt-image-1.5` | ✅（由 `gpt-image-1` 改此） | 官方页已确认模型 ID、尺寸/价格档；"比 1 快 ~4×、便宜 ~20%"、发布日期、架构归属均标记为 **UNCONFIRMED**，落地前不得写入 provenance/test 断言 |
| gemini | `gemini-3-pro-image` | | Nano Banana Pro；官方页已确认 stable model ID、Image generation、Search grounding，2K/4K 具体档位待实现期复核 |
| gemini | `gemini-3.1-flash-image` | ✅（由 `gemini-2.5-flash-image` 改此） | 官方 image-generation 文档示例已确认 model ID 与 `image_size: "2K"`；"Nano Banana 2"、GA 日期、速度/吞吐表述均标记为 **UNCONFIRMED** |

保留既有 `gpt-image-1` / `gemini-2.5-flash-image`（不删，仅把 `default: true` 从旧模型移到新模型——每 provider 仅一个默认）。**全局 provider 顺序仍 volcengine 优先**，Seedream 默认不变。

尺寸表（`SizeTable`，落地前逐一对官方文档核实并补 provenance 注释，候选值）：

- `gpt-image-1.5`：复用 `GPT_IMAGE_1_SIZES`（官方最大 `1536×1024` / `1024×1536`，与 1 同档）。
- `gpt-image-2`：核实后填；若同档则复用 1 的表。
- `gemini-3-pro-image`：2K 档表（参考 Seedream 2K 档：`2048²` / `2848×1600` 等），按官方支持档核定。
- `gemini-3.1-flash-image`：核实后填（flash，1K–2K 档）。

> Gemini 的 `-preview` 变体弃用日期当前 **UNCONFIRMED**；目录策略仍是只收 stable / GA id，不收 preview id。
>
> Gemini 默认切换的实现前置：当前 `generate_image` 的 Gemini renderer 走 OpenAI-compatible `POST /images/generations`。落地时必须先核实并记录 `gemini-3.1-flash-image` / `gemini-3-pro-image` 是否支持 Gemini OpenAI-compatible `/v1beta/openai/images/generations` 路径、请求字段与返回字段；若不支持，必须新增 Gemini native `generateContent` + `imageConfig` renderer（含返回图像解析、尺寸读取、错误映射、stub/单测），然后才能把 Gemini provider 默认切到新模型。

### 6.2 数据模型与存储

`packages/core/src/brand-assets.ts`：

1. `BRAND_ASSET_KINDS = ["app-icon", "store-shot", "banner", "poster"]`；`KIND_SUBDIR` 加 `banner: "banners"`；`brandManifestSchema` 的 kind 枚举随之扩展。
2. `BrandAssetRecord` 加 `surface?: "android" | "ios"`、`variant?: string`（§5.2）；`SaveBrandAssetInput` 改为 discriminated union：
   - 非 app-icon：`{ kind, name, source:{ html }, target:{ width,height }, surface?, variant? }`，其中 poster 输入 `variant` 必填，store-shot/banner 禁止 `variant`。
   - app-icon：`{ kind:"app-icon", source:{ logo_ref, bg_ref, safe_logo_ref? }, colors? }`，输入禁止 `name` / `surface` / `variant` / `target`，由 core 按 plan 派生 manifest records。
3. `assertValidSource`：`app-icon` 使用独立 source 分支 `{ logo_ref, bg_ref, safe_logo_ref? }` + `colors?`（不接受旧单 `image_ref`）；`store-shot` / `banner` / `poster` 用 `html`。
4. 新增 per-kind 的 `surface`/`variant` 校验：app-icon 输入禁止传 `name` / `surface` / `variant`，由 core 派生记录后再校验派生 manifest 的 app-icon `variant` 必填且合法；poster 输入 `variant` 必填且合法；store-shot/banner 不接受 `variant`。
5. 删除整套预设：`STORE_SHOT_PRESETS` / `PLATFORM_PRESET_MAP` / `StoreShotPreset` / `listStoreShotPresets`；`SaveBrandAssetInput.target` 去掉 `{ preset }` 形态，只留 `{ width, height }`；`resolveRenderTarget` 随之简化。

`packages/core/src/product.ts`：`productSchema` 扩展（`brand_assets` 设置块，见 6.6）；`ProductService` 新增 `updateBrandAssetSettings`。

### 6.3 资产计划（D8，单一事实源）

`brand-assets.ts` 新增 `getBrandAssetPlan(product): BrandAssetPlan`，读 `product.platform` + `product.brand_assets`（缺省时套默认值），按 §5.1 / §6.4 派生完整待生成清单（结构见 §5 架构图）。

`packages/mcp/src/tools.ts`：

- 删 `list_store_shot_presets` 工具与 schema（含 `tools.ts` 内 `listStoreShotPresetsSchema`、handler `listStoreShotPresets`、`verifiedAt→verified_at` wire 映射，全部移除）。
- 加 `get_brand_asset_plan(product_id) → BrandAssetPlan`（platform + 设置从产品配置读取）。
- 加 `delete_brand_asset(product_id, kind, name)`（D15）——删 manifest 记录 + 对应磁盘目录，走 product 锁；供 fm-brand-assets 清理孤儿。
- `save_brand_asset` schema 加 `banner` kind、`surface?`、`variant?`；`target` 去掉 `{ preset }`；**app-icon 走专用输入分支，`source` 由单 `image_ref` 改为 `{ logo_ref, bg_ref, safe_logo_ref? }` + 可选 `colors`，其中 `safe_logo_ref` 仅 mobile/tablet 必填、web/desktop 必须省略；app-icon 调用不传 `name`，core 按 §5.2 派生并整组替换记录；一次调用产出整套变体并返回 `{ assets: [...] }`，非 app-icon 仍返回单资产结果**。
- 工具描述同步。

`packages/core/src/store.ts`：以 `getBrandAssetPlan` 绑定取代 `listStoreShotPresets`；接 `updateBrandAssetSettings`；`saveBrandAsset` 透传 surface/variant。

### 6.4 四类资产分辨率标准（候选值；core 内表落地时附 provenance）

下列表格是实现输入的**候选值（UNCONFIRMED）**，不得直接作为已核实标准写入 core 常量。落地第一步必须逐项对平台官方文档核实并记录 `source` + `verifiedAt`（沿用 `STORE_SHOT_PRESETS` 既有 provenance 纪律）；若官方值与候选值不一致，以官方值为准并同步更新本文、常量和测试。

**store-shot**（按 `platform × surface`）：

| platform | surface | 候选尺寸（UNCONFIRMED） |
|---|---|---|
| mobile | android | 1080×1920 |
| mobile | ios | 1320×2868 |
| tablet | android | 2560×1600 |
| tablet | ios | 2752×2064 |
| web | — | 1920×1080 |
| desktop | — | 1920×1080 |

**banner**（新 kind，按 `platform × surface`）：

| platform | surface | 候选尺寸（UNCONFIRMED） |
|---|---|---|
| mobile | android | 1024×500 |
| mobile | ios | 4320×2160 |
| tablet | android | 1024×500 |
| tablet | ios | 2752×2064 |
| web | — | 1920×450 |
| desktop | — | 1920×1080 |

**poster**（固定 3 样式，不分平台，按开关取舍）：

| variant | 候选尺寸（UNCONFIRMED） |
|---|---|
| portrait | 1080×1920 |
| landscape | 1920×1080 |
| square | 1080×1080 |

**app-icon**（`APP_ICON_SPECS`，按 `platform → surface? → variant`，标注 alpha）：

| platform | surface | variant | 候选尺寸集（UNCONFIRMED） | alpha |
|---|---|---|---|---|
| mobile/tablet | android | standard | 512 | 否 |
| mobile/tablet | android | foreground | 1080 | **是** |
| mobile/tablet | android | background | 1080 | 否 |
| mobile/tablet | android | monochrome | 1080 | **是** |
| mobile | ios | standard | 1024 / 180 / 120 | 否 |
| tablet | ios | standard | 1024 / 167 / 152 | 否 |
| mobile/tablet | ios | dark | 1024 | 否 |
| mobile/tablet | ios | tinted | 1024 | **是** |
| web | — | standard | 512 / 48 / 32 | 否 |
| desktop | — | standard | 1024 / 512 / 256 / 128 / 64 / 32 / 16 | 否 |

> 本表是预期**最终输出规格候选**；实现期完成官方核实后，core 常量与测试以带 provenance 的核实值为准。产出方式见 §6.5（mobile/tablet 3 张基图、web/desktop 2 张基图 + sharp 派生，非每变体生图）。web/desktop 的 standard **加平台圆角**（D17），mobile/tablet 方形不加圆角（系统遮罩）。
>
> 笔误修正：Android 前景安全区"66×66"应按 108dp 画布的 66dp 安全区等比表达为约 61.7%（1080 工作画布上约 666px，即基图 c 的安全区）——写入 craft 脚手架而非 core；iOS "024×1024" 取 1024×1024；桌面 "720×72" / "358×358" 为笔误/非标，按标准 .ico/.icns 集落地（已剔除）。

### 6.5 应用图标多版本重构（D7 + D16）

产出方式：mobile/tablet 由 AI 生成 **3 张方形基图**，web/desktop 生成 **2 张方形基图**；provider 返回图像先由 core 统一归一化到 **1080×1080** 工作画布，再由 sharp **合成 / tint / 缩放**派生其余变体（零额外生图，确定性、无网络）。本需求不扩展 `generate_image` 的像素级 `size` 参数，agent 只通过 `purpose="app-icon"` / `aspect="1:1"` / `count` 生成候选。

**基图**（`generate_image(purpose="app-icon")`，各 count=3 候选 → Read 视检选优）。需要哪几张由平台决定（plan 下发）：

- **a** = 透明背景 LOGO 图（alpha；主体占比 ~60–80%）— 全平台
- **b** = 纯色/渐变/图案背景图（不透明，品牌色）— 全平台
- **c** = LOGO 缩于中央约 **61.7%** 安全区（1080 工作画布上约 666px）+ 透明背景（alpha；供 Android 自适应前景与 iOS 着色，留遮罩/缩放余量）— **仅 mobile/tablet**

即 mobile/tablet 生成 a/b/c 三张；**web/desktop 只生成 a/b 两张**（D17，无自适应前景）。

**core 派生映射**（`icon-derive.ts`，纯 sharp）：

| 输出变体 | 配方 | 适用平台 |
|---|---|---|
| standard（mobile/tablet，**方形不加圆角**，系统遮罩） | `composite(a over b)` → 缩放（含 surface 各尺寸） | mobile / tablet |
| standard（web/desktop，**加平台圆角**） | `composite(a over b)` → 圆角遮罩 → 缩放 | web / desktop |
| Android 前景层 | `c` → 1080 | mobile / tablet |
| Android 背景层 | `b` → 1080 | mobile / tablet |
| Android 单色 | `a` 的 alpha 掩膜填纯色（ink/黑）→ 1080 | mobile / tablet |
| iOS 深色 | `composite(tint(a) over 近黑背景)` → 1024 | mobile / tablet |
| iOS 着色前景 | `c` 去色为灰度/单色 → 1024 | mobile / tablet |

sharp 操作均为成熟原语：合成 `sharp(b).composite([{ input: a }])`；缩放 `.resize()`；单色 = 取 alpha 通道作掩膜 + 纯色画布 `composite(blend: "dest-in")`；去色 `.greyscale()`/`.modulate()`；**圆角 = 圆角矩形/超椭圆 SVG 作掩膜 `composite(blend: "dest-in")`**（web/desktop 专用，半径按平台规范常量化：desktop ≈ macOS ~22% 超椭圆、web ≈ 中等圆角）。tint/单色/深背景颜色取自 brand tokens，可由 agent 参数化传入（默认：Android 单色=ink/黑、iOS 深色背景=近黑、iOS 着色=灰度）。**圆角只施于 web/desktop standard，mobile/tablet 一律方形**（系统自带遮罩，预切角会双重圆角）。

**接口变化**：`save_brand_asset(kind="app-icon")` 的 `source` 由单 `image_ref` 改为 `{ logo_ref, bg_ref, safe_logo_ref? }` + 可选 `colors`；`safe_logo_ref` 仅当 `getBrandAssetPlan(...).app_icon.base_images` 包含 `c`（mobile/tablet）时必填，web/desktop 只传 a/b 且不得要求 `safe_logo_ref`。app-icon 调用方**不传 `name` / `surface` / `variant` / `target`**；core 根据产品平台、计划与 §5.2 命名规则派生每条 manifest record 的 `name`、`surface`、`variant`。**一次调用产出该平台整套变体记录**（每 surface×variant 一条 manifest 记录，各带其尺寸文件），并**整组替换**既有 app-icon 记录（图标天然无孤儿，不依赖 D15）；返回 `{ assets: [...] }`。非 app-icon 保存仍是单记录写入并返回单资产结果。`resolveBrandImageRef` 按 §5.3 取 standard。

core 新增 `packages/core/src/icon-derive.ts`（合成 / alpha 掩膜填色 / 去色 / 缩放，纯 sharp、确定性、零网络——**单测无需 stub**，是强测试点）。

`packages/core/src/brand-assets.ts` 内 `APP_ICON_SIZES` / `planAppIconSizes` 被 `APP_ICON_SPECS` + per-variant 派生取代。

### 6.6 后台「品牌资产设置」入口（D9）

`product.yaml` 的 `brand_assets` 块（`productSchema` 扩展，strict）：

```yaml
brand_assets:
  store_shot_count: 3        # int 3..8，默认 3
  banner_enabled: false      # 默认 false
  poster_portrait: true      # 默认 true
  poster_landscape: false    # 默认 false
  poster_square: false       # 默认 false
```

- `packages/server/src/routes.ts`：新增 `PUT /api/products/:id/brand-asset-settings` → `store.updateBrandAssetSettings`（部分更新，仅写 `brand_assets`，走 product 锁）。
- `packages/web/src/pages/ProductDetail.tsx`：新增**始终可编辑**的「品牌资产设置」`WorkSurface`（区别于配置后即隐藏的一次性配置表单）：商店图数量下拉（3–8）、横幅开关、三个海报开关；保存调 `updateBrandAssetSettings`。
- `packages/web/src/api.ts`：`Product` 加 `brand_assets`；新增 client `updateBrandAssetSettings`。
- **不开放 MCP 写**——agent 只经 `get_brand_asset_plan` 读取，沿用"产品设置仅后台"原则。

### 6.7 品牌资产画布分组（D14）

`packages/web/src/pages/BrandAssets.tsx`：分组从"仅按 kind"扩展为 **kind → surface → variant**：

- `BrandAssetView`（api.ts）加 `surface?` / `variant?`；server `toBrandAssetView` 带出。
- 同 kind 内若有 surface，再按 surface 分子组并显示"Android XXX / iOS XXX"；无 surface 显示"XXX"。
- 新增 `banner` kind 标签；app-icon 子组内以 variant 作 chip。
- `packages/web/src/i18n.ts`：`en` / `zh` 两个 locale 块（实测仅此二者）各新增键（`brandAssets.kind.banner`、surface 标签、海报样式标签、设置面板文案）。

### 6.8 agent 命令改造（D7/D12）

每个命令改 **claude `.md` + codex `SKILL.md` + gemini `.toml`** 三套。

**fm-brand-assets**（×3）：

- 前置：调 `get_brand_asset_plan(product_id)` 拿计划（取代 `list_store_shot_presets`）。
- 重跑清理：读取现有品牌资产，与计划派生的 store-shot / banner / poster 目标 `(kind,name)` 集合比对，形成计划外记录删除清单；必须先在重跑确认中列出这些将删除项，用户确认后才允许对计划外记录调用 `delete_brand_asset(product_id, kind, name)`，例如 count 由 5 降 3 时删除 `android-4` / `android-5` / `ios-4` / `ios-5`，关闭横幅或海报样式时删除对应 banner/poster 记录。未确认不得执行删除。
- 商店图：对每个 `store_shots` 条目（android/ios 或单），按 `count` 循环生图 + 排版 HTML + `save_brand_asset(kind="store-shot", surface?, name, target={width,height})`；命名按 §5.2 固定为 `android-<n>` / `ios-<n>` 或 web/desktop 的 `shot-<n>`。
- 横幅：`banners` 非空时，每 surface 一张，背景素材复用 `generate_image(purpose="hero")`；HTML 守中央安全区、不放设备外壳、高对比；`save_brand_asset(kind="banner", surface?, name, target={width,height})`，尺寸取自计划条目，命名按 §5.2 固定为 mobile/tablet 的 `android` / `ios` 或 web/desktop 的 `primary`。
- 海报：对每个开启的 `posters` 样式各一张，`save_brand_asset(kind="poster", variant=<style>, name=<style>, target)`。
- 重跑确认（D12）：先列已有资产、明确"将删除 Y、将重新生成/覆盖 X"，确认后再按顺序执行删除与生成；所有 `delete_brand_asset` 调用必须发生在确认之后。

**fm-app-icon**（×3）：

- 前置：调 `get_brand_asset_plan` 取 `app_icon` 段——含需生成的基图清单（mobile/tablet=`a/b/c`、web/desktop=`a/b`）与待产出变体集。
- 生成基图（mobile/tablet **3 张** a/b/c；web/desktop **2 张** a/b），各 `generate_image(purpose="app-icon", aspect="1:1", count=3)` → Read 视检选优；像素尺寸由 provider 决定，保存时 core 先归一化到 1080×1080 工作画布再派生规格。
- 读 brand tokens（`get_style`）取 tint/单色/深背景色。
- **一次** `save_brand_asset(kind="app-icon", source={ logo_ref, bg_ref, safe_logo_ref? }, colors?)`——不传 `name` / `surface` / `variant`；mobile/tablet 传 a/b/c，web/desktop 只传 a/b；core 派生记录名并整组替换该平台全套变体。
- 删 `name="primary"` 措辞（§5.3）；重跑确认（D12）。

**fm-design**（×3，仅措辞）：`forma-image://brand/app-icon` 说明同步到 standard 解析；移除 primary 措辞。

### 6.9 craft 提示词脚手架扩展（D13）

`craft/image-prompts.md` 新增/扩展脚手架（agent 层，core 只透传）：

- 图标 **3 基图脚手架**（其余变体由 core 派生，无需脚手架）：`app-icon-logo`（透明背景 LOGO，单一主体、主体占比 ~60–80%、无文字）、`app-icon-background`（纯色/渐变/图案、不透明、无前景元素）、`app-icon-safe-logo`（LOGO 缩于中央约 **61.7%** 安全区，1080 工作画布上约 666px + 透明背景）。各含无文字 / 单主体 / 可缩至 ~24px 的否决项。
- `banner`：中央安全区（如 1024×500 的居中 860×400）、大 Logo + 应用名 + 一句口号、禁设备外壳、高对比度渐变背景。复用 `hero` purpose 生背景。
- 商店图/海报：按设计建议补"前三张定生死""字大一句话""真机 Mockup""痛点/场景驱动""CTA 明确""留白预留二维码区"等 prompt 提示（作参考，非强制）。

### 6.10 文档同步：CLAUDE.md

`CLAUDE.md` 的媒体子系统/品牌资产章节多处会过时，必须同步（按当前行号）：

- 顶部 store 方法段：`listStoreShotPresets` → `getBrandAssetPlan` + `updateBrandAssetSettings` + `deleteBrandAsset`。
- 存储布局（~L66）：`brand-assets/` 增 `banners/`。
- 子系统说明（~L104）："preset table" → "asset plan"。
- "New MCP tools (5)"（~L110）：`list_store_shot_presets` → `get_brand_asset_plan`；加 `delete_brand_asset`（变 6 个）。
- "New server routes"（~L111）：加 `PUT …/brand-asset-settings`（7 → 8）。
- agent commands 说明（~L112）：删 `name="primary"` 措辞；fm-brand-assets 增"商店图/横幅/海报"+ 数量/开关；说明分端 Android/iOS。
- 品牌画布段（~L128）：分组从"仅 kind"改为"kind → surface → variant"，列出 banner。

## 7. 开放性问题答复

### 7.1 fm-rollback-design 去除（D11）

`packages/agent/templates/{claude,codex,gemini}/` 当前有 8 个命令（`fm-list-product` / `fm-status` / `fm-requirement` / `fm-design` / `fm-refine-components` / `fm-change-style` / `fm-brand-assets` / `fm-app-icon`），**源码模板里已无 `fm-rollback-design`**。用户仍能看到它通常是因为残留在已安装目录或备份目录（`~/.forma/backups/...`、`~/.claude/commands/fm-rollback-design.md` 等历史安装产物）。

清理要求：manifest 管理过的旧安装路径由现有重装/卸载流程清理；非 manifest 管理的历史残留不能承诺"重装一次必清"。本次实现如增加一次性显式清理旧目标路径（Claude `~/.claude/commands/fm-rollback-design.md`、Codex `~/.codex/skills/fm-rollback-design/`、Gemini `~/.gemini/commands/fm-rollback-design.toml`，以及对应 Forma 备份项），自动删除仅限能证明为 Forma 管理内容的文件/目录：manifest-owned、内容包含旧 Forma route 管理标记、或匹配旧模板指纹/管理标记。无法证明所有权的同名用户文件必须保留，并在安装输出中明确提示用户删除或要求显式确认；不得静默删除。

需区分：**agent 命令 `fm-rollback-design`**（源码已删，清旧安装即可）vs **网页端 DesignView 的 artifact 版本回滚**（core/server/web 中另一套独立功能，仍在，**保留**）。本次不动后者。

### 7.2 fm-* 无描述纯命令重跑行为（D12）

当前行为（实读模板）：

| 命令 | 无描述重跑 | 旧资源 |
|---|---|---|
| `fm-design` | Full 模式：重规划**所有页面**并逐页重生成 | 每页新 `v{n}`，旧版本不可变保留 |
| `fm-refine-components` | 重生成**整个组件库**（现库作参考） | 新版本，旧版本保留 |
| `fm-app-icon` | 重生成图标 | 按 (kind,name) **覆盖**，无版本树 |
| `fm-brand-assets` | 先问要 store-shots/posters/哪个，再逐资产重生成 | 按 (kind,name) **覆盖** |

即：**均为全量重生成**（非增量）。design/components 留历史版本，app-icon 按整组替换，brand-assets 按名覆盖并清理计划外记录。**决策**：维持该语义，重跑前增加明确确认；`fm-brand-assets` 必须列出"将删除 Y、将重新生成/覆盖 X"，确认后才执行删除与生成（D12/D15）。

## 8. 测试与验证

```bash
pnpm build && pnpm typecheck && pnpm lint
npx vitest run packages/core/tests/brand-asset-plan.test.ts \
               packages/core/tests/brand-assets.test.ts \
               packages/core/tests/media/
npx vitest run packages/mcp/tests/tools.test.ts
pnpm exec vitest run packages/web/src/pages/BrandAssets.test.tsx \
                    packages/web/src/pages/ProductDetail.test.tsx \
                    packages/web/src/api.test.ts
```

- 新增/重写：`store-shot-presets.test.ts` → `brand-asset-plan.test.ts`（计划派生：各 platform × 设置组合）；`brand-assets.test.ts`（banner kind、surface/variant、app-icon 整组替换、alpha 保留、`delete_brand_asset` 清理、1024/2048/非 1080 方图输入归一化到 1080 工作画布）；**`icon-derive.test.ts`（合成 / alpha 掩膜填色 / 去色 / 缩放派生，确定性、无 stub）**；`image-models.test.ts`（4 新模型 + 尺寸 + provenance）；mcp `tools.test.ts`（`get_brand_asset_plan`、`delete_brand_asset`、banner、surface/variant schema、app-icon 专用输入禁传 `name/surface/variant/target` 且返回 `{ assets:[...] }`）；product schema 测试（`brand_assets` 校验 3–8 边界）；server 路由测试（`brand-asset-settings` PUT）；web `BrandAssets.test.tsx`（surface 分组、banner）、`ProductDetail.test.tsx`（设置面板）、`api.test.ts`。
- 模板/行为测试必须覆盖 fm-brand-assets 重跑清理：当 `store_shot_count` 下降、`banner_enabled` 关闭、或海报样式关闭时，模板会先读取现有资产并生成确认文案，文案必须列出"将删除 Y"与"将重新生成/覆盖 X"；只有确认后才调用 `delete_brand_asset(product_id, kind, name)` 删除计划外 store-shot/banner/poster 记录，测试需校验删除清单和调用顺序。
- 模板相关：`packages/core/tests/craft.test.ts`（image-prompts 新脚手架 slug）；**`packages/agent/tests/template-parity.test.ts`（claude/codex/gemini 三平台模板必须保持 parity——任一命令改动须三套同步，否则该测试失败）**。
- Gemini 新模型验证必须覆盖当前 renderer 选择：若继续使用 OpenAI-compatible renderer，测试/手动验收需证明新 Gemini IDs 可走 `/images/generations`；若改 native renderer，补 native 请求/响应解析、错误映射、尺寸读取和 stub 测试。
- install 测试覆盖 `fm-rollback-design` 非 manifest 残留处理：manifest-owned 或旧 Forma route 标记/指纹可自动清理；无法证明所有权的同名用户文件保留并提示或要求确认。
- 全部自动化测试**不打外网**（stub provider + 本地渲染），与既有"不需 Pencil CLI"原则一致；真实 provider 调用仅手动验收（计费，不进 CI）。
- **手动验收**：配置 OpenAI/Gemini key → 选 `gpt-image-2` / `gemini-3-pro-image` → 后台设 count=5 / 开横幅 / 开三海报 → 跑 `fm-app-icon`（多版本）+ `fm-brand-assets` → 画布见 Android/iOS 分组 + export zip 完整。

## 9. 兼容性与回滚

- **零迁移**（D10）：当前为测试数据，破坏式清理；新 manifest 全带 `surface`/`variant`，不写旧记录回退分支。
- **唯一破坏性变更**：删 `list_store_shot_presets`（MCP 面 + core 导出 `listStoreShotPresets`）——消费者只有本分支同步更新的 agent 命令，重装即生效。
- **外部状态**：唯一外部副作用是调用 OpenAI/Gemini/火山 API（计费），失败不留半成品（暂存区 TTL 清扫，brand-assets 写在锁内原子完成）。
- **回滚**：`git revert` 整支；**无新增凭据/基础设施**——新模型复用既有 provider 槽。

## 10. 显式遗留

| 项 | 说明 | Owner |
|---|---|---|
| 4 个新模型精确尺寸表与外部事实 | 落地时逐一对官方文档核实并补 provenance；§6.1 / 附录 A 中标记 **UNCONFIRMED** 的速度、成本、发布日期、架构、preview 弃用日期不得进入测试断言，除非重新核实 | 实现期（先行项） |
| 四类资产分辨率 provenance | §6.4 各候选值均为 **UNCONFIRMED**；落地时记录 `source` + `verifiedAt`，并以官方值覆盖候选值 | 实现期 |
| tinted/monochrome 真实透明输出 | 依赖 provider 是否返回 RGBA；stub 不返回 alpha，单测用合成 alpha PNG 验派生逻辑，真实效果留手动验收 | 实现期 + 手动验收 |
| 资产/设置历史版本 | 覆盖式更新无版本树；如需另立需求 | 后续需求 |

## 附录 A：生图模型核实记录（2026-06-14 联网核实）

| Model ID | 状态/发布 | 关键事实 | 来源 |
|---|---|---|---|
| `gpt-image-2` | 官方页确认模型存在；GA 日期 / snapshot **UNCONFIRMED** | 已确认：文本/图像输入、图像输出、Image generation / Image edit 端点；未直接确认：推理能力细节、GA 日期、snapshot | https://developers.openai.com/api/docs/models/gpt-image-2 |
| `gpt-image-1.5` | 官方页确认模型存在；发布日期 **UNCONFIRMED** | 已确认：输出尺寸/价格档包含 `1024×1024`、`1024×1536`、`1536×1024`；未直接确认：比 1 快 ~4×、便宜 ~20%、内建于 GPT-5 架构 | https://platform.openai.com/docs/models/gpt-image-1.5 |
| `gemini-3-pro-image` | 官方页确认 stable model ID | 已确认：Nano Banana Pro、Image generation、Search grounding；2K/4K 具体可选尺寸档仍需实现期核实 | https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image |
| `gemini-3.1-flash-image` | 官方 image-generation 文档示例确认 model ID；GA 日期 **UNCONFIRMED** | 已确认：示例使用 `gemini-3.1-flash-image` 且 Gemini 3 图像模型示例支持 `image_size: "2K"`；未直接确认：Nano Banana 2、flash 速度 pro 质量、高吞吐、GA 日期 | https://ai.google.dev/gemini-api/docs/image-generation |

> 注：Gemini `gemini-3.1-flash-image-preview` / `gemini-3-pro-image-preview` 的弃用日期当前 **UNCONFIRMED**；目录策略仍是只收 stable / GA id。OpenAI/Gemini 官方文档正文可能由站点 JS 渲染；实现前必须重开官方页核对 model id、端点、尺寸档与返回字段，若与本文不一致以官方为准并同步目录与测试。

## 附录 B：关键源文件锚点

| 改造项 | 文件 |
|---|---|
| 模型目录 | `packages/core/src/media/image-models.ts`(+test) |
| 资产存储/计划/分辨率/图标 | `packages/core/src/brand-assets.ts`(+tests) |
| 图标本地派生（合成/tint/去色/缩放） | `packages/core/src/icon-derive.ts`(+`icon-derive.test.ts`) |
| 渲染沙箱（任意尺寸 ≤16384） | `packages/core/src/brand-asset-render.ts` |
| 设置 schema / 写入 | `packages/core/src/product.ts`、`store.ts` |
| MCP 工具 | `packages/mcp/src/tools.ts`(+test) |
| 路由 | `packages/server/src/routes.ts`(+test) |
| Web 设置/画布/类型/i18n | `packages/web/src/pages/ProductDetail.tsx`、`pages/BrandAssets.tsx`、`api.ts`、`i18n.ts` |
| agent 命令（×3 平台） | `packages/agent/templates/claude/fm-app-icon.md`、`packages/agent/templates/claude/fm-brand-assets.md`、`packages/agent/templates/claude/fm-design.md`、`packages/agent/templates/codex/fm-app-icon/SKILL.md`、`packages/agent/templates/codex/fm-brand-assets/SKILL.md`、`packages/agent/templates/codex/fm-design/SKILL.md`、`packages/agent/templates/gemini/fm-app-icon.toml`、`packages/agent/templates/gemini/fm-brand-assets.toml`、`packages/agent/templates/gemini/fm-design.toml` |
| 提示词脚手架 | `craft/image-prompts.md`(+`craft.test.ts`) |
| 模板 parity | `packages/agent/tests/template-parity.test.ts` |
| 文档 | `CLAUDE.md`（媒体子系统章节：kinds/工具/路由/画布分组）；`docs/brand-assets-optimization-requirements.md`（本文） |
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 112158, 'JavaScript': 22178}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (19):
  - @xenonbyte/forma-cli workspace:* (npm)
  - @xenonbyte/forma-core workspace:* (npm)
  - @xenonbyte/forma-server workspace:* (npm)
  - @biomejs/biome 2.2.4 (npm, dev)
  - @types/js-yaml ^4.0.9 (npm, dev)
  - @types/node ^24.0.0 (npm, dev)
  - @vitest/browser 4.1.6 (npm, dev)
  - @vitest/browser-playwright 4.1.6 (npm, dev)
  - @xyflow/react 12.10.2 (npm, dev)
  - happy-dom ^20.9.0 (npm, dev)
  - js-yaml ^4.1.1 (npm, dev)
  - lucide-static 1.18.0 (npm, dev)
  - playwright 1.60.0 (npm, dev)
  - react ^19.2.6 (npm, dev)
  - react-dom ^19.2.6 (npm, dev)
  - tsup ^8.0.0 (npm, dev)
  - tsx ^4.20.0 (npm, dev)
  - typescript ^5.9.0 (npm, dev)
  - vitest ^4.0.7 (npm, dev)
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 112158, 'JavaScript': 22178}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (19):
  - @xenonbyte/forma-cli workspace:* (npm)
  - @xenonbyte/forma-core workspace:* (npm)
  - @xenonbyte/forma-server workspace:* (npm)
  - @biomejs/biome 2.2.4 (npm, dev)
  - @types/js-yaml ^4.0.9 (npm, dev)
  - @types/node ^24.0.0 (npm, dev)
  - @vitest/browser 4.1.6 (npm, dev)
  - @vitest/browser-playwright 4.1.6 (npm, dev)
  - @xyflow/react 12.10.2 (npm, dev)
  - happy-dom ^20.9.0 (npm, dev)
  - js-yaml ^4.1.1 (npm, dev)
  - lucide-static 1.18.0 (npm, dev)
  - playwright 1.60.0 (npm, dev)
  - react ^19.2.6 (npm, dev)
  - react-dom ^19.2.6 (npm, dev)
  - tsup ^8.0.0 (npm, dev)
  - tsx ^4.20.0 (npm, dev)
  - typescript ^5.9.0 (npm, dev)
  - vitest ^4.0.7 (npm, dev)
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 112158, 'JavaScript': 22178}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (19):
  - @xenonbyte/forma-cli workspace:* (npm)
  - @xenonbyte/forma-core workspace:* (npm)
  - @xenonbyte/forma-server workspace:* (npm)
  - @biomejs/biome 2.2.4 (npm, dev)
  - @types/js-yaml ^4.0.9 (npm, dev)
  - @types/node ^24.0.0 (npm, dev)
  - @vitest/browser 4.1.6 (npm, dev)
  - @vitest/browser-playwright 4.1.6 (npm, dev)
  - @xyflow/react 12.10.2 (npm, dev)
  - happy-dom ^20.9.0 (npm, dev)
  - js-yaml ^4.1.1 (npm, dev)
  - lucide-static 1.18.0 (npm, dev)
  - playwright 1.60.0 (npm, dev)
  - react ^19.2.6 (npm, dev)
  - react-dom ^19.2.6 (npm, dev)
  - tsup ^8.0.0 (npm, dev)
  - tsx ^4.20.0 (npm, dev)
  - typescript ^5.9.0 (npm, dev)
  - vitest ^4.0.7 (npm, dev)
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
