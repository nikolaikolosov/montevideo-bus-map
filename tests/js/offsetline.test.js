import { describe, it, expect } from 'vitest';
import { offsetPoints } from '../../src/offsetline.js';

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
