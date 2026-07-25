/**
 * Journey planning end to end: pick two stops from their popups, get an
 * itinerary with transfers, switch between the alternatives, swap the ends,
 * clear it. Every step must also be reachable by URL — the hash is the source
 * of truth (component-inventory R7).
 */
import { test, expect } from '@playwright/test';
import { openMap, openStopPopup, planJourney } from './helpers.js';

// Two stops on opposite sides of the city with a real transfer between them.
const ORIGIN = 1000; // AV CIBILS y VERDUN
const DESTINATION = 1480; // AV MILLAN y SITIO GRANDE
// A central pair joined by a single ride.
const DOWNTOWN_FROM = 4772; // BUENOS AIRES y ITUZAINGO
const DOWNTOWN_TO = 4018; // AV 18 DE JULIO y CONVENCION

test('every stop popup offers both ends of a trip', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await openStopPopup(page, ORIGIN);
    const buttons = page.locator('.popup-journey button');
    await expect(buttons).toHaveCount(2);
    await expect(buttons.nth(0)).toHaveText('Desde acá');
    await expect(buttons.nth(1)).toHaveText('Hasta acá');
    await expect(buttons.nth(0)).toHaveAccessibleName('Empezar el viaje en esta parada');
});

test('the journey buttons stay quieter than the popup primary action', async ({ page }) => {
    // `.btn-quiet` is a modifier of `.btn`, so it has to WIN the cascade
    // against `.btn`'s accent fill. Written as a bare single-class selector it
    // only did so while it happened to sit later in the stylesheet — and it
    // did not, so every quiet button shipped looking like a primary one.
    await openMap(page, { theme: 'dark' });
    await openStopPopup(page, ORIGIN, { center: true });

    const fills = await page.evaluate(() => {
        const of = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
        return {
            primary: of('.popup-content .draw-lines-btn'),
            from: of('.journey-from-btn'),
            to: of('.journey-to-btn'),
            accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        };
    });
    expect(fills.from).not.toBe(fills.primary);
    expect(fills.to).toBe(fills.from);

    // …and the end a stop already holds flips to the accent fill.
    await page.locator('.journey-from-btn').click();
    await openStopPopup(page, ORIGIN, { center: true });
    const active = await page.evaluate(
        () => getComputedStyle(document.querySelector('.journey-from-btn')).backgroundColor,
    );
    expect(active).not.toBe(fills.from);
    await expect(page.locator('.journey-from-btn')).toHaveAttribute('aria-pressed', 'true');
});

test('picking origin then destination plans the trip', async ({ page }) => {
    await openMap(page, { theme: 'dark' });

    await openStopPopup(page, ORIGIN, { center: true });
    await page.locator('.journey-from-btn').click();

    // Waiting state: origin known, the panel asks for the other end.
    expect(new URL(page.url()).hash).toBe('#/viaje/desde/1000');
    await expect(page.locator('#journeyPanel')).toBeVisible();
    await expect(page.locator('#journeyOrigin')).toHaveText('AV CIBILS y VERDUN');
    await expect(page.locator('#journeyDestination')).toHaveText('—');
    await expect(page.locator('#journeyMessage')).toHaveText(
        'Elegí en el mapa la parada de destino.',
    );
    await expect(page.locator('#journeyLegs li')).toHaveCount(0);

    await openStopPopup(page, DESTINATION, { center: true });
    await page.locator('.journey-to-btn').click();

    expect(new URL(page.url()).hash).toBe('#/viaje/1000/1480');
    await expect(page.locator('#journeyMessage')).toBeHidden();
    await expect(page.locator('#journeyDestination')).toHaveText('AV MILLAN y SITIO GRANDE');
    await expect(page.locator('#journeyLegs li').first()).toBeVisible();
    await expect(page.locator('#journeyNote')).toContainText('Tiempos estimados');

    // The itinerary is drawn: coloured ride strokes plus the A/B pins.
    const drawn = await page.evaluate(() => {
        let polylines = 0;
        window.__mvdMap.eachLayer((l) => {
            // Duck-typed: the canvas renderer draws no DOM nodes to count.
            if (typeof l.getLatLngs === 'function') polylines++;
        });
        return {
            polylines,
            endpoints: document.querySelectorAll(
                '.journey-marker-origin, .journey-marker-destination',
            ).length,
        };
    });
    expect(drawn.polylines).toBeGreaterThan(0);
    expect(drawn.endpoints).toBe(2);
});

