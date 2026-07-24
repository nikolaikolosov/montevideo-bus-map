/**
 * Ride-leg geometry: the slice of a variant's recorded trace between the
 * boarding and the alighting stop (src/journey-geometry.js).
 *
 * The two rules this exists to keep (architecture/contracts/route-geometry-contract.md):
 *  - R-PROJECT — cuts land on segment projections, so a leg starts and ends
 *    where the stop actually is, not at the nearest simplified vertex;
 *  - R-FOREIGN — no stop coordinate is ever injected, so a leg never draws a
 *    chord from the street to a stop sitting tens of meters off the trace.
 *
 * Both are checked over the REAL data, across every committed variant.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildIndexes, stopsByVariant, uniqueStopByCode } from '../../src/data.js';
import { buildJourneyGraph, planJourney } from '../../src/journey.js';
import {
    patternPositions,
    rideLegGeometry,
    sliceAtPositions,
    resetJourneyGeometry,
} from '../../src/journey-geometry.js';
import {
    polylineLengthM,
    pointToPolylineDistM,
    segmentLengthM,
    M_PER_DEG_LAT,
} from '../../src/geometry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Worst stop-to-trace offset the committed data contains at a *terminal*
 * (bus bays sit off the street axis) — the same ~105 m that
 * route-invariants.test.js budgets for trims, plus slack.
 */
const MAX_STOP_OFFSET_M = 150;
/** A sliced vertex must lie ON the source trace (float noise only). */
const ON_TRACE_M = 0.5;

let graph;

beforeAll(() => {
    const routesData = JSON.parse(readFileSync(join(ROOT, 'routes.json'), 'utf8'));
    const stopsData = JSON.parse(readFileSync(join(ROOT, 'stops.json'), 'utf8'));
    buildIndexes(routesData, stopsData);
    resetJourneyGeometry();
    graph = buildJourneyGraph();
});

describe('sliceAtPositions', () => {
    // A 3 km straight line east, one degree-space vertex every 1 km.
    const coords = [
        [0, 0],
        [0.01, 0],
        [0.02, 0],
        [0.03, 0],
    ];

    it('cuts inside segments, not at vertices', () => {
        expect(sliceAtPositions(coords, 0.5, 2.5)).toEqual([
            [0.005, 0],
            [0.01, 0],
            [0.02, 0],
            [0.025, 0],
        ]);
    });

    it('keeps a sub-slice inside the wider slice', () => {
        const wide = sliceAtPositions(coords, 0.2, 2.8);
        const narrow = sliceAtPositions(coords, 0.6, 2.2);
        for (const point of narrow) {
            expect(pointToPolylineDistM(point, wide)).toBeLessThan(ON_TRACE_M);
        }
        expect(polylineLengthM(narrow)).toBeLessThan(polylineLengthM(wide));
    });

    it('clamps positions to the polyline', () => {
        const whole = sliceAtPositions(coords, -5, 99);
        expect(whole[0]).toEqual([0, 0]);
        expect(whole.at(-1)).toEqual([0.03, 0]);
    });
});

describe('patternPositions (every committed variant)', () => {
    it('projects every stop, in order, onto its own trace', () => {
        let checked = 0;
        let worstOffset = 0;
        for (const [variantId, entries] of stopsByVariant) {
            const prepared = patternPositions(variantId);
            expect(prepared, `variant ${variantId} has no usable geometry`).not.toBeNull();
            const { coords, positions, stopCodes } = prepared;
            checked++;

            expect(positions).toHaveLength(entries.length);
            expect(stopCodes).toHaveLength(entries.length);

            for (let i = 1; i < positions.length; i++) {
                // Monotone: stop k never lands before stop k−1. This is what
                // keeps loop variants (which pass a stop twice) sliceable.
                expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
            }
            expect(positions[0]).toBeGreaterThanOrEqual(0);
            expect(positions.at(-1)).toBeLessThanOrEqual(coords.length - 1);

            for (let i = 0; i < positions.length; i++) {
                const stop = uniqueStopByCode.get(stopCodes[i]);
                const offset = pointToPolylineDistM(stop.geometry.coordinates, coords);
                if (offset > worstOffset) worstOffset = offset;
            }
        }
        expect(checked).toBeGreaterThanOrEqual(1000);
        expect(worstOffset).toBeLessThan(MAX_STOP_OFFSET_M);
    });

    it('caches per variant (the same object comes back)', () => {
        const [variantId] = [...stopsByVariant.keys()];
        expect(patternPositions(variantId)).toBe(patternPositions(variantId));
    });

    it('returns null for an unknown variant', () => {
        expect(patternPositions('no-such-variant')).toBeNull();
    });
});

