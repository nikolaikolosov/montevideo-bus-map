---
name: help
description: Show the studio pipeline, available skills per phase, current phase status, and what to run next.
---

# /help

1. Read `product/PHASE.md` (if missing: suggest /start) and `.claude/docs/workflow-catalog.yaml`.
2. Render the pipeline as a table: phase, goal (one line), key skills, gate — mark the current
   phase and completed gates.
3. In adopt mode, render the adopt track (A0-A3) and where it joins the greenfield track.
4. Show config summary from CLAUDE.md (mode, target, quality class, flags).
5. End with: current phase, unmet exit criteria (from the catalog), and the 1-3 next commands.
