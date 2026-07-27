/**
 * Journey planner: the round-based (RAPTOR-shaped) stop-to-stop search in
 * src/journey.js.
 *
 * Two layers, the pattern the repo already uses for route work:
 *  - a synthetic network where every expected itinerary is known by hand, so
 *    the boarding rule, the transfer penalty, the walk radius and the round
 *    limit are each pinned by a case that fails if the rule changes;
 *  - the REAL committed data, where the assertions are structural invariants
 *    (leg chains actually connect, ride legs follow their variant's ordinals,
 *    the option list is Pareto-optimal) checked over a deterministic sample.
 *
 * Geographic note: the synthetic stops sit far outside Montevideo on purpose.
 * data.js indexes are additive across buildIndexes() calls, so the fixture
 * must not be able to interact with the real stops through walk edges.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONFIG } from '../../src/config.js';
import { M_PER_DEG_LON, M_PER_DEG_LAT } from '../../src/geometry.js';
import { buildIndexes, stopsByVariant, uniqueStopsData } from '../../src/data.js';
import {
    buildJourneyGraph,
    planJourney,
    isPlannableStop,
    resetJourneyGraph,
} from '../../src/journey.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// --- Synthetic network -------------------------------------------------------

const LON0 = -70;
const LAT0 = -20;
/** Stop feature `east`/`north` meters from the fixture origin. */
const at = (cod, east, north) => ({
    type: 'Feature',
    geometry: {
        type: 'Point',
        coordinates: [LON0 + east / M_PER_DEG_LON, LAT0 + north / M_PER_DEG_LAT],
    },
    properties: { COD_UBIC_P: cod, CALLE: `S${cod}`, ESQUINA: 'X' },
});

const A = 900001;
const B = 900002;
const C = 900003;
const E = 900004;
const F = 900005;
const G = 900006;
const H = 900007;
const D = 900008;
const FAR = 900009;
/** Five-hop chain: c0 → c5, one line per hop, hops too long to walk. */
const CHAIN = [900100, 900101, 900102, 900103, 900104, 900105];
/**
 * Egress-walk cluster. Line 7 runs J1 → J2 and stops 120 m short of J4; line 8
 * crawls J1 → J3 → J4 the long way round. Both J2 and J4 are therefore reached
 * by a ride in the SAME round, which is the configuration that used to lose the
 * "ride the fast line, walk the last block" answer.
 */
const J1 = 900201;
const J2 = 900202;
const J3 = 900203;
const J4 = 900204;
/**
 * Footpath-source cluster. S3 sits 100 m from line 9's terminus S2, so a
 * round-1 footpath reaches it far more cheaply than line 10's round-2 ride ever
 * could — and S4 is walkable only from S3 (450 m from S2, outside the radius).
 */
const S1 = 900301;
const S2 = 900302;
const S3 = 900303;
const S4 = 900304;

const syntheticStops = {
    type: 'FeatureCollection',
    format_version: 2,
    generated_at: '2026-06-27T11:37:49-03:00',
    features: [
        at(A, 0, 0),
        at(B, 500, 0),
        at(C, 1000, 0),
        at(E, 1000, 100), // 100 m from C — a walkable transfer
        at(F, 3000, 100),
        at(G, 0, 50000), // no service, far away
        at(H, 90, 0), // 90 m from A, no service — walk-only destination
        at(D, 5000, 0), // clear of F's walk radius, so A→F must transfer
        at(FAR, 0, 500), // no service, beyond the walk radius
        ...CHAIN.map((cod, i) => at(cod, i * 1500, 20000)),
        at(J1, 0, 70000),
        at(J2, 2000, 70000),
        at(J3, 0, 75000), // line 8's detour, unwalkable from anywhere
        at(J4, 2000, 70120), // 120 m from J2 — and served by line 8
        at(S1, 0, 100000),
        at(S2, 3000, 100000),
        at(S3, 3000, 100100), // 100 m from S2
        at(S4, 3000, 100450), // 350 m from S3, 450 m from S2 — no service
    ],
    patterns: {
        p1: {
            linea: '1',
            paradas: [
                [A, 1],
                [B, 2],
                [C, 3],
            ],
        },
        p2: {
            linea: '2',
            paradas: [
                [E, 1],
                [F, 2],
            ],
        },
        p3: {
            linea: '3',
            paradas: [
                [A, 1],
                [D, 2],
            ],
        },
        p4: {
            linea: '4',
            paradas: [
                [B, 1],
                [D, 2],
            ],
        },
        p7: {
            linea: '7',
            paradas: [
                [J1, 1],
                [J2, 2],
            ],
        },
        p8: {
            linea: '8',
            paradas: [
                [J1, 1],
                [J3, 2],
                [J4, 3],
            ],
        },
        p9: {
            linea: '9',
            paradas: [
                [S1, 1],
                [S2, 2],
            ],
        },
        p10: {
            linea: '10',
            paradas: [
                [S2, 1],
                [S3, 2],
            ],
        },
        ...Object.fromEntries(
            CHAIN.slice(1).map((cod, i) => [
                `q${i}`,
                {
                    linea: `5${i}`,
                    paradas: [
                        [CHAIN[i], 1],
                        [cod, 2],
                    ],
                },
            ]),
        ),
    },
};

