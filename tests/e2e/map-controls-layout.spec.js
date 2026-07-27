/**
 * Layout of the right-hand map control column (user report, 2026-07-27).
 *
 * The locate control shipped 5 px off the axis the zoom and home buttons share
 * on mobile: the media query granted the 15 px inset by naming each control, and
 * the new one simply was not in the list. The fix moved the rule onto the column
 * so anything added there inherits it — and these tests are written the same
 * way, reading EVERY control in the column out of the DOM rather than naming
 * them, so a control added later is covered without touching this file.
 *
 * Two invariants, both viewports:
 *  - every control is centred on one vertical axis;
 *  - the vertical gaps between consecutive controls are all equal.
 */
import { test, expect, devices } from '@playwright/test';
import { openMap } from './helpers.js';

// devices[] carries defaultBrowserType, which Playwright forbids in a describe.
const PIXEL_7 = { ...devices['Pixel 7'] };
delete PIXEL_7.defaultBrowserType;

/** Geometry of every control in the top-right column, in stacking order. */
const columnRects = (page) =>
    page.evaluate(() => {
        const column = document.querySelector('.leaflet-top.leaflet-right');
        return [...column.querySelectorAll(':scope > .leaflet-control')].map((el) => {
            const b = el.getBoundingClientRect();
            return {
                name: el.className.split(' ')[0],
                centre: b.x + b.width / 2,
                width: b.width,
                top: b.top,
                bottom: b.bottom,
            };
        });
    });

/** Asserts the two invariants over whatever controls the column holds. */
async function expectAlignedColumn(page, label) {
    const rects = await columnRects(page);
    expect(
        rects.length,
        `${label}: no controls found — the check would be vacuous`,
    ).toBeGreaterThan(2);

    const axis = rects[0].centre;
    for (const r of rects) {
        expect(
            Math.abs(r.centre - axis),
            `${label}: ${r.name} is off the column axis by ${(r.centre - axis).toFixed(1)} px`,
        ).toBeLessThan(0.5);
    }

    const gaps = rects.slice(1).map((r, i) => r.top - rects[i].bottom);
    for (const [i, gap] of gaps.entries()) {
        expect(
            Math.abs(gap - gaps[0]),
            `${label}: gap ${i + 1} is ${gap.toFixed(1)} px, gap 1 is ${gaps[0].toFixed(1)} px`,
        ).toBeLessThan(0.5);
    }
    // A column whose controls overlap would satisfy "all gaps equal" too.
    expect(gaps[0], `${label}: controls are not separated`).toBeGreaterThan(0);
}

test('desktop: every right-hand control shares one axis and one spacing', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    await expectAlignedColumn(page, 'desktop');
});

test.describe('mobile', () => {
    test.use(PIXEL_7);

    test('every right-hand control shares one axis and one spacing', async ({ page }) => {
        await openMap(page, { theme: 'dark' });
        await expectAlignedColumn(page, 'mobile');
    });

    test('a control added later inherits the alignment', async ({ page }) => {
        // The rule the user asked for is "every button that will ever be added
        // on the right", so it is tested that way: a fourth control is injected
        // into the column exactly as Leaflet would add one, and must land on the
        // same axis and spacing without any CSS naming it.
        await openMap(page, { theme: 'dark' });
        await page.evaluate(() => {
            const column = document.querySelector('.leaflet-top.leaflet-right');
            const el = document.createElement('button');
            el.className = 'home-control leaflet-control';
            el.style.width = '34px';
            el.style.height = '34px';
            column.appendChild(el);
        });
        await expectAlignedColumn(page, 'mobile + injected control');
    });
});
