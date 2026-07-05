---
name: release
description: Launch readiness review and first production deploy - checklist-driven, with post-deploy verification and cost actuals check.
---

# /release

Owner: **delivery-manager**; co-signed by **sre-lead** and **platform-lead** (LRR gate).

## Sequence
1. LRR checklist from `.claude/docs/templates/release-checklist.md`: QG passed, IaC applied
   cleanly to staging, pipelines green end-to-end, rollback drilled, SLO dashboards live,
   alerts firing on synthetic breach, runbooks for top failure modes, secrets rotated out of
   any dev exposure, DNS/TLS ready, cost estimate on file.
2. Every unchecked item is a blocker or an explicit user-approved waiver (recorded as DR).
3. Present the deploy plan (what, where, strategy, rollback trigger criteria) and get the
   user's go-ahead before deploying to production.
4. Post-deploy verification: smoke suite against production, SLO dashboard review at +1h,
   error-rate compare vs staging baseline.
5. Cost actuals at +7d vs estimate (cost-analyst); deltas >20% explained in the cost model.

## Output
`docs/release-<version>.md`: checklist state, deploy record, verification results, follow-ups
into the improvement backlog.
