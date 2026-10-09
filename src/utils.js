import { projectPointOnPolyline } from './geometry.js';

/**
 * What the pipeline writes into CALLE/ESQUINA when no street name resolves
 * (fetch_api_data.py). A sentinel, not a name — and a Spanish one, so it has no
 * business reaching an English or Russian screen.
 */
export const UNKNOWN_STREET = 'Desconocida';

/**
 * Placeholders the FEED itself uses where a street has no name, compared
 * case-insensitively. Not names either: 35 stop sides read "CALLE FICTICIA"
 * (literally "fictitious street"), 49 "CIRC INT SIN DENOM" ("internal roadway,
 * no denomination"), and the rest are the "sin nombre" / "sin denominación"
 * shorthands — riders were shown "CALLE FICTICIA y CALLE FICTICIA".
 */
const PLACEHOLDER_STREETS = new Set(
    [UNKNOWN_STREET, 'CALLE FICTICIA', 'CIRC INT SIN DENOM', 'S/N', 'SIN NOMBRE', 'PSJE S/D'].map(
        (name) => name.toUpperCase(),
    ),
);

/** Words that stay lower case inside a Spanish place name. */
const PARTICLES = new Set(['de', 'del', 'y']);
/** Articles: lower case only right after "de" ("Paso de la Arena", but "La Paz"). */
const ARTICLES = new Set(['el', 'la', 'las', 'los']);
/** Regnal numbers ("Juan XXIII"), which title case would turn into "Xxiii". */
const ROMAN_NUMERAL =
    /^(?:ii|iii|iv|vi|vii|viii|ix|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx|xxi|xxii|xxiii)$/;

/**
 * A place name from the feed, in the mixed case Spanish signage uses.
 *
 * The feed shouts: every street is ALL CAPS ("AV 18 DE JULIO"), while its
 * headsigns are naive Title Case with every particle capitalised ("Plaza De Los
 * Treinta Y Tres"). The GTFS best practices ask for exactly the opposite of
 * both — mixed case "following local conventions for capitalization of place
 * names" — and the two styles side by side read as two different products.
 *
 * Rules, all from the committed data:
 *  - every word capitalised, including after ´ ' - . / ( inside it
 *    ("O´Higgins", "D´Amico", "C.Moller", "(Peloduro)");
 *  - "de", "del", "y" lower case after the first word;
 *  - "e" lower case only where it is the conjunction (before i-/hi-: "Av Italia
 *    e Hipólito Yrigoyen") — elsewhere it is an initial ("Julio E Suárez");
 *  - articles lower case only after "de" ("Av de las Instrucciones", but
 *    "Berges - El Jardín", "Psje La Espiga");
 *  - regnal numbers upper case; tokens starting with a digit keep their
 *    letters lower ("1er").
 * Single letters stay capitals: in this data they are initials ("Luis A de
 * Herrera"), and "Cno A Punta Espinillo" reads fine either way.
 *
 * Display only — keys (URLs, headsign groups) keep the raw feed value.
 *
 * @param {string} text
 * @returns {string}
 */
