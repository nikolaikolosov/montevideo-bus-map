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
 * Navigation model (design/ux-review-001.md P1): the hash URL is the source
 * of truth. UI events (search picks, popup chips, reset buttons) call
 * router.go(); the single onRoute listener renders. Back/forward replay
 * states, every view is shareable.
 *
 * All heavy logic lives in the dedicated modules (data, map, ui, utils).
 */

import { CONFIG } from './config.js';
import { isCoarsePointer, stopStreets } from './utils.js';
import {
    buildIndexes,
    getSortedLines,
    uniqueStopsData,
    uniqueStopByCode,
    stopLinesMap,
    stopVariantsMap,
    getStopLineVariants,
    getLineHeadsigns,
} from './data.js';
import {
    initMap,
    renderGlobalStops,
    renderRoutes,
    renderJourney,
    renderJourneyEndpoints,
    setJourneyPopupHandlers,
    focusStop,
    locateUser,
    getUserLocation,
    applyMapTheme,
    getRenderState,
    getRouteDrawOrder,
    closeMapPopup,
} from './map.js';
import { planJourney } from './journey.js';
import { initTheme, getTheme, setThemeOverride, onThemeChange } from './theme.js';
import { initLang, setLang, onLangChange, applyTranslations, t } from './i18n.js';
import { buildSearchIndex } from './search.js';
import * as router from './router.js';
import {
    hideLoader,
    showError,
    initSearchBox,
    setSearchDisplay,
    renderContextBar,
    updateStatsPanel,
    renderDestinationPicker,
    renderDataFreshness,
    initThemeToggle,
    updateThemeToggle,
    initLangSwitcher,
    updateLangSwitcher,
    initErrorRetry,
    renderJourneyPanel,
    initJourneyControls,
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
// State → render
// ---------------------------------------------------------------------------

/** The route state currently on screen (for language re-labelling). */
let currentState = { view: 'all' };

/** Popup callback: chips and "Ver todos" navigate; the router renders. */
function handleShowRoutes(linesArr, variantsArr, sourceFeature) {
    const stop = sourceFeature?.properties?.COD_UBIC_P;
    if (stop != null) {
        router.go({
            view: 'downstream',
            stop,
            line: linesArr.length === 1 ? linesArr[0] : null,
        });
    } else if (linesArr.length === 1) {
        router.go({ view: 'line', line: linesArr[0] });
    }
}

const sortLines = (arr) =>
    [...arr].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

const stopDisplayName = (feature) => {
    const { calle, esquina } = stopStreets(feature.properties);
    if (calle && esquina) return `${calle} y ${esquina}`;
    return calle ?? esquina ?? t('stop.unknownStreet');
};

// ---------------------------------------------------------------------------
// Journey planning (stop → stop, see journey.js)
// ---------------------------------------------------------------------------

/** Current journey endpoints, read from the route state (URL is the truth). */
const journeySelection = () =>
    currentState.view === 'journey'
        ? { from: currentState.from, to: currentState.to }
        : { from: null, to: null };

/** Navigates to a journey state, falling back home when both ends are gone. */
function goJourney(from, to, option = 0) {
    if (from == null && to == null) router.go({ view: 'all' });
    else router.go({ view: 'journey', from, to, option });
}

/** Popup wiring: the two "from here" / "to here" buttons on every stop. */
const journeyPopupHandlers = {
    role: (code) => {
        const { from, to } = journeySelection();
        if (from === code) return 'origin';
        if (to === code) return 'destination';
        return 'none';
    },
    onPickOrigin: (code) => {
        const { to } = journeySelection();
        goJourney(code, to === code ? null : to);
    },
    onPickDestination: (code) => {
        const { from } = journeySelection();
        goJourney(from === code ? null : from, code);
    },
    onClearRole: (code) => {
        const { from, to } = journeySelection();
        goJourney(from === code ? null : from, to === code ? null : to);
    },
};

/**
 * Renders the `journey` view: endpoints on the map plus the panel. With only
 * one end picked it stays in "pick the other one" mode over the full stop
 * layer; with both, it plans and draws the selected itinerary.
 */
function renderJourneyState(state, { redrawMap = true } = {}) {
    const known = (code) => code != null && uniqueStopByCode.has(code);
    // A deep link can carry a stop that a data update removed.
    const stale =
        (state.from != null && !known(state.from)) || (state.to != null && !known(state.to));
    const from = known(state.from) ? state.from : null;
    const to = known(state.to) ? state.to : null;

    const nameOf = (code) => (known(code) ? stopDisplayName(uniqueStopByCode.get(code)) : '');
    const panel = {
        visible: true,
        originName: nameOf(from),
        destinationName: nameOf(to),
        message: '',
        options: [],
        activeIndex: 0,
        stopName: (code) => nameOf(code) || String(code),
    };

    updateStatsPanel({ show: false });
    renderContextBar(null);
    setSearchDisplay('');

    const showEndpointsOnly = () => {
        if (redrawMap) {
            renderJourneyEndpoints({ fromCode: from, toCode: to, onShowRoutes: handleShowRoutes });
        }
    };

    if (from == null || to == null) {
        panel.message = stale
            ? t('journey.unknownStop')
            : t(from == null ? 'journey.pickOrigin' : 'journey.pickDestination');
        renderJourneyPanel(panel);
        showEndpointsOnly();
        return;
    }

    const { status, options } = planJourney(from, to);
    if (status !== 'ok' || options.length === 0) {
        panel.message = t(status === 'same' ? 'journey.sameStop' : 'journey.noRoute');
        renderJourneyPanel(panel);
        showEndpointsOnly();
        return;
    }

    const activeIndex = Math.min(Math.max(state.option ?? 0, 0), options.length - 1);
    // Panel BEFORE map: the itinerary's fitBounds measures the panel to keep
    // both ends clear of it, so the panel must already have its final size.
    renderJourneyPanel(
        { ...panel, options, activeIndex },
        { onSelectOption: (index) => router.go({ view: 'journey', from, to, option: index }) },
    );
    if (redrawMap) {
        renderJourney({
            option: options[activeIndex],
            fromCode: from,
            toCode: to,
            onShowRoutes: handleShowRoutes,
        });
    }
}

/** Renders one route state. The only caller is the router. */
function renderForState(state) {
    closeMapPopup();

    // Stale deep links (a line/stop gone after a data update) land safely home.
    if (state.view === 'line' && !stateLineExists(state.line)) state = { view: 'all' };
    if ((state.view === 'stop' || state.view === 'downstream') && !uniqueStopByCode.has(state.stop))
        state = { view: 'all' };
    // A downstream link also names a line, and the PAIR has to be real: the stop
    // and the line can both exist while that line does not serve that stop —
    // #/parada/4772/linea/2, or any shared link that outlived a re-routing.
    // getStopLineVariants then returns [], which getFilteredRouteFeatures reads
    // as an explicit "these variants and no others", so the map came out empty
    // while the context bar and the search field still announced the line.
    // Degrade to what we do know: the stop.
    if (
        state.view === 'downstream' &&
        state.line !== null &&
        uniqueStopByCode.has(state.stop) &&
        !stopLinesMap.get(state.stop)?.has(state.line)
    ) {
        state = { view: 'stop', stop: state.stop };
    }
    currentState = state;

    if (state.view !== 'journey') renderJourneyPanel({ visible: false });
    // Hidden by default and shown only by the line view below, so a view added
    // later cannot leave a stale destination picker on screen.
    if (state.view !== 'line')
        renderDestinationPicker({ groups: [], active: null, onPick: () => {} });

    switch (state.view) {
        case 'journey':
            renderJourneyState(state);
            break;
        case 'line': {
            const groups = getLineHeadsigns(state.line);
            const picked = groups.find((g) => g.headsign === state.headsign) ?? null;
            const { stopCount } = renderRoutes({
                lineIds: [state.line],
                variantsArr: picked ? picked.variants : undefined,
                onShowRoutes: handleShowRoutes,
            });
            updateStatsPanel({ show: true, stopCount });
            renderDestinationPicker({
                groups,
                active: picked ? picked.headsign : null,
                onPick: (headsign) => router.go({ view: 'line', line: state.line, headsign }),
            });
            setSearchDisplay(t('panel.lineOption', { id: state.line }));
            renderContextBar(null);
            break;
        }
        case 'stop': {
            renderGlobalStops(handleShowRoutes);
            updateStatsPanel({ show: false });
            const feature = uniqueStopByCode.get(state.stop);
            setSearchDisplay(stopDisplayName(feature));
            renderContextBar(null);
            focusStop(state.stop);
            break;
        }
        case 'downstream': {
            const feature = uniqueStopByCode.get(state.stop);
            const single = state.line !== null;
            const lineIds = single ? [state.line] : sortLines(stopLinesMap.get(state.stop) ?? []);
            const variantsArr = single
                ? getStopLineVariants(state.stop, state.line)
                : Array.from(stopVariantsMap.get(state.stop) ?? []);
            const { stopCount } = renderRoutes({
                lineIds,
                variantsArr,
                sourceFeature: feature,
                onShowRoutes: handleShowRoutes,
            });
            updateStatsPanel({ show: true, stopCount });
            setSearchDisplay(single ? t('panel.lineOption', { id: state.line }) : '');
            renderContextBar({ name: stopDisplayName(feature), code: state.stop, single }, () =>
                single
                    ? router.go({ view: 'line', line: state.line })
                    : router.go({ view: 'stop', stop: state.stop }),
            );
            break;
        }
        default: {
            renderGlobalStops(handleShowRoutes);
            updateStatsPanel({ show: false });
            setSearchDisplay('');
            renderContextBar(null);
        }
    }
}

let lineSet = new Set();
const stateLineExists = (line) => lineSet.has(line);

/**
 * Console/debug hooks (scripted verification; harmless in production):
 * __mvdSelectLine renders a line exactly as picking it in the search box
 * would; __mvdShowStopRoutes mirrors a popup's "Ver todos" tap;
 * __mvdGetRenderState returns a deterministic snapshot of the rendered
 * layers for the golden render-sweep e2e test.
 */
window.__mvdSelectLine = (lineId) => {
    router.go({ view: 'line', line: lineId });
};
window.__mvdGetRenderState = getRenderState;
/** Paint order of the route layers ('joint'|'strand'): joints must stay under. */
window.__mvdGetDrawOrder = getRouteDrawOrder;
window.__mvdGetUserLocation = getUserLocation;

window.__mvdShowStopRoutes = (stopCode) => {
    if (!uniqueStopByCode.has(stopCode)) return false;
    router.go({ view: 'downstream', stop: stopCode, line: null });
    return true;
};

/** Journey hooks: plan a trip, and read the plan the panel is showing. */
window.__mvdPlanJourney = (from, to, option = 0) => {
    if (!uniqueStopByCode.has(from) || !uniqueStopByCode.has(to)) return false;
    router.go({ view: 'journey', from, to, option });
    return true;
};
window.__mvdGetJourney = (from, to) => planJourney(from, to);

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/** Kept for language switches: the freshness line re-renders localized. */
let lastGeneratedAt = null;

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
            // Re-label the state-dependent widgets in the new language; the
            // map layers themselves are language-free. An open popup keeps
            // its old-language DOM; popups regenerate on open, so close it.
            closeMapPopup();
            relabelForLang();
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

        initErrorRetry(() => location.reload());

        // Load datasets in parallel
        const [routesData, stopsData, generatedAt] = await loadData();

        // Build O(1) lookup indexes (runs once, not on every interaction)
        buildIndexes(routesData, stopsData);
        const sortedLines = getSortedLines();
        lineSet = new Set(sortedLines);
        // Debug/verification hook: the full line list (render-sweep e2e).
        window.__mvdLines = sortedLines;

        // Show when the data was generated (manual-update workflow)
        lastGeneratedAt = generatedAt;
        renderDataFreshness(generatedAt);

        // Initialise Leaflet map. The home control reveals every stop WITHOUT
        // moving the camera — the rider keeps the exact position and zoom they
        // were looking at (brainstorm-010 issue 3).
        initMap(() => router.go({ view: 'all' }));

        // Journey planning: the popup buttons and the panel's own controls.
        setJourneyPopupHandlers(journeyPopupHandlers);
        initJourneyControls({
            onClear: () => router.go({ view: 'all' }),
            onSwap: () => {
                const { from, to } = journeySelection();
                if (from != null && to != null) {
                    router.go({ view: 'journey', from: to, to: from, option: 0 });
                }
            },
            // Dropping one end re-enters "pick that end" mode, which puts every
            // stop back on the map — the trip is not thrown away.
            onChangeOrigin: () => goJourney(null, journeySelection().to),
            onChangeDestination: () => goJourney(journeySelection().from, null),
        });

        // Search over lines and stops — the primary entry to both jobs.
        const searchIndex = buildSearchIndex(sortedLines, uniqueStopsData);
        initSearchBox({
            search: (q) => searchIndex.search(q),
            lines: sortedLines,
            onPick: (entry) => {
                if (entry.type === 'line') router.go({ view: 'line', line: entry.id });
                else if (entry.type === 'stop') router.go({ view: 'stop', stop: entry.code });
                else router.go({ view: 'all' });
            },
        });

        // URL is the source of truth: render the deep-linked state (or home)
        // and follow back/forward from here on.
        const initial = router.start(renderForState);

        // On mobile, centre the map on the user's current location — but only
        // on the home view (never yank the camera away from a deep link).
        // (Asks for permission; silently keeps the city view if denied.)
        if (initial.view === 'all' && isCoarsePointer()) locateUser();

        hideLoader();
    } catch (err) {
        console.error('[app] Initialisation failed:', err);
        const msg =
            err.name === 'AbortError' ? t('error.timeout') : err.message || t('error.unknown');
        showError(msg);
    }
}

/** Refreshes search display + context bar texts after a language switch. */
function relabelForLang() {
    const s = currentState;
    if (s.view === 'line') {
        setSearchDisplay(t('panel.lineOption', { id: s.line }));
    } else if (s.view === 'journey') {
        // Panel only — a language switch must not re-frame the map (R8).
        renderJourneyState(s, { redrawMap: false });
    } else if (s.view === 'downstream' && uniqueStopByCode.has(s.stop)) {
        const feature = uniqueStopByCode.get(s.stop);
        const single = s.line !== null;
        setSearchDisplay(single ? t('panel.lineOption', { id: s.line }) : '');
        renderContextBar({ name: stopDisplayName(feature), code: s.stop, single }, () =>
            single
                ? router.go({ view: 'line', line: s.line })
                : router.go({ view: 'stop', stop: s.stop }),
        );
    }
}

// Start once DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
