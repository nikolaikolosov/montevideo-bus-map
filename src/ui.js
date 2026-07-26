/**
 * UI module — owns all DOM reads/writes unrelated to the map canvas.
 * Keeps the data and map layers decoupled from DOM manipulation.
 */

import { CONFIG } from './config.js';
import { t, tPlural, getLang, LOCALE_TAGS } from './i18n.js';
import { getLineColor } from './data.js';
import { stopStreets } from './utils.js';

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

/**
 * Wires the error retry button.
 * @param {() => void} onRetry
 */
export function initErrorRetry(onRetry) {
    const btn = document.getElementById('errorRetry');
    if (btn) btn.addEventListener('click', onRetry);
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
 * The label the app last wrote into the search field via setSearchDisplay.
 *
 * That field does double duty — it shows the current selection AND takes the
 * query — and the display label is not a query: lines are indexed by bare id
 * ('104', not 'Línea 104') and stops as `normalize(CALLE + ' ' + ESQUINA)`,
 * without the ' y ' the display name inserts. Reading it back as a query
 * answered "Sin resultados" for a stop the rider had just picked.
 */
let searchDisplayText = '';

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
    const clear = document.getElementById('searchClear');

    let entries = [];
    let active = -1;

    const syncClear = () => {
        if (clear) clear.hidden = input.value.length === 0;
    };
    syncClear();
    clear?.addEventListener('click', () => {
        onPick({ type: 'all' });
    });

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
            const { calle, esquina } = stopStreets({ CALLE: entry.name, ESQUINA: entry.esquina });
            name.textContent =
                calle && esquina
                    ? `${calle} y ${esquina}`
                    : (calle ?? esquina ?? t('stop.unknownStreet'));
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
        const raw = input.value.trim();
        // An untouched display label means "nothing typed yet", so re-focusing
        // after a pick reopens the browsable default list (all stops + every
        // line) instead of a dead "Sin resultados" row for a stop that plainly
        // exists — which also left that list unreachable without clearing the
        // field by hand. Any edit makes the text differ from the label and it
        // becomes a real query again.
        const q = raw === searchDisplayText.trim() ? '' : raw;
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

    input.addEventListener('input', () => {
        syncClear();
        render();
    });
    input.addEventListener('focus', render);
    input.addEventListener('keydown', (e) => {
        if (list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            render();
            e.preventDefault();
            return;
        }
        if (list.hidden) {
            // Second Escape (list already closed): clear the selection, go home.
            if (e.key === 'Escape' && input.value.length > 0) {
                onPick({ type: 'all' });
                e.preventDefault();
            }
            return;
        }
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
    searchDisplayText = text; // see the note on searchDisplayText
    const input = document.getElementById('searchInput');
    if (input) input.value = text;
    const clear = document.getElementById('searchClear');
    if (clear) clear.hidden = text.length === 0;
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
// Journey panel (stop → stop itinerary)
// ---------------------------------------------------------------------------

/**
 * Localized duration: minutes below an hour, "h + min" above.
 * Rounded to whole minutes — the underlying numbers are estimates, printing
 * seconds would claim a precision the data does not have.
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
    const totalMinutes = Math.max(1, Math.round(seconds / 60));
    if (totalMinutes < 60) return t('journey.minutes', { n: totalMinutes });
    return t('journey.hoursMinutes', {
        h: Math.floor(totalMinutes / 60),
        m: totalMinutes % 60,
    });
}

/** Distance rounded the way a rider reads it (10 m steps under 1 km). */
const formatWalk = (meters) => t('journey.walkTotal', { m: Math.round(meters / 10) * 10 });

/** One-line summary of an itinerary: duration · transfers · walking. */
function optionSummary(option) {
    const parts = [
        `≈ ${formatDuration(option.seconds)}`,
        tPlural('journey.transfers', option.transfers),
    ];
    if (option.walkMeters >= 10) parts.push(formatWalk(option.walkMeters));
    return parts.join(' · ');
}

/** <li> for one walking leg. */
function walkLegRow(leg, stopName) {
    const li = document.createElement('li');
    li.className = 'journey-leg journey-leg-walk';

    const icon = document.createElement('span');
    icon.className = 'journey-leg-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🚶';

    const body = document.createElement('div');
    const main = document.createElement('p');
    main.className = 'journey-leg-main';
    main.textContent = t('journey.legWalk', {
        m: Math.round(leg.meters / 10) * 10,
        stop: stopName(leg.toCode),
    });
    const sub = document.createElement('p');
    sub.className = 'journey-leg-sub';
    sub.textContent = `≈ ${formatDuration(leg.seconds)}`;
    body.append(main, sub);

    li.append(icon, body);
    return li;
}

/** <li> for one ride leg: line chip, board, ride length, alight. */
function rideLegRow(leg, stopName) {
    const li = document.createElement('li');
    li.className = 'journey-leg journey-leg-ride';

    const chip = document.createElement('span');
    chip.className = 'line-chip journey-leg-chip';
    chip.textContent = leg.line;
    const color = getLineColor(leg.line);
    chip.style.borderColor = color;
    chip.style.color = color;

    const body = document.createElement('div');
    const board = document.createElement('p');
    board.className = 'journey-leg-main';
    board.textContent = t('journey.legBoard', { stop: stopName(leg.fromCode) });

    const detail = document.createElement('p');
    detail.className = 'journey-leg-sub';
    const bits = [];
    if (leg.headsign) bits.push(t('journey.towards', { headsign: leg.headsign }));
    bits.push(tPlural('journey.legStops', Math.max(0, leg.stopCodes.length - 1)));
    bits.push(`≈ ${formatDuration(leg.seconds)}`);
    detail.textContent = bits.join(' · ');

    const alight = document.createElement('p');
    alight.className = 'journey-leg-main';
    alight.textContent = t('journey.legAlight', { stop: stopName(leg.toCode) });

    body.append(board, detail, alight);
    li.append(chip, body);
    return li;
}

/**
 * Renders the journey panel: endpoints, the alternatives as a tablist, and the
 * legs of the selected one.
 *
 * Called on every plan state change (the router is the single source of truth
 * — R7), so it fully rebuilds its own subtree instead of patching it.
 *
 * @param {object} model
 * @param {boolean} model.visible
 * @param {string} model.originName      - '' when not picked yet
 * @param {string} model.destinationName - '' when not picked yet
 * @param {string} model.message         - hint or error, '' for none
 * @param {import('./journey.js').JourneyOption[]} model.options
 * @param {number} model.activeIndex
 * @param {(code: number) => string} model.stopName
 * @param {{onSelectOption?: (index: number) => void}} [handlers]
 */
export function renderJourneyPanel(model, handlers = {}) {
    const panel = document.getElementById('journeyPanel');
    if (!panel) return;
    if (!model.visible) {
        panel.hidden = true;
        return;
    }
    panel.hidden = false;

    document.getElementById('journeyOrigin').textContent = model.originName || '—';
    document.getElementById('journeyDestination').textContent = model.destinationName || '—';

    // Each end is its own "pick this one again" control: with an itinerary on
    // screen only its own stops are on the map, so without this the rider
    // would have to throw the whole trip away to move one end.
    for (const [id, name, key] of [
        ['journeyEditOrigin', model.originName, 'changeOrigin'],
        ['journeyEditDestination', model.destinationName, 'changeDestination'],
    ]) {
        const button = document.getElementById(id);
        if (!button) continue;
        button.disabled = !name;
        button.setAttribute('aria-label', t(`journey.${key}Aria`));
        button.title = name ? t(`journey.${key}Aria`) : '';
    }

    const message = document.getElementById('journeyMessage');
    message.textContent = model.message ?? '';
    message.hidden = !model.message;

    // Swapping only means something once both ends are known.
    const swap = document.getElementById('journeySwap');
    if (swap) swap.disabled = !(model.originName && model.destinationName);

    const tabs = document.getElementById('journeyOptions');
    const legs = document.getElementById('journeyLegs');
    const note = document.getElementById('journeyNote');
    tabs.textContent = '';
    legs.textContent = '';

    const options = model.options ?? [];
    if (options.length === 0) {
        tabs.hidden = true;
        note.hidden = true;
        // Reset the roles here too: coming from a multi-option itinerary the
        // leg list would otherwise stay role="tabpanel" with aria-labelledby
        // pointing at a tab button the line above has just deleted — an orphan
        // tabpanel with no name and no owning tab.
        legs.setAttribute('role', 'list');
        legs.removeAttribute('aria-labelledby');
        return;
    }

    const active = Math.min(Math.max(model.activeIndex ?? 0, 0), options.length - 1);

    // A single itinerary has nothing to switch between: no tablist is built,
    // and the leg list drops the tabpanel role it would otherwise orphan.
    const hasAlternatives = options.length > 1;
    tabs.hidden = !hasAlternatives;
    legs.setAttribute('role', hasAlternatives ? 'tabpanel' : 'list');
    if (hasAlternatives) legs.setAttribute('aria-labelledby', `journey-opt-${active}`);
    else legs.removeAttribute('aria-labelledby');

    const tabButtons = [];
    (hasAlternatives ? options : []).forEach((option, i) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.id = `journey-opt-${i}`;
        tab.className = `journey-option${i === active ? ' active' : ''}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(i === active));
        tab.setAttribute('aria-controls', 'journeyLegs');
        tab.tabIndex = i === active ? 0 : -1;
        tab.setAttribute(
            'aria-label',
            t('journey.optionAria', { n: i + 1, summary: optionSummary(option) }),
        );

        const time = document.createElement('span');
        time.className = 'journey-option-time';
        time.textContent = `≈ ${formatDuration(option.seconds)}`;
        const meta = document.createElement('span');
        meta.className = 'journey-option-meta';
        meta.textContent = tPlural('journey.transfers', option.transfers);
        tab.append(time, meta);

        tab.addEventListener('click', () => handlers.onSelectOption?.(i));
        tab.addEventListener('keydown', (e) => {
            const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!step) return;
            e.preventDefault();
            const next = (i + step + options.length) % options.length;
            // Select FIRST, then focus the node that exists afterwards.
            // onSelectOption routes through the router, which re-renders this
            // panel synchronously and rebuilds every tab — so focusing
            // tabButtons[next] before the call focused a node that was about to
            // be discarded, activeElement fell back to <body>, and a keyboard
            // rider was stranded after exactly one arrow press.
            handlers.onSelectOption?.(next);
            document.getElementById(`journey-opt-${next}`)?.focus();
        });
        tabButtons.push(tab);
        tabs.appendChild(tab);
    });

    for (const leg of options[active].legs) {
        legs.appendChild(
            leg.type === 'walk' ? walkLegRow(leg, model.stopName) : rideLegRow(leg, model.stopName),
        );
    }

    // Waiting is a modelled penalty, not a leg — say so instead of hiding it
    // inside the total.
    const wait = options[active].waitSeconds ?? 0;
    note.textContent =
        wait > 0
            ? `${t('journey.approx')} ${t('journey.waitNote', { n: Math.round(wait / 60) })}`
            : t('journey.approx');
    note.hidden = false;
}

/**
 * Wires the journey panel's persistent controls. Called once.
 * @param {{onClear: () => void, onSwap: () => void,
 *          onChangeOrigin: () => void, onChangeDestination: () => void}} handlers
 */
export function initJourneyControls({ onClear, onSwap, onChangeOrigin, onChangeDestination }) {
    document.getElementById('journeyClear')?.addEventListener('click', onClear);
    document.getElementById('journeySwap')?.addEventListener('click', onSwap);
    document.getElementById('journeyEditOrigin')?.addEventListener('click', onChangeOrigin);
    document
        .getElementById('journeyEditDestination')
        ?.addEventListener('click', onChangeDestination);
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
