/**
 * Direction chevrons (ux-review-001 R8, finding F4: "no direction indication on
 * the rendered line").
 *
 * Direction is only well defined where ONE line is drawn from an explicit set of
 * variants — a downstream view, or a picked destination. A whole-line view
 * merges ida and vuelta into one corridor, and a multi-line view offsets each
 * line off the centreline the traces follow, so arrows on the trace would sit
 * between the strands rather than on one.
 */
import { test, expect } from '@playwright/test';
import { openMap, renderLine, setView } from './helpers.js';

const arrows = (page) => page.locator('.route-arrow');

/** Arrow centres and headings, in screen pixels. */
const arrowGeometry = (page) =>
    page.evaluate(() =>
        [...document.querySelectorAll('.route-arrow')].map((el) => {
            const b = el.getBoundingClientRect();
            const m = /rotate\(([-0-9.]+)deg\)/.exec(el.style.transform);
            return { x: b.x + b.width / 2, y: b.y + b.height / 2, angle: m ? +m[1] : null };
        }),
    );

test('a downstream view shows which way the bus goes', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.evaluate(() => {
        location.hash = '#/parada/4772/linea/102';
    });
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    await expect(arrows(page).first()).toBeAttached();

    // They point AWAY from the stop the ride starts at: the trace's own vertex
    // order is the travel direction, so an arrow's heading must have a positive
    // component along the vector from the origin stop to that arrow.
    const origin = await page.evaluate(() => {
        const p = window.__mvdMap.latLngToContainerPoint(window.__mvdMap.getCenter());
        return { x: p.x, y: p.y };
    });
    const geo = await arrowGeometry(page);
    const scored = geo
        .map((a) => {
            const dx = a.x - origin.x;
            const dy = a.y - origin.y;
            const len = Math.hypot(dx, dy);
            if (len < 1 || a.angle === null) return null;
            const rad = (a.angle * Math.PI) / 180;
            return (Math.cos(rad) * dx + Math.sin(rad) * dy) / len;
        })
        .filter((v) => v !== null);
    expect(scored.length).toBeGreaterThan(2);
    // Most arrows lead away from the centre of a downstream fan; a few on a
    // doubling-back leg legitimately do not.
    const outward = scored.filter((v) => v > 0).length;
    expect(outward / scored.length).toBeGreaterThan(0.6);
});

test('a picked destination shows them too', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.evaluate(() => {
        location.hash = '#/linea/104/destino/Pocitos';
    });
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    await expect(arrows(page).first()).toBeAttached();
});

test('a whole-line view shows none — both directions share the corridor', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await renderLine(page, '104');
    await expect(arrows(page)).toHaveCount(0);
});

test('a multi-line view shows none — the strands sit off the traces', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.evaluate(() => window.__mvdShowStopRoutes(4772));
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    await expect(arrows(page)).toHaveCount(0);
});

test('the count follows the viewport, not the length of the route', async ({ page }) => {
    // Spacing is in screen pixels, so without the viewport clip a 10 km trace at
    // street zoom would want hundreds of markers.
    await openMap(page, { theme: 'dark' });
    await page.evaluate(() => {
        location.hash = '#/parada/4772/linea/102';
    });
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    const wide = await arrows(page).count();

    await setView(page, [-34.9055, -56.187], 17);
    const close = await arrows(page).count();

    expect(wide).toBeGreaterThan(0);
    expect(close).toBeLessThan(60);
    expect(wide).toBeLessThan(60);
});

test('the chevrons are decorative, not obstacles', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.evaluate(() => {
        location.hash = '#/parada/4772/linea/102';
    });
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);

    const first = arrows(page).first();
    await expect(first).toHaveAttribute('aria-hidden', 'true');
    // They lie over the corridor and the stops; taps must reach what is beneath.
    expect(await first.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
});
