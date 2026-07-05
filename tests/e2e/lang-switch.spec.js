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

test('full es→en→ru→es cycle keeps every surface consistent', async ({ page }) => {
    await openMap(page, { theme: 'dark' });

    const surfaces = {
        es: {
            label: 'Línea',
            subtitle: 'Explorador interactivo de recorridos',
            title: 'Montevideo Transit — recorridos de ómnibus de Montevideo',
            freshness: /Datos al /,
        },
        en: {
            label: 'Line',
            subtitle: 'Interactive route explorer',
            title: 'Montevideo Transit — Montevideo bus routes',
            freshness: /Data as of /,
        },
        ru: {
            label: 'Линия',
            subtitle: 'Интерактивная карта маршрутов',
            title: 'Montevideo Transit — маршруты автобусов Монтевидео',
            freshness: /Данные на /,
        },
    };

    for (const lang of ['es', 'en', 'ru', 'es']) {
        await page.click(`.lang-btn[data-lang="${lang}"]`);
        const s = surfaces[lang];
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await expect(page.locator('label[for="routeSelect"]')).toHaveText(s.label);
        await expect(page.locator('.subtitle')).toHaveText(s.subtitle);
        await expect(page).toHaveTitle(s.title);
        await expect(page.locator('#dataFreshness')).toHaveText(s.freshness);
        await expect(page.locator(`.lang-btn[data-lang="${lang}"]`)).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        // Exactly one active segment at a time.
        await expect(page.locator('.lang-btn[aria-pressed="true"]')).toHaveCount(1);
    }
});

test('switching language closes an open popup and keeps the selected line', async ({ page }) => {
    await openMap(page, { theme: 'dark' });

    // Select a line via the dropdown, then switch language: the selection
    // must survive the option re-population.
    await page.evaluate(() => {
        window.__mvdSelectLine('100');
    });
    await expect(page.locator('#routeSelect')).toHaveValue('100');

    await page.click('.lang-btn[data-lang="en"]');
    await expect(page.locator('#routeSelect')).toHaveValue('100');
    await expect(page.locator('#routeSelect option[value="100"]')).toHaveText('Line 100');

    // Back to the global stops view; open a stop popup and switch language:
    // the stale-language popup closes, reopening renders the new language.
    await page.click('.lang-btn[data-lang="es"]');
    await page.evaluate(() => {
        document.getElementById('routeSelect').value = 'ALL_STOPS';
        document.getElementById('routeSelect').dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(600); // select-change debounce + render
    await openStopPopup(page, 4018);
    await expect(page.locator('.draw-lines-btn')).toHaveText('Ver todos los recorridos');

    await page.click('.lang-btn[data-lang="ru"]');
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);

    await openStopPopup(page, 4018);
    await expect(page.locator('.draw-lines-btn')).toHaveText('Показать все маршруты');
});

test('theme toggle tooltip follows the language', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await expect(page.locator('#themeToggle')).toHaveAttribute(
        'aria-label',
        'Cambiar a tema claro',
    );
    await page.click('.lang-btn[data-lang="ru"]');
    await expect(page.locator('#themeToggle')).toHaveAttribute(
        'aria-label',
        'Переключить на светлую тему',
    );
});
