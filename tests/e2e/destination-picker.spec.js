/**
 * Destination picker (ux-review-001 R4 + X1).
 *
 * The panel used to answer "which way does this bus go?" with the row
 * "Variantes de recorrido: 7" — the pipeline's word for it, and nothing the
 * rider could act on. It is replaced by the headsigns the line actually serves,
 * each of which renders only the variants that get there.
 */
import { test, expect } from '@playwright/test';
import { openMap, renderLine } from './helpers.js';

const chips = (page) => page.locator('#destinationChips .destination-chip');
const renderState = (page) => page.evaluate(() => window.__mvdGetRenderState());

test('a selected line offers its destinations, and the old variants row is gone', async ({
    page,
}) => {
    await openMap(page, { theme: 'dark' });
    await renderLine(page, '104');

    await expect(page.locator('#destinations')).toBeVisible();
    // Line 104 serves 7 destinations, plus the "all" chip.
    await expect(chips(page)).toHaveCount(8);
    await expect(chips(page).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#statVariants')).toHaveCount(0);
});

test('picking a destination renders only the buses going there', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await renderLine(page, '104');
    const whole = await renderState(page);

    await chips(page).filter({ hasText: 'Pocitos' }).click();
    await page.waitForFunction(
        (before) => window.__mvdGetRenderState().stops < before,
        whole.stops,
    );

    const narrowed = await renderState(page);
    expect(narrowed.stops).toBeLessThan(whole.stops);
    expect(narrowed.sections).toBeGreaterThan(0); // still a route, not an empty map
    expect(page.url()).toContain('#/linea/104/destino/Pocitos');
    await expect(chips(page).filter({ hasText: 'Pocitos' })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
    await expect(chips(page).first()).toHaveAttribute('aria-pressed', 'false');
});

test('the choice survives a reload and back returns to the whole line', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await renderLine(page, '104');
    const whole = await renderState(page);

    await chips(page).filter({ hasText: 'Pocitos' }).click();
    await page.waitForFunction((b) => window.__mvdGetRenderState().stops < b, whole.stops);
    const narrowed = await renderState(page);

    // A shared link has to land on the same view (R2 applies to this state too).
    await page.reload();
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
    expect((await renderState(page)).stops).toBe(narrowed.stops);
    await expect(chips(page).filter({ hasText: 'Pocitos' })).toHaveAttribute(
        'aria-pressed',
        'true',
    );

    await page.goBack();
    await page.waitForFunction((w) => window.__mvdGetRenderState().stops === w, whole.stops);
    await expect(chips(page).first()).toHaveAttribute('aria-pressed', 'true');
});

test('a line with one destination offers no choice at all', async ({ page }) => {
    // L5 has a single headsign; a lone chip would imply there is something to
    // pick between.
    await openMap(page, { theme: 'dark' });
    await renderLine(page, 'L5');
    await expect(page.locator('#destinations')).toBeHidden();
});

test('the picker does not linger on views that are not a line', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await renderLine(page, '104');
    await expect(page.locator('#destinations')).toBeVisible();

    await page.evaluate(() => {
        location.hash = '#/';
    });
    await expect(page.locator('#destinations')).toBeHidden();
});
