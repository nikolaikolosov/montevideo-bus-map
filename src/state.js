/**
 * Centralized application state.
 * All mutable runtime state lives here — no scattered globals.
 */
export const appState = {
    /** @type {string|null} Currently selected route line ID */
    selectedLine: null,

    /** @type {L.GeoJSON|null} */
    currentRouteLayer: null,
    /** @type {L.GeoJSON|null} */
    currentStopsLayer: null,
    /** @type {L.GeoJSON|null} */
    globalStopsLayer: null,
    /** @type {L.LayerGroup|null} */
    routeLabelsLayer: null,
    /** @type {L.Layer|null} Currently selected/clicked stop marker */
    selectedStopLayer: null,

    // Helper state for dynamic parallel line offsets
    /** @type {Map<string, number>|null} */
    currentLineToIndex: null,
    /** @type {number} */
    currentTotalLines: 0,
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
    appState.selectedStopLayer = null;
    appState.currentLineToIndex = null;
    appState.currentTotalLines = 0;
}
