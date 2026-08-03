# WebDev Studio — framework reference

Full operating model of the studio: directives, directory contract, agent registry,
delegation, operation modes, phases, budgets, path rules, tooling.

Not loaded into every session. Read it when running a studio skill (`/adopt`, `/feature`,
`/design-review`, `/agent-loop`, …), when delegating to a studio agent, or when a question
is about the process rather than the code. The live configuration knobs are the `studio:`
block in [CLAUDE.md](../../CLAUDE.md); phase catalog detail is in
[workflow-catalog.yaml](workflow-catalog.yaml).

The studio works in two modes: **greenfield** (build a new application from a product brief)
and **adopt** (take over an existing codebase: analyze it, document the current implementation,
produce an improvement backlog, and optionally migrate it to a target architecture).
This repository is in **adopt** mode, past the A0–A2 audit phases.

## Configuration reference

The `studio:` block in `CLAUDE.md` carries these keys:

| Key | Values | Meaning |
|---|---|---|
| `output_language` | `en`, `ru`, … | language of output documents |
| `project_mode` | `greenfield`, `adopt` | new app from scratch vs existing codebase |
| `deployment_target` | `aws`, `gcp`, `azure`, `cloudflare`, `vercel`, `kubernetes`, `vps`, `""` | resolves to `constraints/platforms/<target>.yaml` — the service landscape the architecture must be designed against. Set via `/start` or `/deploy-target`; multi-target comparisons come from `/architecture-variants`. |
| `architecture_variants` | 2–4 | how many variants `/architecture-variants` produces |
| `review_mode` | `full`, `lean`, `solo` | all director gates / phase gates only / no gates |
| `operation_mode` | `supervised`, `autonomous` | user confirms every binding step vs `/agent-loop` with a ratification queue. Switching always requires user confirmation (`/studio-mode`). |
| `quality_class` | `prototype`, `standard`, `regulated` | budget/coverage policy from `constraints/slo-policy.yaml`, security level from `constraints/security-baseline.yaml` |
| `compliance_flags` | subset of `gdpr`, `ccpa`, `pci-dss`, `hipaa`, `soc2` | see `constraints/compliance.yaml` |
| `existing_codebase` | path or repo URL | adopt mode: the codebase under adoption |

## Prime Directives

1. **Evidence first.** Every architecture claim, platform limit, price, or benchmark number must
   trace to `constraints/*.yaml`, an official vendor doc (cite the URL), or a measurement stored
   in `qa/`. Never invent service quotas, pricing, or performance numbers. If a fact is missing
   from `constraints/`, propose adding it (with source) before using it.
2. **Assumptions are visible.** Every analysis and design document starts with an "Assumptions"
   block: inputs, expected load profile, validity range, quality class applied.
3. **Platform fit.** The architecture must be designed against the service landscape of the
   configured `deployment_target` (`constraints/platforms/<target>.yaml`): use the platform's
   native compute, data, messaging, and edge services where they fit. Deviations toward
   portability are legitimate but must be recorded as an ADR with the trade-off stated.
4. **Security is not a phase.** The baseline from `constraints/security-baseline.yaml` applies
   from the first scaffold. A threat model must exist before any externally reachable interface is
   built. Security testing (DAST, pentest procedures) targets the project's own environments
   or systems the user is authorized to test.
5. **Decision authority follows `operation_mode`.**
   - `supervised`: agents present 2–4 options with trade-offs and wait for the user's decision on
     anything binding (architecture, stack, data model, spend). Draft → approve → finalize.
   - `autonomous`: the responsible director decides (architecture/stack → lead-architect,
     scope/priorities → product-director, schedule/process → delivery-manager); every such
     decision is marked `AUTONOMOUS — pending human ratification` and appended to
     `product/ratification-queue.md`. Wherever a skill says "the user decides", read it as
     "per operation_mode".
   - In BOTH modes: outward-facing or irreversible actions (deploying to a paid cloud account,
     purchasing domains/services, publishing packages) wait for the user's go-ahead; critical
     security findings hold the quality gate until fixed or user-accepted.
6. **Fidelity honesty.** State the estimate class of every result (rough order of magnitude /
   budgetary / definitive for costs; smoke / representative / load-tested for performance).
7. **Accessibility and privacy are baselines, not features.** WCAG level per
   `constraints/accessibility.yaml`; data collection minimized and documented per
   `constraints/compliance.yaml` when compliance flags are set.

## Directory Contract

