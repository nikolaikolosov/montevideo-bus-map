import { CONFIG } from './config.js';
import { isBadStop } from './utils.js';

/**
 * Pre-built lookup indexes for O(1) access to routes and stops by key.
 * Populated once by buildIndexes() during app initialisation.
 */

/** Map<lineId, GeoJSON Feature[]> */
export const routesByLine = new Map();

/** Map<variantId, GeoJSON Feature[]> */
export const routesByVariant = new Map();

/** Map<stopCode, Set<lineId>> */
export const stopLinesMap = new Map();

/** Map<stopCode, Set<variantId>> */
export const stopVariantsMap = new Map();

/** Map<variantId, GeoJSON Feature[]> - stops grouped by variant */
export const stopsByVariant = new Map();

/** Map<stopCode, GeoJSON Feature[]> - all stop features per code */
export const stopsByCode = new Map();

/** Map<lineId, hsl color string> */
export const lineColorsMap = new Map();

/** Unique deduplicated stop features (one per physical stop) */
export const uniqueStopsData = [];

/**
 * Build all lookup indexes from the raw GeoJSON datasets.
 * Must be called once at startup before any rendering.
 *
 * @param {object} routesData - GeoJSON FeatureCollection
 * @param {object} stopsData  - GeoJSON FeatureCollection
 */
export function buildIndexes(routesData, stopsData) {
    _indexRoutes(routesData);
    _indexStops(stopsData);
    _assignLineColors();
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
    const seenStops = new Set();

    stopsData.features.forEach((f) => {
        if (isBadStop(f.properties)) return;

        const cod = f.properties.COD_UBIC_P;
        const linea = f.properties.DESC_LINEA;
        const variantId = f.properties.COD_VARIAN;

        // stopLinesMap / stopVariantsMap
        if (!stopLinesMap.has(cod)) stopLinesMap.set(cod, new Set());
        if (!stopVariantsMap.has(cod)) stopVariantsMap.set(cod, new Set());
        if (linea) stopLinesMap.get(cod).add(linea);
        if (variantId) stopVariantsMap.get(cod).add(variantId);

        // stopsByVariant
        if (variantId) {
            if (!stopsByVariant.has(variantId)) stopsByVariant.set(variantId, []);
            stopsByVariant.get(variantId).push(f);
        }

        // stopsByCode
        if (!stopsByCode.has(cod)) stopsByCode.set(cod, []);
        stopsByCode.get(cod).push(f);

        // uniqueStopsData — one feature per physical stop
        if (!seenStops.has(cod)) {
            seenStops.add(cod);
            uniqueStopsData.push(f);
        }
    });
}

function _assignLineColors() {
    const sortedLines = getSortedLines();
    sortedLines.forEach((linea, index) => {
        const hue = ((index * CONFIG.GOLDEN_RATIO) % 1) * 360;
        lineColorsMap.set(linea, `hsl(${hue}, 85%, 60%)`);
    });
}

/**
 * Returns all unique line IDs, sorted numerically.
 * @returns {string[]}
 */
export function getSortedLines() {
    return Array.from(routesByLine.keys()).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
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
 * Returns stop GeoJSON features for the given variants/lines,
 * optionally filtered to only those at or after the sourceOrdinal.
 *
 * @param {string[]} lineIds
 * @param {string[]|null} variantsArr
 * @param {Map<string, number>|null} variantOrdinalMap - variant → ordinal at source stop
 * @returns {object[]}
 */
export function getFilteredStopFeatures(lineIds, variantsArr, variantOrdinalMap) {
    let features;

    if (variantsArr) {
        features = variantsArr.flatMap((v) => stopsByVariant.get(v) ?? []);
        if (variantOrdinalMap) {
            features = features.filter((f) => {
                const sourceOrdinal = variantOrdinalMap.get(f.properties.COD_VARIAN);
                return sourceOrdinal === undefined || f.properties.ORDINAL >= sourceOrdinal;
            });
        }
    } else {
        // For line-based display, use uniqueStopsData filtered by line membership
        features = uniqueStopsData.filter((f) => {
            const cod = f.properties.COD_UBIC_P;
            const lines = stopLinesMap.get(cod);
            return lines && lineIds.some((id) => lines.has(id));
        });
        return features; // already deduplicated
    }

    // Deduplicate by stop code
    const seen = new Set();
    return features.filter((f) => {
        const cod = f.properties.COD_UBIC_P;
        if (seen.has(cod)) return false;
        seen.add(cod);
        return true;
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
    const map = new Map();
    const stopFeatures = stopsByCode.get(stopCode) ?? [];
    stopFeatures.forEach((s) => {
        map.set(s.properties.COD_VARIAN, s.properties.ORDINAL);
    });
    return map;
}
