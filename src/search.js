/**
 * Search index over bus lines and stops (design/ux-review-001.md R1).
 * Pure logic — the combobox DOM lives in ui.js; this module is what the
 * unit tests exercise.
 *
 * Matching is diacritics- and case-insensitive ("cibils" finds "AV CIBILS",
 * "penarol" finds "PEÑAROL"). Ranking, best first:
 *   1. line id exact match          ("104" → Línea 104)
 *   2. line id prefix               ("10"  → 100, 103, 104…)
 *   3. stop code exact/prefix       ("4772", numeric queries only)
 *   4. line id substring            ("d1"  → D1, D10, D11)
 *   5. stop name substring          ("buenos aires", "cibils y verdun")
 * Ties keep source order (lines: numeric-aware sort; stops: dataset order).
 */

/** Lowercase + strip combining diacritics (ñ → n deliberately included). */
export const normalize = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * @typedef {{type: 'line', id: string} |
 *           {type: 'stop', code: number, name: string, esquina: string}} SearchEntry
 */

/**
 * Builds the index once after data load.
 * @param {string[]} sortedLines - getSortedLines()
 * @param {object[]} stopFeatures - uniqueStopsData (GeoJSON features)
 */
export function buildSearchIndex(sortedLines, stopFeatures) {
    const lines = sortedLines.map((id) => ({ id, norm: normalize(id) }));
    const stops = stopFeatures.map((f) => {
        const { COD_UBIC_P: code, CALLE = '', ESQUINA = '' } = f.properties;
        return {
            code,
            name: CALLE,
            esquina: ESQUINA,
            codeStr: String(code),
            norm: normalize(`${CALLE} ${ESQUINA}`),
            feature: f,
        };
    });

    /**
     * @param {string} query
     * @param {number} [limit]
     * @returns {SearchEntry[]} ranked matches (see module header)
     */
    const search = (query, limit = 20) => {
        const q = normalize(query.trim());
        if (q.length === 0) return [];

        /** @type {SearchEntry[][]} rank buckets */
        const buckets = [[], [], [], [], []];
        for (const l of lines) {
            if (l.norm === q) buckets[0].push({ type: 'line', id: l.id });
            else if (l.norm.startsWith(q)) buckets[1].push({ type: 'line', id: l.id });
            else if (l.norm.includes(q)) buckets[3].push({ type: 'line', id: l.id });
        }
        const numeric = /^\d+$/.test(q);
        for (const s of stops) {
            if (numeric && s.codeStr.startsWith(q)) {
                buckets[2].push({
                    type: 'stop',
                    code: s.code,
                    name: s.name,
                    esquina: s.esquina,
                });
            } else if (!numeric && s.norm.includes(q)) {
                buckets[4].push({
                    type: 'stop',
                    code: s.code,
                    name: s.name,
                    esquina: s.esquina,
                });
            }
            if (buckets[2].length + buckets[4].length >= limit * 3) break; // plenty
        }
        // Shorter code = closer to exact for numeric queries ("4772" before "47721").
        buckets[2].sort((a, b) => String(a.code).length - String(b.code).length);
        return buckets.flat().slice(0, limit);
    };

    return { search, lineCount: lines.length, stopCount: stops.length };
}
