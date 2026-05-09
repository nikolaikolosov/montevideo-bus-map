import { CONFIG } from './config.js';
import { escapeHTML, cleanCoordinates, truncateLineDownstream, isCoarsePointer } from './utils.js';
import { appState, resetLayers } from './state.js';
import {
    uniqueStopsData,
    stopLinesMap,
    stopVariantsMap,
    getFilteredRouteFeatures,
    getFilteredStopFeatures,
    buildVariantOrdinalMap,
    getLineColor,
} from './data.js';

/** @type {L.Map} */
let map;

/**
 * Calculates parallel line spacing based on zoom level.
 * @param {number} zoom
 * @returns {number}
 */
function getRouteSpacingForZoom(zoom) {
    // Be very conservative: only enable parallel lines when zoomed in enough
    // to see streets clearly. Low zoom with offsets always creates loops.
    if (zoom < 15) return 0;
    return CONFIG.ROUTE_SPACING;
}

/**
 * Calculates a dynamic style (radius, weight, opacity) based on zoom level.
 * @param {number} zoom
 * @param {boolean} isTouch
 * @returns {object} Leaflet style object
 */
function getStopStyleForZoom(zoom, isTouch) {
    // Zoom 12 and below (City View) — small but clearly visible dots
    if (zoom <= 12) {
        return {
            radius: isTouch ? 2 : 1.2,
            weight: 0.5,
            fillOpacity: 0.6,
        };
    }
    // Zoom 13 (Districts)
    if (zoom <= 13) {
        return {
            radius: isTouch ? 3.5 : 2,
            weight: 0.8,
            fillOpacity: 0.7,
        };
    }
    // Zoom 14 (Neighbourhoods)
    if (zoom <= 14) {
        return {
            radius: isTouch ? 6 : 4,
            weight: 1,
            fillOpacity: 0.8,
        };
    }
    // Zoom 15+ (Detailed View) — full size
    return {
        radius: isTouch ? CONFIG.STOP_ROUTE_RADIUS_TOUCH : CONFIG.STOP_ROUTE_RADIUS,
        weight: 1,
        fillOpacity: 0.9,
    };
}

/**
 * Updates all currently visible stop layers and route offsets to reflect the current zoom.
 */
function updateMapStyles() {
    if (!map) return;
    const zoom = map.getZoom();
    const touch = isCoarsePointer();

    // 1. Update stops
    const stopStyle = getStopStyleForZoom(zoom, touch);
    if (appState.globalStopsLayer) {
        appState.globalStopsLayer.setStyle(stopStyle);
    }
    if (appState.currentStopsLayer) {
        appState.currentStopsLayer.setStyle(stopStyle);
    }

    // 2. Update route parallel offsets
    if (appState.currentRouteLayer && appState.currentLineToIndex) {
        const spacing = getRouteSpacingForZoom(zoom);
        const total = appState.currentTotalLines;
        appState.currentRouteLayer.eachLayer((layer) => {
            if (layer.setOffset) {
                const lineId = layer.feature.properties.DESC_LINEA;
                const idx = appState.currentLineToIndex.get(lineId) || 0;
                const offset = (idx - (total - 1) / 2) * spacing;
                layer.setOffset(offset);
            }
        });
    }
}


// ---------------------------------------------------------------------------
// Map initialisation
// ---------------------------------------------------------------------------

/**
 * Creates and configures the Leaflet map instance.
 * @returns {L.Map}
 */
export function initMap() {
    const touch = isCoarsePointer();

    map = L.map('map', {
        zoomControl: false,
        preferCanvas: true,  // canvas renderer — better performance for many markers
        // On touch devices, increase the pixel tolerance so a finger tap slightly
        // off-centre still registers as a hit on a stop marker.
        clickTolerance: touch ? CONFIG.CLICK_TOLERANCE_TOUCH : 3,
        tapTolerance:   touch ? CONFIG.TAP_TOLERANCE_TOUCH   : 15,
    }).setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);

    L.control.zoom({ position: 'topright' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
            '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: CONFIG.MAX_ZOOM,
    }).addTo(map);

    // Dedicated pane for stops — always renders above route lines
    map.createPane('stopsPane');
    map.getPane('stopsPane').style.zIndex = 450;

    // Listen for zoom changes to scale markers and route offsets
    map.on('zoomend', updateMapStyles);

    return map;
}

// ---------------------------------------------------------------------------
// Layer lifecycle
// ---------------------------------------------------------------------------

/**
 * Removes all active layers from the map and resets state references.
 */
