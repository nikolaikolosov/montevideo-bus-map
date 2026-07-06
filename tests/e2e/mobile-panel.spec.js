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

test('home control returns to all stops and the city overview', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.evaluate(() => window.__mvdSelectLine('405'));
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);

    await page.click('.home-control');
    await page.waitForFunction(() => window.__mvdGetRenderState().stops > 4000);
    expect(new URL(page.url()).hash).toBe('#/');
    const zoom = await page.evaluate(() => window.__mvdMap.getZoom());
    expect(zoom).toBe(12); // CONFIG.MAP_ZOOM — city overview restored
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
