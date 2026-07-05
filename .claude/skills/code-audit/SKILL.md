---
name: code-audit
description: Document the existing implementation as it IS - architecture, data flows, interfaces, implicit contracts, security and test state. Zero recommendations here. Adopt track phase A1.
---

# /code-audit

Owner: **adoption-lead**; deep analysis by **code-archaeologist**; security pass by
**security-lead**; data by **data-lead**; test state by **qa-lead**.

## Sequence
1. Precondition: `audit/inventory.md` exists (else run /adopt). Read-only rule holds.
2. Current-state report (`.claude/docs/templates/current-state-report.md`) — documents reality,
   including the ugly, WITHOUT recommendations (those belong to A2):
   - Architecture as-is: components, boundaries (real ones, not aspirational), Mermaid diagram.
   - External interfaces: every reachable endpoint/page/webhook/cron with auth mechanism.
   - Data: stores, schemas (reverse-engineered), flows, PII locations.
   - Implicit contracts: undocumented consumers, magic env vars, shared-DB integrations,
     file-drop interfaces — the migration killers.
   - Dependency map + hotspots (churn × complexity top-10).
   - Security state: exposed surfaces, secrets in history (gitleaks), dependency CVE counts.
   - Test/ops state: coverage reality, CI health, deploy procedure as practiced.
3. Every claim → file:line or command output. Known-unknowns section mandatory.
4. docs-lead consistency check: this report seeds the future docs package.

## Output
audit/current-state-report.md, audit/dependency-map.md; A1 exit criteria check; next:
/improvement-backlog.
