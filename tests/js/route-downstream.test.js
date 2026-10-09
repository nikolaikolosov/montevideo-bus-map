/**
 * Downstream-render fidelity invariants (user report 2026-07-05).
 *
 * When a stop is selected, every variant's rendered geometry must FOLLOW the
 * recorded trace — no synthetic vertices, no chords across city blocks. The
 * old truncateLineDownstream injected the stop's coordinate as the first
 * vertex; for stops sitting off their route's trace that drew straight lines
 * over buildings (stops 4534/3987) and phantom branches (D1 at stop 3179).
 *
 * Invariant, checked on the REAL data through the REAL pipeline: for every
 * (stop, variant), prepareRouteFeature(f, stop) returns a suffix of
 * prepareRouteFeature(f, null)'s vertices, preceded by at most one head point
 * that lies exactly ON the trace segment it cuts.
 *
 * Second invariant (review 2026-10-09): the cut must follow the stop ORDER. On a
 * route that passes the same street twice the nearest projection of a stop can
 * sit on the other pass, and the downstream view then started kilometres from
 * where the rider boards. Measured black-box through the same function: the
 * drawn downstream length can only shrink as the boarding stop moves down the
 * route.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    buildIndexes,
    stopVariantsMap,
    stopsByVariant,
    uniqueStopByCode,
    routesByVariant,
} from '../../src/data.js';
import { prepareRouteFeature } from '../../src/map.js';
import { polylineLengthM } from '../../src/geometry.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Distance² from point p to segment [a, b] (degree space, city scale). */
function distSqToSegment(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = p[0] - (a[0] + t * dx);
    const ey = p[1] - (a[1] + t * dy);
    return ex * ex + ey * ey;
}

// ~1 cm in degrees — pure float tolerance, far below any real geometry.
const EPS_SQ = 1e-7 * 1e-7;

/**
 * Asserts the downstream render of one variant from one stop follows the
 * variant's full trimmed trace. Returns false when the variant has nothing
 * downstream (terminal) — a legitimate outcome, counted by the caller.
 */
function checkVariantDownstream(stopCode, variantId) {
    const source = uniqueStopByCode.get(stopCode);
    const feature = routesByVariant.get(variantId)?.[0];
    if (!feature) return false;

    const full = prepareRouteFeature(feature, null);
    const down = prepareRouteFeature(feature, source.geometry.coordinates, stopCode);
    if (!down) return false; // terminal: nothing downstream

    const trace = full.geometry.coordinates;
    const coords = down.geometry.coordinates;
    expect(coords.length).toBeGreaterThanOrEqual(2);

    // The tail (all but the head) must be a literal vertex-suffix of the trace.
    const tail = coords.slice(1);
    const suffixStart = trace.length - tail.length;
    expect(suffixStart, `${variantId}@${stopCode}: tail longer than trace`).toBeGreaterThan(0);
    for (let k = 0; k < tail.length; k++) {
        expect(tail[k], `${variantId}@${stopCode}: vertex ${k} diverges from the trace`).toEqual(
            trace[suffixStart + k],
        );
    }

    // The head must lie ON the trace segment it cuts (projection, not the stop).
    const head = coords[0];
    const d2 = distSqToSegment(head, trace[suffixStart - 1], trace[suffixStart]);
    expect(d2, `${variantId}@${stopCode}: head off the trace`).toBeLessThan(EPS_SQ);
    return true;
}

beforeAll(() => {
    const routes = JSON.parse(readFileSync(join(root, 'routes.json'), 'utf8'));
    const stops = JSON.parse(readFileSync(join(root, 'stops.json'), 'utf8'));
    buildIndexes(routes, stops);
});

describe('downstream renders follow the recorded trace', () => {
    it.each([4534, 3987, 3179, 4563])('reported stop %i — every variant', (stopCode) => {
        const variants = [...(stopVariantsMap.get(stopCode) ?? [])];
        expect(variants.length).toBeGreaterThan(0);
        let checked = 0;
        for (const v of variants) if (checkVariantDownstream(stopCode, v)) checked++;
        expect(checked, 'no variant actually verified').toBeGreaterThan(0);
    });

    it('sweep: every 25th stop, every variant', () => {
        const stopCodes = [...stopVariantsMap.keys()].sort((a, b) => a - b);
        let checked = 0;
        for (let i = 0; i < stopCodes.length; i += 25) {
            for (const v of stopVariantsMap.get(stopCodes[i]) ?? []) {
                if (checkVariantDownstream(stopCodes[i], v)) checked++;
            }
        }
        expect(checked).toBeGreaterThan(300);
    });
});

/** Drawn downstream length (m) of a variant boarded at a stop; 0 at a terminal. */
function downstreamLengthM(variantId, stopCode) {
    const feature = routesByVariant.get(variantId)[0];
    const source = uniqueStopByCode.get(stopCode).geometry.coordinates;
    const down = prepareRouteFeature(feature, source, stopCode);
    return down ? polylineLengthM(down.geometry.coordinates) : 0;
}

/** The variant's stop codes in service order. */
const orderedCodes = (variantId) =>
    [...stopsByVariant.get(variantId)]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((e) => e.feature.properties.COD_UBIC_P);

describe('downstream renders follow the stop order', () => {
    it('every variant: the drawn length never grows as the boarding stop moves on', () => {
        // 5 m of slack: two stops at one corner can legitimately project a few
        // metres apart in either order. The bug this guards against was 0.3 to
        // 2.6 km (9 stop visits, before the order-aware cut).
        const violations = [];
        let pairs = 0;
        for (const variantId of stopsByVariant.keys()) {
            let previous = Infinity;
            for (const code of orderedCodes(variantId)) {
                const length = downstreamLengthM(variantId, code);
                if (length > previous + 5) {
                    violations.push(
                        `${variantId}@${code}: ${previous.toFixed(0)} → ${length.toFixed(0)} m`,
                    );
                }
                previous = length;
                pairs++;
            }
        }
        expect(pairs).toBeGreaterThan(50_000);
        expect(violations).toEqual([]);
    });

    it('line L1 from stop 5407 keeps the out-and-back the bus still has to drive', () => {
        // Variant 1554 runs out along Cno Sanguinetti and back on the same road.
        // 5407 is served on the way OUT, 9 m from the return carriageway, and
        // 5408 on the way BACK at the same corner. The nearest projection swapped
        // them: the view from 5407 skipped the 2.6 km loop that serves the next
        // ten stops, and the one from 5408 re-drew it.
        const out = downstreamLengthM('1554', 5407);
        const back = downstreamLengthM('1554', 5408);
        const codes = orderedCodes('1554');
        const next = downstreamLengthM('1554', codes[codes.indexOf(5407) + 1]);
        expect(out).toBeGreaterThan(next);
        expect(out - back).toBeGreaterThan(2000);
    });
});

describe('a variant draws nothing downstream of its LAST stop', () => {
    it('every variant: the last stop is an arrival, not a stub of trace', () => {
        // 14 of the 242 stop/line pairs that end at a stop used to draw the few
        // metres of trace the trim left beyond the last stop's projection, with
        // the line's label sitting on the stop it had just arrived at.
        const stubs = [];
        for (const variantId of stopsByVariant.keys()) {
            const codes = orderedCodes(variantId);
            const last = codes[codes.length - 1];
            if (downstreamLengthM(variantId, last) > 0) stubs.push(`${variantId}@${last}`);
        }
        expect(stubs).toEqual([]);
    });
});
