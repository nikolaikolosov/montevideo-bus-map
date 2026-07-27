/**
 * Corridor smoothness — the user-reported line-104 regression (2026-07-05).
 *
 * The measures live in scripts/route_oracles.mjs (DUPLICATE / KINK classes
 * of the artifact taxonomy, architecture/contracts/route-geometry-contract.md)
 * and are swept network-wide by `npm run verify:oracles`, which gates CI:
 * any artifact not covered by qa/route-geometry-whitelist.json fails there.
 * The frozen network ceilings that used to live in this file (142 duplicate
 * pairs / 27 kinks) are retired in favor of that per-finding gate.
 *
 * This suite keeps the original incident pinned: line 104's reported window
 * (stops 3355/3933/3934, 26 de Marzo between Rambla Armenia and Julio César)
 * must stay strictly clean, and the whole line near-clean — the one residual
 * duplicate pair on Rambla O'Higgins is a genuinely divided carriageway at
 * the merge threshold (lat ≈ 9 m, verdict REAL in the oracle report).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildIndexes, getFilteredRouteFeatures } from '../../src/data.js';
import { prepareRouteFeature } from '../../src/map.js';
import {
    buildLineGeometry,
    measureDuplicates,
    measureKinks,
    meanStrandCurves,
    refWeaveAcrossWindow,
    wobblesOfPolyline,
    ORACLE,
} from '../../scripts/route_oracles.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

beforeAll(() => {
    const routes = JSON.parse(readFileSync(join(root, 'routes.json'), 'utf8'));
    const stops = JSON.parse(readFileSync(join(root, 'stops.json'), 'utf8'));
    buildIndexes(routes, stops);
});

describe('shape evidence: strand-mean reference (2026-07-27)', () => {
    // The REAL/BUG classifier asks whether the digitised data has the feature
    // the corridor shows. Since the corridor sits at the MEAN of the strands
    // (brainstorm-008 PR-2), asking only "does one strand have it?" is the wrong
    // question on a two-carriageway street: the corridor is half a carriageway
    // from either, which can push the anchor past RAW_KINK_RADIUS_M. The mean
    // curve is built from the raw traces ALONE, so it stays an independent
    // reference rather than a restatement of the pipeline's own output.
    it('builds a mean curve per spine strand, between the strands', () => {
        const sep = 0.00013; // ~14 m, the measured P90 ida/vuelta offset
        const ida = Array.from({ length: 20 }, (_, i) => [i * 0.0002, sep / 2]);
        const vuelta = Array.from({ length: 20 }, (_, i) => [i * 0.0002 + 0.0001, -sep / 2]);
        const curves = meanStrandCurves([ida, vuelta]);
        expect(curves).toHaveLength(2); // one per spine
        for (const c of curves) {
            expect(c.length).toBeGreaterThan(3);
            // Every sample lands on the centreline, not on either carriageway.
            for (const [, y] of c) expect(Math.abs(y)).toBeLessThan(sep / 10);
        }
    });

    it('returns nothing for a single strand — no mean to take', () => {
        const only = Array.from({ length: 20 }, (_, i) => [i * 0.0002, 0]);
        expect(meanStrandCurves([only])).toEqual([]);
    });

    it('keeps the spine where only one strand is in reach', () => {
        // Two strands far apart are different streets: neither may pull the other.
        const a = Array.from({ length: 20 }, (_, i) => [i * 0.0002, 0]);
        const b = Array.from({ length: 20 }, (_, i) => [i * 0.0002, 0.002]); // ~220 m away
        const [curveA] = meanStrandCurves([a, b]);
        for (const [, y] of curveA) expect(Math.abs(y)).toBeLessThan(1e-9);
    });
});

describe('shape evidence: window-matched reference (2026-07-27)', () => {
    // Second half of the same classifier problem. Asking the reference to grow
    // a WOBBLE window of its OWN is density-dependent: growth stops at the first
    // segment more than WOBBLE_AXIS_DEG off the chord, and a raw trace digitised
    // every few metres cannot hold 8° over 120 m however plainly it weaves. So
    // the reference is measured across the window the CORRIDOR wobbled on.
    const M_LON = 92000; // src/geometry.js constants, in metres per degree
    const M_LAT = 111000;
    const LEG_M = 130; // 3 legs = 390 m, inside WOBBLE_MAX_CHORD_M

    /** Polyline with one vertex per lateral offset (metres), legs of LEG_M. */
    const shape = (offsets) => offsets.map((o, i) => [(i * LEG_M) / M_LON, o / M_LAT]);

    /**
     * Same polyline re-digitised every `stepM` with seeded lateral jitter — a
     * raw trace of the identical geometry (qa rule 2: seeded randomness only).
     */
    const densify = (p, stepM, jitM, seed) => {
        let s = seed;
        const jit = () =>
            (((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1) * jitM;
        const out = [];
        for (let i = 1; i < p.length; i++) {
            const [a, b] = [p[i - 1], p[i]];
            const len = Math.hypot((b[0] - a[0]) * M_LON, (b[1] - a[1]) * M_LAT);
            for (let at = 0; at < len; at += stepM) {
                const t = at / len;
                out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + jit() / M_LAT]);
            }
        }
        out.push(p[p.length - 1]);
        return out;
    };

    const weave = shape([0, 7, -7, 0]); // crosses the chord both ways by 7 m
    const from = weave[0];
    const to = weave[weave.length - 1];

    it('scores 0 for a one-sided bow — a bowing street never explains a weave', () => {
        const bow = shape([0, 8, 11, 8, 0]);
        expect(refWeaveAcrossWindow([bow], bow[0], bow[bow.length - 1])).toBe(0);
    });

    it('scores the two-sided amplitude of a weave', () => {
        expect(refWeaveAcrossWindow([weave], from, to)).toBeCloseTo(7, 1);
    });

    it('measures a weave the reference cannot flag on its own (the density gap)', () => {
        // Sparse, the measure that finds corridor artifacts sees this weave...
        expect(wobblesOfPolyline(weave).map((w) => w.devM)).toEqual([7]);
        // ...but re-digitised every 4 m with 2 m of jitter — a raw trace of the
        // SAME geometry — window growth breaks on the first segment more than
        // WOBBLE_AXIS_DEG off the chord, so it flags nothing at all.
        const raw = densify(weave, 4, 2, 20260727);
        expect(wobblesOfPolyline(raw)).toEqual([]);
        // Across the corridor's window both samplings report the same weave,
        // which is what makes the classifier independent of digitisation density.
        expect(refWeaveAcrossWindow([raw], from, to)).toBeGreaterThan(6);
        expect(
            Math.abs(
                refWeaveAcrossWindow([raw], from, to) - refWeaveAcrossWindow([weave], from, to),
            ),
        ).toBeLessThan(1);
    });

    it('ignores a reference farther than WOBBLE_WINDOW_MATCH_M from the window', () => {
        const far = ORACLE.WOBBLE_WINDOW_MATCH_M + 20;
        expect(refWeaveAcrossWindow([shape([far, far + 7, far - 7, far])], from, to)).toBe(0);
        // Inside the budget the same shape counts — a parallel carriageway is
        // still the data this corridor represents.
        const near = ORACLE.WOBBLE_WINDOW_MATCH_M - 10;
        expect(
            refWeaveAcrossWindow([shape([near, near + 7, near - 7, near])], from, to),
        ).toBeCloseTo(7, 0);
    });
});

describe('corridor smoothness (line 104 incident)', () => {
    it('line 104 is clean in the reported window and near-clean overall', () => {
        const prepared = getFilteredRouteFeatures(['104'], null)
            .map((f) => prepareRouteFeature(f, null))
            .filter(Boolean);
        const { sections } = buildLineGeometry('104', prepared);
        const dupes = measureDuplicates(sections);
        const kinks = measureKinks(sections);

        // Reported window: strictly zero.
        const inWindow = (p) => p[0] >= -56.142 && p[0] <= -56.127;
        expect(
            dupes.filter((d) => inWindow(d.at)),
            JSON.stringify(dupes),
        ).toEqual([]);
        expect(
            kinks.filter((k) => inWindow(k.at)),
            JSON.stringify(kinks),
        ).toEqual([]);

        // Whole line: at most the one residual pair on Rambla O'Higgins.
        expect(dupes.length).toBeLessThanOrEqual(1);
        expect(kinks).toEqual([]);
    });
});
