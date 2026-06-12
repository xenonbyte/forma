# Plan

任务按里程碑 M0→M5 严格排序；每个里程碑独立收口（最后一个任务的 Verification 含收口命令），收口后由用户运行 `/check`。真实 provider 调用（计费）只出现在标注「手动验收（用户）」的条目，不进自动化测试。

## Tasks

### PLAN-TASK-001 M0：get_component_baseline 返回 craft_rules
Spec References: SPEC-BEHAVIOR-009
Change Type: modify
TDD Applicable: yes
Files:
- packages/core/src/design-context.ts
- packages/mcp/src/tools.ts
- packages/mcp/tests/tools.test.ts
Skeleton:
```ts
// core：抽出与 get_design_context 同源的 craft 文档全集读取
export async function readAllCraftDocs(styles: StylesService): Promise<CraftDoc[]>;
// mcp tools.ts get_component_baseline handler 返回值并入新字段：
// { platform, baseline, craft_rules: await readAllCraftDocs(store.styles) }
```
Steps:
- [ ] 在 `design-context.ts` 抽出 craft 文档全集读取函数（复用 `styles.readCraftDoc`，slug 集与 `get_design_context` 同源，含 ai-tells / design-read）
- [ ] `get_component_baseline` handler（tools.ts:461 起）返回值新增 `craft_rules`，既有字段零改动
- [ ] mcp 测试断言：`craft_rules` 存在、含 ai-tells 文档、旧字段不变
Verification: npx vitest run packages/mcp/tests/tools.test.ts packages/core/tests/design-context.test.ts

### PLAN-TASK-002 M0：fm-refine-components / fm-change-style 增加 palette design-read 步骤（×3 平台）
Spec References: SPEC-BEHAVIOR-009
Change Type: modify
TDD Applicable: yes
Files:
- packages/agent/templates/claude/fm-refine-components.md
- packages/agent/templates/codex/fm-refine-components/SKILL.md
- packages/agent/templates/gemini/fm-refine-components.toml
- packages/agent/templates/claude/fm-change-style.md
- packages/agent/templates/codex/fm-change-style/SKILL.md
- packages/agent/templates/gemini/fm-change-style.toml
- packages/agent/tests/template-parity.test.ts
Skeleton:
```md
N+1. Palette design-read (before defining brand tokens): call get_component_baseline and
read craft_rules. Apply the palette-rotation rule from ai-tells: do not default to warm
beige/cream with brass/clay/oxblood unless brand_style tokens already lock that palette.
Rotate real alternatives and record the chosen direction in one line.
```
Steps:
- [ ] fm-refine-components ×3 平台：在 `get_style` 步骤之后、生成 brand tokens 之前插入 palette design-read 步骤（读 `craft_rules` 并执行色板轮换检查），步骤重编号
- [ ] fm-change-style ×3 平台：同样插入该步骤（换风格 = 重定色板）
- [ ] template-parity 断言更新：两命令均含 palette design-read 文案
Verification: npx vitest run packages/agent/tests/template-parity.test.ts；M0 收口：pnpm test && pnpm typecheck，绿后请用户运行 /check

### PLAN-TASK-003 M1：新增 6 个 FormaError 错误码与 HTTP 映射分支
Spec References: SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-004, SPEC-BEHAVIOR-006
Change Type: modify
TDD Applicable: yes
Files:
- packages/core/src/errors.ts
- packages/server/src/app.ts
- packages/server/tests/routes.test.ts
Skeleton:
```ts
// errors.ts：code 枚举追加
// MEDIA_NOT_CONFIGURED | MEDIA_PROVIDER_ERROR | MEDIA_INVALID_INPUT |
// MEDIA_IMAGE_NOT_FOUND | BRAND_ASSET_INVALID_INPUT | BRAND_ASSET_NOT_FOUND
// app.ts statusForError：新增显式分支
if (error.code === "MEDIA_NOT_CONFIGURED") return 409;
if (error.code === "MEDIA_PROVIDER_ERROR") return 502;
// NOT_FOUND 两码走既有 *_NOT_FOUND 后缀规则自动 404；INVALID 两码走默认 400
```
Steps:
- [ ] errors.ts code 枚举追加 6 码（JSON 序列化 details 沿用既有机制）
- [ ] `statusForError`（app.ts:245 起）加 409/502 两个显式分支
- [ ] server 测试断言四种状态映射（409 / 502 / 404 后缀 / 400 默认）
Verification: npx vitest run packages/server/tests/routes.test.ts

### PLAN-TASK-004 M1：image-models.ts provider/模型目录（先复核官方文档）
Spec References: SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-002
Change Type: create
TDD Applicable: yes
Files:
- packages/core/src/media/image-models.ts
- packages/core/tests/media/image-models.test.ts
Skeleton:
```ts
export type ImageProvider = { id: string; label: string; hint: string; defaultBaseUrl?: string; docsUrl?: string };
export type ImageModel = { id: string; label: string; hint: string; provider: string; default?: boolean };
export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
export const IMAGE_PROVIDERS: ImageProvider[];
export const IMAGE_MODELS: ImageModel[];
export function resolveSize(model: string, aspect: AspectRatio): { width: number; height: number };
```
Steps:
- [ ] **第一步（强制）**：重新打开火山官方文档 82379/1330310、82379/1541523、82379/1824121，复核 model id / endpoint / `response_format` / 返回字段，并核定 aspect→size 每档像素值（原则：每档取该模型推荐的最高质量值 ≥2K）；与需求文档不一致以官方为准并同步
- [ ] 落目录：volcengine（默认 baseUrl `https://ark.cn-beijing.volces.com/api/v3`）五个 Seedream 模型（默认 `doubao-seedream-5-0-260128`）+ stub（不进设置 UI）
- [ ] 落 aspect→size 表，测试中以注释记录来源 URL + 核实日期
- [ ] 测试：目录完整性、默认模型唯一、未注册 model / provider 不匹配的判别函数
Verification: npx vitest run packages/core/tests/media/image-models.test.ts

### PLAN-TASK-005 M1：image-config.ts 凭证配置（env 优先 / 脱敏 / 0600）
Spec References: SPEC-BEHAVIOR-003
Change Type: create
TDD Applicable: yes
Files:
- packages/core/src/media/image-config.ts
- packages/core/tests/media/image-config.test.ts
Skeleton:
```ts
export type MaskedMediaConfig = { configured: boolean; source: "env" | "file" | "none"; model?: string; base_url?: string; api_key_tail?: string };
export async function readMediaConfig(home: string): Promise<MaskedMediaConfig>;
export async function writeMediaConfig(home: string, payload: MediaConfigInput, opts: { preserveApiKey?: boolean; force?: boolean }): Promise<MaskedMediaConfig>;
export async function resolveProviderConfig(home: string, providerId: string): Promise<{ apiKey: string; baseUrl: string; model: string }>;
```
Steps:
- [ ] YAML 读写 `$FORMA_HOME/media-config.yaml`；env 优先级 `FORMA_VOLCENGINE_API_KEY` 高于 `ARK_API_KEY` 高于 `VOLCENGINE_API_KEY`
- [ ] 脱敏读：仅回 configured/source/model/base_url/api_key_tail（末 4 位）；env 来源不回尾号
- [ ] 写：preserveApiKey 不动既有 key；空 payload 清空已有配置时抛错（由路由映射 409），force 放行
- [ ] 权限：新建 0600，既有宽于 0600 收紧；win32 经 `process.platform` 跳过权限断言
- [ ] 无 key 时 `resolveProviderConfig` 抛 `MEDIA_NOT_CONFIGURED`
Verification: npx vitest run packages/core/tests/media/image-config.test.ts

### PLAN-TASK-006 M1：image-staging.ts 暂存区（put/resolve/TTL）
Spec References: SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-004
Change Type: create
TDD Applicable: yes
Files:
- packages/core/src/media/image-staging.ts
- packages/core/tests/media/image-staging.test.ts
Skeleton:
```ts
export type StagedImage = { id: string; ref: string; path: string };
export async function putStagedImage(home: string, productId: string, bytes: Buffer, meta: StagedImageMeta): Promise<StagedImage>;
export async function resolveFormaImageRef(home: string, productId: string, ref: string): Promise<Buffer>;
export const STAGING_TTL_MS = 24 * 60 * 60 * 1000;
```
Steps:
- [ ] put：写 `data/<pid>/image-staging/<uuid>.png` + `<uuid>.json`（purpose/prompt/model/width/height/created_at），写入时清扫超 TTL 旧条目（沿用 artifact-tmp-cleanup.ts 模式）
- [ ] resolve：`forma-image://<uuid>` 取字节；id 不存在/路径越界抛 `MEDIA_IMAGE_NOT_FOUND`；路径经 path-boundary.ts 校验
- [ ] `brand/` 前缀在本阶段同样抛 `MEDIA_IMAGE_NOT_FOUND`（details 注明 brand 资产不存在），预留 M3 转发位
Verification: npx vitest run packages/core/tests/media/image-staging.test.ts

### PLAN-TASK-007 M1：image-generate.ts 调度器 + volcengine/stub renderer
Spec References: SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-002
Change Type: create
TDD Applicable: yes
Files:
- packages/core/src/media/image-generate.ts
- packages/core/tests/media/image-generate.test.ts
Skeleton:
```ts
type ImageRenderer = (input: RenderInput, cfg: ProviderConfig) => Promise<RenderedImage[]>;
const RENDERERS: Record<string, ImageRenderer> = { volcengine: renderVolcengineImage, stub: renderStubImage };
export async function generateImages(home: string, input: GenerateImagesInput): Promise<GenerateImagesResult>;
// volcengine：POST {baseUrl}/images/generations，Bearer，{ model, prompt, size, response_format: "b64_json" }
// 非 2xx / 不可解析抛 MEDIA_PROVIDER_ERROR（details 含 status 与截断 body，绝不含 key）
```
Steps:
- [ ] 调度序：校验 model 在目录且属当前 provider（否则 `MEDIA_INVALID_INPUT`）→ resolveProviderConfig → 查注册表执行 → putStagedImage 落暂存
- [ ] purpose 默认 aspect：app-icon=1:1、illustration=4:3、hero=16:9、poster-bg=9:16、store-shot-bg=9:16；count 默认 1、上限 4（超出抛 `MEDIA_INVALID_INPUT`）
- [ ] volcengine renderer 按 od `media.ts` renderVolcengineImage 移植（解析 `data[0].b64_json|url`）
- [ ] stub renderer 返回确定性 PNG（尺寸编码进字节），测试全程不打网络
- [ ] 测试：stub 全链路、count 越界、无 key、provider 非 2xx（mock fetch）且 details 无 key
Verification: npx vitest run packages/core/tests/media/image-generate.test.ts

### PLAN-TASK-008 M1：store 装配 generateProductImage
Spec References: SPEC-BEHAVIOR-001
Change Type: modify
TDD Applicable: no
Files:
- packages/core/src/store.ts
Skeleton:
```ts
// createFormaStore 返回值新增：
generateProductImage: (input: GenerateImagesInput) => generateImages(home, input),
// 注意：生成不动产品状态，不包 runProductMutation
```
Steps:
- [ ] `createFormaStore` 暴露 `generateProductImage`（直连 media 调度器，不走产品锁）
- [ ] 确认既有 store 测试与类型导出不回归
Verification: pnpm typecheck && npx vitest run packages/core/tests/media/image-generate.test.ts

### PLAN-TASK-009 M1：资产管线接入 resolveFormaImage 解析器
Spec References: SPEC-BEHAVIOR-004
Change Type: modify
TDD Applicable: yes
Files:
- packages/core/src/artifact-asset-pipeline.ts
- packages/core/src/design-save.ts
- packages/core/tests/artifact-asset-pipeline.test.ts
Skeleton:
```ts
export type ResolveFormaImage = (ref: string) => Promise<Buffer>;
// localizeArtifactAssets 入口新增可选 resolveFormaImage；
// HTML 走查遇 forma-image: 引用时解析为字节并入既有 data: 处理流
// （同一降采样 @1x/@2x/@3x、预算、manifest 记账）；解析失败整次保存失败
```
Steps:
- [ ] 管线签名新增可选 `resolveFormaImage`，design-save 调用处注入（绑定 productId 的 staging resolve）
- [ ] `forma-image:` 引用解析成功后并入 data: 流；失败抛 `MEDIA_IMAGE_NOT_FOUND` fail loud
- [ ] 测试：解析成功落 assets、引用缺失失败、预算超限失败、未传解析器时遇 `forma-image:` 引用 fail loud
Verification: npx vitest run packages/core/tests/artifact-asset-pipeline.test.ts

### PLAN-TASK-010 M1：MCP 工具 generate_image
Spec References: SPEC-BEHAVIOR-001
Change Type: modify
TDD Applicable: yes
Files:
- packages/mcp/src/tools.ts
- packages/mcp/tests/tools.test.ts
Skeleton:
```ts
generate_image: tool("generate_image", async (input) =>
  store.generateProductImage({
    productId: input.product_id, purpose: input.purpose,
    prompt: input.prompt, aspect: input.aspect, count: input.count,
  })),
// 返回 { images: [{ id, ref, preview_path, width, height }], provider_note, warnings }
```
Steps:
- [ ] 工具 schema（purpose/aspect 枚举、count 1..4）、描述文案（preview_path 供 Read 视检）
- [ ] FormaError 经既有机制映射为 `{ error_code, message, details }`
- [ ] 测试：stub provider 全链路、schema 拒绝非法 purpose/count
Verification: npx vitest run packages/mcp/tests/tools.test.ts

### PLAN-TASK-011 M1：server 媒体路由（4 端点）+ 凭证排除测试
Spec References: SPEC-BEHAVIOR-003, SPEC-BEHAVIOR-001
Change Type: modify
TDD Applicable: yes
Files:
- packages/server/src/routes.ts
- packages/server/tests/routes.test.ts
Skeleton:
```ts
// GET  /api/media/models   → 目录（stub 不出现）
// GET  /api/media/config   → MaskedMediaConfig
// PUT  /api/media/config   → 写配置（preserve_api_key / force）
// POST /api/media/test     → 当前配置生成一张最小尺寸图 { ok, provider_note }
```
Steps:
- [ ] 四端点接 store/media 服务；PUT 空清空未带 force 时 409
- [ ] 凭证排除测试：静态服务与既有导出端点均取不到 media-config.yaml 内容；错误响应 details 不含 key
- [ ] 测试覆盖四端点形态 + 脱敏（env 来源不回尾号）
Verification: npx vitest run packages/server/tests/routes.test.ts

### PLAN-TASK-012 M1：web Settings「图片模型」节
Spec References: SPEC-BEHAVIOR-003
Change Type: modify
TDD Applicable: yes
Files:
- packages/web/src/pages/Settings.tsx
- packages/web/src/pages/Settings.test.tsx
Skeleton:
```tsx
<section data-settings-panel="image-model">
  ProviderSelect（目录驱动）→ ModelSelect（按 provider 联动）→
  ApiKeyInput（已配置显示掩码加末 4 位）→ BaseUrlInput（预填默认）→ TestConnectionButton
</section>
```
Steps:
- [ ] 拉 `GET /api/media/models` 与 `GET /api/media/config` 渲染表单；保存走 PUT（改模型不重填 key 时带 preserve_api_key）
- [ ] 「测试连接」按钮调 `POST /api/media/test`，成功/失败均显式提示
- [ ] 组件测试：联动、掩码显示、保存 payload、测试按钮状态
- [ ] M1 手动验收（用户）：填真实 ARK key → 测试连接成功
Verification: npx vitest run packages/web/src/pages/Settings.test.tsx；M1 收口：pnpm test && pnpm typecheck，绿后请用户运行 /check

