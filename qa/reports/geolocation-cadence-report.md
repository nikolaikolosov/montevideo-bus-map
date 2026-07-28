# How often to read the rider's position

> Owner: performance-engineer · Question raised by the user, 2026-07-27
> Subject: `CONFIG.GEOLOCATION_*` and `nextRefreshMs` (src/map.js)
>
> **Status: superseded on mobile (2026-07-28).** The user asked for 1 s updates
> on the phone, which is the option this report priced and rejected. The policy
> below now applies only to the desktop locate control; what mobile does instead,
> and what it costs by these same numbers, is in "Mobile: 1 Hz by decision" at
> the end. Nothing measured here changed — only the decision it fed.

## Assumptions

- Input: the committed dataset (`routes.json` / `stops.json`, 2026-06-27),
  1,083 variants, **59,751 consecutive stop pairs**.
- Speed model: `CONFIG.JOURNEY_BUS_SPEED_KMH = 20` — the urban average
  including traffic and signals, whose measured basis is in
  `qa/reports/journey-planner-report.md`. The feed carries **no timetable**, so
  instantaneous speed per road segment is not knowable from this data.
- Estimate class: the geometry is measured; the speeds are modelled; the
  energy cost is **not measured** (see "What is not measured").
- Quality class: standard.

## The question

The rider's goal is to know _which segment of the route they are on_ — concretely,
which stop is next. Reading the position more often serves that and costs
battery; reading it less often saves battery and lies about where they are.

## The criterion

The map's answer to "which stop is next" flips once the rider is more than
halfway to the following stop. So a fix may go stale by at most **half a stop
gap** before the map starts implying the wrong stop. That is the budget; the
question is what interval keeps within it.

## Measurement — how far apart stops actually are

Consecutive stop spacing over all 59,751 pairs:

| percentile | gap       | ≈ time between stops at 20 km/h |
| ---------- | --------- | ------------------------------- |
| p5         | 155 m     | 44 s                            |
| p10        | 177 m     | 48 s                            |
| p25        | 208 m     | 54 s                            |
| **p50**    | **268 m** | **66 s**                        |
| p75        | 341 m     | 80 s                            |
| p90        | 432 m     | 97 s                            |
| p95        | 487 m     | 107 s                           |

## What a fixed interval buys

Share of stop pairs where the shown position still implies the right stop:

| interval          | riding, 20 km/h | walking, 4.5 km/h | fixes/hour |
| ----------------- | --------------- | ----------------- | ---------- |
| 5 s               | 100 %           | 100 %             | 720        |
| 10 s              | 99.3 %          | 100 %             | 360        |
| 12 s              | 98.0 %          | 100 %             | 300        |
| 15 s              | 92.5 %          | 100 %             | 240        |
| 20 s              | 68.4 %          | 100 %             | 180        |
| **30 s (before)** | **26.9 %**      | 99.9 %            | 120        |
| 45 s              | 4.5 %           | 99.1 %            | 80         |
| 60 s              | 1.6 %           | 95.8 %            | 60         |

Two conclusions decide the design:

