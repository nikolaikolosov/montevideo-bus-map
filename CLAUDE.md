# Montevideo Bus Map

Buildless static site on GitHub Pages: ES modules in `src/` loaded directly by `index.html`,
Leaflet from unpkg, CSS in `css/`. `npm` is dev tooling only (Vitest, Playwright, ESLint,
Prettier) — there is no bundler and no server. Data comes from two generated files at the
root, `routes.json` and `stops.json`, produced by `fetch_api_data.py`.

## Repository gotchas

**Data updates are manual by design.** `api.montevideo.gub.uy` only accepts connections from
inside Uruguay, so CI runners cannot reach it and no Uruguayan host exists. Do not propose
cron jobs, Actions workflows, or hosted schedulers for the fetch. The procedure is
`docs/data-update-runbook.md`; the schema both files must satisfy is
`architecture/contracts/data-contract.md` (format v2), enforced by `scripts/validate_data.py`.

**Line colors are committed data, not computed.** `src/line-colors.js` holds a conflict-aware
palette; the hash in `getLineColor` is only a fallback for lines missing from the map. Data
updates must never recolor an existing line — `scripts/assign_line_colors.mjs` is incremental
by default and `--regenerate-all` also invalidates the golden manifest and every visual
baseline. Gates: `npm run verify:colors`.

**`src/geometry.js` owns projection math.** It was consolidated from six copies; a new inline
projection loop in cut/trim/match code is a review flag. Rules and the scale ladder:
`architecture/contracts/route-geometry-contract.md`. Gates: `npm run verify:scales`,
`npm run verify:oracles` (whitelist `qa/route-geometry-whitelist.json` — stale entries fail).
Corridor smoothing in `src/bundling.js` only runs behind its `BUNDLE_SMOOTH_*` guards;
unguarded smoothing sweeps kilometre-long peripheral segments hundreds of metres.

**Visual baselines are committed per platform.** `tests/e2e/__screenshots__/` carries both
win32 and linux images. Linux ones are regenerated through a CI-artifact round-trip: delete
them, let the first CI run fail `render-e2e` and upload the `screenshot-baselines` artifact,
commit that artifact, second run goes green. The artifact commit must land **before** the PR
merges, or `main` stays red.

**All UI copy lives in `src/i18n.js`.** Adding a string means adding the key to es, en and ru
(the completeness test fails otherwise) and asserting through `t()`, never a hardcoded literal.
Register is Uruguayan Spanish: voseo (`Elegí`, `Reintentá`), *recorridos* for bus paths —
never *rutas*, which reads as "highway" in UY. e2e pins `mvd-lang` so an en-US runner does not
shift every baseline.

**Security is meta-tag only.** GitHub Pages cannot set response headers, so `X-Frame-Options`,
`frame-ancestors`, `Permissions-Policy` and HSTS are undeliverable here — and `frame-ancestors`
is ignored inside a `<meta>` CSP, so do not re-add it. Accepted risks are recorded in
`product/decision-records/DR-001-accepted-security-risks.md`. `tests/e2e/security.spec.js`
asserts zero CSP violations and no inline handlers.

**Many referenced documents are gitignored.** `product/`, `design/`, `audit/`, `security/` and
most of `architecture/`, `docs/`, `qa/` are studio working directories that exist locally but
not in the public repo (negations in `.gitignore` publish the contracts, runbook, reports and
framework definitions). A path that appears missing in a fresh clone is usually this, not rot.

## Verification

`npm test` (Vitest, includes route invariants) · `npm run test:e2e` (Playwright: interaction
flows + pixel scenes) · `npm run lint` · `python -m pytest` (pipeline) ·
`python scripts/validate_data.py`. Targeted gates: `verify:routes`, `verify:colors`,
`verify:scales`, `verify:oracles`, `verify:journey`. Method reports live in `qa/reports/`.
Full-map sweep: `npx playwright test render-sweep` (`UPDATE_GOLDEN=1` to re-golden).

Debug hooks on `window`: `__mvdSelectLine`, `__mvdShowStopRoutes`, `__mvdGetRenderState`,
`__mvdLines`, `__mvdMap`.

## Path rules

- `src/**` — visual constants come from the tokens in `design/design-tokens.md` (source of
  truth: `css/styles.css` `:root` and `src/config.js`); no magic hex. Components carry every
  state and the a11y requirements from `design/component-inventory.md`; semantic HTML first,
  ARIA only where semantics cannot express it. The hash URL is the source of truth — UI
  actions go through `router.go()`.
- `tests/**` — independent, order-free, seeded randomness only. Never weaken or delete a
  failing test to make a suite pass; report it. Flakes get quarantined with a debt ticket.
  Acceptance criteria are quantitative.
- `security/**` — findings carry severity + CWE/OWASP reference + evidence (file:line) +
  concrete fix; false positives documented, not deleted. Active testing targets only this
  project's own environments. Critical/high findings hold the quality gate until fixed or
  user-accepted in a DR.

## Studio process

```yaml
studio:
  output_language: en
  project_mode: adopt
  deployment_target: ""
  architecture_variants: 3
  review_mode: full
  operation_mode: supervised
  quality_class: standard
  compliance_flags: []
  existing_codebase: "."
```

Phase state: `product/PHASE.md`. The full operating model — prime directives, directory
contract, agent registry, delegation, gates, budgets, and the key/value reference for the
block above — is [.claude/docs/studio-framework.md](.claude/docs/studio-framework.md). Read it
when running a studio skill or delegating to a studio agent. Phase catalog:
`.claude/docs/workflow-catalog.yaml`.