### PLAN-TASK-013 M2：Lucide 全量 vendor + core 检索服务
Spec References: SPEC-BEHAVIOR-005
Change Type: create
TDD Applicable: yes
Files:
- scripts/vendor-lucide.mjs
- packages/core/assets/lucide-icons.json
- packages/core/src/icon-search.ts
- packages/core/tests/icon-search.test.ts
Skeleton:
```ts
// vendor-lucide.mjs：从 lucide-static 读全量 SVG + tags，生成
// packages/core/assets/lucide-icons.json：{ [name]: { svg, tags, categories } }
export async function searchIcons(query: string, limit?: number): Promise<IconHit[]>;
// 名称前缀优先、子串次之、tag 命中兜底；懒加载 JSON 单例
```
Steps:
- [ ] 根 package.json 加 `lucide-static` devDependency（锁定版本号，记录于脚本头注释），跑脚本产出 icons.json 入库
- [ ] core 检索服务：前缀/子串/tag 匹配、limit 默认 10、空查询拒绝
- [ ] 确认 core 构建产物包含 assets（对照 scripts/copy-assets.ts 既有机制）
- [ ] 测试：命中、空结果、limit、再生成脚本幂等（重跑 diff 干净）
Verification: node scripts/vendor-lucide.mjs && git diff --quiet packages/core/assets/lucide-icons.json && npx vitest run packages/core/tests/icon-search.test.ts

### PLAN-TASK-014 M2：MCP search_icons + 模板禁手绘硬规则
Spec References: SPEC-BEHAVIOR-005
Change Type: modify
TDD Applicable: yes
Files:
- packages/mcp/src/tools.ts
- packages/mcp/tests/tools.test.ts
- packages/agent/templates/claude/fm-design.md
- packages/agent/templates/codex/fm-design/SKILL.md
- packages/agent/templates/gemini/fm-design.toml
- packages/agent/templates/claude/fm-refine-components.md
- packages/agent/templates/codex/fm-refine-components/SKILL.md
- packages/agent/templates/gemini/fm-refine-components.toml
- packages/agent/templates/shared/SKILL.md
- packages/agent/tests/template-parity.test.ts
Skeleton:
```md
Hard rule: never hand-draw functional icons. Call search_icons and inline the returned
Lucide SVG (currentColor inheritance; stroke-width follows tokens). Decorative
brand-specific glyphs defined by tokens are the only exception.
```
Steps:
- [ ] MCP `search_icons(query, limit)` 工具 + 测试（命中/空数组）
- [ ] fm-design / fm-refine-components ×3 平台加禁手绘硬规则
- [ ] shared SKILL.md 自审清单加「功能图标均来自图标库」
- [ ] template-parity 断言更新
Verification: npx vitest run packages/mcp/tests/tools.test.ts packages/agent/tests/template-parity.test.ts；M2 收口：pnpm test && pnpm typecheck，绿后请用户运行 /check

### PLAN-TASK-015 M3：brand-assets.ts 存储（锁 / sharp 派生 / zip / brand 解析）
Spec References: SPEC-BEHAVIOR-006, SPEC-BEHAVIOR-008, SPEC-BEHAVIOR-004
Change Type: create
TDD Applicable: yes
Files:
- packages/core/src/brand-assets.ts
- packages/core/tests/brand-assets.test.ts
Skeleton:
```ts
export async function saveBrandAsset(deps: BrandAssetDeps, input: SaveBrandAssetInput): Promise<SavedBrandAsset>;
export async function listBrandAssets(home: string, productId: string, kind?: BrandAssetKind): Promise<BrandAssetRecord[]>;
export async function exportBrandAssetsZip(home: string, productId: string): Promise<Buffer>;
export async function resolveBrandImageRef(home: string, productId: string, ref: string): Promise<Buffer>;
const APP_ICON_SIZES = { ios: [1024, 180, 120], android: [512, 192, 144, 96, 72, 48], web: [512, 192, 32, 16] };
```
Steps:
- [ ] manifest 读写 `brand-assets/manifest.json`（记录 kind/name/files/brand_style/model/generated_at；同 kind+name 覆盖）
- [ ] `saveBrandAsset` 走 `runProductMutation` 锁内原子写；app-icon：2048 母版（不足放大先告警）→ sharp 按 platform 派生 + favicon
- [ ] `resolveBrandImageRef` 支持 `brand/app-icon` 与 `brand/app-icon@尺寸`；image-staging.ts 的 brand/ 前缀转发接到本函数（替换 M1 预留位）
- [ ] zip 导出复用既有 zip 能力；路径全程 path-boundary 校验
- [ ] 测试：锁、平台尺寸组、manifest 覆盖语义、zip、brand 引用解析（管线测试同步补 brand/ 用例）
Verification: npx vitest run packages/core/tests/brand-assets.test.ts packages/core/tests/artifact-asset-pipeline.test.ts

### PLAN-TASK-016 M3：HTML 渲染沙箱（先 localize 再渲染 + 白名单拦截）
Spec References: SPEC-BEHAVIOR-007
Change Type: create
TDD Applicable: yes
Files:
- packages/core/src/brand-asset-render.ts
- packages/core/tests/brand-asset-render.test.ts
Skeleton:
```ts
export async function renderBrandAssetHtml(deps: RenderDeps, input: { html: string; width: number; height: number; productId: string }): Promise<Buffer>;
// 第 1 层：渲染前把 forma-image:// 与产品预览引用重写为本地 bundle 文件（复用解析器）
// 第 2 层：puppeteer 禁脚本 + request interception 白名单
//   只放行重写后 bundle 目录内 file:// 与 path-boundary 校验通过的产品预览
//   http(s): / 协议相对 / 白名单外 file:// / 越界路径一律中止并抛错
```
Steps:
- [ ] 复用 preview-renderer.ts 的 puppeteer 基建（viewport 按目标像素）
- [ ] localize 阶段重写引用，浏览器层不出现 `forma-image://` 请求
- [ ] 拦截层四类测试：脚本拦截、远程请求拒绝、file 越界拒绝、白名单内预览可用
Verification: npx vitest run packages/core/tests/brand-asset-render.test.ts

### PLAN-TASK-017 M3：MCP 工具 save_brand_asset / list_brand_assets
Spec References: SPEC-BEHAVIOR-006, SPEC-BEHAVIOR-008
Change Type: modify
TDD Applicable: yes
Files:
- packages/mcp/src/tools.ts
- packages/mcp/tests/tools.test.ts
Skeleton:
```ts
save_brand_asset: tool("save_brand_asset", async (input) => store.saveBrandAsset(input)),
list_brand_assets: tool("list_brand_assets", async (input) =>
  store.listBrandAssets(input.product_id, input.kind)),
// source 恰好一个（image_ref 或 html）；kind 与 source 形态匹配在 schema + core 双重校验
```
Steps:
- [ ] 工具 schema：kind 枚举、source 互斥、target 二选一形态
- [ ] 测试：schema 拒绝（source 皆缺/皆给、未知 kind/preset）、`BRAND_ASSET_*` 错误经 `{ error_code, message, details }` 返回、stub 全链路
Verification: npx vitest run packages/mcp/tests/tools.test.ts

### PLAN-TASK-018 M3：server brand-assets 路由（3 端点）
Spec References: SPEC-BEHAVIOR-008, SPEC-BEHAVIOR-006
Change Type: modify
TDD Applicable: yes
Files:
- packages/server/src/routes.ts
- packages/server/tests/routes.test.ts
Skeleton:
```ts
// GET /api/products/:pid/brand-assets          → { assets }（含 brand_style）
// GET /api/products/:pid/brand-assets/files/*  → path-boundary 校验的文件服务
// GET /api/products/:pid/brand-assets/export   → zip 全量导出
```
Steps:
- [ ] 三端点接 core brand-assets 服务；文件服务越界路径 404/400 fail loud
- [ ] 测试：列表形态、文件服务边界（越界拒绝）、zip 导出、不存在产品/资产 404
Verification: npx vitest run packages/server/tests/routes.test.ts

### PLAN-TASK-019 M3：viewer AssetTile + web 品牌资产画布页
Spec References: SPEC-BEHAVIOR-008
Change Type: create
TDD Applicable: yes
Files:
- packages/viewer/src/AssetTile.tsx
- packages/viewer/src/AssetTile.browser.test.tsx
- packages/web/src/pages/BrandAssets.tsx
- packages/web/src/pages/BrandAssets.test.tsx
Skeleton:
```tsx
export function AssetTile(props: { name: string; src: string; width: number; height: number; stale?: boolean; onDownload: () => void });
// BrandAssets 页：#/products/:pid/brand-assets（React Flow 画布）
// 按 manifest kind 动态分组渲染（app-icon / store-shot / poster），数据有则组现——
// M5 商店图/海报组无需再改代码；工具栏「全部导出」走 export 端点
```
Steps:
- [ ] viewer 导出 AssetTile（缩略 + 尺寸标签 + 下载 + stale 徽标）；stale 由 `asset.brand_style !== product.brand_style` 驱动
- [ ] web 新路由注册进 routes.tsx（既有 RouteDefinition 模式），入口加在产品详情与 BrandResources 页
- [ ] 测试：分组渲染、stale 徽标、下载链接、全部导出按钮
Verification: npx vitest run packages/web/src/pages/BrandAssets.test.tsx && pnpm --filter @xenonbyte/forma-viewer test

### PLAN-TASK-020 M3：craft/image-prompts.md 提示词脚手架（全 purpose）
Spec References: SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-010
Change Type: create
TDD Applicable: yes
Files:
- craft/image-prompts.md
Skeleton:
```md
# Image Prompts
Per-purpose scaffolds: app-icon / illustration / hero / poster-bg / store-shot-bg.
Shared rules: locked palette (all generated material locks to brand tokens),
anti-slop bans (no purple-blue gradient defaults, no floating blobs, no generic stock look),
per-purpose veto checklist for visual inspection (garbled text, broken anatomy or
perspective, style drift). App-icon extras: no text, no mockup frame, single subject,
centered composition.
```
Steps:
- [ ] 编写五个 purpose 脚手架 + 锁色板 + anti-slop 禁则 + 视检否决清单（说明：需求文档将本文件排在 M4，因 fm-app-icon（M3）依赖 app-icon 脚手架，计划将创建提前到 M3 一次到位，M4 不再二次创建）
- [ ] craft/README.md 索引同步 + craft slug 全集断言测试同步（既有 vendor 文件零改动）
Verification: npx vitest run packages/core/tests/design-context.test.ts（craft slug 全集断言所在测试）

### PLAN-TASK-021 M3：fm-app-icon 新命令模板（×3 平台）
Spec References: SPEC-BEHAVIOR-010, SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-006
Change Type: create
TDD Applicable: yes
Files:
- packages/agent/templates/claude/fm-app-icon.md
- packages/agent/templates/codex/fm-app-icon/SKILL.md
- packages/agent/templates/gemini/fm-app-icon.toml
Skeleton:
```md
Flow: confirm product -> validate config (platform / brand_style) -> require image model
configured (stop with setup guidance when missing) -> get_style for palette ->
build prompt from the app-icon scaffold in craft/image-prompts.md ->
generate_image(purpose="app-icon", count=3) -> Read each preview and veto by checklist ->
pick the best -> save_brand_asset(kind="app-icon", image_ref) -> report sizes and canvas URL.
Existing icon means update semantics: state the overwrite explicitly, then proceed.
```
Steps:
- [ ] 三平台模板编写（与既有命令模板结构/语气一致）；template-parity 断言把新命令纳入全集
- [ ] 前置失败文案：未配置模型 → 指引 Settings；未选产品/未 init → 指引对应命令
Verification: npx vitest run packages/agent/tests/template-parity.test.ts

### PLAN-TASK-022 M3：icon unit 移除五连改 + manifest 零迁移回归
Spec References: SPEC-BEHAVIOR-010, SPEC-BEHAVIOR-006
Change Type: modify
TDD Applicable: yes
Files:
- packages/core/src/component-baseline.ts
- packages/core/tests/component-baseline.test.ts
- packages/core/tests/artifact-manifest.test.ts
- packages/agent/templates/claude/fm-refine-components.md
- packages/agent/templates/codex/fm-refine-components/SKILL.md
- packages/agent/templates/gemini/fm-refine-components.toml
- packages/agent/templates/claude/fm-change-style.md
- packages/agent/templates/codex/fm-change-style/SKILL.md
- packages/agent/templates/gemini/fm-change-style.toml
- packages/agent/templates/claude/fm-design.md
- packages/agent/templates/codex/fm-design/SKILL.md
- packages/agent/templates/gemini/fm-design.toml
- packages/agent/tests/template-parity.test.ts
Skeleton:
```md
fm-refine-components: remove the icon unit step and product_icon supporting_files;
add hard precondition (list_brand_assets must contain app-icon, else stop and guide to fm-app-icon).
fm-design: replace the componentLibrary.productIcon SVG reuse with
list_brand_assets check + forma-image://brand/app-icon@size references; conditional precondition.
fm-change-style: drop shape-reuse/recolor rules; after completion remind that
app icon and marketing assets may be stale (rerun fm-app-icon / fm-brand-assets).
```
Steps:
- [ ] component-baseline.ts 去 productIcon spec 节 + 测试同步
- [ ] fm-refine-components ×3：删 icon unit 与 SVG supporting_files 提交；重构既有库也不再输出；加 ICON 硬前置
- [ ] fm-design ×3：SVG 复用改 brand 引用 + 条件前置（涉及 ICON 展示的页面硬性，否则提醒放行）
- [ ] fm-change-style ×3：废弃 shape 复用 + 完成后过期提示
- [ ] manifest 零迁移回归：含 `forma.productIcon` 的旧 manifest 仍加载/校验通过（present 时 SVG 约束保留），manifest 代码零改动
- [ ] M3 手动验收（用户）：真实 key 跑 fm-app-icon 全流程 → 画布全尺寸组 + 导出
Verification: npx vitest run packages/core/tests/component-baseline.test.ts packages/core/tests/artifact-manifest.test.ts packages/agent/tests/template-parity.test.ts；M3 收口：pnpm test && pnpm typecheck，绿后请用户运行 /check

### PLAN-TASK-023 M4：fm-design IMAGERY 判定 + shared 自审项（×3 平台）
Spec References: SPEC-BEHAVIOR-010, SPEC-BEHAVIOR-001
Change Type: modify
TDD Applicable: yes
Files:
- packages/agent/templates/claude/fm-design.md
- packages/agent/templates/codex/fm-design/SKILL.md
- packages/agent/templates/gemini/fm-design.toml
- packages/agent/templates/shared/SKILL.md
- packages/agent/tests/template-parity.test.ts
Skeleton:
```md
Design Read step gains an IMAGERY check: does the page spec call for illustration
(empty state, onboarding, marketing hero)? If yes and the image model is configured,
generate_image(purpose="illustration" or "hero"), Read-inspect each candidate against the
image-prompts veto checklist, then reference the pick via forma-image:// in the page HTML.
If the model is not configured, fall back to the current CSS/SVG decorative route and
state the downgrade explicitly in the output report.
```
Steps:
- [ ] fm-design ×3：Design Read 步骤增 IMAGERY 判定（含显式降级文案）
- [ ] shared SKILL.md 自审清单加「生成插图已逐张视检且与色板一致」
- [ ] template-parity 断言更新
- [ ] M4 手动验收（用户）：真实 key 跑含插图页 fm-design → 插图经管线落 bundle，预览/标注画布可见
Verification: npx vitest run packages/agent/tests/template-parity.test.ts；M4 收口：pnpm test && pnpm typecheck，绿后请用户运行 /check

