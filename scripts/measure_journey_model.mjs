/**
 * Journey cost-model evidence: measures the properties of the committed
 * dataset that the planner's constants (src/config.js, `JOURNEY_*`) are sized
 * against, writes the report, and FAILS when a constant no longer matches
 * what the data says — the same drift gate `verify:scales` applies to the
 * geometry ladder.
 *
 * Run: npm run verify:journey     (part of the data-update runbook step)
 *
 * Measured:
 *
 *  1. BUS DETOUR FACTOR — for every pair of consecutive stops on every route
 *     variant, the length of the trace actually driven between them (sliced
 *     with the production projection, journey-geometry.js) divided by the
 *     straight line between the two stops. Its aggregate is what
 *     JOURNEY_BUS_DETOUR_FACTOR must equal: the planner charges
 *     straight-line × factor because projecting all 1083 variants on every
 *     plan would cost ~170 ms.
 *
 *  2. FOOTPATH GRAPH — how many transfer walks the JOURNEY_WALK_MAX_M radius
 *     actually yields, and how they are distributed per stop. This is the
 *     search's inner loop; a radius change shows up here first.
 *
 *  3. DRAWN vs CHARGED — for planned journeys, the drawn leg length over the
 *     distance the planner charged for. Confirms the slices land on the right
 *     stretch of route (the tail is real: short hops where the bus loops a
 *     block).
 *
 *  4. REACHABILITY — share of stops reachable from a central stop. A planner
 *     that silently fails over half the city would still "pass" every
 *     structural test.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { CONFIG } = await import('../src/config.js');
const { buildIndexes, stopsByVariant, uniqueStopByCode } = await import('../src/data.js');
const { buildJourneyGraph, planJourney } = await import('../src/journey.js');
const { patternPositions, sliceAtPositions, rideLegGeometry } =
    await import('../src/journey-geometry.js');
const { polylineLengthM, segmentLengthM } = await import('../src/geometry.js');

// --- Measurement parameters (method, committed with the report) ------------
/** Stop pairs closer than this are ignored: the ratio explodes on noise. */
const MIN_PAIR_M = 20;
/** Origin/destination pairs sampled for the drawn-vs-charged check. */
const PLAN_SAMPLES = 200;
/** Every Nth stop is a reachability target. */
const REACH_STRIDE = 17;
/** Central reference stop (BUENOS AIRES y ITUZAINGO, 34 lines). */
const REACH_ORIGIN = 4772;
/** Allowed drift of the configured detour factor from the measured one. */
const DETOUR_TOLERANCE = 0.05;
/** Reachability floor from the central stop. */
const MIN_REACH_SHARE = 0.9;

const routesData = JSON.parse(readFileSync(join(root, 'routes.json'), 'utf8'));
const stopsData = JSON.parse(readFileSync(join(root, 'stops.json'), 'utf8'));
buildIndexes(routesData, stopsData);

const t0 = Date.now();
const graph = buildJourneyGraph();
const buildMs = Date.now() - t0;

const percentile = (sorted, p) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
        n: sorted.length,
        min: sorted[0],
        p05: percentile(sorted, 0.05),
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted[sorted.length - 1],
    };
};

// --- 1. Bus detour factor ---------------------------------------------------
let tracedTotal = 0;
let straightTotal = 0;
const detourRatios = [];
const interStop = [];

for (const [variantId] of stopsByVariant) {
    const prepared = patternPositions(variantId);
    if (!prepared) continue;
    const { coords, positions, stopCodes } = prepared;
    for (let i = 1; i < positions.length; i++) {
        if (!(positions[i] > positions[i - 1])) continue;
        const a = uniqueStopByCode.get(stopCodes[i - 1]).geometry.coordinates;
        const b = uniqueStopByCode.get(stopCodes[i]).geometry.coordinates;
        const straight = segmentLengthM(a, b);
        if (straight < MIN_PAIR_M) continue;
        const traced = polylineLengthM(sliceAtPositions(coords, positions[i - 1], positions[i]));
        tracedTotal += traced;
        straightTotal += straight;
        detourRatios.push(traced / straight);
        interStop.push(straight);
    }
}
const measuredDetour = tracedTotal / straightTotal;

