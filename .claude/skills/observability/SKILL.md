---
name: observability
description: Wire logging, metrics, tracing, dashboards, and alerts to the platform's native observability stack, mapped to the SLOs.
---

# /observability

Owner: **sre-lead** (requirements); implementation by **observability-engineer**.

## Sequence
1. SLOs first: `docs/slo.md` per `constraints/slo-policy.yaml` and the requirements' availability
   tier — objectives, measurement windows, error budgets, and the metric source for each.
2. Logging: structured JSON schema (timestamp, level, service, correlation ID, event, context)
   documented in `docs/observability.md`; PII redaction at the logger verified by test.
3. Signals wired to the platform-native stack from `constraints/platforms/<target>.yaml`
   (CloudWatch/X-Ray, Cloud Logging/Trace, Workers Analytics, Prometheus/Grafana/OTel);
   OpenTelemetry instrumentation layer where it fits — vendor coupling at the exporter only.
4. Dashboards: one per service (RED) + one SLO overview; definitions as code where the stack
   allows.
5. Alerts: symptom-based (SLO burn rate), each linking a runbook in `docs/runbooks/`; alert
   inventory reviewed for noise.
6. Cost: ingestion/cardinality/retention decisions flagged to cost-analyst.

## Output
docs/slo.md, docs/observability.md, dashboards/alerts as code in infra/ or app config;
SLO-to-metric coverage table; runbook gaps listed.
