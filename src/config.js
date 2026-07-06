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
    // Sized to merge the ida/vuelta digitisation offset of one line into a
    // single corridor (measured up to ~22 m on line 104); adjacent parallel
    // streets are ≥80 m apart, far outside the radius (brainstorm/report 104).
    BUNDLE_TOLERANCE_DEG: 0.00022,
    // Corridor polylines are simplified (Douglas–Peucker) with this tolerance
    // (~4 m) to iron out the ±2–3 m jitter of averaged street nodes.
    BUNDLE_SIMPLIFY_EPS_DEG: 0.00004,
    // Laplacian passes over each corridor before simplification — cancels the
    // sawtooth left where merged opposite-direction strands alternate nodes.
    // Guards: only vertices flanked by sawtooth-scale segments move (sparse
    // peripheral traces have km-long legs whose corners must stay put), and
    // no vertex shifts more than ~11 m.
    BUNDLE_SMOOTH_PASSES: 2,
    BUNDLE_SMOOTH_MAX_SEG_DEG: 0.0006,
    BUNDLE_SMOOTH_MAX_SHIFT_DEG: 0.0001,
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
    // Deep links / stop search: zoom used when landing on a single stop.
    STOP_FOCUS_ZOOM: 17,
    // Service area gate for auto-geolocation: bounding box of all stops in
    // the committed data (lat -34.9271…-34.7167, lon -56.4048…-55.9955) plus
    // a ~2 km buffer for GPS drift. A mobile visitor located OUTSIDE this box
    // (tourists, friends abroad) keeps the default city overview instead of
    // being flown to an empty map (brainstorm-007).
    CITY_BOUNDS: { south: -34.95, west: -56.43, north: -34.69, east: -55.97 },
    // Data freshness label turns amber when the dataset is older than this.
    FRESHNESS_WARN_DAYS: 45,

    // --- Theme (light/dark by real sunrise/sunset, see theme.js) ---
    // Basemap per theme (same CARTO CDN, same attribution).
    TILE_URLS: {
        dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    },
    // Browser chrome color (meta theme-color), matches --bg-color per theme.
    THEME_META_COLORS: { dark: '#0f172a', light: '#f1f5f9' },
    // Route line colors: same deterministic hue per line, but lightness and
    // saturation tuned per background so lines hold contrast on both maps.
    LINE_COLOR_BY_THEME: {
        dark: { saturation: 85, lightness: 60 },
        light: { saturation: 70, lightness: 42 },
    },
    // Stop marker palette per theme (fill/stroke flip; active = hover/selected).
    STOP_COLORS_BY_THEME: {
        dark: { fill: '#000000', stroke: '#ffffff', activeFill: '#ffffff' },
        light: { fill: '#ffffff', stroke: '#1e293b', activeFill: '#1e293b' },
    },
    // Fallback light window (local hours) if solar math ever fails.
    THEME_FALLBACK_LIGHT_HOURS: [7, 19],

    // Touch / coarse-pointer overrides
    // clickTolerance: how many px away from a feature a touch can land and still register
    // Leaflet default is 3; we use a much larger value on mobile.
    CLICK_TOLERANCE_TOUCH: 20,
    TAP_TOLERANCE_TOUCH: 30,
    // Visual radii for touch — slightly larger so stops are more discoverable,
    // while staying visually clean (not the full 44px — that would clutter the map).
    STOP_GLOBAL_RADIUS_TOUCH: 6, // global view  (desktop: 3)
    STOP_ROUTE_RADIUS_TOUCH: 9, // route view   (desktop: 5)
    STOP_HOVER_RADIUS_TOUCH: 9, // hover target  (desktop: 5)
    DATA_URLS: {
        ROUTES: 'routes.json',
        STOPS: 'stops.json',
    },
};
