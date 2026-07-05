/**
 * Scale-ladder derivation: measures the geometric properties of the
 * committed dataset that the pipeline constants (src/config.js) must be
 * sized against, writes the evidence report, and FAILS when a constant no
 * longer sits where the data says it should (rule R-BOUNDED / scale ladder
 * of architecture/route-geometry-contract.md).
 *
 * Run: npm run verify:scales      (part of the data-update runbook step)
 *
 * Measured on the prepared traces (trimToStops applied — what bundling
 * actually consumes):
 *
 *  1. SAME-LINE STRAND SEPARATIONS — for every pair of variants of one
 *     line, lateral distance from samples of one trace to the other where
 *     the two run near-parallel (axis angle ≤ 25°, within 40 m). Split by
 *     relative direction: same-direction pairs measure digitisation
 *     jitter; opposite-direction pairs measure the ida/vuelta carriageway
 *     offset that BUNDLE_TOLERANCE_DEG must swallow.
 *
 *  2. CORNER / SEGMENT-LENGTH STATS — how many genuine corners (turn > 60°)
 *     are flanked by segments longer than BUNDLE_SMOOTH_MAX_SEG_DEG and are
 *     therefore protected from smoothing (the guard that keeps km-scale
 *     peripheral corners in place).
 *
 * The assertion bounds are calibrated against the 2026-06-27 dataset with
 * stated headroom; a data update that shifts the distributions past them
 * must be answered by re-deriving the constants, not by loosening the
 * bounds blindly.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// offsetline.js subclasses L.Polyline at import time — same minimal stub as
// the unit-test setup (tests/js/setup.js).
globalThis.L = {
    point: (x, y) => ({ x, y }),
    Polyline: { extend: (proto) => proto },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { CONFIG } = await import('../src/config.js');
const { buildIndexes, getSortedLines, getFilteredRouteFeatures } = await import('../src/data.js');
const { prepareRouteFeature } = await import('../src/map.js');
const {
    M_PER_DEG_LON,
    M_PER_DEG_LAT,
    toMeters,
    projectPointOnSegment,
    segmentLengthM,
    headingDeg,
    turnAngleDeg,
    axisAngleDeg,
} = await import('../src/geometry.js');

// --- Measurement parameters (method, committed with the report) ------------
const SAMPLE_STEP_M = 75; // sample spacing along a trace
const MAX_SAMPLES_PER_PAIR = 500;
const NEAR_CAP_M = 40; // beyond this, strands are unrelated streets
const PARALLEL_MAX_AXIS_DEG = 25; // samples count only where strands run parallel
const GRID_CELL_M = 50;

// --- Data -------------------------------------------------------------------
const routes = JSON.parse(readFileSync(join(root, 'routes.json'), 'utf8'));
const stops = JSON.parse(readFileSync(join(root, 'stops.json'), 'utf8'));
buildIndexes(routes, stops);

// --- Helpers ----------------------------------------------------------------
const pct = (sorted, p) => {
    if (sorted.length === 0) return NaN;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[i];
};

/** Uniform grid over a polyline's segments (meter space) for near lookups. */
class SegmentGrid {
    constructor(coordsM) {
        this.coords = coordsM;
        this.cells = new Map();
        for (let i = 0; i < coordsM.length - 1; i++) {
            const [ax, ay] = coordsM[i];
            const [bx, by] = coordsM[i + 1];
            const x0 = Math.floor(Math.min(ax, bx) / GRID_CELL_M) - 1;
            const x1 = Math.floor(Math.max(ax, bx) / GRID_CELL_M) + 1;
            const y0 = Math.floor(Math.min(ay, by) / GRID_CELL_M) - 1;
            const y1 = Math.floor(Math.max(ay, by) / GRID_CELL_M) + 1;
            for (let cx = x0; cx <= x1; cx++) {
                for (let cy = y0; cy <= y1; cy++) {
                    const key = `${cx}_${cy}`;
                    if (!this.cells.has(key)) this.cells.set(key, []);
                    this.cells.get(key).push(i);
                }
            }
        }
    }

