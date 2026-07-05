/**
 * Line color assignment (brainstorm-004, V2).
 *
 * Builds the co-location conflict graph from stops.json (data contract v2),
 * generates a perceptually-spread candidate palette in OKLab (one dark-theme
 * and one light-theme variant per slot, same hue identity), and assigns a
 * unique slot to every line maximizing the minimum pairwise ΔE(OKLab) within
 * every stop's line set.
 *
 * Stability contract: by default the run is INCREMENTAL — entries already in
 * src/line-colors.js are kept verbatim and only lines missing from the map
 * get new slots. `--regenerate-all` rebuilds from scratch (deliberate palette
 * redesign: review scene diffs + regenerate the golden manifest afterwards).
 *
 * Usage:
 *   node scripts/assign_line_colors.mjs                  # incremental
 *   node scripts/assign_line_colors.mjs --regenerate-all # full rebuild
 *
 * Outputs:
 *   src/line-colors.js              generated runtime module (committed)
 *   qa/reports/line-colors-report.md  achieved ΔE metrics + CVD report (committed)
 *
 * The exported functions are unit-tested in tests/js/line-colors.test.js.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Color math — sRGB ↔ OKLab (Björn Ottosson's reference constants), WCAG
// relative luminance, and dichromacy simulation (Viénot–Brettel–Mollon 1999).
// ---------------------------------------------------------------------------

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** @param {string} hex - #rrggbb @returns {[number,number,number]} linear RGB */
export function hexToLinear(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [
        srgbToLinear(((n >> 16) & 255) / 255),
        srgbToLinear(((n >> 8) & 255) / 255),
        srgbToLinear((n & 255) / 255),
    ];
}

/** @param {[number,number,number]} rgb linear @returns {string} #rrggbb (clamped) */
export function linearToHex([r, g, b]) {
    const to255 = (c) => Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255);
    return '#' + [r, g, b].map((c) => to255(c).toString(16).padStart(2, '0')).join('');
}

/** @param {[number,number,number]} rgb linear @returns {[number,number,number]} OKLab */
export function linearToOklab([r, g, b]) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
}

/** @param {[number,number,number]} lab OKLab @returns {[number,number,number]} linear RGB (may be out of gamut) */
export function oklabToLinear([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
}

/** OKLCH (L, C, hue°) → OKLab */
export const oklchToOklab = (L, C, h) => [
    L,
    C * Math.cos((h * Math.PI) / 180),
    C * Math.sin((h * Math.PI) / 180),
];

/** Euclidean distance in OKLab — the ΔE used everywhere in this feature. */
export const deltaE = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);

/** WCAG relative luminance from linear RGB. */
const relLuminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** WCAG contrast ratio between two linear-RGB colors. */
export function contrastRatio(rgb1, rgb2) {
    const y1 = relLuminance(rgb1);
    const y2 = relLuminance(rgb2);
    const [hi, lo] = y1 >= y2 ? [y1, y2] : [y2, y1];
    return (hi + 0.05) / (lo + 0.05);
}

// Dichromacy simulation in linear RGB (Viénot, Brettel & Mollon 1999).
const CVD_MATRICES = {
    protanopia: [
        [0.152286, 1.052583, -0.204868],
        [0.114503, 0.786281, 0.099216],
        [-0.003882, -0.048116, 1.051998],
    ],
    deuteranopia: [
        [0.367322, 0.860646, -0.227968],
        [0.280085, 0.672501, 0.047413],
        [-0.01182, 0.04294, 0.968881],
    ],
};

