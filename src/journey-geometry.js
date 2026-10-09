/**
 * journey-geometry.js — the drawn shape of one ride leg.
 *
 * A ride leg is "board variant V at its k-th stop, alight at its m-th stop".
 * To draw it we need the piece of V's recorded trace between those two stops.
 *
 * Two rules from architecture/contracts/route-geometry-contract.md apply and
 * are the reason this is not a two-line function:
 *
 *  - **R-PROJECT** — cuts use segment projections, never nearest vertices. The
 *    committed traces are Douglas–Peucker simplified, so consecutive vertices
 *    can be hundreds of meters apart on a straight avenue; snapping to a
 *    vertex would move a cut by a whole block.
 *  - **R-FOREIGN** — the stop's own coordinate is never injected into the
 *    output. A stop can sit tens of meters (up to ~600 m for known data
 *    oddities) off its own route's trace; bridging that gap with a synthetic
 *    vertex draws chords across city blocks (the PR #9 bug). The drawn leg
 *    follows the trace; the stop markers show where the rider actually stands.
 *
 * On top of those: a loop variant passes some stops twice, so the nearest
 * projection of a single stop is ambiguous. Matching the variant's stops
 * **as one ordered sequence** resolves it — the k-th stop must not land before
 * the (k−1)-th, and among the orders that satisfy that the closest one wins
 * (`matchStopsToTrace`). That is what `patternPositions` does, cached per
 * variant because it is the same for every leg on that variant.
 */

import { matchStopsToTrace, pointAt } from './geometry.js';
import { cleanCoordinates } from './utils.js';
import { routesByVariant, stopsByVariant } from './data.js';

/** Two positions closer than this count as the same point. */
const POS_EPS = 1e-9;

/** @type {Map<string, {coords: number[][], positions: number[], stopCodes: number[]}|null>} */
const cache = new Map();

/** Drops the cache (data re-index, tests). */
export function resetJourneyGeometry() {
    cache.clear();
}

/**
 * Ordinal-ordered stops of a variant. MUST match the ordering journey.js uses
 * to build its patterns, because leg indices are shared between the two.
 * @param {string} variantId
 * @returns {Array<{feature: object, ordinal: number}>}
 */
function orderedStops(variantId) {
    return [...(stopsByVariant.get(variantId) ?? [])].sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * Monotone non-decreasing positions (fractional `segmentIndex + t`) of a
 * variant's stops along its cleaned trace.
 *
 * The stops are matched as one sequence (`matchStopsToTrace`). This used to be
 * a greedy forward pass taking, per stop, the EARLIEST near-minimal projection
 * not behind the previous stop — which commits before it can see the next stop:
 * at an out-and-back (line L33 at stop 1882, served on the way back) it put the
 * stop on the outbound pass, so a leg boarding there was drawn round the whole
 * turn-around. Measured over every committed variant the greedy pass also sat
 * a few metres early at 2,384 stop visits, because "earliest within ~10 m" is
 * not "nearest".
 *
 * @param {string} variantId
 * @returns {{coords: number[][], positions: number[], stopCodes: number[]}|null}
 */
export function patternPositions(variantId) {
    if (cache.has(variantId)) return cache.get(variantId);

    const feature = routesByVariant.get(variantId)?.[0];
    const stops = orderedStops(variantId);
    let result = null;

    const raw = feature?.geometry?.coordinates;
    if (raw && typeof raw[0]?.[0] === 'number' && stops.length > 0) {
        const coords = cleanCoordinates(JSON.parse(JSON.stringify(raw)));
        if (coords.length >= 2) {
            const matched = matchStopsToTrace(
                stops.map((s) => s.feature.geometry.coordinates),
                coords,
            );
            result = {
                coords,
                positions: matched.map((m) => m.i + m.t),
                stopCodes: stops.map((s) => s.feature.properties.COD_UBIC_P),
            };
        }
    }

    cache.set(variantId, result);
    return result;
}

/**
 * The trace between two fractional positions, endpoints included as exact
 * on-line points.
 * @param {number[][]} coords
 * @param {number} from - fractional position
 * @param {number} to   - fractional position, ≥ from
 * @returns {number[][]}
 */
export function sliceAtPositions(coords, from, to) {
    const last = coords.length - 2; // last valid segment index
    const split = (pos) => {
        const i = Math.min(Math.max(Math.floor(pos), 0), last);
        return { i, t: Math.min(Math.max(pos - i, 0), 1) };
    };
    const a = split(from);
    const b = split(to);

    const out = [pointAt(coords, a.i, a.t)];
    for (let i = a.i + 1; i <= b.i; i++) out.push(coords[i]);
    const end = pointAt(coords, b.i, b.t);
    const tail = out[out.length - 1];
    if (Math.abs(tail[0] - end[0]) > 1e-12 || Math.abs(tail[1] - end[1]) > 1e-12) out.push(end);
    return out;
}

/**
 * Geometry of one ride leg, as [lon, lat] pairs along the variant's trace.
 *
 * @param {string} variantId
 * @param {number} boardIdx  - index into the variant's ordinal-ordered stops
 * @param {number} alightIdx - idem, > boardIdx
 * @returns {number[][]|null} null when the trace cannot serve the leg (missing
 *   geometry, or the two stops projecting onto the same point) — the caller
 *   draws a straight connector instead of inventing a path.
 */
export function rideLegGeometry(variantId, boardIdx, alightIdx) {
    const prepared = patternPositions(variantId);
    if (!prepared) return null;
    const { coords, positions } = prepared;
    if (boardIdx < 0 || alightIdx >= positions.length || boardIdx >= alightIdx) return null;

    const from = positions[boardIdx];
    const to = positions[alightIdx];
    if (!(to > from + POS_EPS)) return null;

    const slice = sliceAtPositions(coords, from, to);
    return slice.length >= 2 ? slice : null;
}
