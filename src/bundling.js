import { CONFIG } from './config.js';

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

const lineCompare = (a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Douglas–Peucker simplification. Canonical nodes are cluster means, so they
 * jitter ±2–3 m sideways; dropping points that deviate less than ~4 m from
 * the chord straightens the bundle without detaching it from the street.
 * @param {number[][]} coords - [lon, lat][]
 * @param {number} eps - max deviation (degrees)
 * @returns {number[][]}
 */
function simplifyPath(coords, eps) {
    if (coords.length <= 2) return coords;
    const epsSq = eps * eps;
    const keep = new Uint8Array(coords.length);
    keep[0] = keep[coords.length - 1] = 1;
    const stack = [[0, coords.length - 1]];
    while (stack.length > 0) {
        const [s, e] = stack.pop();
        const [ax, ay] = coords[s];
        const [bx, by] = coords[e];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let worst = -1;
        let worstD = epsSq;
        for (let i = s + 1; i < e; i++) {
            const [px, py] = coords[i];
            let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            const ex = px - (ax + t * dx);
            const ey = py - (ay + t * dy);
            const d2 = ex * ex + ey * ey;
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
        const perpTolSq = tolSq * 0.64; // (0.8·TOL)² — stricter than cluster radius
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
                        const t = ((nd.x - a.x) * dx + (nd.y - a.y) * dy) / len2;
                        if (t <= 0 || t >= 1) continue;
                        const ex = nd.x - (a.x + t * dx);
                        const ey = nd.y - (a.y + t * dy);
                        if (ex * ex + ey * ey >= perpTolSq) continue;
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

    for (let pass = 0; pass < 4; pass++) {
        let merges = 0;
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
    for (let pass = 0; pass < 3; pass++) {
        let dissolved = 0;
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
                const t = ((nw.x - na.x) * dx + (nw.y - na.y) * dy) / len2;
                if (t <= 0 || t >= 1) continue;
                const ex = nw.x - (na.x + t * dx);
                const ey = nw.y - (na.y + t * dy);
                if (ex * ex + ey * ey >= tolSq * 0.64) continue;
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
                chainNodes.map((id) => [nodes[id].x, nodes[id].y]),
                CONFIG.BUNDLE_SIMPLIFY_EPS_DEG
            ),
            lines: [...startEdge.lines].sort(lineCompare),
            variantsByLine,
        });
    }

    return sections;
}
