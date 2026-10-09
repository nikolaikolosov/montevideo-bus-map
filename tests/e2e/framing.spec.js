/**
 * Framing: every view that draws a result puts it where the rider can see it —
 * on screen, and clear of the panel that floats over the map (review
 * 2026-10-09).
 *
 * Two defects this pins:
 *  - a downstream view (#/parada/…/linea/… or …/todas) never moved the camera,
 *    so a shared or reloaded link left it on the city overview with the route
 *    somewhere off screen or under the panel;
 *  - line and downstream fits padded symmetrically, so whatever fell under the
 *    320 px desktop card or the mobile bottom sheet was hidden. Only the journey
 *    view measured the panel.
 * And the empty case: a line tapped at the stop where it ENDS drew nothing and
 * said "Total de paradas: 0".
 */
import { test, expect } from '@playwright/test';
import { openMap } from './helpers.js';

/** Waits for the camera to stop after a navigation (fitBounds is animated). */
async function settle(page) {
    await page.waitForFunction(
        () => !window.__mvdMap._animatingZoom && !window.__mvdMap._panAnim?._inProgress,
    );
    await page.waitForTimeout(150);
}

/** Navigates by hash, exactly as a shared link or back/forward would. */
async function goTo(page, hash) {
    await page.evaluate((h) => {
        location.hash = h;
    }, hash);
    await settle(page);
}

/**
 * Screen boxes of what matters: the drawn routes' bounding box (plus the
 * highlighted boarding stop, which every downstream fit includes), the panel,
 * and the map container.
 */
const layout = (page) =>
    page.evaluate(() => {
        const map = window.__mvdMap;
        let bounds = null;
        map.eachLayer((l) => {
            if (l._bundleSlot && l.getBounds) {
                bounds = bounds
                    ? bounds.extend(l.getBounds())
                    : window.L.latLngBounds(
                          l.getBounds().getSouthWest(),
                          l.getBounds().getNorthEast(),
                      );
            }
        });
        const box = map.getContainer().getBoundingClientRect();
        const toScreen = (ll) => {
            const p = map.latLngToContainerPoint(ll);
            return { x: p.x + box.left, y: p.y + box.top };
        };
        const panel = document.getElementById('ui-panel').getBoundingClientRect();
        const highlight = document.querySelector('.highlight-stop-marker')?.getBoundingClientRect();
        return {
            route: bounds && {
                nw: toScreen(bounds.getNorthWest()),
                se: toScreen(bounds.getSouthEast()),
            },
            highlight: highlight && {
                x: highlight.x + highlight.width / 2,
                y: highlight.y + highlight.height / 2,
            },
            panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom },
            viewport: { w: window.innerWidth, h: window.innerHeight },
        };
    });

/** True when a point is inside the viewport and not under the panel. */
const visible = (p, { panel, viewport }) =>
    p.x >= 0 &&
    p.y >= 0 &&
    p.x <= viewport.w &&
    p.y <= viewport.h &&
    !(p.x >= panel.left && p.x <= panel.right && p.y >= panel.top && p.y <= panel.bottom);

/** The route box lies inside the viewport and does not overlap the panel. */
function expectClearOfPanel(geo, label) {
    const { route, panel, viewport } = geo;
    const SLACK = 2; // sub-pixel rounding of the fit
    expect(route, `${label}: nothing drawn`).not.toBeNull();
    expect(route.nw.x, `${label}: off the left edge`).toBeGreaterThanOrEqual(-SLACK);
    expect(route.nw.y, `${label}: off the top edge`).toBeGreaterThanOrEqual(-SLACK);
    expect(route.se.x, `${label}: off the right edge`).toBeLessThanOrEqual(viewport.w + SLACK);
    expect(route.se.y, `${label}: off the bottom edge`).toBeLessThanOrEqual(viewport.h + SLACK);
    const overlaps =
        route.nw.x < panel.right - SLACK &&
        route.se.x > panel.left + SLACK &&
        route.nw.y < panel.bottom - SLACK &&
        route.se.y > panel.top + SLACK;
    expect(overlaps, `${label}: the route box runs under the panel`).toBe(false);
}

