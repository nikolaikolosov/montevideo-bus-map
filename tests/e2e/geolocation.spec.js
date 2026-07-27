/**
 * Mobile auto-geolocation e2e (brainstorm-007).
 *
 * Runs under mobile emulation (coarse pointer triggers locateUser at startup)
 * with Playwright's geolocation mock:
 *  - a fix INSIDE Montevideo centres the map on the user at
 *    GEOLOCATION_MAX_ZOOM and drops the "you are here" marker;
 *  - a fix OUTSIDE the service area (a friend abroad opening a shared link)
 *    leaves the default city overview untouched and shows no marker.
 */
import { test, expect, devices } from '@playwright/test';
import { openMap, renderLine, setView } from './helpers.js';

// CONFIG.GEOLOCATION_REFRESH_MS — the period under test.
const CONFIG_REFRESH_MS = 30_000;

// Pixel 7 profile: isMobile + hasTouch → (pointer: coarse) matches, which is
// exactly the condition app.js uses to start locateUser.
test.use({
    ...devices['Pixel 7'],
    permissions: ['geolocation'],
});

test('a fix inside Montevideo centres the map on the user', async ({ page, context }) => {
    await context.setGeolocation({ latitude: -34.9055, longitude: -56.187 }); // 18 de Julio y Ejido
    await openMap(page, { theme: 'dark' });

    // The marker is the observable end of the locate round-trip.
    await expect(page.locator('.user-location-marker')).toHaveCount(1);

    const view = await page.evaluate(() => ({
        center: window.__mvdMap.getCenter(),
        zoom: window.__mvdMap.getZoom(),
    }));
    expect(view.zoom).toBe(16); // CONFIG.GEOLOCATION_MAX_ZOOM
    expect(view.center.lat).toBeCloseTo(-34.9055, 3);
    expect(view.center.lng).toBeCloseTo(-56.187, 3);
});

