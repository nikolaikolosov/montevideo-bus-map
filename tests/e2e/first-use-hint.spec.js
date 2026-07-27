/**
 * First-use hint (ux-review-001 R7, finding F6: the all-stops entry view
 * answers no job by itself and nothing tells a first-time visitor that stops
 * are tappable or that the search exists).
 *
 * Shown once, over the map so it costs the mobile bottom sheet no height, and
 * only to someone who actually landed on the entry view.
 */
import { test, expect, devices } from '@playwright/test';
import { openMap, renderLine } from './helpers.js';

const hint = (page) => page.locator('#firstUseHint');

test('a first-time visitor is told how to start', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await expect(hint(page)).toBeVisible();
    await expect(hint(page)).toContainText(/parada/i);
});

test('dismissing it sticks across a reload', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await page.click('#firstUseHintDismiss');
    await expect(hint(page)).toBeHidden();

    await page.reload();
    await page.waitForFunction(() => window.__mvdMap);
    await expect(hint(page)).toBeHidden();
});

test('a deep link is not lectured about how to start', async ({ page }) => {
    // Arriving at a line means the visitor already knows what they came for.
    await page.addInitScript(() => {
        location.hash = '#/linea/104';
    });
    await openMap(page, { theme: 'dark' });
    await expect(hint(page)).toBeHidden();
});

test('it gets out of the way as soon as there is something to look at', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await expect(hint(page)).toBeVisible();

    await renderLine(page, '104');
    await expect(hint(page)).toBeHidden();
});

test('it floats over the map instead of growing the panel', async ({ page }) => {
    // The mobile bottom sheet has a map-space budget (mobile-panel.spec.js);
    // a hint inside the panel would eat into it.
    await openMap(page, { theme: 'dark' });
    const inPanel = await page.evaluate(
        () =>
            !!document
                .getElementById('ui-panel')
                ?.contains(document.getElementById('firstUseHint')),
    );
    expect(inPanel).toBe(false);
    await expect(hint(page)).toBeVisible();
});

test.describe('on a phone', () => {
    const PIXEL_7 = { ...devices['Pixel 7'] };
    delete PIXEL_7.defaultBrowserType;
    test.use(PIXEL_7);

    test('does not land on top of the bottom sheet', async ({ page }) => {
        // The panel is a bottom sheet here, so a bottom-anchored hint covers it —
        // measured at 706-815 px against a panel starting at 716 before the fix.
        await openMap(page, { theme: 'dark' });
        const boxes = await page.evaluate(() => {
            const h = document.getElementById('firstUseHint').getBoundingClientRect();
            const p = document.getElementById('ui-panel').getBoundingClientRect();
            return {
                overlaps: h.bottom > p.top && h.top < p.bottom,
                hintRight: h.right,
                vw: window.innerWidth,
            };
        });
        expect(boxes.overlaps).toBe(false);
        // And it clears the map control column on the right.
        expect(boxes.vw - boxes.hintRight).toBeGreaterThan(48);
    });
});