    /** Nearest segment within NEAR_CAP_M: { d, i } or null. */
    nearest(px, py) {
        const cx = Math.floor(px / GRID_CELL_M);
        const cy = Math.floor(py / GRID_CELL_M);
        let best = null;
        const seen = new Set();
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const ids = this.cells.get(`${cx + dx}_${cy + dy}`);
                if (!ids) continue;
                for (const i of ids) {
                    if (seen.has(i)) continue;
                    seen.add(i);
                    const a = this.coords[i];
                    const b = this.coords[i + 1];
                    const r = projectPointOnSegment(px, py, a[0], a[1], b[0], b[1]);
                    if (!best || r.d2 < best.d2) best = { d2: r.d2, i };
                }
            }
        }
        if (!best || best.d2 > NEAR_CAP_M * NEAR_CAP_M) return null;
        return { d: Math.sqrt(best.d2), i: best.i };
    }
}

/** Evenly spaced samples along a polyline (meter space): [x, y, headingDeg]. */
function sampleAlong(coordsM, headings) {
    const samples = [];
    let carried = 0;
    for (let i = 0; i < coordsM.length - 1; i++) {
        const [ax, ay] = coordsM[i];
        const [bx, by] = coordsM[i + 1];
        const segLen = Math.hypot(bx - ax, by - ay);
        if (segLen === 0) continue;
        let at = SAMPLE_STEP_M - carried;
        while (at <= segLen) {
            const t = at / segLen;
            samples.push([ax + (bx - ax) * t, ay + (by - ay) * t, headings[i]]);
            if (samples.length >= MAX_SAMPLES_PER_PAIR) return samples;
            at += SAMPLE_STEP_M;
        }
        carried = (carried + segLen) % SAMPLE_STEP_M;
    }
    return samples;
}

// --- 1. Strand separations ---------------------------------------------------
const sameDir = [];
const oppDir = [];

for (const line of getSortedLines()) {
    const variants = getFilteredRouteFeatures([line], null)
        .map((f) => prepareRouteFeature(f, null))
        .filter(Boolean)
        .map((f) => {
            const coords = f.geometry.coordinates;
            const flat = typeof coords[0][0] === 'number' ? coords : coords.flat();
            const m = flat.map(toMeters);
            const headings = [];
            for (let i = 0; i < flat.length - 1; i++)
                headings.push(headingDeg(flat[i], flat[i + 1]));
            const xs = m.map((p) => p[0]);
            const ys = m.map((p) => p[1]);
            return {
                m,
                headings,
                bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
            };
        })
        .filter((v) => v.m.length >= 2);

    const grids = variants.map(() => null);
    for (let a = 0; a < variants.length; a++) {
        for (let b = a + 1; b < variants.length; b++) {
            const A = variants[a];
            const B = variants[b];
            if (
                A.bbox[2] + NEAR_CAP_M < B.bbox[0] ||
                B.bbox[2] + NEAR_CAP_M < A.bbox[0] ||
                A.bbox[3] + NEAR_CAP_M < B.bbox[1] ||
                B.bbox[3] + NEAR_CAP_M < A.bbox[1]
            ) {
                continue;
            }
            if (!grids[b]) grids[b] = new SegmentGrid(B.m);
            const grid = grids[b];
            for (const [sx, sy, hA] of sampleAlong(A.m, A.headings)) {
                const near = grid.nearest(sx, sy);
                if (!near) continue;
                const hB = B.headings[near.i];
                if (axisAngleDeg(hA, hB) > PARALLEL_MAX_AXIS_DEG) continue;
                let diff = Math.abs(hA - hB) % 360;
                if (diff > 180) diff = 360 - diff;
                (diff > 90 ? oppDir : sameDir).push(near.d);
            }
        }
    }
}

sameDir.sort((x, y) => x - y);
oppDir.sort((x, y) => x - y);

