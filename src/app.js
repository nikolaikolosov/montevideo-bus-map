/**
 * app.js — application entry point.
 *
 * Responsibilities:
 *  - Load data (with error handling + timeout)
 *  - Build indexes
 *  - Initialise map
 *  - Wire up UI events
 *  - Orchestrate rendering calls
 *
 * All heavy logic lives in the dedicated modules (data, map, ui, utils).
 */

import { CONFIG } from './config.js';
import { debounce, isCoarsePointer } from './utils.js';
import {
    buildIndexes,
    getSortedLines,
    stopsByCode,
    stopLinesMap,
    stopVariantsMap,
} from './data.js';
import { initMap, renderGlobalStops, renderRoutes, locateUser } from './map.js';
import { hideLoader, showError, populateRouteSelect, updateStatsPanel } from './ui.js';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/**
 * Fetches a JSON file with a timeout guard.
 * @param {string} url
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<object>}
 */
async function fetchWithTimeout(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
        return await res.json();
    } finally {
        clearTimeout(id);
    }
}

/**
 * Loads both GeoJSON datasets in parallel.
 * Throws a descriptive error on failure.
 * @returns {Promise<[object, object]>} [routesData, stopsData]
 */
async function loadData() {
    const [routesData, stopsData] = await Promise.all([
        fetchWithTimeout(CONFIG.DATA_URLS.ROUTES),
        fetchWithTimeout(CONFIG.DATA_URLS.STOPS),
    ]);

    if (!routesData?.features || !stopsData?.features) {
        throw new Error('Los datos descargados tienen un formato inesperado.');
    }

    return [routesData, stopsData];
}

// ---------------------------------------------------------------------------
// Route display helpers
// ---------------------------------------------------------------------------

/** Shared callback passed into popups so they can trigger route display. */
function handleShowRoutes(linesArr, variantsArr, sourceFeature) {
    const { variantCount, stopCount } = renderRoutes({
        lineIds: linesArr,
        variantsArr,
        sourceFeature,
        onShowRoutes: handleShowRoutes,
    });

    updateStatsPanel({
        show: true,
        variantCount: linesArr.length === 1 ? variantCount : null,
        stopCount,
        selectedValue: linesArr.length === 1 ? linesArr[0] : '',
    });
}

function handleSelectLine(lineId) {
    const { variantCount, stopCount } = renderRoutes({
        lineIds: [lineId],
        onShowRoutes: handleShowRoutes,
    });

    updateStatsPanel({
        show: true,
        variantCount,
        stopCount,
        selectedValue: lineId,
    });
}

function handleShowAllStops() {
    renderGlobalStops(handleShowRoutes);
    updateStatsPanel({ show: false });
}

/**
 * Console/debug hook: triggers "Ver rutas" for a stop by its code, exactly as
 * clicking the button in the stop's popup would. Used for scripted visual
 * verification; harmless in production.
 * @param {number} stopCode - COD_UBIC_P
 * @returns {boolean} true if the stop exists and routes were rendered
 */
window.__mvdShowStopRoutes = (stopCode) => {
    const stopFeatures = stopsByCode.get(stopCode);
    if (!stopFeatures?.length) return false;
    const linesArr = Array.from(stopLinesMap.get(stopCode) ?? []).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
    const variantsArr = Array.from(stopVariantsMap.get(stopCode) ?? []);
    handleShowRoutes(linesArr, variantsArr, stopFeatures[0]);
    return true;
};

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

async function initApp() {
    try {
        // Load datasets in parallel
        const [routesData, stopsData] = await loadData();

        // Build O(1) lookup indexes (runs once, not on every interaction)
        buildIndexes(routesData, stopsData);

        // Initialise Leaflet map
        initMap();

        // Populate the route selector dropdown
        const sortedLines = getSortedLines();
        populateRouteSelect(sortedLines);

        // Wire up select change with debounce to avoid expensive rerenders
        const select = document.getElementById('routeSelect');
        select.addEventListener(
            'change',
            debounce((e) => {
                const val = e.target.value;
                if (val === 'ALL_STOPS') {
                    handleShowAllStops();
                } else {
                    handleSelectLine(val);
                }
            }, CONFIG.SELECT_CHANGE_DEBOUNCE_MS)
        );

        // Default view — all stops
        select.value = 'ALL_STOPS';
        handleShowAllStops();

        // On mobile, centre the map on the user's current location.
        // (Asks for permission; silently keeps the city view if denied.)
        if (isCoarsePointer()) locateUser();

        hideLoader();
    } catch (err) {
        console.error('[app] Initialisation failed:', err);
        const msg =
            err.name === 'AbortError'
                ? 'La descarga de datos superó el tiempo límite. Verifica tu conexión.'
                : err.message || 'Error desconocido al cargar los datos.';
        showError(msg);
    }
}

// Start once DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
