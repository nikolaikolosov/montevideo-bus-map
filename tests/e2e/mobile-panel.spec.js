/**
 * Mobile panel + recovery affordances e2e (brainstorm-009 V1):
 * the bottom sheet's map-space budget, the search-field platform hints that
 * keep autofill quick-insert bars away, and the visible ways back to the
 * all-stops view (clear ×, home control, title link).
 */
import { test, expect } from '@playwright/test';
import { openMap } from './helpers.js';

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

test('the bottom sheet leaves at least 82% of the screen to the map', async ({ page }) => {
    await openMap(page, { theme: 'dark' });

    const ratio = await page.evaluate(() => {
        const panel = document.getElementById('ui-panel').getBoundingClientRect();
        return panel.height / window.innerHeight;
    });
    expect(ratio).toBeLessThanOrEqual(0.18);

    await expect(page.locator('.subtitle')).toBeHidden();

    // Selecting a line adds the one-row stats without blowing the budget.
    await page.evaluate(() => window.__mvdSelectLine('104'));
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    const withStats = await page.evaluate(() => {
        const panel = document.getElementById('ui-panel').getBoundingClientRect();
        return panel.height / window.innerHeight;
    });
    expect(withStats).toBeLessThanOrEqual(0.24);
});

test('search field carries the platform hints that suppress autofill bars', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    const input = page.locator('#searchInput');
    await expect(input).toHaveAttribute('type', 'search');
    await expect(input).toHaveAttribute('inputmode', 'search');
    await expect(input).toHaveAttribute('enterkeyhint', 'search');
    await expect(input).toHaveAttribute('autocomplete', 'off');
});

test('the suggestion list opens ABOVE the bottom sheet on mobile', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.fill('#searchInput', '104');
    const above = await page.evaluate(() => {
        const list = document.getElementById('searchList').getBoundingClientRect();
        const input = document.getElementById('searchInput').getBoundingClientRect();
        return list.bottom <= input.top + 1;
    });
    expect(above).toBe(true);
});

test('home control sits on the zoom buttons’ vertical axis', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    const aligned = await page.evaluate(() => {
        const zoom = document.querySelector('.leaflet-control-zoom').getBoundingClientRect();
        const home = document.querySelector('.home-control').getBoundingClientRect();
        return Math.abs(zoom.right - home.right) < 0.5;
    });
    expect(aligned).toBe(true);
});

test('home control reveals all stops WITHOUT moving the camera', async ({ page }) => {
    // brainstorm-010 issue 3: pressing "show all stops" must feel like the
    // stops appearing at the same position and zoom the rider was looking at,
    // NOT a jump to the whole-city overview.
    await openMap(page, { theme: 'dark' });
    await page.evaluate(() => window.__mvdSelectLine('405'));
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);

    // A deliberate neighbourhood view, far from CONFIG city overview (zoom 12).
    await page.evaluate(() => {
        window.__mvdMap.setView([-34.9, -56.19], 15, { animate: false });
    });
    const before = await page.evaluate(() => {
        const c = window.__mvdMap.getCenter();
        return { z: window.__mvdMap.getZoom(), lat: c.lat, lng: c.lng };
    });

    await page.click('.home-control');
    await page.waitForFunction(() => window.__mvdGetRenderState().stops > 4000);

    expect(new URL(page.url()).hash).toBe('#/');
    const after = await page.evaluate(() => {
        const c = window.__mvdMap.getCenter();
        return { z: window.__mvdMap.getZoom(), lat: c.lat, lng: c.lng };
    });
    expect(after.z).toBe(before.z);
    expect(Math.abs(after.lat - before.lat)).toBeLessThan(1e-4);
    expect(Math.abs(after.lng - before.lng)).toBeLessThan(1e-4);
});

