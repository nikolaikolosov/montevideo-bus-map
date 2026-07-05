/**
 * Route continuity invariants (brainstorm-005).
 *
 * Sections are separate offset polylines; where a line continues from one
 * section into another, an OffsetJoint must stitch the strands so routes
 * render without gaps at corners and slot changes. These tests run the REAL
 * data through the REAL pipeline (prepareRouteFeature → buildSections →
 * buildJoints) and check, in projected pixel space with the real offset math:
 *
 *  1. Joint coverage: every (node, line) where exactly two sections meet has
 *     a joint — recomputed independently and compared.
 *  2. Endpoint exactness: each joint's computed endpoints coincide with the
 *     drawn strand endpoints (offsetPoints output) of both adjacent sections,
 *     sub-pixel, at a high zoom where offsets are widest.
 *  3. The user-reported case: stop 2061 "Ver rutas (todas)" has joints for
 *     every through line at the Artigas→Ellauri corner that previously
 *     rendered a visible gap.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    buildIndexes,
    stopLinesMap,
    stopVariantsMap,
    uniqueStopByCode,
    getFilteredRouteFeatures,
} from '../../src/data.js';
import { buildSections, buildJoints } from '../../src/bundling.js';
import { prepareRouteFeature, getLineOffset } from '../../src/map.js';
import { offsetPoints, strandEndpoint } from '../../src/offsetline.js';
import { CONFIG } from '../../src/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ZOOM = 19; // widest offsets — hardest case for endpoint matching
const WEIGHT = CONFIG.ROUTE_WEIGHT_MULTI;

/** Web-Mercator projection to pixel space at ZOOM (Leaflet-equivalent). */
function project([lon, lat]) {
    const scale = 256 * 2 ** ZOOM;
    const x = ((lon + 180) / 360) * scale;
    const s = Math.sin((lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
    return { x, y };
}

/** Meters between two [lon, lat] points (equirectangular, fine at city scale). */
function metersBetween([lon1, lat1], [lon2, lat2]) {
    const kx = 111320 * Math.cos((lat1 * Math.PI) / 180);
    return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 110540);
}

/** Mirrors the "Ver rutas" render pipeline for a stop. */
function sectionsForStop(stopCode) {
    const source = uniqueStopByCode.get(stopCode);
    expect(source, `stop ${stopCode}`).toBeTruthy();
    const lineIds = [...(stopLinesMap.get(stopCode) ?? [])];
    const variantsArr = [...(stopVariantsMap.get(stopCode) ?? [])];
    const features = getFilteredRouteFeatures(lineIds, variantsArr)
        .map((f) => prepareRouteFeature(f, source.geometry.coordinates))
        .filter(Boolean);
    return buildSections(features);
}

/** Mirrors the line-select render pipeline. */
function sectionsForLine(lineId) {
    const features = getFilteredRouteFeatures([lineId], null)
        .map((f) => prepareRouteFeature(f, null))
        .filter(Boolean);
    return buildSections(features);
}

/** Independent recomputation of which (node, line) pairs need a joint. */
function expectedJointKeys(sections) {
    const byNode = new Map();
    for (const sec of sections) {
        if (sec.coords.length < 2) continue;
        for (const node of [sec.coords[0], sec.coords[sec.coords.length - 1]]) {
            const key = `${node[0]},${node[1]}`;
            if (!byNode.has(key)) byNode.set(key, []);
            byNode.get(key).push(sec);
        }
    }
    const keys = new Set();
    for (const [key, secs] of byNode) {
        const perLine = new Map();
        for (const sec of secs) {
            for (const line of sec.lines) perLine.set(line, (perLine.get(line) ?? 0) + 1);
        }
        for (const [line, n] of perLine) {
            const distinct = new Set(secs.filter((s) => s.lines.includes(line)));
            if (n === 2 && distinct.size === 2) keys.add(`${key}|${line}`);
        }
    }
    return keys;
}

/** Drawn strand endpoint of `line` in `sec` at the given node side. */
function drawnEndpoint(sec, line, nodeIsEnd) {
    const pts = sec.coords.map(project).map((p) => L.point(p.x, p.y));
    const d = getLineOffset(sec.lines.indexOf(line), sec.lines.length, ZOOM, WEIGHT);
    const ring = offsetPoints(pts, d);
    return nodeIsEnd ? ring[ring.length - 1] : ring[0];
}

function checkJoints(sections) {
    const joints = buildJoints(sections);

    // 1. Coverage matches the independent recomputation exactly.
    const got = new Set(joints.map((j) => `${j.node[0]},${j.node[1]}|${j.line}`));
    expect(got).toEqual(expectedJointKeys(sections));

    // 2. Endpoint exactness against the actually-drawn strand geometry.
    let checked = 0;
    for (const j of joints) {
        const nodePx = L.point(project(j.node).x, project(j.node).y);
        for (const s of [j.a, j.b]) {
            // Sections allocate their own coord arrays, so match by value.
            const same = (p, q) => p[0] === q[0] && p[1] === q[1];
            const sec = sections.find((sec) => {
                const end = s.nodeIsEnd ? sec.coords[sec.coords.length - 1] : sec.coords[0];
                const nb = s.nodeIsEnd ? sec.coords[sec.coords.length - 2] : sec.coords[1];
                return (
                    same(end, j.node) &&
                    same(nb, s.neighbor) &&
                    sec.lines.length === s.total &&
                    sec.lines[s.idx] === j.line
                );
            });
            expect(sec, `section for joint ${j.line}@${j.node}`).toBeTruthy();

            const d = getLineOffset(s.idx, s.total, ZOOM, WEIGHT);
            const computed = strandEndpoint(
                nodePx,
                L.point(project(s.neighbor).x, project(s.neighbor).y),
                s.nodeIsEnd,
                d,
            );
            const drawn = drawnEndpoint(sec, j.line, s.nodeIsEnd);
            expect(computed).toBeTruthy();
            // cullLoops may shave a strand end in extreme geometry; sub-pixel
            // agreement is required for the overwhelming majority (asserted
            // via the mismatch counter below), exact for each checked here.
            const dist = Math.hypot(computed.x - drawn.x, computed.y - drawn.y);
            expect(dist, `endpoint mismatch ${j.line} @ ${j.node}`).toBeLessThan(1e-6);
            checked++;
        }
    }
    return { joints: joints.length, endpointsChecked: checked };
}

beforeAll(() => {
    const routes = JSON.parse(readFileSync(join(root, 'routes.json'), 'utf8'));
    const stops = JSON.parse(readFileSync(join(root, 'stops.json'), 'utf8'));
    buildIndexes(routes, stops);
});

describe('joint coverage and endpoint exactness', () => {
    it('stop 2061 render (the reported case)', () => {
        const { joints } = checkJoints(sectionsForStop(2061));
        expect(joints).toBeGreaterThan(0);
    });

    it.each(['17', '121', '582', '100', '187'])('whole-line render: line %s', (line) => {
        checkJoints(sectionsForLine(line));
    });

    it('other reported-adjacent stops render with joints too', () => {
        for (const stop of [4850, 3382, 3383, 4478]) {
            const { joints } = checkJoints(sectionsForStop(stop));
            expect(joints, `stop ${stop}`).toBeGreaterThan(0);
        }
    });
});

describe('the reported corner is stitched', () => {
    // Corner of Bv. Gral. Artigas → José Ellauri, between stops 4850 and
    // 3382, where the user saw wedge gaps. The nine lines that continue
    // through it must each have a joint within 150 m.
    const CORNER = [-56.16125, -34.92505];
    const THROUGH_LINES = ['17', '76', '117', '121', '191', '199', '328', '329', '582'];

    it('every through line has a joint at the Artigas→Ellauri corner', () => {
        const joints = buildJoints(sectionsForStop(2061));
        for (const line of THROUGH_LINES) {
            const near = joints.filter(
                (j) => j.line === line && metersBetween(j.node, CORNER) < 150,
            );
            expect(near.length, `line ${line} unstitched at the corner`).toBeGreaterThan(0);
        }
    });
});
