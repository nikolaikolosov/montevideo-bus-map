/**
 * Route-geometry artifact oracles — the measurable taxonomy of
 * architecture/route-geometry-contract.md, applied per line to the REAL
 * pipeline output (prepareRouteFeature → buildSections, single-line build,
 * i.e. what a rider sees when one line is selected).
 *
 * Classes measured here:
 *   WOBBLE      corridor bends where the street is straight
 *   KINK        sawtooth corner the street does not have (60–150°, short flanks)
 *   DUPLICATE   one line drawn twice along the same street (6–20 m apart)
 *   SPIKE       degenerate out-and-back micro-reversal at a vertex
 *   SELF-CROSS  a corridor polyline properly crossing itself
 *   CHORD       corridor geometry detached from every digitised trace
 *   CORNER-CUT  guard-protected raw corner not honored by the corridor
 *   PHANTOM-FORK line branching where its variants carry identical sets (report-only)
 *
 * Covered by other suites (mapped in the contract, not re-measured here):
 *   GAP / SIDESTEP → tests/js/route-continuity.test.js (joints, sub-pixel)
 *   trim/cut heads → tests/js/route-downstream.test.js
 *   containment/length/connectivity → tests/js/route-invariants.test.js
 *
 * Each violation carries an auto-classification against the digitised
 * traces themselves: REAL when the raw data exhibits the same feature at
 * that location (divided carriageway, genuine street kink), BUG when the
 * pipeline introduced it. The committed whitelist (qa/) only accepts REAL.
 */

import { buildSections } from '../src/bundling.js';
import {
    toMeters,
    projectPointOnSegment,
    segmentLengthM,
    headingDeg,
    turnAngleDeg,
    axisAngleDeg,
    axialOverlapAndLateralM,
    segmentsProperlyIntersect,
    pointToPolylineDistM,
} from '../src/geometry.js';

/**
 * Thresholds. Grounded in the scale ladder measured by
 * scripts/derive_geometry_scales.mjs (qa/reports/geometry-scales-report.md);
 * calibration notes inline.
 */
export const ORACLE = {
    // WOBBLE: on a straight run (every segment within WOBBLE_AXIS_DEG of the
    // window chord, chord 120–400 m — block scale, where an artifact weave
    // lives) the corridor may not WEAVE: deviate more than WOBBLE_MAX_DEV_M
    // from the chord while crossing to BOTH sides of it by more than
    // WOBBLE_SIDE_M (3 m — above the P99 node jitter of the scale report).
    // Genuine street curves bow to one side and pass; S-curved avenues are
    // matched by the same measure on the digitised traces (verdict REAL).
    WOBBLE_AXIS_DEG: 8,
    WOBBLE_MIN_CHORD_M: 120,
    WOBBLE_MAX_CHORD_M: 400,
    WOBBLE_MAX_DEV_M: 6,
    WOBBLE_SIDE_M: 3,
    WOBBLE_RAW_MATCH_M: 80, // raw weave within this radius explains a corridor weave
    WOBBLE_RAW_MATCH_RATIO: 0.7,

    // KINK (ported from the PR #14 smoothness invariants): a 60–150° turn
    // with BOTH flanks shorter than 35 m. Real corners turn once between
    // blocks; 150–180° short-leg turnarounds are terminals, handled by SPIKE.
    KINK_MIN_TURN_DEG: 60,
    KINK_MAX_TURN_DEG: 150,
    KINK_MAX_FLANK_M: 35,

    // DUPLICATE (ported): near-parallel (≤10°) same-line segments of
    // different sections, ≥40 m axial overlap, 6–20 m apart. Below 6 m they
    // render as one strand; above 20 m carriageways are physically separate.
    DUP_MIN_SEG_M: 40,
    DUP_MAX_AXIS_DEG: 10,
    DUP_MIN_OVERLAP_M: 40,
    DUP_MIN_LAT_M: 6,
    DUP_MAX_LAT_M: 20,

    // SPIKE: ≥160° reversal where the flanks return within 10 m — an
    // out-and-back the width of a driveway is geometry noise, a real
    // terminal loop is wider.
    SPIKE_MIN_TURN_DEG: 160,
    SPIKE_MAX_GAP_M: 10,
    SPIKE_MAX_FLANK_M: 30,

    // CHORD: every corridor vertex and 50 m-step sample must stay within
    // CHORD_MAX_M of some digitised trace of the line. Budget: cluster mean
    // (≤ tolerance 24 m worst axis) + smoothing (≤ 11 m) + simplify (4 m)
    // never compound fully; route-invariants bounds the reverse direction
    // at ~20 m. 30 m flags true detachments only.
    CHORD_MAX_M: 30,
    CHORD_SAMPLE_STEP_M: 50,

    // CORNER-CUT: a raw corner (60–150°) whose flanks exceed the smoothing
    // guard (66 m) is immovable by smoothing — but its vertex still joins a
    // cluster whose running mean may sit up to BUNDLE_TOLERANCE_DEG away
    // (24.4 m on the lat axis), plus simplify-eps (4.4 m). 30 m therefore
    // flags only corners swept beyond the ladder's whole budget (the F4
    // unguarded-smoothing failure class ran to hundreds of meters).
    CORNER_MIN_TURN_DEG: 60,
    CORNER_MAX_TURN_DEG: 150,
    CORNER_GUARD_FLANK_M: 66,
    CORNER_MAX_DIST_M: 30,

    // PHANTOM-FORK (report-only): ≥3 sections of one line meet at a node
    // and at least two of them carry IDENTICAL variant sets at a mutual
    // angle ≤ 30° — the same buses split into parallel strands.
    FORK_MAX_ANGLE_DEG: 30,

    // Classification against the digitised traces.
    RAW_WINDOW_M: 60, // look for raw evidence within this radius
    RAW_KINK_RADIUS_M: 25,
    RAW_KINK_TURN_SLACK_DEG: 25,
};