describe('rideLegGeometry', () => {
    /** Ride legs from a deterministic spread of planned journeys. */
    const sampleRideLegs = (count) => {
        const legs = [];
        for (let i = 0; i < count; i++) {
            const from = graph.codes[(i * 811) % graph.codes.length];
            const to = graph.codes[(i * 1637 + 400) % graph.codes.length];
            if (from === to) continue;
            const { status, options } = planJourney(from, to);
            if (status !== 'ok') continue;
            for (const option of options) {
                for (const leg of option.legs) if (leg.type === 'ride') legs.push(leg);
            }
        }
        return legs;
    };

    it('draws every planned ride leg along its own trace', () => {
        const legs = sampleRideLegs(50);
        expect(legs.length).toBeGreaterThan(50);
        const ratios = [];

        for (const leg of legs) {
            const geometry = rideLegGeometry(leg.variantId, leg.boardIdx, leg.alightIdx);
            expect(geometry, `${leg.line}/${leg.variantId}`).not.toBeNull();
            expect(geometry.length).toBeGreaterThanOrEqual(2);

            // R-FOREIGN: every vertex lies on the variant's cleaned trace.
            const { coords } = patternPositions(leg.variantId);
            for (const point of geometry) {
                expect(pointToPolylineDistM(point, coords)).toBeLessThan(ON_TRACE_M);
            }

            // R-PROJECT: the ends sit at the boarding/alighting stops, within
            // the stop-to-centreline offset the source data actually carries.
            const board = uniqueStopByCode.get(leg.fromCode).geometry.coordinates;
            const alight = uniqueStopByCode.get(leg.toCode).geometry.coordinates;
            expect(segmentLengthM(geometry[0], board)).toBeLessThan(MAX_STOP_OFFSET_M);
            expect(segmentLengthM(geometry.at(-1), alight)).toBeLessThan(MAX_STOP_OFFSET_M);

            ratios.push(polylineLengthM(geometry) / leg.meters);
        }

        // The drawn length must agree with the distance the planner charged
        // for (straight-line chain × the measured bus detour factor). Per leg
        // the band is wide on purpose: a two-stop hop where the bus loops a
        // block really is ~2× its straight line (worst in the committed data:
        // line 182 / variant 3238, 429 m charged, 866 m driven). What must
        // stay tight is the middle of the distribution — a slice covering the
        // wrong stretch of route would move it immediately.
        ratios.sort((a, b) => a - b);
        const median = ratios[Math.floor(ratios.length / 2)];
        expect(ratios[0]).toBeGreaterThan(0.9);
        expect(ratios.at(-1)).toBeLessThan(2.5);
        expect(median).toBeGreaterThan(0.95);
        expect(median).toBeLessThan(1.1);
    });

    it('never runs backwards: a longer leg contains the shorter one', () => {
        const [variantId, entries] = [...stopsByVariant].find(([, e]) => e.length >= 6);
        const inner = rideLegGeometry(variantId, 1, 3);
        const outer = rideLegGeometry(variantId, 0, 5);
        expect(polylineLengthM(inner)).toBeLessThanOrEqual(polylineLengthM(outer) + 1e-6);
        for (const point of inner) {
            expect(pointToPolylineDistM(point, outer)).toBeLessThan(ON_TRACE_M);
        }
        expect(entries.length).toBeGreaterThanOrEqual(6);
    });

    it('refuses degenerate and out-of-range legs instead of inventing a path', () => {
        const [variantId, entries] = [...stopsByVariant].find(([, e]) => e.length >= 3);
        expect(rideLegGeometry(variantId, 2, 2)).toBeNull();
        expect(rideLegGeometry(variantId, 2, 1)).toBeNull();
        expect(rideLegGeometry(variantId, -1, 2)).toBeNull();
        expect(rideLegGeometry(variantId, 0, entries.length)).toBeNull();
        expect(rideLegGeometry('no-such-variant', 0, 1)).toBeNull();
    });

    it('degree-space and meter-space helpers agree on scale', () => {
        // Guards the fixture arithmetic above: 1e-5 deg of latitude ≈ 1.1 m.
        expect(M_PER_DEG_LAT * 1e-5).toBeCloseTo(1.11, 2);
    });
});
