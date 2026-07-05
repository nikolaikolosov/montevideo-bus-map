---
name: design-system
description: Produce the UX foundation - user flows, wireframes, design tokens, component inventory with accessibility requirements. Phase 2 UX core skill.
---

# /design-system

Owner: **ux-lead**; a11y requirements by **accessibility-specialist**; SEO input by
**seo-analytics-specialist**.

## Sequence
1. User flows for every P0 job-to-be-done: entry → steps → success/error/empty/loading states →
   exit. Mermaid flowcharts in `design/user-flows.md`. Every flow names the API operations it
   will need (feeds /api-contract).
2. Wireframes as structured text per screen in `design/wireframes/`: layout regions, content
   hierarchy, real microcopy (no lorem ipsum for P0), responsive behavior notes.
3. Design tokens in `design/design-tokens.md`: color (with contrast ratios checked against the
   a11y target), type scale, spacing scale, radii, elevation, motion. Tokens are the only
   source of visual constants downstream.
4. Component inventory in `design/component-inventory.md`: per component — variants, states
   (default/hover/focus/disabled/loading/empty/error), a11y requirements (role, labels,
   keyboard, announcements), responsive rules.
5. SEO-critical pages flagged with rendering requirements (may feed back to the architecture).

## Output
design/user-flows.md, design/wireframes/*, design/design-tokens.md,
design/component-inventory.md; open UX questions; DR-gate inputs ready.
