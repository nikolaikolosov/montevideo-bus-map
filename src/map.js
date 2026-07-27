import { CONFIG } from './config.js';
import {
    escapeHTML,
    cleanCoordinates,
    truncateLineDownstream,
    isCoarsePointer,
    isWithinBounds,
    stopStreets,
} from './utils.js';
import { appState, resetLayers } from './state.js';
import { projectionCandidates, pointAt } from './geometry.js';
import { buildSections, buildJoints } from './bundling.js';
import { OffsetPolyline, OffsetJoint } from './offsetline.js';
import { getTheme } from './theme.js';
import { t, tPlural } from './i18n.js';
import { rideLegGeometry } from './journey-geometry.js';
import {
    uniqueStopsData,
    uniqueStopByCode,
    stopLinesMap,
    stopVariantsMap,
    stopsByVariant,
    getFilteredRouteFeatures,
    getFilteredStopFeatures,
    buildVariantOrdinalMap,
    getLineColor,
    getStopLineVariants,
} from './data.js';

/** @type {L.Map} */
let map;

/** @type {L.TileLayer|null} basemap layer — swapped on theme change */
let baseTileLayer = null;

/** Stop marker palette for the active theme. */
const stopColors = () => CONFIG.STOP_COLORS_BY_THEME[getTheme()];

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
export function getLineOffset(idx, total, zoom, weight) {
    if (total <= 1 || zoom < CONFIG.ROUTE_OFFSET_MIN_ZOOM) return 0;
    let spacing =
        zoom === CONFIG.ROUTE_OFFSET_MIN_ZOOM ? weight : weight + CONFIG.ROUTE_BUNDLE_GAP_PX;
    spacing = Math.min(spacing, CONFIG.ROUTE_MAX_SPREAD_PX / (total - 1));
    return (idx - (total - 1) / 2) * spacing;
}

/**
 * Calculates a dynamic style (radius, weight, opacity) based on zoom level.
 *
 * `opacity` (the stroke) is part of the returned style on purpose. It used to be
 * derived from fillOpacity at the two creation sites instead, which setStyle
 * never touches, so the stroke stayed frozen at whatever the zoom was when the
 * layer was built: the same view at the same zoom rendered differently depending
 * on how the rider got there. Every style key the markers use has to be here for
 * updateMapStyles to carry it.
 *
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
            opacity: 0.6,
        };
    }
    // Zoom 13 (Districts)
    if (zoom <= 13) {
        return {
            radius: isTouch ? 3.5 : 2,
            weight: 0.8,
            fillOpacity: 0.7,
            opacity: 0.7,
        };
    }
    // Zoom 14 (Neighbourhoods)
    if (zoom <= 14) {
        return {
            radius: isTouch ? 6 : 4,
            weight: 1,
            fillOpacity: 0.8,
            opacity: 0.8,
        };
    }
    // Zoom 15+ (Detailed View) — full size
    return {
        radius: isTouch ? 12 : 8, // Larger at high zoom to encompass parallel lines
        weight: 1.5,
        fillOpacity: 0.9,
        opacity: 0.9,
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
    // Journey beads live in a plain LayerGroup (mixed with the A/B pins), so
    // they are restyled individually.
    const beadStyle = journeyBeadStyle(zoom, touch);
    appState.currentStopsLayer?.eachLayer?.((l) => {
        if (l._journeyBead) l.setStyle(beadStyle);
    });

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

/**
 * Serializable snapshot of what is currently rendered — route sections with
 * colors/offsets/bounds, stop and label counts. Deterministic (sorted), so it
 * can be compared against a golden manifest in the render-sweep e2e test.
 * @returns {object}
 */
export function getRenderState() {
    const sections = [];
    let joints = 0;
    if (appState.currentRouteLayer) {
        appState.currentRouteLayer.eachLayer((l) => {
            if (l._jointFor) {
                joints++;
                return;
            }
            if (!l._bundleSlot) return;
            const b = l.getBounds();
            const flat = (pts) => (Array.isArray(pts[0]) ? pts.flat() : pts);
            sections.push({
                color: l.options.color,
                weight: l.options.weight,
                offsetPx: l.options.offsetPx ?? 0,
                points: flat(l.getLatLngs()).length,
                bounds: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(
                    (v) => +v.toFixed(4),
                ),
            });
        });
    }
    sections.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    const count = (layer) => (layer?.getLayers ? layer.getLayers().length : 0);
    return {
        theme: getTheme(),
        zoom: map ? map.getZoom() : null,
        sections: sections.length,
        sectionList: sections,
        joints,
        stops: count(appState.currentStopsLayer) + count(appState.globalStopsLayer),
        labels: count(appState.routeLabelsLayer),
    };
}

/**
 * Paint order of the route layers, one 'joint'|'strand' per entry, first
 * painted first. Test hook — `getRenderState()` is compared against a golden
 * manifest and must keep its shape, so depth lives here instead.
 *
 * Joints fill the corner wedges UNDER the strands (see renderRouteJoints), and
 * nothing may leave a joint painted after one: reading the order is the only way
 * to see that, since the canvas renderer keeps it in a private linked list
 * (`_drawFirst` → `_order.next`, Leaflet 1.9.4, version-pinned by SRI in
 * index.html) rather than in the DOM.
 *
 * @returns {Array<'joint'|'strand'>} empty when nothing is rendered
 */
