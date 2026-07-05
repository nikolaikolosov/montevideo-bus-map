---
name: scaffold
description: Generate the project skeleton in app/ and infra/ per the chosen variant and stack - structure, tooling, CI stub, security baseline wired from commit one.
---

# /scaffold

Owner: **frontend-lead** + **backend-lead**; infra stub by **platform-lead**.

## Sequence
1. Preconditions: ARB passed (variant + stack ADRs exist), contracts drafted. Missing → stop.
2. Generate the skeleton in `app/` per the stack ADR: workspace layout (frontend/backend/shared
   as the variant dictates), pinned versions, lockfile, lint+format+typecheck configured and
   passing on the empty skeleton.
3. Security baseline from commit one: .gitignore covers env files, .env.example committed,
   secret-scan hook (gitleaks) configured, dependency audit in the CI stub, security headers
   middleware stubbed per `constraints/security-baseline.yaml`.
4. Test harness runs: one passing example test per layer (unit/integration/e2e stub) so the
   pipeline is green before feature one.
5. CI stub in `infra/pipelines/`: lint → typecheck → test → build → scan, runnable locally.
6. Observability stub: structured logger with the schema, correlation ID middleware.
7. `app/README.md`: setup, run, test commands — verified by executing them.

## Output
Buildable, testable, lintable skeleton; CI stub; verified README. No feature code yet.
