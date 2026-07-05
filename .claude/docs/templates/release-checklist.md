# Release Checklist (LRR) — <version>

> Date: · Owner: delivery-manager · Co-sign: sre-lead, platform-lead
> Unchecked item = blocker or user-approved waiver (DR ref in the Note column).

| # | Item | Evidence | Status | Note |
|---|---|---|---|---|
| 1 | QG gate passed | product/gate-reviews/ | ☐ | |
| 2 | IaC applies cleanly to staging | plan/apply log | ☐ | |
| 3 | Pipeline green end-to-end (build+test+scan+deploy) | run link/log | ☐ | |
| 4 | Rollback drilled on staging | drill record | ☐ | |
| 5 | SLO dashboards live, metrics flowing | dashboard | ☐ | |
| 6 | Alerts fire on synthetic breach | test record | ☐ | |
| 7 | Runbooks for top failure modes | docs/runbooks/ | ☐ | |
| 8 | Secrets: prod values only in secret store, rotated from dev exposure | check record | ☐ | |
| 9 | DNS/TLS ready (cert issuance, HSTS) | check record | ☐ | |
| 10 | Cost estimate on file; billing alerts set | architecture/cost-model.md | ☐ | |
| 11 | Backup + restore drill (data tier) | drill record | ☐ | |
| 12 | Compliance obligations verified (if flags set) | compliance map | ☐ | |

## Deploy Plan
<!-- what, where, strategy (blue/green/canary/rolling), rollback trigger criteria -->
Production deploy goes ahead on the user's approval.

## Post-deploy
- [ ] Smoke suite vs production
- [ ] SLO dashboard review at +1h
- [ ] Cost actuals vs estimate at +7d
