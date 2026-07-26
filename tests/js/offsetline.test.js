import { describe, it, expect } from 'vitest';
import { offsetPoints, strandEndpoint, jointPath } from '../../src/offsetline.js';

const P = (x, y) => ({ x, y });

describe('offsetPoints', () => {
    it('offsets a straight horizontal line perpendicular by d', () => {
        const pts = [P(0, 0), P(10, 0), P(20, 0)];
        const out = offsetPoints(pts, 3);
        for (const p of out) expect(p.y).toBeCloseTo(3, 6);
        expect(out[0].x).toBeCloseTo(0, 6);
        expect(out[out.length - 1].x).toBeCloseTo(20, 6);
    });

    it('returns input unchanged for zero offset or short input', () => {
        const pts = [P(0, 0), P(10, 0)];
        expect(offsetPoints(pts, 0)).toBe(pts);
        expect(offsetPoints([P(0, 0)], 5)).toEqual([P(0, 0)]);
    });

    it('trims the inner side of a right-angle corner to one intersection point', () => {
        // L-shape; offset toward the inside of the turn
        const pts = [P(0, 0), P(10, 0), P(10, 10)];
        const out = offsetPoints(pts, 3);
        // Inner join: start of first segment offset, single corner point, end offset
        expect(out).toHaveLength(3);
        expect(out[1].x).toBeCloseTo(7, 6);
        expect(out[1].y).toBeCloseTo(3, 6);
    });

    it('rounds the outer side of a right-angle corner with an arc midpoint', () => {
        const pts = [P(0, 0), P(10, 0), P(10, 10)];
        const out = offsetPoints(pts, -3);
        // Outer join inserts corner points; every point stays ~3 px off the path
        expect(out.length).toBeGreaterThan(3);
        // The arc midpoint sits exactly |d| away from the original corner (10,0)
        const mid = out[2];
        const dist = Math.hypot(mid.x - 10, mid.y - 0);
        expect(dist).toBeCloseTo(3, 6);
    });

    it('produces finite coordinates on a switchback (loop culling)', () => {
        const pts = [P(0, 0), P(10, 0), P(10, 2), P(0, 2)];
        const out = offsetPoints(pts, 4); // offset larger than the 2px middle segment
        for (const p of out) {
            expect(Number.isFinite(p.x)).toBe(true);
            expect(Number.isFinite(p.y)).toBe(true);
        }
    });

    it('skips degenerate (near-zero-length) segments', () => {
        const pts = [P(0, 0), P(0.001, 0), P(10, 0)];
        const out = offsetPoints(pts, 2);
        for (const p of out) expect(p.y).toBeCloseTo(2, 6);
    });
});

describe('strandEndpoint', () => {
    it('matches the drawn end of an offset strand (node = last vertex)', () => {
        const pts = [P(0, 0), P(10, 0), P(20, 5)];
        const out = offsetPoints(pts, 4);
        const end = strandEndpoint(P(20, 5), P(10, 0), true, 4);
        expect(end.x).toBeCloseTo(out[out.length - 1].x, 6);
        expect(end.y).toBeCloseTo(out[out.length - 1].y, 6);
    });

    it('matches the drawn start of an offset strand (node = first vertex)', () => {
        const pts = [P(0, 0), P(10, 0), P(20, 5)];
        const out = offsetPoints(pts, 4);
        const start = strandEndpoint(P(0, 0), P(10, 0), false, 4);
        expect(start.x).toBeCloseTo(out[0].x, 6);
        expect(start.y).toBeCloseTo(out[0].y, 6);
    });

    it('flips side with the offset sign and returns null on degenerate segments', () => {
        const plus = strandEndpoint(P(10, 0), P(0, 0), true, 3);
        const minus = strandEndpoint(P(10, 0), P(0, 0), true, -3);
        expect(plus.y).toBeCloseTo(-minus.y + 0, 6);
        expect(strandEndpoint(P(0, 0), P(0.001, 0), true, 3)).toBeNull();
    });
});

describe('jointPath (cubic Bézier along strand tangents)', () => {
    it('keeps the exact endpoints and starts/ends along the given tangents', () => {
        const ea = P(0, 0);
        const eb = P(10, 10);
        const ta = P(1, 0); // strand A arrives heading +x
        const tb = P(0, 1); // strand B departs heading +y
        const path = jointPath(ea, eb, ta, tb);
        expect(path.length).toBeGreaterThan(2);
        expect(path[0]).toEqual(ea);
        expect(path[path.length - 1]).toEqual(eb);
        // First step leaves ea along ta (dy ≈ 0), last step enters eb along tb (dx ≈ 0).
        expect(Math.abs(path[1].y - ea.y)).toBeLessThan(Math.abs(path[1].x - ea.x));
        const pen = path[path.length - 2];
        expect(Math.abs(eb.x - pen.x)).toBeLessThan(Math.abs(eb.y - pen.y));
    });

    it('collinear tangents produce points on the straight line', () => {
        const path = jointPath(P(0, 0), P(12, 0), P(1, 0), P(1, 0));
        for (const p of path) expect(p.y).toBeCloseTo(0, 9);
    });

    it('degenerates to a chord for sub-pixel gaps', () => {
        const path = jointPath(P(0, 0), P(0.5, 0), P(1, 0), P(1, 0));
        expect(path).toHaveLength(2);
    });

    it('stays inside the control-point bounding box (no bulging into neighbours)', () => {
        // A slot change: endpoints 8 px apart laterally, both strands heading +x.
        const ea = P(0, 0);
        const eb = P(20, 8);
        const path = jointPath(ea, eb, P(1, 0), P(1, 0));
        for (const p of path) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(20);
            expect(p.y).toBeGreaterThanOrEqual(-1e-9);
            expect(p.y).toBeLessThanOrEqual(8 + 1e-9);
        }
    });
});

describe('offsetPoints — degenerate joins (audit G-2)', () => {
    /** Signed progress of each point along the base direction u. */
    const progress = (pts, u) => pts.map((p) => p.x * u[0] + p.y * u[1]);

    it('never doubles back when the offset exceeds a corner segment', () => {
        // A short segment between two long ones is the shape that breaks: with
        // |d| bigger than that segment, the offset lines of the two flanking
        // segments intersect BEHIND the short one's offset start (t ≤ 0), and
        // pushing that intersection made the strand reverse. Real occurrence:
        // 17 of 7054 joins at zoom 15 on the committed corridors.
        // 4 px corner segment, |d| up to 16 — verified to reverse on the old code.
        const pts = [P(0, 0), P(40, 0), P(44, 0), P(86.4, 42.4)];
        for (const d of [10, 12, 16, -16]) {
            const out = offsetPoints(pts, d);
            const along = progress(out, [1, 0]);
            for (let i = 1; i < along.length; i++) {
                expect(
                    along[i] - along[i - 1],
                    `d=${d} point ${i} moves backwards (${JSON.stringify(out)})`,
                ).toBeGreaterThanOrEqual(-1e-9);
            }
        }
    });
});