/** Minimal route features so patterns resolve a line id and a headsign. */
const syntheticRoutes = {
    type: 'FeatureCollection',
    features: Object.entries(syntheticStops.patterns).map(([variantId, pattern]) => ({
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: pattern.paradas.map(
                ([cod]) =>
                    syntheticStops.features.find((f) => f.properties.COD_UBIC_P === cod).geometry
                        .coordinates,
            ),
        },
        properties: {
            COD_VARIAN: variantId,
            DESC_LINEA: pattern.linea,
            DESC_VARIA: `to ${pattern.paradas.at(-1)[0]}`,
        },
    })),
};

const lines = (option) => option.legs.filter((l) => l.type === 'ride').map((l) => l.line);
const kinds = (option) => option.legs.map((l) => l.type);

describe('planJourney (synthetic network)', () => {
    beforeAll(() => {
        buildIndexes(syntheticRoutes, syntheticStops);
        resetJourneyGraph();
        buildJourneyGraph();
    });

    it('finds the direct ride and reports no transfers', () => {
        const { status, options } = planJourney(A, C);
        expect(status).toBe('ok');
        expect(options.length).toBeGreaterThan(0);
        const best = options[0];
        expect(lines(best)).toEqual(['1']);
        expect(kinds(best)).toEqual(['ride']);
        expect(best.transfers).toBe(0);
        expect(best.walkMeters).toBe(0);
    });

    it('rides only forward along a pattern', () => {
        const leg = planJourney(A, C).options[0].legs[0];
        expect(leg.boardIdx).toBe(0);
        expect(leg.alightIdx).toBe(2);
        expect(leg.stopCodes).toEqual([A, B, C]);
        expect(leg.fromCode).toBe(A);
        expect(leg.toCode).toBe(C);
        expect(leg.meters).toBeGreaterThan(0);
    });

    it('transfers across a short walk between two different stops', () => {
        const { status, options } = planJourney(A, F);
        expect(status).toBe('ok');
        const best = options[0];
        expect(kinds(best)).toEqual(['ride', 'walk', 'ride']);
        expect(lines(best)).toEqual(['1', '2']);
        expect(best.transfers).toBe(1);
        // 100 m apart, scaled by the documented pedestrian detour factor.
        expect(best.walkMeters).toBeCloseTo(100 * CONFIG.JOURNEY_WALK_DETOUR_FACTOR, 5);
    });

    it('prefers staying seated over an equally long trip with a transfer', () => {
        // Line 3 runs A → D (5000 m). Lines 1 + 4 cover the same 5000 m but
        // cost one extra boarding, so the direct ride must win — and the
        // dominated alternative must not be offered at all.
        const { options } = planJourney(A, D);
        expect(lines(options[0])).toEqual(['3']);
        expect(options[0].transfers).toBe(0);
        expect(options.every((o) => o.transfers === 0)).toBe(true);
    });

    it('walks the last block onto a stop a slower ride also serves', () => {
        // Line 7 drops the rider 120 m short of J4; line 8 reaches J4 itself,
        // the long way round. Both stops are ride-improved in the same round,
        // so the fast answer exists only if a footpath may improve a stop this
        // round's rides also reached (otherwise the 5 km crawl on line 8 wins).
        const { status, options } = planJourney(J1, J4);
        expect(status).toBe('ok');
        const best = options[0];
        expect(kinds(best)).toEqual(['ride', 'walk']);
        expect(lines(best)).toEqual(['7']);
        expect(best.transfers).toBe(0);
        expect(best.legs[0].toCode).toBe(J2);
        expect(best.walkMeters).toBeCloseTo(120 * CONFIG.JOURNEY_WALK_DETOUR_FACTOR, 5);
        // Riding line 8 all the way is legal, just far worse — never the answer.
        expect(best.rideMeters).toBeCloseTo(2000 * CONFIG.JOURNEY_BUS_DETOUR_FACTOR, 5);
    });

    it('a ride into a walk-reached stop still opens that stop’s footpaths', () => {
        // A round-1 footpath puts S3 within ~100 s of S2, so line 10's round-2
        // ride into S3 is dearer than the label already there. S4 hangs off S3
        // alone, so it is reachable at all only while that dearer ride arrival
        // still counts as a footpath source.
        const { status, options } = planJourney(S1, S4);
        expect(status).toBe('ok');
        const best = options[0];
        expect(kinds(best)).toEqual(['ride', 'ride', 'walk']);
        expect(best.legs.at(-1).fromCode).toBe(S3);
        expect(best.legs.at(-1).toCode).toBe(S4);
        expect(best.walkMeters).toBeCloseTo(350 * CONFIG.JOURNEY_WALK_DETOUR_FACTOR, 5);
    });

    it('walks the whole way when the destination is close and unserved', () => {
        const { status, options } = planJourney(A, H);
        expect(status).toBe('ok');
        expect(kinds(options[0])).toEqual(['walk']);
        expect(options[0].transfers).toBe(0);
        expect(options[0].rideMeters).toBe(0);
    });

    it('does not walk past the configured radius', () => {
        expect(planJourney(A, FAR).status).toBe('no-route');
        expect(CONFIG.JOURNEY_WALK_MAX_M).toBeLessThan(500);
    });

    it('reports no-route for an unreachable stop', () => {
        expect(planJourney(A, G)).toEqual({ status: 'no-route', options: [] });
    });

    it('gives up beyond the round limit instead of returning a fantasy', () => {
        const hops = CHAIN.length - 1;
        expect(hops).toBeGreaterThan(CONFIG.JOURNEY_MAX_ROUNDS);
        // One round short of the chain is still solvable…
        expect(planJourney(CHAIN[0], CHAIN[CONFIG.JOURNEY_MAX_ROUNDS]).status).toBe('ok');
        // …one hop further needs more rides than the search allows.
        expect(planJourney(CHAIN[0], CHAIN.at(-1)).status).toBe('no-route');
    });

    it('rejects a same-stop or unknown-stop request', () => {
        expect(planJourney(A, A).status).toBe('same');
        expect(planJourney(A, 123456789).status).toBe('unknown-stop');
        expect(planJourney(123456789, A).status).toBe('unknown-stop');
    });

    it('accepts stop codes as strings (URL parsing hands them over raw)', () => {
        expect(planJourney(String(A), String(C)).status).toBe('ok');
        expect(isPlannableStop(String(A))).toBe(true);
        expect(isPlannableStop(123456789)).toBe(false);
    });

    it('is deterministic', () => {
        const once = planJourney(A, F);
        const twice = planJourney(A, F);
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    });

    it('accounts every second: legs + boarding penalties = the total', () => {
        for (const [from, to] of [
            [A, C],
            [A, F],
            [A, D],
            [A, H],
        ]) {
            for (const option of planJourney(from, to).options) {
                const legSeconds = option.legs.reduce((sum, l) => sum + l.seconds, 0);
                expect(option.seconds).toBeCloseTo(legSeconds + option.waitSeconds, 6);
                expect(option.waitSeconds).toBe(
                    lines(option).length * CONFIG.JOURNEY_BOARD_PENALTY_SECONDS,
                );
            }
        }
    });
});

