结论：通过

> 评审对象：`05-design.md`（r2p_stage: design, version 2, HEAD=bd04fc7）
> 评审人：design 只读子代理 · 2026-06-13
> 上游：03-requirement-brief.md（v1 approved）、04-risk-discovery.md（v1 approved）、docs/image-generation-requirements.md（用户审定，权威）

## 覆盖性核查

**SCOPE-IN-001..008 全部有 DES-ARCH 承接**（Requirements Coverage 表 + Trace 表交叉验证）：

| Scope | 承接 | 核查 |
|---|---|---|
| SCOPE-IN-001 (M0) | DES-ARCH-008 | ✅ craft_rules 字段 + palette design-read 步骤，与 brief 一致 |
| SCOPE-IN-002 (M1) | DES-ARCH-001/002/003/009 | ✅ media 目录、forma-image 协议、凭证配置、6 错误码均落位 |
| SCOPE-IN-003 (M2) | DES-ARCH-004 | ✅ vendor 入库 + 检索服务 + search_icons + 禁手绘硬规则 |
| SCOPE-IN-004 (M3) | DES-ARCH-005/006/007 | ✅ 存储/沙箱/画布/fm-app-icon/icon unit 移除均覆盖（见建议 3） |
| SCOPE-IN-005 (M4) | DES-ARCH-007 + 002 | ✅ image-prompts.md + IMAGERY 判定 + 管线接入 |
| SCOPE-IN-006 (M5) | DES-ARCH-005/006/007 | ✅ preset 表 / 画布扩展 / fm-brand-assets |
| SCOPE-IN-007 | DES-ARCH-007 | ✅ 前置检测全在模板层，core 不做跨资产校验 |
| SCOPE-IN-008 | DES-ARCH-003/006 | ✅ 凭证安全 + 渲染沙箱两层防护 |

**RISK-\* 承接**：12 项风险中 11 项在 Trace 表有明确映射且设计正文有对应缓解元素；两项 open 风险（RISK-DEP-001、RISK-PROC-001）均按要求显式带 Owner 延续（DES-ARCH-001「M1 实现期按官方文档核定」、DES-ARCH-005「M5 实现期核定」，SPEC Handoff 第 5 条要求产出核定步骤与禁则）。例外：

- **RISK-DATA-001 未出现在 Trace 表任何 DES-ARCH 行的 Upstream 列**。实质上已被设计覆盖（Current Code Evidence 第 1 条 + Rollback「零迁移：optional + present 时校验保留」），不构成设计缺陷，但 Trace 是 R3 闭环推导的输入，漏映射可能在下游被判为未闭环。见建议 1（非阻塞）。
- RISK-DEP-002 映射到 DES-ARCH-009 偏弱，见建议 2（非阻塞）。

## 一致性核查

与权威需求文档 `docs/image-generation-requirements.md` 逐项对照，**无矛盾**：

- **D1–D11**：全部遵循且未重开——D1 Lucide（DES-ARCH-004）、D2 仅 volcengine+stub 且 stub 不进 UI（DES-ARCH-001）、D3 HTML 排版+puppeteer（DES-ARCH-006）、D4/D5 独立命令 fm-brand-assets / fm-app-icon（DES-ARCH-007）、D6 icon unit 移除+零迁移（DES-ARCH-007 + Rollback）、D7 forma-image:// 两命名空间（DES-ARCH-002）、D8 独立画布页 AssetTile（DES-ARCH-006）、D9 提示词归 agent 层（DES-ARCH-007，core 只透传）、D10 M0（DES-ARCH-008）、D11 stale 徽标不自动重生成（DES-ARCH-005 brand_style slug + Observability）。Options Considered 明确「不重开任何已决项」，与原始文档 §2 否决列一致。
- **M0–M5**：六里程碑严格增量、互相独立可回滚，与 §3/§6 一致；各 DES-ARCH 与 §6 对应里程碑的细节（env 优先级三档顺序、0600+win32 跳过、preserve_api_key、409 force、先 localize 再渲染、白名单四类 fail loud、search_icons limit?=10、2048 母版 sharp 派生）逐项核对一致。
- **§5 架构**：解析时机 localizeArtifactAssets、消费拷贝不删源+TTL 兜底、brand-assets 存储路径 `data/products/<pid>/od-project/brand-assets/{manifest.json,app-icon,store-shots,posters}`、6 个错误码名称与场景，均与 §5.3/§5.4/§5.5 一致。
- **安全约束（M1/M3）**：DES-ARCH-003 与 §6 M1 安全段逐句对应（不被静态服务/zip/诊断/日志/错误 details 暴露、env 来源不回显尾号）；DES-ARCH-006 与 §6 M3 沙箱段一致（默认禁脚本、两层表述、http(s)/协议相对/越界 fail loud、测试四类）。
- **锁语义**：saveBrandAsset 走 runProductMutation、generateProductImage 不走锁——与原始文档 M1 接线和 RISK-DATA-004 一致。

## 代码证据抽查

于 HEAD=bd04fc7（`git rev-parse` 验证，工作树 clean）只读复核，与设计「Current Code Evidence」声称的基线一致：