test('a fix outside Montevideo keeps the default city overview', async ({ page, context }) => {
    await context.setGeolocation({ latitude: -34.6037, longitude: -58.3816 }); // Buenos Aires

    const consoleNotes = [];
    page.on('console', (msg) => {
        if (msg.text().includes('[geolocation]')) consoleNotes.push(msg.text());
    });

    await openMap(page, { theme: 'dark' });
    const before = await page.evaluate(() => ({
        center: window.__mvdMap.getCenter(),
        zoom: window.__mvdMap.getZoom(),
    }));

    // The out-of-town path logs a note instead of moving the camera — wait
    // for it so the assertion below isn't racing the locate round-trip.
    await expect.poll(() => consoleNotes.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(consoleNotes[0]).toContain('fuera de Montevideo');

    const after = await page.evaluate(() => ({
        center: window.__mvdMap.getCenter(),
        zoom: window.__mvdMap.getZoom(),
    }));
    // Camera unchanged: still the mid-zoom city overview, not Buenos Aires.
    expect(after.zoom).toBe(before.zoom);
    expect(after.center.lat).toBeCloseTo(before.center.lat, 6);
    expect(after.center.lng).toBeCloseTo(before.center.lng, 6);
    expect(after.center.lng).toBeGreaterThan(-57); // nowhere near -58.38

    await expect(page.locator('.user-location-marker')).toHaveCount(0);
});

test('a late fix does not yank the camera off wherever the rider went', async ({
    page,
    context,
}) => {
    // app.js gates only the locate REQUEST on the initial view being home; the
    // answer can arrive up to the full 10 s timeout later (a slowly answered
    // permission prompt, a cold GPS), by which time the rider may be reading a
    // line. Moving the camera then breaks the same "never yank the camera away
    // from a deep link" rule the request is gated on.
    await context.setGeolocation({ latitude: -34.9055, longitude: -56.187 });
    await page.addInitScript(() => {
        const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        navigator.geolocation.getCurrentPosition = (ok, err, opts) => {
            setTimeout(() => real(ok, err, opts), 2500);
        };
    });

    await openMap(page, { theme: 'dark' });

    // Rider moves on while the fix is still pending.
    await renderLine(page, '100');
    await setView(page, [-34.8875, -56.1046], 15);
    const parked = await page.evaluate(() => ({
        zoom: window.__mvdMap.getZoom(),
        lat: window.__mvdMap.getCenter().lat,
        lng: window.__mvdMap.getCenter().lng,
        hash: location.hash,
    }));
    expect(parked.hash).toBe('#/linea/100');

    // The marker still goes up — that is what proves the fix landed, so this
    // test cannot pass by the geolocation round-trip never completing.
    await expect(page.locator('.user-location-marker')).toHaveCount(1, { timeout: 15_000 });

    const after = await page.evaluate(() => ({
        zoom: window.__mvdMap.getZoom(),
        lat: window.__mvdMap.getCenter().lat,
        lng: window.__mvdMap.getCenter().lng,
        hash: location.hash,
    }));
    expect(after.zoom, 'late fix moved the zoom').toBe(parked.zoom);
    expect(after.lat, 'late fix moved the centre').toBeCloseTo(parked.lat, 6);
    expect(after.lng, 'late fix moved the centre').toBeCloseTo(parked.lng, 6);
    expect(after.hash).toBe(parked.hash);
});

test('desktop (fine pointer) never asks for geolocation', async ({ browser }) => {
    // A separate context WITHOUT mobile emulation and WITHOUT the permission:
    // if the app requested geolocation here, the pending permission prompt
    // would surface as a locationerror console warning. Nothing must happen.
    const context = await browser.newContext();
    const page = await context.newPage();
    const geoNotes = [];
    page.on('console', (msg) => {
        if (msg.text().includes('[geolocation]')) geoNotes.push(msg.text());
    });
    await openMap(page, { theme: 'dark' });
    await page.waitForTimeout(1000);
    expect(geoNotes).toEqual([]);
    await context.close();
});

/**
 * Position tracking during a ride (user report, 2026-07-27).
 *
 * The original implementation took ONE fix at startup, so from the moment the
 * rider boarded, the dot marked where they got on rather than where they were —
 * the only way to find out was to reload the page. The position is now re-read
 * every CONFIG.GEOLOCATION_REFRESH_MS (30 s).
 *
 * Playwright's clock drives the real interval, so these tests pin the actual
 * configured period rather than a shortened test-only one.
 */

/** Counts geolocation reads and reports them as window.__geoCalls. */
const countGeoCalls = (page) =>
    page.addInitScript(() => {
        window.__geoCalls = 0;
        const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        navigator.geolocation.getCurrentPosition = (ok, err, opts) => {
            window.__geoCalls += 1;
            real(ok, err, opts);
        };
    });

const userLocation = (page) => page.evaluate(() => window.__mvdGetUserLocation());

test('the position keeps updating while the rider travels', async ({ page, context }) => {
    await page.clock.install();
    await context.setGeolocation({ latitude: -34.9055, longitude: -56.187 }); // 18 de Julio y Ejido
    await openMap(page, { theme: 'dark' });

    await expect.poll(() => userLocation(page)).not.toBeNull();
    const boarded = await userLocation(page);
    expect(boarded.lat).toBeCloseTo(-34.9055, 4);

    // The bus moves; nothing else happens — no reload, no interaction.
    await context.setGeolocation({ latitude: -34.9012, longitude: -56.1662 }); // ~2 km along
    await page.clock.fastForward(CONFIG_REFRESH_MS);

    await expect
        .poll(async () => (await userLocation(page)).lat, { timeout: 15_000 })
        .toBeCloseTo(-34.9012, 4);
    const moved = await userLocation(page);
    expect(moved.lng).toBeCloseTo(-56.1662, 4);
});

test('the chosen line stays framed while the dot keeps moving', async ({ page, context }) => {
    // The reported scenario end to end: locate, board, pick the line you are on
    // (which frames the whole route), then watch your position along it. The
    // camera must stay where the rider put it while the dot keeps updating.
    await page.clock.install();
    await context.setGeolocation({ latitude: -34.9055, longitude: -56.187 });
    await openMap(page, { theme: 'dark' });
    await expect.poll(() => userLocation(page)).not.toBeNull();

    await renderLine(page, '199');
    const framed = await page.evaluate(() => ({
        zoom: window.__mvdMap.getZoom(),
        lat: window.__mvdMap.getCenter().lat,
        lng: window.__mvdMap.getCenter().lng,
    }));

    await context.setGeolocation({ latitude: -34.9012, longitude: -56.1662 });
    await page.clock.fastForward(CONFIG_REFRESH_MS);

    await expect
        .poll(async () => (await userLocation(page)).lat, { timeout: 15_000 })
        .toBeCloseTo(-34.9012, 4);

    const after = await page.evaluate(() => ({
        zoom: window.__mvdMap.getZoom(),
        lat: window.__mvdMap.getCenter().lat,
        lng: window.__mvdMap.getCenter().lng,
    }));
    expect(after.zoom, 'refresh re-zoomed away from the line').toBe(framed.zoom);
    expect(after.lat, 'refresh re-centred away from the line').toBeCloseTo(framed.lat, 6);
    expect(after.lng, 'refresh re-centred away from the line').toBeCloseTo(framed.lng, 6);
});

test('a denied permission is not retried every 30 s', async ({ page }) => {
    await page.clock.install();
    await countGeoCalls(page);
    await page.addInitScript(() => {
        navigator.geolocation.getCurrentPosition = (ok, err) => {
            window.__geoCalls += 1;
            err({ code: 1, message: 'User denied Geolocation' });
        };
    });

    await openMap(page, { theme: 'dark' });
    await expect.poll(() => page.evaluate(() => window.__geoCalls)).toBe(1);

    await page.clock.fastForward(3 * CONFIG_REFRESH_MS);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__geoCalls)).toBe(1);
});

test('polling pauses while the page is hidden and refreshes on return', async ({
    page,
    context,
}) => {
    await page.clock.install();
    await countGeoCalls(page);
    await context.setGeolocation({ latitude: -34.9055, longitude: -56.187 });
    await openMap(page, { theme: 'dark' });
    await expect.poll(() => userLocation(page)).not.toBeNull();

    const setVisibility = (state) =>
        page.evaluate((s) => {
            Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        }, state);

    await setVisibility('hidden');
    const whileHidden = await page.evaluate(() => window.__geoCalls);
    await page.clock.fastForward(3 * CONFIG_REFRESH_MS);
    await page.waitForTimeout(200);
    expect(
        await page.evaluate(() => window.__geoCalls),
        'a backgrounded tab kept reading the GPS',
    ).toBe(whileHidden);

    // Coming back, the shown position is as old as the pause — refresh at once
    // instead of waiting out the rest of the interval.
    await setVisibility('visible');
    await expect.poll(() => page.evaluate(() => window.__geoCalls)).toBeGreaterThan(whileHidden);
});
