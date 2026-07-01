export const CONFIG = {
    LABEL_CLUSTER_THRESHOLD_DEG: 0.0005, // ~50 meters
    GOLDEN_RATIO: 0.618033988749895,
    MAP_CENTER: [-34.88, -56.16],
    MAP_ZOOM: 12,
    MAX_ZOOM: 19,
    ROUTE_WEIGHT_SINGLE: 4,
    ROUTE_WEIGHT_MULTI: 2,
    ROUTE_OPACITY: 0.8,
    ROUTE_HOVER_WEIGHT: 6,
    // Parallel-line offset between routes sharing a street. Deliberately tiny:
    // the leaflet-polylineoffset plugin curls lines into loops at sharp turns /
    // U-turns, and the loop size grows with the offset. A 1px offset gives a hint
    // of separation while keeping any residual loop sub-pixel. Only applied at
    // zoom >= ROUTE_OFFSET_MIN_ZOOM, where the pixel geometry is large enough that
    // ordinary bends don't loop at all.
    ROUTE_SPACING: 1,
    // Cap the total px spread of a bundle at 2px, so the outermost line is never
    // offset more than ±1px however many lines share the stop. This keeps any
    // residual loop at a U-turn sub-pixel (within the line's own stroke width).
    ROUTE_MAX_OFFSET_SPREAD: 2,
    ROUTE_OFFSET_MIN_ZOOM: 16,
    ROUTE_SMOOTH_FACTOR: 2,
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
