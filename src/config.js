export const CONFIG = {
    // Route labels cluster in SCREEN space, not on the ground: the old 50 m
    // threshold is sub-pixel at city zoom, so a line's endpoint labels piled up
    // on top of each other — measured on a Pixel 7, line 405 showed 12 chips all
    // reading "405" with the closest pair 3 px apart (F5 in design/ux-review-001).
    // 48 px is a touch target's worth of separation: closer than that and two
    // chips are the same place as far as a rider is concerned.
    LABEL_MIN_GAP_PX: 48,
    // All-stops view: below this zoom only one ring per STOP_THIN_CELL_PX grid
    // cell is DRAWN (ux-review-001 X4, finding F6). Measured on a Pixel 7
    // viewport, every one of the 4,901 rings is inside the viewport at zoom 10
    // and 3,121 at zoom 12 — a solid field that answers no question.
    //
    // The stops that are not drawn stay IN the layer with radius 0. Removing
    // them was tried first and reverted: a stop that is not a layer cannot be
    // opened, so search-for-a-stop and deep-link-to-a-stop silently did nothing
    // for most stops reached from the city view. The ring can be hidden; the
    // stop cannot stop existing.
    //
    // This is therefore a decluttering change, not a performance one. Measured
    // canvas redraw at zoom 10: 1.7 ms with all 4,901 drawn, 1.7 ms with 86 % of
    // them at radius 0, 0.0 ms with them removed — the cost is per layer, not
    // per pixel, so keeping them costs the frame nothing to reclaim.
    STOP_THIN_MAX_ZOOM: 12,
    STOP_THIN_CELL_PX: 22,
    // Direction chevrons (ux-review-001 R8, finding F4). Spacing is in SCREEN
    // pixels for the same reason label clustering is: a ground spacing would
    // crowd at city zoom and vanish at street zoom. Only the arrows inside the
    // padded viewport are built, so the count follows the screen, not the route
    // length — a 10 km trace at zoom 17 would otherwise want hundreds.
    ARROW_GAP_PX: 110,
    ARROW_VIEWPORT_PAD_PX: 60,
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
    // How often the position is re-read. NOT a constant: the cadence needed to
    // keep the map honest differs by ~4x between riding and standing, so it is
    // derived from the rider's own speed (see nextRefreshMs in map.js).
    //
    // The criterion is "the shown position still implies the right stop": the
    // nearest-stop reading flips once you are more than halfway to the next
    // stop, so the fix may not go stale by more than half a stop gap. Measured
    // over all 59,751 consecutive stop pairs in the committed data, the p10 gap
    // is 177 m (median 268 m) — half of it is the budget below. Deriving from
    // p10 rather than the median keeps the dense downtown honest, which is
    // exactly where riders need it. Method and tables:
    // qa/reports/geolocation-cadence-report.md.
    GEOLOCATION_STALE_BUDGET_M: 88,
    // Floor: at 10 s the budget already holds on 99.3 % of stop pairs while
    // riding, and halving the interval again to 5 s buys 0.7 pp for double the
    // fixes — the curve has flattened, so this is where paying more stops
    // buying anything.
    GEOLOCATION_MIN_REFRESH_MS: 10_000,
    // Cap: standing still, position does not change, so the only reason to poll
    // is to notice that motion resumed — and this bounds that latency to one
    // interval. At walking speed 45 s still holds the budget on 99.1 % of pairs.
    GEOLOCATION_MAX_REFRESH_MS: 45_000,
    // Before a second fix there is no speed to derive from. 15 s is the fixed
    // cadence that would hold the budget on 92.5 % of pairs while riding, i.e.
    // the safe assumption until the rider's actual speed is known.
    GEOLOCATION_FIRST_REFRESH_MS: 15_000,
    // How long to wait for a fix before giving up on one poll. Well under the
    // refresh interval so a slow answer cannot overlap the next request.
    GEOLOCATION_TIMEOUT_MS: 10_000,
    // Every poll must produce a NEW reading: allowing a cached fix means the
    // browser can answer a 30 s poll with the position it already returned,
    // which is exactly the staleness this refresh exists to remove. The
    // interval is the throttle; the cache must not be a second one.
    GEOLOCATION_MAX_AGE_MS: 0,
    // --- Live tracking (mobile only) ---------------------------------------
    // On a coarse-pointer device the position is tracked CONTINUOUSLY at 1 Hz
    // instead of the duty-cycled poll above: a `watchPosition` session, which
    // is what keeps a phone's receiver engaged and pushes every fix it makes,
    // with the reads below as the cadence floor when the platform only pushes
    // on change. Asked for by the user on 2026-07-28, overriding the measured
    // policy in qa/reports/geolocation-cadence-report.md, which had rejected
    // 1 s as ~20x the reads for the last 10 pp of stop correctness. The
    // desktop locate control keeps the adaptive cadence — the ride scenario
    // this serves is the phone's.
    GEOLOCATION_LIVE_INTERVAL_MS: 1000,
    // Fixes arriving faster than the cadence are dropped, but the gate sits
    // BELOW one interval on purpose: a platform pushing at a nominal 1 Hz
    // jitters either side of 1000 ms, and gating exactly at 1000 ms would drop
    // every second fix and halve the delivered cadence.
    GEOLOCATION_LIVE_MIN_GAP_MS: 750,
    // Cache age accepted by the cadence floor's top-up reads. Within one
    // interval the watch's own last fix IS the answer being asked for, so
    // waking the receiver a second time for it buys nothing. (The polling
    // path keeps maximumAge 0 — there the interval is long enough that a
    // cached fix would be exactly the staleness it exists to remove.)
    GEOLOCATION_LIVE_MAX_AGE_MS: 1000,
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

    // --- Journey planning (stop → stop with transfers, see journey.js) -------
    // The feed carries NO timetable (no trips, no headways, no run times), so
    // every duration below is an explicit, documented ESTIMATE — the planner
    // ranks itineraries, it does not promise arrival times. The UI labels
    // results as approximate for exactly this reason.
    //
    // In-vehicle speed: Montevideo urban bus average including traffic and
    // signals, excluding stop dwell (which is added per stop below).
    JOURNEY_BUS_SPEED_KMH: 20,
    // Dwell added for every stop the bus serves along a ride leg.
    JOURNEY_DWELL_SECONDS: 15,
    // Walking speed for transfer/access legs.
    JOURNEY_WALK_SPEED_KMH: 4.5,
    // Straight-line stop-to-stop distance underestimates the path actually
    // travelled. Two different corrections:
    //  - bus: MEASURED on the committed data — the traced route length between
    //    consecutive stops over all 59,745 stop pairs is 1.054 × the straight
    //    line (median 1.00, p95 1.36; method + numbers in
    //    qa/reports/journey-planner-report.md). Stops are ~270 m apart, so the
    //    ride between two of them is nearly straight.
    //  - walk: no measurement possible from this data. 1.3 is the textbook
    //    rectilinear-grid detour (4/π ≈ 1.27 for uniformly distributed
    //    directions), which is what central Montevideo is.
    JOURNEY_BUS_DETOUR_FACTOR: 1.05,
    JOURNEY_WALK_DETOUR_FACTOR: 1.3,
    // Cost of every boarding (first one included): the unknown wait. With no
    // headway data this is a flat penalty — it also encodes "a transfer is
    // worse than staying seated", which is what keeps itineraries sane.
    JOURNEY_BOARD_PENALTY_SECONDS: 300,
    // Farthest a transfer/access walk may be (meters, straight line). 400 m
    // yields ~53k directed footpath edges over the 4901 committed stops.
    JOURNEY_WALK_MAX_M: 400,
    // Search rounds. Round k allows k ride legs, so 4 rounds = up to 3
    // transfers — beyond that an itinerary is not a realistic suggestion.
    JOURNEY_MAX_ROUNDS: 4,
    // How many itineraries the panel offers, and how much slower than the
    // best one an alternative may be before it is dropped.
    JOURNEY_MAX_OPTIONS: 4,
    JOURNEY_OPTION_SLACK_RATIO: 1.6,
    JOURNEY_OPTION_SLACK_SECONDS: 600,
    // Journey rendering. The casing is a wide stroke drawn under the coloured
    // ride line in the basemap's own background colour, so a line keeps its
    // identity colour readable where it runs over dense street geometry.
    JOURNEY_RIDE_WEIGHT: 6,
    JOURNEY_CASING_WEIGHT: 10,
    JOURNEY_WALK_WEIGHT: 3,
    JOURNEY_WALK_DASH: '1 7',
    JOURNEY_COLORS_BY_THEME: {
        dark: { casing: '#0f172a', walk: '#cbd5e1' },
        light: { casing: '#ffffff', walk: '#334155' },
    },
    JOURNEY_FIT_MAX_ZOOM: 16,

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
