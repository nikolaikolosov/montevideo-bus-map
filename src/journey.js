/**
 * journey.js — stop-to-stop itinerary planning with transfers.
 *
 * ## What the data allows
 *
 * The feed (architecture/contracts/data-contract.md) is a *topology*: route
 * variants with a geometry, and the ordered list of stops each variant serves.
 * There are **no timetables** — no trips, no headways, no run times. So an
 * exact "arrive at 14:32" answer is not derivable from this data, and the
 * planner never pretends otherwise: it ranks itineraries by a documented cost
 * model (CONFIG.JOURNEY_*) and the UI labels every duration as approximate.
 *
 * ## Model
 *
 * Nodes are physical stops (COD_UBIC_P). Two edge families:
 *
 *  - **Ride**: board a route variant at one of its stops and stay seated to a
 *    later stop of the same variant (ordinals are strictly increasing, so
 *    "later" is well defined). Cost = in-vehicle time + per-stop dwell.
 *  - **Walk**: any two stops within JOURNEY_WALK_MAX_M. This is what makes
 *    real transfers possible — the two directions of a corridor are different
 *    stop codes on opposite kerbs, so a same-code-only model would find almost
 *    no transfers at all.
 *
 * Every boarding also costs JOURNEY_BOARD_PENALTY_SECONDS (the unknown wait),
 * which is what makes a 1-transfer itinerary lose to a slightly slower direct
 * one — the behavior riders actually want.
 *
 * ## Algorithm
 *
 * Round-based, in the shape of RAPTOR (Delling/Pajor/Werneck): round k relaxes
 * itineraries using at most k ride legs, so the label at the destination after
 * round k is the fastest journey with ≤ k−1 transfers. Reading the destination
 * label after every round yields the Pareto set over (transfers, time) — the
 * planner returns those as alternatives instead of one "shortest" answer.
 *
 * Each round is one linear scan per route variant (the boarding rule is the
 * standard RAPTOR one: extend the seated cost, try to improve the stop label,
 * then consider re-boarding here from the previous round's label), followed by
 * one hop of footpath relaxation. Complexity per round is O(pattern-stop
 * entries + footpath edges) ≈ 114k operations on the committed data.
 *
 * The module is Leaflet-free and DOM-free: it is pure graph work over the
 * indexes built by data.js, and is unit-tested directly (tests/js/journey.test.js).
 */

import { CONFIG } from './config.js';
import { M_PER_DEG_LON, M_PER_DEG_LAT } from './geometry.js';
import { routesByVariant, stopsByVariant, uniqueStopsData } from './data.js';

/**
 * @typedef {object} RideLeg
 * @property {'ride'} type
 * @property {string} line       - DESC_LINEA
 * @property {string} variantId  - COD_VARIAN
 * @property {string} headsign   - DESC_VARIA ('' when the feed has none)
 * @property {number} fromCode   - boarding stop COD_UBIC_P
 * @property {number} toCode     - alighting stop COD_UBIC_P
 * @property {number} boardIdx   - index into the variant's ordinal-ordered stop list
 * @property {number} alightIdx  - idem, always > boardIdx
 * @property {number[]} stopCodes - every stop of the leg, boarding → alighting
 * @property {number} meters     - estimated street distance
 * @property {number} seconds    - estimated in-vehicle time (dwell included)
 *
 * @typedef {object} WalkLeg
 * @property {'walk'} type
 * @property {number} fromCode
 * @property {number} toCode
 * @property {number} meters
 * @property {number} seconds
 *
 * @typedef {object} JourneyOption
 * @property {Array<RideLeg|WalkLeg>} legs
 * @property {number} seconds    - total estimate, boarding penalties included
 * @property {number} transfers  - ride legs − 1 (0 for a walk-only itinerary)
 * @property {number} rideMeters
 * @property {number} walkMeters
 */

const MPS = (kmh) => (kmh * 1000) / 3600;

/** Straight-line meters between two [lon, lat] pairs (local equirectangular). */
const metersBetween = (aLon, aLat, bLon, bLat) =>
    Math.hypot((bLon - aLon) * M_PER_DEG_LON, (bLat - aLat) * M_PER_DEG_LAT);

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

/**
 * @typedef {object} JourneyGraph
 * @property {number[]} codes                  - stop code per node index
 * @property {Map<number, number>} indexByCode
 * @property {Float64Array} lon
 * @property {Float64Array} lat
 * @property {Array<{variantId: string, line: string, headsign: string,
 *   stops: Int32Array, stepM: Float64Array}>} patterns
 * @property {Array<Array<number>>} patternsByStop - flat [patternIdx, position, …]
 * @property {Array<Int32Array>} walkTo
 * @property {Array<Float64Array>} walkM
 */

/** @type {JourneyGraph|null} */
let graph = null;