1. **确认** `packages/core/src/artifact-manifest.ts:116` — `productIcon?: ArtifactProductIcon`（optional）；`:225-238` 注释及实现明确「optional; when present, ... must be valid」，present 时才校验 SVG 路径。icon unit 移除零迁移的前提成立。
2. **确认** `packages/agent/templates/claude/fm-design.md:26` — 第 4 步调用 `get_design_context(...)` 且返回值含 craft rules；`fm-refine-components.md:21` — 第 4 步只调 `get_style(brand_style)`，全文无 `get_design_context`。M0 缺口属实。另确认 `fm-refine-components.md:22` 已调用 `get_component_baseline`，craft_rules 增量字段有现成接线点。
3. **确认** `packages/core/src/` 下六个复用基座文件全部存在：`path-boundary.ts`、`artifact-tmp-cleanup.ts`、`product-mutation-lock.ts`、`preview-renderer.ts`、`artifact-asset-pipeline.ts`、`design-save.ts`。
4. **确认** `packages/web/src/pages/Settings.tsx` — 15 行，仅语言切换（LanguageSwitcher）空壳，「图片模型」节为纯新增。
5. **确认** `craft/ai-tells.md:63-68` — Premium-consumer palette rotation 规则存在（反 beige/cream + brass/clay/oxblood 默认色板），且该文档当前不经 fm-refine-components 流程分发。
6. **确认** `fm-design.md:36` — 「reuse the product ICON SVG from `componentLibrary.productIcon`」原文存在，DES-ARCH-007 计划替换的锚点准确。
7. **确认** `packages/agent/templates/` 含 `claude/codex/gemini/shared` 四目录，「×3 平台 + shared」结构成立。

抽查 7 项全部确认，无不符项。

## 决策卫生

Decision Requests = `none` **成立**：

- 逐条扫描 DES-ARCH-001..009，所有架构选择均能回溯到用户已拍板的 D1–D11 或原始文档 §5/§6 的既有规定（如 `generateProductImage` 不走锁来自 §6 M1 接线原文；stub 不进 UI 来自风险阶段 Scope Overflow 约定；React Flow 画布来自 §6 M3 3d）。
- Options Considered 仅复述需求阶段已裁决的否决项，未引入新备选、未重开已决项。
- 两个延后核定项（aspect→size、商店图 preset）属于「实现期按官方文档核定」的执行动作，不是需要人工裁决的新决策，且已带 Owner。

## Rollback / Observability 具体性

- **Rollback**：非占位。逐项列出新文件/新字段（media-config.yaml、image-staging/、brand-assets/、lucide-icons.json、新工具/路由/模板），回退语义=revert 删新代码不碰存量；零迁移依据（optional 字段）有代码证据；外部副作用（计费）与半成品防护（TTL+锁内原子写）均点名。
- **Observability**：非占位。provider_note/warnings、MEDIA_PROVIDER_ERROR details（status+截断 body 且不含 key）、fail loud 错误码可定位、诊断脱敏元数据白名单、stale 徽标驱动条件、agent 降级必须显式注明——条条可验证。

## UNCONFIRMED 纪律

**合规**。设计正文（第 9–124 行）零处把两个 UNCONFIRMED 项写成确定值：

- Seedream aspect→size：DES-ARCH-001 仅写「每档值 M1 实现期按官方文档核定」，未给任何具体映射值。
- 商店图像素 preset：DES-ARCH-005 仅写「像素值 M5 实现期核定（RISK-PROC-001：UNCONFIRMED 值禁止落表/落测试，核定后须记来源 URL + 日期）」，未给任何具体像素值。
- SPEC Handoff 第 5 条显式要求产出「两个 UNCONFIRMED 项的核定步骤与禁则」。
- 文末出现的示例值（iOS 1290×2796 等）均位于 `<!-- r2p-read-only -->` 的上游摘要引用内，且原文自带「UNCONFIRMED 占位，禁止直接落表或写入测试」标注，不构成违规。

## 建议（非阻塞）

1. **Trace 表补 RISK-DATA-001 映射**：建议在 DES-ARCH-007 行（icon unit 移除）的 Upstream 列追加 `RISK-DATA-001`，或在 Trace 表外加一行说明「RISK-DATA-001 由 Rollback 零迁移段消解」。否则 R3 从 Trace 推导闭环时该风险无承接行，可能被误判为漏项。
2. **RISK-DEP-002（计费失控）的承接显式化**：当前映射到 DES-ARCH-009（错误码与降级），但该风险的实际缓解（`count` 上限 4、`POST /api/media/test` 最小尺寸单张、自动化测试 stub-only 不打外网）只存在于上游文档与验收标准，设计正文未复述。SPEC 阶段应在 `generate_image` schema（count: 1..4）与每里程碑测试清单中显式落地这三条，避免实现期遗漏。
3. **icon unit 五连改第 1 项（core 侧）点名**：原始文档 §6 M3 3c.1 的 `packages/core/src/component-baseline.ts` 去 productIcon 节属于 core 修改，而 DES-ARCH-007 表述聚焦模板层；SPEC Handoff 第 1 条的文件级清单务必包含该文件（含测试），不要只从模板侧理解五连改。
4. **`forma-image://brand/app-icon@<size>` 的解析归属**：DES-ARCH-001 把 `resolve` 放在 image-staging.ts（含 brand/ 命名空间转发，M3 接入），DES-ARCH-002 又把 brand 命名空间列为协议形态——建议 SPEC 明确 M1 阶段 brand/ 引用的行为（未接入时应抛 `MEDIA_IMAGE_NOT_FOUND` 而非静默），保证 M1/M3 边界测试可写。
