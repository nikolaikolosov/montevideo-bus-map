import { describe, it, expect } from 'vitest';
import { buildSections } from '../../src/bundling.js';
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
