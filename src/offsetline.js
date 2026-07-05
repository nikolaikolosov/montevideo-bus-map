/**
 * OffsetPolyline — an L.Polyline that draws itself displaced sideways by a
 * constant pixel offset, for rendering parallel route bundles.
 *
 * Replaces the leaflet-polylineoffset plugin, which curls the line into loops
 * wherever the offset exceeds the length of a segment at a corner (frequent on
 * bundled city routes: short corner segments + outer lines offset by ~18px).
 * This implementation trims inner joins to the exact intersection, rounds
 * outer joins with a short arc, and finally culls any residual
 * self-intersection loops, so corners stay clean at every zoom.
 *
 * All geometry work happens in projected (pixel) space inside
 * _projectLatlngs, exactly where Leaflet re-projects on each zoom — so the
 * offset is always `offsetPx` screen pixels regardless of zoom.
 */

/**
 * Intersection of the infinite lines (p1,p2) and (p3,p4).
 * @returns {{t: number, u: number, x: number, y: number}|null}
 *  t/u — position of the intersection along each line (0..1 = inside segment)
 */
function lineIntersection(p1, p2, p3, p4) {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-12) return null;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    return { t, u, x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

/**
 * Cuts out small self-intersection loops: when segment i crosses a nearby
 * segment j, everything between them is replaced by the crossing point.
 * @param {L.Point[]} pts
 * @returns {L.Point[]}
 */
function cullLoops(pts) {
    const LOOKAHEAD = 15;
    const EPS = 1e-6;
    const out = pts.slice();
    for (let i = 0; i < out.length - 3; i++) {
        const jMax = Math.min(i + LOOKAHEAD, out.length - 2);
        for (let j = i + 2; j <= jMax; j++) {
            const x = lineIntersection(out[i], out[i + 1], out[j], out[j + 1]);
            if (!x) continue;
            if (x.t <= EPS || x.t >= 1 - EPS || x.u <= EPS || x.u >= 1 - EPS) continue;
            out.splice(i + 1, j - i, L.point(x.x, x.y));
            i--; // re-examine the joined neighbourhood
            break;
        }
    }
    return out;
}

/**
 * Offsets a projected polyline sideways by `d` pixels (sign = side).
 * @param {L.Point[]} pts
 * @param {number} d
 * @returns {L.Point[]}
 */
export function offsetPoints(pts, d) {
    if (!pts || pts.length < 2 || !d) return pts;

    // Per-segment offset copies (skip degenerate segments)
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.05) continue;
        const nx = (-dy / len) * d;
        const ny = (dx / len) * d;
        segs.push({
            ov: p1, // original corner vertex shared with the next segment
            a: L.point(p0.x + nx, p0.y + ny),
            b: L.point(p1.x + nx, p1.y + ny),
            ux: dx / len,
            uy: dy / len,
        });
    }
    if (segs.length === 0) return pts;

    const absd = Math.abs(d);
    const out = [segs[0].a];
    for (let i = 1; i < segs.length; i++) {
        const A = segs[i - 1];
        const B = segs[i];
        const cross = A.ux * B.uy - A.uy * B.ux;

        if (Math.abs(cross) < 0.05) {
            // Nearly straight — just bridge the tiny gap
            out.push(L.point((A.b.x + B.a.x) / 2, (A.b.y + B.a.y) / 2));
            continue;
        }

        const X = lineIntersection(A.a, A.b, B.a, B.b);
        if (X && X.t > 1 && X.u < 0) {
            // Outer side of the turn — approximate a round join with one
            // midpoint on the offset circle around the original vertex.
            out.push(A.b);
            const mx = (A.b.x + B.a.x) / 2 - A.ov.x;
            const my = (A.b.y + B.a.y) / 2 - A.ov.y;
            const ml = Math.sqrt(mx * mx + my * my);
            if (ml > 1e-6) {
                out.push(L.point(A.ov.x + (mx / ml) * absd, A.ov.y + (my / ml) * absd));
            }
            out.push(B.a);
        } else if (X) {
            // Inner side — trim both segments to the exact intersection.
            // (Loops from offsets larger than a segment are culled below.)
            out.push(L.point(X.x, X.y));
        } else {
            out.push(A.b);
            out.push(B.a);
        }
    }
    out.push(segs[segs.length - 1].b);

    return cullLoops(out);
}

