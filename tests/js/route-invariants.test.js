/**
 * Route-construction invariants over the REAL committed data (routes.json /
 * stops.json), run through the production prepare→bundle pipeline
 * (prepareRouteFeature + buildSections). Catches dropped corridor segments,
 * broken trims, disconnected bundles and "route misses its own stops"
 * regressions on every change — without a browser.
 *
 * All tolerances are in raw degrees (1e-3 deg ≈ 92–111 m at Montevideo's
 * latitude; lon/lat anisotropy is absorbed by the safety margins).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    buildIndexes,
    getFilteredRouteFeatures,
    routesByLine,
    routesByVariant,
    stopLinesMap,
    stopsByVariant,
    uniqueStopsData,
} from '../../src/data.js';
import { projectPointOnSegment, M_PER_DEG_LON, M_PER_DEG_LAT } from '../../src/geometry.js';
import { buildSections } from '../../src/bundling.js';
import { prepareRouteFeature } from '../../src/map.js';

// --- Tolerances (calibrated against the 2026-06-27 dataset) -------------------
/** Prepared-trace vertex must lie this close to its line's corridors. */
// Budget: cluster radius 2.2e-4 + two capped smoothing passes (≤1e-4 each)
// + DP 4e-5 ≈ 5e-4 (~50 m worst case; typical drift is far smaller).
const TOL_CONTAIN_DEG = 5e-4;
/** Every stop of a line must lie this close to the line's corridors... */
const TOL_STOP_DEG = 6e-4; // ~60 m — curb-side stop vs street centreline
/**
 * ...UNLESS the RAW api trace is already far from the stop (source-data
 * quality: ~54 stop-line pairs sit up to ~600 m off their own shape, mostly
 * "L*" local lines). The pipeline must not make things WORSE than the raw
 * data by more than this slack.
 */
const STOP_PIPELINE_SLACK_DEG = 2e-4;
/**
 * Trimmed variant endpoints must land this close to the first/last stop.
 * Trim projects stops onto trace segments exactly, so what remains is the
 * real perpendicular stop-to-centreline offset — up to ~105 m at terminal
 * plazas/depots in the 2026-06 dataset (bus bays sit off the street axis).
 */
const TOL_TRIM_DEG = 1.2e-3; // ~120 m
/** Corridor length bookkeeping slack (simplification, node averaging). */
const LEN_SLACK = 1.05;
/**
 * A single variant may run out-and-back along the same street (loop lines,
 * 187-style spurs); the deduplicated corridor is then ~half the variant
 * length. Corridors must still cover at least this share of the longest
 * variant.
 */
const MIN_COVER_RATIO = 0.5;
/** Max connected corridor components per line (branches/loops are real). */
const MAX_COMPONENTS = 3;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const routesData = JSON.parse(readFileSync(join(ROOT, 'routes.json'), 'utf8'));
const stopsData = JSON.parse(readFileSync(join(ROOT, 'stops.json'), 'utf8'));

// --- Small geo helpers ----------------------------------------------------------

const distSqPointSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = px - (ax + t * dx);
    const ey = py - (ay + t * dy);
    return ex * ex + ey * ey;
};

const polyLength = (coords) => {
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
        len += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    }
    return len;
};

/** Uniform grid over segments for fast nearest-distance queries. */
class SegGrid {
    constructor(cell) {
        this.cell = cell;
        this.map = new Map();
    }

    key(cx, cy) {
        return `${cx}_${cy}`;
    }

    addPolyline(coords) {
        for (let i = 1; i < coords.length; i++) {
            const seg = [coords[i - 1], coords[i]];
            const [a, b] = seg;
            const x0 = Math.floor(Math.min(a[0], b[0]) / this.cell);
            const x1 = Math.floor(Math.max(a[0], b[0]) / this.cell);
            const y0 = Math.floor(Math.min(a[1], b[1]) / this.cell);
            const y1 = Math.floor(Math.max(a[1], b[1]) / this.cell);
            for (let cx = x0; cx <= x1; cx++) {
                for (let cy = y0; cy <= y1; cy++) {
                    const k = this.key(cx, cy);
                    if (!this.map.has(k)) this.map.set(k, []);
                    this.map.get(k).push(seg);
                }
            }
        }
    }

