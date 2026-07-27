import { CONFIG } from './config.js';
import { projectPointOnSegment, unclampedSegmentParam } from './geometry.js';

/**
 * Route bundling — unifies the per-variant GPS-like traces into a shared
 * "street graph" so that routes travelling along the same street render as
 * clean parallel lines instead of overlapping squiggles.
 *
 * The raw data has one independently-digitised polyline per variant: along a
 * shared avenue their vertices differ by 1–5 m and have different densities,
 * so drawn naively they cross and diverge at slightly different angles.
 *
 * Pipeline (all in lon/lat degree space):
 *  1. Cluster all vertices of all displayed variants into canonical nodes
 *     (grid-hash, ~BUNDLE_TOLERANCE_DEG radius, running-mean position).
 *  2. Re-express every variant as a node sequence, inserting nodes that lie
 *     on a segment's path (so sparse and dense traces produce the same edges).
 *  3. Collect undirected edges; each edge knows the set of lines using it.
 *  4. Merge consecutive edges with an identical line set into "sections" —
 *     maximal corridors where the bundle composition is constant.
 *
 * Rendering then draws each section once per line with a parallel pixel
 * offset. Lines are slotted in a single global order, so two lines never swap
 * sides — bundles stay parallel and crossing-free.
 */

/**
 * @typedef {object} Section
 * @property {number[][]} coords - canonical [lon, lat] polyline of the corridor
 * @property {string[]} lines - line IDs using this corridor, in global slot order
 * @property {Map<string, Set<string>>} variantsByLine - variant names per line
 */

const lineCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Laplacian smoothing of a corridor polyline (endpoints pinned).
 *
 * Canonical nodes are running means of clustered trace vertices; where two
 * opposite-direction strands of one line merge into a single corridor
 * (BUNDLE_TOLERANCE sized for the ida/vuelta digitisation offset), successive
 * nodes alternate between the two source strands and the corridor sawtooths
 * sideways (user report: line 104 along Rambla Armenia). Two smoothing
 * passes cancel that alternation — a ±10 m sawtooth flattens onto the street
 * — while shifting any node by at most the same ~10 m the cluster radius
 * already allows, so genuine street corners only get a slight rounding.
 *
 * @param {number[][]} coords - [lon, lat][]
 * @param {number} passes
 * @returns {number[][]}
 */
export function smoothPath(coords, passes, maxSegDeg, maxShiftDeg) {
    if (coords.length < 3) return coords;
    const maxSegSq = maxSegDeg * maxSegDeg;
    const maxShiftSq = maxShiftDeg * maxShiftDeg;
    let cur = coords;
    for (let p = 0; p < passes; p++) {
        const next = [cur[0]];
        for (let i = 1; i < cur.length - 1; i++) {
            const [px, py] = cur[i - 1];
            const [cx, cy] = cur[i];
            const [nx, ny] = cur[i + 1];
            const l1 = (cx - px) ** 2 + (cy - py) ** 2;
            const l2 = (nx - cx) ** 2 + (ny - cy) ** 2;
            // Only sawtooth-scale vertices move: a vertex flanked by LONG
            // segments is a genuine feature of a sparse trace (peripheral
            // L*/G* lines have kilometre-long legs) — smoothing those swept
            // corners hundreds of metres off the street.
            if (l1 > maxSegSq || l2 > maxSegSq) {
                next.push(cur[i]);
                continue;
            }
            const dx = (px + 2 * cx + nx) / 4 - cx;
            const dy = (py + 2 * cy + ny) / 4 - cy;
            // Clamp the TOTAL displacement from the canonical node, not this
            // pass's step. Clamping per pass let `passes` multiply the budget:
            // with 2 passes a vertex could end up 2 × maxShiftDeg away, and on
            // the committed data 204 of 13,930 corridor vertices moved past the
            // documented ~11 m — the worst by 21.6 m. That budget is not
            // cosmetic: route_oracles.mjs derives CHORD_MAX_M = 30 as cluster
            // mean (≤24 m) + smoothing (≤11 m) + simplify (4 m), so overrunning
            // it eats the oracle's headroom.
            const [ox, oy] = coords[i];
            next.push(clampToDisc(cx + dx, cy + dy, ox, oy, maxShiftDeg, maxShiftSq));
        }
        next.push(cur[cur.length - 1]);
        cur = next;
    }
    return cur;
}

