# Workflow Run: WF-20260606-forma-ui-html-stitch-html

## Status
closed_at_plan_checkpoint

## Current Stage
closed

## r2p Version
0.4.0

## Tier Lock
base: standard
modifiers: cross_project

## Tier Estimate
base: standard
modifiers: cross_project

## Approved Checkpoints
| Stage | Artifact | Version | Approved At | Downstream Authorization | Bundle ID |
|---|---|---|---|---|---|
| raw_requirement | 00-raw-requirement.md | 1 | 2026-06-06T09:15:10.361349+00:00 | requirement_brief |  |
| requirement_brief | 03-requirement-brief.md | 1 | 2026-06-06T09:26:04.565628+00:00 | risk_discovery |  |
| risk_discovery | 04-risk-discovery.md | 3 | 2026-06-06T10:15:58.956742+00:00 | design |  |
| design | 05-design.md | 4 | 2026-06-06T10:18:31.913302+00:00 | spec |  |
| spec | 06-spec.md | 5 | 2026-06-06T10:20:01.007318+00:00 | plan |  |
| plan | 07-plan.md | 3 | 2026-06-06T10:36:05.348104+00:00 | close_workflow_run |  |

## Bundle Authorizations
| Bundle ID | Stages | Authorized At | Revoked At | Consumed Stages |
|---|---|---|---|---|

## Active Artifacts
| Stage | Artifact | Version | Status |
|---|---|---|---|
| raw_requirement | 00-raw-requirement.md | 1 | approved |
| requirement_brief | 03-requirement-brief.md | 1 | approved |
| risk_discovery | 04-risk-discovery.md | 3 | approved |
| design | 05-design.md | 4 | approved |
| spec | 06-spec.md | 5 | approved |
| plan | 07-plan.md | 3 | approved |

## Stale / Superseded Artifacts
| Artifact | Reason | Replaced By | Required Action |
|---|---|---|---|
| 04-risk-discovery.md | upstream gap at risk_discovery | (pending re-derivation) | R-1 |
| 05-design.md | upstream gap at risk_discovery | (pending re-derivation) | R-1 |
| 06-spec.md | upstream gap at risk_discovery | (pending re-derivation) | R-1 |
| 07-plan.md | upstream gap at risk_discovery | (pending re-derivation) | R-1 |

## Open Routes
| Route ID | From Stage | Owner Stage | Required Action | Status |
|---|---|---|---|---|
| R-1 | plan | risk_discovery | 将各 RISK-* 块的 Status 行更新为闭合词表（mitigated/deferred/out_of_scope）：设计与 SPEC 已落实对应缓解（MIT-001..006 → DES/SPEC/PLAN 任务），PLAN 门要求风险闭合 | repaired |

## User Confirmations
| Confirmation | Stage | Source | Recorded In |
|---|---|---|---|

## Resume Context
| Field | Value |
|---|---|
| Last Completed Operation | close_at_plan_checkpoint |
| Next Allowed Operation | run_close |
| Active Item | plan |
| Required Reread Targets |  |
| Resume Reason | owner repaired for R-1; resume checkpoint approval |

## Reopen Lineage
(none)