### PLAN-TASK-024 M5：商店图 preset 官方核定 + preset 表落地
Spec References: SPEC-BEHAVIOR-006
Change Type: create
TDD Applicable: yes
Files:
- packages/core/tests/store-shot-presets.test.ts
Skeleton:
```ts
// 在 brand-assets.ts（PLAN-TASK-015 已创建）追加：
export const STORE_SHOT_PRESETS: Record<string, { width: number; height: number; source: string; verifiedAt: string }>;
export function listStoreShotPresets(platform: ProductPlatform): StoreShotPreset[];
// 测试断言每条 preset 携带来源 URL 与 ISO 核实日期，且渲染输出像素精确等于 preset
```
Steps:
- [ ] **第一步（强制）**：打开 App Store Connect / Google Play / Open Graph 官方文档核定各平台商店图尺寸（每平台取主力 1-2 档）；此前任何示例值禁止落表
- [ ] preset 表写入 packages/core/src/brand-assets.ts（每条含 source URL + verifiedAt），按 product.platform 过滤返回
- [ ] save_brand_asset 的 `target.preset` 接通 preset 表；渲染尺寸测试断言像素精确
Verification: npx vitest run packages/core/tests/store-shot-presets.test.ts packages/core/tests/brand-assets.test.ts

### PLAN-TASK-025 M5：fm-brand-assets 新命令模板（×3 平台）
Spec References: SPEC-BEHAVIOR-010, SPEC-BEHAVIOR-006, SPEC-BEHAVIOR-007
Change Type: create
TDD Applicable: yes
Files:
- packages/agent/templates/claude/fm-brand-assets.md
- packages/agent/templates/codex/fm-brand-assets/SKILL.md
- packages/agent/templates/gemini/fm-brand-assets.toml
Skeleton:
```md
Flow: confirm product -> preconditions (config + image model + app icon present;
store shots additionally need at least one design artifact with previews, else stop and
guide to fm-design) -> read brand tokens + app icon + design previews ->
store shots: compose layout HTML (device frame + real page screenshot + selling copy +
brand background; optionally generate_image(purpose="store-shot-bg") for material) ->
save_brand_asset(kind="store-shot", html, preset per platform).
Posters: 1080x1920 vertical layout HTML + generated illustration material ->
save_brand_asset(kind="poster", html, target). Report canvas URL and export hint.
```
Steps:
- [ ] 三平台模板编写；前置检测按 5.2 矩阵全集（含 ICON 硬前置与商店图的预览硬前置）
- [ ] template-parity 断言把新命令纳入全集
- [ ] 画布分组验证：商店图/海报组随数据出现（PLAN-TASK-019 的动态分组，无代码改动）
- [ ] M5 手动验收（用户）：真实 key 全流程出一套商店图 + 海报并 zip 导出
Verification: npx vitest run packages/agent/tests/template-parity.test.ts；M5 收口：pnpm test && pnpm typecheck，绿后请用户运行 /check

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| PLAN-TASK-001 | SPEC-BEHAVIOR-009 | covered |
| PLAN-TASK-002 | SPEC-BEHAVIOR-009 | covered |
| PLAN-TASK-003 | SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-004, SPEC-BEHAVIOR-006 | covered |
| PLAN-TASK-004 | SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-002 | covered |
| PLAN-TASK-005 | SPEC-BEHAVIOR-003 | covered |
| PLAN-TASK-006 | SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-004 | covered |
| PLAN-TASK-007 | SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-002 | covered |
| PLAN-TASK-008 | SPEC-BEHAVIOR-001 | covered |
| PLAN-TASK-009 | SPEC-BEHAVIOR-004 | covered |
| PLAN-TASK-010 | SPEC-BEHAVIOR-001 | covered |
| PLAN-TASK-011 | SPEC-BEHAVIOR-003, SPEC-BEHAVIOR-001 | covered |
| PLAN-TASK-012 | SPEC-BEHAVIOR-003 | covered |
| PLAN-TASK-013 | SPEC-BEHAVIOR-005 | covered |
| PLAN-TASK-014 | SPEC-BEHAVIOR-005 | covered |
| PLAN-TASK-015 | SPEC-BEHAVIOR-006, SPEC-BEHAVIOR-008, SPEC-BEHAVIOR-004 | covered |
| PLAN-TASK-016 | SPEC-BEHAVIOR-007 | covered |
| PLAN-TASK-017 | SPEC-BEHAVIOR-006, SPEC-BEHAVIOR-008 | covered |
| PLAN-TASK-018 | SPEC-BEHAVIOR-008, SPEC-BEHAVIOR-006 | covered |
| PLAN-TASK-019 | SPEC-BEHAVIOR-008 | covered |
| PLAN-TASK-020 | SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-010 | covered |
| PLAN-TASK-021 | SPEC-BEHAVIOR-010, SPEC-BEHAVIOR-001, SPEC-BEHAVIOR-006 | covered |
| PLAN-TASK-022 | SPEC-BEHAVIOR-010, SPEC-BEHAVIOR-006 | covered |
| PLAN-TASK-023 | SPEC-BEHAVIOR-010, SPEC-BEHAVIOR-001 | covered |
| PLAN-TASK-024 | SPEC-BEHAVIOR-006 | covered |
| PLAN-TASK-025 | SPEC-BEHAVIOR-010, SPEC-BEHAVIOR-006, SPEC-BEHAVIOR-007 | covered |

## Upstream Summary (read-only)
# Spec

## Behavior Contracts

### SPEC-BEHAVIOR-001 generate_image 生成行为

承接 DES-ARCH-001。输入：`product_id`、`purpose ∈ {app-icon, illustration, hero, poster-bg, store-shot-bg}`、`prompt`（agent 全权构造，core 只透传）、`aspect? ∈ {1:1, 16:9, 9:16, 4:3, 3:4}`、`count? ∈ 1..4`（默认 1，超出 4 抛 `MEDIA_INVALID_INPUT`，不静默截断）。purpose 只决定默认 aspect 与暂存元数据：app-icon→`1:1`、illustration→`4:3`、hero→`16:9`、poster-bg→`9:16`、store-shot-bg→`9:16`。model 不是工具入参：取当前配置（env/media-config.yaml）所选 model。行为序：校验该 model 在目录内且属当前 provider（否则 `MEDIA_INVALID_INPUT`）→ `resolveProviderConfig` 取凭证（无 key 抛 `MEDIA_NOT_CONFIGURED`）→ 查 renderer 注册表执行 → 每张写暂存条目（`<uuid>.png` + `<uuid>.json` 元数据 `{ purpose, prompt, model, width, height, created_at }`），写入时顺手清扫 >24h 旧条目 → 返回 `{ images: [{ id, ref, preview_path, width, height }], provider_note, warnings }`，`preview_path` 为本地绝对路径供 agent Read 视检。生成不走 `runProductMutation` 锁。计费控制（承接 RISK-DEP-002）：count 上限 4 在 core 强制；连通性测试单张最小尺寸；自动化测试仅 stub。

### SPEC-BEHAVIOR-002 volcengine renderer 契约

承接 DES-ARCH-001。`POST {baseUrl}/images/generations`，`Authorization: Bearer <key>`，body `{ model, prompt, size, response_format: "b64_json" }`；解析 `data[0].b64_json | url`。HTTP 非 2xx 或响应不可解析抛 `MEDIA_PROVIDER_ERROR`（details 含 status 与截断 body，绝不含 key）。aspect→size 每档像素值为 M1 实现期核定项（UNCONFIRMED，原则：每档取该模型推荐的最高质量值 ≥2K，按官方文档 82379/1541523 落表并记来源 URL + 核实日期）。stub renderer 返回确定性 PNG 字节（含尺寸编码），全程不打网络、不进设置 UI。

### SPEC-BEHAVIOR-003 媒体凭证配置语义

承接 DES-ARCH-003。读优先级：env（`FORMA_VOLCENGINE_API_KEY` > `ARK_API_KEY` > `VOLCENGINE_API_KEY`）> `$FORMA_HOME/media-config.yaml`。读接口只回 `{ configured, source, model, base_url, api_key_tail }`（末 4 位；env 来源连尾号都不回）。写接口：`preserve_api_key=true` 时不动既有 key；空 payload 将清空已有配置时返回 409，`force=true` 才放行。文件权限：新建 0600；更新保留更严权限；既有宽于 0600 时收紧（win32 按 `process.platform` 跳过权限语义，其余约束跨平台不变）。该文件不得出现在 server 静态服务、artifact/brand-assets zip 导出、诊断包、日志、FormaError details 中；诊断仅脱敏元数据。

### SPEC-BEHAVIOR-004 forma-image:// 解析契约

承接 DES-ARCH-002。命名空间：`forma-image://<uuid>`（暂存区）、`forma-image://brand/app-icon` 与 `forma-image://brand/app-icon@<size>`（品牌资产）。解析时机 `localizeArtifactAssets`（design-save 入口），管线签名新增可选 `resolveFormaImage` 解析器；解析成功的字节并入既有 `data:` 处理流（同一降采样 @1x/@2x/@3x、预算 4MiB HTML / 48MiB 资产 / 200 文件、manifest 记账；超限 fail loud）。解析失败（id 不存在 / 路径越界 / brand 资产缺失）抛 `MEDIA_IMAGE_NOT_FOUND`，整次保存失败。**M1 期 `brand/` 命名空间未接线时**：解析 `brand/` 引用同样抛 `MEDIA_IMAGE_NOT_FOUND`（details 注明 brand 资产不存在），M3 接入后语义不变、数据可用即成功。消费时拷贝不删源；所有路径经 `path-boundary.ts` 校验。

### SPEC-BEHAVIOR-005 search_icons 检索契约

承接 DES-ARCH-004。输入 `query`（非空字符串）、`limit?`（默认 10）。匹配：名称前缀/子串 + tag 命中，懒加载 `lucide-icons.json`。返回 `{ icons: [{ name, tags, svg }] }`；无命中返回空数组（不报错）。SVG 为 Lucide 原始标记（`currentColor` 着色、stroke-width 可随 tokens 覆盖）。

### SPEC-BEHAVIOR-006 save_brand_asset 持久化契约

承接 DES-ARCH-005。输入：`product_id`、`kind ∈ {app-icon, store-shot, poster}`、`source = { image_ref? , html? }`（**恰好一个**，二者皆缺/皆给抛 `BRAND_ASSET_INVALID_INPUT`；app-icon 只接受 `image_ref`，store-shot/poster 只接受 `html`）、`name`、`target? = { width, height } | { preset }`（非法尺寸/未知 preset 抛 `BRAND_ASSET_INVALID_INPUT`）。app-icon 行为：取暂存图为 2048 母版（不足 2048 由 sharp 放大前先告警）→ 按 `product.platform` 派生尺寸组（iOS 1024/180/120、Android 512/192/144/96/72/48、Web 512/192/32/16）+ favicon。html 行为：经 SPEC-BEHAVIOR-007 沙箱按目标像素渲染 PNG。整个保存走 `runProductMutation` 锁内原子完成；manifest 追加/覆盖记录 `{ kind, name, files, brand_style, model?, generated_at }`（同 kind+name 为覆盖语义，v1 无版本树）。返回 `{ kind, name, files: [{ path, width, height }], generated_at }`。

### SPEC-BEHAVIOR-007 HTML 渲染沙箱契约

承接 DES-ARCH-006。两层：①渲染前 localize——`forma-image://` 引用与产品自身 artifact 预览引用由解析器重写为本地 bundle 文件（与 design-save 同序），浏览器层不出现 `forma-image://` 请求；②puppeteer 拦截层——默认禁脚本（拦截脚本执行），子资源白名单只放行重写后 bundle 目录内 `file://` 与经 path-boundary 校验的产品预览文件；`http(s):`、协议相对 URL、白名单外 `file://`、越界路径一律中止渲染并抛错（fail loud，不出降级图）。

### SPEC-BEHAVIOR-008 list_brand_assets 与过期判定

承接 DES-ARCH-005/DES-ARCH-006。`list_brand_assets(product_id, kind?)` 返回 `{ assets: [{ kind, name, files, brand_style, model?, generated_at }] }`；资产不存在指定查询时返回空数组，明确指名单个资产的导出/读取不存在时抛 `BRAND_ASSET_NOT_FOUND`。stale 判定在 web 层：`asset.brand_style !== product.brand_style` → 画布 AssetTile 显示「可能过期」徽标（D11：不自动重生成）。

### SPEC-BEHAVIOR-009 get_component_baseline 增量字段（M0）

承接 DES-ARCH-008。返回值新增 `craft_rules` 字段，内容与 `get_design_context` 的 craft 文档集同源（含 ai-tells / design-read 等全部 slug）；纯增量，既有字段与调用方为零影响。模板层契约：fm-refine-components / fm-change-style 在定义 brand tokens 前执行 palette design-read 步骤（按 craft_rules 做色板轮换检查，禁默认 artisan 色板，brand_style tokens 已锁定除外）。

### SPEC-BEHAVIOR-010 命令前置与显式降级

承接 DES-ARCH-007/DES-ARCH-009。前置矩阵（全部模板层检测，经 `list_brand_assets` / `list_product_artifacts` 查询判断；失败 = 停止 + 指引，不静默）：fm-app-icon 需产品+config+图片模型；fm-refine-components 需产品+config+ICON 硬前置；fm-design 需产品+config，ICON 条件前置（页面 spec 涉及 ICON 展示→硬性，否则提醒放行），插图页需模型已配置否则显式降级 CSS/SVG 装饰并在报告注明；fm-brand-assets 需产品+config+模型+ICON 硬前置，商店图另需至少一个有预览的设计稿。

## API / Data / Config Contracts

**MCP 工具（4 新增）**：

```
generate_image(product_id, purpose, prompt, aspect?, count?)        → 见 SPEC-BEHAVIOR-001
search_icons(query, limit? = 10)                                    → 见 SPEC-BEHAVIOR-005
save_brand_asset(product_id, kind, source, name, target?)           → 见 SPEC-BEHAVIOR-006
list_brand_assets(product_id, kind?)                                → 见 SPEC-BEHAVIOR-008
```

**server 路由（新增 7 端点）**：

| 方法/路径 | 行为 |
|---|---|
| `GET /api/media/models` | provider/模型目录（stub 不出现） |
| `GET /api/media/config` | 脱敏配置（SPEC-BEHAVIOR-003） |
| `PUT /api/media/config` | 写配置；`preserve_api_key`；空清空 409/`force` |
| `POST /api/media/test` | 当前配置生成一张最小尺寸图，`{ ok, provider_note }` 或 FormaError |
| `GET /api/products/:pid/brand-assets` | 列表 + manifest |
| `GET /api/products/:pid/brand-assets/files/*` 与 `…/export` | path-boundary 文件服务；zip 全量导出 |

**配置文件** `$FORMA_HOME/media-config.yaml`：

```yaml
providers:
  volcengine:
    api_key: "…"
    base_url: "https://ark.cn-beijing.volces.com/api/v3"   # 可省
    model: "doubao-seedream-5-0-260128"
```

**存储布局**：暂存 `data/<pid>/image-staging/<uuid>.{png,json}`；品牌资产 `data/products/<pid>/od-project/brand-assets/{manifest.json, app-icon/, store-shots/, posters/}`。

**错误码（6 新增）**：`MEDIA_NOT_CONFIGURED` / `MEDIA_PROVIDER_ERROR` / `MEDIA_INVALID_INPUT` / `MEDIA_IMAGE_NOT_FOUND` / `BRAND_ASSET_INVALID_INPUT` / `BRAND_ASSET_NOT_FOUND`，语义见各行为契约。HTTP 映射（按 `packages/server/src/app.ts` `statusForError` 既有惯例，2026-06-13 复核）：`MEDIA_IMAGE_NOT_FOUND` 与 `BRAND_ASSET_NOT_FOUND` 走既有 `*_NOT_FOUND` 后缀规则自动 404；`MEDIA_NOT_CONFIGURED` 加显式 409 分支（同 `PRODUCT_CONFIG_INCOMPLETE` 先例）；`MEDIA_PROVIDER_ERROR` 加显式 502 分支；两个 `*_INVALID_INPUT` 走默认 400。

