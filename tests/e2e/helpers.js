/** Shared fixtures for the render e2e suites. */
import { expect, test } from '@playwright/test';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo root, which the app's URL paths map onto. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Where index.html loads Leaflet from: unpkg, the version pinned and SRI-checked.
 * Bump it together with index.html and the devDependency: a URL the page no
 * longer requests leaves openMap's route idle and the suite quietly back on
 * the network.
 */
const LEAFLET_URL = 'https://unpkg.com/leaflet@1.9.4/dist/';

/**
 * The same files from the `leaflet` devDependency, pinned to the same version
 * in package.json. Resolved rather than joined onto ROOT, so a checkout that
 * has not run `npm install` since the dependency was added fails here, at
 * import, instead of every test timing out on the loader.
 */
const LEAFLET_DIST = dirname(createRequire(import.meta.url).resolve('leaflet/dist/leaflet.js'));

/**
 * Opens the map with a pinned theme and language, external network stubbed
 * out (Esri tiles + Google Fonts aborted → deterministic canvas, no flake),
 * the app's own files and Leaflet served from disk, and waits until data +
 * initial render are done.
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
    await page.route('https://services.arcgisonline.com/**', (r) => r.abort());
    await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
    await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
    // The app's own files come from disk, not over loopback TCP. On Windows
    // Chromium now and then fails to open a loopback connection at all
    // (net::ERR_NO_BUFFER_SPACE; the request never reaches the server): a lost
    // module kept the loader up until the wait below timed out, a lost data
    // fetch showed the error overlay. It is not the server — measured against
    // python's http.server and against a keep-alive Node server alike — so the
    // fix is to need no connection. The route lives as long as the page, which
    // covers a test's own reload() and goBack() too.
    await page.route(`${test.info().project.use.baseURL}/**`, serveFromDisk);
    // Leaflet too: unpkg was the suite's last network dependency, one external
    // connection per test that can be lost the same way, with the CDN's own
    // uptime on top. The devDependency ships the files unpkg serves, byte for
    // byte, and the page still checks them against index.html's SRI hashes.
    // The stylesheet's images (images/layers.png …) resolve under the same URL,
    // so they come from here as well.
    await page.route(`${LEAFLET_URL}**`, serveLeaflet);

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

/** Answers a same-origin request with the repo file its path names. */
function serveFromDisk(route) {
    const { pathname } = new URL(route.request().url());
    const file = join(ROOT, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    return fulfillFile(route, file);
}

/** Answers a request for one of Leaflet's CDN files with the devDependency's copy. */
function serveLeaflet(route) {
    // The route's pattern guarantees the prefix; what follows is a dist path.
    const file = join(LEAFLET_DIST, route.request().url().slice(LEAFLET_URL.length));
    return fulfillFile(route, file);
}

/** Fulfils a route with a file from disk, or with a 404 when there is none. */
function fulfillFile(route, file) {
    return statSync(file, { throwIfNoEntry: false })?.isFile()
        ? route.fulfill({ path: file })
        : route.fulfill({ status: 404 });
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
 * Renders ONE line downstream from a stop, exactly as tapping its popup chip
 * would — the view where travel direction is well defined, so the chevrons show.
 */
export async function renderDownstream(page, stopCode, line) {
    await page.evaluate(
        ([c, l]) => {
            location.hash = `#/parada/${c}/linea/${encodeURIComponent(l)}`;
        },
        [stopCode, line],
    );
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    await page.waitForFunction(
        () => !window.__mvdMap._animatingZoom && !window.__mvdMap._panAnim?._inProgress,
    );
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

/**
 * Fixed camera for corridor scenes (no animation → deterministic pixels), with
 * the move verified against the map itself.
 *
 * The assertion is the point. Leaflet silently drops a setView issued during a
 * zoom animation, which once left all three corridor-zoom scenes recording the
 * plain fit-bounds camera instead of zoom 12/15/17, on both platforms (PR #6).
 * Pixels are the wrong detector for that: the same line at two zoom levels
 * differs by ~12k px, which sailed under the old 2 % budget. So a dropped camera
 * move now fails here, on the camera, whatever the screenshot tolerance is.
 */
export async function setView(page, center, zoom) {
    await page.evaluate(
        ([c, z]) => {
            window.__mvdMap.setView(c, z, { animate: false });
        },
        [center, zoom],
    );
    await page.waitForTimeout(300); // canvas redraw settle

    const camera = await page.evaluate(() => {
        const c = window.__mvdMap.getCenter();
        return { zoom: window.__mvdMap.getZoom(), lat: c.lat, lng: c.lng };
    });
    expect(camera.zoom, 'setView zoom was dropped').toBe(zoom);
    expect(camera.lat, 'setView latitude was dropped').toBeCloseTo(center[0], 4);
    expect(camera.lng, 'setView longitude was dropped').toBeCloseTo(center[1], 4);
}

// ---------------------------------------------------------------------------
// The committed dataset, as an oracle
// ---------------------------------------------------------------------------
//
// Facts about the data, read from the files the page itself loads and never
// from the app's indexes, so they stay independent of the code under test. A
// feed update legitimately moves them — stop 4772 went from 34 to 33 lines when
// Ce2 retired on 2026-10-09 — and every spec that froze one as a literal failed
// that update as if the app had broken. "The dataset changed" has exactly one
// canary: the frozen shape in tests/js/route-invariants.test.js.

/** The lines whose stop patterns call at a stop, sorted. */
export function datasetLinesAtStop(page, stopCode) {
    return page.evaluate(async (code) => {
        const { patterns } = await (await fetch('/stops.json')).json();
        const lines = new Set();
        for (const { linea, paradas } of Object.values(patterns)) {
            if (paradas.some(([cod]) => cod === code)) lines.add(linea);
        }
        return [...lines].sort();
    }, stopCode);
}

/** Every line the dataset carries, sorted. */
export function datasetLines(page) {
    return page.evaluate(async () => {
        const { features } = await (await fetch('/routes.json')).json();
        return [...new Set(features.map((f) => f.properties.DESC_LINEA))].sort();
    });
}

/** The headsigns (`DESC_VARIA`) a line's variants carry, sorted; blanks are none. */
export function datasetHeadsigns(page, lineId) {
    return page.evaluate(async (line) => {
        const { features } = await (await fetch('/routes.json')).json();
        const headsigns = features
            .filter((f) => f.properties.DESC_LINEA === line)
            .map((f) => f.properties.DESC_VARIA)
            .filter(Boolean);
        return [...new Set(headsigns)].sort();
    }, lineId);
}
