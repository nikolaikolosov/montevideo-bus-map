---
name: iac
description: Author the infrastructure as code for the chosen variant - modules, environments, secret wiring, plan review. Billable applies wait for the user's go-ahead.
---

# /iac

Owner: **platform-lead**; modules by **iac-engineer**.

## Sequence
1. Preconditions: ARB-approved variant with component-to-service mapping; IaC tool from the
   stack ADR (Terraform default).
2. Module structure in `infra/`: reusable modules + per-environment compositions (local/preview/
   staging/production differ by variables only); remote locked state backend defined.
3. Every resource from the mapping table gets its module; limits/quotas from the platform
   catalog encoded as variables with validation where the tool supports it; least-privilege
   IAM with justification comments; tags/labels for cost attribution.
4. Secrets: platform-native secret store resources; values injected at deploy, never in code
   or state-visible plaintext where avoidable.
5. `plan` and present the summary (add/change/destroy); `apply` to a billable account after
   the user's go-ahead.
6. Drift procedure documented in `infra/README.md`.

## Output
infra/ modules + env compositions; plan summary; approval-pending applies listed; cost tags
confirmed for cost-analyst.
