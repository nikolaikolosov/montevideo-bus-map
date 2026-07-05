---
name: design-review
description: Run a formal gate review (DG/ARB/DR/CC/QG/LRR) - audit exit criteria with evidence, verdict pass/fail, actions on failure.
---

# /design-review <gate>

Owner: **delivery-manager**; signing directors per the gate definition in
`.claude/docs/workflow-catalog.yaml`.

## Sequence
1. Resolve the gate and its exit criteria from the workflow catalog; identify the signing
   agents (review_mode governs strictness: full = all listed, lean = delivery-manager +
   domain director, solo = checklist only, no sign-offs).
2. Criterion-by-criterion audit: quote the criterion, cite the evidence (file + key numbers),
   verdict met/not-met. Reviewers read the artifacts — claims without artifacts are not-met.
3. Budget snapshot: performance / cost / error budgets green? Red budget = automatic fail
   unless a user-approved waiver DR exists.
4. Verdict: PASS (PHASE.md advances) / CONDITIONAL (named punch-list with owners and a re-check
   date, only for non-blocking gaps) / FAIL (actions assigned; second consecutive FAIL halts
   autonomous mode).
5. Gate summary appended to PHASE.md; decisions to the ratification queue in autonomous mode.

## Output
Gate record in product/gate-reviews/<gate>-vNN.md: criteria table, verdict, signatures
(agent names), punch list.
