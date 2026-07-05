import { describe, it, expect } from 'vitest';
import { buildSections, smoothPath } from '../../src/bundling.js';
import { CONFIG } from '../../src/config.js';

/** Builds a route Feature along given [lon, lat] coords. */
const feature = (line, variant, coords) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: { DESC_LINEA: line, COD_VARIAN: variant, DESC_VARIA: variant },
});

/** Straight street along the lon axis: points every `step` degrees. */
const street = (n, { latJitter = 0, step = 0.0004, lat = 0, lon0 = 0 } = {}) =>
    Array.from({ length: n }, (_, i) => [lon0 + i * step, lat + latJitter]);

describe('buildSections', () => {
    it('returns one section for a single variant', () => {
        const sections = buildSections([feature('100', 'v1', street(6))]);
        expect(sections).toHaveLength(1);
        expect(sections[0].lines).toEqual(['100']);
        expect([...sections[0].variantsByLine.get('100')]).toEqual(['v1']);
    });

    it('merges two jittered variants of one line into one corridor', () => {
        // Second trace jitters sideways by less than BUNDLE_TOLERANCE_DEG
        const jitter = CONFIG.BUNDLE_TOLERANCE_DEG * 0.3;
        const sections = buildSections([
            feature('100', 'ida', street(6)),
            feature('100', 'vuelta', street(6, { latJitter: jitter })),
        ]);
        expect(sections).toHaveLength(1);
        expect(sections[0].lines).toEqual(['100']);
        expect([...sections[0].variantsByLine.get('100')].sort()).toEqual(['ida', 'vuelta']);
    });

    it('unifies sparse and dense traces of the same street', () => {
        const dense = street(9, { step: 0.0002 });
        const sparse = [dense[0], dense[4], dense[8]]; // same street, fewer vertices
        const sections = buildSections([
            feature('100', 'dense', dense),
            feature('100', 'sparse', sparse),
        ]);
        expect(sections).toHaveLength(1);
    });

    it('puts two lines sharing a corridor into one section, sorted', () => {
        const sections = buildSections([
            feature('7', 'a', street(6)),
            feature('100', 'b', street(6)),
        ]);
        expect(sections).toHaveLength(1);
        expect(sections[0].lines).toEqual(['7', '100']); // numeric-aware sort
    });

    it('keeps far-apart streets as separate sections', () => {
        const sections = buildSections([
            feature('100', 'a', street(6)),
            feature('200', 'b', street(6, { lat: 0.01 })), // ~1 km away
        ]);
        expect(sections).toHaveLength(2);
        const lineSets = sections.map((s) => s.lines.join(','));
        expect(lineSets.sort()).toEqual(['100', '200']);
    });

    it('returns an empty array for no usable geometry', () => {
        expect(buildSections([])).toEqual([]);
        expect(buildSections([feature('1', 'v', [[0, 0]])])).toEqual([]);
    });
});

describe('smoothPath (anti-sawtooth smoothing)', () => {
    it('flattens an alternating sawtooth while pinning the endpoints', () => {
        const saw = [
            [0, 0],
            [10, 5],
            [20, -5],
            [30, 5],
            [40, 0],
        ];
        const out = smoothPath(saw, 2, 100, 10);
        expect(out[0]).toEqual([0, 0]);
        expect(out[out.length - 1]).toEqual([40, 0]);
        const maxDev = Math.max(...out.slice(1, -1).map((p) => Math.abs(p[1])));
        expect(maxDev).toBeLessThan(2.5); // was 5 before smoothing
    });

    it('leaves straight lines and short paths untouched', () => {
        const straight = [
            [0, 0],
            [10, 0],
            [20, 0],
        ];
        expect(smoothPath(straight, 2, 100, 10)).toEqual(straight);
        const short = [
            [0, 0],
            [5, 5],
        ];
        expect(smoothPath(short, 2, 100, 10)).toBe(short);
    });

    it('rounds a corner proportionally to the node spacing, not more', () => {
        const corner = [
            [0, 0],
            [30, 0],
            [30, 30],
        ];
        const out = smoothPath(corner, 2, 100, 20);
        const [cx, cy] = out[1];
        expect(Math.hypot(cx - 30, cy - 0)).toBeLessThan(17);
        expect(out[0]).toEqual([0, 0]);
        expect(out[2]).toEqual([30, 30]);
    });

    it('never moves a vertex flanked by long segments (sparse peripheral traces)', () => {
        // A km-scale corner of an L*/G* line must stay exactly put — the
        // original unguarded smoothing swept such corners hundreds of meters
        // off the street (route-invariants caught it).
        const sparse = [
            [0, 0],
            [1000, 0],
            [1000, 1000],
        ];
        expect(smoothPath(sparse, 2, 66, 10)).toEqual(sparse);
    });

    it('caps the displacement of any smoothed vertex', () => {
        const spike = [
            [0, 0],
            [30, 40], // 40 off the axis: uncapped Laplacian would move it ~20
            [60, 0],
        ];
        const out = smoothPath(spike, 1, 100, 5);
        const moved = Math.hypot(out[1][0] - 30, out[1][1] - 40);
        expect(moved).toBeLessThanOrEqual(5 + 1e-9);
    });
});
