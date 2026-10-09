/**
 * Line color assignment (brainstorm-004, V2).
 *
 * Builds the co-location conflict graph from stops.json (data contract v2),
 * generates a perceptually-spread candidate palette in OKLab (one dark-theme
 * and one light-theme variant per slot, same hue identity), and assigns a
 * unique slot to every line maximizing the minimum pairwise ΔE(OKLab) within
 * every stop's line set — with the CI gate floors (DELTA_E_FLOORS) as hard
 * constraints, searched by iterated local search with a fixed seed.
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

/**
 * Hard per-clique floors: the values the CI gate (CLIQUE_GATES in
 * tests/js/line-colors.test.js) pins just under the committed palette's
 * minima. The search satisfies these FIRST and only then maximizes the
 * ΔE/target ratio — a ratio-only search settled 0.0005 under the 2-line gate
 * on the 2026-10-09 data while a gate-clearing palette existed. The test
 * asserts these never sit under its gates.
 */
export const DELTA_E_FLOORS = [
    { maxClique: 2, floor: 0.14 },
    { maxClique: 5, floor: 0.08 },
    { maxClique: 10, floor: 0.058 },
    { maxClique: Infinity, floor: 0.042 },
];

/** @param {number} size - clique (stop line-count) @returns {number} ΔE floor */
export const floorForCliqueSize = (size) =>
    DELTA_E_FLOORS.find((b) => size <= b.maxClique).floor;

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

/** OKLab of a shipped #rrggbb color — exactly what the CI gate measures. */
const hexToOklab = (hex) => linearToOklab(hexToLinear(hex));

/** Fixed-seed PRNG (mulberry32): the search may perturb, but two runs must agree. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), a | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Local-search budget. A climb converges within tens of moves; the kicks are
// what leave the first local optimum, where a from-scratch run used to stop.
const NEAR = 0.05; // ratio units (~5% of a met target)
const EPS = 1e-9;
const MAX_CLIMB_MOVES = 5000;
const MAX_KICKS = 300;
const KICK_PATIENCE = 60; // kicks without a new best before giving up
const KICK_LINES = [2, 5]; // lines relocated per kick (inclusive)
const KICK_HOT_SHARE = 0.75; // chance a kicked line is drawn from the hot set
const KICK_SEED = 0x5eed;

/**
 * Assigns a unique candidate slot to every line.
 *
 * Objective, compared lexicographically over the co-located pairs with at
 * least one movable end: (1) the gate floors (DELTA_E_FLOORS) — the worst
 * pair's ΔE/floor up to 1, then fewer pairs under their floor; (2) the minimum
 * ΔE/target ratio; (3) fewer pairs near that minimum. Greedy construction, a
 * first-improvement climb (move a line to a free slot, or swap two movable
 * lines), then kick-and-climb rounds that keep the best palette seen.
 *
 * Deterministic: kicks draw from a fixed-seed PRNG; ties break by candidate
 * order and line sort.
 * Incremental: lines present in `existing` keep their colors untouched; their
 * slots are located by hex match (or reserved as opaque colors if the palette
 * definition changed) and only missing lines are assigned or moved.
 *
 * @param {{ lines: string[], neighbors: Map<string, Set<string>>,
 *   pairMinClique: Map<string, number> }} graph
 * @param {Record<string, {dark: string, light: string}>} existing
 * @returns {{ colors: Record<string, {dark: string, light: string}>, added: string[] }}
 */