    /** Distance from a point to the nearest indexed segment, searching outward. */
    dist(x, y, maxRings = 3) {
        const cx = Math.floor(x / this.cell);
        const cy = Math.floor(y / this.cell);
        let best = Infinity;
        for (let ring = 0; ring <= maxRings; ring++) {
            for (let dx = -ring; dx <= ring; dx++) {
                for (let dy = -ring; dy <= ring; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                    const segs = this.map.get(this.key(cx + dx, cy + dy));
                    if (!segs) continue;
                    for (const [a, b] of segs) {
                        const d2 = distSqPointSeg(x, y, a[0], a[1], b[0], b[1]);
                        if (d2 < best) best = d2;
                    }
                }
            }
            // One extra ring after the first hit guards cell-boundary cases.
            if (best < Infinity && ring >= 1) break;
        }
        return Math.sqrt(best);
    }
}

// --- Per-line pipeline artifacts (built once) ------------------------------------

/** @type {Map<string, {prepared: object[], sections: object[], grid: SegGrid, rawGrid: SegGrid}>} */
const artifacts = new Map();

beforeAll(() => {
    buildIndexes(routesData, stopsData);
    for (const [line, features] of routesByLine) {
        const prepared = features.map((f) => prepareRouteFeature(f, null)).filter(Boolean);
        const sections = buildSections(prepared);
        const grid = new SegGrid(0.002);
        for (const s of sections) grid.addPolyline(s.coords);
        const rawGrid = new SegGrid(0.002);
        for (const f of features) rawGrid.addPolyline(f.geometry.coordinates);
        artifacts.set(line, { prepared, sections, grid, rawGrid });
    }
});

// --- Dataset shape --------------------------------------------------------------

describe('dataset shape (frozen)', () => {
    it('has the expected cardinalities', () => {
        expect(routesByLine.size).toBe(140);
        expect(routesData.features).toHaveLength(1088);
        expect(uniqueStopsData).toHaveLength(4938);
    });
});

// --- Construction invariants ------------------------------------------------------