export function clearLayers() {
    if (appState.currentRouteLayer) map.removeLayer(appState.currentRouteLayer);
    if (appState.currentStopsLayer) map.removeLayer(appState.currentStopsLayer);
    if (appState.globalStopsLayer) map.removeLayer(appState.globalStopsLayer);
    if (appState.routeLabelsLayer) map.removeLayer(appState.routeLabelsLayer);
    resetLayers();
}

// ---------------------------------------------------------------------------
// Popup factory
// ---------------------------------------------------------------------------

/**
 * Builds the popup DOM node for a stop feature.
 * Wires up the "Ver rutas" button via event delegation to avoid listener leaks.
 *
 * @param {object} feature - GeoJSON Feature
 * @param {Function} onShowRoutes - callback(linesArr, variantsArr, feature)
 * @returns {HTMLElement}
 */
export function createStopPopup(feature, onShowRoutes) {
    const { CALLE = 'Desconocida', ESQUINA = 'Desconocida', COD_UBIC_P: cod } = feature.properties;
    const linesArr = stopLinesMap.has(cod)
        ? Array.from(stopLinesMap.get(cod)).sort((a, b) =>
              a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
          )
        : [];
    const variantsArr = stopVariantsMap.has(cod)
        ? Array.from(stopVariantsMap.get(cod))
        : [];
    const linesText = linesArr.length > 0 ? linesArr.join(', ') : 'Ninguna';

    const div = document.createElement('div');
    div.className = 'popup-content';
    div.innerHTML = `
        <h3>Parada</h3>
        <p><strong>Calle:</strong> ${escapeHTML(CALLE)}</p>
        <p><strong>Esquina:</strong> ${escapeHTML(ESQUINA)}</p>
        <p><strong>Líneas:</strong> ${escapeHTML(linesText)}</p>
        <button type="button" class="btn draw-lines-btn" aria-label="Ver rutas desde esta parada">Ver rutas</button>
    `;

    div.querySelector('.draw-lines-btn').addEventListener('click', () => {
        onShowRoutes(linesArr, variantsArr, feature);
        map.closePopup();
    });

    return div;
}

// ---------------------------------------------------------------------------
// Stop interaction listeners
// ---------------------------------------------------------------------------

/**
 * Wires up hover and click events for stop markers.
 * @param {L.Layer} layer
 */
function setupStopListeners(layer) {
    layer.on('mouseover', function () {
        this.setStyle({ fillColor: '#ffffff' });
        this.bringToFront();
    });

    layer.on('mouseout', function () {
        // Only turn black if it's not the currently selected stop
        if (appState.selectedStopLayer !== this) {
            this.setStyle({ fillColor: '#000000' });
        }
    });

    layer.on('click', function () {
        // Reset previous selected stop
        if (appState.selectedStopLayer && appState.selectedStopLayer !== this) {
            appState.selectedStopLayer.setStyle({ fillColor: '#000000' });
        }
        // Set new selected stop
        this.setStyle({ fillColor: '#ffffff' });
        appState.selectedStopLayer = this;
    });
}

// ---------------------------------------------------------------------------
// Global stops view
// ---------------------------------------------------------------------------

/**
 * Renders all unique stops on the map (default/home view).
 * @param {Function} onShowRoutes - popup callback
 */
export function renderGlobalStops(onShowRoutes) {
    clearLayers();
    const touch = isCoarsePointer();
    const style = getStopStyleForZoom(map.getZoom(), touch);

    appState.globalStopsLayer = L.geoJSON(
        { type: 'FeatureCollection', features: uniqueStopsData },
        {
            pointToLayer: (_feature, latlng) =>
                L.circleMarker(latlng, {
                    ...style,
                    fillColor: '#000000',
                    color: '#ffffff',
                    opacity: style.fillOpacity,
                    pane: 'stopsPane',
                }),
            onEachFeature: (feature, layer) => {
                layer.bindPopup(() => createStopPopup(feature, onShowRoutes));
                setupStopListeners(layer);
            },
        }
    ).addTo(map);
}

// ---------------------------------------------------------------------------
// Route geometry preparation
// ---------------------------------------------------------------------------

/**
 * Clones and cleans a route feature's geometry.
 * Uses shallow clone + geometry-only cloning instead of structuredClone
 * for better performance on large GeoJSON datasets.
 *
 * @param {object} f - original GeoJSON Feature
 * @param {number[]|null} sourceLonLat - if set, truncate route from this point
 * @returns {object|null} cleaned feature, or null if geometry becomes empty
 */
