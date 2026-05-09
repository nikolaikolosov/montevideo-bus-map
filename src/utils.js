import { CONFIG } from './config.js';

/**
 * Escapes a string to prevent XSS when injecting into innerHTML.
 * @param {*} str
 * @returns {string}
 */
export const escapeHTML = (str) =>
    String(str).replace(/[&<>'"]/g, (match) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
    }[match]));

/**
 * Returns true if the coordinate is near the known bad phantom stop.
 * @param {number[]} c - [lon, lat]
 * @returns {boolean}
 */
const isBadCoord = (c) => {
    const [bx, by] = CONFIG.BAD_STOP_COORDS;
    const dx = c[0] - bx;
    const dy = c[1] - by;
    return Math.sqrt(dx * dx + dy * dy) < CONFIG.BAD_STOP_REMOVE_RADIUS_DEG;
};

/**
 * Recursively removes phantom stop coordinates from a GeoJSON coordinate array.
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
        const filtered = coords.filter((c) => !isBadCoord(c));
        // Remove consecutive duplicates or extremely close points (within ~1 meter)
        // which cause "loops" and artifacts with PolylineOffset.
        const threshold = 0.00001; // ~1 meter in degrees
        return filtered.filter((c, i) => {
            if (i === 0) return true;
            const dx = Math.abs(c[0] - filtered[i - 1][0]);
            const dy = Math.abs(c[1] - filtered[i - 1][1]);
            return dx > threshold || dy > threshold;
        });
    }
    // MultiLineString: array of lines
    return coords
        .map((line) => cleanCoordinates(line))
        .filter((line) => line.length > 1);
};

/**
 * Truncates a coordinate array so it starts from the point nearest to sourceLonLat.
 * Used to show only the downstream part of a route from a selected stop.
 * @param {Array} coords
 * @param {number[]} sourceLonLat - [lon, lat]
 * @returns {Array}
 */
export const truncateLineDownstream = (coords, sourceLonLat) => {
    if (!coords || coords.length === 0) return coords;
    if (typeof coords[0] === 'number') return coords;

    // LineString: array of positions [ [lon, lat], ... ]
    if (typeof coords[0][0] === 'number') {
        let minIdx = 0;
        let minDistSq = Infinity;
        for (let i = 0; i < coords.length; i++) {
            const dx = coords[i][0] - sourceLonLat[0];
            const dy = coords[i][1] - sourceLonLat[1];
            const d2 = dx * dx + dy * dy;
            if (d2 < minDistSq) {
                minDistSq = d2;
                minIdx = i;
            }
        }
        const sliced = coords.slice(minIdx);
        if (sliced.length > 0) {
            // Force the first point to be exactly the stop location
            sliced[0] = [sourceLonLat[0], sourceLonLat[1]];
        }
        return sliced;
    }

    // MultiLineString: array of lines
    // Find which segment is actually closest to the stop to avoid jumping
    let bestLineIdx = -1;
    let absoluteMinDistSq = Infinity;

    const lineInfos = coords.map((line, idx) => {
        let minIdx = 0;
        let minDistSq = Infinity;
        for (let i = 0; i < line.length; i++) {
            const dx = line[i][0] - sourceLonLat[0];
            const dy = line[i][1] - sourceLonLat[1];
            const d2 = dx * dx + dy * dy;
            if (d2 < minDistSq) {
                minDistSq = d2;
                minIdx = i;
            }
        }
        if (minDistSq < absoluteMinDistSq) {
            absoluteMinDistSq = minDistSq;
            bestLineIdx = idx;
        }
        return { line, minIdx };
    });

    return lineInfos
        .map(({ line, minIdx }, idx) => {
            const sliced = line.slice(minIdx);
            // Only snap the very first point of the closest segment to the stop
            if (idx === bestLineIdx && sliced.length > 0) {
                sliced[0] = [sourceLonLat[0], sourceLonLat[1]];
            }
            return sliced;
        })
        .filter((line) => line.length > 1);
};

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
 * Returns true if the stop feature represents the known bad phantom stop.
 * @param {object} props - feature.properties
 * @returns {boolean}
 */
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

export const isBadStop = (props) =>
    props.CALLE === CONFIG.BAD_STOP_STREET &&
    props.ESQUINA === CONFIG.BAD_STOP_CORNER;