/** @returns {[number,number,number]} simulated linear RGB */
export function simulateCvd(rgb, kind) {
    const m = CVD_MATRICES[kind];
    return m.map((row) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
}

// ---------------------------------------------------------------------------
// Conflict graph from data contract v2
// ---------------------------------------------------------------------------

/**
 * Per-pair ΔE targets, scaled by the SMALLEST stop clique the pair shares.
 * At a 2-line stop the rider compares exactly two routes side by side — they
 * must be unmistakably different (user report: 17 vs 137, both reds, at stop
 * 4563). Inside a 41-line clique the same demand is geometrically impossible,
 * so the target relaxes with clique size down to the structural floor.
 */
export const DELTA_E_TARGETS = [
    { maxClique: 2, target: 0.2 },
    { maxClique: 5, target: 0.12 },
    { maxClique: 10, target: 0.08 },
    { maxClique: Infinity, target: 0.06 },
];

/** @param {number} size - clique (stop line-count) @returns {number} ΔE target */
export const targetForCliqueSize = (size) =>
    DELTA_E_TARGETS.find((b) => size <= b.maxClique).target;

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * @param {object} stopsJson - parsed stops.json (v2: `patterns` foreign member)
 * @returns {{ lines: string[], neighbors: Map<string, Set<string>>,
 *   stopLines: Map<number, Set<string>>, pairMinClique: Map<string, number> }}
 */
export function buildConflictGraph(stopsJson) {
    const stopLines = new Map();
    for (const p of Object.values(stopsJson.patterns)) {
        for (const [cod] of p.paradas) {
            if (!stopLines.has(cod)) stopLines.set(cod, new Set());
            stopLines.get(cod).add(String(p.linea));
        }
    }
    const neighbors = new Map();
    const pairMinClique = new Map();
    for (const set of stopLines.values()) {
        const arr = [...set];
        for (const a of arr) {
            if (!neighbors.has(a)) neighbors.set(a, new Set());
            for (const b of arr) if (b !== a) neighbors.get(a).add(b);
        }
        for (let i = 0; i < arr.length; i++) {
            for (let j = i + 1; j < arr.length; j++) {
                const k = pairKey(arr[i], arr[j]);
                pairMinClique.set(k, Math.min(pairMinClique.get(k) ?? Infinity, set.size));
            }
        }
    }
    const lines = [...neighbors.keys()].sort();
    return { lines, neighbors, stopLines, pairMinClique };
}

// ---------------------------------------------------------------------------
// Candidate palette
// ---------------------------------------------------------------------------

// Per-theme (lightness, chroma) rings. Hue is the line's identity and is
// shared between themes; the light-theme variant is darker so it clears 3:1
// against the light basemap, the dark-theme variant lighter for the dark one.
const RINGS = [
    { dark: { L: 0.6, C: 0.2 }, light: { L: 0.4, C: 0.16 } },
    { dark: { L: 0.69, C: 0.17 }, light: { L: 0.475, C: 0.15 } },
    { dark: { L: 0.78, C: 0.14 }, light: { L: 0.55, C: 0.13 } },
    { dark: { L: 0.87, C: 0.11 }, light: { L: 0.625, C: 0.11 } },
];
const HUE_STEP = 3; // 120 hues × 4 rings = 480 raw candidates before pruning
const BG = { dark: hexToLinear('#0f172a'), light: hexToLinear('#f1f5f9') };
const MIN_CONTRAST = 3; // WCAG non-text minimum vs the theme basemap proxy

/** True if OKLab color converts to in-gamut sRGB (small tolerance). */
function inGamut(lab) {
    return oklabToLinear(lab).every((c) => c >= -0.005 && c <= 1.005);
}

/** Largest chroma ≤ target that stays inside sRGB at this L and hue. */
function clampChroma(L, targetC, hue) {
    if (inGamut(oklchToOklab(L, targetC, hue))) return targetC;
    let lo = 0;
    let hi = targetC;
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(oklchToOklab(L, mid, hue))) lo = mid;
        else hi = mid;
    }
    return lo * 0.97; // small safety margin off the gamut boundary
}

/**
 * Builds the gamut- and contrast-safe candidate slots. Chroma is clamped to
 * the sRGB gamut per (L, hue) instead of dropping the slot, so every hue
 * contributes candidates in all rings; contrast still prunes hard failures.
 * @returns {Array<{ id: string, hue: number, ring: number,
 *   dark: string, light: string,
 *   labDark: number[], labLight: number[] }>}
 */
