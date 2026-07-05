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

describe('jointPath', () => {
    it('returns a chord for a shallow angle', () => {
        const node = P(0, 0);
        const path = jointPath(node, P(3, 0.2), P(3, -0.2));
        expect(path).toHaveLength(2);
    });

    it('adds an arc midpoint at the mean radius for a sharp corner', () => {
        const node = P(0, 0);
        const ea = P(4, 0); // radius 4
        const eb = P(0, 6); // radius 6, 90deg away
        const path = jointPath(node, ea, eb);
        expect(path).toHaveLength(3);
        const mid = path[1];
        expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(5, 6); // (4+6)/2
        // bisector direction
        expect(mid.x).toBeCloseTo(mid.y, 6);
    });

    it('degenerates gracefully when an endpoint sits on the node', () => {
        const path = jointPath(P(0, 0), P(0, 0), P(3, 0));
        expect(path).toHaveLength(2);
    });
});
