// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    sunTimes,
    resolveAutoTheme,
    nextBoundary,
    setThemeOverride,
    initTheme,
    getTheme,
    applyTheme,
    onThemeChange,
} from '../../src/theme.js';
import { getLineColor } from '../../src/data.js';
import { CONFIG } from '../../src/config.js';

const [LAT, LON] = CONFIG.MAP_CENTER; // Montevideo: -34.88, -56.16 (UTC-3)

beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '<meta name="theme-color" content="#0f172a">';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-05T15:00:00Z'));
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('sunTimes (NOAA approximation, Montevideo)', () => {
    it('winter day (June 21) lasts roughly 9–10.5 hours', () => {
        const { sunrise, sunset } = sunTimes(new Date('2026-06-21T12:00:00Z'), LAT, LON);
        const hours = (sunset - sunrise) / 3600000;
        expect(sunrise.getTime()).toBeLessThan(sunset.getTime());
        expect(hours).toBeGreaterThan(9);
        expect(hours).toBeLessThan(10.5);
    });

    it('summer day (December 21) lasts roughly 14–15 hours', () => {
        const { sunrise, sunset } = sunTimes(new Date('2026-12-21T12:00:00Z'), LAT, LON);
        const hours = (sunset - sunrise) / 3600000;
        expect(hours).toBeGreaterThan(14);
        expect(hours).toBeLessThan(15);
    });

    it('returns null only for polar latitudes', () => {
        expect(sunTimes(new Date('2026-06-21T12:00:00Z'), LAT, LON)).not.toBeNull();
        expect(sunTimes(new Date('2026-06-21T12:00:00Z'), 89, 0)).toBeNull();
    });
});

describe('resolveAutoTheme', () => {
    it('is light at local noon and dark at local midnight', () => {
        // 15:00 UTC = 12:00 in Montevideo (UTC-3)
        expect(resolveAutoTheme(new Date('2026-06-27T15:00:00Z'))).toBe('light');
        // 03:00 UTC = 00:00 local
        expect(resolveAutoTheme(new Date('2026-06-27T03:00:00Z'))).toBe('dark');
        // 22:00 UTC = 19:00 local — after the winter sunset (~17:40)
        expect(resolveAutoTheme(new Date('2026-06-27T22:00:00Z'))).toBe('dark');
    });
});

describe('nextBoundary', () => {
    it('is strictly in the future and within 24 hours', () => {
        const now = new Date('2026-07-05T15:00:00Z');
        const b = nextBoundary(now);
        expect(b.getTime()).toBeGreaterThan(now.getTime());
        expect(b.getTime() - now.getTime()).toBeLessThanOrEqual(86400000);
    });

    it('marks an actual theme flip', () => {
        const now = new Date('2026-07-05T15:00:00Z');
        const b = nextBoundary(now);
        const before = resolveAutoTheme(new Date(b.getTime() - 60000));
        const after = resolveAutoTheme(new Date(b.getTime() + 60000));
        expect(before).not.toBe(after);
    });
});

describe('applyTheme / onThemeChange', () => {
    it('sets data-theme, meta theme-color and notifies once per change', () => {
        const seen = [];
        onThemeChange((t) => seen.push(t));
        applyTheme('light');
        applyTheme('light'); // no-op
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe(
            CONFIG.THEME_META_COLORS.light,
        );
        applyTheme('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(seen).toEqual(['light', 'dark']);
    });
});

describe('manual override', () => {
    it('wins over the auto theme and persists in localStorage', () => {
        const night = new Date('2026-07-05T03:00:00Z'); // local midnight → auto dark
        setThemeOverride('light', night);
        expect(getTheme()).toBe('light');
        const stored = JSON.parse(localStorage.getItem('mvd-theme-override'));
        expect(stored.theme).toBe('light');
        expect(stored.expiresAt).toBeGreaterThan(night.getTime());
    });

    it('expires at the next natural boundary, then auto resumes', () => {
        const night = new Date('2026-07-05T03:00:00Z');
        setThemeOverride('light', night);
        const pastExpiry = new Date(nextBoundary(night).getTime() + 60000);
        initTheme(pastExpiry); // sunrise passed → override dropped, daylight → light anyway?
        // At one minute past the boundary after local midnight the boundary is
        // sunrise, so the auto theme is 'light'; the override must be gone.
        expect(localStorage.getItem('mvd-theme-override')).toBeNull();
        expect(getTheme()).toBe(resolveAutoTheme(pastExpiry));
    });
});

describe('theme-aware line colors', () => {
    it('serves the palette variant of the active theme', () => {
        applyTheme('dark');
        const dark = getLineColor('100');
        applyTheme('light');
        const light = getLineColor('100');
        expect(dark).not.toBe(light);
        expect(dark).toMatch(/^#[0-9a-f]{6}$/);
        expect(light).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('fallback (line missing from palette) keeps the hue, changes lightness', () => {
        applyTheme('dark');
        const dark = getLineColor('NO-SUCH-LINE');
        applyTheme('light');
        const light = getLineColor('NO-SUCH-LINE');
        expect(dark).not.toBe(light);
        const hue = (c) => c.match(/^hsl\(([\d.]+),/)[1];
        expect(hue(dark)).toBe(hue(light));
        expect(dark).toContain(`${CONFIG.LINE_COLOR_BY_THEME.dark.lightness}%`);
        expect(light).toContain(`${CONFIG.LINE_COLOR_BY_THEME.light.lightness}%`);
    });
});

describe('initTheme scheduling', () => {
    it('flips the theme when the boundary timer fires', () => {
        const now = new Date('2026-07-05T15:00:00Z'); // local noon → light
        vi.setSystemTime(now);
        initTheme(now);
        expect(getTheme()).toBe('light');
        const boundary = nextBoundary(now); // sunset
        vi.setSystemTime(new Date(boundary.getTime() + 6000));
        vi.advanceTimersByTime(boundary.getTime() - now.getTime() + 6000);
        expect(getTheme()).toBe('dark');
    });
});
