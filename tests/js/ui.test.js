// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    renderDataFreshness,
    populateRouteSelect,
    updateThemeToggle,
    initThemeToggle,
} from '../../src/ui.js';
import { CONFIG } from '../../src/config.js';

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
        expect(el.textContent).toContain('Datos:');
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
