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
