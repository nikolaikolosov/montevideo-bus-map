/**
 * Decluttering the all-stops view (ux-review-001 X4, finding F6: "downtown is a
 * solid field of rings on mobile" — measured, every one of the 4,901 rings is
 * inside a phone's viewport at zoom 10 and 3,121 at zoom 12).
 *
 * Below STOP_THIN_MAX_ZOOM only one ring per grid cell is DRAWN. Every stop
 * stays in the layer: a first attempt removed them, and a stop that is not a
 * layer cannot be opened, so search and deep links silently did nothing for most
 * stops reached from the city view.
 */
import { test, expect, devices } from '@playwright/test';
import { openMap, setView, openStopPopup } from './helpers.js';

const PIXEL_7 = { ...devices['Pixel 7'] };
delete PIXEL_7.defaultBrowserType;

/** Rings actually drawn (radius > 0) and total markers present. */
const rings = (page) =>
    page.evaluate(() => {
        let drawn = 0;
        let present = 0;
        window.__mvdMap.eachLayer((l) => {
            if (l.getLatLng && l.options?.radius !== undefined) {
                present += 1;
                if (l.options.radius > 0) drawn += 1;
            }
        });
        return { drawn, present };
    });

test.describe('on a phone', () => {
    test.use(PIXEL_7);

    test('thins the drawn rings at city zoom and restores them further in', async ({ page }) => {
        await openMap(page, { theme: 'dark' });

        await setView(page, [-34.88, -56.16], 10);
        const wide = await rings(page);
        expect(wide.present, 'every stop must stay in the layer').toBe(4901);
        expect(wide.drawn, 'the field must thin out').toBeLessThan(1200);

        await setView(page, [-34.88, -56.16], 13);
        const close = await rings(page);
        expect(close.present).toBe(4901);
        expect(close.drawn).toBe(4901); // once rings read as individual stops
        expect(close.drawn).toBeGreaterThan(wide.drawn * 3);
    });

    test('keeps the same rings as the rider pans, instead of shimmering', async ({ page }) => {
        // The survivor of a cell is chosen by stop code, never by distance to the
        // centre, so panning must not swap which rings are drawn.
        await openMap(page, { theme: 'dark' });
        await setView(page, [-34.88, -56.16], 11);
        const codes = () =>
            page.evaluate(() => {
                const out = [];
                window.__mvdMap.eachLayer((l) => {
                    if (l.options?.radius > 0 && l.feature?.properties?.COD_UBIC_P) {
                        out.push(l.feature.properties.COD_UBIC_P);
                    }
                });
                return out.sort((a, b) => a - b).join(',');
            });
        const before = await codes();
        await page.evaluate(() => {
            // Braces: panBy returns the map, which cannot be serialised.
            window.__mvdMap.panBy([180, 120], { animate: false });
        });
        await page.waitForTimeout(150);
        expect(await codes()).toBe(before);
    });

    test('a hidden stop is still reachable — the ring goes, the stop stays', async ({ page }) => {
        // The failure that sank the first attempt: search and deep links open a
        // popup by finding the stop's layer.
        await openMap(page, { theme: 'dark' });
        await setView(page, [-34.88, -56.16], 11);

        const hidden = await page.evaluate(() => {
            let code = null;
            window.__mvdMap.eachLayer((l) => {
                if (code === null && l.options?.radius === 0 && l.feature?.properties?.COD_UBIC_P) {
                    code = l.feature.properties.COD_UBIC_P;
                }
            });
            return code;
        });
        expect(hidden, 'no hidden stop found — the check would be vacuous').not.toBeNull();

        await openStopPopup(page, hidden);
        await expect(page.locator('.popup-content')).toBeVisible();
    });
});

test('a zoom change does not hand the hidden rings their radius back', async ({ page }) => {
    // Restyling on zoom runs per stop for exactly this reason: a blanket
    // setStyle would overwrite every radius, including the zeros.
    await openMap(page, { theme: 'dark' });
    await setView(page, [-34.88, -56.16], 10);
    const first = (await rings(page)).drawn;
    await setView(page, [-34.88, -56.16], 11);
    const second = (await rings(page)).drawn;
    expect(second).toBeLessThan(1200);
    expect(first).toBeLessThan(1200);
});
