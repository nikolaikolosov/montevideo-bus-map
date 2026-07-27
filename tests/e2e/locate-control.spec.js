/**
 * "Show my location" control (design/user-flows F8b).
 *
 * Position tracking deliberately stops following the camera once anything else
 * moves it — a pan, or opening a line — so the framing the rider chose survives.
 * Until this control there was no way to ask for the camera back, and on desktop
 * no way to be located at all, since the automatic request is mobile-only.
 *
 * The control must therefore: recentre on demand, RESUME following so later
 * refreshes keep up, request nothing until pressed on desktop, and say so when
 * the permission is refused.
 */
import { test, expect, devices } from '@playwright/test';
import { openMap, setView } from './helpers.js';

const REFRESH_MS = 30_000; // CONFIG.GEOLOCATION_REFRESH_MS
const BOARDED = { latitude: -34.9055, longitude: -56.187 }; // 18 de Julio y Ejido
const MOVED = { latitude: -34.9012, longitude: -56.1662 }; // ~2 km along

// devices[] carries defaultBrowserType, which Playwright forbids inside a
// describe group (it would force a new worker) — drop it and keep the rest.
const PIXEL_7 = { ...devices['Pixel 7'] };
delete PIXEL_7.defaultBrowserType;

const userLocation = (page) => page.evaluate(() => window.__mvdGetUserLocation());
const camera = (page) =>
    page.evaluate(() => ({
        zoom: window.__mvdMap.getZoom(),
        lat: window.__mvdMap.getCenter().lat,
        lng: window.__mvdMap.getCenter().lng,
    }));

test.describe('on mobile', () => {
    test.use({ ...PIXEL_7, permissions: ['geolocation'] });

    test('brings the camera back after the rider has panned away', async ({ page, context }) => {
        await context.setGeolocation(BOARDED);
        await openMap(page, { theme: 'dark' });
        await expect.poll(() => userLocation(page)).not.toBeNull();

        // The rider looks somewhere else — following stops by design.
        await setView(page, [-34.8875, -56.1046], 14);
        await expect(page.locator('.locate-control')).not.toHaveClass(/is-following/);

        await page.click('.locate-control');

        const back = await camera(page);
        expect(back.zoom).toBe(16); // CONFIG.GEOLOCATION_MAX_ZOOM
        expect(back.lat).toBeCloseTo(BOARDED.latitude, 4);
        expect(back.lng).toBeCloseTo(BOARDED.longitude, 4);
        await expect(page.locator('.locate-control')).toHaveClass(/is-following/);
    });

    test('resumes following, so the next refresh keeps up too', async ({ page, context }) => {
        // Recentring once would not be enough: the rider presses this DURING a
        // ride, and thirty seconds later the bus has moved again.
        await page.clock.install();
        await context.setGeolocation(BOARDED);
        await openMap(page, { theme: 'dark' });
        await expect.poll(() => userLocation(page)).not.toBeNull();

        await setView(page, [-34.8875, -56.1046], 14);
        await page.click('.locate-control');

        await context.setGeolocation(MOVED);
        await page.clock.fastForward(REFRESH_MS);

        await expect
            .poll(async () => (await camera(page)).lat, { timeout: 15_000 })
            .toBeCloseTo(MOVED.latitude, 3);
        const after = await camera(page);
        expect(after.lng).toBeCloseTo(MOVED.longitude, 3);
    });

    test('carries an accessible name, not just an icon', async ({ page, context }) => {
        // The control is icon-only, so the label IS the name for a screen
        // reader; it is also translated, hence the data-i18n-aria attribute.
        await context.setGeolocation(BOARDED);
        await openMap(page, { theme: 'dark' });
        const control = page.locator('.locate-control');
        await expect(control).toBeEnabled();
        await expect(control).toHaveAttribute('aria-label', /ubicación/i);
        await expect(control).toHaveAttribute('data-i18n-aria', 'map.locateAria');
    });
});

test.describe('on desktop', () => {
    test.use({ permissions: ['geolocation'] });

    test('requests nothing until the control is pressed, then locates', async ({
        page,
        context,
    }) => {
        // The automatic request stays mobile-only: a desktop visitor must not
        // get a permission prompt they did not ask for.
        await context.setGeolocation(BOARDED);
        await page.addInitScript(() => {
            window.__geoCalls = 0;
            const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
            navigator.geolocation.getCurrentPosition = (ok, err, opts) => {
                window.__geoCalls += 1;
                real(ok, err, opts);
            };
        });

        await openMap(page, { theme: 'dark' });
        expect(await page.evaluate(() => window.__geoCalls)).toBe(0);
        await expect(page.locator('.user-location-marker')).toHaveCount(0);

        await page.click('.locate-control');

        await expect(page.locator('.user-location-marker')).toHaveCount(1, { timeout: 15_000 });
        const view = await camera(page);
        expect(view.zoom).toBe(16);
        expect(view.lat).toBeCloseTo(BOARDED.latitude, 4);
    });

    test('says so when the permission is refused, instead of failing silently', async ({
        page,
    }) => {
        await page.addInitScript(() => {
            navigator.geolocation.getCurrentPosition = (ok, err) => {
                err({ code: 1, message: 'User denied Geolocation' });
            };
        });
        await openMap(page, { theme: 'dark' });

        const control = page.locator('.locate-control');
        await expect(control).toBeEnabled();
        await control.click();

        await expect(control).toBeDisabled();
        await expect(control).toHaveAttribute('title', /permiso|denied|запрещ/i);
    });
});