/**
 * Builds (or rebuilds) the journey graph from the data.js indexes.
 * Idempotent and cheap enough to run on the main thread: ~61k pattern-stop
 * entries and ~53k footpath edges on the committed data.
 *
 * @returns {JourneyGraph}
 */
export function buildJourneyGraph() {
    const codes = [];
    const indexByCode = new Map();
    const lon = new Float64Array(uniqueStopsData.length);
    const lat = new Float64Array(uniqueStopsData.length);

    for (const feature of uniqueStopsData) {
        const code = feature.properties.COD_UBIC_P;
        if (indexByCode.has(code)) continue; // defensive: contract says unique
        const idx = codes.length;
        indexByCode.set(code, idx);
        codes.push(code);
        lon[idx] = feature.geometry.coordinates[0];
        lat[idx] = feature.geometry.coordinates[1];
    }

    // --- Ride edges: one linear "pattern" per route variant ---
    const patterns = [];
    const patternsByStop = Array.from({ length: codes.length }, () => []);
    const busDetour = CONFIG.JOURNEY_BUS_DETOUR_FACTOR;

    for (const [variantId, entries] of stopsByVariant) {
        if (!entries || entries.length < 2) continue;
        const ordered = [...entries].sort((a, b) => a.ordinal - b.ordinal);
        const stops = new Int32Array(ordered.length);
        const stepM = new Float64Array(ordered.length); // stepM[i] = ordered[i-1] → ordered[i]

        let usable = true;
        for (let i = 0; i < ordered.length; i++) {
            const idx = indexByCode.get(ordered[i].feature.properties.COD_UBIC_P);
            if (idx === undefined) {
                usable = false;
                break;
            }
            stops[i] = idx;
            if (i > 0) {
                const p = stops[i - 1];
                stepM[i] = metersBetween(lon[p], lat[p], lon[idx], lat[idx]) * busDetour;
            }
        }
        if (!usable) continue;

        const feature = routesByVariant.get(variantId)?.[0];
        const patternIdx = patterns.length;
        patterns.push({
            variantId,
            line: feature?.properties?.DESC_LINEA ?? '',
            headsign: feature?.properties?.DESC_VARIA ?? '',
            stops,
            stepM,
        });
        // The last stop is an alighting point only — never a boarding one.
        for (let i = 0; i < stops.length - 1; i++) {
            patternsByStop[stops[i]].push(patternIdx, i);
        }
    }

    // --- Walk edges: uniform grid, 3×3 neighbourhood ---
    const radius = CONFIG.JOURNEY_WALK_MAX_M;
    // Cell ≥ radius in BOTH axes so a 3×3 sweep can never miss a neighbour.
    const cell = (radius * 1.5) / M_PER_DEG_LAT;
    const buckets = new Map();
    const cellKey = (gx, gy) => gx * 100000 + gy;
    for (let i = 0; i < codes.length; i++) {
        const key = cellKey(Math.floor(lon[i] / cell), Math.floor(lat[i] / cell));
        let bucket = buckets.get(key);
        if (!bucket) buckets.set(key, (bucket = []));
        bucket.push(i);
    }

    const walkTo = new Array(codes.length);
    const walkM = new Array(codes.length);
    for (let i = 0; i < codes.length; i++) {
        const gx = Math.floor(lon[i] / cell);
        const gy = Math.floor(lat[i] / cell);
        const found = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const bucket = buckets.get(cellKey(gx + dx, gy + dy));
                if (!bucket) continue;
                for (const j of bucket) {
                    if (j === i) continue;
                    const d = metersBetween(lon[i], lat[i], lon[j], lat[j]);
                    if (d <= radius) found.push([j, d]);
                }
            }
        }
        // Deterministic order (nearest first, then by node index) so equal-cost
        // ties always resolve the same way — journeys must be reproducible.
        found.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        walkTo[i] = Int32Array.from(found, (f) => f[0]);
        walkM[i] = Float64Array.from(found, (f) => f[1] * CONFIG.JOURNEY_WALK_DETOUR_FACTOR);
    }

    graph = { codes, indexByCode, lon, lat, patterns, patternsByStop, walkTo, walkM };
    return graph;
}

/** Builds the graph on first use. */
export function ensureJourneyGraph() {
    return graph ?? buildJourneyGraph();
}

/** Drops the cached graph (data re-index, tests). */
export function resetJourneyGraph() {
    graph = null;
}

/** True when the stop exists in the graph — the popup gates its buttons on it. */
export function isPlannableStop(code) {
    return ensureJourneyGraph().indexByCode.has(Number(code));
}

// ---------------------------------------------------------------------------
// Cost model
// ---------------------------------------------------------------------------

