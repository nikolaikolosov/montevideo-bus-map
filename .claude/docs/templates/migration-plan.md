# Migration Plan — <current> → <target variant>

> Date: · Owner: migration-specialist · Strategy: strangler-fig | big-bang (justification ADR: )
> Invariant: the system deploys and passes its suite after EVERY step.

## Assumptions

## Safety Net (step zero)
<!-- build health, characterization tests on hotspots, external uptime check -->

## Steps
| # | Step | Precondition | Verification (measurable) | Rollback | Blast radius | Effort | Status |
|---|---|---|---|---|---|---|---|

<!-- a step without a rollback gets split until it has one -->

## Data Migrations (expand-migrate-contract)
| # | Expand | Backfill/dual-write | Parity check (measured) | Contract (cutover) | Rollback window |
|---|---|---|---|---|---|

## Implicit Contract Decisions
| Contract (from dependency map) | Decision (preserve/deprecate/break) | Sign-off |
|---|---|---|

## Risks
