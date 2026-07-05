---
name: threat-model
description: STRIDE threat model over every externally reachable interface, trust boundary, and PII store, with assigned mitigations. Required before Build.
---

# /threat-model

Owner: **security-lead**; integration surfaces with **integration-specialist**; data stores
with **data-lead**.

## Sequence
1. Draw the trust-boundary diagram (Mermaid): clients, edge, services, stores, third parties,
   admin surfaces. Every arrow is a data flow with its auth mechanism labeled.
2. Enumerate assets (credentials, PII fields from the data model, business-critical data) and
   entry points (every contract operation, webhook, admin path, file upload).
3. STRIDE pass per boundary/entry point: threats with realistic attacker stories (not
   theoretical checkbox filling); severity via impact × likelihood.
4. Mitigations mapped to `constraints/security-baseline.yaml` controls where they exist; each
   mitigation gets an owner and a phase (design/build/verify); accepted risks require user
   sign-off recorded as a DR.
5. Webhooks/integrations: signature verification, replay handling, dead-letter — mandatory rows.

## Output
`security/threat-model.md` (template: threat-model.md); mitigation table with owners; DR gate
blocked until every externally reachable interface is covered.