/** Flattens a prepared feature to [lon,lat][] paths. */
const featurePaths = (f) => {
    const g = f.geometry;
    return g.type === 'LineString' ? [g.coordinates] : g.coordinates;
};

/**
 * Builds the per-line pipeline output once: prepared paths (the digitised
 * evidence base) and the line's own corridor sections.
 *
 * @param {string} line
 * @param {object[]} prepared - prepareRouteFeature output for the line's variants
 * @returns {{paths: number[][][], sections: import('../src/bundling.js').Section[]}}
 */
export function buildLineGeometry(line, prepared) {
    const sections = buildSections(prepared).filter((s) => s.lines.includes(line));
    const paths = prepared.flatMap(featurePaths).filter((p) => p && p.length >= 2);
    return { paths, sections };
}

// ---------------------------------------------------------------------------
// Raw-evidence classification helpers
// ---------------------------------------------------------------------------

/**
 * Max lateral separation between near-parallel digitised segments within
 * RAW_WINDOW_M of `at` — evidence that the street itself carries two strands
 * (divided carriageway) at that location.
 */
export function rawParallelSeparationNear(paths, at) {
    const atM = toMeters(at);
    const near = [];
    for (const path of paths) {
        for (let i = 0; i < path.length - 1; i++) {
            const a = toMeters(path[i]);
            const b = toMeters(path[i + 1]);
            const r = projectPointOnSegment(atM[0], atM[1], a[0], a[1], b[0], b[1]);
            if (r.d2 <= ORACLE.RAW_WINDOW_M ** 2) {
                near.push({ seg: [path[i], path[i + 1]], h: headingDeg(path[i], path[i + 1]) });
            }
        }
    }
    let maxSep = 0;
    for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
            if (axisAngleDeg(near[i].h, near[j].h) > ORACLE.DUP_MAX_AXIS_DEG) continue;
            const ol = axialOverlapAndLateralM(near[i].seg, near[j].seg);
            if (ol && ol.overlap > 10 && ol.lat > maxSep) maxSep = ol.lat;
        }
    }
    return maxSep;
}

