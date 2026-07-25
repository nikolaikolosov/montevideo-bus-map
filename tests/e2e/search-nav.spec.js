/**
 * Search combobox + URL-state navigation e2e (design/ux-review-001.md P1):
 * type-to-find lines and stops, deep links, browser back, and the
 * downstream context bar with its reset action.
 */
import { test, expect } from '@playwright/test';
import { openMap, openStopPopup } from './helpers.js';

const hash = (page) => new URL(page.url()).hash;

test('typing a line number and pressing Enter renders the line and sets the URL', async ({
    page,
}) => {
    await openMap(page, { theme: 'dark' });

    await page.fill('#searchInput', '104');
    await expect(page.locator('#searchList [role="option"]').first()).toHaveText(/Línea 104/);
    await page.keyboard.press('Enter');

    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    expect(hash(page)).toBe('#/linea/104');
    await expect(page.locator('#searchInput')).toHaveValue('Línea 104');
    await expect(page.locator('#routeInfo')).toHaveClass(/active/);
});

test('the search box is a keyboard path to a stop popup', async ({ page }) => {
    await openMap(page, { theme: 'dark' });

    await page.fill('#searchInput', 'buenos aires ituzaingo');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#searchInput')).toHaveAttribute(
        'aria-activedescendant',
        'search-opt-0',
    );
    await page.keyboard.press('Enter');

    await page.waitForSelector('.popup-content');
    expect(hash(page)).toBe('#/parada/4772');
    await expect(page.locator('.popup-sub')).toContainText('4772');
    await expect(page.locator('.line-chip')).toHaveCount(34);
});

test('chip → downstream view with context bar; reset returns to the whole line', async ({
    page,
}) => {
    await openMap(page, { theme: 'dark' });
    await openStopPopup(page, 4772);

    await page.locator('.line-chip', { hasText: /^102$/ }).click();
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);

    expect(hash(page)).toBe('#/parada/4772/linea/102');
    await expect(page.locator('#contextBar')).toBeVisible();
    await expect(page.locator('#contextText')).toHaveText('Desde: BUENOS AIRES y ITUZAINGO (4772)');
    await expect(page.locator('#contextReset')).toHaveText('Toda la línea');
    await expect(page.locator('#searchInput')).toHaveValue('Línea 102');

    await page.click('#contextReset');
    expect(hash(page)).toBe('#/linea/102');
    await expect(page.locator('#contextBar')).toBeHidden();
});

test('"Ver todos" downstream: context bar resets back to the stop popup', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await openStopPopup(page, 4018);
    await page.click('.draw-lines-btn');
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);

    expect(hash(page)).toBe('#/parada/4018/todas');
    await expect(page.locator('#contextReset')).toHaveText('Volver a la parada');

    await page.click('#contextReset');
    expect(hash(page)).toBe('#/parada/4018');
    await page.waitForSelector('.popup-content');
});

test('deep links restore the exact view on cold load', async ({ page }) => {
    await openMap(page, { theme: 'dark' });

    await page.goto('/#/parada/4018/todas');
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    await expect(page.locator('#contextText')).toContainText('(4018)');
    await expect(page.locator('.highlight-stop-marker')).toHaveCount(1);

    await page.goto('/#/linea/405');
    await page.waitForFunction(
        () => window.__mvdGetRenderState().sections > 0 && location.hash === '#/linea/405',
    );
    await expect(page.locator('#searchInput')).toHaveValue('Línea 405');
});

test('browser back walks the navigation history', async ({ page }) => {
    await openMap(page, { theme: 'dark' });

    await page.evaluate(() => window.__mvdSelectLine('104'));
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    await page.evaluate(() => window.__mvdSelectLine('405'));
    await page.waitForFunction(() => location.hash === '#/linea/405');

    await page.goBack();
    await page.waitForFunction(() => location.hash === '#/linea/104');
    await expect(page.locator('#searchInput')).toHaveValue('Línea 104');

    await page.goBack();
    await page.waitForFunction(() => location.hash === '' || location.hash === '#/');
    await expect(page.locator('#searchInput')).toHaveValue('');
    // Home view: the full stop field is back.
    await page.waitForFunction(() => window.__mvdGetRenderState().stops > 4000);
});

test('a stale deep link (unknown line) fails safe to the home view', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.goto('/#/linea/NOPE');
    await page.waitForFunction(() => window.__mvdGetRenderState().stops > 4000);
    await expect(page.locator('#contextBar')).toBeHidden();
});

test('a truncated share link (malformed escape) fails safe, not to the error overlay', async ({
    page,
}) => {
    // "124 Sd" is the one line id that needs encoding — #/linea/124%20Sd — so a
    // chat client clipping that link yields #/linea/124%2, and decodeURIComponent
    // threw URIError out of parseHash on it. Both entry paths broke, differently.
    const crashes = [];
    page.on('pageerror', (e) => crashes.push(String(e)));

    await openMap(page, { theme: 'dark' });

    // Path 1 — same-document hash change: the throw escaped the hashchange
    // listener, so the module's currentHash had already advanced to the bad hash
    // while nothing re-rendered. Silent: no overlay, just URL and view disagreeing.
    await page.goto('/#/linea/124%2');
    await page.waitForFunction(() => window.__mvdGetRenderState().stops > 4000);
    expect(crashes, 'uncaught error while following the hash').toEqual([]);

    // Path 2 — cold load into the same URL (what the recipient of the link
    // actually does): the throw reached initApp's catch, which hid the loader and
    // painted "Error al cargar: URI malformed" over an empty map — and Reintentá
    // reloaded into the identical failure.
    await page.reload();
    await page.waitForFunction(
        () => document.getElementById('loader').style.display === 'none',
        undefined,
        { timeout: 30_000 },
    );
    await expect(page.locator('#error-container')).toBeHidden();
    await expect(page.locator('#contextBar')).toBeHidden();
    await page.waitForFunction(() => window.__mvdGetRenderState().stops > 4000);
    expect(crashes, 'uncaught error on cold load').toEqual([]);

    // The map is live, not a dead husk: navigating on from here still works.
    await page.evaluate(() => window.__mvdSelectLine('100'));
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
});
