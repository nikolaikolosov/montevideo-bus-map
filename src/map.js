import { CONFIG } from './config.js';
import { escapeHTML, cleanCoordinates, truncateLineDownstream, isCoarsePointer } from './utils.js';
import { appState, resetLayers } from './state.js';
import { buildSections } from './bundling.js';
import { OffsetPolyline } from './offsetline.js';
import {
    uniqueStopsData,
    stopLinesMap,
    stopVariantsMap,
    stopsByVariant,
    getFilteredRouteFeatures,
    getFilteredStopFeatures,
    buildVariantOrdinalMap,
    getLineColor,
} from './data.js';

/** @type {L.Map} */
let map;

/**
 * Per-line parallel offset (px) for slot `idx` within a bundle of `total`
 * distinct lines sharing a corridor at the given zoom.
 *
 * Below ROUTE_OFFSET_MIN_ZOOM all lines collapse onto the street centreline.
 * At the minimum zoom the lines touch (spacing == stroke weight); further in,
 * a small gap opens between them. The spacing is also capped so a corridor
 * with many lines never spreads wider than ROUTE_MAX_SPREAD_PX and stays
 * readable against the street grid.
 *
 * @param {number} idx
 * @param {number} total
 * @param {number} zoom
 * @param {number} weight - base stroke weight (px)
 * @returns {number}
 */