// --- 2. Corner / segment stats ----------------------------------------------
const maxSegM_LO = CONFIG.BUNDLE_SMOOTH_MAX_SEG_DEG * M_PER_DEG_LON;
let corners = 0;
let guardedCorners = 0;
const segLens = [];
for (const line of getSortedLines()) {
    for (const f of getFilteredRouteFeatures([line], null)) {
        const prepared = prepareRouteFeature(f, null);
        if (!prepared) continue;
        const coords = prepared.geometry.coordinates;
        const flat = typeof coords[0][0] === 'number' ? coords : coords.flat();
        for (let i = 1; i < flat.length; i++) segLens.push(segmentLengthM(flat[i - 1], flat[i]));
        for (let i = 1; i < flat.length - 1; i++) {
            const turn = turnAngleDeg(flat[i - 1], flat[i], flat[i + 1]);
            if (turn <= 60 || turn >= 150) continue; // corners, not wiggle/hairpins
            corners++;
            const l1 = segmentLengthM(flat[i - 1], flat[i]);
            const l2 = segmentLengthM(flat[i], flat[i + 1]);
            if (l1 > maxSegM_LO && l2 > maxSegM_LO) guardedCorners++;
        }
    }
}
segLens.sort((x, y) => x - y);

// --- Constants in meters ------------------------------------------------------
const degToM = (deg) => [deg * M_PER_DEG_LON, deg * M_PER_DEG_LAT];
const [tolLo, tolHi] = degToM(CONFIG.BUNDLE_TOLERANCE_DEG);
const [epsLo] = degToM(CONFIG.BUNDLE_SIMPLIFY_EPS_DEG);
const [shiftLo] = degToM(CONFIG.BUNDLE_SMOOTH_MAX_SHIFT_DEG);
const CLEAN_THRESHOLD_DEG = 0.00001; // cleanCoordinates literal (src/utils.js)

const stats = {
    samples: { sameDir: sameDir.length, oppDir: oppDir.length },
    sameDirP: { p50: pct(sameDir, 50), p90: pct(sameDir, 90), p99: pct(sameDir, 99) },
    oppDirP: { p50: pct(oppDir, 50), p75: pct(oppDir, 75), p90: pct(oppDir, 90) },
    residueShare: oppDir.filter((d) => d >= 6 && d <= 20).length / Math.max(1, oppDir.length),
    corners,
    guardedCorners,
    segLenP: { p50: pct(segLens, 50), p90: pct(segLens, 90), p99: pct(segLens, 99) },
};

