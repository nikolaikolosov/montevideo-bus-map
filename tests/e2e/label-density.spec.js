/**
 * Route label density (ux-review-001 R6, finding F5).
 *
 * Labels used to cluster by a fixed GROUND distance (~50 m), which is sub-pixel
 * at city zoom: on a Pixel 7 line 405 rendered twelve chips all reading "405",
 * the closest pair 3 px apart. They now cluster by SCREEN distance and re-group
 * whenever the zoom changes, so the rule is the one the rider actually sees.
 */
import { test, expect, devices } from '@playwright/test';
import { openMap, renderLine, setView } from './helpers.js';

const MIN_GAP_PX = 48; // CONFIG.LABEL_MIN_GAP_PX
const PIXEL_7 = { ...devices['Pixel 7'] };
delete PIXEL_7.defaultBrowserType;

/** Closest pair of on-screen labels carrying the SAME line id, in pixels. */
const closestSameId = (page) =>
    page.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const on = [...document.querySelectorAll('.route-label-item')].filter((el) => {
            const b = el.getBoundingClientRect();
            return b.right > 0 && b.left < vw && b.bottom > 0 && b.top < vh;
        });
        let min = Infinity;
        for (let i = 0; i < on.length; i++) {
            for (let j = i + 1; j < on.length; j++) {
                if (on[i].textContent !== on[j].textContent) continue;
                const a = on[i].getBoundingClientRect();
                const b = on[j].getBoundingClientRect();
                min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
            }
        }
        return { count: on.length, min };
    });

test.describe('on a phone', () => {
    test.use(PIXEL_7);

    // 405 was the reported case; 104 and 183 stacked the same way.
    for (const line of ['405', '104', '183']) {
        test(`line ${line} never stacks two copies of its own number`, async ({ page }) => {
            await openMap(page, { theme: 'dark' });
            await renderLine(page, line);

            const { count, min } = await closestSameId(page);
            expect(count, 'no labels on screen — the check would be vacuous').toBeGreaterThan(1);
            expect(min).toBeGreaterThanOrEqual(MIN_GAP_PX - 1);
        });
    }
});

test('zooming in re-groups the labels instead of keeping the old grouping', async ({ page }) => {
    // The grouping is only valid for the zoom it was computed at; without the
    // re-cluster on zoomend, chips merged at city zoom would stay merged when
    // the rider zooms into a terminal, and chips split at high zoom would stay
    // split when they zoom out — which is the original bug in the other
    // direction.
    await openMap(page, { theme: 'dark' });
    await renderLine(page, '405');
    const wide = await page.evaluate(() => window.__mvdGetRenderState().labels);

    await setView(page, [-34.8875, -56.1046], 16);
    const close = await page.evaluate(() => window.__mvdGetRenderState().labels);
    expect(close, 'zooming in must reveal labels the wide view had merged').toBeGreaterThan(wide);

    const { min, count } = await closestSameId(page);
    if (count > 1) expect(min).toBeGreaterThanOrEqual(MIN_GAP_PX - 1);
});

test('a multi-line view still tells its lines apart', async ({ page }) => {
    // Merging is by position, never by line id: two different lines ending at
    // the same terminal share one group and both ids stay visible.
    await openMap(page, { theme: 'dark' });
    await page.evaluate(() => window.__mvdShowStopRoutes(4772));
    await page.waitForFunction(() => window.__mvdGetRenderState().sections > 0);

    // A Set does not survive serialisation out of the page — return an array.
    const ids = await page.evaluate(() => [
        ...new Set([...document.querySelectorAll('.route-label-item')].map((e) => e.textContent)),
    ]);
    expect(ids.length).toBeGreaterThan(1);
});