function prepareRouteFeature(f, sourceLonLat) {
    if (!f.geometry?.coordinates) return null;

    // Shallow-clone the feature; deep-clone only the coordinates array
    let coords = JSON.parse(JSON.stringify(f.geometry.coordinates));
    coords = cleanCoordinates(coords);
    if (sourceLonLat) {
        coords = truncateLineDownstream(coords, sourceLonLat);
    }
    if (!coords || coords.length <= 1) return null;

    return {
        ...f,
        geometry: { ...f.geometry, coordinates: coords },
    };
}

// ---------------------------------------------------------------------------
// Route labels
// ---------------------------------------------------------------------------

/**
 * Collects label positions from route features and clusters nearby ones.
 * @param {object[]} features - cleaned GeoJSON Feature[]
 * @returns {Array<{coords: number[], labels: Array<{linea: string, color: string}>}>}
 */
function buildLabelGroups(features) {
    const threshold = CONFIG.LABEL_CLUSTER_THRESHOLD_DEG;
    const groups = [];

    const addLabel = (coords, linea, color) => {
        if (!coords || coords.length < 2) return;
        let found = null;
        for (const g of groups) {
            const dx = g.coords[0] - coords[0];
            const dy = g.coords[1] - coords[1];
            if (Math.sqrt(dx * dx + dy * dy) < threshold) {
                found = g;
                break;
            }
        }
        if (!found) {
            found = { coords, labels: [] };
            groups.push(found);
        }
        if (!found.labels.some((l) => l.linea === linea)) {
            found.labels.push({ linea, color });
        }
    };

    features.forEach((feature) => {
        const coords = feature.geometry.coordinates;
        const linea = feature.properties.DESC_LINEA;
        const color = getLineColor(linea);

        if (feature.geometry.type === 'LineString') {
            if (coords.length > 0) {
                addLabel(coords[0], linea, color);
                addLabel(coords[coords.length - 1], linea, color);
            }
        } else if (feature.geometry.type === 'MultiLineString') {
            if (coords.length > 0) {
                const first = coords[0];
                const last = coords[coords.length - 1];
                if (first.length > 0) addLabel(first[0], linea, color);
                if (last.length > 0) addLabel(last[last.length - 1], linea, color);
            }
        }
    });

    return groups;
}

/**
 * Renders clustered route labels onto the map.
 * @param {Array} labelGroups - output of buildLabelGroups()
 */
function renderRouteLabels(labelGroups) {
    appState.routeLabelsLayer = L.layerGroup().addTo(map);

    labelGroups.forEach((group) => {
        group.labels.sort((a, b) =>
            a.linea.localeCompare(b.linea, undefined, { numeric: true, sensitivity: 'base' })
        );

        const labelsHtml = group.labels
            .map(
                (l) =>
                    `<div class="route-label-icon route-label-item" style="border-color:${l.color};color:${l.color}">${l.linea}</div>`
            )
            .join('');

        const icon = L.divIcon({
            className: '',
            html: `<div class="route-label-container">${labelsHtml}</div>`,
            iconSize: [0, 0],
        });

        L.marker([group.coords[1], group.coords[0]], {
            icon,
            interactive: false,
        }).addTo(appState.routeLabelsLayer);
    });
}

// ---------------------------------------------------------------------------
// Route rendering
// ---------------------------------------------------------------------------

/**
 * Renders the filtered route lines on the map.
 * @param {object[]} features - cleaned GeoJSON Feature[]
 * @param {number} lineCount - total number of distinct lines (affects stroke weight)
 */
function renderRouteLines(features, lineCount) {
    const weight = lineCount === 1 ? CONFIG.ROUTE_WEIGHT_SINGLE : CONFIG.ROUTE_WEIGHT_MULTI;

    // To stack lines parallel, we assign each line ID an offset index
    const distinctLines = [...new Set(features.map((f) => f.properties.DESC_LINEA))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
    );
    
    // Save indexing to state for dynamic zoom-based updates
    appState.currentLineToIndex = new Map(distinctLines.map((id, idx) => [id, idx]));
    appState.currentTotalLines = distinctLines.length;

    const spacing = getRouteSpacingForZoom(map.getZoom());

    appState.currentRouteLayer = L.geoJSON(
        { type: 'FeatureCollection', features },
        {
            style: (feature) => {
                const idx = appState.currentLineToIndex.get(feature.properties.DESC_LINEA) || 0;
                const offset = (idx - (appState.currentTotalLines - 1) / 2) * spacing;

                return {
                    color: getLineColor(feature.properties.DESC_LINEA),
                    weight,
                    opacity: CONFIG.ROUTE_OPACITY,
                    lineCap: 'round',
                    lineJoin: 'bevel', // 'bevel' is much more stable for offsets than 'round' or 'miter'
                    smoothFactor: 0,
                    offset: offset,
                };
            },
            onEachFeature: (feature, layer) => {
                layer.bindPopup(`
                    <div class="popup-content">
                        <h3>Línea ${escapeHTML(feature.properties.DESC_LINEA)}</h3>
                        <p>Variante: ${escapeHTML(feature.properties.DESC_VARIA || 'N/A')}</p>
                    </div>
                `);
                layer.on('mouseover', function () {
                    this.setStyle({ weight: CONFIG.ROUTE_HOVER_WEIGHT, opacity: 1 });
                    this.bringToFront();
                });
                layer.on('mouseout', function () {
                    appState.currentRouteLayer?.resetStyle(this);
                });
            },
        }
    ).addTo(map);
}

