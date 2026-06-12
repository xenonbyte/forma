# Workflow Run: WF-20260613-forma-2026-06-13-v1

## Status
closed_at_plan_checkpoint

## Current Stage
closed

## r2p Version
0.4.4

## Tier Lock
base: standard
modifiers: cross_project, dependency, migration, safety, scope_expanding

## Tier Estimate
base: standard
modifiers: cross_project, dependency, migration, safety, scope_expanding

## Approved Checkpoints
| Stage | Artifact | Version | Approved At | Downstream Authorization | Bundle ID |
|---|---|---|---|---|---|
| raw_requirement | 00-raw-requirement.md | 1 | 2026-06-12T19:05:52.290790+00:00 | requirement_brief |  |
| requirement_brief | 03-requirement-brief.md | 1 | 2026-06-12T19:07:39.243511+00:00 | risk_discovery |  |
| risk_discovery | 04-risk-discovery.md | 2 | 2026-06-12T19:40:11.533382+00:00 | design |  |
| design | 05-design.md | 3 | 2026-06-12T19:43:04.197577+00:00 | spec |  |
| spec | 06-spec.md | 5 | 2026-06-12T19:46:36.797938+00:00 | plan |  |
| plan | 07-plan.md | 2 | 2026-06-12T19:52:39.484523+00:00 | close_workflow_run |  |

## Bundle Authorizations
| Bundle ID | Stages | Authorized At | Revoked At | Consumed Stages |
|---|---|---|---|---|

## Active Artifacts
| Stage | Artifact | Version | Status |
|---|---|---|---|
| raw_requirement | 00-raw-requirement.md | 1 | approved |
| requirement_brief | 03-requirement-brief.md | 1 | approved |
| risk_discovery | 04-risk-discovery.md | 2 | approved |
| design | 05-design.md | 3 | approved |
| spec | 06-spec.md | 5 | approved |
| plan | 07-plan.md | 2 | approved |

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
| R-1 | plan | risk_discovery | 将 12 个 RISK 块的 Status 行改为门禁可识别的字面值：mitigated（设计/计划内已有缓解与测试承接）或 deferred（RISK-DEP-001 延至 M1 复核、RISK-PROC-001 延至 M5 核定），保持正文缓解描述不变 | repaired |

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