describe('corridor construction (all 140 lines, real data)', () => {
    it('every line produces corridors that carry the line', () => {
        const empty = [];
        for (const [line, { sections }] of artifacts) {
            if (sections.length === 0) empty.push(line);
            else if (!sections.every((s) => s.lines.includes(line))) empty.push(`${line}(tag)`);
        }
        expect(empty).toEqual([]);
    });

    it('keeps every prepared trace vertex on a corridor (nothing dropped)', () => {
        const offenders = [];
        let worst = 0;
        for (const [line, { prepared, grid }] of artifacts) {
            for (const f of prepared) {
                for (const [x, y] of f.geometry.coordinates) {
                    const d = grid.dist(x, y);
                    if (d > worst) worst = d;
                    if (d > TOL_CONTAIN_DEG) {
                        offenders.push({
                            line,
                            variant: f.properties.COD_VARIAN,
                            d: +d.toFixed(6),
                        });
                        break; // one offender per variant is enough signal
                    }
                }
            }
        }
        expect(offenders, `worst distance ${worst.toFixed(6)} deg`).toEqual([]);
    });

    it('passes within stop tolerance of every stop it serves (oracle)', () => {
        // Relative oracle: a stop must be within TOL_STOP_DEG of the line's
        // corridors, unless the RAW api shape is itself far from the stop —
        // then the corridors only have to be as good as the raw data.
        const offenders = [];
        let worst = 0;
        for (const stop of uniqueStopsData) {
            const [x, y] = stop.geometry.coordinates;
            for (const line of stopLinesMap.get(stop.properties.COD_UBIC_P) ?? []) {
                const { grid, rawGrid } = artifacts.get(line);
                const d = grid.dist(x, y, 8);
                if (d <= TOL_STOP_DEG) continue;
                const rawD = rawGrid.dist(x, y, 8);
                if (d <= rawD + STOP_PIPELINE_SLACK_DEG) continue; // raw-data outlier
                if (d > worst) worst = d;
                offenders.push({
                    line,
                    stop: stop.properties.COD_UBIC_P,
                    d: +d.toFixed(6),
                    rawD: +rawD.toFixed(6),
                });
            }
        }
        expect(
            offenders.slice(0, 10),
            `worst ${worst.toFixed(6)} deg, total ${offenders.length}`,
        ).toEqual([]);
    });

    it('corridor total length stays within the variants length band', () => {
        const offenders = [];
        for (const [line, { prepared, sections }] of artifacts) {
            const variantLens = prepared.map((f) => polyLength(f.geometry.coordinates));
            const maxVariant = Math.max(...variantLens);
            const totalVariants = variantLens.reduce((a, b) => a + b, 0);
            const totalSections = sections.reduce((a, s) => a + polyLength(s.coords), 0);
            // Corridors must cover at least the out-and-back-deduplicated
            // longest variant and can never exceed the sum of all variants.
            if (totalSections * LEN_SLACK < maxVariant * MIN_COVER_RATIO) {
                offenders.push({ line, why: 'lost-length', totalSections, maxVariant });
            }
            if (totalSections > totalVariants * LEN_SLACK) {
                offenders.push({ line, why: 'exploded', totalSections, totalVariants });
            }
        }
        expect(offenders).toEqual([]);
    });

    it('corridors of a line form few connected components', () => {
        const offenders = [];
        for (const [line, { sections }] of artifacts) {
            const parent = new Map();
            const find = (k) => {
                while (parent.get(k) !== k) {
                    parent.set(k, parent.get(parent.get(k)));
                    k = parent.get(k);
                }
                return k;
            };
            const union = (a, b) => parent.set(find(a), find(b));
            const nodeKey = ([x, y]) => `${x.toFixed(4)}_${y.toFixed(4)}`;
            for (const s of sections) {
                for (const c of s.coords) {
                    const k = nodeKey(c);
                    if (!parent.has(k)) parent.set(k, k);
                }
                for (let i = 1; i < s.coords.length; i++) {
                    union(nodeKey(s.coords[i - 1]), nodeKey(s.coords[i]));
                }
            }
            const components = new Set();
            for (const k of parent.keys()) components.add(find(k));
            if (components.size > MAX_COMPONENTS) {
                offenders.push({ line, components: components.size });
            }
        }
        expect(offenders).toEqual([]);
    });
});

// --- Trim invariants -----------------------------------------------------------------

describe('deadhead trim (all 1,083 variants)', () => {
    it('trimmed endpoints land near the first/last stop of the variant', () => {
        const offenders = [];
        let worst = 0;
        for (const [variantId, entries] of stopsByVariant) {
            if (entries.length < 2) continue;
            const feature = routesByVariant.get(variantId)?.[0];
            if (!feature) continue;
            const prepared = prepareRouteFeature(feature, null);
            if (!prepared) continue;
            const coords = prepared.geometry.coordinates;
            let first = entries[0];
            let last = entries[0];
            for (const e of entries) {
                if (e.ordinal < first.ordinal) first = e;
                if (e.ordinal > last.ordinal) last = e;
            }
            const ends = [coords[0], coords[coords.length - 1]];
            const stopsAt = [first.feature.geometry.coordinates, last.feature.geometry.coordinates];
            // Trim slices between nearest vertices; direction may be either way.
            const d = Math.min(
                Math.max(
                    Math.hypot(ends[0][0] - stopsAt[0][0], ends[0][1] - stopsAt[0][1]),
                    Math.hypot(ends[1][0] - stopsAt[1][0], ends[1][1] - stopsAt[1][1]),
                ),
                Math.max(
                    Math.hypot(ends[0][0] - stopsAt[1][0], ends[0][1] - stopsAt[1][1]),
                    Math.hypot(ends[1][0] - stopsAt[0][0], ends[1][1] - stopsAt[0][1]),
                ),
            );
            if (d > worst) worst = d;
            if (d > TOL_TRIM_DEG) offenders.push({ variantId, d: +d.toFixed(6) });
        }
        expect(
            offenders.slice(0, 10),
            `worst ${worst.toFixed(6)} deg, total ${offenders.length}`,
        ).toEqual([]);
    });
});

