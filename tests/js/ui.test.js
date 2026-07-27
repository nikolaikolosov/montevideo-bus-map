// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    renderDataFreshness,
    initSearchBox,
    setSearchDisplay,
    renderContextBar,
    updateThemeToggle,
    initThemeToggle,
    shouldShowFirstUseHint,
} from '../../src/ui.js';
import { CONFIG } from '../../src/config.js';
import { setLang, t } from '../../src/i18n.js';

describe('renderDataFreshness', () => {
    beforeEach(() => {
        document.body.innerHTML = '<p id="dataFreshness" class="data-freshness" hidden></p>';
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-05T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders a fresh ISO date without the stale marker', () => {
        renderDataFreshness('2026-06-27T11:37:49-03:00');
        const el = document.getElementById('dataFreshness');
        expect(el.hidden).toBe(false);
        expect(el.textContent).toContain('Datos al');
        expect(el.textContent).toContain('2026');
        expect(el.classList.contains('stale')).toBe(false);
    });

    it('marks data older than FRESHNESS_WARN_DAYS as stale', () => {
        renderDataFreshness('2026-01-01T00:00:00Z');
        const el = document.getElementById('dataFreshness');
        expect(el.hidden).toBe(false);
        expect(el.classList.contains('stale')).toBe(true);
        expect(CONFIG.FRESHNESS_WARN_DAYS).toBeGreaterThan(0);
    });

    it('accepts an HTTP Last-Modified date (pre-v2 fallback)', () => {
        renderDataFreshness('Wed, 01 Jul 2026 23:04:22 GMT');
        expect(document.getElementById('dataFreshness').hidden).toBe(false);
    });

    it('stays hidden for missing or unparseable input', () => {
        renderDataFreshness(null);
        expect(document.getElementById('dataFreshness').hidden).toBe(true);
        renderDataFreshness('yesterday');
        expect(document.getElementById('dataFreshness').hidden).toBe(true);
    });

    it('does not throw when the element is absent', () => {
        document.body.innerHTML = '';
        expect(() => renderDataFreshness('2026-06-27')).not.toThrow();
    });
});

describe('theme toggle', () => {
    beforeEach(() => {
        document.body.innerHTML =
            '<button type="button" id="themeToggle" aria-label="Cambiar a tema claro">☀️</button>';
    });

    it('shows the theme the click switches TO', () => {
        updateThemeToggle('dark');
        const btn = document.getElementById('themeToggle');
        expect(btn.textContent).toBe('☀️');
        expect(btn.getAttribute('aria-label')).toBe('Cambiar a tema claro');

        updateThemeToggle('light');
        expect(btn.textContent).toBe('🌙');
        expect(btn.getAttribute('aria-label')).toBe('Cambiar a tema oscuro');
    });

    it('fires the handler on click and survives a missing button', () => {
        const onToggle = vi.fn();
        initThemeToggle(onToggle);
        document.getElementById('themeToggle').click();
        expect(onToggle).toHaveBeenCalledTimes(1);

        document.body.innerHTML = '';
        expect(() => initThemeToggle(onToggle)).not.toThrow();
        expect(() => updateThemeToggle('dark')).not.toThrow();
    });
});

