/**
 * theme.js — light/dark theme driven by real sunrise/sunset in Montevideo.
 *
 * The theme follows daylight at the map's home coordinates (CONFIG.MAP_CENTER):
 * light between sunrise and sunset, dark otherwise. Solar times come from the
 * NOAA sunrise-equation approximation (accurate to a few minutes — plenty for
 * a theme switch); no dependency, no geolocation permission needed.
 *
 * A manual override (the sun/moon toggle) is persisted in localStorage and
 * expires at the NEXT natural sunrise/sunset boundary, so automatic switching
 * resumes by itself.
 *
 * Consumers subscribe via onThemeChange(); applyTheme() also sets
 * <html data-theme> (drives all CSS custom properties) and <meta theme-color>.
 */

import { CONFIG } from './config.js';

const STORAGE_KEY = 'mvd-theme-override';
const DEG = Math.PI / 180;

/** @type {'dark'|'light'|null} */
let currentTheme = null;
let switchTimer = null;
const listeners = new Set();

// ---------------------------------------------------------------------------
// Solar math (NOAA general solar position calculations, simplified)
// ---------------------------------------------------------------------------

/**
 * Sunrise and sunset (UTC) for the given date at lat/lon.
 * @param {Date} date - any moment of the civil day (UTC date is used)
 * @param {number} lat - degrees, south negative
 * @param {number} lon - degrees, east positive
 * @returns {{sunrise: Date, sunset: Date}|null} null only in polar edge cases
 */
export function sunTimes(date, lat, lon) {
    const year = date.getUTCFullYear();
    const startOfYear = Date.UTC(year, 0, 0);
    const dayOfYear = Math.floor(
        (Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - startOfYear) / 86400000,
    );

    // Fractional year (radians), evaluated at solar noon.
    const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + 0.5);

    // Equation of time (minutes) and solar declination (radians).
    const eqTime =
        229.18 *
        (0.000075 +
            0.001868 * Math.cos(g) -
            0.032077 * Math.sin(g) -
            0.014615 * Math.cos(2 * g) -
            0.040849 * Math.sin(2 * g));
    const decl =
        0.006918 -
        0.399912 * Math.cos(g) +
        0.070257 * Math.sin(g) -
        0.006758 * Math.cos(2 * g) +
        0.000907 * Math.sin(2 * g) -
        0.002697 * Math.cos(3 * g) +
        0.00148 * Math.sin(3 * g);

    // Hour angle for sunrise/sunset with standard refraction (zenith 90.833°).
    const latRad = lat * DEG;
    const cosHa =
        Math.cos(90.833 * DEG) / (Math.cos(latRad) * Math.cos(decl)) -
        Math.tan(latRad) * Math.tan(decl);
    if (cosHa < -1 || cosHa > 1) return null; // midnight sun / polar night
    const haDeg = Math.acos(cosHa) / DEG;

    const sunriseMin = 720 - 4 * (lon + haDeg) - eqTime;
    const sunsetMin = 720 - 4 * (lon - haDeg) - eqTime;
    const dayStartUtc = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
    return {
        sunrise: new Date(dayStartUtc + sunriseMin * 60000),
        sunset: new Date(dayStartUtc + sunsetMin * 60000),
    };
}

/**
 * Theme dictated by daylight alone (no override).
 * @param {Date} [now]
 * @returns {'dark'|'light'}
 */
export function resolveAutoTheme(now = new Date()) {
    const [lat, lon] = CONFIG.MAP_CENTER;
    const times = sunTimes(now, lat, lon);
    if (!times) {
        // Fallback: fixed local-hours window (never expected at Montevideo's latitude).
        const [from, to] = CONFIG.THEME_FALLBACK_LIGHT_HOURS;
        const h = now.getHours();
        return h >= from && h < to ? 'light' : 'dark';
    }
    return now >= times.sunrise && now < times.sunset ? 'light' : 'dark';
}

/**
 * The next sunrise or sunset strictly after `now` — when the auto theme flips
 * and when a manual override expires.
 * @param {Date} [now]
 * @returns {Date}
 */
export function nextBoundary(now = new Date()) {
    const [lat, lon] = CONFIG.MAP_CENTER;
    for (const dayOffset of [0, 1]) {
        const day = new Date(now.getTime() + dayOffset * 86400000);
        const times = sunTimes(day, lat, lon);
        if (!times) break;
        for (const t of [times.sunrise, times.sunset].sort((a, b) => a - b)) {
            if (t > now) return t;
        }
    }
    // Fallback: one hour ahead (keeps the scheduler alive even in edge cases).
    return new Date(now.getTime() + 3600000);
}

// ---------------------------------------------------------------------------
// Manual override (persisted, expires at the next natural boundary)
// ---------------------------------------------------------------------------

function readOverride(now = new Date()) {
    let raw;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch {
        return null; // storage blocked (private mode etc.) — auto theme only
    }
    if (!raw) return null;
    try {
        const { theme, expiresAt } = JSON.parse(raw);
        if ((theme === 'dark' || theme === 'light') && now.getTime() < expiresAt) {
            return theme;
        }
    } catch {
        // fall through to cleanup
    }
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore */
    }
    return null;
}

/**
 * User-forced theme; holds until the next sunrise/sunset, then auto resumes.
 * @param {'dark'|'light'} theme
 * @param {Date} [now]
 */
export function setThemeOverride(theme, now = new Date()) {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ theme, expiresAt: nextBoundary(now).getTime() }),
        );
    } catch {
        /* storage blocked — the in-session switch below still works */
    }
    applyTheme(theme);
}

// ---------------------------------------------------------------------------
// Application & scheduling
// ---------------------------------------------------------------------------

/** @returns {'dark'|'light'} */
export function getTheme() {
    return currentTheme ?? 'dark';
}

/**
 * Subscribe to theme changes. Fired only on actual changes.
 * @param {(theme: 'dark'|'light') => void} fn
 */
export function onThemeChange(fn) {
    listeners.add(fn);
}

/**
 * Sets the theme on the document and notifies subscribers.
 * @param {'dark'|'light'} theme
 */
export function applyTheme(theme) {
    if (theme === currentTheme) return;
    currentTheme = theme;
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', CONFIG.THEME_META_COLORS[theme]);
    listeners.forEach((fn) => fn(theme));
}

function scheduleNextSwitch(now = new Date()) {
    const boundary = nextBoundary(now);
    clearTimeout(switchTimer);
    // +5s so the re-evaluation lands safely past the boundary.
    switchTimer = setTimeout(
        () => {
            const at = new Date();
            applyTheme(readOverride(at) ?? resolveAutoTheme(at));
            scheduleNextSwitch(at);
        },
        boundary.getTime() - now.getTime() + 5000,
    );
}

/**
 * Resolves and applies the initial theme, then keeps it in sync with
 * sunrise/sunset while the page stays open.
 * @param {Date} [now] - injectable for tests
 */
export function initTheme(now = new Date()) {
    applyTheme(readOverride(now) ?? resolveAutoTheme(now));
    scheduleNextSwitch(now);
}
