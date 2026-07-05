# Route Geometry Contract

> Owner: lead-architect · Origin: brainstorm-008 (user pick V2, 2026-07-05)
> Enforced by: `tests/js/geometry.test.js`, `tests/js/route-invariants.test.js`,
> `tests/js/route-continuity.test.js`, `tests/js/route-downstream.test.js`,
> `tests/js/line-smoothness.test.js`, `npm run verify:scales`,
> `npm run verify:oracles` (all in CI).

## Assumptions

- Input: per-variant digitised traces (`routes.json`, LineStrings; 140 lines /
  1,083 variants in the 2026-06-27 dataset) and stop positions (`stops.json`).
  Each variant is digitised independently: same-street traces differ by
  vertex jitter (P90 1.9 m), ida/vuelta strands by a carriageway offset
  (P90 14.2 m, tail through the merge threshold) — measured numbers in
  `qa/reports/geometry-scales-report.md`.
- Validity: constants and gate calibrations hold for this dataset; every data
  update re-runs `verify:scales` + `verify:oracles` (runbook step 4).
- Quality class: standard.

## Pipeline stages

| Stage | Code | In → Out | Postconditions |
|---|---|---|---|
| S0 raw | `routes.json` | — | per-variant [lon,lat] traces, 1–5 m jitter |
| S1 prepare | `prepareRouteFeature` → `cleanCoordinates`, `trimToStops`, optional `truncateLineDownstream` (src/map.js, src/utils.js) | trace → revenue-segment trace | endpoints ON the trace (projection); no foreign coordinates; near-duplicate vertices dropped |
| S2 bundle | `buildSections` (src/bundling.js): cluster → node sequences → on-path insertion → edge graph → diamond merge + triangle dissolve → chain merge → `smoothPath` → `simplifyPath` | traces of displayed lines → corridor sections | composition conserved; per-operator displacement ≤ budget (ladder below); corridors within CHORD budget of the traces |
| S3 joints | `buildJoints` (src/bundling.js) | sections → joint descriptors | every line continuing through a 2-section node is stitched; ≥3-section nodes untouched |
| S4 render | `OffsetPolyline` / `OffsetJoint` (src/offsetline.js), slot order in src/map.js | sections + joints → pixel strands | offsets computed per zoom in pixel space with ONE shared math; global slot order (no side swaps) |

## Rules

