/**
 * "Support the author" link (user request, 2026-08-22).
 *
 * A Ko-fi link in the panel footer, in all three languages. Two things make
 * it more than a link: it leaves the site, so it must not hand the target window
 * a handle on ours; and it lives in the mobile bottom sheet, whose height is
 * budgeted at ≥82 % of the screen for the map — so it shares the row the data
 * date already occupies instead of adding one.
 */
import { test, expect, devices } from '@playwright/test';
import { openMap } from './helpers.js';

const KOFI = 'https://ko-fi.com/nikolaikolosov';

const PIXEL_7 = { ...devices['Pixel 7'] };
delete PIXEL_7.defaultBrowserType;

const LABELS = {
    es: 'Apoyar al autor',
    en: 'Support the author',
    ru: 'Поддержать автора',
};

test('points at the author’s Ko-fi, and opens it without handing over the tab', async ({
    page,
}) => {
    await openMap(page, { theme: 'dark' });
    const link = page.locator('#supportLink');

    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', KOFI);
    await expect(link.locator('.support-heart')).toHaveText('♥');
    await expect(link).toHaveAttribute('target', '_blank');
    // Without noopener the opened page gets window.opener and can navigate this
    // tab; noreferrer keeps the visitor's current view out of the referrer.
    const rel = (await link.getAttribute('rel')) ?? '';
    expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
});

test('every off-site link in the panel carries noopener', async ({ page }) => {
    // Read them all rather than naming this one: the next link added to the
    // panel gets the same guarantee without anyone remembering to add a test.
    await openMap(page, { theme: 'dark' });
    const offenders = await page.evaluate(() =>
        [...document.querySelectorAll('#ui-panel a[target="_blank"]')]
            .filter((a) => !(a.rel || '').split(/\s+/).includes('noopener'))
            .map((a) => a.href),
    );
    expect(offenders).toEqual([]);
});

for (const [lang, label] of Object.entries(LABELS)) {
    test(`reads "${label}" in ${lang}`, async ({ page }) => {
        await openMap(page, { theme: 'dark', lang });
        // The heart is part of the link's text, so the label is matched on the span.
        await expect(page.locator('#supportLink .support-label')).toHaveText(label);
        // The tooltip is translated too — it is what says the money goes through
        // Ko-fi, which the label deliberately does not.
        // The tooltip and the accessible name say where the money goes AND
        // that the link leaves the site — the label deliberately does neither.
        const link = page.locator('#supportLink');
        const title = await link.getAttribute('title');
        expect(title).toContain('Ko-fi');
        expect(title).not.toBe(label);
        expect(await link.getAttribute('aria-label')).toBe(title);
    });
}

test('follows the language switcher without a reload', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    const label = page.locator('#supportLink .support-label');
    await expect(label).toHaveText(LABELS.es);

    await page.click('.lang-btn[data-lang="ru"]');
    await expect(label).toHaveText(LABELS.ru);
    await expect(page.locator('#supportLink')).toHaveAttribute('title', /Ko-fi/);
    // The heart is a span of its own precisely so a re-label cannot eat it.
    await expect(page.locator('#supportLink .support-heart')).toHaveText('♥');

    await page.click('.lang-btn[data-lang="en"]');
    await expect(label).toHaveText(LABELS.en);
});

test.describe('on a phone', () => {
    test.use(PIXEL_7);

    for (const lang of Object.keys(LABELS)) {
        test(`costs the sheet no extra row in ${lang}`, async ({ page }) => {
            await openMap(page, { theme: 'dark', lang });
            // The line view is the tall case: destination chips plus the stats.
            await page.evaluate(() => window.__mvdSelectLine('104'));
            await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);

            const m = await page.evaluate(() => {
                const box = (s) => document.querySelector(s).getBoundingClientRect();
                const panel = box('#ui-panel');
                const link = box('#supportLink');
                const fresh = box('#dataFreshness');
                return {
                    ratio: panel.height / window.innerHeight,
                    footerHeight: box('.panel-footer').height,
                    linkHeight: link.height,
                    centresApart: Math.abs(
                        (link.top + link.bottom) / 2 - (fresh.top + fresh.bottom) / 2,
                    ),
                    clearOfTheDate: link.left >= fresh.right,
                    docScrollWidth: document.documentElement.scrollWidth,
                    viewportWidth: window.innerWidth,
                    // The tap target is an invisible overlay, so it is measured
                    // by what a finger 14 px above and below the label hits —
                    // not by the pill's own box.
                    hitsAbove:
                        document
                            .elementFromPoint((link.left + link.right) / 2, link.top - 8)
                            ?.closest('#supportLink') !== null,
                    hitsBelow:
                        document
                            .elementFromPoint((link.left + link.right) / 2, link.bottom + 8)
                            ?.closest('#supportLink') !== null,
                };
            });

            // The sheet's budget (mobile-panel.spec.js) still holds.
            expect(m.ratio).toBeLessThanOrEqual(0.24);
            // One row: the link sits on the data date's line, not under it.
            expect(m.centresApart).toBeLessThan(6);
            expect(m.clearOfTheDate).toBe(true);
            // …and the row is as tall as its text: the pill does not grow to
            // touch size, its invisible hit area does.
            expect(m.footerHeight).toBeLessThan(24);
            expect(m.linkHeight).toBeLessThan(24);
            // Which still leaves a real touch target (component-inventory R5):
            // 8 px past the label in both directions still hits the link, so the
            // target spans well over 40 px.
            expect(m.hitsAbove, 'no tap target above the label').toBe(true);
            expect(m.hitsBelow, 'no tap target below the label').toBe(true);
            // The longest label (Russian) must not widen the page either.
            expect(m.docScrollWidth).toBeLessThanOrEqual(m.viewportWidth + 1);
        });
    }
});
