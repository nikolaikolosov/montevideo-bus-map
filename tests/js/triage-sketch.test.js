/**
 * Triage-gallery sketch geometry (scripts/triage_sketch.mjs).
 *
 * The gallery is the surface a reviewer classifies oracle findings REAL vs BUG
 * on, and those verdicts become whitelist entries that silence the CI gate — so
 * a sketch that silently omits the reference geometry can get a real pipeline
 * artifact permanently accepted. It used to filter VERTICES, which drops any
 * segment whose endpoints both lie outside the window even when it passes
 * straight through: 181 segments across 33 of the 581 current findings were
 * invisible, and 2 findings rendered no reference layer at all.
 */
import { describe, it, expect } from 'vitest';
import { BOX_M, SVG_PX, clipToBox, toSvgPolylines } from '../../scripts/triage_sketch.mjs';
import { M_PER_DEG_LON, M_PER_DEG_LAT } from '../../src/geometry.js';

/** [lon, lat] whose local-meter offset from the origin anchor is (x, y). */
const at = (x, y) => [x / M_PER_DEG_LON, y / M_PER_DEG_LAT];
const ANCHOR = [0, 0];
/** Parsed SVG runs back into numbers, for readable assertions. */
const runs = (coords) =>
    toSvgPolylines(coords, ANCHOR).map((r) => r.map((p) => p.split(',').map(Number)));
const scale = SVG_PX / (2 * BOX_M);
/** Expected SVG coordinate of a local-meter x (y is flipped). */
const sx = (x) => (x + BOX_M) * scale;
const sy = (y) => (BOX_M - y) * scale;

describe('clipToBox', () => {
    it('keeps a fully inside segment untouched', () => {
        expect(clipToBox([-10, 0], [10, 5])).toEqual([
            [-10, 0],
            [10, 5],
        ]);
    });

    it('clips a segment that crosses straight through, both ends outside', () => {
        const [a, b] = clipToBox([-BOX_M - 100, 0], [BOX_M + 100, 0]);
        expect(a[0]).toBeCloseTo(-BOX_M, 6);
        expect(b[0]).toBeCloseTo(BOX_M, 6);
        expect(a[1]).toBeCloseTo(0, 6);
    });

    it('clips to the window edge, not to the last inside vertex', () => {
        const [, b] = clipToBox([0, 0], [BOX_M * 3, 0]);
        expect(b[0]).toBeCloseTo(BOX_M, 6);
    });

    it('rejects a segment entirely outside, including one that misses diagonally', () => {
        expect(clipToBox([BOX_M + 1, 0], [BOX_M + 50, 0])).toBeNull();
        expect(clipToBox([-BOX_M - 10, BOX_M + 10], [BOX_M + 10, BOX_M + 400])).toBeNull();
    });
});

describe('toSvgPolylines', () => {
    it('draws a long segment that crosses the window with both ends outside', () => {
        // The case that was invisible: prepared trace segments run to P99 681 m
        // against a 520 m window, so a single segment can span it entirely.
        const out = runs([at(-BOX_M - 300, -20), at(BOX_M + 300, 20)]);
        expect(out).toHaveLength(1);
        expect(out[0]).toHaveLength(2);
        expect(out[0][0][0]).toBeCloseTo(sx(-BOX_M), 0);
        expect(out[0][1][0]).toBeCloseTo(sx(BOX_M), 0);
    });

    it('reaches the window edge instead of stopping at the last inside vertex', () => {
        const out = runs([at(0, 0), at(BOX_M * 4, 0)]);
        expect(out[0][1][0]).toBeCloseTo(sx(BOX_M), 0);
        expect(out[0][1][1]).toBeCloseTo(sy(0), 0);
    });

    it('keeps a single-vertex dip into the window', () => {
        // Out → one vertex inside → out again. Vertex filtering produced a
        // 1-point run and threw it away.
        const out = runs([at(-BOX_M - 200, 0), at(0, 0), at(BOX_M + 200, 0)]);
        expect(out).toHaveLength(1);
        expect(out[0].length).toBeGreaterThanOrEqual(3);
    });

    it('splits into separate runs when the trace leaves and re-enters', () => {
        const out = runs([
            at(-10, 0),
            at(-BOX_M - 400, 0), // far out
            at(-BOX_M - 400, 100),
            at(10, 100), // back in
        ]);
        expect(out.length).toBe(2);
    });

    it('returns nothing for a polyline that never enters the window', () => {
        expect(runs([at(BOX_M + 50, 0), at(BOX_M + 900, 300)])).toEqual([]);
    });

    it('joins consecutive in-box segments into one run, not one run each', () => {
        const out = runs([at(-100, 0), at(0, 10), at(100, 0)]);
        expect(out).toHaveLength(1);
        expect(out[0]).toHaveLength(3);
    });
});
