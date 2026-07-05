---
name: migration-plan
description: Incremental migration plan from the current state to the chosen target architecture - every step with verification and rollback. Adopt track phase A3.
---

# /migration-plan

Owner: **migration-specialist**; target from **lead-architect**'s chosen variant; data steps
with **data-lead**; sequencing sanity by **delivery-manager**.

## Sequence
1. Preconditions: current-state report (A1) + chosen target variant (ARB). Missing → stop.
2. Strategy selection: strangler-fig by default (route/module-level cutover); big-bang requires
   a justification ADR + product-director sign-off.
3. Step list (template: migration-plan.md), each step: precondition, change, verification
   (measurable), rollback, blast radius, effort class. No-rollback steps get split until they
   have one.
4. Data migrations as expand-migrate-contract with parity verification steps (measured
   comparison, not assumption).
5. Implicit contracts from the dependency map: per contract an explicit decision — preserve /
   deprecate with notice / break with sign-off.
6. Shippability invariant: after every step the system deploys and passes its suite. Sequence:
   safety net first (build health, characterization tests on hotspots), then value-ordered.
7. Joins the greenfield track at phase 2 or 3 per the plan; PHASE.md updated accordingly.

## Output
audit/migration-plan.md; step-zero (safety net) ready to execute; risks → risk register;
ARB gate check for A3.
