/**
 * stop-direction.js — which way the buses LEAVE a stop.
 *
 * 2,703 of the 4,930 committed stops share their name with another stop: the
 * two kerbs of one corner ("Av Millán y Sitio Grande" is stops 1480 and 3595),
 * served in opposite directions. A search result, a popup or a trip endpoint
 * named only by the corner cannot tell the rider which side to stand on — and
 * picking the wrong one as a trip origin plans the trip from the wrong kerb.
 *
 * The direction is in the data already: every variant serving a stop has a
 * trace, and the stop's ORDER-CONSISTENT place on it (patternPositions, the
 * same matching the journey legs use) says where the bus goes next. The bearing
 * of the next DEPARTURE_RUN_M of trace is that variant's departure heading.
 * Measured: 4,827 stops have one heading within ±45° across all their variants
 * (median spread 0.3°, p90 2.8°), and an eight-way compass label then tells
 * apart every stop of 1,096 of the 1,230 same-name groups. Stops whose variants
 * leave in different directions (63, junctions) and stops where every variant
 * ends (40) get no label rather than a wrong one.
 */

import { patternPositions } from './journey-geometry.js';
import { stopVariantsMap } from './data.js';
import { M_PER_DEG_LON, M_PER_DEG_LAT } from './geometry.js';

/** How much trace after the stop defines the departure direction (m). */
const DEPARTURE_RUN_M = 40;
/** A run shorter than this is a stub, not a direction (m). */
const MIN_RUN_M = 5;
/** Variants of one stop must agree within this many degrees of their mean. */
const MAX_SPREAD_DEG = 45;

/** The eight compass points, clockwise from north. */
export const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** @type {Map<number, {bearing: number, compass: string}|null>} */
const cache = new Map();

/** Drops the cache (data re-index, tests). */
export function resetStopDirections() {
    cache.clear();
}

/** Meters between two [lon, lat] points at city scale. */
const metersBetween = (a, b) =>
    Math.hypot((b[0] - a[0]) * M_PER_DEG_LON, (b[1] - a[1]) * M_PER_DEG_LAT);

/**
 * Bearing (degrees clockwise from north) of the first `run` metres of a trace
 * after fractional position `pos`, or null when less than MIN_RUN_M remains.
 *
 * @param {number[][]} coords - [lon, lat] trace
 * @param {number} pos - fractional position (segment index + t)
 * @param {number} [run]
 * @returns {number|null}
 */
export function departureBearing(coords, pos, run = DEPARTURE_RUN_M) {
    if (coords.length < 2) return null;
    const i = Math.min(Math.max(Math.floor(pos), 0), coords.length - 2);
    const t = Math.min(Math.max(pos - i, 0), 1);
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const start = [ax + (bx - ax) * t, ay + (by - ay) * t];

    let end = start;
    let left = run;
    let from = start;
    for (let k = i + 1; k < coords.length && left > 0; k++) {
        const step = metersBetween(from, coords[k]);
        if (step >= left) {
            const f = left / step;
            end = [from[0] + (coords[k][0] - from[0]) * f, from[1] + (coords[k][1] - from[1]) * f];
            break;
        }
        left -= step;
        from = coords[k];
        end = from;
    }

    const dx = (end[0] - start[0]) * M_PER_DEG_LON;
    const dy = (end[1] - start[1]) * M_PER_DEG_LAT;
    if (Math.hypot(dx, dy) < MIN_RUN_M) return null;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/**
 * Circular mean of bearings, and whether they agree within MAX_SPREAD_DEG.
 * @param {number[]} bearings
 * @returns {number|null} the mean, or null when they disagree or are none
 */
export function agreedBearing(bearings) {
    if (bearings.length === 0) return null;
    const rad = Math.PI / 180;
    const sx = bearings.reduce((sum, b) => sum + Math.sin(b * rad), 0);
    const cy = bearings.reduce((sum, b) => sum + Math.cos(b * rad), 0);
    if (Math.hypot(sx, cy) < 1e-9) return null; // they cancel out
    const mean = (Math.atan2(sx, cy) / rad + 360) % 360;
    for (const b of bearings) {
        let d = Math.abs(b - mean) % 360;
        if (d > 180) d = 360 - d;
        if (d > MAX_SPREAD_DEG) return null;
    }
    return mean;
}

/** Eight-way compass point of a bearing. */
export const compassOf = (bearing) => COMPASS[Math.round(bearing / 45) % 8];

/**
 * The direction buses leave a stop in, or null when there is no single one
 * (variants diverge at a junction) or none at all (every variant ends there).
 * Cached per stop; the matching it reads is cached per variant.
 *
 * @param {number} code - COD_UBIC_P
 * @returns {{bearing: number, compass: string}|null}
 */
export function stopDirection(code) {
    if (cache.has(code)) return cache.get(code);

    const bearings = [];
    for (const variantId of stopVariantsMap.get(code) ?? []) {
        const prepared = patternPositions(variantId);
        if (!prepared) continue;
        const k = prepared.stopCodes.lastIndexOf(code);
        // The last stop of a variant is an arrival: nobody departs from it.
        if (k < 0 || k === prepared.stopCodes.length - 1) continue;
        const bearing = departureBearing(prepared.coords, prepared.positions[k]);
        if (bearing !== null) bearings.push(bearing);
    }

    const mean = agreedBearing(bearings);
    const result = mean === null ? null : { bearing: mean, compass: compassOf(mean) };
    cache.set(code, result);
    return result;
}
