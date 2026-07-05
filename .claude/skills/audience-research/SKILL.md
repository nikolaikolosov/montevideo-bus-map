---
name: audience-research
description: Find and profile the paying audience - segments, personas, usage scenarios, watering holes, willingness-to-pay evidence, validation plan. The bridge from idea to product brief.
---

# /audience-research <idea>

Owner: **audience-researcher**; coordinated by **growth-lead**; market context from
**market-researcher**.

## Sequence
1. Input: an idea card from `/idea-discovery` (or the user's direct idea — create the card
   first). Segment the market by pain intensity and context; pick ONE beachhead segment
   (sharpest pain + easiest reach); park the rest with reasons.
2. Persona for the beachhead (template: audience-profile.md): role, context, trigger moments,
   current workaround and its cost, budget authority (who actually pays).
3. **Usage scenarios** — the core deliverable: job stories ("when <trigger>, I want
   <capability>, so I can <outcome>") ranked by frequency × pain. These become
   jobs-to-be-done in `/product-brief` and flows in `/design-system`.
4. Watering-hole map: communities, newsletters, influencers, adjacent tools, search phrases —
   with reach estimates (cited or hypothesis-labeled). Feeds `/marketing-plan` directly.
5. Willingness-to-pay: evidence ladder position + pricing hypothesis anchored on the
   workaround's cost; cheapest test to climb a rung picked from
   `constraints/validation-methods.yaml`.
6. Validation plan: 2-3 tests with time/budget box and pass criteria. Fielding anything
   outward (posting, outreach, publishing a landing page) waits for the user's go-ahead.

## Output
`product/research/audience-<idea>.md` (profile + scenarios + watering holes + WTP + plan);
gaps listed; when evidence reaches behavioral/payment (or the user accepts the gap) →
`/product-brief`.
