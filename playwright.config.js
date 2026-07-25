import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 120_000,
    retries: 0,
    // One worker: a single Leaflet instance at a time keeps render timing stable.
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:8788',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
    },
    expect: {
        toHaveScreenshot: {
            // An ABSOLUTE budget, because the ratio was measured against the
            // wrong denominator: 2 % of a 1280×800 page is 20,480 px, while the
            // map ink a scene actually contains is 774 px (stop-4018-downstream),
            // 4,614 (corridor-zoom-12), 7,077 (journey-1000-1480) … 42,729
            // (global-stops). Eight of thirteen measured scenes could therefore
            // lose their ENTIRE route render and still match their baseline.
            //
            // With tiles and fonts blocked and animations disabled the canvas is
            // deterministic: two full zero-tolerance runs of all 20 scenes each
            // differed by 0 px.
            // 120 px is that measurement plus room for anti-aliasing noise on a
            // platform we cannot measure from here, and still 6× below the
            // weakest scene's ink.
            maxDiffPixels: 120,
            animations: 'disabled',
        },
    },
    // Screenshot baselines are platform-specific (fonts/AA differ per OS).
    snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}-{platform}{ext}',
    webServer: {
        command:
            process.platform === 'win32'
                ? 'python -m http.server 8788 --bind 127.0.0.1'
                : 'python3 -m http.server 8788 --bind 127.0.0.1',
        port: 8788,
        reuseExistingServer: true,
    },
});