**模型目录 v1**：volcengine = `doubao-seedream-5-0-260128`（默认）/ `doubao-seedream-5-0-lite-260128` / `doubao-seedream-4-5-251128` / `doubao-seedream-4-0-250828` / `doubao-seedream-3-0-t2i-250415`。

**图标数据** `packages/core/assets/lucide-icons.json`：`{ [name]: { svg, tags, categories } }`，~1500 条，产物入库，由 `scripts/vendor-lucide.mjs` 从 `lucide-static`（devDependency，ISC）再生成。

**agent 层契约**：新文件 `craft/image-prompts.md`（per-purpose 脚手架 / anti-slop 禁则 / 锁色板 / 视检否决清单；同步 `craft/README.md` 索引与 slug 测试）；新模板 `fm-app-icon` / `fm-brand-assets` ×3 平台；修改 `fm-refine-components` / `fm-design` / `fm-change-style` ×3 平台 + shared SKILL.md 两条自审项（功能图标均来自图标库；生成插图已视检且与色板一致）。

## External Documentation Checked

| Dependency | Version | Check Date | Conclusion |
|---|---|---|---|
| 火山方舟模型列表 https://www.volcengine.com/docs/82379/1330310 | 页面更新 2026.06.12 | 2026-06-13 | 已核：5 个 Seedream 可生图模型 ID（SeedEdit i2i 排除）；M1 实现前必须重新打开复核，不一致以官方为准并同步目录与测试 |
| 火山方舟图片生成 API https://www.volcengine.com/docs/82379/1541523 | 页面更新 2026.06.04 | 2026-06-13 | 已核：`POST {ark}/api/v3/images/generations`、Bearer、`response_format: b64_json`；aspect→size 每档值 M1 实现前按此页落表（来源 URL + 日期入测试） |
| Seedream 4.0–5.0 教程 https://www.volcengine.com/docs/82379/1824121 | 页面更新 2026.06.04 | 2026-06-13 | 已核：Seedream 4.0/5.0 文生图用法与规格；M1 实现前复核 |
| 商店图规格（App Store Connect / Google Play / Open Graph 官方文档） | 各平台现行版 | 2026-06-13 | UNCONFIRMED：当前像素示例值禁止落表/落测试；M5 实现前核定，preset 表测试记录来源 URL + 核实日期 |
| lucide-static（npm，ISC 许可证） | 待 M2 锁定 | 2026-06-13 | 仅 devDependency；M2 实现时固定版本号并随 `vendor-lucide.mjs` 产物记录，许可证随附 |

## Test Matrix

全部自动化测试不打外网（stub provider + 本地渲染）、不需要真实 APIKEY、不需要 Pencil CLI。真实 provider 调用仅用户手动验收。

| 里程碑 | 测试（文件级） | 关键断言 |
|---|---|---|
| M0 | `packages/core/tests/component-baseline*.test.ts`、mcp 工具测试、模板断言测试 | `craft_rules` 存在且含 ai-tells；模板含 palette design-read 步骤 |
| M1 | `packages/core/tests/media/image-models.test.ts` | 目录校验、未注册 model / provider 不匹配 → `MEDIA_INVALID_INPUT` |
| M1 | `packages/core/tests/media/image-config.test.ts` | env 优先级链、脱敏（env 不回尾号）、preserve_api_key、409 防清空、0600 创建/收紧（win32 跳过） |
| M1 | `packages/core/tests/media/image-generate.test.ts` | stub 生成、count>4 拒绝、无 key → `MEDIA_NOT_CONFIGURED`、provider 非 2xx → `MEDIA_PROVIDER_ERROR`（details 无 key） |
| M1 | `packages/core/tests/media/image-staging.test.ts` | put/resolve、TTL >24h 清扫、路径越界拒绝 |
| M1 | 资产管线测试扩展 | `forma-image:` 解析并入 data: 流、引用缺失 fail loud、预算超限 fail loud、`brand/` 未接线 → `MEDIA_IMAGE_NOT_FOUND` |
| M1 | server 路由测试 + web Settings 测试 | 6 条路由形态；配置节交互（厂商→模型联动、`••••`+尾 4 位） |
| M1 | 凭证排除测试 | 静态服务/zip 导出/诊断不含 media-config.yaml 内容 |
| M2 | 图标检索测试、`vendor-lucide.mjs` 再生成 diff 测试、mcp `search_icons` 测试、模板断言 | 命中/空结果/limit；icons.json 可重生成且 diff 干净；模板含禁手绘硬规则 |
| M3 | `packages/core/tests/brand-assets.test.ts` | 锁内原子写、平台尺寸派生组、manifest 记账、zip 导出、覆盖语义 |
| M3 | 渲染沙箱测试 | 脚本拦截、远程请求拒绝、file 越界拒绝、白名单预览可用（四类全覆盖） |
| M3 | mcp 工具测试（`save_brand_asset` / `list_brand_assets`） | schema 校验（source 恰好一个、未知 kind/preset 拒绝）；`BRAND_ASSET_*` 错误经 MCP `{ error_code, message, details }` 形态返回 |
| M3 | manifest 零迁移回归测试（artifact-manifest 层） | 含 icon unit / `forma.productIcon` 的旧 manifest 仍可加载与校验通过（present 时 SVG 约束保留），新生成不再产出该字段 |
| M3 | 管线 `brand/` 解析测试、viewer AssetTile 测试、web 路由测试、server 三条路由测试、模板断言（icon unit 移除后全集） | `brand/app-icon@<size>` 取到派生尺寸；stale 徽标按 brand_style 判定 |
| M4 | craft slug 测试、模板断言 | `image-prompts.md` 入索引；fm-design 含 IMAGERY 判定与显式降级文案 |
| M5 | preset 表测试、渲染尺寸测试、模板断言 | preset 表每条含来源 URL + 核实日期；按 preset 渲染输出像素精确 |
| 收口 | 每里程碑 `pnpm test` + `pnpm typecheck` | 全绿 |

手动验收（用户执行，计费）：M1 真实 key 测试连接；M3 fm-app-icon 全流程→画布全尺寸组+导出；M4 含插图页 fm-design→插图落 bundle 可见；M5 全流程商店图+海报+zip。

## Non-goals

沿用 brief：视频/音频、i2i/SeedEdit、Web 手动生图界面、自动级联重生成、标注画布改动、monochrome 变体、od 异步 task 层、内容审核均不做；不传 base64 过 LLM；core 不内置提示词、不做跨资产存在性校验；首发仅 volcengine + stub。

## PLAN Handoff

1. 任务按 M0→M5 排序，每个里程碑独立收口（代码 + 测试 + `pnpm test`/`pnpm typecheck` + 模板断言），收口后用户跑 `/check`。
2. 文件级改动清单按里程碑展开；M3 的 icon unit 移除明确列出 `packages/core/src/component-baseline.ts`（spec 去 productIcon 节 + 测试同步）与五连改其余四项。
3. 两个 UNCONFIRMED 项的核定任务显式排进对应里程碑首位：M1 第一步复核火山文档并落 aspect→size 表；M5 第一步核定商店图 preset（来源 URL + 日期入测试）。
4. 手动验收项列为用户步骤（不进 CI），每项标注前置（真实 ARK key）。
5. 模板改动每项 ×3 平台（claude/codex/gemini）+ shared，计划任务要逐平台列出防遗漏。
6. M1 的 store 装配（`generateProductImage`）与管线签名扩展（`resolveFormaImage`）属跨文件接线，计划中应与 media/ 四文件分开成任务以便审查。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| SPEC-BEHAVIOR-001 | DES-ARCH-001, RISK-DEP-002 | covered |
| SPEC-BEHAVIOR-002 | DES-ARCH-001, RISK-DEP-001 | covered |
| SPEC-BEHAVIOR-003 | DES-ARCH-003, RISK-SEC-001 | covered |
| SPEC-BEHAVIOR-004 | DES-ARCH-002, RISK-SEC-003, RISK-DATA-002, RISK-DATA-003 | covered |
| SPEC-BEHAVIOR-005 | DES-ARCH-004, RISK-DEP-003 | covered |
| SPEC-BEHAVIOR-006 | DES-ARCH-005, RISK-DATA-004 | covered |
| SPEC-BEHAVIOR-007 | DES-ARCH-006, RISK-SEC-002 | covered |
| SPEC-BEHAVIOR-008 | DES-ARCH-005, DES-ARCH-006 | covered |
| SPEC-BEHAVIOR-009 | DES-ARCH-008 | covered |
| SPEC-BEHAVIOR-010 | DES-ARCH-007, DES-ARCH-009 | covered |
| Test Matrix M3 manifest 零迁移回归 | RISK-DATA-001（旧 artifact 零迁移回归） | covered |
| External Documentation Checked | RISK-DEP-001, RISK-PROC-001 | open（M1/M5 前核定，owner 已标） |

## Upstream Summary (read-only)
# Design

## Design Summary

在 core 新增一个自包含的 `media/` 子系统（provider 目录、凭证配置、生成调度、暂存区），通过 `forma-image://` 引用协议接入既有资产管线，使生成图与 `data:` 资源走完全相同的降采样/预算/记账路径；品牌资产（应用 ICON / 商店图 / 海报）落 `brand-assets/` 持久存储并经独立画布页展示；功能图标用入库的 Lucide 全量 JSON + MCP 检索工具；文字密集资产（商店图/海报）由 agent 写排版 HTML 经沙箱化 puppeteer 渲染。提示词与前置检测全部留在 agent 模板层。六个里程碑 M0→M5 严格增量，互相独立可回滚。架构决策 D1–D11 已全部由用户拍板（见原始文档 §2），本阶段无新增人工决策。

## Current Code Evidence

以下锚点于 2026-06-13 在 HEAD=bd04fc7（工作树 clean）复核：

- `packages/core/src/artifact-manifest.ts:116,225-230` — `forma.productIcon` 为 optional 字段，present 时才校验 → icon unit 移除零迁移成立。
- `packages/agent/templates/claude/fm-design.md:26` — fm-design 经 `get_design_context` 获取 craft 规则；`fm-refine-components.md:21` — 只调 `get_style`，拿不到 craft 文档 → M0 缺口属实。
- `craft/ai-tells.md:63-67` — palette rotation 规则（反 beige/cream+brass 默认色板）存在且当前触达不到组件库流程。
- `packages/core/src/` 已存在：`artifact-asset-pipeline.ts`（data:-only、预算、降采样）、`design-save.ts`（temp→validate→atomic v{n}）、`preview-renderer.ts`（puppeteer、viewport 可配）、`path-boundary.ts`、`artifact-tmp-cleanup.ts`（TTL 清扫模式）、`product-mutation-lock.ts`（per-product 锁）→ 所有复用基座齐备，无运行时新依赖。
- `packages/agent/templates/` 有 `claude/codex/gemini/shared` 四目录 → 模板改动 ×3 平台 + shared 的结构成立。
- `packages/web/src/pages/Settings.tsx`（15 行语言切换空壳）→ 「图片模型」节为纯新增。
- 移植源已通读：open-design `apps/daemon/src/media-models.ts`（目录结构）、`media-config.ts`（env 优先/脱敏/preserveApiKey/409 防清空）、`media.ts:1293-1343`（`renderVolcengineImage`：`POST {baseUrl}/images/generations`，Bearer，`b64_json`）。

## Requirements Coverage

| Scope | 设计项 |
|---|---|
| SCOPE-IN-001 (M0) | DES-ARCH-008 |
| SCOPE-IN-002 (M1) | DES-ARCH-001 / 002 / 003 / 009 |
| SCOPE-IN-003 (M2) | DES-ARCH-004 |
| SCOPE-IN-004 (M3) | DES-ARCH-005 / 006 / 007 |
| SCOPE-IN-005 (M4) | DES-ARCH-007（image-prompts.md）+ DES-ARCH-002（管线接入） |
| SCOPE-IN-006 (M5) | DES-ARCH-005（preset 表）/ 006（画布扩展）/ 007（fm-brand-assets） |
| SCOPE-IN-007 | DES-ARCH-007（模板层前置检测） |
| SCOPE-IN-008 | DES-ARCH-003（凭证安全）/ 006（渲染沙箱，对应 RISK-SEC-001/002/003） |

## Options Considered

全部备选项已在需求阶段由用户裁决并记录于原始文档 §2（D1–D11 的「取代/否决的方案」列），代表性否决：生图做功能图标（D1 否决：一致性差）、首发 4 家 provider（D2 否决：渐进接入）、纯生图直出商店图（D3 否决：中文渲染不可用）、应用 ICON 留在 fm-brand-assets（D5 否决：顺序死锁）、agent 传 base64（D7 否决：上下文爆炸）、core 内置提示词（D9 否决：迭代不应依赖发版）、自动级联重生成（D11 否决：慢且贵）。本设计阶段不重开任何已决项。

## Chosen Design

### DES-ARCH-001 core media 子系统（目录 + 调度 + renderer 注册表）

新增 `packages/core/src/media/`：`image-models.ts`（`ImageProvider`/`ImageModel` 类型 + v1 目录：volcengine 五个 Seedream 模型，默认 `doubao-seedream-5-0-260128`；stub provider 不进 UI）、`image-generate.ts`（校验 model→取凭证→查 renderer 注册表→执行；volcengine renderer 按 od `media.ts:1293-1343` 移植，aspect→size 每档值 M1 实现期按官方文档核定）、`image-staging.ts`（`put`/`resolve`，路径经 `path-boundary.ts`，写入时清扫 >24h 条目）。store 装配为 `generateProductImage`，**不走** `runProductMutation`（生成不动产品状态，避免长任务占锁——RISK-DATA-004 的另一半）。扩展 provider = 目录加条目 + 注册一个 renderer，调度器不动。

### DES-ARCH-002 `forma-image://` 协议与资产管线接入

两个命名空间：`forma-image://<uuid>`（暂存区）与 `forma-image://brand/app-icon[@<size>]`（品牌资产，M3 接入）。解析时机为 `localizeArtifactAssets`（design-save 入口）：管线接受可选 `resolveFormaImage` 解析器，解析成功的字节并入既有 data: 处理流（同一降采样/预算/manifest 记账，超限 fail loud——RISK-DATA-002）；解析失败抛 `MEDIA_IMAGE_NOT_FOUND`，整次保存失败。消费时拷贝不删源，TTL 兜底（RISK-DATA-003）。

### DES-ARCH-003 凭证配置与设置面

对应风险 RISK-SEC-001。`image-config.ts` 存 `$FORMA_HOME/media-config.yaml`，语义照搬 od：env 优先（`FORMA_VOLCENGINE_API_KEY` > `ARK_API_KEY` > `VOLCENGINE_API_KEY`）、读接口脱敏（env 来源不回显尾号）、`preserve_api_key`、空 payload 清空需 `force=true` 否则 409。文件 0600 创建/收紧，win32 按 `process.platform` 跳过权限语义；不被静态服务/zip/诊断/日志/错误 details 暴露。server 三条路由（models / config GET+PUT / test）；web Settings 新增「图片模型」节（厂商→模型联动→KEY 输入→BaseURL→测试连接）。

### DES-ARCH-004 Lucide 图标库