export function formatPlaceName(text) {
    if (typeof text !== 'string') return text;
    const words = text.trim().split(/\s+/);
    return words
        .map((word, i) => {
            const lower = word.toLowerCase();
            if (ROMAN_NUMERAL.test(lower)) return lower.toUpperCase();
            if (i > 0) {
                if (PARTICLES.has(lower)) return lower;
                const next = words[i + 1]?.toLowerCase() ?? '';
                if (lower === 'e' && /^h?i/.test(next)) return lower;
                if (ARTICLES.has(lower) && words[i - 1].toLowerCase() === 'de') return lower;
            }
            return lower.replace(/(^|[´'’\-./(])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
        })
        .join(' ');
}

/**
 * Street names of a stop as they should be SHOWN: placeholders and empty
 * strings collapsed to null, a corner that merely repeats the street dropped,
 * and the rest in mixed case (formatPlaceName) — so every caller decides what
 * to show once instead of re-testing literals.
 *
 * Three call sites used to compare against 'Desconocida' by hand and only two
 * did it: the popup rendered "at Desconocida" / "угол Desconocida" verbatim, and
 * nothing anywhere handled a sentinel CALLE. The feed's own placeholders
 * (PLACEHOLDER_STREETS) and the 5 stops whose corner is their own street
 * ("AVDA DE LAS AMERICAS y AVDA DE LAS AMERICAS") had the same problem.
 *
 * @param {object} properties - a stop feature's GeoJSON properties
 * @returns {{calle: string|null, esquina: string|null}}
 */
export const stopStreets = (properties) => {
    const clean = (value) => {
        const text = typeof value === 'string' ? value.trim() : '';
        return text && !PLACEHOLDER_STREETS.has(text.toUpperCase()) ? text : null;
    };
    const calle = clean(properties?.CALLE);
    let esquina = clean(properties?.ESQUINA);
    if (calle && esquina && calle.toUpperCase() === esquina.toUpperCase()) esquina = null;
    return {
        calle: calle && formatPlaceName(calle),
        esquina: esquina && formatPlaceName(esquina),
    };
};

/**
 * Escapes a string to prevent XSS when injecting into innerHTML.
 * @param {*} str
 * @returns {string}
 */
export const escapeHTML = (str) =>
    String(str).replace(
        /[&<>'"]/g,
        (match) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;',
            })[match],
    );

/**
 * Removes consecutive duplicate / near-duplicate points (within ~1 meter) from a
 * GeoJSON coordinate array. Such points cause "loops" and rendering artifacts
 * with the PolylineOffset plugin.
 * Works with LineString (array of positions) and MultiLineString (array of lines).
 * Does NOT mutate the original; returns a new array.
 * @param {Array} coords
 * @returns {Array}
 */
export const cleanCoordinates = (coords) => {
    if (!coords || coords.length === 0) return coords;
    // Single position [lon, lat]
    if (typeof coords[0] === 'number') return coords;
    // LineString: array of positions
    if (typeof coords[0][0] === 'number') {
        const threshold = 0.00001; // ~1 meter in degrees
        return coords.filter((c, i) => {
            if (i === 0) return true;
            const dx = Math.abs(c[0] - coords[i - 1][0]);
            const dy = Math.abs(c[1] - coords[i - 1][1]);
            return dx > threshold || dy > threshold;
        });
    }
    // MultiLineString: array of lines
    return coords.map((line) => cleanCoordinates(line)).filter((line) => line.length > 1);
};

/**
 * Truncates a coordinate array to the part downstream of sourceLonLat.
 *
 * The cut point is the nearest point ON the polyline — projection onto
 * segments, which stays exact on Douglas–Peucker-simplified traces whose
 * vertices can be hundreds of meters apart — never the nearest vertex, and
 * the stop's own coordinate is NEVER injected into the geometry. A stop can
 * sit tens of meters off its route's trace (up to ~600 m for a few known
 * data oddities); bridging that gap with a synthetic vertex used to draw
 * chords across city blocks (reported at stops 4534/3987 and as a phantom
 * D1 branch at 3179). The rendered route therefore always follows the
 * recorded trace; the highlighted stop marker shows where the rider stands.
 *
 * @param {Array} coords
 * @param {number[]} sourceLonLat - [lon, lat]
 * @returns {Array}
 */
export const truncateLineDownstream = (coords, sourceLonLat) => {
    if (!coords || coords.length === 0) return coords;
    if (typeof coords[0] === 'number') return coords;

    /** Nearest on-line projection (shared primitive, rule R-PROJECT). */
    const projectOnto = (line) => projectPointOnPolyline(sourceLonLat, line);

    const truncateOne = (line, proj) => {
        const rest = line.slice(proj.i + 1);
        // Skip a degenerate head when the projection lands on the next vertex.
        const EPS = 1e-9;
        if (
            rest.length > 0 &&
            Math.abs(rest[0][0] - proj.x) < EPS &&
            Math.abs(rest[0][1] - proj.y) < EPS
        ) {
            return rest;
        }
        return [[proj.x, proj.y], ...rest];
    };

    // LineString: array of positions [ [lon, lat], ... ]
    if (typeof coords[0][0] === 'number') {
        if (coords.length < 2) return coords;
        return truncateOne(coords, projectOnto(coords));
    }

    // MultiLineString: truncate the piece nearest to the stop; the other
    // pieces are independent geometry and pass through unchanged.
    // (Not present in the current dataset — routes.json carries LineStrings.)
    let bestIdx = -1;
    let bestProj = null;
    const projs = coords.map((line, idx) => {
        if (line.length < 2) return null;
        const p = projectOnto(line);
        if (!bestProj || p.d2 < bestProj.d2) {
            bestProj = p;
            bestIdx = idx;
        }
        return p;
    });
    return coords
        .map((line, idx) => (idx === bestIdx ? truncateOne(line, projs[idx]) : line))
        .filter((line) => line.length > 1);
};

/**
 * True when a coordinate falls inside a lat/lon bounding box.
 * Used to gate auto-geolocation to the service area: a visitor located
 * outside Montevideo keeps the default city overview instead of being
 * centred on an empty map (brainstorm-007).
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{south: number, west: number, north: number, east: number}} bounds
 * @returns {boolean}
 */
export const isWithinBounds = (lat, lng, bounds) =>
    lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;

/**
 * Simple debounce utility.
 * @param {Function} fn
 * @param {number} delay - ms
 * @returns {Function}
 */
export const debounce = (fn, delay) => {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
};

/**
 * Returns true on touch / coarse-pointer devices (phones, tablets).
 * Uses the CSS pointer media query — more reliable than ontouchstart.
 * Result is cached after first call.
 * @returns {boolean}
 */
export const isCoarsePointer = (() => {
    let result = null;
    return () => {
        if (result === null) {
            result = window.matchMedia('(pointer: coarse)').matches;
        }
        return result;
    };
})();