export function assignColors(graph, existing = {}) {
    const candidates = buildCandidates();
    const C = candidates.length;
    const byHexPair = new Map(candidates.map((c, s) => [`${c.dark}|${c.light}`, s]));

    // Slots 0..C-1 are the candidates; a legacy color off the grid gets an
    // opaque slot of its own after them (never handed to another line).
    const slots = candidates.map(({ dark, light }) => ({ dark, light }));
    /** line -> slot index */
    const slotOf = new Map();
    for (const [line, pair] of Object.entries(existing)) {
        let s = byHexPair.get(`${pair.dark}|${pair.light}`);
        if (s === undefined) {
            s = slots.length;
            slots.push({ dark: pair.dark, light: pair.light });
        }
        slotOf.set(line, s);
    }
    const toColors = () => {
        const colors = {};
        for (const line of [...slotOf.keys()].sort()) {
            const { dark, light } = slots[slotOf.get(line)];
            colors[line] = { dark, light };
        }
        return colors;
    };

    const missing = graph.lines.filter((l) => !slotOf.has(l));
    if (missing.length === 0) return { colors: toColors(), added: missing };
    // Hardest first: highest conflict degree, then lexicographic for determinism.
    missing.sort(
        (a, b) =>
            (graph.neighbors.get(b)?.size ?? 0) - (graph.neighbors.get(a)?.size ?? 0) ||
            (a < b ? -1 : 1),
    );

    // ΔE between two slots = the worse of the two theme variants, measured on
    // the 8-bit hex that ships: the unquantized OKLCH point can sit a few
    // thousandths of ΔE away — the whole margin of a pair parked at a gate.
    const S = slots.length;
    const labs = slots.map(({ dark, light }) => [hexToOklab(dark), hexToOklab(light)]);
    const dist = new Float64Array(S * S);
    for (let i = 0; i < S; i++) {
        for (let j = i + 1; j < S; j++) {
            const d = Math.min(deltaE(labs[i][0], labs[j][0]), deltaE(labs[i][1], labs[j][1]));
            dist[i * S + j] = d;
            dist[j * S + i] = d;
        }
    }
    const used = new Uint8Array(S);
    for (const s of slotOf.values()) used[s] = 1;

    // All scores are RATIOS ΔE/target, where the target scales with the
    // smallest stop clique the pair shares (DELTA_E_TARGETS): a pair alone at
    // a 2-line stop must be far more distinct than a pair inside a 41-line
    // bundle. Maximizing the minimum ratio spends the color budget where the
    // rider actually compares few routes side by side.
    const cliqueOf = (a, b) => graph.pairMinClique.get(pairKey(a, b)) ?? Infinity;

    const scoreFor = (line, s) => {
        let minNeighbor = Infinity;
        for (const n of graph.neighbors.get(line) ?? []) {
            const t = slotOf.get(n);
            if (t === undefined) continue;
            minNeighbor = Math.min(
                minNeighbor,
                dist[s * S + t] / targetForCliqueSize(cliqueOf(line, n)),
            );
        }
        if (minNeighbor !== Infinity) return minNeighbor;
        // No colored neighbor yet: spread globally instead.
        let minAny = Infinity;
        for (const t of slotOf.values()) minAny = Math.min(minAny, dist[s * S + t]);
        return minAny === Infinity ? 1 : minAny;
    };

    for (const line of missing) {
        let best = -1;
        let bestScore = -1;
        for (let s = 0; s < C; s++) {
            if (used[s]) continue;
            const score = scoreFor(line, s);
            if (score > bestScore) {
                bestScore = score;
                best = s;
            }
        }
        if (best < 0) throw new Error(`palette exhausted at line ${line}`);
        slotOf.set(line, best);
        used[best] = 1;
    }

    // Local search over the movable lines only (never disturbs `existing`).
    // Lines become indices, the movable ones first (0..M-1).
    const movable = new Set(missing);
    const order = [...missing, ...[...slotOf.keys()].filter((l) => !movable.has(l))];
    const index = new Map(order.map((l, i) => [l, i]));
    const M = missing.length;
    const slot = Int32Array.from(order, (l) => slotOf.get(l));

    // Active pairs: at least one movable end. A pair of two fixed lines is a
    // constant, and scoring it would only mask the moves that matter.
    const pairA = [];
    const pairB = [];
    const invTarget = [];
    const floorOf = [];
    const incident = Array.from({ length: M }, () => []);
    for (const [line, ns] of graph.neighbors) {
        for (const n of ns) {
            if (!(line < n) || (!movable.has(line) && !movable.has(n))) continue;
            const p = pairA.length;
            const a = index.get(line);
            const b = index.get(n);
            const size = cliqueOf(line, n);
            pairA.push(a);
            pairB.push(b);
            invTarget.push(1 / targetForCliqueSize(size));
            floorOf.push(floorForCliqueSize(size));
            if (a < M) incident[a].push(p);
            if (b < M) incident[b].push(p);
        }
    }
    const P = pairA.length;
    const pd = new Float64Array(P); // current ΔE per active pair
    const refresh = (p) => {
        pd[p] = dist[slot[pairA[p]] * S + slot[pairB[p]]];
    };
    const place = (i, s) => {
        slot[i] = s;
        for (const p of incident[i]) refresh(p);
    };
    for (let p = 0; p < P; p++) refresh(p);

    // The objective is GLOBAL. Per-line greedy scores are deliberately not
    // used here — improving one line locally can degrade a neighbor's worst.
    const evaluate = () => {
        let minFloor = Infinity;
        let under = 0;
        let min = Infinity;
        for (let p = 0; p < P; p++) {
            const d = pd[p];
            if (d < floorOf[p]) under++;
            minFloor = Math.min(minFloor, d / floorOf[p]);
            min = Math.min(min, d * invTarget[p]);
        }
        let ties = 0;
        for (let p = 0; p < P; p++) if (pd[p] * invTarget[p] < min + NEAR) ties++;
        return { gate: Math.min(1, minFloor), under, min, ties };
    };
    const better = (e1, e2) => {
        if (Math.abs(e1.gate - e2.gate) > EPS) return e1.gate > e2.gate;
        if (e1.under !== e2.under) return e1.under < e2.under;
        if (Math.abs(e1.min - e2.min) > EPS) return e1.min > e2.min;
        return e1.ties < e2.ties;
    };
    /** Movable lines in a pair under its floor or near the minimum ratio. */
    const hotLines = (e) => {
        const hot = new Set();
        for (let p = 0; p < P; p++) {
            if (pd[p] >= floorOf[p] && pd[p] * invTarget[p] >= e.min + NEAR) continue;
            if (pairA[p] < M) hot.add(pairA[p]);
            if (pairB[p] < M) hot.add(pairB[p]);
        }
        return [...hot];
    };

    // A trial move is scored from the pairs it touches alone: the untouched
    // pairs' minima and near-minimum count come from a snapshot of the current
    // palette, sorted once per sweep — O(touched + log P) per trial instead of
    // O(P), with the very same arithmetic as evaluate().
    const baseD = new Float64Array(P);
    const byRatio = new Int32Array(P); // pairs by ΔE/target, ascending
    const byFloor = new Int32Array(P); // pairs by ΔE/floor, ascending
    const sortedRatio = new Float64Array(P);
    const ratio = new Float64Array(P);
    const floorRatio = new Float64Array(P);
    const seen = new Int32Array(P); // per-trial stamp: a swap's shared pair counts once
    const touched = [];
    let stamp = 0;
    let baseUnder = 0;
    const snapshot = () => {
        baseD.set(pd);
        baseUnder = 0;
        for (let p = 0; p < P; p++) {
            ratio[p] = pd[p] * invTarget[p];
            floorRatio[p] = pd[p] / floorOf[p];
            if (pd[p] < floorOf[p]) baseUnder++;
            byRatio[p] = p;
            byFloor[p] = p;
        }
        byRatio.sort((p, q) => ratio[p] - ratio[q]);
        byFloor.sort((p, q) => floorRatio[p] - floorRatio[q]);
        for (let k = 0; k < P; k++) sortedRatio[k] = ratio[byRatio[k]];
    };
    /** Number of snapshot ratios strictly under x. */
    const countUnder = (x) => {
        let lo = 0;
        let hi = P;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sortedRatio[mid] < x) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };
    /** evaluate() for the current trial, given the lines it moved since snapshot(). */
    const evaluateMove = (i, j = -1) => {
        stamp++;
        touched.length = 0;
        for (const line of j < 0 ? [i] : [i, j]) {
            for (const p of incident[line]) {
                if (seen[p] === stamp) continue;
                seen[p] = stamp;
                touched.push(p);
            }
        }
        let minFloor = Infinity;
        let under = baseUnder;
        let min = Infinity;
        for (const p of touched) {
            const d = pd[p];
            if (baseD[p] < floorOf[p]) under--;
            if (d < floorOf[p]) under++;
            minFloor = Math.min(minFloor, d / floorOf[p]);
            min = Math.min(min, d * invTarget[p]);
        }
        let k = 0;
        while (k < P && seen[byRatio[k]] === stamp) k++;
        if (k < P) min = Math.min(min, ratio[byRatio[k]]);
        k = 0;
        while (k < P && seen[byFloor[k]] === stamp) k++;
        if (k < P) minFloor = Math.min(minFloor, floorRatio[byFloor[k]]);
        const band = min + NEAR;
        let ties = countUnder(band);
        for (const p of touched) {
            if (ratio[p] < band) ties--;
            if (pd[p] * invTarget[p] < band) ties++;
        }
        return { gate: Math.min(1, minFloor), under, min, ties };
    };

    // First-improvement climb: move a hot line to a free candidate, or swap it
    // with another movable line, while either beats the current palette.
    const climb = (start) => {
        let cur = start;
        for (let moves = 0; moves < MAX_CLIMB_MOVES; moves++) {
            snapshot();
            let improved = false;
            outer: for (const i of hotLines(cur)) {
                const prev = slot[i];
                used[prev] = 0;
                for (let s = 0; s < C; s++) {
                    if (used[s] || s === prev) continue;
                    place(i, s);
                    const e = evaluateMove(i);
                    if (better(e, cur)) {
                        used[s] = 1;
                        cur = e;
                        improved = true;
                        break outer;
                    }
                }
                place(i, prev);
                used[prev] = 1;
                for (let j = 0; j < M; j++) {
                    if (j === i) continue;
                    const other = slot[j];
                    place(i, other);
                    place(j, prev);
                    const e = evaluateMove(i, j);
                    if (better(e, cur)) {
                        cur = e;
                        improved = true;
                        break outer;
                    }
                    place(j, other);
                    place(i, prev);
                }
            }
            if (!improved) break;
        }
        return cur;
    };

    // Iterated local search: kick a few lines (mostly hot ones) to random free
    // slots, climb again, and keep the result only if it beats the best seen.
    let bestEval = climb(evaluate());
    let best = slot.slice(0, M);
    const restoreBest = () => {
        for (let i = 0; i < M; i++) used[slot[i]] = 0;
        for (let i = 0; i < M; i++) {
            slot[i] = best[i];
            used[best[i]] = 1;
        }
        for (let p = 0; p < P; p++) refresh(p);
    };
    const rng = mulberry32(KICK_SEED);
    const randomInt = (n) => Math.floor(rng() * n);
    let free = 0;
    for (let s = 0; s < C; s++) if (!used[s]) free++;
    for (let kick = 0, stale = 0; P > 0 && kick < MAX_KICKS && stale < KICK_PATIENCE; kick++) {
        const hot = hotLines(bestEval);
        const count = KICK_LINES[0] + randomInt(KICK_LINES[1] - KICK_LINES[0] + 1);
        for (let k = 0; k < count; k++) {
            const i =
                hot.length > 0 && rng() < KICK_HOT_SHARE ? hot[randomInt(hot.length)] : randomInt(M);
            if (free > 0) {
                let s = randomInt(C);
                while (used[s]) s = randomInt(C);
                used[slot[i]] = 0;
                used[s] = 1;
                place(i, s);
            } else {
                const j = randomInt(M);
                const si = slot[i];
                place(i, slot[j]);
                place(j, si);
            }
        }
        const e = climb(evaluate());
        if (better(e, bestEval)) {
            bestEval = e;
            best = slot.slice(0, M);
            stale = 0;
        } else {
            restoreBest();
            stale++;
        }
    }
    restoreBest();

    for (let i = 0; i < M; i++) slotOf.set(order[i], slot[i]);
    return { colors: toColors(), added: missing };
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
    linesOut.push('assignment over the stop co-location conflict graph + iterated local');
    linesOut.push('search (fixed seed), with the CI gate floors as hard constraints.');
    linesOut.push('ΔE = Euclidean OKLab on the shipped hex. Estimate class: measured on');
    linesOut.push('committed data.');
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
