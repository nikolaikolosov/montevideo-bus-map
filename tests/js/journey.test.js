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
        // A planner that silently fails on half the city is useless; pin the
        // coverage so a regression in the boarding rule is visible.
        const targets = graph.codes.filter((_, i) => i % 17 === 0);
        const reached = targets.filter(
            (code) => code === 4772 || planJourney(4772, code).status === 'ok',
        ).length;
        expect(reached / targets.length).toBeGreaterThan(0.9);
    });
});
