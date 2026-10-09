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

    it('matches stop NAMES for a digits-only query too', () => {
        // "18" is Montevideo's main avenue. The two branches used to be chained
        // with else-if on the query SHAPE rather than the match KIND, so a
        // numeric query was never tested against stop names at all: 526 of the
        // committed stops carry digits in CALLE/ESQUINA and none of them was
        // reachable by its own number.
        const stops = [
            stop(1801, 'SARANDI', 'BACACAY'),
            stop(1802, 'RECONQUISTA', 'PIEDRAS'),
            stop(4000, 'AV 18 DE JULIO', 'EJIDO'),
            stop(4001, 'AV 18 DE JULIO', 'YAGUARON'),
        ];
        const ix = buildSearchIndex(['180', '181'], stops);
        const codes = ix.search('18').map((e) => (e.type === 'line' ? e.id : e.code));
        expect(codes).toContain(4000);
        expect(codes).toContain(4001);
        // Without starving the ranks above it: lines and code-prefix stops stay.
        expect(codes).toContain('180');
        expect(codes).toContain(1801);
        // Names come last, as documented.
        expect(codes.indexOf(4000)).toBeGreaterThan(codes.indexOf(1801));
    });

    it('keeps a share of the list for names when codes would flood it', () => {
        // A short numeric prefix matches hundreds of stop CODES, which used to
        // consume the whole limit even once both branches ran.
        const flood = Array.from({ length: 60 }, (_, i) => stop(1800 + i, 'CALLE X', 'Y'));
        const named = [stop(9001, 'AV 18 DE JULIO', 'EJIDO')];
        const ix = buildSearchIndex([], [...flood, ...named]);
        const rows = ix.search('18', 12);
        expect(rows).toHaveLength(12);
        expect(rows.map((e) => e.code)).toContain(9001);
    });

    it('does not list the same stop twice when it matches by code and by name', () => {
        const ix = buildSearchIndex([], [stop(18, 'AV 18 DE JULIO', 'EJIDO')]);
        const rows = ix.search('18');
        expect(rows.filter((e) => e.code === 18)).toHaveLength(1);
    });
});

describe('search — what riders actually type', () => {
    it('finds a corner written the way the app prints it, in either order', () => {
        // The app shows "Av Cibils y Verdun"; a substring of "AV CIBILS VERDUN"
        // matched neither that nor the reverse order.
        for (const q of [
            'cibils y verdun',
            'verdun y cibils',
            'verdun cibils',
            'av cibils esq verdun',
        ]) {
            expect(
                index.search(q).map((e) => e.code),
                q,
            ).toEqual([1000]);
        }
    });

    it('folds street types to the feed abbreviations', () => {
        expect(index.search('avenida cibils').map((e) => e.code)).toEqual([1000]);
        expect(index.search('camino maldonado').map((e) => e.code)).toEqual([47725]);
    });

    it('reads a typed label as a label, not as part of the id', () => {
        // The field shows a picked line as "Línea 104"; editing that text found
        // nothing, because no line id contains the word.
        expect(index.search('Línea 104')[0]).toEqual({ type: 'line', id: '104' });
        expect(index.search('line 124')[0]).toEqual({ type: 'line', id: '124 Sd' });
        expect(index.search('линия d1')[0]).toEqual({ type: 'line', id: 'D1' });
        expect(index.search('parada 4772')[0]).toMatchObject({ type: 'stop', code: 4772 });
    });

    it('lists word matches after the plain substring matches', () => {
        const ix = buildSearchIndex(
            [],
            [stop(1, 'EJIDO', 'AV 18 DE JULIO'), stop(2, 'AV 18 DE JULIO', 'EJIDO')],
        );
        // Stop 2 contains "18 de julio ejido" verbatim; stop 1 only word for word.
        expect(ix.search('18 de julio ejido').map((e) => e.code)).toEqual([2, 1]);
    });

    it('fills the list with names when nothing else matches', () => {
        // The reserved share for names used to be a cap as well as a floor:
        // "rivera" listed 6 of its stops in a list with room for 20.
        const street = Array.from({ length: 30 }, (_, i) =>
            stop(5000 + i, 'AV GRAL RIVERA', `X${i}`),
        );
        expect(buildSearchIndex([], street).search('rivera')).toHaveLength(20);
    });
});
