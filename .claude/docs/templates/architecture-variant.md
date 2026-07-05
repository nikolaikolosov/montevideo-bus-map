# Architecture Variant <X> — <name>

> Target platform: <deployment_target> · Pattern: <from constraints/architecture-patterns.yaml> · Date:

## Assumptions
<!-- load profile used, team size/skills, budget ceiling, compliance flags -->

## Shape
<!-- one paragraph + Mermaid component diagram -->
```mermaid
graph TD
```

## Component → Service Mapping
<!-- EVERY logical component to a concrete platform service, with catalog citations -->
| Component | Platform service | Key limits (from catalog) | Pricing dimension | Portability note |
|---|---|---|---|---|

## Data Topology
<!-- stores, consistency, caching layers, backup posture -->

## Async / Eventing
<!-- queues/bus/workflows mapping; delivery semantics; DLQ paths -->

## Auth Approach

## Assessment
| Criterion | Value | Evidence |
|---|---|---|
| Cost @ launch / expected / 10x | | architecture/cost-model.md |
| Latency class feasible | | |
| SLO tier feasible (sre-lead) | | |
| Operational burden | low/med/high | |
| Lock-in | | |
| Scaling ceiling | | |
| Team-skill fit | | |
| Migration cost (adopt mode) | | audit/current-state-report.md |

## Anti-pattern Check
<!-- against constraints/architecture-patterns.yaml red_flags -->

## Risks
