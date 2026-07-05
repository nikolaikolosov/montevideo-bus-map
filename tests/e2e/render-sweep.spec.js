/**
 * Whole-map render sweep: renders every line headlessly and compares a
 * deterministic manifest of the resulting Leaflet layers (corridor count,
 * point count, colors, bounds, stop/label counts) against a committed golden.
 *
 * Catches construction/render-state regressions across ALL 140 lines on every
 * change, without pixel flake.
 *
 * Update the golden after an intentional rendering change:
 *   UPDATE_GOLDEN=1 npx playwright test render-sweep
 */
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openMap, renderLine } from './helpers.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), 'golden');
const GOLDEN_PATH = join(GOLDEN_DIR, 'render-manifest.json');

test('render manifest of all lines matches the golden', async ({ page }) => {
    test.setTimeout(600_000);
    await openMap(page, { theme: 'dark' });

    const lines = await page.evaluate(() =>
        [...document.querySelectorAll('#routeSelect option')]
            .map((o) => o.value)
            .filter((v) => v && v !== 'ALL_STOPS'),
    );
    expect(lines).toHaveLength(140);

    const manifest = {};
    for (const line of lines) {
        await renderLine(page, line);
        const s = await page.evaluate(() => window.__mvdGetRenderState());
        const bbox = s.sectionList.reduce(
            (acc, sec) => [
                Math.min(acc[0], sec.bounds[0]),
                Math.min(acc[1], sec.bounds[1]),
                Math.max(acc[2], sec.bounds[2]),
                Math.max(acc[3], sec.bounds[3]),
            ],
            [Infinity, Infinity, -Infinity, -Infinity],
        );
        manifest[line] = {
            sections: s.sections,
            totalPoints: s.sectionList.reduce((a, x) => a + x.points, 0),
            colors: [...new Set(s.sectionList.map((x) => x.color))].sort(),
            weights: [...new Set(s.sectionList.map((x) => x.weight))].sort(),
            bbox: bbox.map((v) => +v.toFixed(4)),
            stops: s.stops,
            labels: s.labels,
        };
    }

    if (process.env.UPDATE_GOLDEN) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(GOLDEN_PATH, JSON.stringify(manifest, null, 1));
        console.log(`golden updated: ${GOLDEN_PATH}`);
        return;
    }

    expect(existsSync(GOLDEN_PATH), 'golden missing — run with UPDATE_GOLDEN=1').toBe(true);
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
    expect(manifest).toEqual(golden);
});
