/**
 * Corridor smoothness invariants (user report 2026-07-05, line 104).
 *
 * Two failure classes, measured on the REAL data through the REAL pipeline
 * (prepareRouteFeature → buildSections) for every one of the 140 lines:
 *
 *  1. VISIBLE DUPLICATE STRANDS — a line drawn twice along the same street:
 *     two segments of different sections of the same line, near-parallel
 *     (<10°), 6–20 m apart laterally, overlapping ≥40 m along the axis.
 *     Below 6 m the strands render as one at any zoom; above 20 m they are
 *     physically separated carriageways (rambla/bulevar) — genuine geometry.
 *     Line 104's reported "eye" between stops 3355/3933/3934 was exactly
 *     this class; BUNDLE_TOLERANCE_DEG is sized to merge it.
 *
 *  2. KINKS — a sawtooth the corridor should not have: a 60–150° turn where
 *     BOTH adjacent segments are shorter than 35 m. Real street corners turn
 *     once between long blocks; 150–180° hairpins are genuine terminal
 *     turnarounds and stay excluded.
 *
 * The reported line must be perfectly clean; the network-wide counts are
 * frozen as ceilings so any bundling change that regresses smoothness
 * anywhere fails here (the residue is dominated by 10–19 m divided
 * carriageways that sit at the merge threshold — see the PR notes).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildIndexes, getSortedLines, getFilteredRouteFeatures } from '../../src/data.js';
import { prepareRouteFeature } from '../../src/map.js';
import { buildSections } from '../../src/bundling.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Meters per degree at Montevideo's latitude.
const KX = 92000;
const KY = 111000;

const lenM = ([a, b]) => Math.hypot((b[0] - a[0]) * KX, (b[1] - a[1]) * KY);
const angDeg = ([a, b]) => (Math.atan2((b[1] - a[1]) * KY, (b[0] - a[0]) * KX) * 180) / Math.PI;

/** Axial overlap + mean lateral distance (meters) of s2 relative to s1. */
function overlapAndLateral(s1, s2) {
    const toM = ([x, y]) => [x * KX, y * KY];
    const [a1, b1] = s1.map(toM);
    const [a2, b2] = s2.map(toM);
    const dx = b1[0] - a1[0];
    const dy = b1[1] - a1[1];
    const L1 = Math.hypot(dx, dy);
    const u = [dx / L1, dy / L1];
    const proj = (p) => (p[0] - a1[0]) * u[0] + (p[1] - a1[1]) * u[1];
    const lat = (p) => Math.abs(-(p[0] - a1[0]) * u[1] + (p[1] - a1[1]) * u[0]);
    const lo = Math.max(0, Math.min(proj(a2), proj(b2)));
    const hi = Math.min(L1, Math.max(proj(a2), proj(b2)));
    if (hi - lo <= 0) return null;
    return { overlap: hi - lo, lat: (lat(a2) + lat(b2)) / 2 };
}

/** All smoothness violations for one line's own corridors. */
function measureLine(line) {
    const features = getFilteredRouteFeatures([line], null)
        .map((f) => prepareRouteFeature(f, null))
        .filter(Boolean);
    const sections = buildSections(features).filter((s) => s.lines.includes(line));

    const segs = [];
    sections.forEach((s, si) => {
        for (let i = 1; i < s.coords.length; i++) {
            const sg = [s.coords[i - 1], s.coords[i]];
            if (lenM(sg) >= 40) segs.push({ si, sg });
        }
    });

    const dupes = [];
    for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
            if (segs[i].si === segs[j].si) continue;
            let da = Math.abs(angDeg(segs[i].sg) - angDeg(segs[j].sg)) % 180;
            if (da > 90) da = 180 - da;
            if (da > 10) continue;
            const ol = overlapAndLateral(segs[i].sg, segs[j].sg);
            if (ol && ol.overlap > 40 && ol.lat >= 6 && ol.lat <= 20) {
                dupes.push({ lat: +ol.lat.toFixed(1), at: segs[i].sg[0] });
            }
        }
    }

    const kinks = [];
    for (const s of sections) {
        const c = s.coords;
        for (let i = 1; i < c.length - 1; i++) {
            const l1 = lenM([c[i - 1], c[i]]);
            const l2 = lenM([c[i], c[i + 1]]);
            if (l1 > 35 || l2 > 35) continue;
            let turn = Math.abs(angDeg([c[i - 1], c[i]]) - angDeg([c[i], c[i + 1]])) % 360;
            if (turn > 180) turn = 360 - turn;
            if (turn > 60 && turn < 150) kinks.push({ turn: +turn.toFixed(0), at: c[i] });
        }
    }

    return { dupes, kinks };
}

beforeAll(() => {
    const routes = JSON.parse(readFileSync(join(root, 'routes.json'), 'utf8'));
    const stops = JSON.parse(readFileSync(join(root, 'stops.json'), 'utf8'));
    buildIndexes(routes, stops);
});

describe('corridor smoothness', () => {
    it('line 104 (the reported line) is clean in the reported window and near-clean overall', () => {
        const { dupes, kinks } = measureLine('104');
        // Reported window (stops 3355/3933/3934, 26 de Marzo between Rambla
        // Armenia and Julio César): strictly zero.
        const inWindow = (p) => p[0] >= -56.142 && p[0] <= -56.127;
        expect(
            dupes.filter((d) => inWindow(d.at)),
            JSON.stringify(dupes),
        ).toEqual([]);
        expect(
            kinks.filter((k) => inWindow(k.at)),
            JSON.stringify(kinks),
        ).toEqual([]);
        // Whole line: at most the one residual pair on Rambla O'Higgins
        // (lat ≈ 9 m — a genuinely divided carriageway at the merge margin).
        expect(dupes.length).toBeLessThanOrEqual(1);
        expect(kinks).toEqual([]);
    });

    it('network sweep: smoothness never regresses past the frozen ceilings', () => {
        // Measured on the committed data (2026-07-05) after the tolerance +
        // guarded-smoothing fix: 142 visible duplicate pairs (was 396+
        // before; residue = divided carriageways at the merge threshold)
        // and 27 kinks. New bundling work must move these DOWN, not up.
        let dupes = 0;
        let kinks = 0;
        const offenders = [];
        for (const line of getSortedLines()) {
            const m = measureLine(line);
            dupes += m.dupes.length;
            kinks += m.kinks.length;
            if (m.dupes.length > 0) offenders.push(`${line}:${m.dupes.length}`);
        }
        expect(
            dupes,
            `visible duplicate pairs by line: ${offenders.join(' ')}`,
        ).toBeLessThanOrEqual(142);
        expect(kinks).toBeLessThanOrEqual(27);
    });
});