describe('search combobox', () => {
    const STOP_ENTRY = { type: 'stop', code: 4772, name: 'BUENOS AIRES', esquina: 'ITUZAINGO' };

    const mount = (results = []) => {
        document.body.innerHTML = `
            <div class="search-box">
                <input id="searchInput" role="combobox" aria-expanded="false"
                       aria-controls="searchList">
                <button type="button" id="searchClear" hidden>×</button>
                <ul id="searchList" role="listbox" hidden></ul>
            </div>`;
        const onPick = vi.fn();
        const queries = [];
        initSearchBox({
            search: (q) => {
                queries.push(q);
                return results;
            },
            lines: ['7', '100'],
            onPick,
        });
        return { input: document.getElementById('searchInput'), onPick, queries };
    };

    const type = (input, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input'));
    };
    const key = (input, k) =>
        input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

    it('opens a browsable default list on focus: all-stops + every line', () => {
        const { input } = mount();
        input.dispatchEvent(new Event('focus'));
        const opts = [...document.querySelectorAll('#searchList [role="option"]')];
        expect(input.getAttribute('aria-expanded')).toBe('true');
        expect(opts).toHaveLength(3);
        expect(opts[0].textContent).toBe(t('panel.allStops'));
        expect(opts[1].textContent).toContain('Línea 7');
    });

    it('renders query results with stop sub-labels and picks on click', () => {
        const { input, onPick } = mount([STOP_ENTRY]);
        type(input, 'buenos');
        const opt = document.querySelector('#searchList [role="option"]');
        expect(opt.textContent).toContain('BUENOS AIRES y ITUZAINGO');
        expect(opt.textContent).toContain('4772');
        opt.click();
        expect(onPick).toHaveBeenCalledWith(STOP_ENTRY);
        expect(document.getElementById('searchList').hidden).toBe(true);
    });

    it('is keyboard-operable: arrows set aria-activedescendant, Enter picks', () => {
        const { input, onPick } = mount([{ type: 'line', id: '7' }, STOP_ENTRY]);
        type(input, '7');
        key(input, 'ArrowDown');
        expect(input.getAttribute('aria-activedescendant')).toBe('search-opt-0');
        key(input, 'ArrowDown');
        expect(input.getAttribute('aria-activedescendant')).toBe('search-opt-1');
        key(input, 'Enter');
        expect(onPick).toHaveBeenCalledWith(STOP_ENTRY);
    });

    it('Enter with no highlight picks the first result; Escape closes', () => {
        const { input, onPick } = mount([{ type: 'line', id: '7' }]);
        type(input, '7');
        key(input, 'Enter');
        expect(onPick).toHaveBeenCalledWith({ type: 'line', id: '7' });
        type(input, '7');
        key(input, 'Escape');
        expect(document.getElementById('searchList').hidden).toBe(true);
        expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('shows a disabled no-results row', () => {
        const { input } = mount([]);
        type(input, 'zzz');
        const empty = document.querySelector('#searchList .search-empty');
        expect(empty.textContent).toBe(t('search.noResults'));
    });

    it('setSearchDisplay reflects and clears the selection', () => {
        const { input } = mount();
        setSearchDisplay('Línea 104');
        expect(input.value).toBe('Línea 104');
        setSearchDisplay('');
        expect(input.value).toBe('');
    });

    it('an untouched display label is not run as a query', () => {
        // The field doubles as selection display and query box, and app.js writes
        // a human label into it. Neither form matches the index — lines are
        // indexed by bare id, stops as "CALLE ESQUINA" without the " y " — so
        // reading it back as a query answered "Sin resultados" for a stop the
        // rider had just picked, and hid the browse list behind a manual clear.
        const { input, queries } = mount([]); // an index that matches nothing
        setSearchDisplay('BUENOS AIRES y ITUZAINGO'); // after picking stop 4772
        input.dispatchEvent(new Event('focus'));

        expect(queries).toEqual([]);
        expect(document.querySelector('.search-empty')).toBeNull();
        const opts = [...document.querySelectorAll('#searchList [role="option"]')];
        expect(opts).toHaveLength(3); // all-stops + both lines
        expect(opts[0].textContent).toBe(t('panel.allStops'));
    });

    it('goes back to querying as soon as the label is edited', () => {
        const { input, queries } = mount([{ type: 'line', id: '104' }]);
        setSearchDisplay('Línea 104');
        type(input, '104');
        expect(queries).toEqual(['104']);
        expect(document.querySelectorAll('#searchList [role="option"]')).toHaveLength(1);
    });

    it('shows the clear button only when the field has text; click goes home', () => {
        const { input, onPick } = mount([{ type: 'line', id: '7' }]);
        const clear = document.getElementById('searchClear');
        expect(clear.hidden).toBe(true);

        type(input, '7');
        expect(clear.hidden).toBe(false);

        clear.click();
        expect(onPick).toHaveBeenCalledWith({ type: 'all' });

        setSearchDisplay('Línea 104');
        expect(clear.hidden).toBe(false);
        setSearchDisplay('');
        expect(clear.hidden).toBe(true);
    });

    it('Escape with a closed list clears the selection to home', () => {
        const { input, onPick } = mount([{ type: 'line', id: '7' }]);
        type(input, '7');
        key(input, 'Escape'); // first: closes the list
        expect(onPick).not.toHaveBeenCalled();
        key(input, 'Escape'); // second: clears to home
        expect(onPick).toHaveBeenCalledWith({ type: 'all' });
    });
});

describe('context bar', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="contextBar" class="context-bar" hidden>
                <span id="contextText"></span>
                <button type="button" id="contextReset"></button>
            </div>`;
    });

    it('shows origin stop and the right reset label per mode', () => {
        renderContextBar({ name: 'BUENOS AIRES y ITUZAINGO', code: 4772, single: true });
        const bar = document.getElementById('contextBar');
        expect(bar.hidden).toBe(false);
        expect(document.getElementById('contextText').textContent).toBe(
            'Desde: BUENOS AIRES y ITUZAINGO (4772)',
        );
        expect(document.getElementById('contextReset').textContent).toBe(t('context.wholeLine'));

        renderContextBar({ name: 'X', code: 1, single: false });
        expect(document.getElementById('contextReset').textContent).toBe(t('context.backToStop'));
    });

    it('fires the latest reset handler only, and hides on null', () => {
        const first = vi.fn();
        const second = vi.fn();
        renderContextBar({ name: 'X', code: 1, single: true }, first);
        renderContextBar({ name: 'X', code: 1, single: true }, second);
        document.getElementById('contextReset').click();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);

        renderContextBar(null);
        expect(document.getElementById('contextBar').hidden).toBe(true);
    });
});

describe('localized UI helpers (i18n)', () => {
    afterEach(() => setLang('es'));

    it('renderDataFreshness localizes the label and the date', () => {
        document.body.innerHTML = '<p id="dataFreshness" hidden></p>';
        const el = document.getElementById('dataFreshness');

        setLang('ru');
        renderDataFreshness('2026-06-27T11:37:49-03:00');
        expect(el.textContent).toContain('Данные на');
        expect(el.textContent).toContain('июня');
        expect(el.title).toBe(t('freshness.title'));

        setLang('en');
        renderDataFreshness('2026-06-27T11:37:49-03:00');
        expect(el.textContent).toContain('Data as of');
        expect(el.textContent).toContain('June');
    });

    it('updateThemeToggle speaks the active language', () => {
        document.body.innerHTML = '<button id="themeToggle"></button>';
        setLang('ru');
        updateThemeToggle('dark');
        const btn = document.getElementById('themeToggle');
        expect(btn.getAttribute('aria-label')).toBe('Переключить на светлую тему');
        updateThemeToggle('light');
        expect(btn.getAttribute('aria-label')).toBe('Переключить на тёмную тему');
    });

    it('search default list and context bar speak the active language', () => {
        document.body.innerHTML = `
            <div class="search-box">
                <input id="searchInput" role="combobox" aria-controls="searchList">
                <ul id="searchList" role="listbox" hidden></ul>
            </div>
            <div id="contextBar" hidden><span id="contextText"></span>
                <button id="contextReset"></button></div>`;
        initSearchBox({ search: () => [], lines: ['100'], onPick: () => {} });
        setLang('ru');
        document.getElementById('searchInput').dispatchEvent(new Event('focus'));
        const opts = [...document.querySelectorAll('#searchList [role="option"]')];
        expect(opts[0].textContent).toBe('Показать все остановки');
        expect(opts[1].textContent).toContain('Линия 100');

        renderContextBar({ name: 'X', code: 1, single: true });
        expect(document.getElementById('contextText').textContent).toBe('От: X (1)');
        expect(document.getElementById('contextReset').textContent).toBe('Вся линия');
    });
});

describe('shouldShowFirstUseHint (who gets told how to start)', () => {
    it('greets a first-time visitor on the entry view', () => {
        expect(shouldShowFirstUseHint({ seen: false, view: 'all' })).toBe(true);
    });

    it('never repeats once dismissed', () => {
        expect(shouldShowFirstUseHint({ seen: true, view: 'all' })).toBe(false);
    });

    it('stays out of the way of a deep link', () => {
        // Someone who followed a link to a line, a stop or an itinerary already
        // knows what they came for; telling them how to start is noise.
        for (const view of ['line', 'stop', 'downstream', 'journey']) {
            expect(shouldShowFirstUseHint({ seen: false, view })).toBe(false);
        }
    });
});