| Path | Contents | Owner agents |
|---|---|---|
| `product/` | product brief, requirements, roadmap, decision records, PHASE.md, risk register; `ideas/`, `research/`, `marketing/` for the growth discipline | product-director, delivery-manager, growth-lead |
| `architecture/` | architecture variants, ADRs, diagrams (Mermaid/C4), API contracts | lead-architect, api-designer, platform-lead |
| `design/` | user flows, wireframes, design tokens, component inventory, a11y notes | ux-lead, accessibility-specialist |
| `app/` | application source code (frontend, backend, shared) | frontend-lead, backend-lead + specialists |
| `infra/` | IaC (Terraform/CDK/Pulumi), pipelines, environment definitions | platform-lead, iac-engineer, cicd-engineer |
| `qa/` | test plans, verification matrix, test/perf/a11y reports | qa-lead, test-automation-engineer, performance-engineer |
| `security/` | threat models, security review reports, scan configs and results | security-lead, security-tester |
| `audit/` | adopt mode: codebase inventory, current-state report, improvement backlog, migration plan | adoption-lead, code-archaeologist, migration-specialist |
| `docs/` | final documentation package, runbooks, onboarding guide | docs-lead, tech-writer |
| `constraints/` | reference data: platform catalogs, budgets, baselines — read-only during project work | edited only via user-approved PRs |

In this repository the application itself predates the studio and lives at the root
(`src/`, `css/`, `tests/`, `scripts/`, `index.html`) — `app/` and `infra/` hold placeholder
READMEs only.

File naming: `<phase>-<area>-<topic>-vNN.md` for documents, `ADR-NNN-<topic>.md` for
architecture decision records, `DR-NNN-<topic>.md` for product decision records.

## Agent Registry

### Tier 1 — Directors (model: opus)
- **product-director** — Product vision, scope, priorities, roadmap. Final word on scope and priorities.
- **lead-architect** — System architecture, technology stack, architecture variants, ADR authority. Final word on architecture.
- **delivery-manager** — Schedule, risk register, review gates, scope control, ratification queue.

### Tier 2 — Discipline Leads (model: sonnet)
- **growth-lead** — Ideation-to-go-to-market: business idea discovery, brainstorm facilitation, audience research program, marketing strategy, validation. Reports to product-director on scope.
- **ux-lead** — UX/UI design: user flows, wireframes, design system, content structure.
- **frontend-lead** — Frontend architecture and implementation: framework setup, routing, state, rendering strategy.
- **backend-lead** — Backend services: domain logic, API implementation, background jobs, service boundaries.
- **data-lead** — Data modeling, storage selection, migrations, caching strategy, data lifecycle.
- **platform-lead** — Mapping architecture to the deployment target's services, environments, deployment topology, IaC ownership.
- **qa-lead** — Test strategy, verification matrix, quality gate. Independent from implementation leads; escalates to delivery-manager.
- **security-lead** — Threat modeling, security reviews, secure SDLC. Can hold the quality gate on critical findings.
- **sre-lead** — SLOs and error budgets, observability requirements, incident readiness, capacity planning.
- **docs-lead** — Documentation standards, ADR/DR hygiene, docs package assembly.
- **adoption-lead** — Adopt mode orchestration: codebase audit, current-state documentation, improvement backlog, migration strategy.

### Tier 3 — Specialists (model: sonnet; haiku for mechanical tasks)
- **market-researcher** — Business idea discovery: pain mining, competitor/alternative mapping, demand signals, niche evaluation.
- **audience-researcher** — Target audience: segments, personas, usage scenarios (job stories), watering holes, willingness-to-pay evidence.
- **marketing-strategist** — Positioning, messaging, channel selection, launch scenarios, pricing communication.
- **api-designer** — API contracts (OpenAPI/GraphQL/gRPC), versioning, pagination/error conventions.
- **db-engineer** — Schemas, indexes, query plans, migration scripts, data integrity.
- **ui-engineer** — Component implementation, styling, client state, responsive behavior.
- **accessibility-specialist** — WCAG audits and remediation, keyboard/reader flows, a11y test setup.
- **performance-engineer** — Core Web Vitals, API latency, load testing, profiling, caching layers.
- **test-automation-engineer** — Unit/integration/e2e harnesses, fixtures, CI test wiring, flake control.
- **security-tester** — SAST/DAST setup, dependency and secret scanning, authorized penetration test procedures.
- **cost-analyst** — Cloud cost modeling per variant, pricing-calculator runs, FinOps recommendations.
- **iac-engineer** — Terraform/CDK/Pulumi modules, environment parity, drift control.
- **cicd-engineer** — Build/test/deploy pipelines, release automation, rollback paths.
- **observability-engineer** — Structured logging, metrics, tracing, dashboards, alert rules.
- **code-archaeologist** — Adopt mode: dependency mapping, hotspot analysis, dead code, implicit contracts.
- **migration-specialist** — Adopt mode: strangler-fig plans, incremental migration steps, data migration with rollback.
- **integration-specialist** — Third-party services: payments, auth providers, email, webhooks; sandbox-first.
- **seo-analytics-specialist** — SEO/meta/structured data, analytics event design (privacy-aware).
- **compliance-analyst** — GDPR/CCPA/PCI-DSS/HIPAA/SOC2 mapping: obligations translated into concrete design decisions. Engineering aid, not legal advice; flags blocking gaps to the user.
- **tech-writer** — User-facing docs, runbooks, README/onboarding polish.