function getLineOffset(idx, total, zoom, weight) {
    if (total <= 1 || zoom < CONFIG.ROUTE_OFFSET_MIN_ZOOM) return 0;
    let spacing =
        zoom === CONFIG.ROUTE_OFFSET_MIN_ZOOM ? weight : weight + CONFIG.ROUTE_BUNDLE_GAP_PX;
    spacing = Math.min(spacing, CONFIG.ROUTE_MAX_SPREAD_PX / (total - 1));
    return (idx - (total - 1) / 2) * spacing;
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
        radius: isTouch ? 12 : 8, // Larger at high zoom to encompass parallel lines
        weight: 1.5,
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

    // 1. Update stops (guard setStyle: a terminal-only layer may be a plain
    // LayerGroup holding just the highlight marker, which has no setStyle).
    const stopStyle = getStopStyleForZoom(zoom, touch);
    if (appState.globalStopsLayer?.setStyle) {
        appState.globalStopsLayer.setStyle(stopStyle);
    }
    if (appState.currentStopsLayer?.setStyle) {
        appState.currentStopsLayer.setStyle(stopStyle);
    }

    // 2. Update route parallel offsets
    if (appState.currentRouteLayer) {
        appState.currentRouteLayer.eachLayer((l) => {
            if (l.setOffsetPx && l._bundleSlot) {
                const { idx, total, weight } = l._bundleSlot;
                l.setOffsetPx(getLineOffset(idx, total, zoom, weight));
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
        preferCanvas: true, // canvas renderer — better performance for many markers
        // On touch devices, increase the pixel tolerance so a finger tap slightly
        // off-centre still registers as a hit on a stop marker.
        clickTolerance: touch ? CONFIG.CLICK_TOLERANCE_TOUCH : 3,
        tapTolerance: touch ? CONFIG.TAP_TOLERANCE_TOUCH : 15,
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

    // Console/debug hook (pairs with window.__mvdShowStopRoutes in app.js)
    window.__mvdMap = map;

    return map;
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------

/** @type {L.LayerGroup|null} "You are here" marker + accuracy circle. */
let userLocationLayer = null;

/**
 * Asks the browser for the user's position, centres the map on it and drops a
 * "you are here" marker with an accuracy circle. Called on mobile at startup.
 *
 * Fails silently: if the user denies permission or the device has no
 * geolocation, the default city view is kept and nothing is shown — we never
 * surface the app's error overlay for this optional convenience.
 */
export function locateUser() {
    if (!map) return;

    map.once('locationfound', (e) => {
        if (userLocationLayer) map.removeLayer(userLocationLayer);

        const accent = '#3b82f6'; // --accent
        userLocationLayer = L.layerGroup([
            L.circle(e.latlng, {
                radius: e.accuracy,
                color: accent,
                weight: 1,
                opacity: 0.4,
                fillColor: accent,
                fillOpacity: 0.1,
                interactive: false,
            }),
            L.marker(e.latlng, {
                icon: L.divIcon({
                    className: '',
                    html: '<div class="user-location-marker"></div>',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8],
                }),
                interactive: false,
                keyboard: false,
                zIndexOffset: 2000,
            }),
        ]).addTo(map);
    });

    map.once('locationerror', (err) => {
        console.warn('[geolocation] no se pudo obtener la ubicación:', err.message);
    });

    map.locate({
        setView: true,
        maxZoom: CONFIG.GEOLOCATION_MAX_ZOOM,
        enableHighAccuracy: true,
        timeout: 10000,
    });
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
              a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
          )
        : [];
    const variantsArr = stopVariantsMap.has(cod) ? Array.from(stopVariantsMap.get(cod)) : [];
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
        },
    ).addTo(map);
}

// ---------------------------------------------------------------------------
// Route geometry preparation
// ---------------------------------------------------------------------------

/**
 * Trims a route's geometry to the segment between its first and last passenger
 * stop, dropping the non-revenue "deadhead" tails where the bus drives to/from
 * the depot after the last stop (or before the first) without picking up riders.
 *
 * @param {Array} coords - LineString coordinate array
 * @param {string} variantId
 * @returns {Array}
 */
function trimToStops(coords, variantId) {
    const variantStops = stopsByVariant.get(variantId);
    if (!variantStops || variantStops.length < 2) return coords;
    // Only meaningful for a flat LineString.
    if (typeof coords[0]?.[0] !== 'number') return coords;

    // First / last passenger stops by ordinal.
    let first = variantStops[0];
    let last = variantStops[0];
    for (const s of variantStops) {
        if (s.ordinal < first.ordinal) first = s;
        if (s.ordinal > last.ordinal) last = s;
    }

    const nearestIdx = (pt) => {
        let minIdx = 0;
        let minDistSq = Infinity;
        for (let i = 0; i < coords.length; i++) {
            const dx = coords[i][0] - pt[0];
            const dy = coords[i][1] - pt[1];
            const d2 = dx * dx + dy * dy;
            if (d2 < minDistSq) {
                minDistSq = d2;
                minIdx = i;
            }
        }
        return minIdx;
    };

    let startIdx = nearestIdx(first.feature.geometry.coordinates);
    let endIdx = nearestIdx(last.feature.geometry.coordinates);
    if (startIdx > endIdx) [startIdx, endIdx] = [endIdx, startIdx];

    return coords.slice(startIdx, endIdx + 1);
}

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

    // Deep-clone coordinates to avoid mutating the original data
    let coords = JSON.parse(JSON.stringify(f.geometry.coordinates));
    coords = cleanCoordinates(coords);

    // Drop the non-revenue deadhead tails (to/from the depot).
    // (No per-variant snapping to stops here: bundling.js unifies the traces
    // of all variants into shared street geometry afterwards.)
    coords = trimToStops(coords, f.properties.COD_VARIAN);

    if (sourceLonLat) {
        // Show only the part the rider can still travel: from the clicked stop
        // downstream to the last stop. At a terminal there is nothing downstream
        // (coords collapses to <2 points) and the variant is dropped below.
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
            a.linea.localeCompare(b.linea, undefined, { numeric: true, sensitivity: 'base' }),
        );

        const labelsHtml = group.labels
            .map(
                (l) =>
                    `<div class="route-label-icon route-label-item" style="border-color:${escapeHTML(l.color)};color:${escapeHTML(l.color)}">${escapeHTML(l.linea)}</div>`,
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
 * Renders the filtered route lines on the map as bundled corridors.
 *
 * Instead of drawing every variant's own trace (which overlap and cross,
 * because each variant is digitised independently), the features are first
 * unified into shared street corridors (see bundling.js). Each corridor is
 * drawn once per line with a parallel pixel offset: lines stay parallel, never
 * cross within a corridor, and a line appears once per street regardless of
 * how many of its variants use it.
 *
 * @param {object[]} features - cleaned GeoJSON Feature[]
 */
function renderRouteLines(features) {
    const sections = buildSections(features);

    const distinctLines = new Set();
    sections.forEach((s) => s.lines.forEach((l) => distinctLines.add(l)));
    const weight =
        distinctLines.size === 1 ? CONFIG.ROUTE_WEIGHT_SINGLE : CONFIG.ROUTE_WEIGHT_MULTI;

    const zoom = map.getZoom();

    /** All rendered segments per line — lets hover highlight the whole line. */
    const layersByLine = new Map();
    const setLineHighlight = (lineId, on) => {
        for (const l of layersByLine.get(lineId) ?? []) {
            if (on) {
                l.setStyle({ weight: CONFIG.ROUTE_HOVER_WEIGHT, opacity: 1 });
                l.bringToFront();
            } else {
                l.setStyle({ weight: l._bundleSlot.weight, opacity: CONFIG.ROUTE_OPACITY });
            }
        }
    };

    appState.currentRouteLayer = L.featureGroup().addTo(map);

    for (const sec of sections) {
        const latlngs = sec.coords.map(([lon, lat]) => [lat, lon]);
        const total = sec.lines.length;

        sec.lines.forEach((lineId, idx) => {
            const variants = [...(sec.variantsByLine.get(lineId) ?? [])].sort();
            const variantsRow = variants.length
                ? `<p>Variante${variants.length > 1 ? 's' : ''}: ${escapeHTML(variants.join(', '))}</p>`
                : '';

            const layer = new OffsetPolyline(latlngs, {
                color: getLineColor(lineId),
                weight,
                opacity: CONFIG.ROUTE_OPACITY,
                lineCap: 'round',
                lineJoin: 'round',
                smoothFactor: CONFIG.ROUTE_SMOOTH_FACTOR,
                offsetPx: getLineOffset(idx, total, zoom, weight),
            });
            layer._bundleSlot = { idx, total, weight };

            layer.bindPopup(`
                <div class="popup-content">
                    <h3>Línea ${escapeHTML(lineId)}</h3>
                    ${variantsRow}
                </div>
            `);
            layer.on('mouseover', () => setLineHighlight(lineId, true));
            layer.on('mouseout', () => setLineHighlight(lineId, false));

            if (!layersByLine.has(lineId)) layersByLine.set(lineId, []);
            layersByLine.get(lineId).push(layer);
            layer.addTo(appState.currentRouteLayer);
        });
    }
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
        },
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

    if (cleanedRouteFeatures.length === 0) {
        // No revenue route downstream (e.g. the clicked stop is a terminal).
        // Keep just the clicked stop visible instead of blanking the map.
        if (sourceFeature) {
            appState.currentStopsLayer = L.layerGroup().addTo(map);
            renderHighlightStop(sourceFeature);
        }
        return { variantCount: 0, stopCount: 0 };
    }

    // --- Filter stop features ---
    const stopFeatures = getFilteredStopFeatures(lineIds, variantsArr, variantOrdinalMap);

    // --- Render ---
    const labelGroups = buildLabelGroups(cleanedRouteFeatures);
    renderRouteLabels(labelGroups);
    renderRouteLines(cleanedRouteFeatures);
    renderStops(stopFeatures, onShowRoutes);

    if (sourceFeature) {
        renderHighlightStop(sourceFeature);
    }

    // --- Fit bounds ---
    if (!sourceFeature && appState.currentRouteLayer?.getLayers().length) {
        map.fitBounds(appState.currentRouteLayer.getBounds(), {
            padding: CONFIG.FIT_BOUNDS_PADDING,
            maxZoom: CONFIG.FIT_BOUNDS_MAX_ZOOM,
        });
    }

    // --- Return stats for UI ---
    const variantCount = new Set(cleanedRouteFeatures.map((f) => f.properties.DESC_VARIA)).size;

    return { variantCount, stopCount: stopFeatures.length };
}
