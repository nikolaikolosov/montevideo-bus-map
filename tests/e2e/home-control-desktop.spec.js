/**
 * Home control on desktop (brainstorm-010). The default project viewport is
 * 1280×800 with a fine pointer (hover: hover), so this file pins the desktop
 * side of the two behaviours the mobile suite pins for touch:
 *  - hover feedback is KEPT on desktop (the @media(hover:hover) gate must not
 *    strip it), and
 *  - "show all stops" preserves the current camera here too.
 *
 * It also pins the control's surface: light in BOTH themes, matching the zoom
 * buttons it sits under. Asserted as parity against the live zoom button rather
 * than as a hardcoded colour, so it tracks Leaflet's palette.
 */
import { test, expect } from '@playwright/test';
import { openMap } from './helpers.js';

/** Rest/hover/press background of a selector, with the pointer parked first. */
async function surface(page, selector) {
    await page.mouse.move(640, 400); // neutral, off every control
    const read = () =>
        page.evaluate((s) => {
            const el = document.querySelector(s);
            const c = getComputedStyle(el);
            return { bg: c.backgroundColor, color: c.color };
        }, selector);

    const rest = await read();
    await page.hover(selector);
    const hovered = await read();
    const box = await page.evaluate((s) => {
        const b = document.querySelector(s).getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, selector);
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    const held = await read();
    await page.mouse.up();
    await page.mouse.move(640, 400);
    return { rest, hovered, held };
}

for (const theme of ['dark', 'light']) {
    test(`the locate control stays light in the ${theme} theme, like the zoom buttons`, async ({
        page,
    }) => {
        // Same rule as the home control below it: the column of map controls is
        // Leaflet-white in both themes, and a theme-following button would sit
        // dark among white ones.
        await openMap(page, { theme });
        const locate = await surface(page, '.locate-control');
        const zoom = await surface(page, '.leaflet-control-zoom-in');

        expect(locate.rest.bg, 'rest background differs from the zoom button').toBe(zoom.rest.bg);
        expect(locate.rest.color, 'glyph colour differs from the zoom button').toBe(
            zoom.rest.color,
        );
        expect(locate.hovered.bg, 'hover background differs from the zoom button').toBe(
            zoom.hovered.bg,
        );
    });
}

for (const theme of ['dark', 'light']) {
    test(`the home control stays light in the ${theme} theme, like the zoom buttons`, async ({
        page,
    }) => {
        // The whole point of the fix: Leaflet paints the zoom buttons white in
        // both themes, so a theme-following home control turned dark under two
        // white buttons in the same column. Parity is asserted against the live
        // zoom button, not a copied constant, so Leaflet's palette moving fails
        // this instead of silently splitting the two apart again.
        await openMap(page, { theme });
        const home = await surface(page, '.home-control');
        const zoom = await surface(page, '.leaflet-control-zoom-in');

        expect(home.rest.bg, 'rest background differs from the zoom button').toBe(zoom.rest.bg);
        expect(home.rest.color, 'glyph colour differs from the zoom button').toBe(zoom.rest.color);
        expect(home.hovered.bg).toBe(zoom.hovered.bg);
        expect(home.held.bg).toBe(zoom.held.bg);

        // And it really is the light end of the scale, not merely "equal to
        // whatever the other button does".
        expect(home.rest.bg).toBe('rgb(255, 255, 255)');
        expect(home.rest.color).toBe('rgb(0, 0, 0)');
        // The theme itself did switch — this is not two runs of the same state.
        // Checked twice over: the app's own notion of the theme, and a surface
        // that IS theme-following, so a broken theme switch cannot make these
        // two cases pass by both being light.
        expect(await page.evaluate(() => window.__mvdGetRenderState().theme)).toBe(theme);
        const searchBg = await page.evaluate(
            () => getComputedStyle(document.querySelector('#searchInput')).color,
        );
        expect(searchBg).toBe(theme === 'dark' ? 'rgb(248, 250, 252)' : 'rgb(15, 23, 42)');
    });
}

test('desktop keeps the home-control hover feedback', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(true);

    const { rest, hovered } = await surface(page, '.home-control');
    expect(rest.bg).toBe('rgb(255, 255, 255)'); // light base, both themes
    expect(hovered.bg).not.toBe(rest.bg); // hover tint still applies where a pointer exists
});

test('the home control shows momentary press feedback that does not stick', async ({ page }) => {
    // brainstorm-011: a press must change the background, and release must
    // revert it (a sticky tint was the PR #19 bug — guarded here on desktop
    // via :active, complementing the mobile no-stick-on-hover test).
    await openMap(page, { theme: 'dark' });
    const { rest, held } = await surface(page, '.home-control');
    const after = await page.evaluate(
        () => getComputedStyle(document.querySelector('.home-control')).backgroundColor,
    );

    expect(held.bg).not.toBe(rest.bg); // pressed → feedback
    expect(after).toBe(rest.bg); // released → back to base, no stick
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