Each agent's own definition file (`.claude/agents/<name>.md`) is the authority on its
responsibilities and output contract; the harness lists all of them at session start, so this
registry exists for the delegation map and the CI self-audit, not as a lookup table.

### Delegation protocol
- Vertical: directors → leads → specialists. Horizontal consultation allowed, no overrides.
- Conflicts escalate: architecture/stack → lead-architect; scope/priorities → product-director;
  schedule/process → delivery-manager.
- An agent must not modify files owned by another discipline without delegation through the owner.
- qa-lead and security-lead never report through implementation leads; they escalate directly
  to delivery-manager / lead-architect.
- Every completed agent task ends with: files touched, key numbers, open issues, budget status
  (performance / cost / error budget).

## Operation Modes

- **supervised** (default): step-by-step with the user in the loop. Every binding choice is a
  question; every draft waits for approval.
- **autonomous**: `/agent-loop` advances phases end-to-end through an agent interaction loop —
  plan → execute (subagents for parallel work) → director decision → director review → journal
  (`product/loop-journal.md`) → gate check. Pauses on: target gate reached, critical security
  finding, budget overrun (performance/cost/error), double gate failure, any outward-facing
  action (cloud deploys, purchases), or a genuinely user-level decision.
- Orthogonal to `review_mode` (gate strictness) — all combinations are valid.
- Invariants in both modes: evidence-first, no fabricated tool output, failing tests reported
  as failing, security baseline enforced, authorized-targets-only for security testing.

## Workflow Phases

Detail in [workflow-catalog.yaml](workflow-catalog.yaml). Current phase: `product/PHASE.md`.
Gates require director sign-off in `review_mode: full`.

Greenfield track:
I. **Ideation** (optional) — `/brainstorm`, `/idea-discovery`, `/audience-research` — Idea pick (product-director)
0. **Discovery** — `/product-brief`, `/requirements` → product/00-product-brief.md — **DG gate**
1. **Architecture** — `/architecture-variants`, `/stack-select`, `/cost-estimate` — **ARB gate**
2. **Design** — `/design-system`, `/data-model`, `/api-contract`, `/threat-model` — **DR gate**
3. **Build** — `/scaffold`, `/feature` loop under path rules — **CC gate**
4. **Verify** — `/test-plan`, `/security-review`, `/performance-audit`, `/accessibility-audit` — **QG gate**
5. **Ship** — `/iac`, `/ci-cd`, `/observability`, `/marketing-plan`, `/release` — **LRR gate**
6. **Operate & Handover** — `/docs-package`, runbooks, improvement backlog — Handover review

Adopt track (`project_mode: adopt`):
A0. **Inventory** — `/adopt` → audit/inventory.md
A1. **Current state** — `/code-audit` → audit/current-state-report.md (documents what IS)
A2. **Improvements** — `/improvement-backlog` → prioritized proposals with effort/impact
A3. **Target & migration** — `/architecture-variants` (brownfield inputs), `/migration-plan`
    → joins the greenfield track at phase 2 or 3.

## Budget Policy

- **Performance budget** per `constraints/performance-budgets.yaml` (Core Web Vitals, API
  latency classes, bundle size). performance-engineer keeps `qa/performance-report.md` current.
- **Cost budget** per variant from `/cost-estimate`; cost-analyst re-checks when the
  architecture or expected load changes. Estimate class always stated.
- **Error budget / SLO** per `constraints/slo-policy.yaml` and `quality_class`; sre-lead owns
  `docs/slo.md`.
- Any budget in the red = blocker. Raised to the owning director immediately, logged in
  `product/risk-register.md`.

## Tooling

Prefer scriptable, widely adopted open-source tooling driven via Bash: package managers
(npm/pnpm/pip/uv), test runners (Vitest/Jest/Playwright/pytest), linters (ESLint/Biome/ruff),
scanners (Semgrep, Trivy, gitleaks, npm audit/pip-audit), load tools (k6), Lighthouse for
web vitals, Terraform/CDK/Pulumi for IaC. Never fake tool output — if a tool is not installed,
say so and offer the install command or a documented manual procedure instead.