/**
 * Projects a candidate point back onto the disc of radius `r` around an anchor.
 * @returns {number[]} [lon, lat] — the candidate itself when already inside
 */
function clampToDisc(x, y, ax, ay, r, rSq) {
    const dx = x - ax;
    const dy = y - ay;
    const dSq = dx * dx + dy * dy;
    if (dSq <= rSq) return [x, y];
    const scale = r / Math.sqrt(dSq);
    return [ax + dx * scale, ay + dy * scale];
}

/**
 * Douglas–Peucker simplification. Canonical nodes are cluster means, so they
 * jitter ±2–3 m sideways; dropping points that deviate less than ~4 m from
 * the chord straightens the bundle without detaching it from the street.
 * @param {number[][]} coords - [lon, lat][]
 * @param {number} eps - max deviation (degrees)
 * @returns {number[][]}
 */
export function simplifyPath(coords, eps) {
    if (coords.length <= 2) return coords;
    const epsSq = eps * eps;
    const keep = new Uint8Array(coords.length);
    keep[0] = keep[coords.length - 1] = 1;
    const stack = [[0, coords.length - 1]];
    while (stack.length > 0) {
        const [s, e] = stack.pop();
        const [ax, ay] = coords[s];
        const [bx, by] = coords[e];
        let worst = -1;
        let worstD = epsSq;
        for (let i = s + 1; i < e; i++) {
            const [px, py] = coords[i];
            const { d2 } = projectPointOnSegment(px, py, ax, ay, bx, by);
            if (d2 > worstD) {
                worstD = d2;
                worst = i;
            }
        }
        if (worst !== -1) {
            keep[worst] = 1;
            stack.push([s, worst], [worst, e]);
        }
    }
    return coords.filter((_, i) => keep[i]);
}

/**
 * Builds bundled corridor sections from prepared route features.
 * @param {object[]} features - cleaned GeoJSON Feature[] (LineString/MultiLineString)
 * @returns {Section[]}
 */
/**
 * Hard stop for the graph-cleanup fixpoint loops. Both loops strictly remove a
 * node or an edge per iteration, so they terminate on their own; this only
 * turns a hypothetical non-monotonic edit into a loud failure instead of a hang.
 * The observed maximum on the committed data is 3.
 */
/**
 * Re-places every canonical node at the mean of the strands that pass it,
 * instead of leaving it at the mean of whichever vertices clustered into it.
 *
 * This is the wobble mechanism. A node is the running mean of its clustered
 * vertices, so its lateral position depends on WHICH strands contributed: a node
 * that caught one ida and one vuelta vertex sits on the centreline, while its
 * neighbour that caught only ida sits ~half the carriageway separation to the
 * side. Whether both strands land in one cluster is a matter of vertex phase,
 * not of geometry, so the corridor alternates between centreline and kerb — a
 * sawtooth of up to the full ida/vuelta offset (P90 14.2 m on the committed
 * data, and the WOBBLE artifacts measured 6–15 m).
 *
 * Projection is phase-independent: every strand has a nearest point at every
 * position along the corridor, whether or not it has a vertex there. Averaging
 * those projections puts the node where a corridor representing N strands
 * belongs — between them, consistently.
 *
 * Mutates `nodes` in place, before on-path insertion, so every later stage sees
 * one position per node.
 *
 * @param {{x: number, y: number}[]} nodes
 * @param {{coords: number[][], bbox: number[]}[]} paths - all strands
 * @param {number} maxDist - how far a strand may be and still count (degrees)
 */
