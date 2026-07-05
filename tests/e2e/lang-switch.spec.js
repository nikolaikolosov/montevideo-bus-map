/**
 * Language switcher e2e (brainstorm-006): the ES | EN | RU control swaps the
 * whole UI, syncs <html lang>, localizes popups on next open, and the choice
 * survives a reload.
 */
import { test, expect } from '@playwright/test';
import { openMap, openStopPopup } from './helpers.js';

test('switching to Russian localizes panel, popup and <html lang>', async ({ page }) => {
    await openMap(page, { theme: 'dark' });

    await expect(page.locator('label[for="routeSelect"]')).toHaveText('Línea');

    await page.click('.lang-btn[data-lang="ru"]');

    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.locator('label[for="routeSelect"]')).toHaveText('Линия');
    await expect(page.locator('.subtitle')).toHaveText('Интерактивная карта маршрутов');
    await expect(page.locator('.lang-btn[data-lang="ru"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#routeSelect option[value="ALL_STOPS"]')).toHaveText(
        '📍 Показать все остановки',
    );

    // Popups regenerate their content in the active language on open.
    await openStopPopup(page, 4772);
    await expect(page.locator('.draw-lines-btn')).toHaveText('Показать все маршруты');
    await expect(page.locator('.popup-sub')).toContainText('34 линии');
});

test('the choice persists across reloads and English works too', async ({ page }) => {
    // lang: false — openMap must not re-pin the language on reload, the
    // persisted user choice is exactly what this test verifies.
    await openMap(page, { theme: 'dark', lang: false });
    await page.click('.lang-btn[data-lang="en"]');
    await expect(page.locator('label[for="routeSelect"]')).toHaveText('Line');

    await page.reload();
    await page.waitForFunction(() => document.getElementById('loader').style.display === 'none');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('label[for="routeSelect"]')).toHaveText('Line');
    await expect(page.locator('.subtitle')).toHaveText('Interactive route explorer');
});
