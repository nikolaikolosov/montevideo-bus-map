---
name: product-brief
description: Define the product - target users, jobs-to-be-done, success metrics, scope tiers, load profile, constraints. Phase 0 anchor document.
---

# /product-brief

Owner: **product-director**; NFR quantification with **lead-architect** and **sre-lead**.

## Sequence
1. Interview the user (or parse their input): who is it for, what job does it do, what does
   success look like, what exists today, budget/time constraints.
2. Fill `.claude/docs/templates/product-brief.md`: users/personas, jobs-to-be-done, success
   metrics (quantitative), P0/P1/P2 feature tiers, non-goals (explicit!).
3. Quantify the load profile: expected users, peak RPS class, data volume class, growth
   assumption — these numbers drive the architecture and cost work; mark them as assumptions
   with confidence.
4. Capture constraints: deployment target preference, compliance flags, team skills (who will
   maintain this?), budget ceiling.
5. Per operation_mode: user approves the brief; it freezes at the DG gate (changes after DG go
   through decision records).

## Output
`product/00-product-brief.md`; open questions listed at the bottom; risks seeded into
`product/risk-register.md`.
