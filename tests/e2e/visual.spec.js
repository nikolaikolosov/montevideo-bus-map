/**
 * Curated pixel scenes: the hardest shared corridors, known edge cases and
 * both themes, screenshotted with external tiles/fonts blocked. Baselines are
 * platform-specific (…-win32.png / …-linux.png) and live in
 * tests/e2e/__screenshots__/.
 *
 * Known-correct data oddities are part of the baselines by design (Terminal
 * Cerro driveways, line 187's out-and-back spur, ida/vuelta double strands).
 *
 * Update baselines after an intentional visual change:
 *   npx playwright test visual --update-snapshots
 * CI runs with --update-snapshots=missing: the first run on a new platform
 * creates its baselines (uploaded as artifacts to be committed); existing
 * baselines are compared strictly.
 */
import { test, expect } from '@playwright/test';
import { openMap, renderLine, renderStopRoutes, setView } from './helpers.js';

// 18 de Julio / Ejido — the densest shared corridor in the network.
const CORRIDOR_CENTER = [-34.9055, -56.187];

const scenes = [
    { name: 'global-stops-dark', theme: 'dark' },
    { name: 'global-stops-light', theme: 'light' },
    { name: 'linea-100-dark', theme: 'dark', line: '100' },
    { name: 'linea-100-light', theme: 'light', line: '100' },
    { name: 'stop-4018-downstream-dark', theme: 'dark', stop: 4018 },
    { name: 'stop-4018-downstream-light', theme: 'light', stop: 4018 },
    { name: 'terminal-4967-empty-dark', theme: 'dark', stop: 4967 },
    { name: 'linea-187-spur-dark', theme: 'dark', line: '187' },
    { name: 'corridor-zoom-12', theme: 'dark', line: '100', view: { zoom: 12 } },
    { name: 'corridor-zoom-15', theme: 'dark', line: '100', view: { zoom: 15 } },
    { name: 'corridor-zoom-17', theme: 'dark', line: '100', view: { zoom: 17 } },
];

for (const scene of scenes) {
    test(`scene: ${scene.name}`, async ({ page }) => {
        await openMap(page, { theme: scene.theme });
        if (scene.line) await renderLine(page, scene.line);
        if (scene.stop) await renderStopRoutes(page, scene.stop);
        if (scene.view) await setView(page, CORRIDOR_CENTER, scene.view.zoom);
        await page.waitForTimeout(400); // let the canvas settle
        await expect(page).toHaveScreenshot(`${scene.name}.png`);
    });
}