对应风险 RISK-DEP-003。`lucide-static` 仅 devDependency；`scripts/vendor-lucide.mjs` 生成 `packages/core/assets/lucide-icons.json`（~1500 个，产物入库，升级显式重跑 + diff 审查）。core 懒加载检索服务（名称前缀/子串 + tag）；MCP `search_icons(query, limit?=10)`。模板硬规则：功能图标禁止手绘，必须 `search_icons` 取 Lucide SVG 内联（`currentColor` + stroke-width 随 tokens）。

### DES-ARCH-005 brand-assets 存储与尺寸派生

`packages/core/src/brand-assets.ts`：manifest 读写（每条记录 `brand_style` slug，供 stale 判定——D11）、`saveBrandAsset` **走 `runProductMutation` 锁**（原子写）、`listBrandAssets`、zip 导出（复用既有 zip 能力）、app-icon sharp 派生（2048 母版 → 按 product.platform 输出 iOS/Android/Web 对应组 + favicon）。商店图 preset 表同放此文件，像素值 M5 实现期核定（RISK-PROC-001：UNCONFIRMED 值禁止落表/落测试，核定后须记来源 URL + 日期）。存储路径 `data/products/<pid>/od-project/brand-assets/{manifest.json,app-icon,store-shots,posters}`。

### DES-ARCH-006 HTML 渲染沙箱与品牌资产画布

对应风险 RISK-SEC-002。`save_brand_asset` 的 `html` 源渲染分两层：渲染前由解析器把 `forma-image://` 与产品预览引用重写为本地 bundle 文件（与 design-save 同序：先 localize 再渲染，浏览器层不出现 `forma-image://`）；puppeteer 拦截层默认禁脚本，白名单只放行重写后 bundle 内 `file://` + path-boundary 校验通过的产品预览，`http(s):`/协议相对/越界一律 fail loud。画布页：viewer 新 `AssetTile`（缩略+尺寸标签+下载+stale 徽标），web 新路由 `#/products/:pid/brand-assets`（React Flow，M3 仅 ICON 组，M5 扩商店图/海报组），server 三条路由（列表 / path-boundary 文件服务 / zip 导出）。

### DES-ARCH-007 agent 命令层（提示词 + 前置检测）

新增 `craft/image-prompts.md`（允许：craft 冻结只限既有 vendor 文件——RISK-PROC-002；同步 README 索引与 slug 测试）：per-purpose 脚手架 + anti-slop 禁则 + 锁色板 + 视检否决清单。新模板 fm-app-icon（生成→Read 视检→选优→save）与 fm-brand-assets（商店图+海报，HTML 排版）×3 平台；既有模板改造：fm-refine-components（删 icon unit + ICON 硬前置 + 禁手绘）、fm-design（ICON 条件前置 + IMAGERY 判定 + brand 引用替换 `fm-design.md:36` 的 SVG 复用）、fm-change-style（废弃 shape 复用 + 过期提示）。前置检测全在模板层（5.2 矩阵），core 不做跨资产校验。

### DES-ARCH-008 M0 craft 分发修复

`get_component_baseline`（core+mcp）返回值新增 `craft_rules` 字段（与 `get_design_context` 同源文档集，纯增量）；fm-refine-components / fm-change-style 模板新增 palette design-read 步骤（色板轮换检查，反默认 artisan 色板）。

### DES-ARCH-009 错误码与降级

`errors.ts` 新增 6 码：`MEDIA_NOT_CONFIGURED` / `MEDIA_PROVIDER_ERROR`（details 含 status+截断 body，不含 key）/ `MEDIA_INVALID_INPUT` / `MEDIA_IMAGE_NOT_FOUND` / `BRAND_ASSET_INVALID_INPUT` / `BRAND_ASSET_NOT_FOUND`。降级路径：模型未配置时 fm-design 显式注明走 CSS/SVG 装饰；fm-app-icon / fm-brand-assets 直接停止并指引配置；核心设计管线不受影响。

## Decision Requests

none

## Rollback

- 全增量：`media-config.yaml`、`image-staging/`、`brand-assets/`、`lucide-icons.json`、新 MCP 工具、新路由、新模板均为新文件/新字段；任一里程碑回退 = revert 对应提交删除新代码，不触碰存量数据。
- 零迁移：旧 artifact 的 icon unit 与 `manifest.forma.productIcon` 依旧有效（optional + present 时校验保留）。
- 唯一外部副作用是火山方舟计费调用；失败不留半成品（暂存 TTL 清扫，brand-assets 锁内原子写）。

## Observability

- `generate_image` 返回 `provider_note` + `warnings`；`MEDIA_PROVIDER_ERROR` details 携带 HTTP status 与截断 body（不含凭证）。
- 所有解析/越界/预算失败 fail loud（FormaError 码可定位），无静默兜底。
- 诊断输出仅脱敏元数据（`configured/source/model/base_url/api_key_tail`；env 来源不回显尾号）。
- 画布 stale 徽标由 `asset.brand_style !== product.brand_style` 驱动，可视化过期状态（D11）。
- agent 降级（模型未配置）必须在产出报告中显式注明。

## SPEC Handoff

SPEC 阶段需产出：

1. 按 M0→M5 的文件级改动清单（new/modify，含每文件职责一句话）；core 新增 ~8 / 修改 ~5，mcp/server/web/viewer 各若干，agent 模板 3 平台 ×（2 新命令 + 3 既有修改）+ shared。
2. 四个 MCP 工具的最终入参/返回 schema（`generate_image` / `search_icons` / `save_brand_asset` / `list_brand_assets`，原始文档 §6 已给草案）。
3. server 六条新路由的方法/路径/响应形态。
4. 每里程碑的测试清单（文件名级），含安全硬项：凭证权限/脱敏/排除（M1）、沙箱四类（M3）。
5. 两个 UNCONFIRMED 项的核定步骤与禁则（aspect→size @M1、商店图 preset @M5）。
6. 里程碑收口命令：`pnpm test` + `pnpm typecheck` + 模板/craft 断言。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| DES-ARCH-001 | SCOPE-IN-002, RISK-DEP-001, RISK-DATA-004 | covered |
| DES-ARCH-002 | SCOPE-IN-002, RISK-SEC-003, RISK-DATA-002, RISK-DATA-003 | covered |
| DES-ARCH-003 | SCOPE-IN-002, SCOPE-IN-008, RISK-SEC-001 | covered |
| DES-ARCH-004 | SCOPE-IN-003, RISK-DEP-003 | covered |
| DES-ARCH-005 | SCOPE-IN-004, SCOPE-IN-006, RISK-DATA-004, RISK-PROC-001 | covered |
| DES-ARCH-006 | SCOPE-IN-004, SCOPE-IN-006, SCOPE-IN-008, RISK-SEC-002 | covered |
| DES-ARCH-007 | SCOPE-IN-004, SCOPE-IN-005, SCOPE-IN-006, SCOPE-IN-007, RISK-PROC-002 | covered |
| DES-ARCH-008 | SCOPE-IN-001 | covered |
| DES-ARCH-009 | SCOPE-IN-002, RISK-DEP-002 | covered |

## Upstream Summary (read-only)
# Risk Discovery

## Risks

### RISK-SEC-001 `media-config.yaml` 计费凭证泄露
Status: mitigation_planned（M1 验收硬项）

APIKEY 是计费凭证，可能经 server 静态服务、artifact/brand-assets zip 导出、诊断包、日志或 FormaError details 外泄。缓解：文件 0600 创建/收紧（win32 按平台跳过）；读接口只回脱敏元数据（env 来源连尾号都不回显）；导出/诊断排除测试为 M1 验收硬项；错误 details 不携带 key。

### RISK-SEC-002 `save_brand_asset` HTML 渲染沙箱逃逸
Status: mitigation_planned（M3 验收硬项）

agent 提交的排版 HTML 经 puppeteer 渲染，恶意/出错的 HTML 可能执行脚本、拉远程资源、读白名单外 `file://`。缓解：默认禁脚本；先 localize 再渲染（浏览器层不出现 `forma-image://`）；拦截白名单只放行重写后 bundle 内 `file://` + path-boundary 校验通过的产品预览；`http(s):`、协议相对 URL、越界路径一律 fail loud。测试覆盖脚本拦截/远程拒绝/file 越界拒绝/白名单预览可用四类。

### RISK-SEC-003 `forma-image://` 解析路径越界
Status: mitigation_planned（M1 验收硬项）

staging/brand 引用解析若拼接任意路径可读出仓外文件。缓解：解析全部经现有 `path-boundary.ts` 校验；id 不存在/越界抛 `MEDIA_IMAGE_NOT_FOUND`，整次保存失败。

### RISK-DEP-001 火山方舟 API 形态漂移
Status: open（M1 实现前复核闭环）

模型 ID 下线、endpoint/请求/响应字段变更会使 renderer 失效；文档站 JS 渲染导致自动核验困难。缓解：附录 A 已锁来源 URL + 页面更新时间，M1 实现前必须人工复核官方页面；目录 + renderer 注册表把变化面隔离在单文件；`MEDIA_PROVIDER_ERROR` details 携带 status 与截断 body 便于诊断。

### RISK-DEP-002 生图计费失控
Status: mitigation_planned

agent 重试、count 放大、CI 误调真实 provider 都会产生费用。缓解：`count` 上限 4；自动化测试一律 stub provider 不打外网；`POST /api/media/test` 用最小尺寸单张且仅用户主动触发；真实 key 调用只出现在手动验收。

### RISK-DEP-003 lucide-static 版本漂移
Status: mitigated_by_design

图标集随上游变化导致检索结果不稳定。缓解：`lucide-icons.json` 产物入库（构建不依赖在线源），升级 = 显式重跑 `scripts/vendor-lucide.mjs` + diff 审查；ISC 许可证随附。

### RISK-DATA-001 icon unit 移除破坏旧 artifact
Status: mitigated_by_design

`manifest.forma.productIcon` 本就 optional（`artifact-manifest.ts:225`），旧 artifact 含 icon unit 继续有效，零迁移；`validateArtifactManifest` 对 present 时的 SVG 约束保留。回归测试覆盖旧数据加载。

### RISK-DATA-002 生成图撑爆资产管线预算
Status: mitigated_by_design

2048 母版 + 多张插图可能触及 4MiB HTML / 48MiB 资产 / 200 文件预算。缓解：`forma-image:` 字节并入既有 data: 处理流，走同一降采样（@1x/@2x/@3x）与预算检查，超限 fail loud（含测试）；agent 视检选优后只引用选中图。

### RISK-DATA-003 暂存区垃圾堆积
Status: mitigated_by_design

候选图生成多、消费少。缓解：写入新条目时清扫 >24h 旧条目（沿用 `artifact-tmp-cleanup.ts` 模式）；design-save 消费时拷贝不删源，TTL 兜底。

### RISK-DATA-004 brand-assets 并发写竞争
Status: mitigated_by_design

`saveBrandAsset` 走 `runProductMutation` per-product 文件锁，写在锁内原子完成；生成（`generateProductImage`）不动产品状态故不走锁，避免长任务占锁。

### RISK-PROC-001 UNCONFIRMED 规格被误固化
Status: open（M5 实现前核定闭环）

商店图像素值（iOS/Android/Web OG）与 Seedream aspect→size 映射目前均为占位，禁止直接落表或写入测试。缓解：M1/M5 各自实现前按官方文档核定，preset 表测试必须记录来源 URL 与核实日期。

### RISK-PROC-002 craft 冻结约定被破坏
Status: mitigated_by_design

`craft/` 既有 vendor 文件不可编辑（ATTRIBUTION 冻结）。本批次只新增 `craft/image-prompts.md`，并同步 README 索引与 slug 测试；M0 的 craft 分发走 MCP 返回值新增字段，不改 vendor 文件。

## Boundaries

- core 只保证单次调用结构有效性，不做跨资产存在性校验；前置检测（5.2 矩阵）全部在 agent 模板层，失败 = 停止 + 指引，不静默降级。
- 生成图唯一落盘通路是现有资产管线（design-save → `localizeArtifactAssets`）与 brand-assets 存储；不开第二条通路。
- 渲染/管线只接受本地资源；任何远程引用 fail loud（沿用 `ARTIFACT_REMOTE_RESOURCE` 原则）。
- 自动化测试不打外网、不需要真实 APIKEY、不需要 Pencil CLI；真实 provider 调用只在用户手动验收。
- 提示词归 agent 层（craft 文档 + 模板），core 只透传 prompt 并按 purpose 定默认尺寸。
- od-* 工作区包与本批次无关，不触碰。

## Scope Overflow Risks

- 多 provider 诱惑：实现期顺手加 OpenAI/Gemini renderer——明确推迟，v1 目录仅 volcengine + stub（stub 不进设置 UI）。
- Web 手动生图界面蔓延：Settings 只做厂商/模型/KEY/BaseURL 配置 + 测试连接，不做生成入口。
- ICON 历史版本树、monochrome 变体、i2i 编辑：均已列非范围，出现需求另立批次。
- 画布功能膨胀：品牌资产画布 v1 仅分组展示 + 单下载 + zip 导出，不做编辑/重排。

## Mitigations

汇总：安全三项（SEC-001/002/003）全部转化为里程碑验收硬项（测试名单已写入需求文档 M1/M3 验收段）；外部依赖两项开放风险（DEP-001、PROC-001）以「实现前官方文档复核 + 来源 URL/日期入测试」闭环，Owner 分别为 M1/M5 实现期；其余风险由架构设计直接消解（锁、TTL、optional 字段、产物入库、预算复用），各自有对应测试断言。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| RISK-SEC-001 | SCOPE-IN-002 / SCOPE-IN-008 | mitigation_planned |
| RISK-SEC-002 | SCOPE-IN-004 / SCOPE-IN-008 | mitigation_planned |
| RISK-SEC-003 | SCOPE-IN-002 | mitigation_planned |
| RISK-DEP-001 | SCOPE-IN-002 / Assumptions / Open Questions | open（M1 前复核） |
| RISK-DEP-002 | SCOPE-IN-002 / Acceptance Criteria | mitigation_planned |
| RISK-DEP-003 | SCOPE-IN-003 | mitigated_by_design |
| RISK-DATA-001 | SCOPE-IN-004 / Assumptions | mitigated_by_design |
| RISK-DATA-002 | SCOPE-IN-002 / SCOPE-IN-005 | mitigated_by_design |
| RISK-DATA-003 | SCOPE-IN-002 | mitigated_by_design |
| RISK-DATA-004 | SCOPE-IN-004 | mitigated_by_design |
| RISK-PROC-001 | SCOPE-IN-006 / Open Questions | open（M5 前核定） |
| RISK-PROC-002 | SCOPE-IN-005 / Assumptions | mitigated_by_design |

## Upstream Summary (read-only)
# Requirement Brief

## Goal

为 Forma 接入图片生成能力，解决「LLM 手绘图标/ICON 质量差、无插图/海报/商店图」的痛点。按六个独立可交付、可验证、可回滚的里程碑（M0–M5）实施：媒体基座（火山方舟 Seedream provider + `forma-image://` 暂存引用协议 + 后台图片模型设置）、内置 Lucide 功能图标库、应用 ICON 重构（新命令 fm-app-icon + 移除 LLM 手绘 icon unit + 品牌资产画布）、设计稿插图（fm-design IMAGERY 接入）、营销资产（新命令 fm-brand-assets：商店图 + 海报，HTML 排版合成 + puppeteer 渲染）。原则：移植优于自研（open-design media 管线裁剪）、生成图必须过现有资产管线、文字密集资产走 HTML 排版、全增量零迁移、未配置时显式降级 fail loud。

## In-Scope