function recentreNodes(nodes, paths, maxDist) {
    if (paths.length < 2) return;
    const maxD2 = maxDist * maxDist;

    // Uniform grid over every strand segment, cell = maxDist, so a node only
    // tests the segments in its 3×3 neighbourhood. Without it this is
    // nodes × strands × segments — 8 s on a whole-network render.
    /** @type {Map<string, number[]>} cell key → flat [pathIdx, segIdx, …] */
    const grid = new Map();
    const put = (cx, cy, pi, si) => {
        const key = `${cx}_${cy}`;
        let cell = grid.get(key);
        if (!cell) grid.set(key, (cell = []));
        cell.push(pi, si);
    };
    for (let pi = 0; pi < paths.length; pi++) {
        const coords = paths[pi].coords;
        for (let si = 1; si < coords.length; si++) {
            const [ax, ay] = coords[si - 1];
            const [bx, by] = coords[si];
            const x0 = Math.floor(Math.min(ax, bx) / maxDist);
            const x1 = Math.floor(Math.max(ax, bx) / maxDist);
            const y0 = Math.floor(Math.min(ay, by) / maxDist);
            const y1 = Math.floor(Math.max(ay, by) / maxDist);
            for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) put(cx, cy, pi, si);
        }
    }

    /** Best squared distance per contributing strand, reused per node. */
    const bestD2 = new Map();
    const bestPt = new Map();
    const moved = nodes.map((nd) => {
        bestD2.clear();
        bestPt.clear();
        const cx = Math.floor(nd.x / maxDist);
        const cy = Math.floor(nd.y / maxDist);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const cell = grid.get(`${cx + dx}_${cy + dy}`);
                if (!cell) continue;
                for (let k = 0; k < cell.length; k += 2) {
                    const pi = cell[k];
                    const coords = paths[pi].coords;
                    const si = cell[k + 1];
                    const [ax, ay] = coords[si - 1];
                    const [bx, by] = coords[si];
                    const r = projectPointOnSegment(nd.x, nd.y, ax, ay, bx, by);
                    if (r.d2 > maxD2) continue;
                    const prev = bestD2.get(pi);
                    if (prev === undefined || r.d2 < prev) {
                        bestD2.set(pi, r.d2);
                        bestPt.set(pi, [r.x, r.y]);
                    }
                }
            }
        }
        // One strand in range means nothing to average — leave the node alone
        // rather than snapping the corridor onto a single carriageway.
        if (bestPt.size < 2) return null;
        let sx = 0;
        let sy = 0;
        for (const [px, py] of bestPt.values()) {
            sx += px;
            sy += py;
        }
        return [sx / bestPt.size, sy / bestPt.size];
    });

    for (let i = 0; i < nodes.length; i++) {
        if (!moved[i]) continue;
        nodes[i].x = moved[i][0];
        nodes[i].y = moved[i][1];
    }
}

/**
 * How far a strand may sit from a corridor vertex and still be averaged into it,
 * as a multiple of the cluster radius. A contributing strand's vertices are
 * within one radius of the node by construction; 1.5 admits its projection
 * where that strand is digitised sparsely, without reaching the next street
 * (≥80 m apart in Montevideo, i.e. > 3 radii).
 */
const RECENTRE_REACH = 1.5;

const CLEANUP_PASS_GUARD = 64;