test('the home control keeps its opaque colour on tap (no sticky hover)', async ({ page }) => {
    // brainstorm-010 issue 2: on touch (hover:none) the :hover rule must not
    // apply, so the button never picks up its pressed tint and keeps it.
    await openMap(page, { theme: 'dark' });
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);

    const base = await page.evaluate(
        () => getComputedStyle(document.querySelector('.home-control')).backgroundColor,
    );
    // Light in both themes, matching the zoom buttons above it — and the plain
    // rest colour, not the #f4f4f4 press tint.
    expect(base).toBe('rgb(255, 255, 255)');

    await page.hover('.home-control');
    const afterHover = await page.evaluate(
        () => getComputedStyle(document.querySelector('.home-control')).backgroundColor,
    );
    expect(afterHover).toBe(base);
});

test('the home control matches the zoom buttons on a dark-theme phone too', async ({ page }) => {
    // Mobile is where the mismatch was most visible: the dark control sat
    // directly under two white zoom buttons in the same column.
    await openMap(page, { theme: 'dark' });
    const both = await page.evaluate(() => {
        const read = (s) => {
            const c = getComputedStyle(document.querySelector(s));
            return { bg: c.backgroundColor, color: c.color };
        };
        return { home: read('.home-control'), zoomIn: read('.leaflet-control-zoom-in') };
    });
    expect(both.home.bg).toBe(both.zoomIn.bg);
    expect(both.home.color).toBe(both.zoomIn.color);
    expect(both.home.bg).toBe('rgb(255, 255, 255)');
});

test('the home control flashes the same tap highlight as the zoom buttons', async ({ page }) => {
    // brainstorm-011: on mobile the dots control must acknowledge a press
    // exactly like the zoom +/- buttons above it. Asserted by parity (reads
    // both live) rather than a hardcoded colour, so it tracks Leaflet.
    await openMap(page, { theme: 'dark' });
    const th = await page.evaluate(() => {
        const c = (s) => getComputedStyle(document.querySelector(s)).webkitTapHighlightColor;
        return { home: c('.home-control'), zoomIn: c('.leaflet-control-zoom-in') };
    });
    expect(th.home).toBe(th.zoomIn);
    expect(th.home).not.toBe('rgba(0, 0, 0, 0)'); // not the transparent no-feedback default
});

test('header icons sit level with the title and the row is evenly spaced', async ({ page }) => {
    // brainstorm-010 issue 1.
    await openMap(page, { theme: 'dark' });
    const g = await page.evaluate(() => {
        const cy = (s) => {
            const b = document.querySelector(s).getBoundingClientRect();
            return (b.top + b.bottom) / 2;
        };
        const panel = document.getElementById('ui-panel').getBoundingClientRect();
        const header = document.querySelector('.panel-header').getBoundingClientRect();
        const search = document.querySelector('.search-box').getBoundingClientRect();
        return {
            title: cy('.title-link'),
            lang: cy('.lang-switcher'),
            theme: cy('.theme-toggle'),
            above: header.top - panel.top,
            below: search.top - header.bottom,
        };
    });
    // Icons vertically centred on the title.
    expect(Math.abs(g.lang - g.title)).toBeLessThan(2);
    expect(Math.abs(g.theme - g.title)).toBeLessThan(2);
    // Header row evenly spaced between the panel top and the search field.
    expect(Math.abs(g.above - g.below)).toBeLessThan(3);
});

test('clear × in the field and the title link both go home', async ({ page }) => {
    await openMap(page, { theme: 'dark' });

    await page.evaluate(() => window.__mvdSelectLine('104'));
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    await expect(page.locator('#searchClear')).toBeVisible();
    await page.click('#searchClear');
    await page.waitForFunction(() => window.__mvdGetRenderState().stops > 4000);
    expect(new URL(page.url()).hash).toBe('#/');
    await expect(page.locator('#searchClear')).toBeHidden();

    await page.evaluate(() => window.__mvdSelectLine('104'));
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    await page.click('.title-link');
    await page.waitForFunction(() => window.__mvdGetRenderState().stops > 4000);
    expect(new URL(page.url()).hash).toBe('#/');
});
