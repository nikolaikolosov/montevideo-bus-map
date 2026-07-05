# SLO — <service/app>

> Owner: sre-lead · Quality class: · Window: 30d rolling · Date:

## Objectives
| SLI | Objective | Measurement source (metric + where emitted) | Dashboard |
|---|---|---|---|
| Availability | | | |
| Latency (p95, per class) | | | |
| Error rate | | | |

## Error Budget
- Monthly budget: <minutes / % failed requests>
- Burn alerts: fast (2%/1h → page), slow (10%/24h → ticket)
- Policy on exhaustion: feature freeze recommendation to delivery-manager

## Composite SLA Check
<!-- managed dependencies on the critical path: multiply provider SLAs, compare to objective -->

## Degradation Modes
| Dependency down | User-visible behavior (designed) | Runbook |
|---|---|---|
