export const CONFIG = {
    LABEL_CLUSTER_THRESHOLD_DEG: 0.0005, // ~50 meters
    GOLDEN_RATIO: 0.618033988749895,
    MAP_CENTER: [-34.88, -56.16],
    MAP_ZOOM: 12,
    MAX_ZOOM: 19,
    ROUTE_WEIGHT_SINGLE: 4,
    ROUTE_WEIGHT_MULTI: 2.5,
    ROUTE_OPACITY: 0.9,
    ROUTE_HOVER_WEIGHT: 5,
    // --- Route bundling (see bundling.js) ---
    // Vertices of different variants closer than this collapse into one shared
    // "street node" (~13 m). Must stay well below half the typical distance
    // between parallel streets (~85 m blocks in Montevideo) so distinct streets
    // never merge, yet above the ~1–5 m jitter between variant traces.
    BUNDLE_TOLERANCE_DEG: 0.00013,
    // Corridor polylines are simplified (Douglas–Peucker) with this tolerance
    // (~4 m) to iron out the ±2–3 m jitter of averaged street nodes.
    BUNDLE_SIMPLIFY_EPS_DEG: 0.00004,
    // Gap (px) between parallel lines of a bundle at high zoom.
    ROUTE_BUNDLE_GAP_PX: 1,
    // Cap on the total width (px) of a bundle: with many lines the per-line
    // spacing shrinks so the outermost offsets stay small enough that the
    // PolylineOffset plugin doesn't curl corners into loops.
    ROUTE_MAX_SPREAD_PX: 36,
    // Below this zoom all lines of a bundle collapse onto the street centreline.
    ROUTE_OFFSET_MIN_ZOOM: 15,
    ROUTE_SMOOTH_FACTOR: 1,
    STOP_GLOBAL_RADIUS: 3,
    STOP_ROUTE_RADIUS: 5,
    STOP_HOVER_RADIUS: 5,
    HIGHLIGHT_STOP_SIZE: 20,
    FIT_BOUNDS_PADDING: [50, 50],
    FIT_BOUNDS_MAX_ZOOM: 15,
    // Auto-geolocation (mobile only): how far to zoom in when centring on the user.
    GEOLOCATION_MAX_ZOOM: 16,
    SELECT_CHANGE_DEBOUNCE_MS: 150,

    // Touch / coarse-pointer overrides
    // clickTolerance: how many px away from a feature a touch can land and still register
    // Leaflet default is 3; we use a much larger value on mobile.
    CLICK_TOLERANCE_TOUCH: 20,
    TAP_TOLERANCE_TOUCH: 30,
    // Visual radii for touch — slightly larger so stops are more discoverable,
    // while staying visually clean (not the full 44px — that would clutter the map).
    STOP_GLOBAL_RADIUS_TOUCH: 6,    // global view  (desktop: 3)
    STOP_ROUTE_RADIUS_TOUCH: 9,     // route view   (desktop: 5)
    STOP_HOVER_RADIUS_TOUCH: 9,     // hover target  (desktop: 5)
    DATA_URLS: {
        ROUTES: 'routes.json',
        STOPS: 'stops.json',
    },
};
