/**
 * Basemap provider (user report, 2026-08-22: the live map showed
 * "API KEY REQUIRED / carto.com/basemaps/apikey" stamped across every tile).
 *
 * CARTO's basemaps stopped being key-free, so the tiles moved to Esri's Canvas
 * services, which are not. Two different things are checked here:
 *
 *  - the STATIC contract, which is deterministic and cheap: no key in the URL,
 *    the host is allowed by the meta CSP, and Leaflet is told where the tiles
 *    stop existing;
 *  - the LIVE one, which hits the network on purpose. A basemap that starts
 *    demanding a key does not break any other test in this suite — every other
 *    spec blocks tiles for determinism — so nothing here would have caught the
 *    reported failure. This does: it fetches one tile per theme and fails if the
 *    provider stops serving real ones.
 */
import { test, expect } from '@playwright/test';
import { openMap } from './helpers.js';

const config = (page) =>
    page.evaluate(async () => {
        const { CONFIG } = await import('/src/config.js');
        return {
            urls: CONFIG.TILE_URLS,
            maxNativeZoom: CONFIG.TILE_MAX_NATIVE_ZOOM,
            maxZoom: CONFIG.MAX_ZOOM,
        };
    });

/** Fills a Leaflet URL template with one tile over central Montevideo. */
const tileUrl = (template, z) => {
    const n = 2 ** z;
    const lat = -34.9055;
    const lon = -56.187;
    const x = Math.floor(((lon + 180) / 360) * n);
    const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
    return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
};

test('the tile URLs carry no API key and no key placeholder', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    const { urls } = await config(page);

    for (const [theme, url] of Object.entries(urls)) {
        expect(url, `${theme} tiles are not https`).toMatch(/^https:\/\//);
        expect(url.toLowerCase(), `${theme} tiles ask for a key`).not.toMatch(
            /api[-_]?key|access[-_]?token|\bkey=|\{key\}|apikey/,
        );
    }
});

test('the tile host is the one the CSP allows', async ({ page }) => {
    // A basemap move that forgets the CSP fails in the browser only — the tiles
    // are simply blocked — so the two are compared here rather than trusted.
    await openMap(page, { theme: 'dark' });
    const { urls } = await config(page);
    const csp = await page.evaluate(
        () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '',
    );
    const imgSrc = csp.split(';').find((d) => d.trim().startsWith('img-src')) ?? '';

    for (const url of Object.values(urls)) {
        const { host } = new URL(url.replace(/\{[a-z]\}/g, '0'));
        expect(imgSrc, `img-src does not allow ${host}`).toContain(host);
    }
});

test('Leaflet is told where the basemap stops having data', async ({ page }) => {
    // Esri's Canvas has no imagery past z16 over Montevideo: it answers with a
    // grey "Map data not yet available" placeholder. maxNativeZoom is what makes
    // Leaflet upscale the last real tiles instead of tiling that text.
    await openMap(page, { theme: 'dark' });
    const cfg = await config(page);
    expect(cfg.maxNativeZoom).toBeGreaterThan(0);
    expect(cfg.maxNativeZoom).toBeLessThan(cfg.maxZoom);

    const layer = await page.evaluate(() => {
        let found = null;
        window.__mvdMap.eachLayer((l) => {
            if (l.getTileUrl) found = { max: l.options.maxZoom, native: l.options.maxNativeZoom };
        });
        return found;
    });
    expect(layer).not.toBeNull();
    expect(layer.native).toBe(cfg.maxNativeZoom);
    expect(layer.max).toBe(cfg.maxZoom);
});

test('the provider still serves real tiles without a key', async ({ page, request }) => {
    // The one test in this suite that WANTS the network: it is the canary for
    // the incident that caused this move. A failure here means the basemap
    // provider changed its terms, not that this repo broke.
    await openMap(page, { theme: 'dark' });
    const { urls, maxNativeZoom } = await config(page);

    for (const [theme, template] of Object.entries(urls)) {
        const url = tileUrl(template, maxNativeZoom);
        const res = await request.get(url, { timeout: 30_000 });
        expect(res.status(), `${theme} tile ${url}`).toBe(200);
        expect(res.headers()['content-type'] ?? '').toMatch(/^image\//);
        // A gate tile ("API KEY REQUIRED", "Map data not yet available") is a
        // flat placeholder and compresses to a fraction of a real one; the
        // measured real tiles here are 13–17 kB, the placeholders 2.5 kB.
        const bytes = (await res.body()).length;
        expect(bytes, `${theme} tile is only ${bytes} bytes — a placeholder?`).toBeGreaterThan(
            5_000,
        );
    }
});