## Appendix — path rules for greenfield disciplines

The live rules for this repository's actual paths (`src/`, `tests/`, `security/`) are in
[CLAUDE.md](../../CLAUDE.md). The rules below apply to disciplines this repository does not
currently have; they were previously auto-loaded from `.claude/rules/` and are kept here so a
future backend or IaC surface starts from the same baseline.

### `app/**` backend code

1. Endpoints implement `architecture/contracts/` exactly — status codes, error shape,
   pagination. Contract drift goes back through api-designer, never silently shipped.
2. Boundary validation on every input (schema validation — zod/pydantic class); authn/authz
   enforced server-side per request; object-level authorization on every resource access.
3. Data access through the designed data layer; parameterized queries only; migrations via
   db-engineer's process (reversible per policy, destructive ops approved + backed up).
4. Async handlers idempotent (at-least-once delivery assumed); dead-letter path on every
   queue consumer; no fire-and-forget for state-changing work.
5. Structured logging (the documented schema) with correlation IDs; no PII/credentials in
   log lines; no leftover debug prints.
6. Secrets from the environment/secret store only; new config keys documented in
   `.env.example` with safe placeholder values.
7. Every endpoint has integration tests against the contract; domain logic unit-tested;
   failing tests reported, never weakened.

### `app/**` frontend code

1. Visual constants only from design tokens (`design/design-tokens.md`); no magic hex/px.
   Components implement their `design/component-inventory.md` entry: all states
   (default/hover/focus/disabled/loading/empty/error) + a11y requirements.
2. Semantic HTML first; interactive elements are buttons/links; ARIA only where semantics
   can't express it. Query-by-role idiom in component tests.
3. Data fetching against the generated typed client from `architecture/contracts/` — no
   hand-written fetch shapes drifting from the contract.
4. Server state via the data-fetching layer's cache; local state for UI-only concerns; no
   server-state duplicates in global stores.
5. Bundle budget per route (constraints/performance-budgets.yaml) enforced; heavy dependency
   additions flagged to frontend-lead BEFORE install; images lazy+sized, fonts subset.
6. Error boundaries per route; user-visible error states designed (from the flow spec), not
   default stack traces.
7. TypeScript strict; lint/format per the stack ADR config; tests alongside code.

### `infra/**`

1. One IaC tool per project (stack ADR); modules reusable, environments differ by variables
   only — no copy-paste env trees.
2. Remote locked state; `plan` reviewed before any `apply`; applies to billable cloud
   accounts wait for the user's go-ahead.
3. Least-privilege IAM/service roles; each broad grant carries a justification comment;
   no wildcard-resource + wildcard-action policies.
4. Secrets never in IaC code or committed state artifacts; secret-store resources define
   the container, values flow in at deploy.
5. Every resource tagged/labeled (project, environment, owner) for cost attribution.
6. Service limits/quotas from `constraints/platforms/<target>.yaml` encoded as validated
   variables where the tool supports it — do not configure past documented limits.
7. Pipelines: build once/promote artifact, per-env scoped credentials, fork PRs get no
   deploy creds, rollback path documented and drilled before LRR.

### `qa/**` and test code

1. Verification matrix stays current: new/changed requirements re-allocated the same session;
   unallocated requirements are gaps the QG gate counts.
2. Tests independent, order-free, parallel-safe; factories/fixtures over shared seeds; no
   production data; seeded randomness only.
3. Mocks only at third-party boundaries; integration tests hit real stores (containers or
   platform emulators).
4. Never delete or weaken a failing test to make a suite pass — that is falsification;
   report it. Flaky tests: quarantine + debt ticket, root cause or escalate.
5. Reports (`qa/reports/`) carry method + config committed alongside; measured-vs-budget
   tables; representativeness stated (data volume, cache state, env shape).
6. Acceptance criteria quantitative: codes, thresholds, exact states — "works" is not a
   criterion.

### `security/**`

1. Active testing (DAST, fuzzing, pentest procedures) targets this project's own local/staging
   environments or systems the user is authorized to test; unclear target — check with the
   user first.
2. Scan configs committed (`security/scans/`); scan outputs summarized in reports — raw dumps
   trimmed to decisive findings with evidence.
3. Findings: severity + OWASP/CWE reference + evidence (file:line or request/response) +
   concrete fix. False positives documented with rationale, not deleted.
4. Discovered credentials/secrets: treat as compromised — rotation first, history cleanup
   second, report immediately. Never paste live secrets into reports; reference their location.
5. Threat model updated when interfaces change; mitigations have owners and phases; accepted
   risks require a user-signed DR.
6. Critical/high open findings hold the quality gate until fixed or the user accepts the risk
   (recorded as a DR).
