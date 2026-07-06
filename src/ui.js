/**
 * UI module — owns all DOM reads/writes unrelated to the map canvas.
 * Keeps the data and map layers decoupled from DOM manipulation.
 */

import { CONFIG } from './config.js';
import { t, getLang, LOCALE_TAGS } from './i18n.js';
import { getLineColor } from './data.js';

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
// Search combobox (design/ux-review-001.md R1)
// ---------------------------------------------------------------------------

/**
 * Wires the line/stop search combobox (WAI-ARIA combobox + listbox).
 *
 * The empty query shows a browsable default list — "all stops" plus every
 * line — preserving the old dropdown's discoverability; typing filters via
 * the search index. Fully keyboard-operable: ↓/↑ move, Enter picks, Esc
 * closes. This is also the app's keyboard path to stop popups (canvas
 * markers are not focusable).
 *
 * @param {object} options
 * @param {(q: string) => import('./search.js').SearchEntry[]} options.search
 * @param {string[]} options.lines - all line ids (default browse list)
 * @param {(entry: {type: string, id?: string, code?: number}) => void} options.onPick
 */
export function initSearchBox({ search, lines, onPick }) {
    const input = document.getElementById('searchInput');
    const list = document.getElementById('searchList');
    if (!input || !list) return;

    let entries = [];
    let active = -1;

    const close = () => {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
    };

    const optionRow = (entry, i) => {
        const li = document.createElement('li');
        li.id = `search-opt-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.index = i;
        if (entry.type === 'all') {
            li.textContent = t('panel.allStops');
        } else if (entry.type === 'line') {
            const dot = document.createElement('span');
            dot.className = 'search-dot';
            dot.style.background = getLineColor(entry.id);
            li.appendChild(dot);
            li.appendChild(document.createTextNode(t('panel.lineOption', { id: entry.id })));
        } else {
            const name = document.createElement('span');
            name.textContent =
                entry.esquina && entry.esquina !== 'Desconocida'
                    ? `${entry.name} y ${entry.esquina}`
                    : entry.name;
            const sub = document.createElement('span');
            sub.className = 'search-sub';
            sub.textContent = t('popup.stop', { cod: entry.code });
            li.append(name, sub);
        }
        li.addEventListener('mousedown', (e) => e.preventDefault()); // keep input focus
        li.addEventListener('click', () => {
            close();
            onPick(entry);
        });
        return li;
    };

    const render = () => {
        const q = input.value.trim();
        entries =
            q.length === 0
                ? [{ type: 'all' }, ...lines.map((id) => ({ type: 'line', id }))]
                : search(q);
        list.textContent = '';
        if (entries.length === 0) {
            const li = document.createElement('li');
            li.className = 'search-empty';
            li.setAttribute('role', 'option');
            li.setAttribute('aria-disabled', 'true');
            li.textContent = t('search.noResults');
            list.appendChild(li);
        } else {
            entries.forEach((entry, i) => list.appendChild(optionRow(entry, i)));
        }
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        setActive(-1);
    };

    const setActive = (i) => {
        const opts = list.querySelectorAll('[role="option"]:not(.search-empty)');
        if (active >= 0 && opts[active]) opts[active].setAttribute('aria-selected', 'false');
        active = i;
        if (i >= 0 && opts[i]) {
            opts[i].setAttribute('aria-selected', 'true');
            input.setAttribute('aria-activedescendant', opts[i].id);
            opts[i].scrollIntoView?.({ block: 'nearest' });
        } else {
            input.removeAttribute('aria-activedescendant');
        }
    };

    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('keydown', (e) => {
        if (list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            render();
            e.preventDefault();
            return;
        }
        if (list.hidden) return;
        if (e.key === 'ArrowDown') {
            setActive(active + 1 >= entries.length ? 0 : active + 1);
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            setActive(active - 1 < 0 ? entries.length - 1 : active - 1);
            e.preventDefault();
        } else if (e.key === 'Enter') {
            const entry = entries[active >= 0 ? active : 0];
            if (entry) {
                close();
                onPick(entry);
            }
            e.preventDefault();
        } else if (e.key === 'Escape') {
            close();
        } else if (e.key === 'Tab') {
            close();
        }
    });
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !list.contains(e.target)) close();
    });
}

/**
 * Reflects the current selection in the search input ('' clears it).
 * @param {string} text
 */
export function setSearchDisplay(text) {
    const input = document.getElementById('searchInput');
    if (input) input.value = text;
}

// ---------------------------------------------------------------------------
// Downstream context bar (design/ux-review-001.md R3)
// ---------------------------------------------------------------------------

/**
 * Shows where a downstream view starts and offers the way back — without it,
 * a rendered tail is indistinguishable from a whole line.
 *
 * @param {{name: string, code: number, single: boolean}|null} info - null hides
 * @param {() => void} [onReset] - reset handler (re-wired on every render)
 */
export function renderContextBar(info, onReset) {
    const bar = document.getElementById('contextBar');
    if (!bar) return;
    const text = document.getElementById('contextText');
    const reset = document.getElementById('contextReset');
    if (!info) {
        bar.hidden = true;
        return;
    }
    text.textContent = t('context.from', { name: `${info.name} (${info.code})` });
    reset.textContent = info.single ? t('context.wholeLine') : t('context.backToStop');
    // Replace the node to drop the previous listener.
    const fresh = reset.cloneNode(true);
    reset.replaceWith(fresh);
    if (onReset) fresh.addEventListener('click', onReset);
    bar.hidden = false;
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
 */
export function updateStatsPanel({ show, variantCount = null, stopCount = 0 }) {
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
}
