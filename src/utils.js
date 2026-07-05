import { projectPointOnPolyline } from './geometry.js';

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
