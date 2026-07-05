---
name: agent-loop
description: Autonomous mode driver - run the studio phase-by-phase through plan/execute/decide/review/journal/gate-check iterations until a target gate, with all decisions queued for human ratification.
---

# /agent-loop [until <gate>]

Owner: **delivery-manager**. Requires `operation_mode: autonomous` (offer /studio-mode if not).

## Loop iteration
1. **Plan** — read PHASE.md + workflow catalog; pick the highest-value open item in the current
   phase; state the plan in one paragraph in `product/loop-journal.md`.
2. **Execute** — delegate to owning agents (parallel subagents where tasks are independent).
3. **Decide** — the responsible director makes binding calls within guardrails; each logged to
   `product/ratification-queue.md` as `AUTONOMOUS — pending human ratification`.
4. **Review** — a different director reviews the output against exit criteria; failures loop back once.
5. **Journal** — append: iteration, actions, decisions, files touched, budget status.
6. **Gate check** — if phase exit criteria met, run the gate; on pass, advance PHASE.md.

## Pause conditions (summarize for the user)
Target gate reached; critical security finding; any budget red without a waiver; the same gate
failed twice; any outward-facing action (cloud deploy, purchase, publishing);
a genuinely user-level decision (product identity, spend commitment).

## Output
Journal + ratification queue updated every iteration; final summary: gates passed, decisions
pending ratification, blockers.