// --- 2. Footpath graph ------------------------------------------------------
let walkEdges = 0;
const walkDegrees = [];
for (let i = 0; i < graph.codes.length; i++) {
    walkEdges += graph.walkTo[i].length;
    walkDegrees.push(graph.walkTo[i].length);
}
const patternStopEntries = graph.patterns.reduce((sum, p) => sum + p.stops.length, 0);

// --- 3. Plans: timing, options, drawn vs charged ----------------------------
const drawnRatios = [];
const planMs = [];
let planned = 0;
let noRoute = 0;
let rideLegs = 0;
let nullGeometry = 0;
const optionCounts = [];
const transferCounts = [];

for (let i = 0; i < PLAN_SAMPLES; i++) {
    const from = graph.codes[(i * 811) % graph.codes.length];
    const to = graph.codes[(i * 1637 + 400) % graph.codes.length];
    if (from === to) continue;
    const started = Date.now();
    const { status, options } = planJourney(from, to);
    planMs.push(Date.now() - started);
    if (status !== 'ok') {
        noRoute++;
        continue;
    }
    planned++;
    optionCounts.push(options.length);
    transferCounts.push(options[0].transfers);
    for (const option of options) {
        for (const leg of option.legs) {
            if (leg.type !== 'ride') continue;
            rideLegs++;
            const geometry = rideLegGeometry(leg.variantId, leg.boardIdx, leg.alightIdx);
            if (!geometry) {
                nullGeometry++;
                continue;
            }
            drawnRatios.push(polylineLengthM(geometry) / leg.meters);
        }
    }
}

// --- 4. Reachability --------------------------------------------------------
const targets = graph.codes.filter((_, i) => i % REACH_STRIDE === 0);
const reached = targets.filter(
    (code) => code === REACH_ORIGIN || planJourney(REACH_ORIGIN, code).status === 'ok',
).length;
const reachShare = reached / targets.length;

// --- Assertions -------------------------------------------------------------
const failures = [];
const detourDrift = Math.abs(measuredDetour - CONFIG.JOURNEY_BUS_DETOUR_FACTOR);
if (detourDrift > DETOUR_TOLERANCE) {
    failures.push(
        `JOURNEY_BUS_DETOUR_FACTOR is ${CONFIG.JOURNEY_BUS_DETOUR_FACTOR}, data says ` +
            `${measuredDetour.toFixed(3)} (drift ${detourDrift.toFixed(3)} > ${DETOUR_TOLERANCE})`,
    );
}
if (reachShare < MIN_REACH_SHARE) {
    failures.push(
        `only ${(reachShare * 100).toFixed(1)} % of sampled stops reachable from ${REACH_ORIGIN} ` +
            `(floor ${(MIN_REACH_SHARE * 100).toFixed(0)} %)`,
    );
}
if (nullGeometry > 0) {
    failures.push(`${nullGeometry} planned ride leg(s) have no drawable geometry`);
}

const detour = stats(detourRatios);
const drawn = stats(drawnRatios);
const gap = stats(interStop);
const degree = stats(walkDegrees);
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

