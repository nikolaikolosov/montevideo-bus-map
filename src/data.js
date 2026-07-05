import { CONFIG } from './config.js';

/**
 * Pre-built lookup indexes for O(1) access to routes and stops by key.
 * Populated once by buildIndexes() during app initialisation.
 *
 * Data format (v2, see architecture/contracts/data-contract.md):
 *  - routes.json: FeatureCollection of LineString variants
 *    (properties DESC_LINEA, COD_VARIAN, DESC_VARIA)
 *  - stops.json: FeatureCollection with ONE Point feature per physical stop
 *    (properties COD_UBIC_P, CALLE, ESQUINA) plus a `patterns` foreign member:
 *    { COD_VARIAN: { linea, paradas: [[COD_UBIC_P, ORDINAL], ...] } }
 */

/** Map<lineId, GeoJSON Feature[]> */
export const routesByLine = new Map();

/** Map<variantId, GeoJSON Feature[]> */
export const routesByVariant = new Map();

/** Map<stopCode, Set<lineId>> */
export const stopLinesMap = new Map();

/** Map<stopCode, Set<variantId>> */
export const stopVariantsMap = new Map();

/** Map<variantId, Array<{feature: object, ordinal: number}>> - stops along a variant */
export const stopsByVariant = new Map();

/** Map<stopCode, GeoJSON Feature> - the unique feature per physical stop */
export const uniqueStopByCode = new Map();

/** Map<stopCode, Map<variantId, ordinal>> - ordinal of the stop within each variant */
const stopOrdinalsMap = new Map();

/** Unique stop features (one per physical stop) */
export const uniqueStopsData = [];

/**
 * Returns a deterministic HSL color for any line ID.
 *
 * Uses a djb2-style hash of the line ID string so that:
 *  - The same line ALWAYS gets the same color, in every context.
 *  - Adding or removing other lines never shifts any existing line's color.
 *  - Lines not present in routes data (e.g. from stops only) also get a stable color.
 *
 * Golden-ratio multiplication spreads the hue space evenly even for
 * numerically adjacent line IDs ("1", "2", "3" … don't cluster together).
 *
 * @param {string} lineId
 * @returns {string} CSS hsl() color
 */
export function getLineColor(lineId) {
    // djb2 hash — fast, low-collision, deterministic
    let hash = 5381;
    for (let i = 0; i < lineId.length; i++) {
        hash = ((hash << 5) + hash + lineId.charCodeAt(i)) & 0x7fffffff;
    }
    // Spread hue evenly with golden ratio
    const hue = (hash * CONFIG.GOLDEN_RATIO * 360) % 360;
    return `hsl(${hue.toFixed(1)}, 85%, 60%)`;
}

/**
 * Build all lookup indexes from the raw datasets.
 * Must be called once at startup before any rendering.
 *
 * @param {object} routesData - GeoJSON FeatureCollection (v2)
 * @param {object} stopsData  - GeoJSON FeatureCollection with `patterns` (v2)
 */
export function buildIndexes(routesData, stopsData) {
    _indexRoutes(routesData);
    _indexStops(stopsData);
}

function _indexRoutes(routesData) {
    if (!routesData?.features) return;
    routesData.features.forEach((f) => {
        const lineId = f.properties.DESC_LINEA;
        const variantId = f.properties.COD_VARIAN;

        if (lineId) {
            if (!routesByLine.has(lineId)) routesByLine.set(lineId, []);
            routesByLine.get(lineId).push(f);
        }
        if (variantId) {
            if (!routesByVariant.has(variantId)) routesByVariant.set(variantId, []);
            routesByVariant.get(variantId).push(f);
        }
    });
}

function _indexStops(stopsData) {
    if (!stopsData?.features) return;

    stopsData.features.forEach((f) => {
        const cod = f.properties.COD_UBIC_P;
        uniqueStopByCode.set(cod, f);
        uniqueStopsData.push(f);
        stopLinesMap.set(cod, new Set());
        stopVariantsMap.set(cod, new Set());
        stopOrdinalsMap.set(cod, new Map());
    });

    for (const [variantId, pattern] of Object.entries(stopsData.patterns ?? {})) {
        const entries = [];
        for (const [cod, ordinal] of pattern.paradas) {
            const feature = uniqueStopByCode.get(cod);
            if (!feature) continue; // contract-validated upstream; stay defensive
            stopLinesMap.get(cod).add(pattern.linea);
            stopVariantsMap.get(cod).add(variantId);
            stopOrdinalsMap.get(cod).set(variantId, ordinal);
            entries.push({ feature, ordinal });
        }
        stopsByVariant.set(variantId, entries);
    }
}

/**
 * Returns all unique line IDs, sorted numerically.
 * @returns {string[]}
 */
export function getSortedLines() {
    return Array.from(routesByLine.keys()).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );
}

/**
 * Returns route GeoJSON features for the given line IDs or variant IDs.
 * Uses pre-built indexes for O(1) lookup instead of iterating all features.
 *
 * @param {string[]} lineIds
 * @param {string[]|null} variantsArr
 * @returns {object[]} Array of GeoJSON Feature objects
 */
export function getFilteredRouteFeatures(lineIds, variantsArr) {
    if (variantsArr) {
        return variantsArr.flatMap((v) => routesByVariant.get(v) ?? []);
    }
    return lineIds.flatMap((id) => routesByLine.get(id) ?? []);
}

/**
 * Returns unique stop features for the given variants/lines, optionally
 * filtered to only those at or after the source stop's ordinal per variant.
 *
 * @param {string[]} lineIds
 * @param {string[]|null} variantsArr
 * @param {Map<string, number>|null} variantOrdinalMap - variant → ordinal at source stop
 * @returns {object[]} deduplicated GeoJSON Feature[]
 */
export function getFilteredStopFeatures(lineIds, variantsArr, variantOrdinalMap) {
    if (variantsArr) {
        const seen = new Set();
        const out = [];
        for (const variantId of variantsArr) {
            const sourceOrdinal = variantOrdinalMap?.get(variantId);
            for (const { feature, ordinal } of stopsByVariant.get(variantId) ?? []) {
                if (sourceOrdinal !== undefined && ordinal < sourceOrdinal) continue;
                const cod = feature.properties.COD_UBIC_P;
                if (seen.has(cod)) continue;
                seen.add(cod);
                out.push(feature);
            }
        }
        return out;
    }

    // For line-based display, filter the unique stops by line membership
    return uniqueStopsData.filter((f) => {
        const lines = stopLinesMap.get(f.properties.COD_UBIC_P);
        return lines && lineIds.some((id) => lines.has(id));
    });
}

/**
 * Builds a map of variantId → ordinal at a given source stop.
 * Used for downstream truncation.
 *
 * @param {string} stopCode
 * @returns {Map<string, number>}
 */
export function buildVariantOrdinalMap(stopCode) {
    return new Map(stopOrdinalsMap.get(stopCode) ?? []);
}