test('both ends of the itinerary are framed clear of the panel', async ({ page }) => {
    // The panel floats ON TOP of the map, so a symmetric fitBounds hides the
    // "A" end behind it — the one thing a journey view must show.
    await openMap(page, { theme: 'dark' });
    await planJourney(page, ORIGIN, DESTINATION);

    const box = await page.evaluate(() => {
        const panel = document.getElementById('ui-panel').getBoundingClientRect();
        const pin = (selector) => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
        };
        return {
            panel: { right: panel.right, top: panel.top, bottom: panel.bottom },
            origin: pin('.journey-marker-origin'),
            destination: pin('.journey-marker-destination'),
            viewport: { w: window.innerWidth, h: window.innerHeight },
        };
    });

    for (const pin of [box.origin, box.destination]) {
        expect(pin.x).toBeGreaterThan(box.panel.right);
        expect(pin.right).toBeLessThan(box.viewport.w);
        expect(pin.y).toBeGreaterThan(0);
        expect(pin.bottom).toBeLessThan(box.viewport.h);
    }
});

test('the origin stop offers to undo itself', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await openStopPopup(page, ORIGIN, { center: true });
    await page.locator('.journey-from-btn').click();

    await openStopPopup(page, ORIGIN, { center: true });
    const undo = page.locator('.journey-from-btn');
    await expect(undo).toHaveText('Quitar origen');
    await expect(undo).toHaveAttribute('aria-pressed', 'true');
    await undo.click();

    expect(new URL(page.url()).hash).toBe('#/');
    await expect(page.locator('#journeyPanel')).toBeHidden();
});

test('alternatives are switchable and shareable', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await planJourney(page, ORIGIN, DESTINATION);

    const tabs = page.locator('#journeyOptions [role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThan(1); // this pair has direct and transfer options

    const firstLegs = await page.locator('#journeyLegs li').count();
    await tabs.nth(1).click();
    expect(new URL(page.url()).hash).toBe('#/viaje/1000/1480/opcion/2');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');

    // Back returns to the first alternative — plain history, no special casing.
    await page.goBack();
    expect(new URL(page.url()).hash).toBe('#/viaje/1000/1480');
    await expect(page.locator('#journeyLegs li')).toHaveCount(firstLegs);
});

test('one end can be re-picked without discarding the trip', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await planJourney(page, ORIGIN, DESTINATION);

    // With an itinerary drawn only its own stops are on the map, so the panel
    // row is the way back to picking that end.
    await page.locator('#journeyEditDestination').click();
    expect(new URL(page.url()).hash).toBe('#/viaje/desde/1000');
    await expect(page.locator('#journeyOrigin')).toHaveText('AV CIBILS y VERDUN');
    await expect(page.locator('#journeyDestination')).toHaveText('—');
    await expect(page.locator('#journeyEditDestination')).toBeDisabled();

    // Every stop is pickable again — including one that was not on the trip.
    await openStopPopup(page, DOWNTOWN_TO, { center: true });
    await page.locator('.journey-to-btn').click();
    expect(new URL(page.url()).hash).toBe('#/viaje/1000/4018');
});

test('swap reverses the trip, clear ends it', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await planJourney(page, ORIGIN, DESTINATION);

    await page.locator('#journeySwap').click();
    expect(new URL(page.url()).hash).toBe('#/viaje/1480/1000');
    await expect(page.locator('#journeyOrigin')).toHaveText('AV MILLAN y SITIO GRANDE');
    await expect(page.locator('#journeyDestination')).toHaveText('AV CIBILS y VERDUN');

    await page.locator('#journeyClear').click();
    expect(new URL(page.url()).hash).toBe('#/');
    await expect(page.locator('#journeyPanel')).toBeHidden();
});

test('a deep-linked itinerary renders on load', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.goto(`/#/viaje/${DOWNTOWN_FROM}/${DOWNTOWN_TO}`);
    await page.waitForSelector('#journeyPanel:not([hidden])');
    await expect(page.locator('#journeyOrigin')).toHaveText('BUENOS AIRES y ITUZAINGO');
    await expect(page.locator('#journeyLegs li').first()).toBeVisible();
    // A ride leg carries the line as a coloured chip.
    await expect(page.locator('#journeyLegs .line-chip').first()).toBeVisible();
});

