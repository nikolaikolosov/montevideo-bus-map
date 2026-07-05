---
name: performance-audit
description: Measure the application against its performance budgets - Core Web Vitals, endpoint latency, load test, bundle sizes - with committed measurement configs.
---

# /performance-audit

Owner: **performance-engineer**; verdict co-signed by **qa-lead** at QG.

## Sequence
1. Budgets from `constraints/performance-budgets.yaml` for the project's latency class; list
   them first — the audit reports measured vs budget, nothing else counts.
2. Frontend: Lighthouse (config committed) on P0 pages — LCP/INP/CLS + bundle per route vs
   budget; image/font audit.
3. Backend: p50/p95/p99 per endpoint class under the k6 load profile from the test plan
   (script committed to `qa/`); N+1 and slow-query check with db-engineer (EXPLAIN evidence);
   cold-start measurement if the variant is serverless.
4. Representativeness stated: data volume, cache state, environment vs production shape —
   unrepresentative measurements labeled as such.
5. Red budgets → BLOCKER in the risk register; top bottleneck gets an evidence-backed
   optimization proposal (before-number mandatory).

## Output
`qa/reports/performance-report-vNN.md`: measured-vs-budget tables, methodology, bottleneck
analysis, verdict for QG.