export function buildCandidates() {
    const out = [];
    for (let ring = 0; ring < RINGS.length; ring++) {
        for (let hue = 0; hue < 360; hue += HUE_STEP) {
            const { dark, light } = RINGS[ring];
            const labDark = oklchToOklab(dark.L, clampChroma(dark.L, dark.C, hue), hue);
            const labLight = oklchToOklab(light.L, clampChroma(light.L, light.C, hue), hue);
            const rgbDark = oklabToLinear(labDark);
            const rgbLight = oklabToLinear(labLight);
            if (contrastRatio(rgbDark, BG.dark) < MIN_CONTRAST) continue;
            if (contrastRatio(rgbLight, BG.light) < MIN_CONTRAST) continue;
            out.push({
                id: `h${hue}r${ring}`,
                hue,
                ring,
                dark: linearToHex(rgbDark),
                light: linearToHex(rgbLight),
                labDark,
                labLight,
            });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/** ΔE between two slots = the worse of the two theme variants. */
const slotDistance = (s1, s2) =>
    Math.min(deltaE(s1.labDark, s2.labDark), deltaE(s1.labLight, s2.labLight));

/**
 * Assigns a unique candidate slot to every line.
 *
 * Deterministic (no randomness; ties broken by candidate order and line sort).
 * Incremental: lines present in `existing` keep their colors untouched; their
 * slots are located by hex match (or reserved as opaque colors if the palette
 * definition changed) and only missing lines are assigned.
 *
 * @param {{ lines: string[], neighbors: Map<string, Set<string>> }} graph
 * @param {Record<string, {dark: string, light: string}>} existing
 * @returns {{ colors: Record<string, {dark: string, light: string}>, added: string[] }}
 */
export function assignColors(graph, existing = {}) {
    const candidates = buildCandidates();
    const byHexPair = new Map(candidates.map((c) => [`${c.dark}|${c.light}`, c]));

    /** line -> slot (slot = candidate or ad-hoc slot for legacy colors) */
    const slotOf = new Map();
    const used = new Set();

    for (const [line, pair] of Object.entries(existing)) {
        const known = byHexPair.get(`${pair.dark}|${pair.light}`);
        const slot = known ?? {
            id: `legacy:${line}`,
            dark: pair.dark,
            light: pair.light,
            labDark: linearToOklab(hexToLinear(pair.dark)),
            labLight: linearToOklab(hexToLinear(pair.light)),
        };
        slotOf.set(line, slot);
        used.add(slot.id);
    }

    const missing = graph.lines.filter((l) => !slotOf.has(l));
    // Hardest first: highest conflict degree, then lexicographic for determinism.
    missing.sort(
        (a, b) =>
            (graph.neighbors.get(b)?.size ?? 0) - (graph.neighbors.get(a)?.size ?? 0) ||
            (a < b ? -1 : 1),
    );

    // All scores are RATIOS ΔE/target, where the target scales with the
    // smallest stop clique the pair shares (DELTA_E_TARGETS): a pair alone at
    // a 2-line stop must be far more distinct than a pair inside a 41-line
    // bundle. Maximizing the minimum ratio spends the color budget where the
    // rider actually compares few routes side by side.
    const targetFor = (a, b) =>
        targetForCliqueSize(graph.pairMinClique.get(pairKey(a, b)) ?? Infinity);

    const scoreFor = (line, cand) => {
        let minNeighbor = Infinity;
        for (const n of graph.neighbors.get(line) ?? []) {
            const s = slotOf.get(n);
            if (s) minNeighbor = Math.min(minNeighbor, slotDistance(cand, s) / targetFor(line, n));
        }
        if (minNeighbor !== Infinity) return minNeighbor;
        // No colored neighbor yet: spread globally instead.
        let minAny = Infinity;
        for (const s of slotOf.values()) minAny = Math.min(minAny, slotDistance(cand, s));
        return minAny === Infinity ? 1 : minAny;
    };

    for (const line of missing) {
        let best = null;
        let bestScore = -1;
        for (const cand of candidates) {
            if (used.has(cand.id)) continue;
            const score = scoreFor(line, cand);
            if (score > bestScore) {
                bestScore = score;
                best = cand;
            }
        }
        if (!best) throw new Error(`palette exhausted at line ${line}`);
        slotOf.set(line, best);
        used.add(best.id);
    }

    // Local improvement, movable lines only (never disturbs `existing`).
    // Hill-climb on the GLOBAL objective: raise the minimum ΔE/target RATIO
    // over all co-located pairs; tie-break by shrinking the number of pairs
    // sitting near that minimum. Per-line greedy scores are deliberately not
    // used here — improving one line locally can degrade a neighbor's worst.
    const EPS = 1e-9;
    const NEAR = 0.05; // ratio units (~5% of a met target)
    const movable = new Set(missing);
    const pairList = [];
    for (const [line, ns] of graph.neighbors) {
        for (const n of ns) if (line < n) pairList.push([line, n, targetFor(line, n)]);
    }

    const evaluate = () => {
        let min = Infinity;
        for (const [a, b, t] of pairList) {
            const d = slotDistance(slotOf.get(a), slotOf.get(b)) / t;
            if (d < min) min = d;
        }
        let ties = 0;
        for (const [a, b, t] of pairList) {
            if (slotDistance(slotOf.get(a), slotOf.get(b)) / t < min + NEAR) ties++;
        }
        return { min, ties };
    };
    const better = (e1, e2) => e1.min > e2.min + EPS || (e1.min > e2.min - EPS && e1.ties < e2.ties);

    let current = evaluate();
    for (let iter = 0; iter < 160; iter++) {
        // Movable lines involved in pairs near the current minimum.
        const hot = new Set();
        for (const [a, b, t] of pairList) {
            if (slotDistance(slotOf.get(a), slotOf.get(b)) / t < current.min + NEAR) {
                if (movable.has(a)) hot.add(a);
                if (movable.has(b)) hot.add(b);
            }
        }
        let improved = false;
        outer: for (const line of hot) {
            const prev = slotOf.get(line);
            // Try free candidates.
            for (const cand of candidates) {
                if (used.has(cand.id)) continue;
                slotOf.set(line, cand);
                const e = evaluate();
                if (better(e, current)) {
                    used.delete(prev.id);
                    used.add(cand.id);
                    current = e;
                    improved = true;
                    break outer;
                }
                slotOf.set(line, prev);
            }
            // Try swapping with other movable lines.
            for (const other of missing) {
                if (other === line) continue;
                const so = slotOf.get(other);
                slotOf.set(line, so);
                slotOf.set(other, prev);
                const e = evaluate();
                if (better(e, current)) {
                    current = e;
                    improved = true;
                    break outer;
                }
                slotOf.set(line, prev);
                slotOf.set(other, so);
            }
        }
        if (!improved) break;
    }

    const colors = {};
    for (const line of [...slotOf.keys()].sort()) {
        const s = slotOf.get(line);
        colors[line] = { dark: s.dark, light: s.light };
    }
    return { colors, added: missing };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Worst pairwise ΔE within any stop, per theme; optionally under CVD simulation.
 * @returns {{ minDeltaE: number, stop: number, pair: [string, string] } | null} per theme key
 */
export function worstInCliqueDeltaE(colors, stopLines, theme, cvd = null) {
    const lab = new Map();
    for (const [line, pair] of Object.entries(colors)) {
        let rgb = hexToLinear(pair[theme]);
        if (cvd) rgb = simulateCvd(rgb, cvd);
        lab.set(line, linearToOklab(rgb));
    }
    let worst = null;
    for (const [stop, set] of stopLines) {
        const arr = [...set].filter((l) => lab.has(l));
        for (let i = 0; i < arr.length; i++) {
            for (let j = i + 1; j < arr.length; j++) {
                const d = deltaE(lab.get(arr[i]), lab.get(arr[j]));
                if (!worst || d < worst.minDeltaE) {
                    worst = { minDeltaE: d, stop, pair: [arr[i], arr[j]] };
                }
            }
        }
    }
    return worst;
}

/**
 * Worst pairwise ΔE per DELTA_E_TARGETS bucket (pairs bucketed by the
 * smallest stop clique they share).
 * @returns {Map<number, { minDeltaE: number, pair: [string, string] }>} keyed by bucket maxClique
 */
export function worstPerBucket(colors, pairMinClique, theme) {
    const lab = new Map();
    for (const [line, pair] of Object.entries(colors)) {
        lab.set(line, linearToOklab(hexToLinear(pair[theme])));
    }
    const out = new Map();
    for (const [key, size] of pairMinClique) {
        const [a, b] = key.split('|');
        if (!lab.has(a) || !lab.has(b)) continue;
        const bucket = DELTA_E_TARGETS.find((x) => size <= x.maxClique).maxClique;
        const d = deltaE(lab.get(a), lab.get(b));
        const cur = out.get(bucket);
        if (!cur || d < cur.minDeltaE) out.set(bucket, { minDeltaE: d, pair: [a, b] });
    }
    return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const regenerateAll = process.argv.includes('--regenerate-all');

    const stopsJson = JSON.parse(readFileSync(path.join(root, 'stops.json'), 'utf8'));
    const graph = buildConflictGraph(stopsJson);

    let existing = {};
    if (!regenerateAll) {
        try {
            const mod = await import(pathToFileURL(path.join(root, 'src', 'line-colors.js')).href);
            existing = mod.LINE_COLORS;
        } catch {
            // No committed map yet — behaves as a full rebuild.
        }
    }

    const { colors, added } = assignColors(graph, existing);

    const header =
        '/**\n' +
        ' * GENERATED FILE — do not edit by hand.\n' +
        ' * Line → color map (dark/light theme variants), produced by\n' +
        ' *   node scripts/assign_line_colors.mjs\n' +
        ' * Method and metrics: qa/reports/line-colors-report.md (brainstorm-004).\n' +
        ' * Adding/removing lines in the data NEVER recolors existing entries;\n' +
        ' * new lines are appended by re-running the script (CI test enforces).\n' +
        ' */\n\n';
    const body = `export const LINE_COLORS = ${JSON.stringify(colors, null, 4)};\n`;
    writeFileSync(path.join(root, 'src', 'line-colors.js'), header + body);

    const themes = ['dark', 'light'];
    const linesOut = [];
    linesOut.push('# Line color palette — metrics report');
    linesOut.push('');
    linesOut.push(`Generated: ${new Date().toISOString().slice(0, 10)} · ` +
        `mode: ${regenerateAll ? 'regenerate-all' : 'incremental'} · ` +
        `lines: ${Object.keys(colors).length} (new: ${added.length}) · ` +
        `candidates: ${buildCandidates().length}`);
    linesOut.push('');
    linesOut.push('Method: OKLab candidate palette (hue×ring grid, sRGB-gamut and ≥3:1');
    linesOut.push('contrast vs theme basemap proxy #0f172a / #f1f5f9), greedy max-min-ΔE');
    linesOut.push('assignment over the stop co-location conflict graph + local search.');
    linesOut.push('ΔE = Euclidean OKLab. Estimate class: measured on committed data.');
    linesOut.push('');
    linesOut.push('| Metric | dark | light |');
    linesOut.push('|---|---|---|');
    const fmt = (w) => (w ? `${w.minDeltaE.toFixed(4)} (stop ${w.stop}: ${w.pair.join(' vs ')})` : 'n/a');
    const norm = themes.map((t) => worstInCliqueDeltaE(colors, graph.stopLines, t));
    linesOut.push(`| min in-clique ΔE | ${fmt(norm[0])} | ${fmt(norm[1])} |`);
    const bucketLabel = (max, i) => {
        const prev = i === 0 ? 2 : DELTA_E_TARGETS[i - 1].maxClique + 1;
        return max === Infinity ? `${prev}+ lines` : prev === max ? `${max} lines` : `${prev}–${max} lines`;
    };
    DELTA_E_TARGETS.forEach((b, i) => {
        const w = themes.map((t) => worstPerBucket(colors, graph.pairMinClique, t).get(b.maxClique));
        const f = (x) => (x ? `${x.minDeltaE.toFixed(4)} (${x.pair.join(' vs ')})` : 'n/a');
        linesOut.push(
            `| min ΔE, stops with ${bucketLabel(b.maxClique, i)} (target ${b.target}) | ${f(w[0])} | ${f(w[1])} |`,
        );
    });
    for (const cvd of ['deuteranopia', 'protanopia']) {
        const w = themes.map((t) => worstInCliqueDeltaE(colors, graph.stopLines, t, cvd));
        linesOut.push(`| min in-clique ΔE, ${cvd} (report-only) | ${fmt(w[0])} | ${fmt(w[1])} |`);
    }
    linesOut.push('');
    linesOut.push('CVD rows are informational (no gate) per brainstorm-004: a 41-line');
    linesOut.push('clique cannot be made fully dichromacy-safe by color alone; line');
    linesOut.push('number labels and chips remain the non-color channel.');
    linesOut.push('');
    writeFileSync(path.join(root, 'qa', 'reports', 'line-colors-report.md'), linesOut.join('\n'));

    console.log(`lines: ${Object.keys(colors).length}, new: ${added.length}`);
    console.log(`min in-clique dE dark:  ${norm[0]?.minDeltaE.toFixed(4)}`);
    console.log(`min in-clique dE light: ${norm[1]?.minDeltaE.toFixed(4)}`);
}
