/**
 * Pure sketch geometry for the triage gallery (scripts/triage_route_oracles.mjs).
 *
 * Split out so it can be unit-tested without running the whole oracle sweep:
 * importing the gallery script renders all 581 cards at import time.
 */

import { toMeters } from '../src/geometry.js';

/** Half-size of the sketch window, in meters. */
export const BOX_M = 260;
/** Sketch size in SVG user units. */
export const SVG_PX = 340;

/**
 * Liang–Barsky clip of segment a→b against the sketch window.
 * @returns {number[][]|null} the [start, end] inside the box, or null
 */
export function clipToBox([x0, y0], [x1, y1]) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    // Each boundary as p·t ≤ q; p == 0 means parallel — outside is unfixable.
    const limits = [
        [-dx, x0 + BOX_M],
        [dx, BOX_M - x0],
        [-dy, y0 + BOX_M],
        [dy, BOX_M - y0],
    ];
    for (const [p, q] of limits) {
        if (p === 0) {
            if (q < 0) return null;
            continue;
        }
        const r = q / p;
        if (p < 0) {
            if (r > t1) return null;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return null;
            if (r < t1) t1 = r;
        }
    }
    if (t1 < t0) return null;
    return [
        [x0 + t0 * dx, y0 + t0 * dy],
        [x0 + t1 * dx, y0 + t1 * dy],
    ];
}

/**
 * Clips a polyline to the box around the anchor and converts it to SVG point
 * runs.
 *
 * Clips per SEGMENT rather than filtering vertices. Keeping only in-box
 * vertices drops any segment whose endpoints both lie outside even when it
 * passes straight through the window — and prepared trace segments are long
 * (P90 325 m, P99 681 m) against a 520 m window, so that is common: measured
 * over the 581 current findings, 181 segments across 33 findings were invisible,
 * and for 2 findings the gray reference layer came out completely empty. This
 * gallery is the surface a reviewer classifies REAL vs BUG on, and its verdicts
 * become whitelist entries that silence the CI gate, so a missing reference
 * layer can get a real pipeline artifact permanently accepted.
 *
 * Vertex filtering also stopped each run at the last in-box VERTEX instead of at
 * the window edge, leaving a gap at the border on 8595 segments.
 */
export function toSvgPolylines(coords, anchorM) {
    const scale = SVG_PX / (2 * BOX_M);
    const svg = ([x, y]) =>
        `${((x + BOX_M) * scale).toFixed(1)},${((BOX_M - y) * scale).toFixed(1)}`;
    const local = coords.map((p) => {
        const m = toMeters(p);
        return [m[0] - anchorM[0], m[1] - anchorM[1]];
    });

    const runs = [];
    /** @type {number[][]|null} points of the run being built, in local meters */
    let run = null;
    const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
    for (let i = 1; i < local.length; i++) {
        const piece = clipToBox(local[i - 1], local[i]);
        if (!piece) {
            if (run) runs.push(run);
            run = null;
            continue;
        }
        const [a, b] = piece;
        if (near(a, b)) continue; // touches a corner only — nothing to draw
        if (run && near(run[run.length - 1], a)) run.push(b);
        else {
            if (run) runs.push(run);
            run = [a, b];
        }
    }
    if (run) runs.push(run);
    return runs.map((r) => r.map(svg));
}
