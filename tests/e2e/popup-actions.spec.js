/**
 * Popup interaction: line chips at a busy stop drive single-line rendering
 * (brainstorm-003 layer F, ideas 25/27).
 */
import { test, expect } from '@playwright/test';
import { openMap, openStopPopup } from './helpers.js';

const BUSY_STOP = 4772; // BUENOS AIRES y ITUZAINGO — 34 lines

test('busy stop popup lists all its lines as chips', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await openStopPopup(page, BUSY_STOP);
    const chips = page.locator('.popup-content .line-chip');
    await expect(chips).toHaveCount(34);
    await expect(page.locator('.popup-sub')).toContainText('34 líneas');
    await expect(chips.first()).toHaveAccessibleName(/Ver ruta .+ desde esta parada/);
});

test('chip click renders exactly that line downstream from the stop', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await openStopPopup(page, BUSY_STOP);
    await page.locator('.popup-content .line-chip', { hasText: /^102$/ }).click();
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);

    const state = await page.evaluate(() => window.__mvdGetRenderState());
    const colors = [...new Set(state.sectionList.map((s) => s.color))];
    expect(colors).toHaveLength(1); // a single line → a single color

    const expected = await page.evaluate(() =>
        import('./src/data.js').then((m) => m.getLineColor('102')),
    );
    expect(colors[0]).toBe(expected);

    // Stats panel reflects the single-line selection
    await expect(page.locator('#routeSelect')).toHaveValue('102');
    await expect(page.locator('#statVariants')).not.toHaveText('-');
});

test('"Ver rutas (todas)" renders the whole bundle', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await openStopPopup(page, BUSY_STOP);
    await page.locator('.popup-content .draw-lines-btn').click();
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    const state = await page.evaluate(() => window.__mvdGetRenderState());
    const colors = new Set(state.sectionList.map((s) => s.color));
    expect(colors.size).toBeGreaterThan(20); // 34 lines' colors on screen
});