// --- Frozen edge cases (from the manual-verification playbook) -----------------------

describe('frozen edge cases', () => {
    it('stop 4018 (18 de Julio y Convención) serves 15 lines / 37 variants', () => {
        expect(stopLinesMap.get(4018)?.size).toBe(15);
        const variants = [...(stopsByVariant.keys() ?? [])].filter((v) =>
            stopsByVariant.get(v).some((e) => e.feature.properties.COD_UBIC_P === 4018),
        );
        expect(variants).toHaveLength(37);
    });

    it('stop 4967 is terminal-only: no downstream geometry from it', () => {
        const stop = uniqueStopsData.find((f) => f.properties.COD_UBIC_P === 4967);
        expect(stop).toBeDefined();
        const src = stop.geometry.coordinates;
        for (const [variantId, entries] of stopsByVariant) {
            if (!entries.some((e) => e.feature.properties.COD_UBIC_P === 4967)) continue;
            for (const f of routesByVariant.get(variantId) ?? []) {
                expect(prepareRouteFeature(f, src)).toBeNull();
            }
        }
    });

    it("line 187's out-and-back spur survives bundling (it is real data)", () => {
        const { prepared, sections } = artifacts.get('187');
        const maxVariant = Math.max(...prepared.map((f) => polyLength(f.geometry.coordinates)));
        const total = sections.reduce((a, s) => a + polyLength(s.coords), 0);
        expect(total * LEN_SLACK).toBeGreaterThanOrEqual(maxVariant);
    });
});