- SCOPE-IN-001 **M0 craft 分发缺口修复**（D10）：`get_component_baseline` 返回值新增 `craft_rules` 字段（纯增量）；fm-refine-components / fm-change-style 模板（×3 平台）新增 palette design-read 步骤（色板轮换检查）。
- SCOPE-IN-002 **M1 媒体基座**：新增 `packages/core/src/media/`（`image-models.ts` 目录 / `image-config.ts` 凭证（YAML、env 优先、脱敏、preserve_api_key、409 防误清空、0600 权限含 win32 例外）/ `image-generate.ts` 调度器（renderer 注册表：volcengine + stub）/ `image-staging.ts` 暂存区（TTL >24h 清扫））；资产管线接受可选 `resolveFormaImage` 解析器；MCP 新工具 `generate_image`；server 路由 `GET /api/media/models`、`GET/PUT /api/media/config`、`POST /api/media/test`；web Settings 新增「图片模型」节；新增 6 个 FormaError 错误码（5.5 节）。
- SCOPE-IN-003 **M2 Lucide 图标库**（D1）：`lucide-static` devDependency + `scripts/vendor-lucide.mjs` 生成入库的 `packages/core/assets/lucide-icons.json`（~1500 个）；core 检索服务；MCP 新工具 `search_icons`；模板硬规则「功能图标禁止手绘」（×3 平台）+ shared SKILL.md 自审项。
- SCOPE-IN-004 **M3 应用 ICON 重构**（D5/D6/D8）：`packages/core/src/brand-assets.ts`（manifest、`saveBrandAsset` 走 `runProductMutation` 锁、sharp 多尺寸派生、zip 导出）；MCP 新工具 `save_brand_asset` / `list_brand_assets`；HTML 源渲染沙箱（禁脚本、先 localize 再渲染、白名单拦截、fail loud）；新模板 fm-app-icon（×3 平台）；icon unit 移除五连改（component-baseline spec、fm-refine-components、fm-change-style、fm-design、manifest 零改动）；品牌资产画布 v1（viewer `AssetTile` + web 路由 `#/products/:pid/brand-assets` + server 三条路由）。
- SCOPE-IN-005 **M4 设计稿插图**：新增 `craft/image-prompts.md`（per-purpose 脚手架 + anti-slop 禁则 + 锁色板 + 视检否决清单，同步 craft/README.md 与 slug 测试）；fm-design 模板 IMAGERY 判定（×3 平台，未配置显式降级）；shared SKILL.md 自审项。
- SCOPE-IN-006 **M5 营销资产**（D3/D4）：新模板 fm-brand-assets（×3 平台，商店图 + 海报）；商店图尺寸 preset 表放 core（实现期按官方文档核定，当前值 UNCONFIRMED 禁止落表/落测试）；画布页扩展商店图/海报分组。
- SCOPE-IN-007 **命令前置条件矩阵**（5.2 节）：fm-app-icon / fm-refine-components / fm-design / fm-brand-assets 的前置检测全部在模板层实现，检测失败 = 停止 + 明确指引。
- SCOPE-IN-008 **安全约束**：`media-config.yaml` 计费凭证不得被静态服务/zip 导出/诊断/日志/错误 details 暴露，诊断仅脱敏元数据；渲染沙箱两层防护（引用形态 vs 拦截白名单）。

## Out-of-Scope

- SCOPE-OUT-001 视频/音频生成（od media 管线含视频/音频，本期只裁剪移植 image）。
- SCOPE-OUT-002 i2i 图生图、图片编辑（SeedEdit）；v1 仅 t2i。
- SCOPE-OUT-003 Web 端手动生图界面（生成仅 agent/MCP 驱动；后台只做模型配置 + 连通性测试）。
- SCOPE-OUT-004 fm-change-style 后自动重生成 ICON/营销资产（D11：只标记「可能过期」）。
- SCOPE-OUT-005 标注画布改动（插图随设计稿 bundle 落盘后天然可见）。
- SCOPE-OUT-006 ICON monochrome 单色变体。
- SCOPE-OUT-007 od 异步 task 层（media-tasks / 202+wait 轮询 / byok-tools）。
- SCOPE-OUT-008 生图结果的人脸/版权审核（单用户本地工具，用户视检选优）。

## Non-Goals

- 首发不做多 provider（只接火山方舟 Seedream 一家，D2），但架构保持可扩展（目录加条目 + 注册 renderer）。
- 不做 ICON / 营销资产的历史版本树（v1 覆盖式更新）。
- 不让 agent 传 base64 图片字节过 LLM 上下文（D7：一律 `forma-image://` 引用）。
- core 不内置提示词模板（D9：提示词脚手架放 agent 层 `craft/image-prompts.md`，core 只透传 prompt）。
- core 不做跨资产存在性校验（前置检测全在模板层）。

## Assumptions

- 火山方舟 API 形态以附录 A 为准（2026-06-13 核实：5 个 Seedream 模型 ID、`POST {ark}/api/v3/images/generations`、Bearer + `b64_json`）；M1 实现前必须重新打开官方页面复核，不一致以官方为准。
- sharp、puppeteer、node-html-parser、zip 能力均已在 repo 中（无运行时新 npm 依赖；`lucide-static` 仅 devDependency）。
- `manifest.forma.productIcon` 为 optional（已核实 `packages/core/src/artifact-manifest.ts:225`），icon unit 移除零迁移。
- `craft/` 既有 vendor 文件冻结不可编辑，新增文件允许（需同步 README 索引与 slug 测试）。
- 真实 ARK APIKEY 仅用户手动验收时提供（计费操作，不进 CI）。

## Acceptance Criteria

- 每里程碑收口：`pnpm test` + `pnpm typecheck` 全绿；涉及模板的跑既有模板/craft 断言测试。
- 所有自动化测试不打外网（stub provider + 本地渲染）。
- M0：`get_component_baseline` 返回 `craft_rules` 且含 ai-tells 文档（测试断言）。
- M1：stub provider 覆盖目录校验/凭证优先级/脱敏/409 防清空/暂存 put-resolve-TTL/管线 `forma-image:` 解析（含预算超限、引用缺失 fail loud）/权限创建与收紧（win32 跳过）/导出与诊断排除；手动：真实 key 测试连接成功。
- M2：检索服务测试（命中/空结果/limit）；icons.json 脚本可重生成且 diff 干净；模板禁手绘断言。
- M3：brand-assets 存储测试（锁、尺寸派生、manifest、zip）；渲染沙箱测试（脚本拦截、远程拒绝、file 越界拒绝、白名单预览可用）；`brand/` 命名空间解析测试；手动：真实 key 跑 fm-app-icon 全流程 → 画布可见全尺寸组并可导出。
- M4：craft 新文档 slug 测试；手动：真实 key 跑含插图页 fm-design，插图落 bundle 且预览/标注画布可见。
- M5：preset 表（含来源 URL + 核实日期）与渲染尺寸测试；手动：真实 key 全流程出一套商店图 + 海报并 zip 导出。
- 回滚：任一里程碑回退 = 删除新代码，不触碰存量数据（全增量）。

## Open Questions

- Seedream aspect→size 像素映射的每档值：M1 实现时按火山官方 API 参考（82379/1541523）核定（原则：每档取该模型推荐的最高质量像素值 ≥2K）。Owner：M1 实现。
- 商店图各平台精确规格：当前示例值（iOS 1290×2796 / Android 1080×1920 / Web OG 1200×630）均为 UNCONFIRMED 占位；M5 实现前按 App Store Connect / Google Play / Open Graph 官方文档核定并记录来源 URL 与核实日期。Owner：M5 实现。

## Sources

- `docs/image-generation-requirements.md`（本仓库，commits ce65240 + bd04fc7，2026-06-13 用户审定）— 本 brief 的唯一上游需求。
- open-design 移植源：`~/x-studio/forma2-cankao/open-design/apps/daemon/src/{media-models,media-config,media}.ts`（附录 B 映射）。
- 火山方舟官方文档（附录 A 表）：https://www.volcengine.com/docs/82379/1330310 、/1541523 、/1824121（2026-06-13 复查）。
- taste-skill（GitHub `Leonxlnx/taste-skill`）：纯提示词借鉴，无代码移植。

## Trace
<!-- Map this stage's IDs to upstream/downstream. R3 derives & checks closure. -->
| This ID | Upstream | Status |
|---|---|---|
| SCOPE-IN-001 | 原始文档 §6 M0 / D10 | covered |
| SCOPE-IN-002 | 原始文档 §6 M1 / §5.3 / §5.5 / D2 / D7 | covered |
| SCOPE-IN-003 | 原始文档 §6 M2 / D1 | covered |
| SCOPE-IN-004 | 原始文档 §6 M3 / D5 / D6 / D8 / D11 | covered |
| SCOPE-IN-005 | 原始文档 §6 M4 / D9 | covered |
| SCOPE-IN-006 | 原始文档 §6 M5 / D3 / D4 | covered |
| SCOPE-IN-007 | 原始文档 §5.1 / §5.2 | covered |
| SCOPE-IN-008 | 原始文档 §6 M1 安全约束段 / M3 渲染沙箱段 | covered |
| SCOPE-OUT-001..008 | 原始文档 §4 非范围表（8 项逐一对应） | covered |

## Upstream Summary (read-only)
# Forma 生图能力需求设计文档

- 日期：2026-06-13（v1，待审查）
- 分支：`feat/image-generation`
- 来源：生图能力立项讨论（open-design 媒体管线审查 → taste-skill 借鉴评估 → 7 项开放问题逐项决策 → 顺序死锁修订）
- 状态：方案已决策完备，待用户审查后实施
- 原则：移植优于自研（open-design `apps/daemon` media 管线裁剪）；生成图必须过现有资产管线（不开第二条落盘通路）；文字密集资产走 HTML 排版而非生图直出；全部增量式改动、旧数据零迁移；未配置模型时显式降级、fail loud 不静默兜底。

## 1. 背景与痛点

Forma 当前没有任何图片生成能力。设计相关图像资产的现状：

- **产品 ICON**：fm-refine-components 的 icon unit 由 LLM 手绘 SVG 双变体（`packages/agent/templates/claude/fm-refine-components.md:27`），质量差，商用不可接受。
- **功能图标**：设计稿/组件 HTML 里由 LLM 手绘内联 SVG，质量差、风格不一致。
- **插图/海报/商店图**：完全没有。
- **资产管线**（`packages/core/src/artifact-asset-pipeline.ts`）：只接受 `data:` 内联资源，拒绝远程引用（`ARTIFACT_REMOTE_RESOURCE`），自动降采样 @1x/@2x/@3x，有预算上限（4MiB HTML / 48MiB 资产 / 200 文件）。
- **渲染能力**：`packages/core/src/preview-renderer.ts` 是 puppeteer + viewport 可配，已具备 HTML→任意尺寸 PNG 的能力。
- **后台设置**：`packages/web/src/pages/Settings.tsx` 是 15 行语言切换空壳。

待解决的痛点（立项输入）：

1. 设计稿和组件的图标、ICON 质量差，且无法提供插图、海报、商店图。
2. fm-refine-components / fm-design 产出的组件/设计稿图标残次不齐。
3. 设计稿页面需要插图时无供给。
4. 产品缺商店图、海报。
5. 标注设计稿缺图标/图片资源（注：插图随设计稿 bundle 落盘后标注画布天然可见，本痛点传递性解决，无独立改动）。

## 2. 决策记录（全部已用户拍板）

| # | 决策 | 取代/否决的方案 |
|---|---|---|
| D1 | 功能图标用**内置 Lucide 图标库**（全量 vendor，~1500 个），不走生图 | 生图生成功能图标（24px 线性图标一致性差、不可缩放、不可 token 着色） |
| D2 | Provider **首发只接火山方舟 Seedream 一家**，架构保持多 provider 可扩展；设置交互 = 选厂商 → 选模型 → 填 APIKEY | 首发 4 家（OpenAI/Gemini/火山/自定义）——用户改为渐进接入 |
| D3 | 商店图/海报走 **HTML 排版合成 + puppeteer 渲染**，生图模型只产素材（插画/背景），不产成品 | 纯生图直出（中文文字渲染不可用） |
| D4 | 新增独立命令 **fm-brand-assets**（商店图+海报），不并入 fm-refine-components | 组件库流程顺带生成（多张生图+渲染拖垮主流程、失败面叠加） |
| D5 | **应用 ICON 独立为新命令 fm-app-icon**，用 Seedream 生图（2048 母版 → sharp 多尺寸）。理由：商店图依赖设计稿预览（fm-brand-assets 晚于 fm-design），而设计稿启动页又需要 ICON，ICON 留在 fm-brand-assets 会形成顺序死锁 | 应用 ICON 由 fm-brand-assets 生成（顺序死锁）；从 SVG 导出 raster（SVG 源头是 LLM 手绘，丑的根源在源头） |
| D6 | **fm-refine-components 的 icon unit 整体移除**（LLM 手绘 SVG 产品 ICON 退役）。`manifest.forma.productIcon` 本就 optional（`packages/core/src/artifact-manifest.ts:225`），旧 artifact 零迁移 | 保留 SVG 产品 ICON 作为 UI 内矢量标识 + 双向参照联动（用户否决：源头质量不可救） |
| D7 | 生成图经 **`forma-image://` 暂存引用**进资产管线（LLM 不传 base64），新增 `brand/` 命名空间引用持久品牌资产 | agent 传 base64（上下文爆炸）；绕过管线直接落盘（开第二条通路） |
| D8 | 应用 ICON + 商店图 + 海报在**同一个独立画布页**展示（viewer 新 AssetTile），单资产下载 + zip 全量导出 | 塞进现有 BrandResources 页（该页保留组件库职责不变） |
| D9 | 提示词脚手架放 **agent 层**（`craft/image-prompts.md` 新文件 + 模板步骤），core 只透传 prompt、按 purpose 定默认尺寸。借鉴 taste-skill 的 anti-slop 词表与锁色板规则（taste-skill 生图部分是纯提示词框架，无代码可移植） | core 内置 prompt 模板（提示词迭代不应依赖发版） |
| D10 | **遗留缺口顺手修**（M0）：fm-refine-components 流程拿不到 craft 文档，palette 轮换规则（`craft/ai-tells.md:63`）触达不到色板诞生的流程 | 留作独立后续批次 |
| D11 | fm-change-style 换风格后，应用 ICON / 营销资产在画布**标记「可能过期」**，不自动重生成 | 自动级联重生成（慢、贵、用户不一定想换 ICON） |

## 3. 范围

六个里程碑 M0–M5，各自独立可交付、可验证、可回滚：

- M0：craft 分发缺口修复（D10）
- M1：媒体基座（provider 目录 / 凭证配置 / 生成调度 / 暂存区 / `forma-image:` 管线 / 后台设置）
- M2：Lucide 图标库（D1）
- M3：应用 ICON 重构（fm-app-icon 命令 + icon unit 移除 + 品牌资产画布 v1）
- M4：设计稿插图（fm-design IMAGERY 接入）
- M5：营销资产（fm-brand-assets：商店图 + 海报 + 画布扩展）

全量约 30+ 文件：core 新增 ~8、修改 ~5；mcp/server/web/viewer 各若干；agent 模板 3 平台 ×（2 新命令 + 3 既有命令修改）；测试同步。无新服务、无运行时新 npm 依赖（sharp / puppeteer / node-html-parser / zip 能力已有；`lucide-static` 仅 devDependency）。

## 4. 非范围（明确不做）