/** True when a digitised trace turns similarly near `at` (a real street kink). */
export function rawKinkNear(paths, at, turn) {
    for (const path of paths) {
        for (let i = 1; i < path.length - 1; i++) {
            if (segmentLengthM(path[i], at) > ORACLE.RAW_KINK_RADIUS_M) continue;
            const rawTurn = turnAngleDeg(path[i - 1], path[i], path[i + 1]);
            if (Math.abs(rawTurn - turn) <= ORACLE.RAW_KINK_TURN_SLACK_DEG) return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Per-class measures (each returns violations with lon/lat anchors)
// ---------------------------------------------------------------------------

/**
 * Signed chord deviations of interior vertices (meters; sign = side of the
 * chord). Positive = left of a→b.
 */
function chordDeviations(coords, start, end) {
    const aM = toMeters(coords[start]);
    const bM = toMeters(coords[end]);
    const dx = bM[0] - aM[0];
    const dy = bM[1] - aM[1];
    const L = Math.hypot(dx, dy);
    if (L === 0) return [];
    const out = [];
    for (let i = start + 1; i < end; i++) {
        const pM = toMeters(coords[i]);
        const dev = (-(pM[0] - aM[0]) * dy + (pM[1] - aM[1]) * dx) / L;
        out.push({ i, dev });
    }
    return out;
}

/** WOBBLE windows of ONE polyline (shared by corridor measure and raw match). */
export function wobblesOfPolyline(c) {
    const out = [];
    let start = 0;
    while (start < c.length - 1) {
        // Grow the window while every segment stays parallel to the chord
        // and the chord stays at block scale.
        let end = start + 1;
        while (end + 1 < c.length) {
            if (segmentLengthM(c[start], c[end + 1]) > ORACLE.WOBBLE_MAX_CHORD_M) break;
            const chordH = headingDeg(c[start], c[end + 1]);
            let parallel = true;
            for (let i = start; i <= end; i++) {
                if (axisAngleDeg(chordH, headingDeg(c[i], c[i + 1])) > ORACLE.WOBBLE_AXIS_DEG) {
                    parallel = false;
                    break;
                }
            }
            if (!parallel) break;
            end++;
        }
        if (segmentLengthM(c[start], c[end]) >= ORACLE.WOBBLE_MIN_CHORD_M) {
            const devs = chordDeviations(c, start, end);
            let worst = null;
            let minDev = 0;
            let maxDev = 0;
            for (const { i, dev } of devs) {
                minDev = Math.min(minDev, dev);
                maxDev = Math.max(maxDev, dev);
                if (!worst || Math.abs(dev) > Math.abs(worst.dev)) worst = { i, dev };
            }
            if (
                worst &&
                Math.abs(worst.dev) > ORACLE.WOBBLE_MAX_DEV_M &&
                minDev < -ORACLE.WOBBLE_SIDE_M &&
                maxDev > ORACLE.WOBBLE_SIDE_M
            ) {
                out.push({ at: c[worst.i], devM: +Math.abs(worst.dev).toFixed(1) });
            }
        }
        start = Math.max(end, start + 1);
    }
    return out;
}

/** WOBBLE — two-sided weave across the chord of a straight run. */
export function measureWobble(sections) {
    return sections.flatMap((s) => wobblesOfPolyline(s.coords));
}

/**
 * True when a digitised trace weaves the same way near `at` (same measure,
 * same thresholds, run on the raw paths) — the street or its digitisation
 * really is that crooked, so the corridor faithfully follows it.
 */
export function rawWobbleNear(rawWobbles, at, devM) {
    for (const w of rawWobbles) {
        if (
            segmentLengthM(w.at, at) <= ORACLE.WOBBLE_RAW_MATCH_M &&
            w.devM >= devM * ORACLE.WOBBLE_RAW_MATCH_RATIO
        ) {
            return true;
        }
    }
    return false;
}

/** KINK — sawtooth corners (both flanks short). */
export function measureKinks(sections) {
    const out = [];
    for (const s of sections) {
        const c = s.coords;
        for (let i = 1; i < c.length - 1; i++) {
            const l1 = segmentLengthM(c[i - 1], c[i]);
            const l2 = segmentLengthM(c[i], c[i + 1]);
            if (l1 > ORACLE.KINK_MAX_FLANK_M || l2 > ORACLE.KINK_MAX_FLANK_M) continue;
            const turn = turnAngleDeg(c[i - 1], c[i], c[i + 1]);
            if (turn > ORACLE.KINK_MIN_TURN_DEG && turn < ORACLE.KINK_MAX_TURN_DEG) {
                out.push({ at: c[i], turn: +turn.toFixed(0) });
            }
        }
    }
    return out;
}

/** DUPLICATE — visible parallel strands of one line (different sections). */
export function measureDuplicates(sections) {
    const segs = [];
    sections.forEach((s, si) => {
        for (let i = 1; i < s.coords.length; i++) {
            const sg = [s.coords[i - 1], s.coords[i]];
            if (segmentLengthM(sg[0], sg[1]) >= ORACLE.DUP_MIN_SEG_M) segs.push({ si, sg });
        }
    });
    const out = [];
    for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
            if (segs[i].si === segs[j].si) continue;
            const h1 = headingDeg(segs[i].sg[0], segs[i].sg[1]);
            const h2 = headingDeg(segs[j].sg[0], segs[j].sg[1]);
            if (axisAngleDeg(h1, h2) > ORACLE.DUP_MAX_AXIS_DEG) continue;
            const ol = axialOverlapAndLateralM(segs[i].sg, segs[j].sg);
            if (
                ol &&
                ol.overlap > ORACLE.DUP_MIN_OVERLAP_M &&
                ol.lat >= ORACLE.DUP_MIN_LAT_M &&
                ol.lat <= ORACLE.DUP_MAX_LAT_M
            ) {
                // Anchor at the overlap midpoint — city blocks are long and
                // the segment's first vertex can sit far from where the two
                // strands actually run side by side.
                out.push({ at: ol.mid, latM: +ol.lat.toFixed(1) });
            }
        }
    }
    return out;
}

/** SPIKE — degenerate micro-reversals. */
export function measureSpikes(sections) {
    const out = [];
    for (const s of sections) {
        const c = s.coords;
        for (let i = 1; i < c.length - 1; i++) {
            const turn = turnAngleDeg(c[i - 1], c[i], c[i + 1]);
            if (turn < ORACLE.SPIKE_MIN_TURN_DEG) continue;
            const l1 = segmentLengthM(c[i - 1], c[i]);
            const l2 = segmentLengthM(c[i], c[i + 1]);
            if (l1 > ORACLE.SPIKE_MAX_FLANK_M || l2 > ORACLE.SPIKE_MAX_FLANK_M) continue;
            if (segmentLengthM(c[i - 1], c[i + 1]) <= ORACLE.SPIKE_MAX_GAP_M) {
                out.push({ at: c[i], turn: +turn.toFixed(0) });
            }
        }
    }
    return out;
}

/** SELF-CROSS — a section polyline properly crossing itself. */
export function measureSelfCrossings(sections) {
    const out = [];
    for (const s of sections) {
        const c = s.coords;
        for (let i = 0; i < c.length - 1; i++) {
            for (let j = i + 2; j < c.length - 1; j++) {
                if (i === 0 && j === c.length - 2 && c[0] === c[c.length - 1]) continue;
                if (segmentsProperlyIntersect(c[i], c[i + 1], c[j], c[j + 1])) {
                    out.push({ at: c[i] });
                }
            }
        }
    }
    return out;
}

/** CHORD — corridor geometry farther than CHORD_MAX_M from every trace. */
export function measureChords(sections, paths) {
    const out = [];
    const checkPoint = (p) => {
        let best = Infinity;
        for (const path of paths) {
            const d = pointToPolylineDistM(p, path);
            if (d < best) best = d;
            if (best <= ORACLE.CHORD_MAX_M) return null;
        }
        return best;
    };
    for (const s of sections) {
        const c = s.coords;
        for (let i = 0; i < c.length; i++) {
            const d = checkPoint(c[i]);
            if (d !== null) {
                out.push({ at: c[i], distM: +d.toFixed(1) });
                continue;
            }
            // Sample long segments: a chord's midpoint strays even when its
            // endpoints sit on the street.
            if (i === 0) continue;
            const L = segmentLengthM(c[i - 1], c[i]);
            for (let s2 = ORACLE.CHORD_SAMPLE_STEP_M; s2 < L; s2 += ORACLE.CHORD_SAMPLE_STEP_M) {
                const t = s2 / L;
                const mid = [
                    c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t,
                    c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t,
                ];
                const dm = checkPoint(mid);
                if (dm !== null) {
                    out.push({ at: mid, distM: +dm.toFixed(1) });
                    break;
                }
            }
        }
    }
    return out;
}

/** CORNER-CUT — guard-protected raw corners the corridor fails to honor. */
export function measureCornerCuts(sections, paths) {
    const out = [];
    for (const path of paths) {
        for (let i = 1; i < path.length - 1; i++) {
            const turn = turnAngleDeg(path[i - 1], path[i], path[i + 1]);
            if (turn <= ORACLE.CORNER_MIN_TURN_DEG || turn >= ORACLE.CORNER_MAX_TURN_DEG) continue;
            const l1 = segmentLengthM(path[i - 1], path[i]);
            const l2 = segmentLengthM(path[i], path[i + 1]);
            if (l1 <= ORACLE.CORNER_GUARD_FLANK_M || l2 <= ORACLE.CORNER_GUARD_FLANK_M) continue;
            let best = Infinity;
            for (const s of sections) {
                const d = pointToPolylineDistM(path[i], s.coords);
                if (d < best) best = d;
                if (best <= ORACLE.CORNER_MAX_DIST_M) break;
            }
            if (best > ORACLE.CORNER_MAX_DIST_M) {
                out.push({ at: path[i], distM: +best.toFixed(1), turn: +turn.toFixed(0) });
            }
        }
    }
    return out;
}

/** PHANTOM-FORK — same variant set splitting into parallel strands (report-only). */
export function measurePhantomForks(sections, line) {
    const byNode = new Map();
    for (const sec of sections) {
        if (sec.coords.length < 2) continue;
        for (const nodeIsEnd of [false, true]) {
            const node = nodeIsEnd ? sec.coords[sec.coords.length - 1] : sec.coords[0];
            const nb = nodeIsEnd ? sec.coords[sec.coords.length - 2] : sec.coords[1];
            const key = `${node[0]},${node[1]}`;
            if (!byNode.has(key)) byNode.set(key, []);
            byNode.get(key).push({ sec, node, h: headingDeg(node, nb) });
        }
    }
    const out = [];
    for (const entries of byNode.values()) {
        if (entries.length < 3) continue;
        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                const a = entries[i];
                const b = entries[j];
                if (a.sec === b.sec) continue;
                const va = [...(a.sec.variantsByLine.get(line) ?? [])].sort().join('|');
                const vb = [...(b.sec.variantsByLine.get(line) ?? [])].sort().join('|');
                if (va === '' || va !== vb) continue;
                if (axisAngleDeg(a.h, b.h) <= ORACLE.FORK_MAX_ANGLE_DEG) {
                    out.push({ at: a.node });
                }
            }
        }
    }
    return out;
}

