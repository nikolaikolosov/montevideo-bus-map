export const CONFIG = {
    BAD_STOP_COORDS: [-56.169029, -34.918964],
    BAD_STOP_REMOVE_RADIUS_DEG: 0.003, // ~300 meters
    LABEL_CLUSTER_THRESHOLD_DEG: 0.0005, // ~50 meters
    GOLDEN_RATIO: 0.618033988749895,
    MAP_CENTER: [-34.88, -56.16],
    MAP_ZOOM: 12,
    MAX_ZOOM: 19,
    ROUTE_WEIGHT_SINGLE: 4,
    ROUTE_WEIGHT_MULTI: 3,
    ROUTE_OPACITY: 0.8,
    ROUTE_HOVER_WEIGHT: 6,
    STOP_GLOBAL_RADIUS: 3,
    STOP_ROUTE_RADIUS: 5,
    STOP_HOVER_RADIUS: 5,
    HIGHLIGHT_STOP_SIZE: 20,
    FIT_BOUNDS_PADDING: [50, 50],
    FIT_BOUNDS_MAX_ZOOM: 15,
    SELECT_CHANGE_DEBOUNCE_MS: 150,
    BAD_STOP_STREET: 'AV DR JUAN ANDRES CACHON',
    BAD_STOP_CORNER: 'AV JULIO MARIA SOSA',

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