// ---------------------------------------------------------------------------
// Stop rendering
// ---------------------------------------------------------------------------

/**
 * Renders filtered stop markers on the map.
 * @param {object[]} features - deduplicated GeoJSON Feature[]
 * @param {Function} onShowRoutes - popup callback
 */
function renderStops(features, onShowRoutes) {
    const touch = isCoarsePointer();
    const style = getStopStyleForZoom(map.getZoom(), touch);

    appState.currentStopsLayer = L.geoJSON(
        { type: 'FeatureCollection', features },
        {
            pointToLayer: (_feature, latlng) =>
                L.circleMarker(latlng, {
                    ...style,
                    fillColor: '#000000',
                    color: '#ffffff',
                    opacity: style.fillOpacity,
                    pane: 'stopsPane',
                }),
            onEachFeature: (feature, layer) => {
                layer.bindPopup(() => createStopPopup(feature, onShowRoutes));
                setupStopListeners(layer);
            },
        }
    ).addTo(map);
}

/**
 * Adds a highlighted marker for the source stop (origin of "Ver rutas" click).
 * @param {object} sourceFeature - GeoJSON Feature
 */
function renderHighlightStop(sourceFeature) {
    const [lon, lat] = sourceFeature.geometry.coordinates;
    const size = CONFIG.HIGHLIGHT_STOP_SIZE;
    const icon = L.divIcon({
        className: '',
        html: '<div class="highlight-stop-marker"></div>',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
    });
    L.marker([lat, lon], {
        icon,
        interactive: false,
        zIndexOffset: 1000,
    }).addTo(appState.currentStopsLayer);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Renders routes and stops for the given line or stop selection.
 * Replaces the monolithic displayMultipleRoutes() god function.
 *
 * @param {object} options
 * @param {string[]} options.lineIds
 * @param {string[]|null} [options.variantsArr]
 * @param {object|null} [options.sourceFeature] - GeoJSON Feature of the source stop
 * @param {Function} options.onShowRoutes - callback for popup "Ver rutas" button
 * @returns {{ variantCount: number, stopCount: number }}
 */
export function renderRoutes({ lineIds, variantsArr = null, sourceFeature = null, onShowRoutes }) {
    clearLayers();
    if (lineIds.length === 0) return { variantCount: 0, stopCount: 0 };

    const sourceLonLat = sourceFeature?.geometry?.coordinates ?? null;
    const variantOrdinalMap = sourceFeature
        ? buildVariantOrdinalMap(sourceFeature.properties.COD_UBIC_P)
        : null;

    // --- Filter & prepare route features ---
    const rawRouteFeatures = getFilteredRouteFeatures(lineIds, variantsArr);
    const cleanedRouteFeatures = rawRouteFeatures
        .map((f) => prepareRouteFeature(f, sourceLonLat))
        .filter(Boolean);

    if (cleanedRouteFeatures.length === 0) return { variantCount: 0, stopCount: 0 };

    // --- Filter stop features ---
    const stopFeatures = getFilteredStopFeatures(lineIds, variantsArr, variantOrdinalMap);

    // --- Render ---
    const labelGroups = buildLabelGroups(cleanedRouteFeatures);
    renderRouteLabels(labelGroups);
    renderRouteLines(cleanedRouteFeatures, lineIds.length);
    renderStops(stopFeatures, onShowRoutes);

    if (sourceFeature) {
        renderHighlightStop(sourceFeature);
    }

    // --- Fit bounds ---
    if (!sourceFeature && appState.currentRouteLayer) {
        map.fitBounds(appState.currentRouteLayer.getBounds(), {
            padding: CONFIG.FIT_BOUNDS_PADDING,
            maxZoom: CONFIG.FIT_BOUNDS_MAX_ZOOM,
        });
    }

    // --- Return stats for UI ---
    const variantCount = new Set(
        cleanedRouteFeatures.map((f) => f.properties.DESC_VARIA)
    ).size;

    return { variantCount, stopCount: stopFeatures.length };
}
