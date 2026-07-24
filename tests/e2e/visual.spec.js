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
import {
    openMap,
    renderLine,
    renderStopRoutes,
    setView,
    openStopPopup,
    planJourney,
} from './helpers.js';

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
    // Busiest-popup reference: 34 line chips with inner scroll (brainstorm-003)
    { name: 'popup-4772-dark', theme: 'dark', popup: 4772 },
    { name: 'popup-4772-light', theme: 'light', popup: 4772 },
    // Section-boundary joints (brainstorm-005): the Artigas→Ellauri corner
    // where 9 continuing lines previously rendered wedge gaps (stop 2061,
    // "Ver rutas (todas)", between stops 4850 and 3382).
    {
        name: 'joint-ellauri-corner-dark',
        theme: 'dark',
        stop: 2061,
        view: { center: [-34.92505, -56.16125], zoom: 18 },
    },
    {
        name: 'joint-ellauri-corner-light',
        theme: 'light',
        stop: 2061,
        view: { center: [-34.92505, -56.16125], zoom: 18 },
    },
    // Downstream-render fidelity (user report 2026-07-05): these stops used
    // to render chords across city blocks because the stop coordinate was
    // injected into the trace head (see truncateLineDownstream).
    {
        name: 'downstream-4534-dark',
        theme: 'dark',
        stop: 4534,
        view: { center: [-34.9113, -56.1782], zoom: 16 },
    },
    {
        name: 'downstream-3987-light',
        theme: 'light',
        stop: 3987,
        view: { center: [-34.9117, -56.1598], zoom: 16 },
    },
    // i18n (brainstorm-006): pin the Cyrillic panel rendering — the hardest
    // script for platform font fallbacks. Popup covered by unit/e2e tests.
    { name: 'panel-ru-dark', theme: 'dark', lang: 'ru', popup: 4772 },
    // Journey planner: a two-transfer itinerary across the city (ride strokes
    // in line colours over their casings, dashed transfer walks, A/B pins)
    // and the panel that itemises it, in both themes.
    { name: 'journey-1000-1480-dark', theme: 'dark', journey: [1000, 1480] },
    { name: 'journey-1000-1480-light', theme: 'light', journey: [1000, 1480] },
];

for (const scene of scenes) {
    test(`scene: ${scene.name}`, async ({ page }) => {
        await openMap(page, { theme: scene.theme, lang: scene.lang });
        if (scene.line) await renderLine(page, scene.line);
        if (scene.stop) await renderStopRoutes(page, scene.stop);
        if (scene.journey) await planJourney(page, ...scene.journey);
        if (scene.popup) await openStopPopup(page, scene.popup);
        if (scene.view) await setView(page, scene.view.center ?? CORRIDOR_CENTER, scene.view.zoom);
        await page.waitForTimeout(400); // let the canvas settle
        await expect(page).toHaveScreenshot(`${scene.name}.png`);
    });
}
