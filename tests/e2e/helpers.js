/** Shared fixtures for the render e2e suites. */

/**
 * Opens the map with a pinned theme and language, external network stubbed
 * out (CARTO tiles + Google Fonts aborted → deterministic canvas, no flake),
 * and waits until data + initial render are done.
 */
export async function openMap(page, { theme = 'dark', lang = 'es' } = {}) {
    await page.addInitScript(
        ([t, l]) => {
            // Pin the theme regardless of wall-clock time (far-future expiry)
            // and the language regardless of the runner's browser locale —
            // otherwise an en-US CI runner would auto-detect English and
            // shift every baseline. Init scripts re-run on reload, so a test
            // that exercises language persistence passes lang: false to keep
            // the user's stored choice untouched.
            localStorage.setItem(
                'mvd-theme-override',
                JSON.stringify({ theme: t, expiresAt: 9e15 }),
            );
            if (l) localStorage.setItem('mvd-lang', l);
        },
        [theme, lang],
    );
    await page.route('https://*.basemaps.cartocdn.com/**', (r) => r.abort());
    await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
    await page.route('https://fonts.gstatic.com/**', (r) => r.abort());

    await page.goto('/');
    await page.waitForFunction(
        () =>
            window.__mvdMap &&
            typeof window.__mvdGetRenderState === 'function' &&
            document.getElementById('loader').style.display === 'none',
        undefined,
        { timeout: 60_000 },
    );

    // Kill Leaflet zoom animations for the whole session. An animated
    // fitBounds (renderRoutes) only flips _animatingZoom inside a queued
    // requestAnimationFrame, so a setView issued in that gap is silently
    // reverted when the frame fires — the camera ends wherever fitBounds was
    // headed. With _zoomAnimated off every zoom change applies synchronously.
    await page.evaluate(() => {
        window.__mvdMap._zoomAnimated = false;
    });
}

/** Renders a line exactly as the dropdown would and waits for its corridors. */
export async function renderLine(page, line) {
    await page.evaluate((l) => window.__mvdSelectLine(l), line);
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    // renderRoutes ends with an animated fitBounds. While that zoom animation
    // is in flight, Leaflet silently ignores a later setView (even with
    // animate: false — _tryAnimatedZoom returns true while _animatingZoom is
    // set), so wait for the camera to go idle before the caller repositions it.
    await page.waitForFunction(
        () => !window.__mvdMap._animatingZoom && !window.__mvdMap._panAnim?._inProgress,
    );
}

/** Triggers the "Ver rutas" view for a stop and waits for the render. */
export async function renderStopRoutes(page, stopCode) {
    const found = await page.evaluate((c) => window.__mvdShowStopRoutes(c), stopCode);
    if (!found) throw new Error(`stop ${stopCode} not found`);
    // Terminal-only stops legitimately render 0 sections; just yield a tick.
    await page.waitForTimeout(300);
}

/**
 * Plans a stop-to-stop journey exactly as the popup buttons would and waits
 * for the itinerary to be drawn and the camera to settle (renderJourney ends
 * with an animated fitBounds — same trap as renderLine).
 */
export async function planJourney(page, from, to, option = 0) {
    const found = await page.evaluate(
        ([f, t, o]) => window.__mvdPlanJourney(f, t, o),
        [from, to, option],
    );
    if (!found) throw new Error(`stop ${from} or ${to} not found`);
    await page.waitForSelector('#journeyPanel:not([hidden])');
    await page.waitForFunction(
        () => !window.__mvdMap._animatingZoom && !window.__mvdMap._panAnim?._inProgress,
    );
}

/**
 * Opens the Leaflet popup of a stop in the current (global) view.
 *
 * `center: true` re-frames the map on the stop first. Leaflet's autoPan only
 * knows about the map viewport, but `#ui-panel` floats ON TOP of it, so a
 * popup anchored in the top-left corner opens underneath the panel and is not
 * clickable. Pass it whenever the test interacts with the popup's controls.
 */
export async function openStopPopup(page, stopCode, { center = false } = {}) {
    await page.evaluate(
        ([cod, recentre]) => {
            let target = null;
            window.__mvdMap.eachLayer((l) => {
                if (l.feature?.properties?.COD_UBIC_P === cod) target = l;
            });
            if (!target) throw new Error(`stop layer ${cod} not found`);
            if (recentre) window.__mvdMap.setView(target.getLatLng(), 16, { animate: false });
            target.openPopup();
        },
        [stopCode, center],
    );
    await page.waitForSelector('.popup-content');
    // Leaflet fades a closing popup out over ~200 ms before detaching its
    // node, so right after a re-open two popups can coexist in the DOM and
    // every selector inside one of them matches twice. Wait for the old one
    // to actually go.
    await page.waitForFunction(() => document.querySelectorAll('.leaflet-popup').length === 1);
}

/** Fixed camera for corridor scenes (no animation → deterministic pixels). */
export async function setView(page, center, zoom) {
    await page.evaluate(
        ([c, z]) => {
            window.__mvdMap.setView(c, z, { animate: false });
        },
        [center, zoom],
    );
    await page.waitForTimeout(300); // canvas redraw settle
}
