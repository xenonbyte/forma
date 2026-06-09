# Plan Subagent Review (v3 — diff verification)

## Verdict
APPROVE — The v2 MAJOR is fully resolved: PLAN-TASK-002/-007/-008/-009/-010 now list the codex `<cmd>/SKILL.md` and gemini `<cmd>.toml` siblings alongside each `claude/<cmd>.md`, every added path exists on disk, and numbering/coverage/structure are intact with no new issue.

## Major-finding resolution
Resolved. Each "三平台同改" task now carries its codex+gemini siblings in `Files:` (grep on 07-plan.md, line numbers in parens):
- **PLAN-TASK-002** (B1, three commands) — `codex/fm-design/SKILL.md` (64) + `gemini/fm-design.toml` (65); `codex/fm-refine-components/SKILL.md` (67) + `gemini/fm-refine-components.toml` (68); `codex/fm-change-style/SKILL.md` (70) + `gemini/fm-change-style.toml` (71). All three claude templates now paired.
- **PLAN-TASK-007** (fm-refine-components) — `codex/fm-refine-components/SKILL.md` (188) + `gemini/fm-refine-components.toml` (189).
- **PLAN-TASK-008** (fm-change-style) — `codex/fm-change-style/SKILL.md` (207) + `gemini/fm-change-style.toml` (208).
- **PLAN-TASK-009** (fm-design) — `codex/fm-design/SKILL.md` (232) + `gemini/fm-design.toml` (233).
- **PLAN-TASK-010** (R3 下沉, fm-design + fm-refine-components) — `codex/fm-design/SKILL.md` (259) + `gemini/fm-design.toml` (260); `codex/fm-refine-components/SKILL.md` (262) + `gemini/fm-refine-components.toml` (263).

The edit also (correctly) added the codex/gemini delete-targets in **PLAN-TASK-001** for the two removed commands: `codex/fm-develop-design-handoff/SKILL.md` (21) + `gemini/fm-develop-design-handoff.toml` (22); `codex/fm-rollback-design/SKILL.md` (24) + `gemini/fm-rollback-design.toml` (25).

**ls-verify of every added codex/gemini path — all EXIST** (these are modify/delete targets, so existence is required; none missing → no blocker):
```
EXISTS  codex/fm-develop-design-handoff/SKILL.md   EXISTS  gemini/fm-develop-design-handoff.toml
EXISTS  codex/fm-rollback-design/SKILL.md           EXISTS  gemini/fm-rollback-design.toml
EXISTS  codex/fm-design/SKILL.md                     EXISTS  gemini/fm-design.toml
EXISTS  codex/fm-refine-components/SKILL.md          EXISTS  gemini/fm-refine-components.toml
EXISTS  codex/fm-change-style/SKILL.md               EXISTS  gemini/fm-change-style.toml
```
(All under `packages/agent/templates/`. The codex/gemini/claude dirs each hold the full 8-command set, confirming the sibling-path convention.)

## Regression check
- **Numbering**: contiguous PLAN-TASK-001..017, 17 task headers, no gap/duplicate.
- **Coverage unchanged** — the edit only added `Files:` lines, removed nothing:
  - SPEC IDs: 21/21 distinct still consumed via `Spec References:` (SPEC-BEHAVIOR-001..015 + SPEC-DATA-001..006).
  - SCOPE-IN: 16/16 distinct still closed via "关闭 SCOPE-IN-xxx" (001..016).
- **No duplicate/broken structure**: zero intra-task duplicate paths. Cross-task path repeats (e.g. `claude|codex|gemini/fm-design`, `shared/SKILL.md`, `store.ts`, `tools.ts`, `DesignView.tsx`, `routes.tsx`, `i18n.ts`, `design-commands.test.ts`) are all legitimate shared-file touches across sequenced tasks (B-batch vs R3 vs guard; T013 vs T015 DesignView merge), not accidental dups. Task blocks (Spec References / Change Type / TDD / Files / Skeleton / Steps / Verification) remain well-formed.
- **v2 minor/nits unchanged and still acceptable**:
  - (minor) stale DesignView line range — still covered by SPEC "按现网复核行号"; untouched.
  - (nit) T016/T017 split — confirmed intact: T016 Files = `BrandResources.tsx` + `brandResourcesMapper.ts` + `BrandResources.test.tsx`; T017 Files = `ProductDetail.tsx` + `routes.tsx` + `i18n.ts`. Clean page/mapper vs entry/route/i18n split.
  - (nit) T006 design-context coverage folded into `mcp/tests/tools.test.ts` — unchanged, optional.
  - T011 remains correctly gemini-only (`gemini/fm-design.toml`) — it is the R2 补段 task for the single platform missing the `Scope fidelity` section; adding siblings here would be wrong. No regression.

## Residual
- **[nit, pre-existing, non-blocking]** PLAN-TASK-001's Steps say "fm-list-product 三平台模板删删除分支," but its `Files:` lists only `claude/fm-list-product.md` (line 31); the existing `codex/fm-list-product/SKILL.md` and `gemini/fm-list-product.toml` siblings are not listed. This is the same under-specification class as the v2 MAJOR but on a task v2 did not enumerate, so it falls outside the v3 fix scope. Not a blocker: both sibling paths EXIST (no missing-path), and the T012 parity guard locks fm-list-product across all three platforms at the end of the chain. Optional follow-up: add the two siblings to T001's `Files:` for symmetry, or rely on the "三平台同改" convention + T012 guard. Everything the revision was asked to fix is done.
