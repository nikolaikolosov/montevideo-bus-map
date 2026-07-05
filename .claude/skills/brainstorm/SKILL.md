---
name: brainstorm
description: Facilitated brainstorming session - divergent generation, clustering, convergent scoring. Default topic is business ideas; works for features, names, growth experiments, anything.
---

# /brainstorm [topic]

Owner: **growth-lead** (facilitator); participants pulled per topic (business ideas →
market-researcher + audience-researcher; features → ux-lead + product-director; growth →
marketing-strategist).

## Sequence
1. Frame: one-line "How might we..." question + constraints that actually bind (skills,
   budget, time). No topic given → ask, or default to micro-SaaS business ideas seeded by the
   user's skills/interests (ask for them — founder-fit matters).
2. **Divergent** (no criticism, no scoring, quantity target 20+): each participant agent
   generates from its own lens; prompts rotated — inversion (what makes the pain worse?),
   niche-down (same idea for one specific segment), unbundling (one feature of a big tool as
   a product), constraint-flip (what if it had to be free / cost $500/mo?).
3. Cluster: group by underlying pain/theme; name clusters; duplicates merged, wild ones kept.
4. **Convergent**: score clusters/ideas against criteria agreed with the user BEFORE scoring
   (default for business ideas: pain severity, WTP evidence available, reachability,
   effort-to-MVP, founder fit). Top 3-5 with one-line rationale each.
5. The user picks what advances. For business ideas: winners become idea cards →
   `/idea-discovery` for evaluation; features → product backlog; experiments → marketing plan.

## Output
`product/ideas/brainstorm-NNN-<topic>.md`: framing, full idea list (nothing deleted),
clusters, scoring table, user's picks + next step per pick.