- **R-PROJECT.** Every cut/trim/match operates on segment *projections*, never
  nearest vertices. The shared primitives (`src/geometry.js`:
  `projectPointOnSegment`, `projectPointOnPolyline`, `projectionCandidates`,
  `unclampedSegmentParam`, `pointAt`) are the only implementation; new code
  imports them instead of re-deriving the math. (History: both vertex-snap
  re-implementations shipped bugs — PR #4 loop truncation, PR #9 chords.)
- **R-FOREIGN.** Coordinates that are not trace vertices or on-trace
  projections (stop positions, labels, user location) never enter route
  geometry. Cuts land on the trace; markers show off-trace positions.
- **R-BOUNDED.** Every geometry-mutating operator has a stated displacement
  budget and a guard for features above its scale: `cleanCoordinates` ~1 m,
  `simplifyPath` ≤ 4 m (Hausdorff), `smoothPath` ≤ ~11 m/vertex and only
  between segments < 66 m (km-leg corners immovable), clustering ≤ the merge
  radius. Budgets are unit-tested (`geometry.test.js`, `bundling.test.js`).
- **R-CONSERVE.** Graph cleanup (diamond merge, triangle dissolve, section
  chaining) preserves the (line, variant) composition — nothing gains or
  loses a line silently (edge merges union `variantsByLine`).
- **R-CONTINUOUS.** Where two separately rendered primitives meet, their
  endpoints are computed with the same pixel-space offset math — continuity
  by construction, verified to sub-pixel (`route-continuity.test.js`).
- **R-EVIDENCE.** Constants are sized from measured data properties, not
  guessed; `verify:scales` re-derives the measurements and fails when a
  constant drifts out of its gap. Artifact gates carry no count ceilings:
  every finding is either REAL (the data shows it), whitelisted with a
  reviewed reason, or a failure (`verify:oracles`).

## Scale ladder

Each stage may move geometry only below the scale the next stage treats as
identity. Measured evidence: `qa/reports/geometry-scales-report.md`.

| Scale | Constant | Value (m, lon/lat axis) | Sized against |
|---|---|---|---|
| duplicate vertex | `cleanCoordinates` threshold | 0.9 / 1.1 | GPS duplicate noise |
| simplify | `BUNDLE_SIMPLIFY_EPS_DEG` | 3.7 / 4.4 | node jitter P90 1.9 m |
| smoothing shift | `BUNDLE_SMOOTH_MAX_SHIFT_DEG` | 9.2 / 11.1 | half the sawtooth amplitude of merged strands |
| smoothing guard | `BUNDLE_SMOOTH_MAX_SEG_DEG` | 55 / 66 | urban vs km-leg segment split (7,696 / 14,004 corners protected) |
| merge radius | `BUNDLE_TOLERANCE_DEG` | 20.2 / 24.4 | ida/vuelta offset P90 14.2 m; > 20 m = physically divided carriageways |

The 6–20 m band between "renders as one strand" and "physically separate"
is the DUPLICATE oracle band; the separation histogram's tail runs through
the merge threshold, which is why the residue there is classified per
location instead of bounded by a count.

## Artifact taxonomy → verification map

| Class | Definition | Oracle | Gate |
|---|---|---|---|
| WOBBLE | two-sided weave > 6 m across the chord of a 120–400 m straight run | `verify:oracles` | whitelist |
| KINK | 60–150° turn, both flanks < 35 m | `verify:oracles` + line-104 suite | whitelist / strict |
| DUPLICATE | parallel same-line strands 6–20 m apart, ≥ 40 m overlap | `verify:oracles` | whitelist |
| SPIKE | ≥ 160° reversal returning within 10 m | `verify:oracles` | whitelist |
| SELF-CROSS | section polyline properly crossing itself | `verify:oracles` | whitelist |
| CHORD | corridor point > 30 m from every trace of its line | `verify:oracles` | whitelist |
| CORNER-CUT | guard-protected raw corner > 30 m from the corridor | `verify:oracles` | whitelist |
| PHANTOM-FORK | identical variant sets splitting < 30° | `verify:oracles` | report-only |
| GAP / SIDESTEP | free strand end / slot jump at a section boundary | `route-continuity.test.js` | strict (0) |
| chord-at-cut | downstream head off the trace | `route-downstream.test.js` | strict (0) |
| containment / length / connectivity | trace ↔ corridor global sanity | `route-invariants.test.js` | calibrated bounds |

Verdicts in `verify:oracles`: **REAL** — the digitised traces show the same
feature at that location (auto-classified with the same measure run on the
raw paths); **BUG** — pipeline-introduced, must match a reviewed
`known-bug` whitelist entry (`qa/route-geometry-whitelist.json`) or the gate
fails; stale entries fail too, so the known-bug list can only burn down.
Current state (2026-07-05): 38 known-bug entries (13 KINK, 22 WOBBLE,
2 SPIKE, 1 SELF-CROSS) — the PR-2 mechanism-upgrade targets.

## Independence note (qa)

Test suites whose *subject* is a specific transformation keep independent
arithmetic (e.g. `route-continuity.test.js` recomputes offsets on its own;
`route-invariants.test.js` keeps its own distance loop). The shared
`src/geometry.js` primitives are brute-force-verified in
`tests/js/geometry.test.js`, which licenses the *measurement* helpers
(headings, overlap, Hausdorff) for use by oracles — the measured object
(the pipeline) never calls those meter-space helpers.

## Change protocol

1. A constant change or mechanism change must keep `verify:scales` and
   `verify:oracles` green (whitelist edits go through review with the triage
   gallery: `npm run triage:oracles`).
2. New rendering features that cut/trim/match geometry import the
   `src/geometry.js` primitives (R-PROJECT) — a new inline projection loop
   is a review flag.
3. A data update follows the runbook: `verify:scales` re-derivation, then
   `verify:oracles` re-triage, then golden/baseline regeneration.
