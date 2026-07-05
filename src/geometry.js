/**
 * Shared low-level geometry for the route pipeline and its verification
 * suites. Single home of the point-on-segment projection math that used to
 * be re-implemented at every call site — which is exactly how the two
 * vertex-snapping bugs were born (trimToStops truncating loop variants,
 * PR #4; downstream cuts injecting stop coordinates, PR #9).
 *
 * Rules enforced here (architecture/contracts/route-geometry-contract.md):
 *  - R-PROJECT: every cut/trim/match operation works on segment projections,
 *    never on nearest vertices.
 *  - R-FOREIGN: projections return points ON the trace; callers never inject
 *    a foreign coordinate (stop, label, user position) into route geometry.
 *
 * Two families with different consumers:
 *
 *  1. DEGREE-SPACE PRIMITIVES — used by the pipeline itself. Their
 *     arithmetic (operation order, clamping style) is frozen: migrating a
 *     call site here must keep rendered geometry bit-identical, so the
 *     expressions replicate the historical call-site math exactly.
 *
 *  2. METER-SPACE MEASURES — used by oracles, invariants and derivation
 *     scripts ONLY, never by the pipeline. Tests whose subject is a specific
 *     pipeline transformation keep their own independent arithmetic (see the
 *     contract's independence note); these helpers are for generic
 *     measurement and are themselves unit-tested against brute force.
 */

// ---------------------------------------------------------------------------
// 1. Degree-space primitives (pipeline)
// ---------------------------------------------------------------------------

/**
 * Clamped projection of point (px, py) onto segment (ax, ay)–(bx, by).
 *
 * @returns {{t: number, x: number, y: number, d2: number}} fractional
 *   position t ∈ [0, 1], foot point (x, y), squared distance d2 — all in the
 *   input's coordinate space.
 */
export function projectPointOnSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx;
    const y = ay + t * dy;
    const ex = px - x;
    const ey = py - y;
    return { t, x, y, d2: ex * ex + ey * ey };
}

/**
 * Unclamped projection parameter of point (px, py) on the infinite line
 * through (ax, ay)–(bx, by), with the squared distance measured at that
 * unclamped parameter (i.e. perpendicular distance when t ∈ (0, 1)).
 * Callers use it to test whether a point lies on a segment's interior
 * (bundling's on-path node insertion and triangle dissolve).
 *
 * The segment must be non-degenerate (len2 > 0) — both call sites guarantee
 * it; a zero-length segment returns t = 0 and the plain squared distance.
 *
 * @returns {{t: number, d2: number}}
 */
export function unclampedSegmentParam(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) {
        const ex = px - ax;
        const ey = py - ay;
        return { t: 0, d2: ex * ex + ey * ey };
    }
    const t = ((px - ax) * dx + (py - ay) * dy) / len2;
    const ex = px - (ax + t * dx);
    const ey = py - (ay + t * dy);
    return { t, d2: ex * ex + ey * ey };
}

/**
 * Nearest clamped projection of point p onto a polyline.
 * Ties keep the FIRST minimal segment (strict `<`), preserving the
 * historical behavior of truncateLineDownstream.
 *
 * @param {number[]} p - [x, y]
 * @param {number[][]} coords - polyline
 * @returns {{i: number, t: number, x: number, y: number, d2: number}|null}
 */
export function projectPointOnPolyline(p, coords) {
    let best = null;
    for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i];
        const b = coords[i + 1];
        const r = projectPointOnSegment(p[0], p[1], a[0], a[1], b[0], b[1]);
        if (!best || r.d2 < best.d2) best = { i, t: r.t, x: r.x, y: r.y, d2: r.d2 };
    }
    return best;
}

/**
 * All near-minimal projections of point p onto a polyline: every segment
 * whose clamped projection distance is within `slack` (same units as the
 * coordinates) of the global minimum. A loop route passes a terminal stop
 * twice — the nearest projection alone is ambiguous there, so callers
 * collect all candidates and pick by a global criterion (trimToStops
 * maximizes the covered span, PR #4).
 *
 * @param {number[]} p - [x, y]
 * @param {number[][]} coords - polyline
 * @param {number} slack - distance slack added to the minimum
 * @returns {{i: number, t: number, d2: number}[]}
 */
export function projectionCandidates(p, coords, slack) {
    const positions = [];
    let bestD2 = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i];
        const b = coords[i + 1];
        const r = projectPointOnSegment(p[0], p[1], a[0], a[1], b[0], b[1]);
        positions.push({ i, t: r.t, d2: r.d2 });
        if (r.d2 < bestD2) bestD2 = r.d2;
    }
    const limit = (Math.sqrt(bestD2) + slack) ** 2;
    return positions.filter((q) => q.d2 <= limit);
}

/**
 * Point at fractional position i + t along a polyline (t within segment i).
 * @param {number[][]} coords
 * @param {number} i - segment index
 * @param {number} t - fraction ∈ [0, 1]
 * @returns {number[]}
 */
export function pointAt(coords, i, t) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

// ---------------------------------------------------------------------------
// 2. Meter-space measures (oracles, invariants, derivation scripts — NOT the
//    pipeline)
// ---------------------------------------------------------------------------

