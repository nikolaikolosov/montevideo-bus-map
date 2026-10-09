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
 *   5. stop name substring          ("buenos aires", "cibils y verdun",
 *                                    and "18" → the 43 "18 DE JULIO" stops)
 * Ties keep source order (lines: numeric-aware sort; stops: dataset order).
 *
 * Rank 3 is the only numeric-only bucket; every other rank applies to any query
 * shape. Rank 5 also gets a reserved share of the result list, because a short
 * numeric query prefix-matches hundreds of stop codes and would otherwise fill
 * the list on its own.
 *
 * Rank 5 continues with WORD matches after the substring ones: every word of
 * the query must start a word of the stop's name, in any order. A rider types a
 * corner the way the app itself prints it — "18 de julio y ejido" — or the other
 * way round, or with the street type spelled out ("avenida italia"); a plain
 * substring of "AV 18 DE JULIO EJIDO" matched none of those. Connectors ("y",
 * "esq") are dropped and street types fold to the feed's abbreviations.
 *
 * A leading "línea"/"line"/"линия" or "parada"/"stop"/"остановка" is a label
 * the rider typed, not part of the id: the search field itself shows a picked
 * line as "Línea 104", so editing that text used to find nothing.
 */

/** Lowercase + strip combining diacritics (ñ → n deliberately included). */
export const normalize = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Words a rider puts between two street names; they name nothing. */
const CONNECTORS = new Set(['y', 'e', 'esq', 'esquina', 'and', 'at', 'corner', 'угол', 'и']);

/** Street types as riders spell them → the feed's abbreviation. */
const STREET_TYPES = new Map([
    ['avenida', 'av'],
    ['avda', 'av'],
    ['bulevar', 'bv'],
    ['boulevard', 'bv'],
    ['bvar', 'bv'],
    ['camino', 'cno'],
    ['rambla', 'rbla'],
    ['pasaje', 'psje'],
    ['general', 'gral'],
    ['doctor', 'dr'],
    ['ingeniero', 'ing'],
    ['coronel', 'cnel'],
    ['capitan', 'cap'],
    ['presidente', 'pte'],
]);

/** Normalized words of a name or query, street types folded. */
const words = (text) =>
    normalize(text)
        .split(/[^a-z0-9а-яё]+/)
        .filter(Boolean)
        .map((w) => STREET_TYPES.get(w) ?? w);

/** A label typed in front of an id: "Línea 104", "parada 4772". */
const LINE_LABEL = /^(?:linea|line|линия)\s+(.+)$/;
const STOP_LABEL = /^(?:parada|stop|остановка)\s+(\d+)$/;

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
            words: words(`${CALLE} ${ESQUINA}`),
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
        // The id part of a labelled query ("linea 104" → "104").
        const lineQ = LINE_LABEL.exec(q)?.[1].trim() ?? q;
        const codeQ = STOP_LABEL.exec(q)?.[1] ?? q;
        // Every word must start a word of the name; connectors name nothing.
        const queryWords = words(q).filter((w) => !CONNECTORS.has(w));

        /** @type {SearchEntry[][]} rank buckets (index 5 = word matches, after 4) */
        const buckets = [[], [], [], [], [], []];
        for (const l of lines) {
            if (l.norm === lineQ) buckets[0].push({ type: 'line', id: l.id });
            else if (l.norm.startsWith(lineQ)) buckets[1].push({ type: 'line', id: l.id });
            else if (l.norm.includes(lineQ)) buckets[3].push({ type: 'line', id: l.id });
        }
        const numeric = /^\d+$/.test(codeQ);
        for (const s of stops) {
            const entry = { type: 'stop', code: s.code, name: s.name, esquina: s.esquina };
            // The two branches are independent match KINDS, not two shapes of
            // query. Chaining them with else-if made a digits-only query skip
            // stop names entirely, so "18" — Montevideo's main avenue — returned
            // line ids and code-prefix stops but none of the 43 stops actually
            // named "18 DE JULIO"; 526 stops carry digits in CALLE/ESQUINA and
            // were unreachable by their own number. Only rank 3 is numeric-only
            // (module header); rank 5 always applies. A stop that matches both
            // is listed once, in the better bucket.
            const byCode = numeric && s.codeStr.startsWith(codeQ);
            if (byCode) buckets[2].push(entry);
            else if (s.norm.includes(q)) buckets[4].push(entry);
            else if (
                queryWords.length > 0 &&
                queryWords.every((w) => s.words.some((name) => name.startsWith(w)))
            ) {
                buckets[5].push(entry);
            }
            // Stop as soon as BOTH kinds have more than the list can show. The
            // old combined counter let a flood of code-prefix matches end the
            // scan before a single name match had been seen.
            if (buckets[2].length >= limit * 3 && buckets[4].length >= limit * 3) break;
        }
        // Shorter code = closer to exact for numeric queries ("4772" before "47721").
        buckets[2].sort((a, b) => String(a.code).length - String(b.code).length);

        // Reserve part of the list for stop-name matches. A short numeric query
        // prefix-matches hundreds of stop CODES, which used to fill the whole
        // limit and starve rank 5 even once both branches ran: "18" returned
        // lines 180-188 and stops 18xx, and not one of the 43 stops named
        // "18 DE JULIO". Code prefixes stay ahead of names, they just no longer
        // crowd them out entirely.
        //
        // The share is a FLOOR, not a cap. It used to be both: names were cut
        // to limit / 3 even when nothing else matched, so "buenos aires" listed
        // 6 of the street's stops in a list with room for 20.
        const named = [...buckets[4], ...buckets[5]];
        const ahead = [buckets[0], buckets[1], buckets[2], buckets[3]].flat();
        if (named.length === 0) return ahead.slice(0, limit);
        const reserved = Math.min(named.length, Math.max(1, Math.floor(limit / 3)));
        const head = ahead.slice(0, limit - reserved);
        return [...head, ...named.slice(0, limit - head.length)];
    };

    return { search, lineCount: lines.length, stopCount: stops.length };
}
