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

// Mobile tracks continuously at CONFIG.GEOLOCATION_LIVE_INTERVAL_MS (1 s), so
// any span past one second is a refresh; 30 s also clears the desktop poll's
// adaptive window (10–45 s) for the tests that exercise that path.
const CONFIG_REFRESH_MS = 30_000;
const LIVE_INTERVAL_MS = 1_000; // CONFIG.GEOLOCATION_LIVE_INTERVAL_MS

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

test.describe('desktop (fine pointer) startup', () => {
    // No mobile emulation and no permission: if the app requested geolocation
    // here, the refused permission would surface as a locationerror console
    // warning. Nothing must happen.
    //
    // These options are set through test.use rather than by opening a context
    // by hand, because the runner applies THIS FILE's test.use to contexts made
    // from the browser fixture too — a hand-rolled one is still a Pixel 7.
    test.use({
        viewport: { width: 1280, height: 800 },
        isMobile: false,
        hasTouch: false,
        deviceScaleFactor: 1,
        userAgent: undefined,
        permissions: [],
    });

    test('never asks for geolocation', async ({ page }) => {
        const geoNotes = [];
        page.on('console', (msg) => {
            if (msg.text().includes('[geolocation]')) geoNotes.push(msg.text());
        });
        await openMap(page, { theme: 'dark' });
        await page.waitForTimeout(1000);
        expect(geoNotes).toEqual([]);
        expect(await page.locator('.user-location-marker').count()).toBe(0);
    });
});

/**
 * Position tracking during a ride (user report, 2026-07-27; cadence raised on
 * mobile at the user's request, 2026-07-28).
 *
 * The original implementation took ONE fix at startup, so from the moment the
 * rider boarded, the dot marked where they got on rather than where they were —
 * the only way to find out was to reload the page.
 *
 * Mobile now tracks CONTINUOUSLY: a watchPosition session plus a 1 Hz floor
 * (CONFIG.GEOLOCATION_LIVE_INTERVAL_MS). The desktop locate control keeps the
 * speed-derived poll, which is exercised in its own test below.
 *
 * Playwright's clock drives the real intervals, so these tests pin the actual
 * configured periods rather than shortened test-only ones.
 */

/**
 * Instruments the geolocation API: window.__geoCalls counts one-shot reads,
 * __geoWatches collects the options of every watchPosition session started,
 * __geoClears counts the sessions ended.
 */
