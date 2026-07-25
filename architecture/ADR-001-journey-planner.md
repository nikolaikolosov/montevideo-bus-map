# ADR-001 — Stop-to-stop journey planning on a timetable-less feed

- **Status:** accepted (2026-07-24)
- **Owner:** lead-architect
- **Context:** feature request — "route from stop A to stop B, with transfers"
- **Supersedes / superseded by:** —

## Assumptions

- Input is the committed data contract v2 (`architecture/contracts/data-contract.md`):
  1083 route variants with a LineString each, 4901 physical stops, and the
  ordered stop list per variant. **No trips, no headways, no run times.**
- The app is a buildless static site on GitHub Pages: no server, no build step,
  no runtime dependencies beyond Leaflet. Anything the planner needs must run
  in the browser, on a phone, on first interaction.
- Quality class `standard`; the deliverable is a ranking of plausible
  itineraries, not an arrival-time promise.
- Validity: the constants are measured against the 2026-07-06 dataset and
  re-checked by `npm run verify:journey` on every CI run.

## Decision

**A round-based (RAPTOR-shaped) search over a stop graph built in the browser,
ranked by an explicit, measured cost model, returning the Pareto set over
(transfers, estimated time).**

Concretely:

1. **Graph** (`src/journey.js`): nodes are physical stops. Ride edges are
   "board variant V at its k-th stop, alight at its m-th (m > k)". Walk edges
   join any two stops within `JOURNEY_WALK_MAX_M` (400 m), built with a uniform
   grid — 52,902 directed edges on the committed data, 28–33 ms to build.
2. **Search**: `JOURNEY_MAX_ROUNDS` (4) rounds; round k relaxes itineraries
   with ≤ k ride legs, so the destination label after each round is the fastest
   trip with ≤ k−1 transfers. Reading the label after every round yields the
   Pareto set directly. ~3 ms per plan.
3. **Cost model** (`CONFIG.JOURNEY_*`): in-vehicle time from distance and a
   per-stop dwell; a flat penalty per boarding standing in for the unknown
   wait; walking at 4.5 km/h. Distances are straight-line × a detour factor.
4. **Geometry** (`src/journey-geometry.js`): a drawn leg is the slice of the
   variant's own recorded trace between the two stops, cut by segment
   projection under a monotonicity constraint (loop variants pass a stop
   twice).

## Alternatives considered

| Option | Why not |
|---|---|
| **Dijkstra / A\* on a time-independent graph** | Returns one "shortest" answer and needs an explicit transfer edge per (line, line, stop) triple to price transfers at all. The round structure prices transfers for free and produces the alternatives riders actually want ("one less transfer, 6 min more"). |
| **Precompute the graph at data-update time and ship it** | Adds a build artifact and a second thing to keep in sync with the feed, to save 30 ms of client work. The data pipeline is manual (API is geo-blocked); fewer generated files is worth more than 30 ms. |
| **Transfers only at the exact same stop code** | Would find almost no transfers: the two directions of a corridor are different `COD_UBIC_P` on opposite kerbs. Measured: 3160 of 4901 stops serve >1 line, but the useful interchanges are kerb-to-kerb. |
| **Real along-route distances for the search** | Exact, and ~170 ms to project all 1083 variants. Measured (59,745 stop pairs) the traced length is 1.054 × the straight line with median 1.00 — so a factor buys the same ranking for ~0 ms. Real geometry is still used for the legs actually drawn. |
| **A routing service (OTP, Valhalla, Google)** | Needs a server and/or a paid key; the project has neither, and the feed it would ingest has no timetable either. |

## Consequences

**Positive**

- Serves J3 ("which bus takes me toward X"), listed as P0-but-unserved in
  `design/user-flows.md`, without changing the data contract or the deployment
  model.
- Alternatives are Pareto-optimal, so "fewer transfers" is always one tap away.
- The planner is pure and Leaflet-free, so it is unit-tested directly against
  real data (`tests/js/journey.test.js`).

**Negative / accepted risks**

- **Durations are estimates.** Stated in the UI on every itinerary and in
  `qa/reports/journey-planner-report.md`. Accepted: the alternative is not
  shipping the feature, since the data will not carry schedules.
- **Flat wait penalty ignores frequency.** A 4-minute trunk line and a
  40-minute peripheral line are priced identically. Would need headway data.
- **≤ 3 transfers, ≤ 400 m transfer walks.** Beyond that the search returns
  "no combination" rather than an itinerary nobody would ride.
- **Walk legs are drawn straight.** There is no pedestrian network in the feed;
  a dashed straight line is honest about being a hint, not a path.
- **One footpath hop per round, and only from a ride arrival.** A stop a walk
  reached cannot itself start the next walk, so two 400 m hops never chain into
  an 800 m walk nobody agreed to. The round keeps a ride-only label plane for
  exactly this: footpath sources are read from it while improvements are written
  to the real label, so the last-400 m walk onto a stop some slower ride also
  serves is still found (a pattern the earlier "never write onto a seed" guard
  discarded — 149 of 400 sampled pairs were up to 57 min slow, pinned now by two
  synthetic cases in `tests/js/journey.test.js`).
- The cost constants are dataset-calibrated and go stale with the data —
  mitigated by the CI drift gate (`npm run verify:journey`).

## Evidence

- `qa/reports/journey-planner-report.md` (regenerated by
  `scripts/measure_journey_model.mjs`, gates the build)
- `tests/js/journey.test.js`, `tests/js/journey-geometry.test.js`,
  `tests/js/journey-panel.test.js`, `tests/e2e/journey.spec.js`
- Rendering rules inherited from
  `architecture/contracts/route-geometry-contract.md` (R-PROJECT, R-FOREIGN)