test.describe('desktop', () => {
    test('a shared downstream link frames the route instead of leaving the city view', async ({
        page,
    }) => {
        // Line L1 from stop 5407 runs entirely in the west of the city — under
        // the panel, or off screen, from the default overview.
        await openMap(page, { theme: 'dark' });
        const before = await page.evaluate(() => window.__mvdMap.getZoom());
        await goTo(page, '#/parada/5407/linea/L1');

        const geo = await layout(page);
        expectClearOfPanel(geo, 'L1 from 5407');
        expect(geo.highlight && visible(geo.highlight, geo), 'boarding stop not on screen').toBe(
            true,
        );
        expect(await page.evaluate(() => window.__mvdMap.getZoom())).toBeGreaterThan(before);
    });

    test('a downstream view labels where the lines GO, not the stop they leave', async ({
        page,
    }) => {
        // Every variant starts at the boarding stop, so its start label sat on
        // it: at 4018 three blocks of chips stacked over the tapped stop.
        await openMap(page, { theme: 'dark' });
        await goTo(page, '#/parada/4018/todas');
        const near = await page.evaluate(() => {
            const stop = document.querySelector('.highlight-stop-marker').getBoundingClientRect();
            const cx = stop.x + stop.width / 2;
            const cy = stop.y + stop.height / 2;
            const anchors = [...document.querySelectorAll('.route-label-container')].map((el) =>
                el.parentElement.getBoundingClientRect(),
            );
            return {
                total: anchors.length,
                atStop: anchors.filter((a) => Math.hypot(a.x - cx, a.y - cy) < 20).length,
            };
        });
        expect(near.total, 'no labels at all — the check would be vacuous').toBeGreaterThan(0);
        expect(near.atStop).toBe(0);
    });

    test('the "all lines from here" view is framed too', async ({ page }) => {
        await openMap(page, { theme: 'dark' });
        await goTo(page, '#/parada/4772/todas');
        const geo = await layout(page);
        expectClearOfPanel(geo, 'todas from 4772');
        expect(geo.highlight && visible(geo.highlight, geo)).toBe(true);
    });

    // The lines the old symmetric fit hid most of, measured: 22 of 138 lines put
    // route under the card at 1280 × 800 — L14 30 % of its vertices, 370 25 %,
    // 494 15 %.
    for (const line of ['L14', '370', '494']) {
        test(`line ${line} is framed clear of the panel`, async ({ page }) => {
            await openMap(page, { theme: 'dark' });
            await goTo(page, `#/linea/${line}`);
            expectClearOfPanel(await layout(page), `line ${line}`);
        });
    }

    test('a line that ENDS at the stop says so, instead of "0 stops"', async ({ page }) => {
        // 242 stop/line pairs on the committed data draw nothing downstream;
        // stop 1044 is where line 124 ends.
        await openMap(page, { theme: 'dark' });
        await goTo(page, '#/parada/1044/linea/124');

        await expect(page.locator('#routeNote')).toHaveText('La línea 124 termina en esta parada.');
        await expect(page.locator('#statStops')).toBeHidden();
        // And the stop is put on screen — from a link the camera was elsewhere.
        const geo = await layout(page);
        expect(geo.highlight && visible(geo.highlight, geo), 'terminal stop not on screen').toBe(
            true,
        );

        // Re-labelled with the rest of the panel.
        await page.locator('.lang-btn[data-lang="en"]').click();
        await expect(page.locator('#routeNote')).toHaveText('Line 124 ends at this stop.');

        // Leaving for a view that does draw something brings the count back.
        await goTo(page, '#/linea/124');
        await expect(page.locator('#routeNote')).toBeHidden();
        await expect(page.locator('#statStops')).toBeVisible();
    });

    test('a stop where EVERY line ends says that', async ({ page }) => {
        await openMap(page, { theme: 'dark' });
        await goTo(page, '#/parada/4967/todas');
        await expect(page.locator('#routeNote')).toHaveText(
            'Todas las líneas terminan en esta parada.',
        );
    });

    test('where no tile is painted the map shows the theme backdrop, not Leaflet grey', async ({
        page,
    }) => {
        await openMap(page, { theme: 'dark' });
        const bg = await page.evaluate(
            () => getComputedStyle(document.querySelector('.leaflet-container')).backgroundColor,
        );
        expect(bg).not.toBe('rgb(221, 221, 221)'); // Leaflet's #ddd
        expect(bg).toBe('rgb(32, 32, 33)');
    });
});

test.describe('mobile bottom sheet', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

    // 16 of 138 lines ran under the sheet with the old fit at 375 × 812 — 175
    // 45 % of its vertices, 396 44 %, 150 37 %.
    for (const hash of ['#/linea/175', '#/linea/396', '#/linea/150', '#/parada/5407/linea/L1']) {
        test(`${hash} is framed above the sheet`, async ({ page }) => {
            await openMap(page, { theme: 'dark' });
            await goTo(page, hash);
            expectClearOfPanel(await layout(page), hash);
        });
    }

    test('the map credit sits above the sheet, on screen', async ({ page }) => {
        // Esri's terms and the OSM licence require it to be visible; the sheet
        // used to cover it completely.
        await openMap(page, { theme: 'dark' });
        for (const hash of ['#/', '#/linea/104']) {
            await goTo(page, hash);
            const geo = await page.evaluate(() => {
                const credit = document
                    .querySelector('.leaflet-control-attribution')
                    .getBoundingClientRect();
                const panel = document.getElementById('ui-panel').getBoundingClientRect();
                return { credit, panelTop: panel.top, h: window.innerHeight };
            });
            expect(geo.credit.height, hash).toBeGreaterThan(0);
            expect(geo.credit.top, hash).toBeGreaterThanOrEqual(0);
            expect(geo.credit.bottom, `${hash}: credit under the sheet`).toBeLessThanOrEqual(
                geo.panelTop + 1,
            );
        }
    });
});
