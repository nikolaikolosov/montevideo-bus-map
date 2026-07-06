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
