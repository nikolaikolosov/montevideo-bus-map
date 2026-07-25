// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parseHash, buildHash, go, replace, start, __reset } from '../../src/router.js';

beforeEach(() => {
    __reset();
    history.replaceState(null, '', '#/');
});

describe('parseHash / buildHash', () => {
    const cases = [
        ['#/', { view: 'all' }],
        ['', { view: 'all' }],
        ['#/linea/104', { view: 'line', line: '104' }],
        ['#/linea/124%20Sd', { view: 'line', line: '124 Sd' }],
        ['#/parada/4772', { view: 'stop', stop: 4772 }],
        ['#/parada/4772/todas', { view: 'downstream', stop: 4772, line: null }],
        ['#/parada/4772/linea/102', { view: 'downstream', stop: 4772, line: '102' }],
        ['#/viaje/desde/4772', { view: 'journey', from: 4772, to: null, option: 0 }],
        ['#/viaje/hasta/4018', { view: 'journey', from: null, to: 4018, option: 0 }],
        ['#/viaje/4772/4018', { view: 'journey', from: 4772, to: 4018, option: 0 }],
        ['#/viaje/4772/4018/opcion/3', { view: 'journey', from: 4772, to: 4018, option: 2 }],
    ];

    it.each(cases)('parses %s', (hash, state) => {
        expect(parseHash(hash)).toEqual(state);
    });

    it('round-trips every state through buildHash', () => {
        for (const [, state] of cases.slice(2)) {
            expect(parseHash(buildHash(state))).toEqual(state);
        }
        expect(buildHash({ view: 'all' })).toBe('#/');
    });

    it('fails safe to home on garbage', () => {
        expect(parseHash('#/linea')).toEqual({ view: 'all' });
        expect(parseHash('#/parada/abc')).toEqual({ view: 'all' });
        expect(parseHash('#/parada/1/linea')).toEqual({ view: 'all' });
        expect(parseHash('#/x/y/z')).toEqual({ view: 'all' });
        expect(parseHash('#/viaje')).toEqual({ view: 'all' });
        expect(parseHash('#/viaje/4772')).toEqual({ view: 'all' });
        expect(parseHash('#/viaje/4772/abc')).toEqual({ view: 'all' });
        expect(parseHash('#/viaje/desde')).toEqual({ view: 'all' });
        expect(parseHash('#/viaje/desde/4772/opcion/2')).toEqual({ view: 'all' });
        expect(parseHash('#/viaje/4772/4018/variante/2')).toEqual({ view: 'all' });
        expect(parseHash('#/viaje/4772/4018/opcion/0')).toEqual({ view: 'all' });
    });

    it('fails safe on a malformed percent-escape instead of throwing', () => {
        // The one line id that needs encoding is "124 Sd" → #/linea/124%20Sd,
        // so a chat client truncating that link is the realistic case. Before,
        // decodeURIComponent threw URIError out of parseHash, and on cold load
        // that reached initApp's catch and painted the error overlay over an
        // empty map — with a retry button that reloaded into the same failure.
        for (const hash of [
            '#/linea/124%2',
            '#/linea/124%',
            '#/linea/%E0%A4%A',
            '#/parada/%',
            '#/parada/4772/linea/%C3',
            '#/viaje/%/4018',
            '#/%',
        ]) {
            expect(() => parseHash(hash), hash).not.toThrow();
            expect(parseHash(hash), hash).toEqual({ view: 'all' });
        }
    });

    it('still decodes the escapes that are valid', () => {
        expect(parseHash('#/linea/124%20Sd')).toEqual({ view: 'line', line: '124 Sd' });
        expect(parseHash('#/linea/G%C3%A9nova')).toEqual({ view: 'line', line: 'Génova' });
        expect(parseHash('#/linea/100%25')).toEqual({ view: 'line', line: '100%' });
    });

    it('drops the option segment for the first (best) itinerary', () => {
        expect(buildHash({ view: 'journey', from: 1, to: 2, option: 0 })).toBe('#/viaje/1/2');
        expect(buildHash({ view: 'journey', from: 1, to: 2, option: 1 })).toBe(
            '#/viaje/1/2/opcion/2',
        );
    });

    it('sends an empty journey selection home', () => {
        expect(buildHash({ view: 'journey', from: null, to: null, option: 0 })).toBe('#/');
    });
});

describe('navigation', () => {
    it('start() notifies with the initial URL state', () => {
        history.replaceState(null, '', '#/linea/104');
        const seen = [];
        start((s) => seen.push(s));
        expect(seen).toEqual([{ view: 'line', line: '104' }]);
    });

    it('go() pushes a history entry and notifies synchronously', () => {
        const seen = [];
        start((s) => seen.push(s));
        const before = history.length;
        go({ view: 'line', line: '104' });
        expect(location.hash).toBe('#/linea/104');
        expect(history.length).toBe(before + 1);
        expect(seen.at(-1)).toEqual({ view: 'line', line: '104' });
    });

    it('go() to the CURRENT state re-renders without stacking history', () => {
        const seen = [];
        start((s) => seen.push(s));
        go({ view: 'line', line: '104' });
        const before = history.length;
        go({ view: 'line', line: '104' });
        expect(history.length).toBe(before);
        expect(seen.filter((s) => s.view === 'line')).toHaveLength(2);
    });

    it('replace() rewrites the URL without notifying', () => {
        const seen = [];
        start((s) => seen.push(s));
        replace({ view: 'stop', stop: 4772 });
        expect(location.hash).toBe('#/parada/4772');
        expect(seen).toHaveLength(1); // only the initial notify
    });

    it('follows browser back via popstate/hashchange', () => {
        const seen = [];
        start((s) => seen.push(s));
        go({ view: 'line', line: '104' });
        // Simulate the browser restoring the previous entry.
        history.replaceState(null, '', '#/');
        window.dispatchEvent(new PopStateEvent('popstate'));
        expect(seen.at(-1)).toEqual({ view: 'all' });
    });

    it('ignores popstate for the hash it just wrote', () => {
        const seen = [];
        start((s) => seen.push(s));
        go({ view: 'line', line: '104' });
        const n = seen.length;
        window.dispatchEvent(new PopStateEvent('popstate')); // same hash
        expect(seen).toHaveLength(n);
    });
});
