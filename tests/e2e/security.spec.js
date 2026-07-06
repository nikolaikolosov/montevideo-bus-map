/**
 * Security smoke checks (security/threat-model.md, M-3).
 *
 * The app ships a `<meta http-equiv="Content-Security-Policy">`. This guards
 * that the policy does not break the app (Leaflet, tiles, fonts, our modules
 * all load) and that no CSP directive is violated at runtime — a regression
 * here (a new inline handler, an un-allowlisted origin) would surface as a
 * console CSP error and fail this test.
 */
import { test, expect } from '@playwright/test';
import { openMap } from './helpers.js';

test('no Content-Security-Policy violations on load', async ({ page }) => {
    const cspErrors = [];
    page.on('console', (m) => {
        if (m.type() === 'error' && /content security policy|refused to/i.test(m.text())) {
            cspErrors.push(m.text());
        }
    });
    page.on('pageerror', (e) => cspErrors.push(String(e.message)));

    await openMap(page, { theme: 'dark' });

    // The app fully rendered under the policy (Leaflet + data both work).
    expect(await page.evaluate(() => typeof window.L)).toBe('object');
    expect(await page.evaluate(() => window.__mvdGetRenderState().stops)).toBeGreaterThan(4000);
    expect(cspErrors, cspErrors.join('\n')).toEqual([]);
});

test('the CSP meta ships a strict default-src and no inline handlers remain', async ({ page }) => {
    await openMap(page, { theme: 'dark' });
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    // frame-ancestors is inert via <meta> — must not be present (would only warn).
    expect(csp).not.toContain('frame-ancestors');
    // No inline event handlers in the served HTML (they would need 'unsafe-inline').
    const inlineHandlers = await page.evaluate(
        () => document.querySelectorAll('[onclick],[onload],[onerror]').length,
    );
    expect(inlineHandlers).toBe(0);
});
