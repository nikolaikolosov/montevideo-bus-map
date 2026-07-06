/**
 * Home control on desktop (brainstorm-010). The default project viewport is
 * 1280×800 with a fine pointer (hover: hover), so this file pins the desktop
 * side of the two behaviours the mobile suite pins for touch:
 *  - hover feedback is KEPT on desktop (the @media(hover:hover) gate must not
 *    strip it), and
 *  - "show all stops" preserves the current camera here too.
 */
import { test, expect } from '@playwright/test';
import { openMap } from './helpers.js';

test('desktop keeps the home-control hover feedback', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(true);

    await page.mouse.move(640, 400); // neutral, not over the control
    const base = await page.evaluate(
        () => getComputedStyle(document.querySelector('.home-control')).backgroundColor,
    );
    await page.hover('.home-control');
    const hovered = await page.evaluate(
        () => getComputedStyle(document.querySelector('.home-control')).backgroundColor,
    );
    expect(base).toBe('rgba(15, 23, 42, 0.95)');
    expect(hovered).not.toBe(base); // hover tint still applies where a pointer exists
});

test('the home control shows momentary press feedback that does not stick', async ({ page }) => {
    // brainstorm-011: a press must change the background, and release must
    // revert it (a sticky tint was the PR #19 bug — guarded here on desktop
    // via :active, complementing the mobile no-stick-on-hover test).
    await openMap(page, { theme: 'dark' });
    await page.mouse.move(640, 400); // neutral
    const rest = await page.evaluate(
        () => getComputedStyle(document.querySelector('.home-control')).backgroundColor,
    );

    const box = await page.evaluate(() => {
        const b = document.querySelector('.home-control').getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    const held = await page.evaluate(
        () => getComputedStyle(document.querySelector('.home-control')).backgroundColor,
    );
    await page.mouse.up();
    await page.mouse.move(640, 400);
    const after = await page.evaluate(
        () => getComputedStyle(document.querySelector('.home-control')).backgroundColor,
    );

    expect(held).not.toBe(rest); // pressed → feedback
    expect(after).toBe(rest); // released → back to base, no stick
});

test('desktop home control preserves position and zoom', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.evaluate(() => window.__mvdSelectLine('405'));
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);

    await page.evaluate(() => {
        window.__mvdMap.setView([-34.9, -56.19], 15, { animate: false });
    });
    const before = await page.evaluate(() => {
        const c = window.__mvdMap.getCenter();
        return { z: window.__mvdMap.getZoom(), lat: c.lat, lng: c.lng };
    });

    await page.click('.home-control');
    await page.waitForFunction(() => window.__mvdGetRenderState().stops > 4000);

    const after = await page.evaluate(() => {
        const c = window.__mvdMap.getCenter();
        return { z: window.__mvdMap.getZoom(), lat: c.lat, lng: c.lng };
    });
    expect(after.z).toBe(before.z);
    expect(Math.abs(after.lat - before.lat)).toBeLessThan(1e-4);
    expect(Math.abs(after.lng - before.lng)).toBeLessThan(1e-4);
});
