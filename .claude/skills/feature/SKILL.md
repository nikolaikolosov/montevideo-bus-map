---
name: feature
description: Implement one feature end-to-end - contract check, backend, frontend, tests, budgets - under path rules. The Phase 3 workhorse.
---

# /feature <name>

Owner: **frontend-lead** / **backend-lead** per surface; specialists delegated as needed.

## Sequence
1. Locate the feature: requirement IDs, user flow, contract operations, components from the
   inventory. Any of these missing → back to the owning phase-2 skill (no spec, no code).
2. Backend first or parallel: domain logic + endpoint(s) per the contract (validation, authz,
   error shape), migration via db-engineer if the schema changes, integration tests against the
   contract.
3. Frontend: components per the inventory (all states, tokens only, a11y attributes), data
   fetching wired to the contract's typed client, component tests.
4. e2e for the P0 path of the feature (test-automation-engineer).
5. Budget check: bundle delta, endpoint latency smoke, a11y quick pass (axe) — regressions
   block completion.
6. Definition of done: requirement IDs covered by tests, lint/typecheck/tests green, no
   contract drift, feature listed in `product/PHASE.md` progress.

## Output
Working feature with tests; files touched listed; budget deltas; any ADR-worthy deviations
routed to lead-architect instead of being silently coded.
