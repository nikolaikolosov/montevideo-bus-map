---
name: start
description: Studio onboarding - set project mode (greenfield/adopt), deployment target, quality class, compliance flags, review and operation mode. Run first in every new project.
---

# /start

Owner: **delivery-manager**.

## Sequence
1. Ask project mode: **greenfield** (new app) or **adopt** (existing codebase — ask for path/URL,
   set `existing_codebase`).
2. Ask deployment target (aws | gcp | azure | cloudflare | vercel | kubernetes | vps) or
   "compare" — deferred to /architecture-variants multi-target comparison. Confirm the matching
   `constraints/platforms/<target>.yaml` exists.
3. Ask quality class (prototype | standard | regulated) and compliance flags (gdpr, ccpa,
   pci-dss, hipaa, soc2, none) — explain consequences in one line each.
4. Ask review_mode (full/lean/solo) and operation_mode (supervised/autonomous).
5. Toolchain check: node/npm (or the stack's runtime), git, optionally terraform, k6,
   playwright — report present/missing, offer install commands. Never fake availability.
6. Write choices into CLAUDE.md `studio:` block; create `product/PHASE.md` (phase 0 Discovery or
   A0 Inventory); create empty `product/risk-register.md` from the template.
7. Point to the next step: `/product-brief` (greenfield) or `/adopt` (adopt).

## Output
Updated CLAUDE.md config, product/PHASE.md, product/risk-register.md; toolchain report.
