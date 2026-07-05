import { describe, it, expect, vi } from 'vitest';
import {
    escapeHTML,
    cleanCoordinates,
    truncateLineDownstream,
    debounce,
    isWithinBounds,
} from '../../src/utils.js';
import { CONFIG } from '../../src/config.js';

describe('escapeHTML', () => {
    it('escapes all HTML-significant characters', () => {
        expect(escapeHTML(`<script>alert("x&y'z")</script>`)).toBe(
            '&lt;script&gt;alert(&quot;x&amp;y&#39;z&quot;)&lt;/script&gt;',
        );
    });

    it('stringifies non-string input', () => {
        expect(escapeHTML(3413)).toBe('3413');
        expect(escapeHTML(null)).toBe('null');
    });
});

describe('cleanCoordinates', () => {
    it('removes consecutive points closer than ~1 m', () => {
        const coords = [
            [-56.2, -34.9],
            [-56.2000001, -34.9000001], // < 1e-5 away — dropped
            [-56.201, -34.9],
        ];
        expect(cleanCoordinates(coords)).toEqual([
            [-56.2, -34.9],
            [-56.201, -34.9],
        ]);
    });

    it('keeps points farther apart than the threshold', () => {
        const coords = [
            [-56.2, -34.9],
            [-56.2002, -34.9],
        ];
        expect(cleanCoordinates(coords)).toEqual(coords);
    });

    it('handles MultiLineString and drops degenerate parts', () => {
        const multi = [
            [
                [-56.2, -34.9],
                [-56.2000001, -34.9], // collapses to 1 point -> part dropped
            ],
            [
                [-56.2, -34.9],
                [-56.21, -34.9],
            ],
        ];
        expect(cleanCoordinates(multi)).toEqual([
            [
                [-56.2, -34.9],
                [-56.21, -34.9],
            ],
        ]);
    });

    it('passes through empty and single-position input', () => {
        expect(cleanCoordinates([])).toEqual([]);
        expect(cleanCoordinates([-56.2, -34.9])).toEqual([-56.2, -34.9]);
    });

    it('does not mutate the input', () => {
        const coords = [
            [-56.2, -34.9],
            [-56.2000001, -34.9],
            [-56.21, -34.9],
        ];
        const copy = JSON.parse(JSON.stringify(coords));
        cleanCoordinates(coords);
        expect(coords).toEqual(copy);
    });
});

describe('truncateLineDownstream', () => {
    const line = [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
    ];

    it('cuts at the projection ON the line — the stop coordinate is never injected', () => {
        // Source sits 0.1 off the line; the head must be its projection (1.9, 0),
        // not the source itself: injecting the stop used to draw chords across
        // city blocks (stops 4534/3987, phantom D1 branch at 3179).
        const out = truncateLineDownstream(line, [1.9, 0.1]);
        expect(out).toEqual([
            [1.9, 0],
            [2, 0],
            [3, 0],
        ]);
    });

    it('projects onto segment interiors, not just vertices (DP-sparse traces)', () => {
        const sparse = [
            [0, 0],
            [100, 0],
        ];
        // Nearest vertex is 40 away; the projection is right below the source.
        expect(truncateLineDownstream(sparse, [60, 5])).toEqual([
            [60, 0],
            [100, 0],
        ]);
    });

    it('returns the whole line when the source is at the start', () => {
        const out = truncateLineDownstream(line, [0, 0]);
        expect(out.length).toBe(4);
        expect(out[0]).toEqual([0, 0]);
    });

    it('drops the degenerate head when the projection lands on a vertex', () => {
        const out = truncateLineDownstream(line, [2, 0.5]);
        expect(out).toEqual([
            [2, 0],
            [3, 0],
        ]);
    });

    it('collapses to a single point at the terminal (caller drops it)', () => {
        const out = truncateLineDownstream(line, [3.5, 0]);
        expect(out).toEqual([[3, 0]]);
    });

    it('truncates only the nearest piece of a MultiLineString', () => {
        const multi = [
            [
                [0, 0],
                [1, 0],
            ],
            [
                [10, 0],
                [11, 0],
                [12, 0],
            ],
        ];
        const out = truncateLineDownstream(multi, [10.9, 0.2]);
        expect(out).toEqual([
            [
                [0, 0],
                [1, 0],
            ],
            [
                [10.9, 0],
                [11, 0],
                [12, 0],
            ],
        ]);
    });
});

describe('debounce', () => {
    it('collapses rapid calls into the last one', () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const d = debounce(fn, 150);
        d(1);
        d(2);
        d(3);
        vi.advanceTimersByTime(149);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith(3);
        vi.useRealTimers();
    });
});

describe('isWithinBounds (geolocation service-area gate)', () => {
    const B = CONFIG.CITY_BOUNDS;

    it('accepts locations inside Montevideo', () => {
        expect(isWithinBounds(-34.9055, -56.187, B)).toBe(true); // 18 de Julio y Ejido
        expect(isWithinBounds(-34.7167, -56.2, B)).toBe(true); // northern stops edge
        expect(isWithinBounds(-34.9271, -56.16, B)).toBe(true); // southern stops edge
    });

    it('rejects locations outside the service area', () => {
        expect(isWithinBounds(-34.6037, -58.3816, B)).toBe(false); // Buenos Aires
        expect(isWithinBounds(-34.9608, -54.9433, B)).toBe(false); // Punta del Este
        expect(isWithinBounds(55.7558, 37.6173, B)).toBe(false); // Moscow
        expect(isWithinBounds(-34.65, -56.2, B)).toBe(false); // just north of the buffer
    });

    it('treats the buffered box edges as inclusive', () => {
        expect(isWithinBounds(B.south, B.west, B)).toBe(true);
        expect(isWithinBounds(B.north, B.east, B)).toBe(true);
        expect(isWithinBounds(B.south - 1e-6, B.west, B)).toBe(false);
        expect(isWithinBounds(B.north, B.east + 1e-6, B)).toBe(false);
    });

    it('the bounds actually contain every stop in the committed data', () => {
        // Guards the config against data updates that widen the network.
        // (Read lazily to keep this file otherwise synthetic.)
        return import('node:fs').then(({ readFileSync }) => {
            const stops = JSON.parse(
                readFileSync(new URL('../../stops.json', import.meta.url), 'utf8'),
            );
            for (const f of stops.features) {
                const [lon, lat] = f.geometry.coordinates;
                expect(
                    isWithinBounds(lat, lon, B),
                    `stop ${f.properties.COD_UBIC_P} outside CITY_BOUNDS`,
                ).toBe(true);
            }
        });
    });
});
