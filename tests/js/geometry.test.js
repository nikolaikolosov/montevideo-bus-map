/**
 * Unit contracts for the shared geometry primitives (src/geometry.js).
 *
 * The degree-space primitives are the single implementation the pipeline
 * relies on for every cut/trim/match (rule R-PROJECT) — they are verified
 * here against brute-force references so that the oracle suites may reuse
 * them without weakening test independence (see
 * architecture/route-geometry-contract.md, independence note).
 */

import { describe, it, expect } from 'vitest';
import {
    projectPointOnSegment,
    unclampedSegmentParam,
    projectPointOnPolyline,
    projectionCandidates,
    pointAt,
    M_PER_DEG_LON,
    M_PER_DEG_LAT,
    segmentLengthM,
    headingDeg,
    turnAngleDeg,
    axisAngleDeg,
    polylineLengthM,
    pointToPolylineDistM,
    oneSidedHausdorffM,
    axialOverlapAndLateralM,
    segmentsProperlyIntersect,
} from '../../src/geometry.js';
import { simplifyPath } from '../../src/bundling.js';

/** Brute-force nearest distance from p to segment a-b by dense sampling. */
const bruteSegDist = (p, a, b) => {
    let best = Infinity;
    for (let s = 0; s <= 1000; s++) {
        const t = s / 1000;
        const x = a[0] + (b[0] - a[0]) * t;
        const y = a[1] + (b[1] - a[1]) * t;
        best = Math.min(best, Math.hypot(p[0] - x, p[1] - y));
    }
    return best;
};

describe('projectPointOnSegment', () => {
    it('matches a brute-force reference on assorted configurations', () => {
        const cases = [
            { p: [5, 3], a: [0, 0], b: [10, 0] }, // above the middle
            { p: [-4, 2], a: [0, 0], b: [10, 0] }, // beyond the start (clamps)
            { p: [14, -2], a: [0, 0], b: [10, 0] }, // beyond the end (clamps)
            { p: [1, 1], a: [-3, 2], b: [4, -5] }, // oblique
            { p: [0.5, 0.5], a: [0, 0], b: [0, 1] }, // vertical
        ];
        for (const { p, a, b } of cases) {
            const r = projectPointOnSegment(p[0], p[1], a[0], a[1], b[0], b[1]);
            expect(Math.sqrt(r.d2)).toBeCloseTo(bruteSegDist(p, a, b), 6);
            expect(r.t).toBeGreaterThanOrEqual(0);
            expect(r.t).toBeLessThanOrEqual(1);
            // Foot point lies on the segment at parameter t.
            expect(r.x).toBeCloseTo(a[0] + (b[0] - a[0]) * r.t, 12);
            expect(r.y).toBeCloseTo(a[1] + (b[1] - a[1]) * r.t, 12);
        }
    });

    it('handles a degenerate (zero-length) segment', () => {
        const r = projectPointOnSegment(3, 4, 1, 1, 1, 1);
        expect(r.t).toBe(0);
        expect(Math.sqrt(r.d2)).toBeCloseTo(Math.hypot(2, 3), 12);
    });
});

describe('unclampedSegmentParam', () => {
    it('returns the perpendicular distance for interior projections', () => {
        const { t, d2 } = unclampedSegmentParam(5, 7, 0, 0, 10, 0);
        expect(t).toBeCloseTo(0.5, 12);
        expect(Math.sqrt(d2)).toBeCloseTo(7, 12);
    });

    it('reports t outside (0,1) for points beyond the segment ends', () => {
        expect(unclampedSegmentParam(-1, 0, 0, 0, 10, 0).t).toBeLessThan(0);
        expect(unclampedSegmentParam(11, 0, 0, 0, 10, 0).t).toBeGreaterThan(1);
    });

    it('handles a degenerate segment without NaN', () => {
        const r = unclampedSegmentParam(3, 4, 1, 1, 1, 1);
        expect(r.t).toBe(0);
        expect(Number.isFinite(r.d2)).toBe(true);
    });
});

describe('projectPointOnPolyline', () => {
    it('finds the globally nearest foot point', () => {
        const line = [
            [0, 0],
            [10, 0],
            [10, 10],
        ];
        const r = projectPointOnPolyline([9, 6], line);
        expect(r.i).toBe(1);
        expect(r.x).toBeCloseTo(10, 12);
        expect(r.y).toBeCloseTo(6, 12);
    });

    it('keeps the FIRST minimal segment on exact ties (frozen behavior)', () => {
        // Symmetric V: the apex point is equidistant from both segments.
        const v = [
            [-10, 10],
            [0, 0],
            [10, 10],
        ];
        const r = projectPointOnPolyline([0, 5], v);
        expect(r.i).toBe(0);
    });
});

describe('projectionCandidates', () => {
    it('returns both passes of a loop trace near a twice-visited point', () => {
        // Out-and-back along the same street: the trace passes [5,0] twice.
        const loop = [
            [0, 0],
            [10, 0],
            [10, 0.00001],
            [0, 0.00001],
        ];
        const cands = projectionCandidates([5, 0], loop, 1e-4);
        const segs = cands.map((c) => c.i);
        expect(segs).toContain(0); // outbound pass
        expect(segs).toContain(2); // return pass
    });

    it('excludes segments farther than the slack window', () => {
        const line = [
            [0, 0],
            [10, 0],
            [10, 5],
        ];
        const cands = projectionCandidates([2, 0], line, 1e-4);
        expect(cands.map((c) => c.i)).toEqual([0]);
    });
});

describe('pointAt', () => {
    it('interpolates within the addressed segment', () => {
        const line = [
            [0, 0],
            [10, 0],
            [10, 10],
        ];
        expect(pointAt(line, 0, 0.5)).toEqual([5, 0]);
        expect(pointAt(line, 1, 0.25)).toEqual([10, 2.5]);
    });
});