const report = `# Journey Planner — Cost-Model Evidence

> Generated by \`npm run verify:journey\` (\`scripts/measure_journey_model.mjs\`).
> Data: \`routes.json\` / \`stops.json\` generated at ${stopsData.generated_at}.
> Regenerate after every data update; the script FAILS the build on drift.

## Assumptions

- The feed carries **no timetable** — no trips, headways or run times. Every
  duration the planner reports is an estimate from the model below, and the UI
  says so ("Tiempos estimados: los datos no traen horarios ni frecuencias").
- Estimate class: **rough order of magnitude** for absolute durations,
  **representative** for ranking one itinerary against another (the ranking is
  what the feature actually sells).
- Measured on the committed dataset only; validity ends at the next data
  update, which is why the drift gate runs in CI.

## 1. Bus detour factor (the constant the planner charges with)

Traced route length between consecutive stops ÷ straight line, over every
variant in the feed.

| metric | value |
|---|---|
| stop pairs measured | ${detour.n} |
| **aggregate (Σ traced ÷ Σ straight)** | **${measuredDetour.toFixed(3)}** |
| configured \`JOURNEY_BUS_DETOUR_FACTOR\` | ${CONFIG.JOURNEY_BUS_DETOUR_FACTOR} |
| ratio p05 / p50 / p95 / p99 / max | ${detour.p05.toFixed(2)} / ${detour.p50.toFixed(2)} / ${detour.p95.toFixed(2)} / ${detour.p99.toFixed(2)} / ${detour.max.toFixed(2)} |
| inter-stop straight distance p50 / p95 | ${gap.p50.toFixed(0)} m / ${gap.p95.toFixed(0)} m |

The median is ~1.00: consecutive stops are ~${gap.p50.toFixed(0)} m apart and the street
between them is essentially straight. The aggregate sits above it because a
minority of hops loop a block or a terminal.

The pedestrian factor (\`JOURNEY_WALK_DETOUR_FACTOR\` = ${CONFIG.JOURNEY_WALK_DETOUR_FACTOR}) is **not**
measurable from this data — there is no pedestrian network in the feed. It is
the textbook rectilinear-grid detour (4/π ≈ 1.27), which is what central
Montevideo is, and is documented as an assumption rather than evidence.

## 2. Graph the search runs on

| metric | value |
|---|---|
| stops (nodes) | ${graph.codes.length} |
| route variants (patterns) | ${graph.patterns.length} |
| pattern-stop entries | ${patternStopEntries} |
| footpath edges (directed, ≤ ${CONFIG.JOURNEY_WALK_MAX_M} m) | ${walkEdges} |
| footpaths per stop mean / p95 / max | ${mean(walkDegrees).toFixed(1)} / ${degree.p95} / ${degree.max} |
| graph build | ${buildMs} ms |

## 3. Search behaviour on ${planned} sampled origin/destination pairs

| metric | value |
|---|---|
| pairs sampled | ${planMs.length} |
| planned / no route | ${planned} / ${noRoute} |
| plan time mean / max | ${mean(planMs).toFixed(1)} ms / ${Math.max(...planMs)} ms |
| itineraries offered, mean | ${mean(optionCounts).toFixed(2)} |
| transfers in the best itinerary, mean | ${mean(transferCounts).toFixed(2)} |
| ride legs across all offered itineraries | ${rideLegs} |

### Drawn vs charged (ride legs)

Length of the drawn slice ÷ the distance the planner charged for, over
${drawn.n} ride legs (${nullGeometry} leg(s) without drawable geometry).

| metric | value |
|---|---|
| min / p05 / p50 / p95 / p99 / max | ${drawn.min.toFixed(2)} / ${drawn.p05.toFixed(2)} / ${drawn.p50.toFixed(2)} / ${drawn.p95.toFixed(2)} / ${drawn.p99.toFixed(2)} / ${drawn.max.toFixed(2)} |

The median is ~1.00 by construction (§1). The upper tail is real geometry, not
slicing error: a two-stop hop where the bus goes around a block is genuinely
about twice its straight line. \`tests/js/journey-geometry.test.js\` gates the
median tightly and the tail loosely for exactly this reason.

## 4. Reachability

From stop ${REACH_ORIGIN} to every ${REACH_STRIDE}th stop: **${reached}/${targets.length}
(${(reachShare * 100).toFixed(1)} %)** reachable within ${CONFIG.JOURNEY_MAX_ROUNDS} rounds
(≤ ${CONFIG.JOURNEY_MAX_ROUNDS - 1} transfers). The remainder are peripheral stops served
by variants that only run inbound, plus stops whose own line needs a fourth
ride to be joined.

## Assertion results

${failures.length === 0 ? 'All assertions PASS.' : failures.map((f) => `- FAIL: ${f}`).join('\n')}
`;

mkdirSync(join(root, 'qa', 'reports'), { recursive: true });
writeFileSync(join(root, 'qa', 'reports', 'journey-planner-report.md'), report);

console.log(
    `bus detour factor: measured ${measuredDetour.toFixed(3)}, configured ${CONFIG.JOURNEY_BUS_DETOUR_FACTOR}`,
);
console.log(
    `footpath edges: ${walkEdges}, graph build ${buildMs} ms, plan mean ${mean(planMs).toFixed(1)} ms`,
);
console.log(`reachability from ${REACH_ORIGIN}: ${(reachShare * 100).toFixed(1)} %`);
console.log('\nReport written to qa/reports/journey-planner-report.md');

if (failures.length > 0) {
    console.error(`\n${failures.length} assertion(s) failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