export function buildSections(features) {
    const TOL = CONFIG.BUNDLE_TOLERANCE_DEG;
    const tolSq = TOL * TOL;

    // --- Extract flat paths -------------------------------------------------
    /** @type {{line: string, variant: string, coords: number[][]}[]} */
    const paths = [];
    for (const f of features) {
        const line = f.properties.DESC_LINEA;
        const variant = f.properties.DESC_VARIA || '';
        const g = f.geometry;
        const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
        for (const part of parts) {
            if (part && part.length >= 2) paths.push({ line, variant, coords: part });
        }
    }
    if (paths.length === 0) return [];

    // Bounding box per strand: recentreOnStrands rejects most strands per vertex
    // with a box test before touching their segments.
    for (const p of paths) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [x, y] of p.coords) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        p.bbox = [minX, minY, maxX, maxY];
    }

    // --- 1. Cluster vertices into canonical nodes ---------------------------
    /** @type {{x: number, y: number, sx: number, sy: number, n: number}[]} */
    const nodes = [];
    /** @type {Map<string, number[]>} cell key -> node ids (kept in creation cell) */
    const cells = new Map();
    const cellOf = (x, y) => `${Math.round(x / TOL)}_${Math.round(y / TOL)}`;

    const nodeFor = (x, y) => {
        const cx = Math.round(x / TOL);
        const cy = Math.round(y / TOL);
        let best = -1;
        let bestD = tolSq;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const ids = cells.get(`${cx + dx}_${cy + dy}`);
                if (!ids) continue;
                for (const id of ids) {
                    const nd = nodes[id];
                    const ddx = nd.x - x;
                    const ddy = nd.y - y;
                    const d2 = ddx * ddx + ddy * ddy;
                    if (d2 < bestD) {
                        bestD = d2;
                        best = id;
                    }
                }
            }
        }
        if (best !== -1) {
            const nd = nodes[best];
            nd.sx += x;
            nd.sy += y;
            nd.n++;
            nd.x = nd.sx / nd.n;
            nd.y = nd.sy / nd.n;
            return best;
        }
        const id = nodes.length;
        nodes.push({ x, y, sx: x, sy: y, n: 1 });
        const key = cellOf(x, y);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(id);
        return id;
    };

    const nodeSeqs = paths.map((p) => {
        const seq = [];
        for (const [x, y] of p.coords) {
            const id = nodeFor(x, y);
            if (seq.length === 0 || seq[seq.length - 1] !== id) seq.push(id);
        }
        return seq;
    });

    // Re-centre every canonical node on the strands that actually pass it.
    // Done ONCE PER NODE rather than per section: a node on a section boundary
    // belongs to two bundles with different strand sets, and re-centring it
    // separately for each gave it two positions — the corridors stopped
    // stitching there and produced fresh SELF-CROSS and SPIKE artifacts at
    // exactly those boundaries. One position per node keeps R-CONTINUOUS.
    recentreNodes(nodes, paths, TOL * RECENTRE_REACH);

    // --- 2. Insert on-path nodes into long segments -------------------------
    // A sparse trace may jump A→C where a denser trace goes A→B→C along the
    // same street. Insert B into the sparse segment so both produce identical
    // edges. Candidate nodes are found by sampling the grid along the segment.
    const splitSegment = (aId, bId, out) => {
        const a = nodes[aId];
        const b = nodes[bId];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 4 * tolSq) {
            out.push(bId);
            return;
        }
        const steps = Math.ceil(Math.sqrt(len2) / TOL);
        const checked = new Set([aId, bId]);
        /** @type {{id: number, t: number}[]} */
        const inserts = [];
        const perpTolSq = tolSq * 0.81; // (0.9·TOL)² — slightly stricter than cluster radius
        for (let s = 0; s <= steps; s++) {
            const px = a.x + (dx * s) / steps;
            const py = a.y + (dy * s) / steps;
            const cx = Math.round(px / TOL);
            const cy = Math.round(py / TOL);
            for (let gx = -1; gx <= 1; gx++) {
                for (let gy = -1; gy <= 1; gy++) {
                    const ids = cells.get(`${cx + gx}_${cy + gy}`);
                    if (!ids) continue;
                    for (const id of ids) {
                        if (checked.has(id)) continue;
                        checked.add(id);
                        const nd = nodes[id];
                        const { t, d2 } = unclampedSegmentParam(nd.x, nd.y, a.x, a.y, b.x, b.y);
                        if (t <= 0 || t >= 1) continue;
                        if (d2 >= perpTolSq) continue;
                        // Keep a small clearance off the endpoints (adjacent
                        // clusters sit ~TOL apart, so this must stay well
                        // below TOL or legitimate on-path nodes get skipped
                        // and the edges of different variants stop matching).
                        const clearSq = tolSq * 0.09; // (0.3·TOL)²
                        const dax = nd.x - a.x;
                        const day = nd.y - a.y;
                        const dbx = nd.x - b.x;
                        const dby = nd.y - b.y;
                        if (dax * dax + day * day < clearSq) continue;
                        if (dbx * dbx + dby * dby < clearSq) continue;
                        inserts.push({ id, t });
                    }
                }
            }
        }
        inserts.sort((p, q) => p.t - q.t);
        for (const ins of inserts) out.push(ins.id);
        out.push(bId);
    };

    const refinedSeqs = nodeSeqs.map((seq) => {
        if (seq.length < 2) return seq;
        const out = [seq[0]];
        for (let i = 1; i < seq.length; i++) {
            splitSegment(seq[i - 1], seq[i], out);
        }
        return out;
    });

    // --- 3. Build the undirected edge graph ---------------------------------
    /**
     * @type {Map<string, {a: number, b: number, dir: number[], lines: Set<string>,
     *                     variantsByLine: Map<string, Set<string>>, sig?: string}>}
     */
    const edges = new Map();
    refinedSeqs.forEach((seq, pi) => {
        const { line, variant } = paths[pi];
        for (let i = 1; i < seq.length; i++) {
            const u = seq[i - 1];
            const v = seq[i];
            if (u === v) continue;
            const key = u < v ? `${u}_${v}` : `${v}_${u}`;
            let e = edges.get(key);
            if (!e) {
                e = {
                    a: Math.min(u, v),
                    b: Math.max(u, v),
                    dir: [u, v], // first traversal direction — used to orient sections
                    lines: new Set(),
                    variantsByLine: new Map(),
                };
                edges.set(key, e);
            }
            e.lines.add(line);
            if (!e.variantsByLine.has(line)) e.variantsByLine.set(line, new Set());
            if (variant) e.variantsByLine.get(line).add(variant);
        }
    });

    // --- 3.5 Graph cleanup: collapse corner micro-forks ---------------------
    // At intersections the turning arcs of different variants genuinely
    // diverge by more than TOL, leaving short parallel "diamond" forks
    // (u→p→v vs u→q→v with p,q a few metres apart) and chord edges that
    // bypass an on-path node. Both make the bundle split/zigzag at corners.

    /** @type {Map<number, Map<number, string>>} node -> (neighbour -> edge key) */
    const adj = new Map();
    const adjOf = (n) => {
        if (!adj.has(n)) adj.set(n, new Map());
        return adj.get(n);
    };
    for (const [key, e] of edges) {
        adjOf(e.a).set(e.b, key);
        adjOf(e.b).set(e.a, key);
    }

    const mergeEdgeInto = (target, source) => {
        for (const ln of source.lines) target.lines.add(ln);
        for (const [ln, vs] of source.variantsByLine) {
            if (!target.variantsByLine.has(ln)) target.variantsByLine.set(ln, new Set());
            for (const v of vs) target.variantsByLine.get(ln).add(v);
        }
    };

    const addOrMergeEdge = (u, v, source, dir) => {
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        let e = edges.get(key);
        if (!e) {
            e = {
                a: Math.min(u, v),
                b: Math.max(u, v),
                dir,
                lines: new Set(),
                variantsByLine: new Map(),
            };
            edges.set(key, e);
            adjOf(u).set(v, key);
            adjOf(v).set(u, key);
        }
        mergeEdgeInto(e, source);
    };

    const removeEdge = (key) => {
        const e = edges.get(key);
        if (!e) return;
        edges.delete(key);
        adj.get(e.a)?.delete(e.b);
        adj.get(e.b)?.delete(e.a);
    };

    // (a) Diamond merge: absorb node q into nearby node p when the graph
    //     forks at a junction and immediately rejoins.
    const mergeNode = (q, p) => {
        const np = nodes[p];
        const nq = nodes[q];
        np.sx += nq.sx;
        np.sy += nq.sy;
        np.n += nq.n;
        np.x = np.sx / np.n;
        np.y = np.sy / np.n;
        for (const [x, key] of [...(adj.get(q) ?? new Map())]) {
            const e = edges.get(key);
            removeEdge(key);
            if (x === p) continue; // the fork edge itself disappears
            const dir = e.dir.map((n) => (n === q ? p : n));
            addOrMergeEdge(p, x, e, dir);
        }
        adj.delete(q);
    };

    // Run to a fixpoint instead of a fixed pass count. Each pass strictly
    // removes nodes, so the loop is monotonic and must terminate; the guard is a
    // backstop against a future non-monotonic edit, not an expected limit.
    // Measured over the whole-network render plus all 140 single-line renders:
    // the loop converges in 1 pass 117 times, 2 passes 23, 3 passes once, and
    // never had work left at the old cap of 4 — so this changes no output today
    // and exists so that a denser feed cannot silently leave cleanup undone.
    for (let pass = 0; pass < CLEANUP_PASS_GUARD; pass++) {
        let merges = 0;
        if (pass === CLEANUP_PASS_GUARD - 1) {
            throw new Error(
                `buildSections: diamond merge did not converge in ${CLEANUP_PASS_GUARD} passes`,
            );
        }
        for (const u of [...adj.keys()]) {
            const nbrs = adj.get(u);
            if (!nbrs || nbrs.size < 2) continue;
            const ids = [...nbrs.keys()];
            outer: for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const p = ids[i];
                    const q = ids[j];
                    const dx = nodes[p].x - nodes[q].x;
                    const dy = nodes[p].y - nodes[q].y;
                    if (dx * dx + dy * dy >= tolSq) continue;
                    // Merge only genuine forks: p and q must rejoin at some
                    // node beyond u (or connect directly to each other).
                    let rejoin = adj.get(p)?.has(q) ?? false;
                    if (!rejoin) {
                        for (const w of adj.get(p)?.keys() ?? []) {
                            if (w !== u && adj.get(q)?.has(w)) {
                                rejoin = true;
                                break;
                            }
                        }
                    }
                    if (!rejoin) continue;
                    mergeNode(q, p);
                    merges++;
                    break outer;
                }
            }
        }
        if (merges === 0) break;
    }

    // (b) Triangle dissolve: an edge u→v that skips over a node w lying on
    //     its path (w adjacent to both u and v, close to the chord) is folded
    //     into u→w and w→v so both variants produce identical edges.
    // Fixpoint, same reasoning as the diamond merge above: each pass strictly
    // removes an edge. Measured: converges in 1 pass 108 times, 2 passes 33,
    // never with work left at the old cap of 3.
    for (let pass = 0; pass < CLEANUP_PASS_GUARD; pass++) {
        let dissolved = 0;
        if (pass === CLEANUP_PASS_GUARD - 1) {
            throw new Error(
                `buildSections: triangle dissolve did not converge in ${CLEANUP_PASS_GUARD} passes`,
            );
        }
        for (const [key, e] of [...edges]) {
            if (!edges.has(key)) continue;
            const { a, b } = e;
            const na = nodes[a];
            const nb = nodes[b];
            const dx = nb.x - na.x;
            const dy = nb.y - na.y;
            const len2 = dx * dx + dy * dy;
            if (len2 === 0) continue;
            for (const w of [...(adj.get(a)?.keys() ?? [])]) {
                if (w === b || !adj.get(b)?.has(w)) continue;
                const nw = nodes[w];
                const { t, d2 } = unclampedSegmentParam(nw.x, nw.y, na.x, na.y, nb.x, nb.y);
                if (t <= 0 || t >= 1) continue;
                if (d2 >= tolSq * 0.64) continue;
                const fromA = e.dir[0] === a;
                const aw = edges.get(adj.get(a).get(w));
                const wb = edges.get(adj.get(b).get(w));
                mergeEdgeInto(aw, e);
                mergeEdgeInto(wb, e);
                // Preserve the traversal hint through the detour when the
                // dissolved edge dominates (its lines are a superset).
                if (aw.lines.size === e.lines.size) aw.dir = fromA ? [a, w] : [w, a];
                if (wb.lines.size === e.lines.size) wb.dir = fromA ? [w, b] : [b, w];
                removeEdge(key);
                dissolved++;
                break;
            }
        }
        if (dissolved === 0) break;
    }

    /** @type {Map<number, Set<string>>} node id -> incident edge keys */
    const nodeEdges = new Map();
    for (const [key, e] of edges) {
        if (!nodeEdges.has(e.a)) nodeEdges.set(e.a, new Set());
        if (!nodeEdges.has(e.b)) nodeEdges.set(e.b, new Set());
        nodeEdges.get(e.a).add(key);
        nodeEdges.get(e.b).add(key);
    }
    for (const e of edges.values()) {
        e.sig = [...e.lines].sort(lineCompare).join('');
    }

    // --- 4. Merge degree-2 same-bundle edges into sections ------------------
    const visited = new Set();
    /** @type {Section[]} */
    const sections = [];

    for (const [startKey, startEdge] of edges) {
        if (visited.has(startKey)) continue;
        visited.add(startKey);

        const sig = startEdge.sig;
        const chainNodes = [startEdge.dir[0], startEdge.dir[1]];
        const chainKeys = [startKey];

        const grow = (atEnd) => {
            let guard = edges.size + 1;
            while (guard-- > 0) {
                const tip = atEnd ? chainNodes[chainNodes.length - 1] : chainNodes[0];
                const incident = nodeEdges.get(tip);
                if (!incident || incident.size !== 2) return;
                const curKey = atEnd ? chainKeys[chainKeys.length - 1] : chainKeys[0];
                let nextKey = null;
                for (const k of incident) {
                    if (k !== curKey) nextKey = k;
                }
                if (!nextKey || visited.has(nextKey)) return;
                const ne = edges.get(nextKey);
                if (ne.sig !== sig) return;
                visited.add(nextKey);
                const other = ne.a === tip ? ne.b : ne.a;
                if (atEnd) {
                    chainKeys.push(nextKey);
                    chainNodes.push(other);
                } else {
                    chainKeys.unshift(nextKey);
                    chainNodes.unshift(other);
                }
            }
        };
        grow(true);
        grow(false);

        // Orient the section along the first travel direction of its first
        // edge, so consecutive sections of one street keep offsets on the
        // same side (lines don't flip left/right at bundle changes).
        const fe = edges.get(chainKeys[0]);
        if (fe.dir[0] === chainNodes[1] && fe.dir[1] === chainNodes[0]) {
            chainNodes.reverse();
            chainKeys.reverse();
        }

        const variantsByLine = new Map();
        for (const k of chainKeys) {
            for (const [ln, vs] of edges.get(k).variantsByLine) {
                if (!variantsByLine.has(ln)) variantsByLine.set(ln, new Set());
                for (const v of vs) variantsByLine.get(ln).add(v);
            }
        }

        sections.push({
            coords: simplifyPath(
                smoothPath(
                    chainNodes.map((id) => [nodes[id].x, nodes[id].y]),
                    CONFIG.BUNDLE_SMOOTH_PASSES,
                    CONFIG.BUNDLE_SMOOTH_MAX_SEG_DEG,
                    CONFIG.BUNDLE_SMOOTH_MAX_SHIFT_DEG,
                ),
                CONFIG.BUNDLE_SIMPLIFY_EPS_DEG,
            ),
            lines: [...startEdge.lines].sort(lineCompare),
            variantsByLine,
        });
    }

    return sections;
}