| 项 | 不做的理由 |
|---|---|
| 视频/音频生成 | od media 管线含视频/音频，本期只裁剪移植 image |
| i2i 图生图、图片编辑（SeedEdit） | v1 仅 t2i；renderer 接口天然可扩展，等真实需求 |
| Web 端手动生图界面 | 生成仅 agent/MCP 驱动；后台只做模型配置 + 连通性测试 |
| fm-change-style 后自动重生成 ICON/营销资产 | 见 D11，只标记过期 |
| 标注画布改动 | 插图随设计稿 bundle 落盘，标注画布已能渲染 bundle |
| ICON monochrome 单色变体 | 深色水印等场景 v1 不做，等真实需要（生图单色版或图像处理去色均可行） |
| od 异步 task 层（media-tasks / 202+wait 轮询） | Forma 生成由 agent 经 MCP 同步等待，无 UI 轮询需求 |
| 生图结果的人脸/版权审核 | 单用户本地工具，资产由用户视检选优 |

## 5. 总体架构

```
                  后台 Settings「图片模型」节（厂商→模型→APIKEY）
                            │ GET/PUT /api/media/config（脱敏）
                            ▼
              $FORMA_HOME/media-config.yaml ◄── env 变量优先
                            │
 agent 命令                  ▼                packages/core/src/media/
 (fm-app-icon /     MCP generate_image ────► image-generate.ts 调度器
  fm-design /                │               （renderer 注册表：volcengine | stub）
  fm-brand-assets)           │ ◄── { ref: "forma-image://<id>", preview_path }
        │                    ▼      （agent 用 Read 视检候选图）
        │        $FORMA_HOME/data/<pid>/image-staging/<id>.png + <id>.json
        │
        ├─ 设计稿/组件: HTML 里 <img src="forma-image://<id>">
        │     └─► generate_requirement_design / generate_components → design-save
        │           └─► artifact-asset-pipeline 解析 forma-image:
        │                 staging 或 brand-assets 取字节 → 降采样 @1x/@2x/@3x
        │                 → 预算检查 → assets/ 落盘（与 data: 资源同一条管线）
        │
        ├─ 应用 ICON: MCP save_brand_asset(kind=app-icon, image_ref)
        │     └─► 2048 母版 + sharp 按 platform 派生全套尺寸 + favicon
        │
        └─ 商店图/海报: agent 写排版 HTML → MCP save_brand_asset(kind=store-shot|poster, html)
              └─► puppeteer 按目标像素尺寸渲染 PNG
                            │
                            ▼
        $FORMA_HOME/data/products/<pid>/od-project/brand-assets/<kind>/…
                            │
                            ▼
        品牌资产画布页 #/products/:pid/brand-assets
        （AssetTile 分组：应用 ICON 组 / 商店图组 / 海报组；单下载 + zip 全量导出）
```

### 5.1 推荐工作流（无死锁线性顺序）

```
init_product_config → fm-app-icon → fm-refine-components → fm-design → fm-brand-assets
```

### 5.2 命令前置条件矩阵

| 命令 | 选定产品 | init_product_config | 图片模型已配置 | 应用 ICON 已生成 | 有预览的设计稿 |
|---|---|---|---|---|---|
| fm-app-icon | 必须 | 必须 | 必须 | —（自己生成） | 不需要 |
| fm-refine-components | 必须 | 必须 | 不需要 | **硬前置**：缺失则停止并引导跑 fm-app-icon | 不需要 |
| fm-design | 必须 | 必须 | 仅插图页需要 | **条件前置**：页面 spec 涉及 ICON 展示（启动页/登录页/导航品牌位）→ 硬性要求；无关页面 → 提醒一句后放行 | 不需要 |
| fm-brand-assets | 必须 | 必须 | 必须 | **硬前置**（商店图必然展示 ICON） | 商店图必须（要嵌真实页面截图），海报不需要 |

前置检测全部在**模板层**实现（经 `list_brand_assets` / `list_product_artifacts` 查询后判断），core 不做跨资产存在性校验（core 只保证单次调用的结构有效性）。检测失败 = 停止 + 明确指引，不静默降级。

### 5.3 `forma-image://` 引用协议

| 形态 | 后端 | 生命周期 |
|---|---|---|
| `forma-image://<uuid>` | 暂存区 `data/<pid>/image-staging/` | `generate_image` 写入；design-save 消费时拷贝进 bundle（不删源）；写入新条目时顺手清扫 >24h 旧条目（沿用 `artifact-tmp-cleanup.ts` 模式） |
| `forma-image://brand/app-icon` | 品牌资产存储的 ICON 母版 | 持久，随 save_brand_asset 更新 |
| `forma-image://brand/app-icon@<size>` | ICON 指定尺寸派生（如 `@512`） | 同上 |

解析时机：`localizeArtifactAssets`（design-save 入口）。解析失败（id 不存在/越界）抛 `MEDIA_IMAGE_NOT_FOUND`，整次保存失败（fail loud）。解析成功后字节流与 `data:` 资源走完全相同的降采样、预算、manifest 记账逻辑。

### 5.4 存储布局（新增部分）

```
$FORMA_HOME/
├── media-config.yaml                          # 新增：provider 凭证（见 6.M1）
└── data/
    ├── <productId>/
    │   └── image-staging/                     # 新增：生成图暂存
    │       ├── <uuid>.png
    │       └── <uuid>.json                    # { purpose, prompt, model, width, height, created_at }
    └── products/<productId>/od-project/
        └── brand-assets/                      # 新增：持久品牌资产
            ├── manifest.json                  # { assets: [{ kind, name, files, brand_style, model, generated_at }] }
            ├── app-icon/                      # master.png(2048) + icon-1024.png … favicon-16.png
            ├── store-shots/                   # <name>.png（按 platform 预置尺寸）
            └── posters/                       # <name>.png
```

`brand-assets/manifest.json` 每条记录写入生成时的 `brand_style` slug；web 画布以 `asset.brand_style !== product.brand_style` 判定「可能过期」徽标（D11）。

### 5.5 新增 FormaError 错误码

| 码 | 场景 |
|---|---|
| `MEDIA_NOT_CONFIGURED` | 所选 provider 无可用 APIKEY（env 与存储均无） |
| `MEDIA_PROVIDER_ERROR` | provider HTTP 非 2xx / 响应不可解析（details 含 status 与截断 body） |
| `MEDIA_INVALID_INPUT` | 未注册的 model id、model 与 provider 不匹配、非法 aspect/count |
| `MEDIA_IMAGE_NOT_FOUND` | `forma-image://` 引用在暂存区与品牌资产中均不存在 |
| `BRAND_ASSET_INVALID_INPUT` | save_brand_asset 入参非法（未知 kind、html 与 image_ref 二者皆缺/皆给、非法尺寸） |
| `BRAND_ASSET_NOT_FOUND` | list/导出指定的资产不存在 |

## 6. 分里程碑详细设计

### M0 craft 分发缺口修复（D10，独立先行）

**问题**：fm-design 经 `get_design_context` 拿到 craft 规则文档（`fm-design.md:26`），而 fm-refine-components 只调 `get_style`（`fm-refine-components.md:21`），拿不到 craft 文档。palette 轮换规则（`craft/ai-tells.md:63`，反「artisan 默认色板」）只触达了被禁止发明色板的页面流程（`craft/design-read.md:25`），最需要它的组件库（brand tokens 诞生处）反而看不见。

**改动**：

1. `packages/core` + `packages/mcp`：`get_component_baseline` 返回值新增 `craft_rules` 字段（与 `get_design_context` 同源的 craft 文档集），**纯增量字段**，旧调用方不受影响。
2. fm-refine-components 模板（×3 平台）：步骤 5 之后新增「palette design-read」步骤——定义 brand tokens 前按 `craft_rules` 执行色板轮换检查（明确禁止落入 beige/cream + brass/clay/oxblood 默认组合，除非 brand_style tokens 已锁定）。
3. fm-change-style 模板（×3 平台）：同样新增该步骤（换风格 = 重定色板，同样需要）。

**验收**：core/mcp 测试断言 `get_component_baseline` 返回 `craft_rules` 且包含 ai-tells 文档；模板测试（如有模板 lint）通过；`pnpm test` + `pnpm typecheck` 全绿。

### M1 媒体基座

**新增 `packages/core/src/media/`（移植映射见附录 B）：**

1. **`image-models.ts`** — provider/模型目录与类型：

```ts
export type ImageProvider = { id: string; label: string; hint: string;
  defaultBaseUrl?: string; docsUrl?: string };
export type ImageModel = { id: string; label: string; hint: string;
  provider: string; default?: boolean };
```

   v1 目录：provider = `volcengine`（默认 baseUrl `https://ark.cn-beijing.volces.com/api/v3`）+ `stub`（测试用确定性占位，不出现在设置 UI）。模型（已于 2026-06-13 经火山方舟官方文档核实）：

   | Model ID | 说明 |
   |---|---|
   | `doubao-seedream-5-0-260128` | Seedream 5.0，最强（**默认**） |
   | `doubao-seedream-5-0-lite-260128` | 5.0 Lite，快/便宜（迭代期） |
   | `doubao-seedream-4-5-251128` | Seedream 4.5 |
   | `doubao-seedream-4-0-250828` | Seedream 4.0 |
   | `doubao-seedream-3-0-t2i-250415` | Seedream 3.0 文生图 |

   后续扩展一家 provider = 目录加条目 + 注册一个 renderer 函数，调度器不动。

2. **`image-config.ts`** — 凭证配置，存 `$FORMA_HOME/media-config.yaml`：

```yaml
providers:
  volcengine:
    api_key: "…"
    base_url: "https://ark.cn-beijing.volces.com/api/v3"   # 可省，省略用默认
    model: "doubao-seedream-5-0-260128"                     # 当前选用模型
```

   语义照搬 od `media-config.ts`：env 优先（`FORMA_VOLCENGINE_API_KEY` > `ARK_API_KEY` > `VOLCENGINE_API_KEY`）；读接口脱敏（只回 `configured/source/api_key_tail(末4位)/base_url/model`，env 来源连尾巴都不回显）；写接口支持 `preserve_api_key`（UI 改 model 不必重填 key）；空 payload 将清空已有配置时返回 409 拒绝（防误清空），`force=true` 才放行。

   安全约束：`media-config.yaml` 含计费凭证，新建时必须以用户私有权限写入（mode `0600`），更新时保留既有更严格权限；若既有文件权限宽于 `0600`，写入时收紧到 `0600`。该文件不得被 server 静态服务、artifact/brand-assets zip 导出、诊断包、日志或错误 details 暴露；诊断输出仅允许脱敏元数据（`configured/source/model/base_url/api_key_tail`，且 env 来源不回显尾号）。测试覆盖权限创建/收紧、脱敏读取、防误清空和导出/诊断排除。平台例外：Windows 上 Node 忽略 POSIX mode，无 `0600` 语义——权限创建/收紧的实现与测试在 `win32` 按平台跳过（`process.platform` 门控），其余约束（不暴露、脱敏、防误清空）跨平台不变。

3. **`image-generate.ts`** — 生成调度器：校验 model 在目录内且 surface 匹配 → `resolveProviderConfig` 取凭证（无 key 抛 `MEDIA_NOT_CONFIGURED`）→ 按 provider id 查 renderer 注册表 → 执行。v1 renderer：
   - `volcengine`：`POST {baseUrl}/images/generations`，Bearer 鉴权，`{ model, prompt, size, response_format: "b64_json" }`，解析 `data[0].b64_json|url`（参考 od `media.ts:1293-1343`）。aspect→size 映射按火山官方 API 参考（文档 82379/1541523）实现，原则：每档取该模型推荐的最高质量像素值（≥2K）。
   - `stub`：确定性 PNG 字节（含尺寸编码），测试全程不打网络。

4. **`image-staging.ts`** — 暂存区：`put(productId, bytes, meta) → { id, ref, path }`；`resolve(productId, ref) → bytes`（含 `brand/` 命名空间转发到 brand-assets 存储，M3 接入）；路径越界用现有 `path-boundary.ts` 校验；写入时清扫 >24h 旧条目。

**接线：**

- `packages/core/src/errors.ts`：新增 5.5 节错误码。
- `packages/core/src/store.ts`：`createFormaStore` 装配 media 服务，暴露 `generateProductImage(input)`（生成不动产品状态，**不走** `runProductMutation` 锁）。
- `packages/core/src/artifact-asset-pipeline.ts` + `design-save.ts`：管线入口接受可选 `resolveFormaImage` 解析器；HTML 走查时把 `forma-image:` 引用按 5.3 节解析成字节后并入既有 data: 处理流。
- `packages/mcp/src/tools.ts`：新增工具 **`generate_image`**：

```
generate_image(product_id, purpose: "app-icon"|"illustration"|"hero"|"poster-bg"|"store-shot-bg",
               prompt, aspect?: "1:1"|"16:9"|"9:16"|"4:3"|"3:4", count?: 1..4)
→ { images: [{ id, ref, preview_path, width, height }], provider_note, warnings }
```

   `purpose` 只决定默认 aspect 与暂存元数据，prompt 由 agent 全权构造（D9）；`preview_path` 为本地绝对路径，agent 用 Read 视检候选。
- `packages/server`：路由 `GET /api/media/models`、`GET/PUT /api/media/config`、`POST /api/media/test`（用当前配置生成一张最小尺寸图验证连通性，返回 `{ ok, provider_note }` 或错误；用户主动触发，单张计费可接受）。
- `packages/web/src/pages/Settings.tsx`：新增「图片模型」节——厂商下拉（目录驱动，当前仅火山方舟）→ 模型下拉（目录联动）→ APIKEY 输入（已配置显示 `••••` + 末 4 位）→ Base URL（预填默认值可改）→「测试连接」按钮。

**验收**：stub provider 覆盖目录校验/凭证优先级/脱敏/409 防清空/暂存 put-resolve-TTL/管线 forma-image: 解析（含预算超限、引用缺失 fail loud）；server 路由测试；Settings UI 测试；`pnpm test` + `pnpm typecheck`。手动验收：填真实 ARK key → 测试连接成功。

### M2 Lucide 图标库（D1）

1. `lucide-static` 加入根 devDependencies；新增 `scripts/vendor-lucide.mjs`：从 lucide-static 生成 `packages/core/assets/lucide-icons.json`（`name → { svg, tags, categories }`，全量 ~1500 个，~1.5MB，产物入库；升级 Lucide 重跑脚本）。
2. `packages/core`：图标检索服务（名称前缀/子串 + tag 匹配，懒加载 JSON）。
3. `packages/mcp/src/tools.ts`：新增工具 **`search_icons`**：

```
search_icons(query, limit? = 10) → { icons: [{ name, tags, svg }] }
```

4. 模板改造（×3 平台）：fm-design / fm-refine-components 新增硬规则——**功能图标禁止手绘**，必须经 `search_icons` 取 Lucide SVG 内联（`currentColor` 继承 + stroke-width 随 tokens）；shared `SKILL.md` 自审清单增加「功能图标均来自图标库」检查项。

**验收**：检索服务测试（命中/空结果/limit）；MCP 工具测试；icons.json 由脚本可重新生成且 diff 干净；模板含禁手绘规则断言（craft 测试既有模式）。

### M3 应用 ICON 重构（D5/D6/D8）

**3a. brand-assets 存储与 MCP：**

- 新增 `packages/core/src/brand-assets.ts`：manifest 读写、`saveBrandAsset`（**走 `runProductMutation` 锁**）、`listBrandAssets`、zip 导出（复用 `export_artifact` 既有 zip 能力）、app-icon 尺寸派生（sharp：2048 母版 → iOS 1024/180/120、Android 512/192/144/96/72/48、Web 512/192/32/16，按 product.platform 输出对应组 + favicon）。
- `packages/mcp/src/tools.ts` 新增：

