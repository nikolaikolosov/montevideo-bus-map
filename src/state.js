/**
 * Centralized application state.
 * All mutable runtime state lives here — no scattered globals.
 */
export const appState = {
    /** @type {string|null} Currently selected route line ID */
    selectedLine: null,

    /**
     * Arguments of the last render call, so the current view can be redrawn
     * with fresh theme colors when the theme flips.
     * @type {{type: 'global'|'routes', args: object}|null}
     */
    lastRender: null,

    /** @type {L.GeoJSON|null} */
    currentRouteLayer: null,
    /** @type {L.GeoJSON|null} */
    currentStopsLayer: null,
    /** @type {L.GeoJSON|null} */
    globalStopsLayer: null,
    /** @type {L.LayerGroup|null} */
    routeLabelsLayer: null,

    /** Label positions before screen clustering — re-grouped on every zoom. */
    labelCandidates: [],

    /** @type {L.LayerGroup|null} Direction chevrons, rebuilt as the camera moves. */
    routeArrowsLayer: null,

    /** Traces the chevrons are placed along — empty when direction is ambiguous. */
    arrowFeatures: [],
    /** @type {L.Layer|null} Currently selected/clicked stop marker */
    selectedStopLayer: null,
};

/**
 * Reset all active Leaflet layers in state to null.
 * The caller is responsible for actually removing them from the map.
 */
export function resetLayers() {
    appState.currentRouteLayer = null;
    appState.currentStopsLayer = null;
    appState.globalStopsLayer = null;
    appState.routeLabelsLayer = null;
    appState.labelCandidates = [];
    appState.routeArrowsLayer = null;
    appState.arrowFeatures = [];
    appState.selectedStopLayer = null;
}
