# Route Render Verification — Method

> Date: 2026-07-05 · Owner: qa-lead / test-automation-engineer
> Origin: brainstorm-002 (full package ratified). Configs committed alongside
> per qa rules: `playwright.config.js`, `vitest.config.js`, suites under `tests/`.

Three layers, each catching what the others can't (`preferCanvas: true` means
route lines are canvas pixels — DOM assertions can't see them):

## Layer 1 — Construction invariants & oracles (every `npm test`, seconds)

`tests/js/route-invariants.test.js` runs the REAL committed data through the
production pipeline (`prepareRouteFeature` → `buildSections`) for all 140 lines
/ 1,083 variants and asserts:

- **Stops-on-route oracle** (relative): every stop of a line lies ≤ ~60 m from
  the line's corridors — unless the RAW API shape is itself far from the stop
  (~54 stop-line pairs in the 2026-06 data, mostly "L*" local lines); then the
  pipeline must simply not be worse than the raw data (+ ~20 m slack).
- **Vertex containment**: no prepared-trace vertex strays > ~20 m from a
  corridor (nothing dropped by bundling).
- **Length band**: corridors cover ≥ 50 % of the longest variant (out-and-back
  dedup) and never exceed the variant sum.
- **Connectivity**: ≤ 3 corridor components per line.
- **Trim endpoints**: trimmed variant ends land ≤ ~120 m from the first/last
  stop (residual = real curb-to-centreline offset at terminal plazas).
- **Frozen edge cases**: 4018 (15 lines/37 variants), 4967 (terminal → no
  downstream geometry), 187 (spur must survive), dataset cardinalities.

Tolerances are calibrated against the 2026-06-27 dataset and documented next
to each constant in the test file. Run standalone: `npm run verify:routes`.

**Found on introduction:** the vertex-snapping `trimToStops` truncated loop
variants almost entirely (variant 8908 kept 0.9 % of its trace; corridors ended
up 1.6 km from served stops) and undershot DP-simplified terminals by ~170 m.
Fixed by segment-projection + span-maximizing candidate selection
(`src/map.js:trimToStops`); 8908 now keeps 98.5 %.

## Layer 2 — Whole-map golden sweep (every PR, ~10 s)

`tests/e2e/render-sweep.spec.js` (Playwright, headless Chromium, tiles/fonts
blocked, theme pinned dark): renders ALL 140 lines via the
`window.__mvdSelectLine` hook and captures `window.__mvdGetRenderState()` — a
deterministic manifest per line (corridor count, total points, colors, weights,
bbox, stop/label counts) — compared to `tests/e2e/golden/render-manifest.json`.

Update after an intentional rendering change:
`UPDATE_GOLDEN=1 npx playwright test render-sweep` (review the JSON diff in the PR).

## Layer 3 — Curated pixel scenes (every PR, ~20 s)

`tests/e2e/visual.spec.js`: 20 screenshots — global stops + Línea 100 in BOTH
themes, stop 4018 downstream (both themes), terminal 4967 (empty-render edge),
line 187 spur, the 18 de Julio corridor at zooms 12/15/17 (parallel-offset
engagement at 15), the 34-chip popup of stop 4772 in both themes, the
Artigas→Ellauri corner joints, two downstream-fidelity stops, the Cyrillic
panel, and a two-transfer itinerary in both themes.

**Comparison budget (revised 2026-07-25).** The budget is absolute —
`maxDiffPixels: 120` — because a *ratio* was measured against the wrong
denominator. 2 % of the 1280×800 page is 20,480 px, while the map ink a scene
actually contains is far less: 774 px for stop-4018-downstream, 4,614 for
corridor-zoom-12, 7,077 for journey-1000-1480, 9,568 for linea-100-dark, up to
42,729 for global-stops (counted as non-transparent canvas pixels). Eight of
thirteen measured scenes could therefore lose their ENTIRE route render and still
match their baseline — verified with the real comparator by hiding the Leaflet
overlay/marker panes: linea-100-dark, stop-4018-downstream-dark, corridor-zoom-12
and journey-1000-1480-dark all PASSED blanked at 2 %, and all four fail at 120.
The same slack made the corridor-zoom scenes interchangeable: rendering zoom 17
against the zoom-15 baseline differs by 11,879 px, which passed at 2 %.

120 px is derived, not guessed: with tiles and fonts blocked and animations
disabled the canvas is deterministic — two full zero-tolerance runs of all 20
scenes differed by 0 px — so 120 is pure headroom for anti-aliasing noise on a
platform that cannot be measured from here, and still 6× below the weakest
scene's ink.

**Camera, not pixels, guards the camera.** `setView()` in `tests/e2e/helpers.js`
now asserts `getZoom()`/`getCenter()` after the move. Removing either
zoom-animation guard from the helpers makes all three corridor scenes fail with
"setView zoom was dropped — Expected 12/15/17, Received 13" (the fit-bounds
camera), instead of silently re-recording the wrong view as it did before PR #6.

**`#dataFreshness` is masked.** It prints the dataset's `generated_at` date and
turns amber `FRESHNESS_WARN_DAYS` after it, so an unmasked baseline rots twice
over: every data update rewrites ~300 px, and the colour flips on its own with
the passage of time. Both hid under the old budget — the committed baselines
still said "27 de junio" against data generated on 6 July.

Popup interactions have their own functional spec
(`tests/e2e/popup-actions.spec.js`): chip counts at the busiest stop, chip
click → single-line render (one color in the manifest, stats/select synced),
"Ver rutas (todas)" → full bundle. Unit-level popup coverage (chip order,
colors, per-line variant payload, XSS escaping, chips==stopLinesMap invariant)
lives in `tests/js/popup.test.js`.

- Baselines are platform-suffixed (`…-win32.png`, `…-linux.png`) under
  `tests/e2e/__screenshots__/`, committed to the repo.
- CI runs `--update-snapshots=missing`: the first run on a new platform creates
  its baselines and uploads them as the `screenshot-baselines` artifact —
  download and commit them; from then on comparison is strict.
- Update after an intentional visual change: `npm run test:e2e:update` (which
  passes `--update-snapshots=all`). Plain `--update-snapshots` only rewrites
  baselines that already fail, so any change smaller than the tolerance would be
  silently kept — which is how the stale "27 de junio" freshness label survived.
- Known-correct data oddities are deliberately part of the baselines:
  Terminal Cerro driveway diagonals, line 187's out-and-back spur, ida/vuelta
  double strands on wide avenues.

## Representativeness & limits

- Data-dependent: suites verify the committed dataset; a data update changes
  layer-1 statistics (tolerances have headroom) and REQUIRES regenerating the
  layer-2 golden + reviewing layer-3 diffs. Since the freshness label is masked,
  a data update no longer moves layer-3 pixels for the date alone — only real
  geometry changes show up.
- External CDN (unpkg Leaflet) still loads in e2e — SRI-pinned; tiles/fonts do not.
- Not covered: touch interactions, geolocation flows, mobile layout pixels.
