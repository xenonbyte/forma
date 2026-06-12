结论：通过

> 评审类型：增量（delta）评审 · 评审对象：`05-design.md`（r2p_stage: design, version 3）
> 评审人：design 只读子代理 · 2026-06-13
> 基准：v2 全量子代理评审（`reviews/design-subagent-review-v2.md`，结论通过）

## 变更范围确认

v2 → v3 的唯一触发因素是上游 `04-risk-discovery.md` 升至 v2（approved），核对其 Risks 与 Trace 节后确认变更仅为状态归一化：

- 12 项 RISK 的 `Status:` 字面量由 `mitigation_planned` / `mitigated_by_design` → `mitigated`（10 项），`open` → `deferred`（RISK-DEP-001、RISK-PROC-001）；Trace 表 Status 列同步。
- `mitigated` 项在状态行下补一句闭环说明（如「缓解已转化为 M1/M3 验收硬项（见正文）」），`deferred` 项补「延期闭环：…（owner=M1/M5 实现，PLAN 已排首步）」——均为原括注信息的搬移/显化，**缓解正文逐字未变**；Boundaries / Scope Overflow Risks / Mitigations 三节与 v1 完全一致。
- 设计 v3 正文（第 9–124 行：Summary、Evidence、Coverage、DES-ARCH-001..009、Decision Requests=none、Rollback、Observability、SPEC Handoff、Trace）与 v2 评审所引用的全部锚点逐项吻合（含行号范围「正文 9–124」、Trace 9 行映射、SPEC Handoff 6 条），确认设计内容输入未变，v3 仅为上游版本指针刷新后的重产。

## 一致性核查

设计 v3 正文与归一化后的风险状态**无矛盾**：

- **RISK-DEP-001（deferred，owner=M1）**：DES-ARCH-001 原文即写「aspect→size 每档值 M1 实现期按官方文档核定」，SPEC Handoff 第 5 条要求产出核定步骤与禁则——与 deferred 语义（延期闭环、带 owner）严格对应。
- **RISK-PROC-001（deferred，owner=M5）**：DES-ARCH-005 原文即写「像素值 M5 实现期核定（RISK-PROC-001：UNCONFIRMED 值禁止落表/落测试，核定后须记来源 URL + 日期）」——同样对应。
- **10 项 `mitigated`**：设计各 DES-ARCH 承接的缓解元素（0600+脱敏+排除测试、沙箱两层+四类测试、path-boundary、预算复用、TTL、锁语义、optional 字段、产物入库、craft 只增不改）与风险 v2 中保持不变的缓解正文逐项一致；设计 Trace 表对 RISK-* 的映射行（Status 均为 covered）不受状态字面量变化影响。
- 非阻塞观察：`05-design.md` 内嵌的「Upstream Summary (read-only)」快照仍携带 risk v1 旧字面量（`mitigation_planned`/`mitigated_by_design`/`open`）。该节为只读引用，门禁与下游以 `04-risk-discovery.md`（v2）为权威源，不构成正文矛盾；如后续重产设计或进入 reopen，建议顺手刷新该快照以免误读。

## 沿用结论

v2 全量评审（`design-subagent-review-v2.md`，结论：通过）的全部核查在 v3 继续有效：覆盖性（SCOPE-IN-001..008 / 12 项 RISK 承接）、与 `docs/image-generation-requirements.md` D1–D11 的一致性、HEAD=bd04fc7 七项代码证据抽查、决策卫生（Decision Requests=none 成立）、Rollback/Observability 具体性、UNCONFIRMED 纪律合规。其 4 条非阻塞建议（Trace 补 RISK-DATA-001 映射、RISK-DEP-002 承接在 SPEC 显式落地 count 上限等三条、五连改含 core 侧 component-baseline.ts、brand/ 命名空间 M1 行为界定）原样沿用，均归 SPEC 阶段消化，不阻塞本版。