export function getRouteDrawOrder() {
    const order = [];
    const group = appState.currentRouteLayer;
    if (!group) return order;

    let renderer = null;
    group.eachLayer((l) => {
        renderer = renderer ?? l._renderer;
    });
    if (!renderer?._drawFirst) return order;

    for (let node = renderer._drawFirst; node; node = node.next) {
        if (node.layer._jointFor) order.push('joint');
        else if (node.layer._bundleSlot) order.push('strand');
    }
    return order;
}

/**
 * Applies the active theme to the map: swaps the basemap tiles and redraws
 * the current view so route lines, stops and labels pick up theme colors.
 * Safe to call before initMap() (no-op).
 */
/** Closes any open Leaflet popup (used on language switch: popup content
 * regenerates in the new language on next open). */
export function closeMapPopup() {
    map?.closePopup();
}

export function applyMapTheme() {
    if (!map) return;
    if (baseTileLayer) baseTileLayer.setUrl(CONFIG.TILE_URLS[getTheme()]);

    const last = appState.lastRender;
    if (!last) return;
    if (last.type === 'global') {
        renderGlobalStops(last.args.onShowRoutes);
    } else if (last.type === 'journey') {
        // Re-colour only — a theme flip must not re-frame the itinerary (R8).
        renderJourney({ ...last.args, fit: false });
    } else if (last.type === 'journey-endpoints') {
        renderJourneyEndpoints(last.args);
    } else {
        // Same rule as the journey branch above: a recolour must not move the
        // camera (R8). renderRoutes ends in fitBounds whenever there is no
        // source stop, so replaying a line view verbatim threw away whatever
        // the rider had panned or zoomed to — and the theme also flips on its
        // own at sunrise/sunset, so it could happen with no input at all.
        renderRoutes({ ...last.args, fit: false });
    }
}

// ---------------------------------------------------------------------------
// Map initialisation
// ---------------------------------------------------------------------------

/**
 * Creates and configures the Leaflet map instance.
 * @returns {L.Map}
 */
/**
 * Adds the "show all stops" map control under the zoom buttons (brainstorm-009
 * idea 18): the visible, map-native way back to the home view — the slot where
 * mobile map apps keep their view-reset controls.
 * @param {() => void} onHome
 */
function addHomeControl(onHome) {
    const HomeControl = L.Control.extend({
        onAdd() {
            const btn = L.DomUtil.create('button', 'home-control');
            btn.type = 'button';
            btn.innerHTML =
                '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
                '<circle cx="6" cy="6" r="2.4" fill="currentColor"/>' +
                '<circle cx="18" cy="6" r="2.4" fill="currentColor"/>' +
                '<circle cx="6" cy="18" r="2.4" fill="currentColor"/>' +
                '<circle cx="18" cy="18" r="2.4" fill="currentColor"/>' +
                '<circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>';
            btn.setAttribute('aria-label', t('map.showAllAria'));
            btn.title = t('map.showAllAria');
            // Picked up by applyTranslations on language switches.
            btn.setAttribute('data-i18n-aria', 'map.showAllAria');
            btn.setAttribute('data-i18n-title', 'map.showAllAria');
            L.DomEvent.disableClickPropagation(btn);
            L.DomEvent.on(btn, 'click', onHome);
            return btn;
        },
    });
    new HomeControl({ position: 'topright' }).addTo(map);
}

/** @type {HTMLButtonElement|null} The "show my location" control. */
let locateBtn = null;

/**
 * True while the camera is still following the rider — i.e. tracking is on and
 * nothing has moved the map since we last centred it. The control uses this to
 * show whether pressing it again would change anything.
 * @returns {boolean}
 */
export function isFollowingUser() {
    return Boolean(map && locationTracking && !cameraLeftAnchor(followAnchor, cameraState()));
}

/**
 * Reflects tracking state on the control: busy while a fix is pending, disabled
 * once the permission is refused, highlighted while the camera is following.
 * @param {{busy?: boolean, denied?: boolean}} [change]
 */
function updateLocateControl(change = {}) {
    if (!locateBtn) return;
    if (change.busy !== undefined) locateBtn.setAttribute('aria-busy', String(change.busy));
    if (change.denied) {
        locateBtn.disabled = true;
        locateBtn.title = t('map.locateDenied');
        locateBtn.setAttribute('aria-label', t('map.locateDenied'));
        locateBtn.setAttribute('data-i18n-title', 'map.locateDenied');
        locateBtn.setAttribute('data-i18n-aria', 'map.locateDenied');
    }
    locateBtn.classList.toggle('is-following', isFollowingUser());
}

/**
 * Centres the map on the rider and resumes following (design/user-flows F8b):
 * once they have panned away or opened a line the camera is deliberately left
 * alone, and until now there was no way to ask for it back — on desktop, no way
 * to be located at all, since the automatic request is mobile-only.
 *
 * Uses the position already on screen for an instant response, then asks for a
 * fresh one; on desktop this is also where tracking (and the permission prompt)
 * starts, so nothing is requested until the rider asks for it.
 */
export function centreOnUser() {
    if (!map) return;

    if (lastUserFix) {
        const latlng = [lastUserFix.lat, lastUserFix.lng];
        map.setView(latlng, CONFIG.GEOLOCATION_MAX_ZOOM);
        followAnchor = {
            hash: location.hash,
            lat: lastUserFix.lat,
            lng: lastUserFix.lng,
            zoom: CONFIG.GEOLOCATION_MAX_ZOOM,
        };
    } else {
        // Nothing to show yet: anchor on the current camera so the fix that
        // answers this press is allowed to move it.
        followAnchor = cameraState();
    }

    updateLocateControl({ busy: true });
    if (locationTracking) requestPosition();
    else locateUser();
}

