---
name: marketing-plan
description: Marketing plan for a validated audience - positioning, messaging, channel selection from the catalog, staged launch scenario, experiment backlog.
---

# /marketing-plan

Owner: **marketing-strategist**; audience inputs from **audience-researcher**; analytics
wiring with **seo-analytics-specialist**; coordinated by **growth-lead**.

## Sequence
1. Preconditions: audience profile with watering-hole map exists (else `/audience-research`).
   Budget class and time horizon from the user.
2. Positioning statement (for <segment> who <pain>... unlike <alternative>) in the persona's
   own vocabulary; core message per persona from the top usage scenarios.
3. Channel selection: score `constraints/marketing-channels.yaml` candidates against the
   watering-hole map, budget class, time-to-signal; pick 2-3. Each: entry tactic, cost class
   (cited or hypothesis), expected signal and when.
4. Launch scenario (template: marketing-plan.md): pre-launch (waitlist/audience-building where
   it fits), launch (directories/communities with etiquette notes), post-launch loops
   (content/SEO, referral, integrations). Stage gates: goal metric + kill/scale criterion.
5. Pricing page recommendation from WTP evidence (plans, trial vs freemium — per audience
   buying behavior). Measurement plan: events per funnel stage (privacy-aware, consent-gated
   when flags set).
6. Experiment backlog: every bet time/budget-boxed with pass criteria. Publishing anything
   outward waits for the user's go-ahead.

## Output
`product/marketing/marketing-plan.md`; experiment backlog inside; SEO-critical page
requirements handed to seo-analytics-specialist; revisit trigger: beachhead segment change.
