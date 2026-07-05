// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    renderDataFreshness,
    populateRouteSelect,
    updateThemeToggle,
    initThemeToggle,
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

describe('populateRouteSelect', () => {
    it('prepends the ALL_STOPS option and lists lines in order', () => {
        document.body.innerHTML = '<select id="routeSelect"></select>';
        populateRouteSelect(['7', '100']);
        const options = [...document.querySelectorAll('#routeSelect option')];
        expect(options[0].value).toBe('ALL_STOPS');
        expect(options.map((o) => o.value)).toEqual(['ALL_STOPS', '7', '100']);
        expect(options[2].textContent).toBe('Línea 100');
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

    it('populateRouteSelect re-populates without duplicating and localizes options', () => {
        document.body.innerHTML =
            '<select id="routeSelect"><option value="" disabled selected>…</option></select>';
        populateRouteSelect(['7', '100']);
        setLang('ru');
        populateRouteSelect(['7', '100']); // language-switch path repopulates
        const options = [...document.querySelectorAll('#routeSelect option')];
        // placeholder + ALL_STOPS + two lines — no duplicates from the rerun
        expect(options).toHaveLength(4);
        expect(options[1].textContent).toBe('📍 Показать все остановки');
        expect(options[3].textContent).toBe('Линия 100');
        // the disabled placeholder survives (applyTranslations owns its text)
        expect(options[0].disabled).toBe(true);
    });
});
