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
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    buildIndexes,
    stopVariantsMap,
    uniqueStopByCode,
    routesByVariant,
} from '../../src/data.js';
import { prepareRouteFeature } from '../../src/map.js';

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
    const down = prepareRouteFeature(feature, source.geometry.coordinates);
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
