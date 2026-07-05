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

// Per-clique-size gates (user report 2026-07-05: lines 17 and 137 — both
// reds — alone at stop 4563; two routes compared side by side must be
// unmistakably different). Keyed by the SMALLEST stop clique a pair shares;
// pinned just under the measured minima of the committed palette
// (see qa/reports/line-colors-report.md; OKLab JND ≈ 0.02). If new data
// cannot clear a gate, the palette needs a reviewed --regenerate-all,
// not a silently lower bar.
const CLIQUE_GATES = [
    { maxClique: 2, minDeltaE: 0.14 }, // measured 0.1654 / 0.1481
    { maxClique: 5, minDeltaE: 0.08 }, // measured 0.0966 / 0.0867
    { maxClique: 10, minDeltaE: 0.058 }, // measured 0.0648 / 0.0620
    { maxClique: Infinity, minDeltaE: 0.042 }, // measured 0.0480 / 0.0455
];
const gateFor = (size) => CLIQUE_GATES.find((g) => size <= g.maxClique).minDeltaE;
const MIN_BASEMAP_CONTRAST = 3;
const BASEMAP_PROXY = { dark: '#0f172a', light: '#f1f5f9' };
const THEMES = ['dark', 'light'];

const stopsJson = JSON.parse(readFileSync(new URL('../../stops.json', import.meta.url), 'utf8'));
const graph = buildConflictGraph(stopsJson);

/**
 * Independent oracle: smallest clique per co-located pair, recomputed from
 * stops.json without going through the script's graph fields.
 */
function computePairMinClique() {
    const byStop = new Map();
    for (const p of Object.values(stopsJson.patterns)) {
        for (const [cod] of p.paradas) {
            if (!byStop.has(cod)) byStop.set(cod, new Set());
            byStop.get(cod).add(String(p.linea));
        }
    }
    const out = new Map();
    for (const set of byStop.values()) {
        const arr = [...set];
        for (let i = 0; i < arr.length; i++) {
            for (let j = i + 1; j < arr.length; j++) {
                const k = [arr[i], arr[j]].sort().join('|');
                out.set(k, Math.min(out.get(k) ?? Infinity, set.size));
            }
        }
    }
    return out;
}
const pairMinClique = computePairMinClique();

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
    it.each(THEMES)(
        'every co-located pair clears the gate of its smallest clique (%s theme)',
        (theme) => {
            const lab = new Map(
                Object.entries(LINE_COLORS).map(([l, p]) => [
                    l,
                    linearToOklab(hexToLinear(p[theme])),
                ]),
            );
            for (const [key, size] of pairMinClique) {
                const [a, b] = key.split('|');
                const d = deltaE(lab.get(a), lab.get(b));
                expect(
                    d,
                    `${a} vs ${b} (smallest shared stop: ${size} lines) too close in ${theme}`,
                ).toBeGreaterThanOrEqual(gateFor(size));
            }
        },
    );

    it('the reported cases stay far apart: 17|137 and 145|149 (2-line stops)', () => {
        for (const theme of THEMES) {
            for (const [a, b] of [
                ['17', '137'],
                ['145', '149'],
            ]) {
                const d = deltaE(
                    linearToOklab(hexToLinear(LINE_COLORS[a][theme])),
                    linearToOklab(hexToLinear(LINE_COLORS[b][theme])),
                );
                expect(d, `${a} vs ${b} in ${theme}`).toBeGreaterThanOrEqual(gateFor(2));
            }
        }
    });

    it('the original failure class is gone: worst pair is far above the old scheme', () => {
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
        const pmc = new Map(graph.pairMinClique);
        const busiest = [...stopLines.entries()].sort((a, b) => b[1].size - a[1].size)[0];
        for (const fake of ['TEST-A', 'TEST-B']) {
            neighbors.set(fake, new Set(busiest[1]));
            for (const l of busiest[1]) {
                neighbors.get(l).add(fake);
                pmc.set([fake, l].sort().join('|'), busiest[1].size + 2);
            }
            busiest[1].add(fake);
        }
        const lines = [...neighbors.keys()].sort();

        const { colors, added } = assignColors(
            { lines, neighbors, stopLines, pairMinClique: pmc },
            LINE_COLORS,
        );

        expect(added.sort()).toEqual(['TEST-A', 'TEST-B']);
        for (const [line, pair] of Object.entries(LINE_COLORS)) {
            expect(colors[line], `existing line ${line} was recolored`).toEqual(pair);
        }
        // Forcing two extra lines through the network's single busiest stop
        // (41 → 43 lines) is the worst possible data update; the incremental
        // assigner may land slightly under the committed-palette gate there.
        // It must still stay far above "visually identical" — and if a REAL
        // update ever drops below a clique gate, the core gate above fails
        // and forces a reviewed --regenerate-all.
        for (const theme of THEMES) {
            const worst = worstInCliqueDeltaE(colors, stopLines, theme);
            expect(worst.minDeltaE).toBeGreaterThanOrEqual(gateFor(Infinity) * 0.9);
        }
    });

    it('deltaE is a sane metric (sanity anchor)', () => {
        const black = linearToOklab(hexToLinear('#000000'));
        const white = linearToOklab(hexToLinear('#ffffff'));
        expect(deltaE(black, black)).toBe(0);
        expect(deltaE(black, white)).toBeCloseTo(1, 1);
    });
});