/**
 * Adds the "show my location" control under the "show all stops" button.
 * @see centreOnUser
 */
function addLocateControl() {
    const LocateControl = L.Control.extend({
        onAdd() {
            const btn = L.DomUtil.create('button', 'locate-control');
            btn.type = 'button';
            btn.innerHTML =
                '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" ' +
                'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
                '<circle cx="12" cy="12" r="6"/>' +
                '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>' +
                '<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
            btn.setAttribute('aria-label', t('map.locateAria'));
            btn.title = t('map.locateAria');
            // Picked up by applyTranslations on language switches.
            btn.setAttribute('data-i18n-aria', 'map.locateAria');
            btn.setAttribute('data-i18n-title', 'map.locateAria');
            btn.setAttribute('aria-busy', 'false');
            L.DomEvent.disableClickPropagation(btn);
            L.DomEvent.on(btn, 'click', centreOnUser);
            locateBtn = btn;
            return btn;
        },
    });
    new LocateControl({ position: 'topright' }).addTo(map);
}

export function initMap(onHome) {
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
    if (onHome) addHomeControl(onHome);
    addLocateControl();
    // The control shows whether the camera is still following, which any pan or
    // zoom can end.
    map.on('moveend zoomend', () => updateLocateControl());

    baseTileLayer = L.tileLayer(CONFIG.TILE_URLS[getTheme()], {
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

/** @type {number|null} Handle of the periodic position refresh. */
let locationTimer = null;

/** True between locateUser() and stopLocatingUser(), across visibility pauses. */
let locationTracking = false;

/**
 * The camera we last set ourselves, and the view it belonged to. While the map
 * still matches this, each new fix re-centres on the rider; the moment anything
 * else moves the camera — panning, or opening a line — following stops and only
 * the marker keeps moving.
 *
 * That is what the ride scenario needs: the rider boards, picks the line they
 * are on (which frames the whole route), and then watches their dot travel
 * along it. Re-centring at GEOLOCATION_MAX_ZOOM every 30 s would fight that.
 *
 * @type {{hash: string, lat: number, lng: number, zoom: number}|null}
 */
let followAnchor = null;

/** Degrees of slack when comparing camera positions (Leaflet's own epsilon). */
const CAMERA_EPS = 1e-9;

/**
 * True when the camera is no longer where we left it, i.e. someone else is
 * driving and we must not move it again. Pure so the follow policy is testable
 * without a map.
 *
 * @param {{hash: string, lat: number, lng: number, zoom: number}|null} anchor
 * @param {{hash: string, lat: number, lng: number, zoom: number}} state
 * @returns {boolean}
 */
export function cameraLeftAnchor(anchor, state) {
    if (!anchor) return true;
    return (
        anchor.hash !== state.hash ||
        anchor.zoom !== state.zoom ||
        Math.abs(anchor.lat - state.lat) > CAMERA_EPS ||
        Math.abs(anchor.lng - state.lng) > CAMERA_EPS
    );
}

/**
 * Whether a geolocation error is worth giving up on. PERMISSION_DENIED will not
 * fix itself while the page is open, so polling stops; POSITION_UNAVAILABLE and
 * TIMEOUT are transient — a bus under a bridge, a cold GPS — and the next poll
 * may well succeed, which is the whole point of polling.
 *
 * @param {number} code - GeolocationPositionError code
 * @returns {boolean}
 */
export function isFatalLocationError(code) {
    return code === 1; // PERMISSION_DENIED
}

/** @type {{lat: number, lng: number, accuracy: number}|null} Last shown fix. */
let lastUserFix = null;

/**
 * The position currently marked on the map, or null when none is shown.
 * Read-only; exposed as `__mvdGetUserLocation` for the e2e suite, which needs
 * to see the marker MOVE rather than merely exist.
 *
 * @returns {{lat: number, lng: number, accuracy: number}|null}
 */
export function getUserLocation() {
    return lastUserFix ? { ...lastUserFix } : null;
}

/** Draws (or moves) the "you are here" marker and its accuracy circle. */
function drawUserLocation(latlng, accuracy) {
    if (userLocationLayer) map.removeLayer(userLocationLayer);
    lastUserFix = { lat: latlng.lat, lng: latlng.lng, accuracy };

    const accent = '#3b82f6'; // --accent
    userLocationLayer = L.layerGroup([
        L.circle(latlng, {
            radius: accuracy,
            color: accent,
            weight: 1,
            opacity: 0.4,
            fillColor: accent,
            fillOpacity: 0.1,
            interactive: false,
        }),
        L.marker(latlng, {
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
}

/** Camera state the follow policy compares against. */
function cameraState() {
    const c = map.getCenter();
    return { hash: location.hash, lat: c.lat, lng: c.lng, zoom: map.getZoom() };
}

/** One position request. The camera move is decided in the handler. */
function requestPosition() {
    map.locate({
        enableHighAccuracy: true,
        timeout: CONFIG.GEOLOCATION_TIMEOUT_MS,
        maximumAge: CONFIG.GEOLOCATION_MAX_AGE_MS,
    });
}

/** Polling runs only while the page is visible — a backgrounded tab is not read. */
function onVisibilityChange() {
    if (!locationTracking) return;
    if (document.visibilityState === 'hidden') {
        if (locationTimer !== null) clearInterval(locationTimer);
        locationTimer = null;
        return;
    }
    if (locationTimer === null) {
        // Coming back to the app after it was hidden: the shown position is as
        // old as the pause, so refresh at once rather than at the next tick.
        requestPosition();
        locationTimer = setInterval(requestPosition, CONFIG.GEOLOCATION_REFRESH_MS);
    }
}

/**
 * Tracks the user's position for the session: centres the map on the first fix,
 * drops a "you are here" marker, and re-reads the position every
 * GEOLOCATION_REFRESH_MS so the marker keeps up during a ride. Called on mobile
 * at startup.
 *
 * A single startup fix was the original behaviour and it is useless mid-journey:
 * the rider boards, and from then on the dot marks where they got on rather than
 * where they are, so the only way to find out was to reload the page.
 *
 * Fails silently: if the user denies permission or the device has no
 * geolocation, the default city view is kept and nothing is shown — we never
 * surface the app's error overlay for this optional convenience.
 */
export function locateUser() {
    if (!map || locationTracking) return;
    locationTracking = true;

    // What the camera is allowed to be moved away from. The first fix can land
    // up to the full timeout later — a slowly answered permission prompt, a cold
    // GPS — and app.js gates only the REQUEST on the initial view being home,
    // never the answer. By the time it arrives the rider may have opened a line
    // or panned, and moving the camera then breaks the very "never yank the
    // camera away from a deep link" rule the request is gated on. Comparing hash
    // AND camera covers both: navigating away changes the hash, panning or
    // zooming in place changes the camera.
    if (!followAnchor) followAnchor = cameraState();

    /** Last error reported, so a denied permission is not logged every poll. */
    let lastErrorCode = null;
    /** Whether the previous fix was outside the service area (same reason). */
    let wasOutside = false;

    map.on('locationfound', (e) => {
        lastErrorCode = null;

        // Service-area gate (brainstorm-007): a visitor located outside
        // Montevideo keeps the default city overview — centring on them
        // would show an empty map with no stops or routes. No marker either:
        // it would sit off-screen.
        if (!isWithinBounds(e.latlng.lat, e.latlng.lng, CONFIG.CITY_BOUNDS)) {
            if (!wasOutside) {
                console.info(
                    '[geolocation] ubicación fuera de Montevideo — se mantiene la vista general',
                );
                wasOutside = true;
            }
            if (userLocationLayer) {
                map.removeLayer(userLocationLayer);
                userLocationLayer = null;
                lastUserFix = null;
            }
            return;
        }
        wasOutside = false;

        // The marker goes up either way — knowing where you are is useful on
        // any view. Only the camera move is conditional.
        if (!cameraLeftAnchor(followAnchor, cameraState())) {
            map.setView(e.latlng, CONFIG.GEOLOCATION_MAX_ZOOM);
            // Anchor on where we asked the camera to go, not on where it is
            // right now: a zoom animation may still be in flight.
            followAnchor = {
                hash: location.hash,
                lat: e.latlng.lat,
                lng: e.latlng.lng,
                zoom: CONFIG.GEOLOCATION_MAX_ZOOM,
            };
        }

        drawUserLocation(e.latlng, e.accuracy);
        updateLocateControl({ busy: false });
    });

    map.on('locationerror', (err) => {
        if (err.code !== lastErrorCode) {
            console.warn('[geolocation] no se pudo obtener la ubicación:', err.message);
            lastErrorCode = err.code;
        }
        // Retrying a denied permission every 30 s would never succeed and would
        // keep the GPS awake for nothing.
        const denied = isFatalLocationError(err.code);
        updateLocateControl({ busy: false, denied });
        if (denied) stopLocatingUser();
    });

    // The interval is armed BEFORE the first request on purpose: a denied
    // permission comes back synchronously from map.locate(), and stopping the
    // polling from inside that handler must find a timer to clear — otherwise
    // the interval is created afterwards and keeps asking forever.
    locationTimer = setInterval(requestPosition, CONFIG.GEOLOCATION_REFRESH_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    requestPosition();
}

/** Stops the position polling. Leaves the last marker in place. */
export function stopLocatingUser() {
    if (locationTimer !== null) clearInterval(locationTimer);
    locationTimer = null;
    locationTracking = false;
    followAnchor = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (map) map.off('locationfound').off('locationerror');
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
 * Journey-planning wiring for stop popups. Registered once by app.js instead
 * of threaded through every render signature: popup content is regenerated on
 * each open, so the buttons always reflect the current plan state.
 *
 * @type {{role: (code: number) => 'origin'|'destination'|'none',
 *         onPickOrigin: (code: number) => void,
 *         onPickDestination: (code: number) => void,
 *         onClearRole: (code: number) => void}|null}
 */
let journeyHandlers = null;

/** @param {typeof journeyHandlers} handlers - null disables the popup buttons */
export function setJourneyPopupHandlers(handlers) {
    journeyHandlers = handlers;
}

/**
 * The two journey buttons of a stop popup: "from here" / "to here".
 *
 * Both are always offered — a rider may pick the destination first. Tapping
 * the role a stop already holds clears it, so the same control undoes itself
 * (no separate "cancel" hidden elsewhere).
 *
 * @param {number} cod - COD_UBIC_P
 * @returns {HTMLElement|null} null when no handlers are registered
 */
function buildJourneyActions(cod) {
    if (!journeyHandlers) return null;
    const role = journeyHandlers.role(cod);

    const wrap = document.createElement('div');
    wrap.className = 'popup-journey';

    const makeButton = (kind, active, onPick) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn btn-quiet journey-${kind}-btn${active ? ' active' : ''}`;
        btn.textContent = active ? t(`journey.${kind}Clear`) : t(`journey.${kind}`);
        btn.setAttribute(
            'aria-label',
            active ? t(`journey.${kind}ClearAria`) : t(`journey.${kind}Aria`),
        );
        btn.setAttribute('aria-pressed', String(active));
        btn.addEventListener('click', () => {
            if (active) journeyHandlers.onClearRole(cod);
            else onPick(cod);
            map?.closePopup();
        });
        return btn;
    };

    wrap.append(
        makeButton('from', role === 'origin', journeyHandlers.onPickOrigin),
        makeButton('to', role === 'destination', journeyHandlers.onPickDestination),
    );
    return wrap;
}

/**
 * Builds the popup DOM node for a stop feature.
 * Wires up the "Ver rutas" button via event delegation to avoid listener leaks.
 *
 * @param {object} feature - GeoJSON Feature
 * @param {Function} onShowRoutes - callback(linesArr, variantsArr, feature)
 * @returns {HTMLElement}
 */
export function createStopPopup(feature, onShowRoutes) {
    const { COD_UBIC_P: cod } = feature.properties;
    const { calle, esquina } = stopStreets(feature.properties);
    const linesArr = stopLinesMap.has(cod)
        ? Array.from(stopLinesMap.get(cod)).sort((a, b) =>
              a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
          )
        : [];
    const variantsArr = stopVariantsMap.has(cod) ? Array.from(stopVariantsMap.get(cod)) : [];
    const linesLabel = tPlural('popup.lines', linesArr.length);

    const div = document.createElement('div');
    div.className = 'popup-content';
    // No corner clause at all when the cross street is unknown — printing the
    // sentinel was worse than saying nothing, and worse still outside Spanish.
    const corner = esquina ? `${t('popup.corner', { esquina: escapeHTML(esquina) })} · ` : '';
    div.innerHTML = `
        <h3>${escapeHTML(calle ?? t('stop.unknownStreet'))}</h3>
        <p class="popup-sub">${corner}${t('popup.stop', { cod: escapeHTML(cod) })} · ${linesLabel}</p>
        <ul class="popup-lines" role="list"></ul>
        <button type="button" class="btn draw-lines-btn"
            aria-label="${t('popup.viewAllAria')}">${t('popup.viewAll')}</button>
    `;

    // One tappable chip per line: shows JUST that line downstream from here.
    const list = div.querySelector('.popup-lines');
    for (const line of linesArr) {
        const li = document.createElement('li');
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'line-chip';
        chip.textContent = line;
        const color = getLineColor(line);
        chip.style.borderColor = color;
        chip.style.color = color;
        chip.setAttribute('aria-label', t('popup.chipAria', { id: line }));
        chip.addEventListener('click', () => {
            onShowRoutes([line], getStopLineVariants(cod, line), feature);
            map?.closePopup();
        });
        li.appendChild(chip);
        list.appendChild(li);
    }

    div.querySelector('.draw-lines-btn').addEventListener('click', () => {
        onShowRoutes(linesArr, variantsArr, feature);
        map?.closePopup();
    });

    const journeyActions = buildJourneyActions(cod);
    if (journeyActions) div.appendChild(journeyActions);

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
        this.setStyle({ fillColor: stopColors().activeFill });
        this.bringToFront();
    });

    layer.on('mouseout', function () {
        // Only reset if it's not the currently selected stop
        if (appState.selectedStopLayer !== this) {
            this.setStyle({ fillColor: stopColors().fill });
        }
    });

    layer.on('click', function () {
        // Reset previous selected stop
        if (appState.selectedStopLayer && appState.selectedStopLayer !== this) {
            appState.selectedStopLayer.setStyle({ fillColor: stopColors().fill });
        }
        // Set new selected stop
        this.setStyle({ fillColor: stopColors().activeFill });
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
    appState.lastRender = { type: 'global', args: { onShowRoutes } };
    const touch = isCoarsePointer();
    const style = getStopStyleForZoom(map.getZoom(), touch);

    appState.globalStopsLayer = L.geoJSON(
        { type: 'FeatureCollection', features: uniqueStopsData },
        {
            pointToLayer: (_feature, latlng) =>
                L.circleMarker(latlng, {
                    ...style,
                    fillColor: stopColors().fill,
                    color: stopColors().stroke,
                    pane: 'stopsPane',
                }),
            onEachFeature: (feature, layer) => {
                layer.bindPopup(() => createStopPopup(feature, onShowRoutes), { maxWidth: 340 });
                setupStopListeners(layer);
            },
        },
    ).addTo(map);
}

/**
 * Pans/zooms to a stop and opens its popup on the global-stops layer — the
 * landing action for `#/parada/<code>` deep links and stop search picks
 * (also the keyboard path to a popup: canvas markers are not focusable).
 * The caller must have rendered the global stops first.
 *
 * @param {number} code - COD_UBIC_P
 * @returns {boolean} false when the stop is unknown
 */
export function focusStop(code) {
    const target = uniqueStopByCode.get(code);
    if (!target || !map) return false;
    const [lon, lat] = target.geometry.coordinates;
    map.setView([lat, lon], Math.max(map.getZoom(), CONFIG.STOP_FOCUS_ZOOM));
    appState.globalStopsLayer?.eachLayer((layer) => {
        if (layer.feature?.properties?.COD_UBIC_P === code) layer.openPopup();
    });
    return true;
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
export function trimToStops(coords, variantId) {
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

    // All near-minimal projections of a point onto the trace, as fractional
    // positions i+t along the segment list (shared primitive, rule
    // R-PROJECT). A loop route passes a terminal stop twice, so the nearest
    // projection alone can select a tiny arc of the trace; collecting every
    // candidate within ~10 m of the minimum and then maximizing the covered
    // span keeps the whole revenue route. (Projection onto segments — not
    // vertices — also stays exact on the Douglas–Peucker-simplified traces
    // where vertices are hundreds of meters apart on straight avenues.)
    const candidatesNear = (pt) => projectionCandidates(pt, coords, 1e-4); // slack ≈ 10 m

    const startCandidates = candidatesNear(first.feature.geometry.coordinates);
    const endCandidates = candidatesNear(last.feature.geometry.coordinates);

    let best = null;
    for (const a of startCandidates) {
        const pa = a.i + a.t;
        for (const b of endCandidates) {
            const pb = b.i + b.t;
            const span = Math.abs(pb - pa);
            if (!best || span > best.span) {
                best = pa <= pb ? { span, from: a, to: b } : { span, from: b, to: a };
            }
        }
    }
    if (!best || best.span === 0) return coords;

    const out = [pointAt(coords, best.from.i, best.from.t)];
    for (let i = best.from.i + 1; i <= best.to.i; i++) out.push(coords[i]);
    out.push(pointAt(coords, best.to.i, best.to.t));
    return out;
}

/**
 * Clones and cleans a route feature's geometry.
 * Uses shallow clone + geometry-only cloning instead of structuredClone
 * for better performance on large GeoJSON datasets.
 *
 * Exported for the route-invariant test suite (tests/js/route-invariants.test.js),
 * which runs the real prepare→bundle pipeline over the committed data.
 *
 * @param {object} f - original GeoJSON Feature
 * @param {number[]|null} sourceLonLat - if set, truncate route from this point
 * @returns {object|null} cleaned feature, or null if geometry becomes empty
 */
export function prepareRouteFeature(f, sourceLonLat) {
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
                // Strands only. A joint brought to the front stays there — the
                // off-branch below restores weight and opacity but Leaflet has
                // no "back where it was" — so one hover would leave this line's
                // connectors drawn over every strand until the next full
                // re-render: exactly the colored knot bringToBack() exists to
                // prevent (see renderRouteJoints).
                if (!l._jointFor) l.bringToFront();
            } else {
                l.setStyle({ weight: l._baseWeight, opacity: CONFIG.ROUTE_OPACITY });
            }
        }
    };

    appState.currentRouteLayer = L.featureGroup().addTo(map);

    for (const sec of sections) {
        const latlngs = sec.coords.map(([lon, lat]) => [lat, lon]);
        const total = sec.lines.length;

        sec.lines.forEach((lineId, idx) => {
            const variants = [...(sec.variantsByLine.get(lineId) ?? [])].sort();

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
            layer._baseWeight = weight;

            // Content function: regenerated on every open, so a language
            // switch is picked up without re-binding.
            layer.bindPopup(() => {
                const variantsRow = variants.length
                    ? `<p>${tPlural('section.variants', variants.length, {
                          list: escapeHTML(variants.join(', ')),
                      })}</p>`
                    : '';
                return `
                <div class="popup-content">
                    <h3>${t('section.title', { id: escapeHTML(lineId) })}</h3>
                    ${variantsRow}
                </div>
            `;
            });
            layer.on('mouseover', () => setLineHighlight(lineId, true));
            layer.on('mouseout', () => setLineHighlight(lineId, false));

            if (!layersByLine.has(lineId)) layersByLine.set(lineId, []);
            layersByLine.get(lineId).push(layer);
            layer.addTo(appState.currentRouteLayer);
        });
    }

    // Stitch strands across section boundaries so every line stays visually
    // continuous through corners and slot changes (brainstorm-005). Joints are
    // non-interactive (the strands own popups/hover) but join the line's
    // highlight group so hover thickens them too.
    for (const j of buildJoints(sections)) {
        const layer = new OffsetJoint(
            [
                [j.a.neighbor[1], j.a.neighbor[0]],
                [j.node[1], j.node[0]],
                [j.b.neighbor[1], j.b.neighbor[0]],
            ],
            {
                color: getLineColor(j.line),
                weight,
                opacity: CONFIG.ROUTE_OPACITY,
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false,
                jointA: { nodeIsEnd: j.a.nodeIsEnd, slot: { idx: j.a.idx, total: j.a.total } },
                jointB: { nodeIsEnd: j.b.nodeIsEnd, slot: { idx: j.b.idx, total: j.b.total } },
                offsetFor: (slot, z) => getLineOffset(slot.idx, slot.total, z, weight),
            },
        );
        layer._jointFor = j.line;
        layer._baseWeight = weight;

        if (!layersByLine.has(j.line)) layersByLine.set(j.line, []);
        layersByLine.get(j.line).push(layer);
        layer.addTo(appState.currentRouteLayer);
        // Joints render UNDER the strands: where sections overlap at a node
        // the connectors of several lines cross each other and read as a
        // colored knot; beneath the strands they stay visible only inside
        // the corner wedge they exist to fill (user report at 26 de Marzo y
        // Miguel Barreiro).
        layer.bringToBack();
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
                    fillColor: stopColors().fill,
                    color: stopColors().stroke,
                    pane: 'stopsPane',
                }),
            onEachFeature: (feature, layer) => {
                layer.bindPopup(() => createStopPopup(feature, onShowRoutes), { maxWidth: 340 });
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
 * @param {boolean} [options.fit] - frame the result; false when only re-colouring
 * @returns {{ variantCount: number, stopCount: number }}
 */
export function renderRoutes({
    lineIds,
    variantsArr = null,
    sourceFeature = null,
    onShowRoutes,
    fit = true,
}) {
    clearLayers();
    appState.lastRender = {
        type: 'routes',
        args: { lineIds, variantsArr, sourceFeature, onShowRoutes },
    };
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
    if (fit && !sourceFeature && appState.currentRouteLayer?.getLayers().length) {
        map.fitBounds(appState.currentRouteLayer.getBounds(), {
            padding: CONFIG.FIT_BOUNDS_PADDING,
            maxZoom: CONFIG.FIT_BOUNDS_MAX_ZOOM,
        });
    }

    // --- Return stats for UI ---
    const variantCount = new Set(cleanedRouteFeatures.map((f) => f.properties.DESC_VARIA)).size;

    return { variantCount, stopCount: stopFeatures.length };
}

// ---------------------------------------------------------------------------
// Journey rendering (stop → stop itinerary, see journey.js)
// ---------------------------------------------------------------------------

/** Journey palette for the active theme. */
const journeyColors = () => CONFIG.JOURNEY_COLORS_BY_THEME[getTheme()];

/**
 * Size of the per-stop beads along a ride leg, by zoom — the same
 * zoom-tiered treatment the plain stop layer gets (getStopStyleForZoom), for
 * the same reason: at city zoom the stops of a route are a few pixels apart
 * and full-size markers turn the leg into a bead necklace.
 *
 * @param {number} zoom
 * @param {boolean} isTouch
 * @returns {object} Leaflet path style
 */
function journeyBeadStyle(zoom, isTouch) {
    if (zoom <= 13) return { radius: isTouch ? 2 : 1.5, weight: 1, opacity: 0.9, fillOpacity: 1 };
    if (zoom <= 14) return { radius: isTouch ? 4 : 3, weight: 1.5, opacity: 1, fillOpacity: 1 };
    return { radius: isTouch ? 6 : 4.5, weight: 2, opacity: 1, fillOpacity: 1 };
}

/**
 * fitBounds padding that keeps an itinerary clear of the floating UI panel.
 *
 * Leaflet pads against the map viewport, but `#ui-panel` sits ON TOP of it —
 * 320 px of it on desktop. Framing a cross-city trip with symmetric padding
 * therefore hides the "A" end behind the panel, which is precisely the thing
 * a journey view must show. Measured from the live element so it follows the
 * desktop card / mobile bottom-sheet split without duplicating the breakpoint.
 *
 * @returns {{paddingTopLeft: number[], paddingBottomRight: number[]}}
 */
function journeyFitPadding() {
    const [padX, padY] = CONFIG.FIT_BOUNDS_PADDING;
    const rect = document.getElementById('ui-panel')?.getBoundingClientRect();
    const size = map.getSize();
    if (!rect?.width || !size.x || !size.y) {
        return { paddingTopLeft: [padX, padY], paddingBottomRight: [padX, padY] };
    }
    // Never eat more than this share of the viewport: an over-padded fit
    // zooms the whole city out to nothing. The mobile sheet gets the looser
    // cap because it legitimately covers half the screen while an itinerary
    // is listed, and the ends must still land in the strip above it.
    const cap = (value, extent, share) => Math.min(value, extent * share);

    if (rect.width > window.innerWidth * 0.8) {
        // Bottom sheet (mobile): the panel covers the lower edge.
        return {
            paddingTopLeft: [padX, padY],
            paddingBottomRight: [padX, cap(rect.height + padY, size.y, 0.62)],
        };
    }
    return {
        paddingTopLeft: [cap(rect.right + padX, size.x, 0.5), padY],
        paddingBottomRight: [padX, padY],
    };
}

/** [lon, lat] of a stop code, or null when the stop is unknown. */
const stopLatLng = (code) => {
    const feature = uniqueStopByCode.get(Number(code));
    if (!feature) return null;
    const [lon, lat] = feature.geometry.coordinates;
    return [lat, lon];
};

/** A|B endpoint pin, or a small hollow dot for a transfer point. */
function journeyMarker(latlng, kind, label) {
    const endpoint = kind === 'origin' || kind === 'destination';
    const size = endpoint ? 26 : 14;
    return L.marker(latlng, {
        icon: L.divIcon({
            className: '',
            html: `<div class="journey-marker journey-marker-${kind}">${escapeHTML(label ?? '')}</div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: endpoint ? 1200 : 1100,
    });
}

/**
 * Draws one itinerary: every ride leg in its line's identity colour along the
 * recorded trace, every walk leg as a dashed connector, with A/B endpoints and
 * a dot at each transfer.
 *
 * A ride leg whose trace cannot serve it (missing geometry — none in the
 * committed data, but the contract allows it) is drawn as a dashed straight
 * connector rather than an invented path, so an approximation never looks like
 * a real recorded route.
 *
 * @param {object} options
 * @param {import('./journey.js').JourneyOption} options.option
 * @param {number} options.fromCode
 * @param {number} options.toCode
 * @param {Function} options.onShowRoutes - popup callback for the stop markers
 * @param {boolean} [options.fit=true] - fit the camera to the itinerary
 * @returns {{legCount: number, approximateLegs: number}}
 */
export function renderJourney({ option, fromCode, toCode, onShowRoutes, fit = true }) {
    clearLayers();
    appState.lastRender = {
        type: 'journey',
        args: { option, fromCode, toCode, onShowRoutes, fit },
    };

    const colors = journeyColors();
    const routeLayer = L.featureGroup().addTo(map);
    const stopsLayer = L.layerGroup().addTo(map);
    appState.currentRouteLayer = routeLayer;
    appState.currentStopsLayer = stopsLayer;

    let approximateLegs = 0;

    for (const leg of option.legs) {
        if (leg.type === 'walk') {
            const a = stopLatLng(leg.fromCode);
            const b = stopLatLng(leg.toCode);
            if (!a || !b) continue;
            L.polyline([a, b], {
                color: colors.walk,
                weight: CONFIG.JOURNEY_WALK_WEIGHT,
                opacity: 0.95,
                lineCap: 'round',
                dashArray: CONFIG.JOURNEY_WALK_DASH,
                interactive: false,
            }).addTo(routeLayer);
            continue;
        }

        const traced = rideLegGeometry(leg.variantId, leg.boardIdx, leg.alightIdx);
        const approximate = !traced;
        if (approximate) approximateLegs++;

        const latlngs = traced
            ? traced.map(([lon, lat]) => [lat, lon])
            : [stopLatLng(leg.fromCode), stopLatLng(leg.toCode)].filter(Boolean);
        if (latlngs.length < 2) continue;

        // Casing first (under), then the identity-coloured stroke.
        L.polyline(latlngs, {
            color: colors.casing,
            weight: CONFIG.JOURNEY_CASING_WEIGHT,
            opacity: 0.85,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
        }).addTo(routeLayer);

        const ride = L.polyline(latlngs, {
            color: getLineColor(leg.line),
            weight: CONFIG.JOURNEY_RIDE_WEIGHT,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round',
            dashArray: approximate ? CONFIG.JOURNEY_WALK_DASH : undefined,
        }).addTo(routeLayer);
        ride.bindPopup(() => {
            const headsign = leg.headsign
                ? `<p>${t('journey.towards', { headsign: escapeHTML(leg.headsign) })}</p>`
                : '';
            return `
                <div class="popup-content">
                    <h3>${t('section.title', { id: escapeHTML(leg.line) })}</h3>
                    ${headsign}
                    <p>${tPlural('journey.legStops', leg.stopCodes.length - 1)}</p>
                </div>
            `;
        });

        // Every stop the rider passes, so the leg can be followed on the map.
        for (const code of leg.stopCodes) {
            const feature = uniqueStopByCode.get(Number(code));
            if (!feature) continue;
            const [lon, lat] = feature.geometry.coordinates;
            // Hollow beads: filled with the basemap's own background, stroked
            // in the line's colour. Filled with the line colour instead they
            // merge with the stroke and the leg reads as a dotted chain rather
            // than a continuous ride. Sized by zoom for the same reason —
            // stops are ~270 m apart, which is 17 px at zoom 13.
            const marker = L.circleMarker([lat, lon], {
                ...journeyBeadStyle(map.getZoom(), isCoarsePointer()),
                color: getLineColor(leg.line),
                fillColor: colors.casing,
                pane: 'stopsPane',
            }).addTo(stopsLayer);
            marker._journeyBead = true;
            marker.bindPopup(() => createStopPopup(feature, onShowRoutes), { maxWidth: 340 });
        }
    }

    // Transfer dots: where one ride ends and the next begins. Keyed on "a ride
    // came before", not on the leg index — most itineraries open with an access
    // walk, and testing `i === 0` put a transfer dot on the FIRST ride's
    // boarding stop, so the map drew option.transfers + 1 dots while the panel
    // itemised option.transfers.
    let seenRide = false;
    for (const leg of option.legs) {
        if (leg.type !== 'ride') continue;
        if (seenRide) {
            const latlng = stopLatLng(leg.fromCode);
            if (latlng) journeyMarker(latlng, 'transfer').addTo(stopsLayer);
        }
        seenRide = true;
    }

    const origin = stopLatLng(fromCode);
    const destination = stopLatLng(toCode);
    if (origin) journeyMarker(origin, 'origin', 'A').addTo(stopsLayer);
    if (destination) journeyMarker(destination, 'destination', 'B').addTo(stopsLayer);

    if (fit && routeLayer.getLayers().length) {
        map.fitBounds(routeLayer.getBounds(), {
            ...journeyFitPadding(),
            maxZoom: CONFIG.JOURNEY_FIT_MAX_ZOOM,
        });
    }

    return { legCount: option.legs.length, approximateLegs };
}

/**
 * Shows the two stops a rider has picked so far while the plan is still
 * incomplete (only an origin, or only a destination). Keeps the home view's
 * stop layer underneath so the second stop is still pickable.
 *
 * @param {{fromCode: number|null, toCode: number|null, onShowRoutes: Function}} options
 */
export function renderJourneyEndpoints({ fromCode, toCode, onShowRoutes }) {
    renderGlobalStops(onShowRoutes);
    // R8 — the camera stays put: the rider just tapped a stop, it is on screen.
    const pins = L.layerGroup().addTo(map);
    appState.currentStopsLayer = pins;
    appState.lastRender = {
        type: 'journey-endpoints',
        args: { fromCode, toCode, onShowRoutes },
    };

    const origin = fromCode == null ? null : stopLatLng(fromCode);
    const destination = toCode == null ? null : stopLatLng(toCode);
    if (origin) journeyMarker(origin, 'origin', 'A').addTo(pins);
    if (destination) journeyMarker(destination, 'destination', 'B').addTo(pins);
}
