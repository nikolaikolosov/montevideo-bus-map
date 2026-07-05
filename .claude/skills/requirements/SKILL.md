---
name: requirements
description: Derive testable functional and non-functional requirements from the product brief. Feeds the verification matrix.
---

# /requirements

Owner: **product-director**; NFRs with **sre-lead**, **security-lead**, **qa-lead**.

## Sequence
1. From the brief, derive functional requirements per P0/P1 feature: `REQ-F-NNN`, actor +
   behavior + acceptance criterion (testable — exact states, codes, thresholds).
2. Non-functional: `REQ-N-NNN` for performance (latency class per endpoint type from
   `constraints/performance-budgets.yaml`), availability tier (`constraints/slo-policy.yaml`),
   security level (`constraints/security-baseline.yaml`), accessibility level, compliance
   obligations, browser/device matrix.
3. Every requirement traces to a brief item; every P0 brief item has ≥1 requirement — run the
   trace check both ways, list orphans.
4. qa-lead confirms each criterion is verifiable (test/analysis/inspection assignable).

## Output
`product/requirements-spec.md` (template: requirements-spec.md); trace-check results; this file
is the source for `qa/verification-matrix.md` in phase 4.
