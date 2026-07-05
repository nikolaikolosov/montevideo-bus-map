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
            // Canvas anti-aliasing wiggles a little between runs; real route
            // regressions move whole polylines and blow far past this.
            maxDiffPixelRatio: 0.02,
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