/**
 * @typedef {object} JointSide
 * @property {number[]} neighbor - [lon, lat] vertex adjacent to the node in the section
 * @property {boolean} nodeIsEnd - node is the section's LAST coordinate
 * @property {number} idx - the line's slot inside the section
 * @property {number} total - the section's line count
 */

/**
 * Detects where a line continues from one section into exactly one other and
 * must be visually stitched (brainstorm-005): sections are separate offset
 * polylines, so without a joint the strands fan out at corners and side-step
 * where the bundle composition (and with it the line's slot) changes.
 *
 * A node with three or more sections carrying the same line is a true branch
 * (the line genuinely diverges there) — no unambiguous joint exists and none
 * is produced.
 *
 * @param {Section[]} sections - output of buildSections (coords share canonical nodes)
 * @returns {Array<{node: number[], line: string, a: JointSide, b: JointSide}>}
 */
export function buildJoints(sections) {
    /** node key -> Array<{sec: Section, nodeIsEnd: boolean}> */
    const byNode = new Map();
    for (const sec of sections) {
        if (sec.coords.length < 2) continue;
        for (const nodeIsEnd of [false, true]) {
            const node = nodeIsEnd ? sec.coords[sec.coords.length - 1] : sec.coords[0];
            const key = `${node[0]},${node[1]}`;
            if (!byNode.has(key)) byNode.set(key, []);
            byNode.get(key).push({ sec, nodeIsEnd });
        }
    }

    const side = ({ sec, nodeIsEnd }, line) => ({
        neighbor: nodeIsEnd ? sec.coords[sec.coords.length - 2] : sec.coords[1],
        nodeIsEnd,
        idx: sec.lines.indexOf(line),
        total: sec.lines.length,
    });

    const joints = [];
    for (const entries of byNode.values()) {
        if (entries.length < 2) continue;
        const byLine = new Map();
        for (const e of entries) {
            for (const line of e.sec.lines) {
                if (!byLine.has(line)) byLine.set(line, []);
                byLine.get(line).push(e);
            }
        }
        for (const [line, es] of byLine) {
            if (es.length !== 2) continue; // dead end or true branch
            if (es[0].sec === es[1].sec) continue; // ring section meeting itself
            const node = es[0].nodeIsEnd
                ? es[0].sec.coords[es[0].sec.coords.length - 1]
                : es[0].sec.coords[0];
            joints.push({ node, line, a: side(es[0], line), b: side(es[1], line) });
        }
    }
    return joints;
}