const countGeoCalls = (page) =>
    page.addInitScript(() => {
        window.__geoCalls = 0;
        window.__geoWatches = [];
        window.__geoClears = 0;
        const geo = navigator.geolocation;
        const realGet = geo.getCurrentPosition.bind(geo);
        const realWatch = geo.watchPosition.bind(geo);
        const realClear = geo.clearWatch.bind(geo);
        geo.getCurrentPosition = (ok, err, opts) => {
            window.__geoCalls += 1;
            realGet(ok, err, opts);
        };
        geo.watchPosition = (ok, err, opts) => {
            window.__geoWatches.push(opts || {});
            return realWatch(ok, err, opts);
        };
        geo.clearWatch = (id) => {
            window.__geoClears += 1;
            realClear(id);
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

test('a denied permission ends the tracking instead of being retried', async ({ page }) => {
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
    // Not just the reads: the watch is closed too, or the receiver would stay
    // engaged for a permission that will never be granted while the page lives.
    expect(await page.evaluate(() => window.__geoClears)).toBeGreaterThan(0);
});

test('tracking pauses while the page is hidden and refreshes on return', async ({
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
    // The watch is what actually holds the receiver open, so pausing means
    // ending it — not merely skipping the top-up reads.
    expect(
        await page.evaluate(() => window.__geoClears),
        'a backgrounded tab left the watch running',
    ).toBeGreaterThan(0);

    // Coming back, the shown position is as old as the pause — refresh at once
    // instead of waiting out the rest of the interval.
    await setVisibility('visible');
    await expect.poll(() => page.evaluate(() => window.__geoCalls)).toBeGreaterThan(whileHidden);
});

test('mobile keeps a continuous high-accuracy watch running', async ({ page, context }) => {
    // 1 Hz is not a poll: the platform pushes every fix its receiver makes, and
    // the ticker is only the floor under that. A watch is therefore what the
    // mobile path must open, and it must ask for the GNSS, not for cell towers.
    await countGeoCalls(page);
    await context.setGeolocation({ latitude: -34.9055, longitude: -56.187 });
    await openMap(page, { theme: 'dark' });
    await expect.poll(() => userLocation(page)).not.toBeNull();

    const watches = await page.evaluate(() => window.__geoWatches);
    expect(watches, 'mobile did not open a watch session').toHaveLength(1);
    expect(watches[0].enableHighAccuracy).toBe(true);
});

/**
 * Replaces the whole geolocation API with a platform that answers a one-shot
 * read instantly and NEVER pushes from its watch — the "only reports on change"
 * provider the 1 Hz floor exists for, and the only way to measure the app's own
 * cadence: Chromium's geolocation stack answers in real time, which no amount
 * of clock mocking makes deterministic.
 *
 * window.__geoReads collects the (mocked) timestamp of every read, and
 * window.__geoPos is where the stub currently says the rider is — set it to
 * move them.
 */
const stubSilentPlatform = (page) =>
    page.addInitScript(() => {
        window.__geoReads = [];
        window.__geoWatchers = 0;
        window.__geoPos = { lat: -34.9055, lng: -56.187 };
        const position = () => ({
            coords: {
                latitude: window.__geoPos.lat,
                longitude: window.__geoPos.lng,
                accuracy: 12,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
            },
            timestamp: Date.now(),
        });
        Object.defineProperty(navigator, 'geolocation', {
            configurable: true,
            value: {
                getCurrentPosition(ok) {
                    window.__geoReads.push(Date.now());
                    Promise.resolve().then(() => ok(position()));
                },
                watchPosition() {
                    window.__geoWatchers += 1;
                    return 1; // opened, and then silent
                },
                clearWatch() {
                    window.__geoWatchers -= 1;
                },
            },
        });
    });

test('the mobile track refreshes the position once a second', async ({ page }) => {
    // The cadence asked for by the user (2026-07-28).
    await page.clock.install();
    await stubSilentPlatform(page);
    await openMap(page, { theme: 'dark' });
    await expect.poll(() => page.evaluate(() => window.__geoReads.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__geoWatchers), 'no watch was opened').toBe(1);

    const SECONDS = 30;
    const before = await page.evaluate(() => window.__geoReads.length);
    for (let i = 0; i < SECONDS; i++) await page.clock.fastForward(LIVE_INTERVAL_MS);

    const reads = await page.evaluate(() => window.__geoReads);
    const count = reads.length - before;
    expect(count, `${count} reads in ${SECONDS} s`).toBeGreaterThanOrEqual(SECONDS - 1);
    expect(count, `${count} reads in ${SECONDS} s`).toBeLessThanOrEqual(SECONDS);

    // Evenly spaced, not bunched: every gap inside the measured span is one
    // interval, give or take the few ms of real time that leak past the mocked
    // clock between steps. (The first read of the span is not compared: it
    // follows the startup fix, which lands whenever the platform answers.)
    const measured = reads.slice(before);
    const gaps = measured.slice(1).map((t, i) => t - measured[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(LIVE_INTERVAL_MS);
    expect(Math.max(...gaps)).toBeLessThan(LIVE_INTERVAL_MS + 100);
});

test('a move shows on the map within a second', async ({ page }) => {
    // What the rider actually sees: the dot has moved by the next second, not
    // by the next poll. Driven by the stub platform so ONE second of mocked
    // time is the whole budget — no real-time poll to hide a slower cadence.
    await page.clock.install();
    await stubSilentPlatform(page);
    await openMap(page, { theme: 'dark' });
    await expect.poll(() => userLocation(page)).not.toBeNull();

    // ~55 m up the street — one second of riding at 20 km/h.
    await page.evaluate(() => {
        window.__geoPos = { lat: -34.905, lng: -56.187 };
    });
    await page.clock.fastForward(LIVE_INTERVAL_MS);

    expect((await userLocation(page)).lat).toBeCloseTo(-34.905, 4);
});

test.describe('on a fine pointer (desktop)', () => {
    // A real desktop context. `browser.newContext()` inside this file would NOT
    // give one: the Playwright runner applies the file's test.use options to
    // contexts opened from the fixture too, so a hand-rolled context is still
    // an emulated Pixel 7 — and the whole point here is the pointer type, which
    // is what picks the cadence.
    test.use({
        viewport: { width: 1280, height: 800 },
        isMobile: false,
        hasTouch: false,
        deviceScaleFactor: 1,
        userAgent: undefined,
        permissions: ['geolocation'],
        geolocation: { latitude: -34.9055, longitude: -56.187 },
    });

    test('nothing is requested until the visitor asks, and then it is a poll', async ({ page }) => {
        // The automatic request stays mobile-only, and the continuous 1 Hz
        // track with it: a desktop browser is not riding a bus.
        await countGeoCalls(page);
        await openMap(page, { theme: 'dark' });
        expect(await page.evaluate(() => window.__geoCalls)).toBe(0);
        expect(await page.evaluate(() => window.__geoWatches.length)).toBe(0);

        await page.click('.locate-control');
        await expect(page.locator('.user-location-marker')).toHaveCount(1, { timeout: 15_000 });
        expect(await page.evaluate(() => window.__geoWatches.length)).toBe(0);
    });

    test('reads the position far less often standing still than riding', async ({
        page,
        context,
    }) => {
        // The speed-derived cadence still runs behind the desktop locate
        // control: someone waiting must not pay the riding rate, and someone
        // moving must not pay the waiting one. Same wall-clock span, both
        // phases.
        //
        // Stepped finely on purpose: a geolocation callback lands AFTER the
        // clock jump that triggered it, so one big fastForward can only ever
        // produce one read however short the interval is — which would hide the
        // very difference under test.
        await page.clock.install();
        await countGeoCalls(page);
        await openMap(page, { theme: 'dark' });
        await page.click('.locate-control');
        await expect.poll(() => page.evaluate(() => window.__geoCalls)).toBeGreaterThan(0);

        const STEP_MS = 5_000;
        const STEPS = 36; // 3 minutes per phase
        const count = () => page.evaluate(() => window.__geoCalls);

        // Waiting at the stop: the position does not change.
        const beforeStill = await count();
        for (let i = 0; i < STEPS; i++) {
            await page.clock.fastForward(STEP_MS);
            await page.waitForTimeout(5); // let the fix land before the next step
        }
        const still = (await count()) - beforeStill;

        // On the bus: ~20 km/h, i.e. 27.5 m per 5 s step.
        const beforeRide = await count();
        let lat = -34.9055;
        for (let i = 0; i < STEPS; i++) {
            lat += 27.5 / 111000;
            await context.setGeolocation({ latitude: lat, longitude: -56.187 });
            await page.clock.fastForward(STEP_MS);
            await page.waitForTimeout(5);
        }
        const riding = (await count()) - beforeRide;

        expect(still, `standing still read ${still} times in 3 min`).toBeLessThanOrEqual(5);
        expect(
            riding,
            `riding read ${riding} times vs ${still} standing, in the same 3 min`,
        ).toBeGreaterThanOrEqual(still * 2);
    });
});