describe('corridor sits on the mean of its strands (brainstorm-008 PR-2)', () => {
    // A corridor representing N strands belongs between them. Before the
    // re-centring stage a canonical node sat at the mean of whichever VERTICES
    // clustered into it, so its lateral position depended on vertex phase: a
    // node that caught one ida and one vuelta vertex landed on the centreline
    // while its neighbour that caught only ida sat ~half the carriageway
    // separation to the side. That alternation is the WOBBLE the oracles
    // flagged at 6-15 m on 25 sites.
    //
    // Synthetic fixtures do not reproduce it (a clean straight pair averages out
    // either way), so this is asserted on real geometry. Measured over these
    // five lines: mean offset 4.81 m and worst 26.0 m before, 1.15 m and 14.9 m
    // after — the residue being smoothing and simplification, which run later.
    const LINES = ['104', '100', '21', '180', '199'];
    const REACH_DEG = 0.00033; // 1.5 x cluster tolerance, the re-centring reach

    it('every corridor vertex lies near the mean of the strands under it', () => {
        let worst = 0;
        let sum = 0;
        let n = 0;
        for (const line of LINES) {
            const features = getFilteredRouteFeatures([line], null)
                .map((f) => prepareRouteFeature(f, null))
                .filter(Boolean);
            const strands = [];
            for (const f of features) {
                const g = f.geometry;
                const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
                for (const part of parts) if (part && part.length >= 2) strands.push(part);
            }
            if (strands.length < 2) continue;

            for (const sec of buildSections(features)) {
                for (const [x, y] of sec.coords) {
                    const near = [];
                    for (const st of strands) {
                        let best = null;
                        for (let i = 1; i < st.length; i++) {
                            const r = projectPointOnSegment(
                                x,
                                y,
                                st[i - 1][0],
                                st[i - 1][1],
                                st[i][0],
                                st[i][1],
                            );
                            if (!best || r.d2 < best.d2) best = r;
                        }
                        if (best && best.d2 <= REACH_DEG * REACH_DEG) near.push(best);
                    }
                    if (near.length < 2) continue; // nothing to average against
                    const mx = near.reduce((a, p) => a + p.x, 0) / near.length;
                    const my = near.reduce((a, p) => a + p.y, 0) / near.length;
                    const off = Math.hypot((x - mx) * M_PER_DEG_LON, (y - my) * M_PER_DEG_LAT);
                    worst = Math.max(worst, off);
                    sum += off;
                    n += 1;
                }
            }
        }
        expect(n).toBeGreaterThan(200); // not vacuous
        expect(sum / n, 'mean offset from the strand mean').toBeLessThan(2.5);
        expect(worst, 'worst offset from the strand mean').toBeLessThan(20);
    });

    // The price of that mean. Re-centring admits every strand within 1.5 x the
    // cluster radius OF THE NODE (36.7 m), which is wider than the radius at
    // which clustering merges vertices (24.4 m) — so where two carriageways fan
    // apart toward a fork, both are averaged in and the corridor is drawn in the
    // gap between them, up to 17.9 m from any trace (line 199's window: strands
    // 0-26 m apart, corridor 12.4 m from each).
    //
    // Making inclusion agree with the cluster radius was measured on 2026-07-27
    // and rejected: grouping the projections by mutual proximity fixes line 199
    // (12.4 m -> 5.6 m) and halves the tail network-wide (642 -> 263 vertices
    // beyond 10 m), but the per-node split decision flips along a chain and tears
    // corridors into near-parallel pieces — DUPLICATE renderings 6 -> 94..111,
    // the very artifact class brainstorm-008 PR-2 removed. Narrowing the reach
    // instead costs the same way (findings 368 -> 539 at 1.0 x, with or without
    // the "needs two strands" bail). Stable splitting would mean grouping strands
    // into bundles globally and re-centring per bundle, i.e. redesigning the
    // stage rather than tuning it.
    //
    // So the tail is accepted and pinned here instead, to keep it from growing
    // silently: at 2.0 x the reach these bounds fail (47 beyond 15 m, 4 beyond
    // 20 m, worst 21.3 m) — measured on the same lines.
    const GAP_LINES = ['124 Sd', '180', 'L30', '21', 'Bt2', '468', 'Ce1', 'D1', '199', '104'];

    it('never draws a corridor more than 20 m from every trace of its line', () => {
        let worst = 0;
        let beyond15 = 0;
        let n = 0;
        for (const line of GAP_LINES) {
            const features = getFilteredRouteFeatures([line], null)
                .map((f) => prepareRouteFeature(f, null))
                .filter(Boolean);
            if (!features.length) continue;
            const strands = [];
            for (const f of features) {
                const g = f.geometry;
                const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
                for (const part of parts) if (part && part.length >= 2) strands.push(part);
            }
            for (const sec of buildSections(features)) {
                for (const [x, y] of sec.coords) {
                    let best = null;
                    for (const st of strands) {
                        for (let i = 1; i < st.length; i++) {
                            const r = projectPointOnSegment(
                                x,
                                y,
                                st[i - 1][0],
                                st[i - 1][1],
                                st[i][0],
                                st[i][1],
                            );
                            if (!best || r.d2 < best.d2) best = r;
                        }
                    }
                    if (!best) continue;
                    const off = Math.hypot(
                        (x - best.x) * M_PER_DEG_LON,
                        (y - best.y) * M_PER_DEG_LAT,
                    );
                    worst = Math.max(worst, off);
                    if (off > 15) beyond15 += 1;
                    n += 1;
                }
            }
        }
        expect(n).toBeGreaterThan(800); // not vacuous
        expect(worst, 'worst corridor distance to any trace').toBeLessThan(20);
        expect(beyond15, 'corridor vertices beyond 15 m').toBeLessThanOrEqual(40);
    });
});
