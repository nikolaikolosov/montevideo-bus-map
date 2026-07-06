import { describe, it, expect } from 'vitest';
import { buildSearchIndex, normalize } from '../../src/search.js';

const stop = (code, calle, esquina) => ({
    type: 'Feature',
    properties: { COD_UBIC_P: code, CALLE: calle, ESQUINA: esquina },
    geometry: { type: 'Point', coordinates: [0, 0] },
});

const LINES = ['2', '10', '100', '104', 'D1', 'D10', '124 Sd', '405'];
const STOPS = [
    stop(4772, 'BUENOS AIRES', 'ITUZAINGO'),
    stop(1000, 'AV CIBILS', 'VERDUN'),
    stop(47725, 'CAMINO MALDONADO', 'KM 25'),
    stop(3227, 'PEÑAROL', 'AV SAYAGO'),
];

const index = buildSearchIndex(LINES, STOPS);

describe('normalize', () => {
    it('strips case and diacritics', () => {
        expect(normalize('PEÑAROL Güemes Á')).toBe('penarol guemes a');
    });
});

describe('search ranking', () => {
    it('puts the exact line id first, then prefixes', () => {
        const r = index.search('10');
        expect(r[0]).toEqual({ type: 'line', id: '10' });
        expect(r[1]).toEqual({ type: 'line', id: '100' });
        expect(r[2]).toEqual({ type: 'line', id: '104' });
    });

    it('finds lines with spaces in the id', () => {
        expect(index.search('124')[0]).toEqual({ type: 'line', id: '124 Sd' });
    });

    it('matches stop codes for numeric queries, shortest (exact) first', () => {
        const r = index.search('4772');
        const stops = r.filter((e) => e.type === 'stop');
        expect(stops[0].code).toBe(4772);
        expect(stops[1].code).toBe(47725);
    });

    it('matches stop names accent- and case-insensitively', () => {
        const r = index.search('penarol');
        expect(r.some((e) => e.type === 'stop' && e.code === 3227)).toBe(true);
    });

    it('matches across CALLE and ESQUINA', () => {
        const r = index.search('cibils verdun');
        expect(r).toEqual([{ type: 'stop', code: 1000, name: 'AV CIBILS', esquina: 'VERDUN' }]);
    });

    it('ranks alphanumeric line ids by exactness', () => {
        const r = index.search('d1');
        expect(r[0]).toEqual({ type: 'line', id: 'D1' });
        expect(r[1]).toEqual({ type: 'line', id: 'D10' });
    });

    it('orders mixed matches per the documented ranks', () => {
        // "10": line 10 (exact) > 100/104 (prefix) > stop 1000 (code) >
        // D10 (line substring).
        const r = index.search('10');
        expect(r.map((e) => (e.type === 'line' ? e.id : e.code))).toEqual([
            '10',
            '100',
            '104',
            1000,
            'D10',
        ]);
    });

    it('returns nothing for an empty query and respects the limit', () => {
        expect(index.search('   ')).toEqual([]);
        expect(index.search('1', 3)).toHaveLength(3);
    });
});
