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
    uniqueStopByCode,
    stopLinesMap,
    stopVariantsMap,
} from './data.js';
import {
    initMap,
    renderGlobalStops,
    renderRoutes,
    locateUser,
    applyMapTheme,
    getRenderState,
    closeMapPopup,
} from './map.js';
import { initTheme, getTheme, setThemeOverride, onThemeChange } from './theme.js';
import { initLang, setLang, onLangChange, applyTranslations, t } from './i18n.js';
import {
    hideLoader,
    showError,
    populateRouteSelect,
    updateStatsPanel,
    renderDataFreshness,
    initThemeToggle,
    updateThemeToggle,
    initLangSwitcher,
    updateLangSwitcher,
} from './ui.js';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/**
 * Fetches a JSON file with a timeout guard.
 * @param {string} url
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<{data: object, lastModified: string|null}>}
 */
async function fetchWithTimeout(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
        return { data: await res.json(), lastModified: res.headers.get('last-modified') };
    } finally {
        clearTimeout(id);
    }
}

/**
 * Loads both GeoJSON datasets in parallel.
 * Throws a descriptive error on failure.
 * @returns {Promise<[object, object, string|null]>} [routesData, stopsData, generatedAt]
 */
async function loadData() {
    const [routes, stops] = await Promise.all([
        fetchWithTimeout(CONFIG.DATA_URLS.ROUTES),
        fetchWithTimeout(CONFIG.DATA_URLS.STOPS),
    ]);

    if (!routes.data?.features || !stops.data?.features) {
        throw new Error(t('error.badFormat'));
    }

    // Data freshness: prefer the pipeline's generated_at stamp (v2 contract);
    // fall back to the HTTP Last-Modified header for pre-v2 files.
    const generatedAt =
        stops.data.generated_at ??
        routes.data.generated_at ??
        stops.lastModified ??
        routes.lastModified ??
        null;

    return [routes.data, stops.data, generatedAt];
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
/**
 * Debug/verification hooks (pair with __mvdShowStopRoutes below):
 * __mvdSelectLine renders a line exactly as picking it in the dropdown would
 * (without the UI debounce); __mvdGetRenderState returns a deterministic
 * snapshot of the rendered layers for the golden render-sweep e2e test.
 */
window.__mvdSelectLine = (lineId) => {
    handleSelectLine(lineId);
    const select = document.getElementById('routeSelect');
    if (select) select.value = lineId;
};
window.__mvdGetRenderState = getRenderState;

window.__mvdShowStopRoutes = (stopCode) => {
    const stopFeature = uniqueStopByCode.get(stopCode);
    if (!stopFeature) return false;
    const linesArr = Array.from(stopLinesMap.get(stopCode) ?? []).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );
    const variantsArr = Array.from(stopVariantsMap.get(stopCode) ?? []);
    handleShowRoutes(linesArr, variantsArr, stopFeature);
    return true;
};

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/** Kept for language switches: the freshness line re-renders localized. */
let lastGeneratedAt = null;
/** Guards language-switch re-population before the data is indexed. */
let dataReady = false;

async function initApp() {
    try {
        // Language first: the loader and panel must greet in the right one
        // (persisted choice, else browser preference, else Spanish).
        initLang();
        applyTranslations();
        updateLangSwitcher();
        initLangSwitcher((lang) => setLang(lang));
        onLangChange(() => {
            applyTranslations();
            updateLangSwitcher();
            updateThemeToggle(getTheme());
            renderDataFreshness(lastGeneratedAt);
            if (dataReady) {
                const select = document.getElementById('routeSelect');
                const selected = select?.value;
                populateRouteSelect(getSortedLines());
                if (select && selected) select.value = selected;
            }
            // An open popup keeps its old-language DOM; popups regenerate
            // their content on open, so just close it.
            closeMapPopup();
        });

        // Theme next, so the loader/panel and the initial tiles are correct.
        // Follows sunrise/sunset in Montevideo; the toggle overrides until the
        // next natural boundary (see theme.js).
        initTheme();
        updateThemeToggle(getTheme());
        initThemeToggle(() => setThemeOverride(getTheme() === 'dark' ? 'light' : 'dark'));
        onThemeChange((theme) => {
            updateThemeToggle(theme);
            applyMapTheme();
        });

        // Load datasets in parallel
        const [routesData, stopsData, generatedAt] = await loadData();

        // Build O(1) lookup indexes (runs once, not on every interaction)
        buildIndexes(routesData, stopsData);
        dataReady = true;

        // Show when the data was generated (manual-update workflow)
        lastGeneratedAt = generatedAt;
        renderDataFreshness(generatedAt);

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
            }, CONFIG.SELECT_CHANGE_DEBOUNCE_MS),
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
            err.name === 'AbortError' ? t('error.timeout') : err.message || t('error.unknown');
        showError(msg);
    }
}

// Start once DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
