/**
 * Language switcher e2e (brainstorm-006): the ES | EN | RU control swaps the
 * whole UI, syncs <html lang>, localizes popups on next open, and the choice
 * survives a reload.
 */
import { test, expect } from '@playwright/test';
import { openMap, openStopPopup } from './helpers.js';

test('switching to Russian localizes panel, popup and <html lang>', async ({ page }) => {
    await openMap(page, { theme: 'dark' });

    await expect(page.locator('label[for="searchInput"]')).toHaveText('Buscar');

    await page.click('.lang-btn[data-lang="ru"]');

    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.locator('label[for="searchInput"]')).toHaveText('Поиск');
    await expect(page.locator('#searchInput')).toHaveAttribute(
        'placeholder',
        'Линия или остановка…',
    );
    await expect(page.locator('.subtitle')).toHaveText('Интерактивная карта маршрутов');
    await expect(page.locator('.lang-btn[data-lang="ru"]')).toHaveAttribute('aria-pressed', 'true');
    // The browsable default list of the search box localizes too.
    await page.focus('#searchInput');
    await expect(page.locator('#searchList [role="option"]').first()).toHaveText(
        'Показать все остановки',
    );
    await page.keyboard.press('Escape');

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
    await expect(page.locator('label[for="searchInput"]')).toHaveText('Search');

    await page.reload();
    await page.waitForFunction(() => document.getElementById('loader').style.display === 'none');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('label[for="searchInput"]')).toHaveText('Search');
    await expect(page.locator('.subtitle')).toHaveText('Interactive route explorer');
});

test('full es→en→ru→es cycle keeps every surface consistent', async ({ page }) => {
    await openMap(page, { theme: 'dark' });

    const surfaces = {
        es: {
            label: 'Buscar',
            subtitle: 'Explorador interactivo de recorridos',
            title: 'Montevideo Transit — recorridos de ómnibus de Montevideo',
            freshness: /Datos al /,
        },
        en: {
            label: 'Search',
            subtitle: 'Interactive route explorer',
            title: 'Montevideo Transit — Montevideo bus routes',
            freshness: /Data as of /,
        },
        ru: {
            label: 'Поиск',
            subtitle: 'Интерактивная карта маршрутов',
            title: 'Montevideo Transit — маршруты автобусов Монтевидео',
            freshness: /Данные на /,
        },
    };

    for (const lang of ['es', 'en', 'ru', 'es']) {
        await page.click(`.lang-btn[data-lang="${lang}"]`);
        const s = surfaces[lang];
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await expect(page.locator('label[for="searchInput"]')).toHaveText(s.label);
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

    // Select a line via the search box, then switch language: the displayed
    // selection must re-label in the new language (state survives).
    await page.evaluate(() => {
        window.__mvdSelectLine('100');
    });
    await expect(page.locator('#searchInput')).toHaveValue('Línea 100');
    expect(new URL(page.url()).hash).toBe('#/linea/100');

    await page.click('.lang-btn[data-lang="en"]');
    await expect(page.locator('#searchInput')).toHaveValue('Line 100');
    expect(new URL(page.url()).hash).toBe('#/linea/100');

    // Back to the global stops view; open a stop popup and switch language:
    // the stale-language popup closes, reopening renders the new language.
    await page.click('.lang-btn[data-lang="es"]');
    await page.evaluate(() => {
        location.hash = '#/';
    });
    await page.waitForFunction(() => window.__mvdGetRenderState().stops > 1000);
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
