import { describe, it, expect, vi } from 'vitest';
import { escapeHTML, cleanCoordinates, truncateLineDownstream, debounce } from '../../src/utils.js';

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

    it('slices from the vertex nearest to the source and snaps it to the source', () => {
        const out = truncateLineDownstream(line, [1.9, 0.1]);
        expect(out).toEqual([
            [1.9, 0.1], // snapped
            [3, 0],
        ]);
    });

    it('returns the whole line when the source is at the start', () => {
        const out = truncateLineDownstream(line, [0, 0]);
        expect(out.length).toBe(4);
        expect(out[0]).toEqual([0, 0]);
    });

    it('snaps only the closest part of a MultiLineString', () => {
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
        const out = truncateLineDownstream(multi, [10.9, 0]);
        // First part: nearest vertex is [1,0] -> slice leaves 1 point -> dropped
        // Second part: sliced from [11,0], first point snapped to the source
        expect(out).toEqual([
            [
                [10.9, 0],
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
