/** Shared fixtures for the render e2e suites. */

/**
 * Opens the map with a pinned theme, external network stubbed out
 * (CARTO tiles + Google Fonts aborted → deterministic canvas, no flake),
 * and waits until data + initial render are done.
 */
export async function openMap(page, { theme = 'dark' } = {}) {
    await page.addInitScript((t) => {
        // Pin the theme regardless of wall-clock time (far-future expiry).
        localStorage.setItem('mvd-theme-override', JSON.stringify({ theme: t, expiresAt: 9e15 }));
    }, theme);
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
}

/** Renders a line exactly as the dropdown would and waits for its corridors. */
export async function renderLine(page, line) {
    await page.evaluate((l) => window.__mvdSelectLine(l), line);
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
}

/** Triggers the "Ver rutas" view for a stop and waits for the render. */
export async function renderStopRoutes(page, stopCode) {
    const found = await page.evaluate((c) => window.__mvdShowStopRoutes(c), stopCode);
    if (!found) throw new Error(`stop ${stopCode} not found`);
    // Terminal-only stops legitimately render 0 sections; just yield a tick.
    await page.waitForTimeout(300);
}

/** Opens the Leaflet popup of a stop in the current (global) view. */
export async function openStopPopup(page, stopCode) {
    await page.evaluate((cod) => {
        let target = null;
        window.__mvdMap.eachLayer((l) => {
            if (l.feature?.properties?.COD_UBIC_P === cod) target = l;
        });
        if (!target) throw new Error(`stop layer ${cod} not found`);
        target.openPopup();
    }, stopCode);
    await page.waitForSelector('.popup-content');
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
