---
name: adopt
description: Kick off adoption of an existing codebase - inventory of stack, layout, build/test health, hotspots. Read-only. Adopt track phase A0.
---

# /adopt [path]

Owner: **adoption-lead**; digging by **code-archaeologist**.

## Sequence
1. Resolve the codebase: `existing_codebase` from CLAUDE.md or the argument; confirm read
   access. Set `project_mode: adopt` if not set; PHASE.md → A0.
2. **Read-only rule**: nothing in the target codebase is modified during A0-A2. Quick-win
   itches go to the backlog, not into commits.
3. Inventory sweep into `audit/inventory.md`:
   - Stack: languages, frameworks, runtimes with versions (from manifests, not guesses).
   - Layout: top-level map, entry points, LOC per area, generated/vendored zones.
   - Build/run/test health: execute the documented commands; record exact failures verbatim.
   - Dependency freshness: outdated/EOL/vulnerable counts (audit tooling).
   - History stats: age, activity, top-churn files (hotspot seed).
   - Ops surface: Dockerfiles, CI configs, IaC, env vars referenced.
4. Everything evidenced: command + output or file:line. Unknowns (needs DB access, dead env)
   listed explicitly.
5. Report top findings; next step `/code-audit` (A1).

## Output
audit/inventory.md; PHASE.md updated; known-unknowns list; A0 exit criteria check.