/**
 * All oracle measures for one line, with raw-evidence classification.
 * @returns {{class: string, line: string, at: number[], detail: object,
 *            verdict: 'REAL'|'BUG'|'INFO'}[]}
 */
export function measureLine(line, prepared) {
    const { paths, sections } = buildLineGeometry(line, prepared);
    const found = [];
    const seen = new Set();
    const add = (cls, items, verdictOf) => {
        for (const v of items) {
            const { at, ...detail } = v;
            // Dedupe findings from parallel variant paths / section pairs
            // hitting the same spot (~10 m grid).
            const key = `${cls}_${Math.round(at[0] * 1e4)}_${Math.round(at[1] * 1e4)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            found.push({ class: cls, line, at, detail, verdict: verdictOf ? verdictOf(v) : 'BUG' });
        }
    };

    add('DUPLICATE', measureDuplicates(sections), (v) =>
        rawParallelSeparationNear(paths, v.at) >= ORACLE.DUP_MIN_LAT_M ? 'REAL' : 'BUG',
    );
    add('KINK', measureKinks(sections), (v) => (rawKinkNear(paths, v.at, v.turn) ? 'REAL' : 'BUG'));
    const rawWobbles = paths.flatMap((p) => wobblesOfPolyline(p));
    add('WOBBLE', measureWobble(sections), (v) =>
        rawWobbleNear(rawWobbles, v.at, v.devM) ? 'REAL' : 'BUG',
    );
    add('SPIKE', measureSpikes(sections), (v) =>
        rawKinkNear(paths, v.at, v.turn) ? 'REAL' : 'BUG',
    );
    add('SELF-CROSS', measureSelfCrossings(sections));
    add('CHORD', measureChords(sections, paths));
    add('CORNER-CUT', measureCornerCuts(sections, paths));
    for (const v of measurePhantomForks(sections, line)) {
        const key = `PHANTOM-FORK_${Math.round(v.at[0] * 1e4)}_${Math.round(v.at[1] * 1e4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ class: 'PHANTOM-FORK', line, at: v.at, detail: {}, verdict: 'INFO' });
    }
    return found;
}
