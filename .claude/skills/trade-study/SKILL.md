---
name: trade-study
description: Structured comparison of 2-4 options against weighted quantitative criteria for any binding technical or product decision.
---

# /trade-study <topic>

Owner: the director in whose domain the decision falls (**lead-architect** for technical,
**product-director** for product); executed with the relevant leads.

## Sequence
1. Frame: the decision, why now, what it blocks. One paragraph.
2. Options: 2-4 real candidates (a strawman option is a process smell — replace or drop it).
3. Criteria with weights agreed BEFORE scoring (cost, fit, risk, effort, reversibility...);
   scoring scale defined; every score justified by evidence (constraints/, cited doc, measurement)
   — unsourced scores marked as judgment calls.
4. Sensitivity: does the winner change if the top weight shifts ±20%? Note it.
5. Recommendation; the user decides per operation_mode. Record as ADR or DR depending on domain.

## Output
`product/trade-studies/TS-NNN-<topic>.md` (template: trade-study.md); decision record after
the call.
