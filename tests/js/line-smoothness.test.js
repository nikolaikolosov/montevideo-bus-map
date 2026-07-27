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
    corridorFollowsData,
    rawCornerSwing,
    rawCrossingNear,
    measureSelfCrossings,
    ORACLE,
} from '../../scripts/route_oracles.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Turn angle at vertex i of a polyline, in degrees (test-local arithmetic). */
function turnAt(pts, i) {
    const ang = (a, b) => Math.atan2((b[1] - a[1]) * 111000, (b[0] - a[0]) * 92000);
    let d = ((ang(pts[i], pts[i + 1]) - ang(pts[i - 1], pts[i])) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.abs(d);
}

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

describe('shape evidence: chord-free tracking (2026-07-27)', () => {
    // Third and final iteration of the same classifier problem. Asking whether a
    // REFERENCE weaves needs a chord, and every chord is biased: the reference's
    // own chord over the projected stretch slides wherever the corridor is
    // offset (it under-reported lines 199/L6/L77 by 1.8-6.2 m), the corridor's
    // chord adds a constant offset that makes a real weave read one-sided, and a
    // raw trace cannot grow a window at all. BUG means pipeline-INTRODUCED, so
    // the chord is dropped and the question becomes whether the corridor left
    // the data — a quantity no lateral offset can distort.
    const M_LON = 92000; // src/geometry.js constants, in metres per degree
    const M_LAT = 111000;
    const LEG_M = 60;

    /** Polyline with one vertex per lateral offset (metres), legs of LEG_M. */
    const shape = (offsets, { lon0 = 0 } = {}) =>
        offsets.map((o, i) => [lon0 + (i * LEG_M) / M_LON, o / M_LAT]);

    /** Same geometry re-digitised every `stepM` with seeded lateral jitter. */
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

    const straight = shape([0, 0, 0, 0, 0, 0, 0]);

    it('scores a steady lateral offset as no excursion at all', () => {
        // The bias the chord introduced: a corridor half a carriageway off the
        // trace it follows must not read as a weave.
        const offset = shape([7, 7, 7, 7, 7]);
        const { offM, altM } = corridorFollowsData([straight], offset);
        expect(offM).toBeCloseTo(7, 0);
        expect(altM).toBeCloseTo(0, 1);
    });

    it('scores a dart off the data and back', () => {
        const dart = shape([0, 0, 8, 0, 0]);
        const { altM } = corridorFollowsData([straight], dart);
        expect(altM).toBeCloseTo(8, 0);
    });

    it('keeps one reference for the window, so carriageway hops cannot hide', () => {
        // The phase sawtooth: the corridor alternates between two carriageways
        // 14 m apart. Picking the nearest strand per vertex would score ~0 —
        // every vertex sits on SOME strand — so the reference is fixed for the
        // whole window and the hop shows up at its full amplitude.
        const ida = shape([7, 7, 7, 7, 7]);
        const vuelta = shape([-7, -7, -7, -7, -7]);
        const mean = shape([0, 0, 0, 0, 0]);
        const hopping = shape([7, -7, 7, -7, 7]);
        const { offM, altM } = corridorFollowsData([ida, vuelta, mean], hopping);
        expect(offM).toBeCloseTo(7, 0); // the mean is the closest single reference
        expect(altM).toBeGreaterThan(12); // ~14 m: the full hop
    });

    it('gives the same answer however densely the reference is digitised', () => {
        // What the previous two measures could not do: the verdict must not
        // depend on the reference's vertex spacing.
        const dart = shape([0, 0, 8, 0, 0]);
        const sparse = corridorFollowsData([straight], dart);
        const raw = densify(straight, 4, 2, 20260727);
        const dense = corridorFollowsData([raw], dart);
        expect(Math.abs(dense.altM - sparse.altM)).toBeLessThan(2.5);
        expect(Math.abs(dense.offM - sparse.offM)).toBeLessThan(2.5);
    });

    it('reports Infinity when no reference is usable', () => {
        expect(corridorFollowsData([], straight)).toEqual({ offM: Infinity, altM: Infinity });
        expect(corridorFollowsData([[[0, 0]]], straight).offM).toBe(Infinity);
    });
});

describe('shape evidence: corner swing (2026-07-27)', () => {
    // Third instance of the same classifier problem, this time for KINK. Asking
    // whether one raw VERTEX turns like the corridor's is density-dependent: the
    // corridor carries a junction in a single vertex, a trace spreads it over
    // several. Line 192's corner is exactly that — 71 deg at one corridor vertex
    // against a sharpest raw vertex of 36 deg, yet the traces swing 68 deg across
    // the corner as a whole.
    const M_LON = 92000;
    const M_LAT = 111000;
    const at = (xM, yM) => [xM / M_LON, yM / M_LAT];

    /** A corner turning `totalDeg` over `steps` vertices — a digitised trace. */
    const trace = (totalDeg, steps, legM = 40, stepM = 6) => {
        const pts = [[0, 0]];
        let heading = 0;
        const push = (dist) => {
            const last = pts[pts.length - 1];
            const rad = (heading * Math.PI) / 180;
            pts.push([
                last[0] + (Math.cos(rad) * dist) / M_LON,
                last[1] + (Math.sin(rad) * dist) / M_LAT,
            ]);
        };
        push(legM);
        for (let i = 0; i < steps; i++) {
            heading += totalDeg / steps;
            push(stepM);
        }
        push(legM);
        return pts;
    };

    it('matches a corner the reference makes gradually', () => {
        const raw = trace(90, 9); // the corner digitised every 6 m
        // The corridor is a DECIMATION of that trace, which is what the pipeline
        // produces: the same corner carried in a single vertex.
        // Flanks sit out on the straight legs, as a corridor's neighbouring
        // vertices do — the corner itself is carried by the single vertex
        // between them.
        const corner = raw[Math.floor(raw.length / 2)];
        const flanks = [raw[0], raw[raw.length - 1]];

        // No single raw vertex turns anything like the corridor's corner...
        const sharpestRaw = Math.max(...raw.slice(1, -1).map((_, i) => turnAt(raw, i + 1)));
        expect(sharpestRaw).toBeLessThan(20);
        const corridorTurn = turnAt([flanks[0], corner, flanks[1]], 1);
        expect(corridorTurn).toBeGreaterThan(60);

        // ...but across the corner the trace swings the same amount.
        // Asserted against the rule's own slack, so the test tracks the
        // constant the classifier actually applies.
        const swing = rawCornerSwing([raw], flanks[0], flanks[1], corridorTurn);
        expect(Math.abs(swing - corridorTurn)).toBeLessThanOrEqual(ORACLE.RAW_KINK_TURN_SLACK_DEG);
    });

    it('finds no swing where the reference runs straight', () => {
        const straight = [at(0, 0), at(50, 0), at(100, 0)];
        expect(rawCornerSwing([straight], at(0, 0), at(100, 0), 90)).toBeLessThan(5);
    });

    it('takes the swing closest to the corridor, not the largest', () => {
        // Both references start and end at the corridor's flanks, so both are
        // candidates; a sharp one must not excuse a mild corridor corner.
        const bulge = (h) => [at(0, 0), at(50, h), at(100, 0)];
        const mild = bulge(30); // swings ~62 deg
        const sharp = bulge(90); // swings ~122 deg
        const swing = rawCornerSwing([sharp, mild], at(0, 0), at(100, 0), 65);
        expect(swing).toBeGreaterThan(55);
        expect(swing).toBeLessThan(70);
    });

    it('ignores a reference farther than KINK_SWING_MATCH_M from the flanks', () => {
        const away = trace(90, 9).map(([x, y]) => [x, y + 60 / M_LAT]); // 60 m aside
        const raw = trace(90, 9);
        expect(rawCornerSwing([away], raw[1], raw[raw.length - 2], 90)).toBeNull();
    });
});

describe('shape evidence: self-crossing (2026-07-27)', () => {
    // The class had no matcher at all — every corridor crossing defaulted to BUG
    // — and the finding pointed at the first crossing segment's START vertex.
    // On line E14 those segments run 962 m and 416 m, so the reported place was
    // 644 m from the junction, which is why reviewing it from the triage card
    // could not settle anything.
    const M_LON = 92000;
    const M_LAT = 111000;
    const at = (xM, yM) => [xM / M_LON, yM / M_LAT];

    it('reports the crossing point, not the segment that starts far away', () => {
        // A long run east, then a short leg cutting across it at x = 800 m.
        const section = { coords: [at(0, 0), at(1000, 0), at(800, -200), at(800, 200)] };
        const [finding, ...rest] = measureSelfCrossings([section]);
        expect(rest).toHaveLength(0);
        expect(finding.at[0] * M_LON).toBeCloseTo(800, 0);
        expect(finding.at[1] * M_LAT).toBeCloseTo(0, 0);
        // The old behaviour reported coords[0], which is 800 m away — the exact
        // failure that mislocated line E14 by 644 m.
        expect(Math.abs(finding.at[0] - section.coords[0][0]) * M_LON).toBeGreaterThan(700);
    });

    it('explains a crossing where one trace crosses itself', () => {
        const trace = [at(0, 0), at(1000, 0), at(800, -200), at(800, 200)];
        expect(rawCrossingNear([trace], at(800, 0))).toBe(true);
    });

    it('explains a crossing where two traces of the line cross each other', () => {
        // The E14 case: the route leaves along one street and returns along
        // another, so no single trace crosses itself.
        const out = [at(0, 0), at(1000, 0)];
        const back = [at(800, -200), at(800, 200)];
        expect(rawCrossingNear([out, back], at(800, 0))).toBe(true);
    });

    it('does not explain a crossing the data makes somewhere else', () => {
        const out = [at(0, 0), at(1000, 0)];
        const back = [at(800, -200), at(800, 200)];
        // The data crosses at (800, 0); a corridor crossing 200 m away is not
        // that junction.
        expect(rawCrossingNear([out, back], at(600, 0))).toBe(false);
    });

    it('does not explain a crossing when the traces merely run parallel', () => {
        const a = [at(0, 0), at(1000, 0)];
        const b = [at(0, 40), at(1000, 40)];
        expect(rawCrossingNear([a, b], at(500, 20))).toBe(false);
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