// --- Assertions (calibrated 2026-06-27 dataset; headroom stated) --------------
const failures = [];
const assertThat = (ok, label) => {
    if (!ok) failures.push(label);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// Ladder ordering is structural: each stage may only move geometry by less
// than what the next stage treats as identity.
assertThat(
    CLEAN_THRESHOLD_DEG < CONFIG.BUNDLE_SIMPLIFY_EPS_DEG &&
        CONFIG.BUNDLE_SIMPLIFY_EPS_DEG < CONFIG.BUNDLE_SMOOTH_MAX_SHIFT_DEG &&
        CONFIG.BUNDLE_SMOOTH_MAX_SHIFT_DEG < CONFIG.BUNDLE_TOLERANCE_DEG,
    'ladder ordering: clean < simplify-eps < smooth-shift < cluster-tolerance',
);

// Same-direction strands of one line are digitisation jitter of the SAME
// street: Douglas–Peucker must dominate them. Measured P90 1.9 m vs eps
// 3.7 m on the 2026-06-27 dataset (~2× headroom).
assertThat(
    stats.sameDirP.p90 <= epsLo,
    `same-direction separation P90 ${stats.sameDirP.p90?.toFixed(1)} m ≤ simplify eps ${epsLo.toFixed(1)} m`,
);

// Opposite-direction (ida/vuelta) offsets are what the cluster tolerance was
// sized against. Measured on 2026-06-27: P50 1.3 m (most pairs share the
// digitised centerline), P90 14.2 m vs merge radius 20.2 m. If a data update
// pushes P90 past the radius, corridors stop merging network-wide — resize
// BUNDLE_TOLERANCE_DEG rather than loosening this bound.
assertThat(
    stats.oppDirP.p50 <= epsLo,
    `opposite-direction separation P50 ${stats.oppDirP.p50?.toFixed(1)} m ≤ simplify eps ${epsLo.toFixed(1)} m`,
);
assertThat(
    stats.oppDirP.p90 <= tolLo,
    `opposite-direction separation P90 ${stats.oppDirP.p90?.toFixed(1)} m ≤ merge radius ${tolLo.toFixed(1)} m (lon axis)`,
);

// The smoothing guard must have real work to do on BOTH sides: unguarded
// urban sawteeth (short flanks) and guarded genuine corners (long flanks).
assertThat(
    guardedCorners > 0 && guardedCorners < corners,
    `smoothing guard separates corner population (${guardedCorners}/${corners} guarded)`,
);

// --- Report -------------------------------------------------------------------
const bucket = (arr, step, max) => {
    const out = [];
    for (let lo = 0; lo < max; lo += step) {
        out.push({
            band: `${lo}–${lo + step}`,
            n: arr.filter((d) => d >= lo && d < lo + step).length,
        });
    }
    return out;
};

const fmtRow = (b) => `| ${b.band} m | ${b.n} |`;
const report = `# Geometry Scale Ladder — Derivation Report

> Generated by \`npm run verify:scales\` (scripts/derive_geometry_scales.mjs).
> Dataset: committed routes.json / stops.json. Method: prepared traces
> (trimToStops applied), same-line variant pairs sampled every ${SAMPLE_STEP_M} m,
> parallel = axis angle ≤ ${PARALLEL_MAX_AXIS_DEG}°, near cap ${NEAR_CAP_M} m.
> Representativeness: full network (140 lines), no cache, deterministic.

## Constants under test (src/config.js)

| Constant | degrees | meters (lon/lat axis) |
|---|---|---|
| cleanCoordinates threshold | ${CLEAN_THRESHOLD_DEG} | ${degToM(CLEAN_THRESHOLD_DEG)[0].toFixed(1)} / ${degToM(CLEAN_THRESHOLD_DEG)[1].toFixed(1)} |
| BUNDLE_SIMPLIFY_EPS_DEG | ${CONFIG.BUNDLE_SIMPLIFY_EPS_DEG} | ${epsLo.toFixed(1)} / ${degToM(CONFIG.BUNDLE_SIMPLIFY_EPS_DEG)[1].toFixed(1)} |
| BUNDLE_SMOOTH_MAX_SHIFT_DEG | ${CONFIG.BUNDLE_SMOOTH_MAX_SHIFT_DEG} | ${shiftLo.toFixed(1)} / ${degToM(CONFIG.BUNDLE_SMOOTH_MAX_SHIFT_DEG)[1].toFixed(1)} |
| BUNDLE_TOLERANCE_DEG | ${CONFIG.BUNDLE_TOLERANCE_DEG} | ${tolLo.toFixed(1)} / ${tolHi.toFixed(1)} |

## Same-line strand separations (parallel samples)

|  | same direction | opposite direction |
|---|---|---|
| samples | ${stats.samples.sameDir} | ${stats.samples.oppDir} |
| P50 | ${stats.sameDirP.p50?.toFixed(1)} m | ${stats.oppDirP.p50?.toFixed(1)} m |
| P75 | — | ${stats.oppDirP.p75?.toFixed(1)} m |
| P90 | ${stats.sameDirP.p90?.toFixed(1)} m | ${stats.oppDirP.p90?.toFixed(1)} m |
| P99 | ${stats.sameDirP.p99?.toFixed(1)} m | — |

Opposite-direction histogram (the 6–20 m band is the visible-duplicate
residue band of the smoothness oracle; share: ${(stats.residueShare * 100).toFixed(1)} %):

| band | samples |
|---|---|
${bucket(oppDir, 4, NEAR_CAP_M).map(fmtRow).join('\n')}

## Corner / segment stats (prepared traces)

- corner vertices (60–150° turn): ${corners}, of which guard-protected
  (both flanks > ${maxSegM_LO.toFixed(0)} m): ${guardedCorners}
- segment length P50/P90/P99: ${stats.segLenP.p50?.toFixed(0)} / ${stats.segLenP.p90?.toFixed(0)} / ${stats.segLenP.p99?.toFixed(0)} m

## Assertion results

${failures.length === 0 ? 'All assertions PASS.' : failures.map((f) => `- FAIL: ${f}`).join('\n')}
`;

mkdirSync(join(root, 'qa', 'reports'), { recursive: true });
writeFileSync(join(root, 'qa', 'reports', 'geometry-scales-report.md'), report);
console.log('\nReport written to qa/reports/geometry-scales-report.md');

if (failures.length > 0) {
    console.error(`\n${failures.length} assertion(s) failed`);
    process.exit(1);
}
