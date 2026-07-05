import { describe, it, expect, beforeAll } from 'vitest';
import {
    buildIndexes,
    routesByLine,
    routesByVariant,
    stopLinesMap,
    stopVariantsMap,
    stopsByVariant,
    uniqueStopByCode,
    uniqueStopsData,
    getSortedLines,
    getFilteredRouteFeatures,
    getFilteredStopFeatures,
    buildVariantOrdinalMap,
    getLineColor,
} from '../../src/data.js';

const routeFeature = (line, variant) => ({
    type: 'Feature',
    geometry: {
        type: 'LineString',
        coordinates: [
            [-56.186, -34.905],
            [-56.189, -34.906],
        ],
    },
    properties: { DESC_LINEA: line, COD_VARIAN: variant, DESC_VARIA: `hacia ${variant}` },
});

const stopFeature = (cod) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-56.186, -34.905] },
    properties: { COD_UBIC_P: cod, CALLE: `Calle ${cod}`, ESQUINA: 'Esquina' },
});

// v2 fixture: line 100 has two variants sharing stops, line 7 one variant.
const routesData = {
    type: 'FeatureCollection',
    format_version: 2,
    generated_at: '2026-06-27T11:37:49-03:00',
    features: [routeFeature('100', 'v1'), routeFeature('100', 'v2'), routeFeature('7', 'v3')],
};

const stopsData = {
    type: 'FeatureCollection',
    format_version: 2,
    generated_at: '2026-06-27T11:37:49-03:00',
    features: [stopFeature(1), stopFeature(2), stopFeature(3)],
    patterns: {
        v1: {
            linea: '100',
            paradas: [
                [1, 1],
                [2, 5],
                [3, 9],
            ],
        },
        v2: {
            linea: '100',
            paradas: [
                [3, 1],
                [2, 2],
            ],
        },
        v3: { linea: '7', paradas: [[2, 1]] },
    },
};

beforeAll(() => {
    buildIndexes(routesData, stopsData);
});

describe('buildIndexes (v2 format)', () => {
    it('indexes routes by line and by variant', () => {
        expect(routesByLine.get('100')).toHaveLength(2);
        expect(routesByLine.get('7')).toHaveLength(1);
        expect(routesByVariant.get('v2')).toHaveLength(1);
    });

    it('maps every unique stop by code', () => {
        expect(uniqueStopsData).toHaveLength(3);
        expect(uniqueStopByCode.get(2).properties.CALLE).toBe('Calle 2');
    });

    it('derives per-stop line and variant sets from patterns', () => {
        expect([...stopLinesMap.get(2)].sort()).toEqual(['100', '7']);
        expect([...stopVariantsMap.get(2)].sort()).toEqual(['v1', 'v2', 'v3']);
        expect([...stopLinesMap.get(1)]).toEqual(['100']);
    });

    it('keeps ordered stop entries per variant', () => {
        expect(stopsByVariant.get('v1').map((e) => e.ordinal)).toEqual([1, 5, 9]);
        expect(stopsByVariant.get('v1')[1].feature.properties.COD_UBIC_P).toBe(2);
    });
});

describe('getSortedLines', () => {
    it('sorts numerically, not lexicographically', () => {
        expect(getSortedLines()).toEqual(['7', '100']);
    });
});

describe('getFilteredRouteFeatures', () => {
    it('resolves by line ids', () => {
        expect(getFilteredRouteFeatures(['100'], null)).toHaveLength(2);
    });

    it('prefers explicit variants over lines', () => {
        const out = getFilteredRouteFeatures(['100'], ['v3']);
        expect(out).toHaveLength(1);
        expect(out[0].properties.DESC_LINEA).toBe('7');
    });
});

describe('getFilteredStopFeatures', () => {
    it('filters unique stops by line membership', () => {
        const out = getFilteredStopFeatures(['7'], null, null);
        expect(out.map((f) => f.properties.COD_UBIC_P)).toEqual([2]);
    });

    it('deduplicates stops shared by several variants', () => {
        const out = getFilteredStopFeatures([], ['v1', 'v2'], null);
        expect(out.map((f) => f.properties.COD_UBIC_P).sort()).toEqual([1, 2, 3]);
    });

    it('drops stops upstream of the source ordinal per variant', () => {
        const ordinalMap = buildVariantOrdinalMap(2); // v1: 5, v2: 2, v3: 1
        const out = getFilteredStopFeatures([], ['v1'], ordinalMap);
        expect(out.map((f) => f.properties.COD_UBIC_P).sort()).toEqual([2, 3]);
    });

    it('keeps all stops of variants missing from the ordinal map', () => {
        const out = getFilteredStopFeatures([], ['v1'], new Map());
        expect(out).toHaveLength(3);
    });
});

describe('buildVariantOrdinalMap', () => {
    it('returns the ordinal of the stop within each of its variants', () => {
        const map = buildVariantOrdinalMap(2);
        expect(map.get('v1')).toBe(5);
        expect(map.get('v2')).toBe(2);
        expect(map.get('v3')).toBe(1);
    });

    it('returns a defensive copy', () => {
        buildVariantOrdinalMap(2).set('v1', 999);
        expect(buildVariantOrdinalMap(2).get('v1')).toBe(5);
    });

    it('returns an empty map for unknown stops', () => {
        expect(buildVariantOrdinalMap(999999).size).toBe(0);
    });
});

describe('getLineColor', () => {
    it('is deterministic and line-specific', () => {
        expect(getLineColor('100')).toBe(getLineColor('100'));
        expect(getLineColor('100')).not.toBe(getLineColor('101'));
        expect(getLineColor('100')).toMatch(/^hsl\(/);
    });
});