test('the map draws exactly as many transfer dots as the panel reports', async ({ page }) => {
    // The dot loop used to test the leg INDEX (`i === 0`) instead of "did a ride
    // come before this one". Most itineraries open with an access walk, so the
    // FIRST ride's boarding stop got a transfer dot too and the map showed
    // transfers + 1 dots against the panel's transfers. Both pairs below start
    // with a walk: 3976 → 928 is [walk, ride, walk, ride, walk] with 1 transfer,
    // 4890 → 3904 is [walk, ride, ride, ride, walk] with 2.
    await openMap(page, { theme: 'dark' });

    for (const [from, to] of [
        [3976, 928],
        [4890, 3904],
    ]) {
        await page.goto(`/#/viaje/${from}/${to}`);
        await page.waitForSelector('#journeyPanel:not([hidden])');
        const plan = await page.evaluate(
            ([f, t]) => {
                const option = window.__mvdGetJourney(f, t).options[0];
                return { transfers: option.transfers, kinds: option.legs.map((l) => l.type) };
            },
            [from, to],
        );
        // Guard the premise: if the planner stops opening with a walk here this
        // test is no longer exercising the bug and must be re-pointed.
        expect(plan.kinds[0], `${from}→${to} no longer starts with a walk`).toBe('walk');
        await expect(page.locator('.journey-marker-transfer')).toHaveCount(plan.transfers);
    }
});

test('a deep link to a stop that no longer exists asks for a new pick', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.goto('/#/viaje/999999/4018');
    await page.waitForSelector('#journeyPanel:not([hidden])');
    await expect(page.locator('#journeyMessage')).toHaveText('Esa parada no está en los datos.');
    await expect(page.locator('#journeyLegs li')).toHaveCount(0);
});

test.describe('mobile bottom sheet', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

    test('the itinerary scrolls inside the sheet instead of eating the map', async ({ page }) => {
        await openMap(page, { theme: 'dark' });
        await planJourney(page, ORIGIN, DESTINATION);

        const layout = await page.evaluate(() => {
            const panel = document.getElementById('ui-panel').getBoundingClientRect();
            const legs = document.getElementById('journeyLegs');
            return {
                panelRatio: panel.height / window.innerHeight,
                legsOverflow: legs.scrollHeight > legs.clientHeight,
                legsBottom: legs.getBoundingClientRect().bottom,
                viewportHeight: window.innerHeight,
                labelsHidden:
                    getComputedStyle(document.querySelector('.journey-endpoint-label')).display ===
                    'none',
            };
        });

        // The itinerary is the content now, so the sheet grows past the 18%
        // home-view budget — but not without limit, and nothing may spill off
        // the screen. Measured at 0.53 for this four-leg trip on a 375×812
        // phone; the legs list scrolls instead of growing further.
        expect(layout.panelRatio).toBeLessThanOrEqual(0.58);
        expect(layout.legsBottom).toBeLessThan(layout.viewportHeight);
        expect(layout.labelsHidden).toBe(true);
    });

    test('both ends stay clear of the sheet', async ({ page }) => {
        await openMap(page, { theme: 'dark' });
        await planJourney(page, ORIGIN, DESTINATION);
        const clear = await page.evaluate(() => {
            const panelTop = document.getElementById('ui-panel').getBoundingClientRect().top;
            return ['.journey-marker-origin', '.journey-marker-destination'].every((sel) => {
                const r = document.querySelector(sel).getBoundingClientRect();
                return r.bottom < panelTop && r.top > 0;
            });
        });
        expect(clear).toBe(true);
    });
});

test('the journey panel is localized', async ({ page }) => {
    await openMap(page, { theme: 'dark', lang: 'ru' });
    await planJourney(page, DOWNTOWN_FROM, DOWNTOWN_TO);
    await expect(page.locator('#journeyPanel h2')).toHaveText('Поездка');
    await expect(page.locator('#journeyNote')).toContainText('Время примерное');
    await expect(page.locator('#journeyLegs .journey-leg-main').first()).toContainText('Сядьте');
});