/** Seconds to ride `meters` past `stops` intermediate stops. */
const rideSeconds = (meters, stops) =>
    meters / MPS(CONFIG.JOURNEY_BUS_SPEED_KMH) + stops * CONFIG.JOURNEY_DWELL_SECONDS;

/** Seconds to walk `meters`. */
const walkSeconds = (meters) => meters / MPS(CONFIG.JOURNEY_WALK_SPEED_KMH);

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Plans itineraries from one stop to another.
 *
 * Returns the Pareto-optimal set over (transfers, estimated time): the fastest
 * direct trip, the fastest 1-transfer trip if it beats it, and so on up to
 * CONFIG.JOURNEY_MAX_ROUNDS. Options more than
 * JOURNEY_OPTION_SLACK_RATIO × best + JOURNEY_OPTION_SLACK_SECONDS are dropped,
 * and the list is capped at JOURNEY_MAX_OPTIONS.
 *
 * @param {number} fromCode - origin COD_UBIC_P
 * @param {number} toCode   - destination COD_UBIC_P
 * @returns {{status: 'ok'|'same'|'unknown-stop'|'no-route', options: JourneyOption[]}}
 */
export function planJourney(fromCode, toCode) {
    const g = ensureJourneyGraph();
    const from = g.indexByCode.get(Number(fromCode));
    const to = g.indexByCode.get(Number(toCode));

    if (from === undefined || to === undefined) return { status: 'unknown-stop', options: [] };
    if (from === to) return { status: 'same', options: [] };

    const n = g.codes.length;
    const rounds = CONFIG.JOURNEY_MAX_ROUNDS;
    const boardPenalty = CONFIG.JOURNEY_BOARD_PENALTY_SECONDS;

    /** labels[k][stop] = best cost reaching `stop` with ≤ k ride legs. */
    const labels = [];
    /** parents[k][stop] = how that label was reached (null = origin). */
    const parents = [];

    const first = new Float64Array(n).fill(Infinity);
    first[from] = 0;
    const firstParents = new Array(n).fill(undefined);
    // Round 0 = walk-only reach (also the access legs for the first boarding).
    relaxFootpaths(g, first, firstParents, [from], 0);
    labels.push(first);
    parents.push(firstParents);

    for (let k = 1; k <= rounds; k++) {
        const prev = labels[k - 1];
        const cur = Float64Array.from(prev);
        const curParents = [...parents[k - 1]];
        const improved = [];

        // Only variants reachable in the previous round can be boarded now.
        const marked = new Set();
        for (let s = 0; s < n; s++) {
            if (prev[s] === Infinity) continue;
            const list = g.patternsByStop[s];
            for (let i = 0; i < list.length; i += 2) marked.add(list[i]);
        }

        for (const patternIdx of marked) {
            const pattern = g.patterns[patternIdx];
            const { stops, stepM } = pattern;
            let boardPos = -1;
            let boardCost = Infinity; // cost the moment the rider is seated
            let seatedMeters = 0;

            for (let i = 0; i < stops.length; i++) {
                const stop = stops[i];
                let seated = Infinity; // cost of arriving at `stop` on board

                if (boardPos >= 0) {
                    seatedMeters += stepM[i];
                    seated = boardCost + rideSeconds(seatedMeters, i - boardPos);
                    // Target pruning: nothing slower than the best known
                    // destination label can be part of an answer (all costs
                    // are non-negative, so it can only get worse downstream).
                    if (seated < cur[stop] && seated < cur[to]) {
                        cur[stop] = seated;
                        curParents[stop] = {
                            type: 'ride',
                            round: k,
                            patternIdx,
                            boardPos,
                            alightPos: i,
                        };
                        improved.push(stop);
                    }
                }

                // Re-board here when getting on now beats staying seated —
                // the standard RAPTOR rule, compared at THIS stop because the
                // remaining ride cost is identical for both alternatives.
                const boardHere = prev[stop] === Infinity ? Infinity : prev[stop] + boardPenalty;
                if (boardHere < seated) {
                    boardPos = i;
                    boardCost = boardHere;
                    seatedMeters = 0;
                }
            }
        }

        relaxFootpaths(g, cur, curParents, improved, k);
        labels.push(cur);
        parents.push(curParents);
    }

    // --- Collect the Pareto set: one candidate per round that improved ---
    /** @type {JourneyOption[]} */
    const options = [];
    const seen = new Set();
    let bestSoFar = Infinity;
    for (let k = 0; k <= rounds; k++) {
        const cost = labels[k][to];
        if (cost === Infinity || cost >= bestSoFar) continue;
        bestSoFar = cost;
        const option = reconstruct(g, parents, k, from, to);
        if (!option) continue;
        const key = option.legs
            .map((l) =>
                l.type === 'ride'
                    ? `r:${l.line}:${l.fromCode}>${l.toCode}`
                    : `w:${l.fromCode}>${l.toCode}`,
            )
            .join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        options.push(option);
    }

    if (options.length === 0) return { status: 'no-route', options: [] };

    options.sort((a, b) => a.seconds - b.seconds || a.transfers - b.transfers);
    const limit =
        options[0].seconds * CONFIG.JOURNEY_OPTION_SLACK_RATIO +
        CONFIG.JOURNEY_OPTION_SLACK_SECONDS;
    return {
        status: 'ok',
        options: options.filter((o) => o.seconds <= limit).slice(0, CONFIG.JOURNEY_MAX_OPTIONS),
    };
}

