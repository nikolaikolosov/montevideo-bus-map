---
name: ci-cd
description: Build the CI/CD pipelines - lint/test/build/scan/deploy stages, release strategy with tested rollback, per-environment gating.
---

# /ci-cd

Owner: **cicd-engineer**; deploy topology with **platform-lead**.

## Sequence
1. Pipeline per the fixed stage list: lint+typecheck → unit/integration → build →
   scan (SAST/deps/secrets) → e2e (placement per test-time budget) → deploy. Pipeline-as-code
   in `infra/pipelines/` or the platform's conventional path.
2. Artifact discipline: build once, version immutably, promote the same artifact through
   environments — never rebuild per env.
3. Deploy gating: PR previews where the platform supports them, staging automatic, production
   behind human approval. Release strategy per the variant (blue/green/canary/rolling) recorded.
4. Rollback: the command/procedure documented AND executed once against staging before LRR —
   an untested rollback is a hope, not a path.
5. Secrets via CI secret store, masked; per-env scoped credentials; fork PRs get no deploy creds.
6. Failure ergonomics: each stage names its owner and the usual fix in its failure message.

## Output
Pipeline definitions; stage timing table; rollback drill result; gaps vs the stage list.
