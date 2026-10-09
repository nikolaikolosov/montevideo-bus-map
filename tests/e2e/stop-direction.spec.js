/**
 * The departure direction that tells apart the two kerbs of one corner
 * (src/stop-direction.js): 55 % of stops share their name with another stop,
 * and "Av Millán y Sitio Grande" twice in a list says nothing about which side
 * of the avenue each one is.
 */
import { test, expect } from '@playwright/test';
import { openMap, openStopPopup } from './helpers.js';

test('two stops with one name are told apart in the search list', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.locator('#searchInput').fill('millan y sitio grande');
    const rows = page.locator('#searchList [role="option"]');
    await expect(rows).toHaveCount(2);

    const subs = await rows.locator('.search-sub').allTextContents();
    expect(subs[0]).toContain('Parada 1480');
    expect(subs[1]).toContain('Parada 3595');
    const directions = await rows.locator('.stop-direction').allTextContents();
    expect(directions).toHaveLength(2);
    for (const d of directions) expect(d).toMatch(/^hacia el /);
    expect(directions[0]).not.toBe(directions[1]);
});

test('the popup says which way the buses leave, and follows the language', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await openStopPopup(page, 1480, { center: true });
    const row = page.locator('.popup-direction');
    await expect(row).toBeVisible();
    await expect(row).toHaveText(/^hacia el /);
    // The arrow is decoration: the words carry it for a screen reader.
    await expect(row.locator('svg')).toHaveAttribute('aria-hidden', 'true');

    await page.locator('.lang-btn[data-lang="ru"]').click();
    await openStopPopup(page, 1480, { center: true });
    await expect(page.locator('.popup-direction')).toHaveText(/^на /);
});

test('a stop where every line ends names no direction', async ({ page }) => {
    // Stop 4967 is terminal-only (route-invariants): nothing departs from it.
    await openMap(page, { theme: 'dark' });
    await openStopPopup(page, 4967, { center: true });
    await expect(page.locator('.popup-content h3')).toBeVisible();
    await expect(page.locator('.popup-direction')).toHaveCount(0);
});