/** Meters per degree of longitude at Montevideo's latitude (~34.9° S). */
export const M_PER_DEG_LON = 92000;
/** Meters per degree of latitude. */
export const M_PER_DEG_LAT = 111000;

/** [lon, lat] → [mx, my] in the local equirectangular meter frame. */
export const toMeters = (p) => [p[0] * M_PER_DEG_LON, p[1] * M_PER_DEG_LAT];

/** Inverse of toMeters. */
export const fromMeters = (m) => [m[0] / M_PER_DEG_LON, m[1] / M_PER_DEG_LAT];

/** Length of segment a–b in meters ([lon, lat] inputs). */
export const segmentLengthM = (a, b) =>
    Math.hypot((b[0] - a[0]) * M_PER_DEG_LON, (b[1] - a[1]) * M_PER_DEG_LAT);

/** Heading of a→b in degrees, atan2 convention (0° = east, CCW positive). */
export const headingDeg = (a, b) =>
    (Math.atan2((b[1] - a[1]) * M_PER_DEG_LAT, (b[0] - a[0]) * M_PER_DEG_LON) * 180) / Math.PI;

/**
 * Turn angle at vertex b of the path a→b→c, in degrees ∈ [0, 180].
 * 0 = straight through, 180 = full reversal (hairpin).
 */
export function turnAngleDeg(a, b, c) {
    let turn = Math.abs(headingDeg(a, b) - headingDeg(b, c)) % 360;
    if (turn > 180) turn = 360 - turn;
    return turn;
}

/** Acute angle between two headings treated as undirected axes ∈ [0, 90]. */
export function axisAngleDeg(h1, h2) {
    let da = Math.abs(h1 - h2) % 180;
    if (da > 90) da = 180 - da;
    return da;
}

/** Polyline length in meters. */
export function polylineLengthM(coords) {
    let len = 0;
    for (let i = 1; i < coords.length; i++) len += segmentLengthM(coords[i - 1], coords[i]);
    return len;
}

/** Distance in meters from point p to the nearest point of a polyline. */
export function pointToPolylineDistM(p, coords) {
    if (coords.length === 1) return segmentLengthM(p, coords[0]);
    const pm = toMeters(p);
    let best = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
        const a = toMeters(coords[i]);
        const b = toMeters(coords[i + 1]);
        const r = projectPointOnSegment(pm[0], pm[1], a[0], a[1], b[0], b[1]);
        if (r.d2 < best) best = r.d2;
    }
    return Math.sqrt(best);
}

/**
 * One-sided Hausdorff distance in meters: the farthest any vertex of `from`
 * strays from the polyline `to`. Used by operator contracts (R-BOUNDED):
 * simplify/smooth/clean steps must keep this within their stated budget.
 */
export function oneSidedHausdorffM(from, to) {
    let worst = 0;
    for (const p of from) {
        const d = pointToPolylineDistM(p, to);
        if (d > worst) worst = d;
    }
    return worst;
}

/**
 * Axial overlap and mean lateral separation (meters) of segment s2 relative
 * to segment s1 ([lon, lat] endpoints). Returns null when the projections of
 * s2's endpoints onto s1's axis do not overlap s1's extent. This is the
 * duplicate-strand measure of the smoothness oracle (two near-parallel
 * strands of one line drawn a few meters apart).
 *
 * @param {number[][]} s1 - [a, b]
 * @param {number[][]} s2 - [a, b]
 * @returns {{overlap: number, lat: number, mid: number[]}|null} mid is the
 *   [lon, lat] midpoint of the overlapping stretch on s1 — the anchor where
 *   the two strands actually run side by side (a long block's first vertex
 *   can lie hundreds of meters from the overlap).
 */
export function axialOverlapAndLateralM(s1, s2) {
    const [a1, b1] = s1.map(toMeters);
    const [a2, b2] = s2.map(toMeters);
    const dx = b1[0] - a1[0];
    const dy = b1[1] - a1[1];
    const L1 = Math.hypot(dx, dy);
    if (L1 === 0) return null;
    const u = [dx / L1, dy / L1];
    const proj = (p) => (p[0] - a1[0]) * u[0] + (p[1] - a1[1]) * u[1];
    const lat = (p) => Math.abs(-(p[0] - a1[0]) * u[1] + (p[1] - a1[1]) * u[0]);
    const lo = Math.max(0, Math.min(proj(a2), proj(b2)));
    const hi = Math.min(L1, Math.max(proj(a2), proj(b2)));
    if (hi - lo <= 0) return null;
    const m = (lo + hi) / 2;
    return {
        overlap: hi - lo,
        lat: (lat(a2) + lat(b2)) / 2,
        mid: fromMeters([a1[0] + u[0] * m, a1[1] + u[1] * m]),
    };
}

/**
 * True when segments p1–p2 and p3–p4 properly cross (intersection interior
 * to both segments). Shared endpoints and collinear touching do NOT count —
 * consecutive polyline segments always share a vertex.
 */
export function segmentsProperlyIntersect(p1, p2, p3, p4) {
    const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = d(p3, p4, p1);
    const d2 = d(p3, p4, p2);
    const d3 = d(p1, p2, p3);
    const d4 = d(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
