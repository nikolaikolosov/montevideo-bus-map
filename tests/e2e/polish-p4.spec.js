/**
 * P4 "Polish" — ux-review-001 R9 (about/legend) and F10 (popup opening under
 * the panel). X4 (low-zoom stop thinning) is NOT here: see PHASE.md.
 */
import { test, expect } from '@playwright/test';
import { openMap } from './helpers.js';

test.describe('R9 — the legend', () => {
    test('explains the visual language and credits the base map', async ({ page }) => {
        await openMap(page, { theme: 'dark' });
        await expect(page.locator('#aboutPanel')).toBeHidden();

        await page.click('.about-control');
        const panel = page.locator('#aboutPanel');
        await expect(panel).toBeVisible();
        await expect(panel).toContainText(/OpenStreetMap/);
        await expect(panel).toContainText(/CARTO/);
        // The two things nothing else in the app says.
        await expect(panel).toContainText(/línea/i);
        await expect(panel).toHaveAttribute('role', 'dialog');
    });

    test('closes on Escape and returns focus to the control', async ({ page }) => {
        await openMap(page, { theme: 'dark' });
        await page.click('.about-control');
        await expect(page.locator('#aboutPanel')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('#aboutPanel')).toBeHidden();
        const focused = await page.evaluate(() => document.activeElement?.className ?? '');
        expect(focused).toContain('about-control');
    });
});

test('F10 — a popup never opens under the panel', async ({ page }) => {
    // Leaflet auto-pans a popup into the MAP's viewport, but the panel is an
    // overlay the map knows nothing about. Measured without the fix, a popup
    // placed at the panel's inner corner stays underneath it.
    await openMap(page, { theme: 'dark' });
    const result = await page.evaluate(async () => {
        const map = window.__mvdMap;
        const panel = document.getElementById('ui-panel').getBoundingClientRect();
        const stop = [-34.9055, -56.187];
        map.setView(stop, 16, { animate: false });
        // Plain arithmetic rather than L.point: this runs in the page, where the
        // linter cannot see Leaflet's global.
        const targetX = panel.right - 20;
        const targetY = panel.bottom - 20;
        const size = map.getSize();
        map.panBy([size.x / 2 - targetX, size.y / 2 - targetY], { animate: false });
        map.openPopup('<div style="width:240px;height:120px">x</div>', stop);
        await new Promise((r) => setTimeout(r, 300));
        const a = document.querySelector('.leaflet-popup').getBoundingClientRect();
        const b = document.getElementById('ui-panel').getBoundingClientRect();
        return {
            overlaps: a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom,
        };
    });
    expect(result.overlaps).toBe(false);
});
