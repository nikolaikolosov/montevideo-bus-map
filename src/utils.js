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
        return coords.filter((c) => !isBadCoord(c));
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
    if (typeof coords[0][0] === 'number') {
        let minIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < coords.length; i++) {
            const dx = coords[i][0] - sourceLonLat[0];
            const dy = coords[i][1] - sourceLonLat[1];
            const distSq = dx * dx + dy * dy;
            if (distSq < minDist) {
                minDist = distSq;
                minIdx = i;
            }
        }
        return coords.slice(minIdx);
    }
    return coords
        .map((line) => truncateLineDownstream(line, sourceLonLat))
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
export const isBadStop = (props) =>
    props.CALLE === CONFIG.BAD_STOP_STREET &&
    props.ESQUINA === CONFIG.BAD_STOP_CORNER;
