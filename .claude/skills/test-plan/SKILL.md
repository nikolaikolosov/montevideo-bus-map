---
name: test-plan
description: Build the verification matrix and per-area test plans - every requirement mapped to test/analysis/inspection with quantitative acceptance criteria.
---

# /test-plan

Owner: **qa-lead**; implementation by **test-automation-engineer**.

## Sequence
1. Build `qa/verification-matrix.md` from `product/requirements-spec.md`: every REQ-F/REQ-N →
   verification method (test/analysis/inspection), test level (unit/integration/e2e/load/a11y/
   security), status. Unallocated requirements listed as gaps — the QG gate counts them.
2. Test plans per area in `qa/test-plans/` (template: test-plan.md): scope, environment, data
   strategy, entry/exit criteria, the concrete test list with acceptance thresholds.
3. Non-functional plans explicitly: load (k6 profile from the brief's load numbers), a11y
   (automated + manual keyboard/reader pass), security smoke (scans wired), backup/restore
   drill for the data tier.
4. Coverage targets per `quality_class` from `constraints/slo-policy.yaml` quality section;
   flake policy stated.

## Output
qa/verification-matrix.md (100% allocation is the QG criterion), qa/test-plans/*.md;
gap list with owners.