describe('meter-space measures', () => {
    it('converts degree offsets at Montevideo scale', () => {
        expect(segmentLengthM([0, 0], [0.001, 0])).toBeCloseTo(M_PER_DEG_LON * 0.001, 9);
        expect(segmentLengthM([0, 0], [0, 0.001])).toBeCloseTo(M_PER_DEG_LAT * 0.001, 9);
    });

    it('measures headings and turn angles', () => {
        expect(headingDeg([0, 0], [1, 0])).toBeCloseTo(0, 9);
        expect(headingDeg([0, 0], [0, 1])).toBeCloseTo(90, 9);
        expect(turnAngleDeg([0, 0], [1, 0], [2, 0])).toBeCloseTo(0, 9);
        expect(turnAngleDeg([0, 0], [1, 0], [1, -1])).toBeCloseTo(90, 4);
        expect(turnAngleDeg([0, 0], [1, 0], [0, 0])).toBeCloseTo(180, 9);
    });

    it('treats axis angles as undirected', () => {
        expect(axisAngleDeg(0, 170)).toBeCloseTo(10, 12);
        expect(axisAngleDeg(45, 225)).toBeCloseTo(0, 12);
    });

    it('sums polyline length', () => {
        const L = polylineLengthM([
            [0, 0],
            [0.001, 0],
            [0.001, 0.001],
        ]);
        expect(L).toBeCloseTo(M_PER_DEG_LON * 0.001 + M_PER_DEG_LAT * 0.001, 6);
    });

    it('measures point-to-polyline distance in meters', () => {
        const street = [
            [0, 0],
            [0.01, 0],
        ];
        expect(pointToPolylineDistM([0.005, 0.0001], street)).toBeCloseTo(
            M_PER_DEG_LAT * 0.0001,
            3,
        );
    });

    it('one-sided Hausdorff catches the dropped vertex', () => {
        const original = [
            [0, 0],
            [0.005, 0.0002],
            [0.01, 0],
        ];
        const simplified = [
            [0, 0],
            [0.01, 0],
        ];
        expect(oneSidedHausdorffM(original, simplified)).toBeCloseTo(M_PER_DEG_LAT * 0.0002, 3);
        expect(oneSidedHausdorffM(simplified, original)).toBeLessThan(0.5);
    });

    it('measures axial overlap and lateral separation of parallel strands', () => {
        const s1 = [
            [0, 0],
            [0.001, 0],
        ];
        const s2 = [
            [0.00025, 0.0001],
            [0.00075, 0.0001],
        ];
        const r = axialOverlapAndLateralM(s1, s2);
        expect(r.overlap).toBeCloseTo(M_PER_DEG_LON * 0.0005, 3);
        expect(r.lat).toBeCloseTo(M_PER_DEG_LAT * 0.0001, 3);
    });

    it('returns null without axial overlap or for a degenerate reference', () => {
        const s1 = [
            [0, 0],
            [0.001, 0],
        ];
        expect(
            axialOverlapAndLateralM(s1, [
                [0.002, 0.0001],
                [0.003, 0.0001],
            ]),
        ).toBeNull();
        expect(axialOverlapAndLateralM([s1[0], s1[0]], s1)).toBeNull();
    });
});

describe('segmentsProperlyIntersect', () => {
    it('detects a proper crossing', () => {
        expect(segmentsProperlyIntersect([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    });

    it('ignores shared endpoints and touching', () => {
        // Consecutive polyline segments share a vertex — never a crossing.
        expect(segmentsProperlyIntersect([0, 0], [10, 0], [10, 0], [10, 10])).toBe(false);
        // T-touch: endpoint on the other segment's interior.
        expect(segmentsProperlyIntersect([0, 0], [10, 0], [5, 0], [5, 10])).toBe(false);
        // Parallel, disjoint.
        expect(segmentsProperlyIntersect([0, 0], [10, 0], [0, 1], [10, 1])).toBe(false);
    });
});

describe('simplifyPath operator contract (R-BOUNDED)', () => {
    it('keeps endpoints, keeps a vertex subset, and stays within eps', () => {
        const eps = 0.00004;
        // Wobbly street: alternating sub-eps jitter plus one genuine corner.
        const input = [];
        for (let i = 0; i <= 20; i++) {
            input.push([i * 0.0005, (i % 2 === 0 ? 1 : -1) * 0.00002]);
        }
        input.push([0.01, 0.005]); // corner leg
        const out = simplifyPath(input, eps);

        expect(out[0]).toEqual(input[0]);
        expect(out[out.length - 1]).toEqual(input[input.length - 1]);
        expect(out.length).toBeLessThan(input.length);
        // Every output vertex is an input vertex (DP never invents points).
        for (const p of out) {
            expect(input.some((q) => q[0] === p[0] && q[1] === p[1])).toBe(true);
        }
        // Every dropped vertex stays within eps of the simplified line
        // (degree space, isotropic — checked with the shared primitive).
        for (const p of input) {
            let best = Infinity;
            for (let i = 0; i < out.length - 1; i++) {
                const r = projectPointOnSegment(
                    p[0],
                    p[1],
                    out[i][0],
                    out[i][1],
                    out[i + 1][0],
                    out[i + 1][1],
                );
                best = Math.min(best, r.d2);
            }
            expect(Math.sqrt(best)).toBeLessThanOrEqual(eps + 1e-12);
        }
    });

    it('returns short inputs untouched', () => {
        const two = [
            [0, 0],
            [1, 1],
        ];
        expect(simplifyPath(two, 0.1)).toBe(two);
    });
});