/**
 * Endpoint of an offset strand where its section meets a boundary node.
 *
 * offsetPoints displaces each segment perpendicular to its own direction, so
 * the drawn strand terminates at `node + normal(last segment) * d`. The
 * normal's sign depends on whether the node is the section's last vertex
 * (segment runs neighbor→node) or its first (node→neighbor).
 *
 * @param {L.Point} node - projected boundary node
 * @param {L.Point} neighbor - projected vertex adjacent to the node in the section
 * @param {boolean} nodeIsEnd - true when the node is the section's LAST vertex
 * @param {number} d - signed pixel offset of this line in this section
 * @returns {L.Point|null} strand endpoint, or null for a degenerate segment
 */
export function strandEndpoint(node, neighbor, nodeIsEnd, d) {
    const dx = node.x - neighbor.x;
    const dy = node.y - neighbor.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.05) return null;
    const sign = nodeIsEnd ? 1 : -1;
    return L.point(node.x + (-dy / len) * d * sign, node.y + (dx / len) * d * sign);
}

/**
 * Connector geometry between two strand endpoints at a boundary node: a short
 * chord, with one midpoint on the offset circle around the node when the
 * corner is sharp (mirrors offsetPoints' outer-join arc look).
 *
 * @param {L.Point} node
 * @param {L.Point} ea - strand endpoint on side A (from strandEndpoint)
 * @param {L.Point} eb - strand endpoint on side B
 * @returns {L.Point[]}
 */
export function jointPath(node, ea, eb) {
    const ax = ea.x - node.x;
    const ay = ea.y - node.y;
    const bx = eb.x - node.x;
    const by = eb.y - node.y;
    const ra = Math.sqrt(ax * ax + ay * ay);
    const rb = Math.sqrt(bx * bx + by * by);
    if (ra < 1e-6 || rb < 1e-6) return [ea, eb];
    // Angle between the two radial directions; beyond ~60° a chord visibly
    // cuts the corner, so add the arc midpoint at the mean radius.
    const cos = (ax * bx + ay * by) / (ra * rb);
    if (cos < 0.5) {
        const mx = ax / ra + bx / rb;
        const my = ay / ra + by / rb;
        const ml = Math.sqrt(mx * mx + my * my);
        if (ml > 1e-6) {
            const rm = (ra + rb) / 2;
            return [ea, L.point(node.x + (mx / ml) * rm, node.y + (my / ml) * rm), eb];
        }
    }
    return [ea, eb];
}

/**
 * OffsetJoint — the connector drawn at a section boundary for one line, so
 * bundled strands stay visually continuous through corners and slot changes
 * (brainstorm-005). Endpoints are recomputed with the SAME offset math as the
 * adjacent OffsetPolylines on every (re)projection, so they match at every
 * zoom by construction.
 *
 * latlngs: [neighborA, node, neighborB]. Options:
 *  - jointA / jointB: { nodeIsEnd, slot: {idx,total,weight} }
 *  - offsetFor: (slot, zoom) => signed pixel offset (injected to avoid a
 *    circular import with map.js, where getLineOffset lives)
 */
export const OffsetJoint = L.Polyline.extend({
    _projectLatlngs(latlngs, result, projectedBounds) {
        const flat = L.LineUtil.isFlat(latlngs) ? latlngs : latlngs[0];
        const [na, node, nb] = flat.map((ll) => this._map.latLngToLayerPoint(ll));
        const zoom = this._map.getZoom();
        const { jointA, jointB, offsetFor } = this.options;
        const ea = strandEndpoint(node, na, jointA.nodeIsEnd, offsetFor(jointA.slot, zoom));
        const eb = strandEndpoint(node, nb, jointB.nodeIsEnd, offsetFor(jointB.slot, zoom));
        if (!ea || !eb) return;
        const ring = jointPath(node, ea, eb);
        for (const p of ring) projectedBounds.extend(p);
        result.push(ring);
    },
});

export const OffsetPolyline = L.Polyline.extend({
    /**
     * Changes the sideways pixel offset and redraws.
     * @param {number} offsetPx
     */
    setOffsetPx(offsetPx) {
        if (this.options.offsetPx === offsetPx) return this;
        this.options.offsetPx = offsetPx;
        return this.redraw();
    },

    _projectLatlngs(latlngs, result, projectedBounds) {
        if (!L.LineUtil.isFlat(latlngs)) {
            for (const sub of latlngs) this._projectLatlngs(sub, result, projectedBounds);
            return;
        }
        let ring = latlngs.map((ll) => this._map.latLngToLayerPoint(ll));
        const off = this.options.offsetPx;
        if (off) ring = offsetPoints(ring, off);
        for (const p of ring) projectedBounds.extend(p);
        result.push(ring);
    },
});