// --- Real committed data -----------------------------------------------------

describe('planJourney (real data)', () => {
    let graph;

    beforeAll(() => {
        const routesData = JSON.parse(readFileSync(join(ROOT, 'routes.json'), 'utf8'));
        const stopsData = JSON.parse(readFileSync(join(ROOT, 'stops.json'), 'utf8'));
        buildIndexes(routesData, stopsData);
        resetJourneyGraph();
        graph = buildJourneyGraph();
    });

    it('indexes every stop and every route variant', () => {
        expect(graph.codes.length).toBe(uniqueStopsData.length);
        expect(graph.patterns.length).toBe(stopsByVariant.size);
        expect(graph.codes.length).toBeGreaterThanOrEqual(4000);
        expect(graph.patterns.length).toBeGreaterThanOrEqual(1000);
    });

    it('builds a symmetric walk graph inside the configured radius', () => {
        const distance = (i, j) =>
            Math.hypot(
                (graph.lon[j] - graph.lon[i]) * M_PER_DEG_LON,
                (graph.lat[j] - graph.lat[i]) * M_PER_DEG_LAT,
            );
        let edges = 0;
        for (let i = 0; i < graph.codes.length; i += 7) {
            for (const j of graph.walkTo[i]) {
                edges++;
                expect(j).not.toBe(i);
                expect(distance(i, j)).toBeLessThanOrEqual(CONFIG.JOURNEY_WALK_MAX_M + 1e-6);
                expect([...graph.walkTo[j]]).toContain(i); // symmetric
            }
        }
        expect(edges).toBeGreaterThan(0);
    });

    it('contains EVERY footpath within the radius, not just valid ones', () => {
        // The test above checks that every edge present is short and symmetric —
        // properties a MISSING edge also satisfies, so it cannot see the grid
        // dropping neighbours. The walk grid finds neighbours with a 3×3 cell
        // sweep, which is only complete while one cell spans >= radius METERS on
        // both axes; sizing it off M_PER_DEG_LAT alone left that true for the
        // longitude axis by margin only, and 354 real edges disappear if the
        // factor is dropped. Brute force is the assertion that notices.
        const R = CONFIG.JOURNEY_WALK_MAX_M;
        const n = graph.codes.length;
        const distance = (i, j) =>
            Math.hypot(
                (graph.lon[j] - graph.lon[i]) * M_PER_DEG_LON,
                (graph.lat[j] - graph.lat[i]) * M_PER_DEG_LAT,
            );

        let expected = 0;
        const missing = [];
        // Every 3rd stop as an anchor, against ALL stops: a mis-sized cell
        // cannot hide from a full scan of the other endpoint.
        for (let i = 0; i < n; i += 3) {
            const have = new Set(graph.walkTo[i]);
            for (let j = 0; j < n; j++) {
                if (i === j || distance(i, j) > R) continue;
                expected++;
                if (!have.has(j)) missing.push(`${graph.codes[i]}→${graph.codes[j]}`);
            }
        }
        // Not vacuous: the sweep really does have thousands of edges to find.
        expect(expected).toBeGreaterThan(5000);
        expect(missing.slice(0, 5), `${missing.length} footpaths missing`).toEqual([]);
    }, 30_000);

    it('plans a known city-centre trip', () => {
        // BUENOS AIRES y ITUZAINGO → AV 18 DE JULIO y CONVENCION, ~1 km apart.
        const { status, options } = planJourney(4772, 4018);
        expect(status).toBe('ok');
        expect(options[0].transfers).toBe(0);
        expect(options[0].seconds).toBeLessThan(45 * 60);
    });

    /** Deterministic spread of origin/destination pairs across the network. */
    const samplePairs = (graph_, count) =>
        Array.from({ length: count }, (_, i) => [
            graph_.codes[(i * 811) % graph_.codes.length],
            graph_.codes[(i * 1637 + 400) % graph_.codes.length],
        ]).filter(([a, b]) => a !== b);

    it('returns itineraries whose legs actually connect end to end', () => {
        let planned = 0;
        for (const [from, to] of samplePairs(graph, 40)) {
            const { status, options } = planJourney(from, to);
            if (status !== 'ok') continue;
            planned++;
            for (const option of options) {
                expect(option.legs.length).toBeGreaterThan(0);
                expect(option.legs[0].fromCode).toBe(from);
                expect(option.legs.at(-1).toCode).toBe(to);
                for (let i = 1; i < option.legs.length; i++) {
                    expect(option.legs[i].fromCode).toBe(option.legs[i - 1].toCode);
                }
                // Two walks in a row would mean an unmerged footpath chain.
                for (let i = 1; i < option.legs.length; i++) {
                    expect(
                        option.legs[i].type === 'walk' && option.legs[i - 1].type === 'walk',
                    ).toBe(false);
                }
            }
        }
        expect(planned).toBeGreaterThanOrEqual(30);
    });

    it('rides follow their variant, forwards, through the recorded stops', () => {
        for (const [from, to] of samplePairs(graph, 40)) {
            const { status, options } = planJourney(from, to);
            if (status !== 'ok') continue;
            for (const option of options) {
                for (const leg of option.legs) {
                    if (leg.type !== 'ride') continue;
                    const ordered = [...stopsByVariant.get(leg.variantId)].sort(
                        (a, b) => a.ordinal - b.ordinal,
                    );
                    expect(leg.alightIdx).toBeGreaterThan(leg.boardIdx);
                    expect(leg.alightIdx).toBeLessThan(ordered.length);
                    expect(
                        ordered
                            .slice(leg.boardIdx, leg.alightIdx + 1)
                            .map((s) => s.feature.properties.COD_UBIC_P),
                    ).toEqual(leg.stopCodes);
                    expect(leg.meters).toBeGreaterThan(0);
                    expect(leg.seconds).toBeGreaterThan(0);
                }
            }
        }
    });

    it('offers a Pareto set: later options are slower but need fewer transfers', () => {
        let withAlternatives = 0;
        for (const [from, to] of samplePairs(graph, 60)) {
            const { status, options } = planJourney(from, to);
            if (status !== 'ok' || options.length < 2) continue;
            withAlternatives++;
            for (let i = 1; i < options.length; i++) {
                expect(options[i].seconds).toBeGreaterThan(options[i - 1].seconds);
                expect(options[i].transfers).toBeLessThan(options[i - 1].transfers);
            }
            expect(options.length).toBeLessThanOrEqual(CONFIG.JOURNEY_MAX_OPTIONS);
        }
        expect(withAlternatives).toBeGreaterThan(0);
    });

    it('keeps the totals consistent with the legs', () => {
        for (const [from, to] of samplePairs(graph, 30)) {
            const { status, options } = planJourney(from, to);
            if (status !== 'ok') continue;
            for (const option of options) {
                const legSeconds = option.legs.reduce((sum, l) => sum + l.seconds, 0);
                expect(option.seconds).toBeCloseTo(legSeconds + option.waitSeconds, 5);
                expect(option.transfers).toBe(
                    Math.max(0, option.legs.filter((l) => l.type === 'ride').length - 1),
                );
                expect(option.walkMeters).toBeCloseTo(
                    option.legs
                        .filter((l) => l.type === 'walk')
                        .reduce((sum, l) => sum + l.meters, 0),
                    5,
                );
                expect(option.transfers).toBeLessThanOrEqual(CONFIG.JOURNEY_MAX_ROUNDS - 1);
            }
        }
    });

    it('reaches most of the network from a central stop', () => {
        // A planner that silently fails on half the city is useless; pin
        // the coverage so a regression in the boarding rule is visible.
        //
        // Every 41st stop (~120 plans), not every 17th: at ~3 ms a plan the
        // denser sweep sits right at vitest's 5 s default and timed out on
        // a CI runner. The exhaustive stride-17 sweep still runs — in
        // scripts/measure_journey_model.mjs, outside any per-test timeout.
        const targets = graph.codes.filter((_, i) => i % 41 === 0);
        expect(targets.length).toBeGreaterThan(100);
        const reached = targets.filter(
            (code) => code === 4772 || planJourney(4772, code).status === 'ok',
        ).length;
        expect(reached / targets.length).toBeGreaterThan(0.9);
    }, 30_000);
});