```
save_brand_asset(product_id, kind: "app-icon"|"store-shot"|"poster",
                 source: { image_ref? : string, html?: string },   # 二选一：app-icon 用 image_ref；store-shot/poster 用 html
                 name, target?: { width, height } | { preset: string })
→ { kind, name, files: [{ path, width, height }], generated_at }

list_brand_assets(product_id, kind?) → { assets: […含 brand_style 与 stale 判定所需字段] }
```

  `html` 源经 puppeteer 按目标尺寸渲染（复用 preview-renderer 的 file:// bundle 渲染与子资源 fail-loud 逻辑；HTML 内允许 `forma-image://` 引用与产品自身 artifact 预览图的本地引用，同样走解析器，禁远程）。渲染沙箱必须默认禁脚本或拦截脚本执行，并拦截所有子资源请求。分两层表述：`forma-image://` 与产品预览引用属于「HTML 源允许的引用形态」，在**渲染前**由解析器重写为本地 bundle 文件（与 design-save 管线同序：先 localize 再渲染）——浏览器层不会出现 `forma-image://` 请求；拦截层白名单只放行重写后 bundle 目录内的 `file://` 与经 path-boundary 校验通过的产品预览文件。`http(s):`、协议相对 URL、白名单外的任意 `file://`、越界路径和未授权本地资源一律 fail loud。测试覆盖脚本拦截、远程请求拒绝、file 越界拒绝、允许列表预览图可用。

**3b. fm-app-icon 命令（新模板 ×3 平台）：**

流程：确认产品 + 校验 config（platform/brand_style）+ 校验图片模型已配置 → `get_style(brand_style)` 取色板 → 按 `craft/image-prompts.md` 的 app-icon 脚手架构造 prompt（注入品牌色、产品定位；禁文字、禁 mockup 边框、单一主体、居中构图）→ `generate_image(purpose="app-icon", count=3..4)` → Read 逐张视检（按脚手架的否决清单淘汰）→ 选优 → `save_brand_asset(kind="app-icon", image_ref)` → 报告生成尺寸组与画布地址。已有 ICON 时为「更新」语义：明确告知将覆盖并继续（资产无版本树，v1 不做 ICON 历史）。

**3c. icon unit 移除五连改：**

1. `packages/core/src/component-baseline.ts`：baseline spec 去掉 `productIcon` 节（+ 测试）。
2. fm-refine-components 模板（×3）：删 icon unit 步骤与 `product_icon`/SVG `supporting_files` 提交；重构既有库时即使源里有 icon unit 也不再输出；新增 5.2 节硬前置检测。
3. fm-change-style 模板（×3）：废弃 shape 几何复用/recolor 规则；完成后提示「应用 ICON 与营销资产可能过期，可重跑 fm-app-icon / fm-brand-assets」。
4. fm-design 模板（×3）：`fm-design.md:36` 的「复用 componentLibrary.productIcon SVG」改为「经 `list_brand_assets` 确认 ICON 后用 `forma-image://brand/app-icon@<size>` 引用」；新增 5.2 节条件前置检测。
5. manifest/校验零改动（`forma.productIcon` 本就 optional，旧 artifact 含 icon unit 继续有效；`validateArtifactManifest` 对 present 时的 SVG 约束保留，用于旧数据）。

**3d. 品牌资产画布 v1：**

- `packages/viewer`：新增 `AssetTile`（图片瓦片：缩略 + 尺寸标签 + 下载按钮 + stale 徽标）。
- `packages/web`：新路由 `#/products/:pid/brand-assets`（React Flow 画布，v1 仅应用 ICON 分组），入口于产品详情 + BrandResources 页；工具栏「全部导出」。
- `packages/server`：`GET /api/products/:pid/brand-assets`（列表+manifest）、`GET /api/products/:pid/brand-assets/files/*`（path-boundary 校验的文件服务）、`GET /api/products/:pid/brand-assets/export`（zip）。

**验收**：brand-assets 存储测试（锁、尺寸派生、manifest、zip）；MCP 工具测试；管线 `brand/` 命名空间解析测试；viewer/web 组件测试；模板断言更新（含 icon unit 移除后的 fm-refine-components 全集断言）。手动验收：真实 key 跑 fm-app-icon 全流程 → 画布可见全尺寸组并可导出。

### M4 设计稿插图

1. 新增 `craft/image-prompts.md`（craft 冻结只限既有 vendor 文件，新增允许，需同步 `craft/README.md` 索引与 craft 测试 slug 列表）：per-purpose 提示词脚手架（illustration / hero / poster-bg / store-shot-bg / app-icon）+ 借鉴 taste-skill 的 anti-slop 禁则（禁紫蓝渐变、漂浮 blob、generic 套图）+ **锁色板规则**（同一产品的所有生成素材锁定 brand tokens 色板）+ 视检否决清单（文字乱码、肢体/透视崩坏、风格漂移）。
2. fm-design 模板（×3）：Design Read 步骤（既有第 5 步）增加 **IMAGERY 判定**——页面 spec 是否需要插图（空状态/引导页/营销页 hero）；需要且模型已配置 → 走 `generate_image(purpose="illustration"|"hero")` + Read 视检 + `forma-image://` 引用；模型未配置 → 明确降级为现行 CSS/SVG 装饰路线并在产出报告中注明（不静默）。
3. shared `SKILL.md` 自审清单：增加「生成插图已逐张视检且与色板一致」检查项。

**验收**：craft 测试覆盖新文档 slug；模板断言更新；手动验收：真实 key 跑一个含插图页的 fm-design，插图经管线落 bundle 且预览/标注画布可见。

### M5 营销资产（fm-brand-assets，D3/D4）

1. fm-brand-assets 命令（新模板 ×3 平台），范围 = **商店图 + 海报**。流程：确认产品 + 5.2 节前置检测（含 ICON 硬前置；商店图要求至少一个有预览的设计稿，缺失则停止并指引先跑 fm-design）→ 读 brand tokens + 应用 ICON + 设计稿预览图 → 按 platform 生成：
   - **商店图**：尺寸 preset 是 M5 实现期核定项；当前示例值 iOS `1290×2796`（6.7" 竖屏组）、Android Play `1080×1920`、Web OG `1200×630` 均为 **UNCONFIRMED 占位**，禁止直接落表或写入测试。M5 实现前必须按 App Store Connect、Google Play、Open Graph/平台分享图官方文档核定尺寸并在 preset 表测试中记录来源 URL 与核实日期。agent 写排版 HTML（设备框 + 真实页面截图 + 卖点文案 + 品牌色背景，可用 `generate_image(purpose="store-shot-bg")` 产背景素材）→ `save_brand_asset(kind="store-shot", html, preset)`。
   - **海报**：`1080×1920` 竖版（朋友圈/分享场景），HTML 排版 + 生图插画素材 → `save_brand_asset(kind="poster", html, target)`。
2. 画布页扩展商店图/海报两个分组（AssetTile 复用）。
3. 商店图尺寸预设表放 core（`brand-assets.ts`），按 product.platform 给 agent 返回可用 preset 清单（实现时以各商店当时官方规格为准核定像素值，原则：每平台取主力机型/官方推荐尺寸 1–2 档，不求全集）。

**验收**：preset 表与渲染尺寸测试；模板断言；手动验收：真实 key 全流程出一套商店图 + 海报并 zip 导出。

## 7. 测试与验证总则

- 每里程碑收口必跑：`pnpm test` + `pnpm typecheck`；涉及 agent 模板的跑既有模板/craft 断言测试。
- 所有自动化测试 **不打外网**（stub provider + 本地渲染），与现有套件「不需要 Pencil CLI」原则一致。
- 真实 provider 调用仅出现在用户手动验收（计费操作，不进 CI）。
- 单文件调试：`npx vitest run packages/core/tests/<file>.test.ts`。

## 8. 兼容性与回滚

- **零迁移**：旧组件库的 icon unit 与 `manifest.forma.productIcon` 依旧有效（字段 optional）；新生成不再产出。
- **全增量**：`media-config.yaml`、`image-staging/`、`brand-assets/` 均为新文件/目录；任一里程碑回退 = 删除新代码，不触碰存量数据。
- **降级路径**：图片模型未配置时——fm-design 走现行 CSS/SVG 装饰（显式注明）；fm-app-icon / fm-brand-assets 直接停止并指引配置；核心设计管线（无图需求）完全不受影响。
- **外部状态**：唯一外部副作用是调用火山方舟 API（计费）；失败不留半成品（暂存区条目自带 TTL 清扫，brand-assets 写在锁内原子完成）。

## 9. 显式遗留

| 项 | 说明 | Owner |
|---|---|---|
| Seedream aspect→size 像素映射 | 实现时按火山官方 API 参考（82379/1541523）核定每档值 | M1 实现 |
| 商店图各平台精确规格 | 当前 M5 示例值均为 UNCONFIRMED 占位；实现时按各商店/平台当时官方文档核定，并同步来源 URL、核实日期、preset 表与测试 | M5 实现 |
| ICON monochrome 变体 | v1 不做，见非范围 | 后续需求 |
| ICON / 营销资产历史版本 | v1 覆盖式更新，无版本树；若需要回滚历史另立需求 | 后续需求 |
| 更多 provider（OpenAI / Gemini / 自定义兼容端点） | 架构已留位：目录加条目 + 一个 renderer | 后续需求 |

## 附录 A：Seedream 模型核实记录

2026-06-13 经火山方舟官方文档核实：可生图模型为 `doubao-seedream-5-0-260128`、`doubao-seedream-5-0-lite-260128`、`doubao-seedream-4-5-251128`、`doubao-seedream-4-0-250828`、`doubao-seedream-3-0-t2i-250415`；`doubao-seededit-3-0-i2i-250628` 为 i2i 编辑模型，v1 不收录。端点 `POST {ark}/api/v3/images/generations`（OpenAI 形，Bearer + `response_format: b64_json`）。

官方来源入口（2026-06-13 复查；火山文档正文由站点 JS 渲染，以下保留稳定 URL 与页面可见最近更新时间，M1 实现前必须重新打开官方页面核对 model id、endpoint、`response_format`、返回字段和 aspect/size 映射；若与本文不一致，以官方文档为准并同步更新目录与测试）：

| 来源 | URL | 页面可见最近更新时间 | 本文依赖字段 |
|---|---|---|---|
| 模型列表 | https://www.volcengine.com/docs/82379/1330310 | 2026.06.12 11:41:23 | 可用 Seedream/SeedEdit 模型 ID 与模型类别 |
| 图片生成 API | https://www.volcengine.com/docs/82379/1541523 | 2026.06.04 15:34:26 | `images/generations` 端点、鉴权、请求/响应字段、尺寸参数 |
| Seedream 4.0-5.0 教程 | https://www.volcengine.com/docs/82379/1824121 | 2026.06.04 20:43:36 | Seedream 4.0/5.0 文生图模型用法和规格说明 |

## 附录 B：open-design 移植映射

| forma 目标 | od 源（`~/x-studio/forma2-cankao/open-design`） | 取舍 |
|---|---|---|
| `core/src/media/image-models.ts` | `apps/daemon/src/media-models.ts` | 取类型与目录结构；砍视频/音频/21 provider 至 volcengine+stub |
| `core/src/media/image-config.ts` | `apps/daemon/src/media-config.ts` | 取 env 优先/脱敏/preserveApiKey/409 防清空；JSON 改 YAML、砍 OAuth 借用与 alias 机制 |
| `core/src/media/image-generate.ts` | `apps/daemon/src/media.ts`（`generateMedia` 骨架 + `renderVolcengineImage` L1293-1343） | 取调度骨架与火山 renderer；砍其余 renderer、imageRef、composition |
| （不移植） | `media-tasks.ts` / `media-routes.ts` 202+wait / `byok-tools.ts` | 异步任务层无需求；byok 的工具描述措辞可参考 |
| `craft/image-prompts.md` | taste-skill（GitHub `Leonxlnx/taste-skill`：brandkit / imagegen-frontend-*） | 纯提示词借鉴：anti-slop 禁则、锁色板、purpose 模板结构；无代码 |
| 海报 HTML 路线 | `skills/poster-hero/SKILL.md` | 版式结构参考（竖版 1080×1920、上留白/中主题/下信息卡） |
<!-- /r2p-read-only -->

## Project Context (read-only)
# Project Context Pack

- repo_root: `/Users/xubo/x-studio/forma`
- languages: {'TypeScript': 101893, 'JavaScript': 22178}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
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
- languages: {'TypeScript': 101893, 'JavaScript': 22178}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
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
- languages: {'TypeScript': 101893, 'JavaScript': 22178}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
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
- languages: {'TypeScript': 101893, 'JavaScript': 22178}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
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
- languages: {'TypeScript': 101893, 'JavaScript': 22178}
- package_managers: npm
- test_commands: ['npm test']
- entrypoints: ['packages/od-plugin-runtime/src/index.ts', 'packages/vzi-renderer/src/index.ts', 'packages/vzi-renderer/src/types/index.ts', 'packages/vzi-renderer/src/utils/index.ts', 'packages/vzi-renderer/src/components/index.ts', 'packages/vzi-renderer/src/canvaskit/index.ts', 'packages/vzi-renderer/src/canvaskit/renderers/index.ts', 'packages/vzi-renderer/src/canvaskit/fallback/index.ts', 'packages/vzi-renderer/src/canvaskit/converters/index.ts', 'packages/vzi-renderer/src/canvaskit/tile/index.ts', 'packages/vzi-renderer/src/canvaskit/annotations/index.ts', 'packages/od-sidecar/src/index.ts', 'packages/vzi-format/src/index.ts', 'packages/od-contracts/src/index.ts', 'packages/od-contracts/src/plugins/index.ts', 'packages/od-contracts/src/analytics/index.ts', 'packages/core/src/index.ts', 'packages/core/src/quality/index.ts', 'packages/od-diagnostics/src/index.ts', 'packages/od-host/src/index.ts', 'packages/desktop/out/main/index.js', 'packages/desktop/out/preload/index.js', 'packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/server/src/index.ts', 'packages/agent/src/index.ts', 'packages/mcp/src/index.ts', 'packages/cli/src/index.ts', 'packages/od-sidecar-proto/src/index.ts', 'packages/vzi-types/src/index.ts', 'packages/viewer/src/index.ts', 'packages/od-platform/src/index.ts', 'packages/vzi-parser/src/index.ts', 'packages/vzi-parser/src/extractors/index.ts', 'packages/vzi-transformer/src/index.ts', 'packages/vzi-transformer/src/mcp/index.ts']
- config_files: ['scripts/tsconfig.json', 'packages/od-plugin-runtime/tsconfig.json', 'packages/vzi-renderer/tsconfig.json', 'packages/od-sidecar/tsconfig.json', 'packages/vzi-format/tsconfig.json', 'packages/od-contracts/tsconfig.json', 'packages/core/tsconfig.json', 'packages/od-diagnostics/tsconfig.json', 'packages/web/tsconfig.json', 'packages/od-host/tsconfig.json', 'packages/desktop/tsconfig.json', 'packages/server/tsconfig.json', 'packages/agent/tsconfig.json', 'packages/mcp/tsconfig.json', 'packages/cli/tsconfig.json', 'packages/od-sidecar-proto/tsconfig.json', 'packages/vzi-types/tsconfig.json', 'packages/viewer/tsconfig.json', 'packages/od-platform/tsconfig.json', 'packages/vzi-parser/tsconfig.json', 'packages/vzi-transformer/tsconfig.json']
- dependencies (18):
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
  - playwright 1.60.0 (npm, dev)
  - react ^19.2.6 (npm, dev)
  - react-dom ^19.2.6 (npm, dev)
  - tsup ^8.0.0 (npm, dev)
  - tsx ^4.20.0 (npm, dev)
  - typescript ^5.9.0 (npm, dev)
  - vitest ^4.0.7 (npm, dev)
- source_dirs: ['bin', 'craft', 'design-version', 'docs', 'output', 'packages', 'scripts', 'spikes', 'styles']
<!-- /r2p-read-only -->
