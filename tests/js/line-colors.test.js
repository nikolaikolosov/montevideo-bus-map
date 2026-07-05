/**
 * Color compatibility gates for the committed line palette (brainstorm-004).
 *
 * Runs against the REAL committed data (stops.json) and the REAL committed
 * palette (src/line-colors.js), like route-invariants.test.js: a data update
 * that breaks a color property fails here, before anything ships.
 *
 * Gates:
 *  1. Coverage/stability — every line in the data has a palette entry
 *     (missing entry = someone added routes without running the assign
 *     script; the fix is `npm run assign:colors`, which never recolors
 *     existing lines).
 *  2. Uniqueness — every line's color is unique, per theme.
 *  3. In-clique distinguishability — for every stop, every pair of lines
 *     serving it keeps ΔE(OKLab) ≥ MIN_CLIQUE_DELTA_E in both themes. This is
 *     the user-visible guarantee (no "light yellow next to yellow").
 *  4. Basemap contrast — every color keeps ≥3:1 WCAG contrast against its
 *     theme's basemap proxy.
 *  5. Incremental assignment never mutates existing entries (property test on
 *     the assigner itself).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { LINE_COLORS } from '../../src/line-colors.js';
import {
    buildConflictGraph,
    assignColors,
    deltaE,
    hexToLinear,
    linearToOklab,
    contrastRatio,
    worstInCliqueDeltaE,
} from '../../scripts/assign_line_colors.mjs';

// Pinned just under the measured minimum of the committed palette
// (0.0567 light / 0.0590 dark, see qa/reports/line-colors-report.md) with
// headroom for future incremental additions. OKLab JND ≈ 0.02: the gate
// keeps every co-located pair ≥ ~2.5× JND. If a new line cannot clear this
// inside its cliques, the palette needs a reviewed --regenerate-all, not a
// silently lower bar.
const MIN_CLIQUE_DELTA_E = 0.05;
const MIN_BASEMAP_CONTRAST = 3;
const BASEMAP_PROXY = { dark: '#0f172a', light: '#f1f5f9' };
const THEMES = ['dark', 'light'];

const stopsJson = JSON.parse(readFileSync(new URL('../../stops.json', import.meta.url), 'utf8'));
const graph = buildConflictGraph(stopsJson);

describe('palette coverage & stability', () => {
    it('every line in the data has a committed palette entry', () => {
        const missing = graph.lines.filter((l) => !LINE_COLORS[l]);
        expect(
            missing,
            `lines without a palette entry: ${missing.join(', ')} — run \`npm run assign:colors\` and commit src/line-colors.js`,
        ).toEqual([]);
    });

    it('entries are well-formed hex pairs', () => {
        for (const [line, pair] of Object.entries(LINE_COLORS)) {
            expect(pair.dark, line).toMatch(/^#[0-9a-f]{6}$/);
            expect(pair.light, line).toMatch(/^#[0-9a-f]{6}$/);
        }
    });
});

describe('uniqueness', () => {
    it.each(THEMES)('all %s-theme colors are unique', (theme) => {
        const seen = new Map();
        for (const [line, pair] of Object.entries(LINE_COLORS)) {
            const prev = seen.get(pair[theme]);
            expect(prev, `${line} and ${prev} share ${pair[theme]}`).toBeUndefined();
            seen.set(pair[theme], line);
        }
    });
});

describe('in-clique distinguishability (the core gate)', () => {
    it.each(THEMES)('every stop keeps pairwise dE(OKLab) >= threshold in %s theme', (theme) => {
        const worst = worstInCliqueDeltaE(LINE_COLORS, graph.stopLines, theme);
        expect(worst).not.toBeNull();
        expect(
            worst.minDeltaE,
            `stop ${worst.stop}: ${worst.pair.join(' vs ')} too close in ${theme}`,
        ).toBeGreaterThanOrEqual(MIN_CLIQUE_DELTA_E);
    });

    it('the user-reported failure class is gone: worst pair is far above the old scheme', () => {
        // Old hash-hue scheme measured 96 co-located pairs under 5° hue
        // (ΔE ≈ 0.00–0.01); the committed palette's worst pair must be at
        // least an order of magnitude away from "visually identical".
        for (const theme of THEMES) {
            const worst = worstInCliqueDeltaE(LINE_COLORS, graph.stopLines, theme);
            expect(worst.minDeltaE).toBeGreaterThan(0.02); // > 1 JND, absolute floor
        }
    });
});

describe('basemap contrast', () => {
    it.each(THEMES)('every %s-theme color keeps >=3:1 vs the basemap', (theme) => {
        const bg = hexToLinear(BASEMAP_PROXY[theme]);
        for (const [line, pair] of Object.entries(LINE_COLORS)) {
            const ratio = contrastRatio(hexToLinear(pair[theme]), bg);
            expect(ratio, `${line} ${pair[theme]} on ${theme} basemap`).toBeGreaterThanOrEqual(
                MIN_BASEMAP_CONTRAST,
            );
        }
    });
});

describe('incremental assignment (data-update safety)', () => {
    it('assigning with the committed map as existing changes nothing', () => {
        const { colors, added } = assignColors(graph, LINE_COLORS);
        expect(added).toEqual([]);
        expect(colors).toEqual(LINE_COLORS);
    });

    it('new synthetic lines get colors without touching existing entries', () => {
        // Clone the graph and wire two fake lines through the busiest stop set.
        const neighbors = new Map([...graph.neighbors].map(([k, v]) => [k, new Set(v)]));
        const stopLines = new Map([...graph.stopLines].map(([k, v]) => [k, new Set(v)]));
        const busiest = [...stopLines.entries()].sort((a, b) => b[1].size - a[1].size)[0];
        for (const fake of ['TEST-A', 'TEST-B']) {
            neighbors.set(fake, new Set(busiest[1]));
            for (const l of busiest[1]) neighbors.get(l).add(fake);
            busiest[1].add(fake);
        }
        const lines = [...neighbors.keys()].sort();

        const { colors, added } = assignColors({ lines, neighbors, stopLines }, LINE_COLORS);

        expect(added.sort()).toEqual(['TEST-A', 'TEST-B']);
        for (const [line, pair] of Object.entries(LINE_COLORS)) {
            expect(colors[line], `existing line ${line} was recolored`).toEqual(pair);
        }
        // Forcing two extra lines through the network's single busiest stop
        // (41 → 43 lines) is the worst possible data update; the incremental
        // assigner may land slightly under the committed-palette gate there.
        // It must still stay far above "visually identical" — and if a REAL
        // update ever drops below MIN_CLIQUE_DELTA_E, the core gate above
        // fails and forces a reviewed --regenerate-all.
        for (const theme of THEMES) {
            const worst = worstInCliqueDeltaE(colors, stopLines, theme);
            expect(worst.minDeltaE).toBeGreaterThanOrEqual(MIN_CLIQUE_DELTA_E * 0.9);
        }
    });

    it('deltaE is a sane metric (sanity anchor)', () => {
        const black = linearToOklab(hexToLinear('#000000'));
        const white = linearToOklab(hexToLinear('#ffffff'));
        expect(deltaE(black, black)).toBe(0);
        expect(deltaE(black, white)).toBeCloseTo(1, 1);
    });
});
