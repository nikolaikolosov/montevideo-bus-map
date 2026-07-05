/**
 * UI module — owns all DOM reads/writes unrelated to the map canvas.
 * Keeps the data and map layers decoupled from DOM manipulation.
 */

import { CONFIG } from './config.js';
import { t, getLang, LOCALE_TAGS } from './i18n.js';

// ---------------------------------------------------------------------------
// Loader & error states
// ---------------------------------------------------------------------------

/**
 * Hides the loading overlay with a fade transition.
 */
export function hideLoader() {
    const loader = document.getElementById('loader');
    if (!loader) return;
    loader.style.opacity = '0';
    // Remove from flow after transition so it doesn't block pointer events
    setTimeout(() => {
        loader.style.display = 'none';
        loader.setAttribute('aria-hidden', 'true');
    }, 500);
}

/**
 * Shows the error overlay with a descriptive message.
 * Hides the loader first.
 * @param {string} message - human-readable error description
 */
export function showError(message) {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';

    const container = document.getElementById('error-container');
    if (!container) return;
    const msgEl = container.querySelector('#error-message');
    if (msgEl) msgEl.textContent = message;
    container.style.display = 'flex';
    container.removeAttribute('aria-hidden');
}

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------

/**
 * Reflects the active theme on the toggle button: the icon shows the theme
 * the click switches TO (sun while dark, moon while light).
 * @param {'dark'|'light'} theme
 */
export function updateThemeToggle(theme) {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const switchesToLight = theme === 'dark';
    btn.textContent = switchesToLight ? '☀️' : '🌙';
    const label = switchesToLight ? t('theme.toLight') : t('theme.toDark');
    btn.setAttribute('aria-label', label);
    btn.title = label;
}

/**
 * Wires the theme toggle button.
 * @param {() => void} onToggle
 */
export function initThemeToggle(onToggle) {
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', onToggle);
}

// ---------------------------------------------------------------------------
// Language switcher
// ---------------------------------------------------------------------------

/**
 * Wires the ES | EN | RU segmented control.
 * @param {(lang: string) => void} onSelect
 */
export function initLangSwitcher(onSelect) {
    for (const btn of document.querySelectorAll('.lang-switcher .lang-btn')) {
        btn.addEventListener('click', () => onSelect(btn.dataset.lang));
    }
}

/** Reflects the active language on the segmented control. */
export function updateLangSwitcher() {
    const lang = getLang();
    for (const btn of document.querySelectorAll('.lang-switcher .lang-btn')) {
        const active = btn.dataset.lang === lang;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    }
}

// ---------------------------------------------------------------------------
// Data freshness
// ---------------------------------------------------------------------------

/**
 * Shows when the datasets were generated. The data is updated manually
 * (the API is reachable only from Uruguay), so the date tells users how
 * current the map is. Marked stale after CONFIG.FRESHNESS_WARN_DAYS.
 *
 * @param {string|null} value - ISO-8601 (v2 generated_at) or HTTP Last-Modified
 */
export function renderDataFreshness(value) {
    const el = document.getElementById('dataFreshness');
    if (!el) return;

    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
        el.hidden = true;
        return;
    }

    const formatted = date.toLocaleDateString(LOCALE_TAGS[getLang()], {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    el.textContent = t('freshness.text', { date: formatted });
    el.title = t('freshness.title');

    const ageDays = (Date.now() - date.getTime()) / 86_400_000;
    el.classList.toggle('stale', ageDays > CONFIG.FRESHNESS_WARN_DAYS);
    el.hidden = false;
}

// ---------------------------------------------------------------------------
// Dropdown population
// ---------------------------------------------------------------------------

/**
 * Populates the route selector with sorted line options.
 * @param {string[]} sortedLines
 */
export function populateRouteSelect(sortedLines) {
    const select = document.getElementById('routeSelect');

    // Drop previously generated options (language switch repopulates), keep
    // the placeholder (translated via data-i18n).
    for (const opt of [...select.querySelectorAll('option:not([disabled])')]) opt.remove();

    const clearOpt = document.createElement('option');
    clearOpt.value = 'ALL_STOPS';
    clearOpt.textContent = t('panel.allStops');
    select.appendChild(clearOpt);

    sortedLines.forEach((linea) => {
        const opt = document.createElement('option');
        opt.value = linea;
        opt.textContent = t('panel.lineOption', { id: linea });
        select.appendChild(opt);
    });
}

// ---------------------------------------------------------------------------
// Stats panel
// ---------------------------------------------------------------------------

/**
 * Updates the route-info stats panel.
 * @param {object} options
 * @param {boolean} options.show
 * @param {number|null} [options.variantCount] - pass null to hide the variants row
 * @param {number} [options.stopCount]
 * @param {string|null} [options.selectedValue] - value to set on the select element
 */
export function updateStatsPanel({
    show,
    variantCount = null,
    stopCount = 0,
    selectedValue = null,
}) {
    const routeInfo = document.getElementById('routeInfo');
    if (!show) {
        routeInfo.classList.remove('active');
        return;
    }

    routeInfo.classList.add('active');

    const variantsRow = document.getElementById('statVariants')?.parentElement;
    if (variantsRow) {
        if (variantCount !== null) {
            variantsRow.style.display = 'flex';
            document.getElementById('statVariants').textContent = variantCount;
        } else {
            variantsRow.style.display = 'none';
        }
    }

    const statStops = document.getElementById('statStops');
    if (statStops) statStops.textContent = stopCount;

    if (selectedValue !== null) {
        const select = document.getElementById('routeSelect');
        if (select) select.value = selectedValue;
    }
}
