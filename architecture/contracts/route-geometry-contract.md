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
  Inclusion is tested against the NODE, at 1.5 × the cluster radius (36.7 m) —
  deliberately wider than the radius at which clustering merges vertices
  (24.4 m). That gap has a price: where two carriageways fan apart toward a fork,
  both are still averaged in and the corridor is drawn between them, up to
  17.9 m from any trace network-wide (line 199: strands 0–26 m apart, corridor
  12.4 m from each; 642 of 14,613 corridor vertices sit beyond 10 m, 46 beyond
  15 m, none beyond 20 m). Closing the gap was measured on 2026-07-27 and
  **rejected**: grouping the projections by mutual proximity so only strands
  clustering would have merged are averaged fixes line 199 (12.4 m → 5.6 m) and
  more than halves the tail (642 → 263 beyond 10 m, 46 → 0 beyond 15 m), but the
  per-node split decision flips along a chain and tears corridors into
  near-parallel pieces — DUPLICATE renderings 6 → 111, or 6 → 94 when a split is
  only honoured for groups of ≥2 strands, which is the artifact class
  brainstorm-008 PR-2 was built to remove. Narrowing the reach costs the same way
  (368 → 539 findings at 1.0 ×, with and without the "needs two strands" bail;
  taper weights are worse still). Stable splitting needs the strands grouped into
  bundles GLOBALLY and re-centred per bundle — a redesign of the stage, not a
  constant. Until then the tail is accepted and pinned by
  `route-invariants.test.js` (worst < 20 m, ≤ 40 vertices beyond 15 m; both fail
  at 2.0 × the reach), so it cannot grow silently.
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
  **The reference is not asked to weave at all — the corridor is asked whether it
  left the data** (`corridorFollowsData`). Every way of asking the first question
  needs a chord, and all three available chords are biased. Requiring the
  reference to grow its own window is impossible: growth stops at the first
  segment more than `WOBBLE_AXIS_DEG` off the chord, and a raw trace — vertices
  every few metres, P90 jitter 1.9 m — cannot hold a 120 m straight run however
  plainly it weaves, while the corridor it is compared against has been decimated
  to 4 m and easily does (that asymmetry, not the street, produced PR #37's
  "neither the strands nor their mean weave at all"). Measuring the reference over
  the corridor's window against the chord joining the *projections* of the window
  ends slides that chord wherever the corridor is laterally offset, under-reporting
  by 1.8–6.2 m at lines 199/L6/L77 (PR #38). Measuring against the corridor's own
  chord instead adds a constant lateral offset, which makes a genuine weave read
  one-sided.
  Since BUG means pipeline-**introduced**, and a corridor cannot have introduced a
  feature while it stays on the data, the classifier drops the chord entirely and
  measures two chord-free quantities over the window: the largest distance from a
  single chosen reference (`WOBBLE_TRACK_OFF_M`, 4.4 m — the simplify epsilon,
  deliberately stricter than the cumulative smoothing budget so the gate errs
  toward flagging) and the largest dart off that reference and back
  (`WOBBLE_TRACK_ALT_M`, 6 m = 2 × `WOBBLE_SIDE_M`). One reference is fixed for
  the whole window, so a corridor hopping between carriageways cannot pick a
  different strand per vertex and hide the hop; the sign of each offset comes from
  the window's axis, never from the reference's local heading, which on a jittery
  raw trace swings tens of degrees and would manufacture alternation out of
  digitisation noise.
  **SELF-CROSS** had no matcher at all — every corridor crossing defaulted to
  BUG — and the measure reported the first crossing segment's START vertex
  rather than the crossing. On a peripheral line those segments run for
  hundreds of metres (line E14's are 962 m and 416 m), so the finding sat 644 m
  from the junction it described and the triage card showed the wrong place,
  which is why its review could not settle anything. `measureSelfCrossings` now
  reports the crossing point, and `rawCrossingNear` asks whether the digitised
  data crosses itself within `SELF_CROSS_MATCH_M` of it — one trace with itself,
  or two traces of the line with each other. Both explain a corridor crossing,
  because the corridor is the merge of those traces: a route that leaves along
  one street and returns along another legitimately draws a polyline that
  crosses itself. At E14 the crossing point sits 0.0 m from the nearest trace
  and two strands cross each other 0.1 m from it. The matcher rejects as well as
  accepts: with smoothing disabled, line `124 Sd` develops a crossing 12.9 m off
  the nearest trace with nothing in the data within 30 m, and stays BUG.

  The same density trap applies to **KINK**, and is closed the same way
  (`rawCornerSwing`). `rawKinkNear` asks whether one raw VERTEX turns like the
  corridor's, which a densely digitised corner cannot satisfy: the corridor
  carries a junction in a single vertex while the trace spreads it over several.
  Line 192's corner is exactly that — 71° at one corridor vertex, while the
  sharpest single raw vertex within 25 m turns only 36°; measured across the
  corner's own flanks the five strands that traverse it swing 68°, a 3° match.
  The swing CLOSEST to the corridor's turn is taken, never the largest: the
  largest would let a sharp corner elsewhere in the reference set excuse a mild
  corridor corner that nothing at that spot makes. Power checked on degraded
  pipelines where corners really are pipeline-made — 2 findings stay BUG with
  smoothing off, 6 with re-centring off, 31 with both off.

  Measured over all 140 lines (2026-07-27): all 12 corridor WOBBLE findings track
  a reference within 3.6 m with at most 5.1 m of dart, so the WOBBLE known-bug
  list is empty. Power checked against the pre-re-centring pipeline, where the
  phase sawtooth this class was named for is present: 15 of 28 findings stay BUG
  there — the ten ground-truth carriageway alternations (7.3–10.6 m of dart, about
  half the 14.2 m P90 separation) plus five corridors pushed 4.5–7.4 m off the
  data without darting. The projection-chord rule called 21 of 28 BUG there, but
  six of those track a reference within 4.4 m and never dart, i.e. sit inside the
  pipeline's own displacement allowance — false positives of the biased chord, not
  power given up. Both thresholds sit inside a measured plateau (unchanged for ALT
  5–7 m; OFF weakens only at 5.5 m) and the gap they exploit is real: worst current
  dart 5.1 m, mildest sawtooth dart 7.3 m. Unit-tested in
  `line-smoothness.test.js`, including that a steady 7 m offset scores zero dart,
  that a carriageway hop scores its full amplitude, and that the verdict does not
  change when the reference is re-digitised every 4 m with 2 m of jitter.

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
Current state (2026-07-27): 11 whitelist entries, **all `real`** — every
contested WOBBLE, KINK and SELF-CROSS finding now carries its own measurement,
and **the known-bug list is empty**. Each of the three classes needed the same
correction: compare the corridor against the data over the SAME stretch, rather
than vertex-against-vertex. Down from 38 known-bug entries (13 KINK,
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
