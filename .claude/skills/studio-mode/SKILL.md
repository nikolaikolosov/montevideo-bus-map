---
name: studio-mode
description: Switch between supervised and autonomous operation mode. The switch itself always requires explicit user confirmation.
---

# /studio-mode [supervised|autonomous]

Owner: **delivery-manager**.

1. Show current `operation_mode` and what the other mode changes (decision authority,
   ratification queue, halt conditions) — three lines max.
2. Require explicit user confirmation of the switch. No argument = show status only.
3. On switch to autonomous: verify `product/ratification-queue.md` exists (create from scratch
   if not), remind about halt conditions and that outward-facing actions still require human
   approval.
4. On switch to supervised: summarize any pending ratification items — they still need answers.
5. Update CLAUDE.md `operation_mode`; log the switch in `product/loop-journal.md`.
