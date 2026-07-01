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
    ROUTE_SPACING: 3,
    // Cap the total px spread of a parallel-line bundle. With many lines through
    // one stop, an uncapped spread (spacing × lines) fans the outer lines out so
    // far that the PolylineOffset plugin curls them into loops at every bend.
    // Capping the spread keeps offsets small enough to avoid loops; dense bundles
    // simply overlap (you can't visually separate 20+ lines a few px apart anyway).
    ROUTE_MAX_OFFSET_SPREAD: 14,
    // smoothFactor (DP simplification tolerance). Denser bundles get more
    // simplification: fewer/longer segments means fewer corners for offsets to loop on.
    ROUTE_SMOOTH_FACTOR: 2,
    ROUTE_SMOOTH_FACTOR_DENSE: 4,
    ROUTE_DENSE_THRESHOLD: 6, // lines count at/above which a bundle is "dense"
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