/**
 * One hop of footpath relaxation over the stops improved in this round.
 * A single hop is enough: the walk graph is a metric neighbourhood, so a
 * two-hop walk is either longer than the direct edge or outside the radius
 * a rider would accept anyway.
 */
function relaxFootpaths(g, cost, parentOf, seeds, round) {
    // Read from a snapshot and never write onto a seed. Both guards exist for
    // the same reason: without them a walk can land on a stop that is itself
    // the source of another walk, and the itinerary comes out as "walk, then
    // walk again" — two 400 m hops chained into an 800 m walk the rider never
    // agreed to, with a total that no longer matches the sum of its legs.
    // Costing a seed out of a strictly better footpath is a tiny loss of
    // optimality; the next round can still use that stop.
    const base = Float64Array.from(cost);
    const protectedSeeds = new Set(seeds);

    for (const s of protectedSeeds) {
        const neighbours = g.walkTo[s];
        const meters = g.walkM[s];
        for (let i = 0; i < neighbours.length; i++) {
            const target = neighbours[i];
            if (protectedSeeds.has(target)) continue;
            const candidate = base[s] + walkSeconds(meters[i]);
            if (candidate < cost[target]) {
                cost[target] = candidate;
                parentOf[target] = { type: 'walk', round, from: s, meters: meters[i] };
            }
        }
    }
}

/**
 * Walks the parent chain back from the destination and materialises the legs.
 *
 * The reported total is summed from the legs rather than read off the label:
 * what the panel prints is then exactly what its itemised legs add up to, by
 * construction, with no way for the two to drift apart.
 *
 * @returns {JourneyOption|null} null if the chain is broken (never expected)
 */
function reconstruct(g, parents, round, from, to) {
    /** @type {Array<RideLeg|WalkLeg>} */
    const legs = [];
    let node = to;
    let k = round;
    let guard = 0;

    while (node !== from) {
        if (guard++ > 64) return null; // cycle guard — a broken chain never ships
        const parent = parents[k][node];
        if (!parent) return null;

        if (parent.type === 'walk') {
            legs.push(walkLeg(g, parent.from, node, parent.meters));
            node = parent.from;
            k = parent.round;
        } else {
            const pattern = g.patterns[parent.patternIdx];
            legs.push(rideLeg(g, pattern, parent.patternIdx, parent.boardPos, parent.alightPos));
            node = pattern.stops[parent.boardPos];
            k = parent.round - 1;
        }
    }

    legs.reverse();
    const rides = legs.filter((l) => l.type === 'ride');
    // Waiting is not in any leg — it is the per-boarding penalty, surfaced
    // separately so the panel can say "incl. ~N min of waiting".
    const waitSeconds = rides.length * CONFIG.JOURNEY_BOARD_PENALTY_SECONDS;
    return {
        legs,
        seconds: legs.reduce((sum, l) => sum + l.seconds, waitSeconds),
        waitSeconds,
        transfers: Math.max(0, rides.length - 1),
        rideMeters: rides.reduce((sum, l) => sum + l.meters, 0),
        walkMeters: legs.filter((l) => l.type === 'walk').reduce((sum, l) => sum + l.meters, 0),
    };
}

/** @returns {WalkLeg} */
function walkLeg(g, fromIdx, toIdx, meters) {
    return {
        type: 'walk',
        fromCode: g.codes[fromIdx],
        toCode: g.codes[toIdx],
        meters,
        seconds: walkSeconds(meters),
    };
}

/** @returns {RideLeg} */
function rideLeg(g, pattern, patternIdx, boardPos, alightPos) {
    let meters = 0;
    const stopCodes = [];
    for (let i = boardPos; i <= alightPos; i++) {
        if (i > boardPos) meters += pattern.stepM[i];
        stopCodes.push(g.codes[pattern.stops[i]]);
    }
    return {
        type: 'ride',
        line: pattern.line,
        variantId: pattern.variantId,
        headsign: pattern.headsign,
        patternIdx,
        fromCode: g.codes[pattern.stops[boardPos]],
        toCode: g.codes[pattern.stops[alightPos]],
        boardIdx: boardPos,
        alightIdx: alightPos,
        stopCodes,
        meters,
        seconds: rideSeconds(meters, alightPos - boardPos),
    };
}