1. **30 s failed the goal.** On 73 % of stop pairs a 30 s-old fix can already
   imply the wrong stop — at 20 km/h it is 167 m stale, which is 0.94 of a p10
   gap. The complaint that started this work was that the position was frozen;
   the fix for that (PR #42) chose 30 s without this measurement.
2. **The needed cadence differs ~4× between riding and standing.** Walking is
   still fine at 45 s; riding is not fine at 20 s. No single constant is right
   for both, and a session contains both.

## The policy

    interval = GEOLOCATION_STALE_BUDGET_M / speed, clamped to [10 s, 45 s]

with speed taken from the last two fixes, and displacement below the reported
accuracy treated as zero — a stationary phone wanders inside its own error
circle, and reading that as motion would hold the GPS at the riding rate next to
a bus stop.

| constant                       | value | why                                                                                                                                                                                                     |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEOLOCATION_STALE_BUDGET_M`   | 88 m  | half the **p10** gap (177 m). Derived from p10, not the median, so the dense downtown — where riders most need it — is the case that is served                                                          |
| `GEOLOCATION_MIN_REFRESH_MS`   | 10 s  | at 10 s the budget already holds on 99.3 % of pairs while riding; halving again to 5 s buys 0.7 pp for twice the reads                                                                                  |
| `GEOLOCATION_MAX_REFRESH_MS`   | 45 s  | standing still, nothing changes, so the only reason to read is to notice motion resumed — this bounds that latency to one interval, and 45 s still holds the budget on 99.1 % of pairs at walking speed |
| `GEOLOCATION_FIRST_REFRESH_MS` | 15 s  | before a second fix there is no speed; 15 s is the fixed cadence that would hold the budget on 92.5 % of pairs while riding                                                                             |

Because the budget _is_ the p10 half-gap, coverage is **constant at 90.2 %**
across the whole speed range where neither clamp binds:

| speed              | interval       | staleness | pairs still implying the right stop |
| ------------------ | -------------- | --------- | ----------------------------------- |
| 0 (standing)       | 45.0 s         | 0 m       | 100 %                               |
| 4.5 km/h (walking) | 45.0 s         | 56 m      | 99.1 %                              |
| 10 km/h            | 31.7 s         | 88 m      | 90.2 %                              |
| 20 km/h            | 15.8 s         | 88 m      | 90.2 %                              |
| 30 km/h            | 10.6 s         | 88 m      | 90.2 %                              |
| 40 km/h            | 10.0 s (floor) | 111 m     | 68.4 %                              |
| 60 km/h            | 10.0 s (floor) | 167 m     | 26.9 %                              |

## Cost

The exactly controllable quantity is the number of position reads. Over a
30-minute session (5 min walking to the stop, 5 min waiting, 20 min riding):

| cadence                           | reads  | riding coverage |
| --------------------------------- | ------ | --------------- |
| fixed 30 s (before)               | 60     | 26.9 %          |
| **this policy**                   | **89** | **90.2 %**      |
| fixed 15 s                        | 120    | 92.5 %          |
| fixed 1 s (the ideal asked about) | 1,800  | 100 %           |

So the policy buys a 3.4× improvement in correctness for 1.5× the reads, and
costs 26 % fewer reads than the fixed 15 s that would score marginally better.
Against the 1 s ideal it is **20× cheaper** for 10 pp less coverage — and those
10 pp are pairs where the rider is between two stops less than 177 m apart, i.e.
where both stops are within sight anyway.

## What is rejected, and why

- **1 s.** 1,800 reads per session for the last 10 pp. It also samples far below
  the point where the answer stops changing: at 1 s the bus has moved 5.6 m,
  well inside any consumer GNSS error circle, so most of those reads report
  noise rather than travel.
- **Keeping 30 s.** Fails the stated goal on 73 % of stop pairs.
- **A fixed 15 s.** Correct while riding, but spends the riding rate while the
  rider stands at a stop, which is where a third of a typical session goes.
- **`watchPosition`.** Hands the cadence to the platform, which with
  `enableHighAccuracy` keeps the receiver continuously engaged — the opposite of
  the duty-cycling this policy exists to do.

## What is not measured

- **Energy.** No power measurement was taken; there is no instrumented device in
  this project's CI, and no vendor figure is quoted because none applies to an
  arbitrary browser on arbitrary hardware. Every claim above is in _reads_, which
  is exact and directly controllable. The assumption that fewer reads with a
  sleeping receiver cost less than more reads is the only unmeasured premise, and
  it is the one the W3C API's `maximumAge`/`enableHighAccuracy` knobs exist to
  express.
- **GNSS accuracy in a bus.** Not measured here; the policy consumes the
  browser-reported `accuracy` per fix rather than assuming a value.
- **Speed/gap correlation.** The high-speed rows apply the _global_ gap
  distribution, but buses only reach 40+ km/h on stretches where stops are far
  apart — so those rows understate real coverage. Quantifying it needs travel
  times the feed does not carry.

## Verification

- `tests/js/geolocation.test.js` — the policy as a pure function: stationary and
  walking hit the cap, riding lands between the clamps, high speed hits the
  floor, jitter under the reported accuracy is not motion.
- `tests/e2e/geolocation.spec.js` — `on a fine pointer (desktop) › reads the
position far less often standing still than riding`: same 3-minute span in both
  phases under Playwright's clock; ≤5 reads standing versus ≥2× that riding.
  Verified to fail against a fixed cadence (12 reads standing).

## Mobile: 1 Hz by decision (2026-07-28)

The user asked for the position to update once a second on the phone. That is
the "1 s" row this report priced and rejected, and the user reaffirmed it after
the trade-off was stated, so it ships on mobile. The measurements are unchanged;
what changed is which side of them is chosen:

| | mobile (now) | desktop locate control |
| --- | --- | --- |
| mechanism | `watchPosition` + 1 Hz floor | `getCurrentPosition` on a self-rescheduling timer |
| cadence | 1 s | 88 m / speed, clamped to [10 s, 45 s] |
| riding coverage (by the table above) | 100 % | 90.2 % |
| position reads per 30-min session | ~1,800 | ~89 |
| receiver | continuously engaged | duty-cycled |

What buys the last 10 pp is stated plainly: those are stop pairs closer than
177 m, where both stops are within sight anyway. The gain the rider actually
sees is smoothness — the dot moves with the bus instead of jumping every 10–45 s.

Implementation notes that follow from the cadence, not from taste:

- **A watch, not a 1 Hz poll.** `watchPosition` is what keeps a phone's receiver
  engaged and pushes each fix it makes; asking `getCurrentPosition` every second
  with `maximumAge: 0` would restart an acquisition per read and deliver *less
  often* than the watch, not more. The report's rejection of `watchPosition` was
  a rejection of continuous engagement — which is precisely what 1 Hz asks for.
- **The 1 Hz ticker is a floor, not the source.** It reads only when the watch
  has said nothing for a full interval (a provider that reports on change only,
  or a watch gone quiet), and accepts a fix up to one interval old, so on a phone
  where the watch is chatty it never fires.
- **Faster-than-1 Hz pushes are dropped** (`isFixDue`, gated at
  `GEOLOCATION_LIVE_MIN_GAP_MS` = 750 ms so a nominal-1 Hz platform's jitter does
  not halve the delivered rate). Some platforms deliver on every sensor update;
  redrawing and re-centring the map several times a second for metres of GNSS
  noise is not what "once a second" asked for.
- **Camera moves stop animating while following at 1 Hz.** An in-flight pan
  leaves the camera between two fixes, which the follow policy reads as "someone
  else moved the map" — following would switch itself off within seconds.
- **The pauses that bound the cost stay.** A hidden tab ends the watch (not just
  the reads), and a denied permission ends the session.

Unchanged from the rest of this report: energy is **not** measured, here or
before. The honest statement is that a continuously engaged receiver costs more
than a duty-cycled one, by an amount this project cannot quantify.

Verification: `tests/js/geolocation.test.js` (`isFixDue`) and, in
`tests/e2e/geolocation.spec.js`, `the mobile track refreshes the position once a
second` — 30 reads in 30 mocked seconds, every gap one interval, against a stub
platform whose watch never pushes; plus `mobile keeps a continuous high-accuracy
watch running` and `a move shows on the map within a second`.
