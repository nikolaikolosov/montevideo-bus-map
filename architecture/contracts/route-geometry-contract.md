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
| S2 bundle | `buildSections` (src/bundling.js): cluster → node sequences → **re-centre nodes on their strands** → on-path insertion → edge graph → diamond merge + triangle dissolve (both to a fixpoint) → chain merge → `smoothPath` → `simplifyPath` | traces of displayed lines → corridor sections | composition conserved; per-operator displacement ≤ budget (ladder below); corridors within CHORD budget of the traces |
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
  A budget is **cumulative over the whole operator**, not per internal
  iteration: `smoothPath` clamps each vertex against its canonical node, so
  running N passes still displaces it by at most one budget. Clamping per pass
  instead silently multiplied the budget by `BUNDLE_SMOOTH_PASSES` — 219 of
  14,001 corridor vertices ended up beyond ~11 m, the worst at 21.7 m, which ate
  the headroom `CHORD_MAX_M = 30` is derived from (audit G-1, fixed 2026-07-26;
  `verify:scales` now asserts the effective displacement, not the constant).
- **R-REPRESENTATIVE.** A corridor representing N strands lies at the mean of
  those strands, and its position does not depend on which of their VERTICES
  happened to cluster together. Clustering alone violates this: a node that
  caught one ida and one vuelta vertex sits on the centreline while its
  neighbour that caught only ida sits ~half the carriageway separation aside, so
  the corridor alternates with vertex phase — that alternation was 25 of the 38
  accepted WOBBLE/KINK artifacts. `recentreNodes` re-places every node at the
  mean of the strands within 1.5 × the cluster radius, ONCE PER NODE so a node
  shared by two bundles keeps one position (per-section re-centring split
  boundary nodes in two and produced fresh SELF-CROSS and SPIKE artifacts).
  Asserted on real geometry in `route-invariants.test.js`: mean offset from the
  strand mean 4.81 m → 1.15 m → 1.07 m, worst 26.0 m → 14.9 m (brainstorm-008
  PR-2, then the merge fix below).
  Re-centring must also **re-base the cluster accumulators** (`sx/sy/n`) on the
  position it writes. Those sums are the running total of the raw vertices that
  clustered into the node, and the diamond merge recomputes a surviving node as
  `sx/n` — so leaving them raw made every merge silently revert that node to its
  phase-dependent cluster mean, undoing re-centring exactly where corners force
  merges. Measured on line 180: node 206 snapped 7.6 m off its re-centred
  position, to 3.8 m from any trace, while every other node in that window sat
  within 0.1 m of one — and that single node was the whole residual WOBBLE
  there. Fixing it removed the finding (whole-network render 2210 → 2194
  sections, 6291 → 6210 points, 398 vertices moved; golden manifest 36 of 140
  lines, 14648 → 14613 points; no pixel scene crossed its diff budget). The
  invariant is unit-tested directly (`bundling.test.js`) because no synthetic
  fixture reproduces the merge topology on demand.
- **R-CONVERGE.** Graph-cleanup loops run to a fixpoint, not a fixed pass count.
  Each pass strictly removes a node or an edge, so termination is structural; the
  guard exists to turn a non-monotonic edit into a loud failure. The old caps
  (4 diamond / 3 triangle) never bound on the committed data — measured 1–3
  passes across all 141 renders — so this changes no output, it removes the
  possibility of silently leaving cleanup undone on a denser feed.
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
  "The data shows it" is tested against two references, both derived from the
  digitised traces alone and never from pipeline output: an **individual
  strand**, and the **mean of the strands running together**
  (`meanStrandCurves`). The second exists because a corridor represents that
  mean (R-REPRESENTATIVE), so it sits half a carriageway from either strand and
  can miss a per-strand match while following the data faithfully. Adding a
  reference only widens what counts as explained; it cannot excuse a corridor
  feature that no reference has.
  A reference is measured **over the window the corridor's finding covers**, not
  asked to produce a window of its own (`refWeaveAcrossWindow`). Window growth
  stops at the first segment more than `WOBBLE_AXIS_DEG` off the chord, so a raw
  trace — vertices every few metres, P90 jitter 1.9 m — structurally cannot hold
  a 120 m straight run however plainly it weaves, while the corridor it is
  compared against has been decimated to 4 m and easily does. That asymmetry,
  not the street, produced the "neither the strands nor their mean weave at all"
  verdict of 2026-07-27 (PR #37). Measured over the corridor's own window, 6 of
  those 10 sites have a two-sided weave of 5.6–12.6 m in the traces against a
  corridor `devM` of 6.3–11.7 m (ratio 0.72–1.11, the same
  `WOBBLE_RAW_MATCH_RATIO` bar the independent match uses) — the corridor is
  following a weave the data already has. Of the remaining 4, line 180 was a
  located pipeline defect (the merge revert under R-REPRESENTATIVE, now fixed)
  and 3 stay BUG: lines 199, L6 and L77, whose traces weave two-sided by
  2.3–3.5 m measured this way.
  **The chord this measure uses is a known limitation.** `refWeaveAcrossWindow`
  scores the reference against the chord joining the *projections* of the window
  ends, and that chord slides wherever the corridor is laterally offset from the
  reference. Measured against the corridor's own chord instead, the same traces
  at those 3 sites weave two-sided by 4.1–9.7 m, i.e. more than the corridors
  they are supposed to explain (3.1–3.8 m) — at line 199 three times as much.
  Neither chord is unbiased: the projection chord under-reports on an offset
  corridor, and the corridor chord adds a constant offset that makes a genuine
  weave read one-sided. Deciding this needs its own power check, so the ratio bar
  is left where it is and the 3 entries carry both numbers in their reasons. Both halves are
  unit-tested on a fixture that the sparse measure flags at 7 m and the same
  geometry re-digitised at 4 m flags not at all (`line-smoothness.test.js`).
  Retaining power was checked against the pre-re-centring pipeline, where the
  sawtooth this class was named for is present: the window-matched rule still
  classifies 21 of 28 WOBBLE findings BUG there (the old rule, 25 of 28).

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
Current state (2026-07-27): 11 whitelist entries — 6 `real` (WOBBLE explained
over the corridor's window, evidence in each reason) and 5 `known-bug`
(3 WOBBLE, 1 KINK, 1 SELF-CROSS). Down from 38 known-bug entries (13 KINK,
22 WOBBLE, 2 SPIKE, 1 SELF-CROSS) at 2026-07-05, via node re-centring
(brainstorm-008 PR-2) and the two reference upgrades.

The 4 residual WOBBLE sites are **not reachable by tuning the operators that
produce them**, measured 2026-07-27 across 15 whole-network configurations:
re-centring reach 0.75–2.5 × the cluster radius with hard and tapered weights
(total findings 347–551, BUG 12–25, best at the shipped 1.5 × hard) and
`BUNDLE_SIMPLIFY_EPS_DEG` from 0.1 m to 4.4 m (BUG 12–14 throughout — with
simplification effectively off the count does not drop, the detector only
re-anchors the same weave elsewhere). Whatever remains is not in either
operator's calibration.

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
