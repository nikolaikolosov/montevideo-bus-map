// @vitest-environment jsdom
/**
 * Stop-popup line display: one colored, tappable chip per line (the explicit
 * test-coverage ask from brainstorm-003). Synthetic fixture for behavior,
 * real committed data for the 34-line reference stop 4772 and the
 * chips == stopLinesMap invariant.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createStopPopup, setJourneyPopupHandlers } from '../../src/map.js';
import { t, tPlural, setLang } from '../../src/i18n.js';
import {
    buildIndexes,
    getLineColor,
    getStopLineVariants,
    stopLinesMap,
    uniqueStopsData,
} from '../../src/data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const stopFeature = (cod, calle = 'BUENOS AIRES', esquina = 'ITUZAINGO') => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-56.2, -34.9] },
    properties: { COD_UBIC_P: cod, CALLE: calle, ESQUINA: esquina },
});

// Synthetic: stop 1 served by lines 102 (v1, v2), 7 (v3); stop 2 by 102 only.
const syntheticStops = {
    type: 'FeatureCollection',
    format_version: 2,
    generated_at: '2026-06-27T11:37:49-03:00',
    features: [stopFeature(1), stopFeature(2, 'MERCEDES', '<b>xss</b>')],
    patterns: {
        v1: {
            linea: '102',
            paradas: [
                [1, 1],
                [2, 5],
            ],
        },
        v2: { linea: '102', paradas: [[1, 3]] },
        v3: { linea: '7', paradas: [[1, 2]] },
    },
};

beforeAll(() => {
    buildIndexes({ type: 'FeatureCollection', features: [] }, syntheticStops);
});

describe('createStopPopup (synthetic)', () => {
    it('renders header, count and one chip per line in numeric order', () => {
        const popup = createStopPopup(stopFeature(1), vi.fn());
        expect(popup.querySelector('h3').textContent).toBe('BUENOS AIRES');
        expect(popup.querySelector('.popup-sub').textContent).toContain('esq. ITUZAINGO');
        expect(popup.querySelector('.popup-sub').textContent).toContain('2 líneas');
        const chips = [...popup.querySelectorAll('.line-chip')];
        expect(chips.map((c) => c.textContent)).toEqual(['7', '102']); // numeric-aware
    });

    it('colors every chip with its line color', () => {
        // jsdom normalizes hsl() to rgb(); run the expectation through the
        // same normalization for comparison.
        const normalize = (color) => {
            const probe = document.createElement('span');
            probe.style.color = color;
            return probe.style.color;
        };
        const popup = createStopPopup(stopFeature(1), vi.fn());
        const chips = [...popup.querySelectorAll('.line-chip')];
        expect(chips.length).toBeGreaterThan(0);
        for (const chip of chips) {
            expect(chip.style.color).toBe(normalize(getLineColor(chip.textContent)));
            expect(chip.style.borderColor).toBe(normalize(getLineColor(chip.textContent)));
        }
        // distinct lines get distinct colors
        expect(new Set(chips.map((c) => c.style.color)).size).toBe(chips.length);
    });

    it('chip click requests JUST that line with its variants at this stop', () => {
        const onShowRoutes = vi.fn();
        const feature = stopFeature(1);
        const popup = createStopPopup(feature, onShowRoutes);
        const chip102 = [...popup.querySelectorAll('.line-chip')].find(
            (c) => c.textContent === '102',
        );
        chip102.click();
        expect(onShowRoutes).toHaveBeenCalledTimes(1);
        const [lines, variants, sourceFeature] = onShowRoutes.mock.calls[0];
        expect(lines).toEqual(['102']);
        expect(variants.sort()).toEqual(['v1', 'v2']); // v3 belongs to line 7
        expect(sourceFeature).toBe(feature);
    });

    it('"Ver todos los recorridos" requests all lines and all variants', () => {
        const onShowRoutes = vi.fn();
        const popup = createStopPopup(stopFeature(1), onShowRoutes);
        popup.querySelector('.draw-lines-btn').click();
        const [lines, variants] = onShowRoutes.mock.calls[0];
        expect(lines).toEqual(['7', '102']);
        expect(variants.sort()).toEqual(['v1', 'v2', 'v3']);
    });

    it('chips carry localized action labels (a11y)', () => {
        const popup = createStopPopup(stopFeature(1), vi.fn());
        const chip = popup.querySelector('.line-chip');
        expect(chip.tagName).toBe('BUTTON');
        expect(chip.getAttribute('aria-label')).toBe(t('popup.chipAria', { id: '7' }));
        const btn = popup.querySelector('.draw-lines-btn');
        expect(btn.textContent).toBe(t('popup.viewAll'));
        expect(btn.getAttribute('aria-label')).toBe(t('popup.viewAllAria'));
    });

    it('escapes street names (XSS)', () => {
        const popup = createStopPopup(stopFeature(2, '<script>x</script>', '<b>xss</b>'), vi.fn());
        expect(popup.querySelector('script')).toBeNull();
        expect(popup.querySelector('.popup-sub b')).toBeNull();
        expect(popup.querySelector('h3').textContent).toBe('<script>x</script>');
    });

    it('getStopLineVariants filters variants by line', () => {
        expect(getStopLineVariants(1, '102').sort()).toEqual(['v1', 'v2']);
        expect(getStopLineVariants(1, '7')).toEqual(['v3']);
        expect(getStopLineVariants(999, '102')).toEqual([]);
    });
});

describe('journey actions in the popup', () => {
    const handlers = () => ({
        role: vi.fn().mockReturnValue('none'),
        onPickOrigin: vi.fn(),
        onPickDestination: vi.fn(),
        onClearRole: vi.fn(),
    });

    afterEach(() => setJourneyPopupHandlers(null));

    it('offers both ends, so a rider can pick the destination first', () => {
        setJourneyPopupHandlers(handlers());
        const popup = createStopPopup(stopFeature(1), vi.fn());
        const buttons = [...popup.querySelectorAll('.popup-journey button')];
        expect(buttons.map((b) => b.textContent)).toEqual([t('journey.from'), t('journey.to')]);
        expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
            t('journey.fromAria'),
            t('journey.toAria'),
        ]);
        expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    });

    it('reports the picked stop back with its code', () => {
        const h = handlers();
        setJourneyPopupHandlers(h);
        createStopPopup(stopFeature(1), vi.fn()).querySelector('.journey-from-btn').click();
        expect(h.onPickOrigin).toHaveBeenCalledWith(1);
        createStopPopup(stopFeature(2), vi.fn()).querySelector('.journey-to-btn').click();
        expect(h.onPickDestination).toHaveBeenCalledWith(2);
        expect(h.onClearRole).not.toHaveBeenCalled();
    });

    it('turns the button of the stop that already holds the role into its undo', () => {
        const h = handlers();
        h.role.mockImplementation((cod) => (cod === 1 ? 'origin' : 'none'));
        setJourneyPopupHandlers(h);

        const popup = createStopPopup(stopFeature(1), vi.fn());
        const from = popup.querySelector('.journey-from-btn');
        expect(from.textContent).toBe(t('journey.fromClear'));
        expect(from.getAttribute('aria-label')).toBe(t('journey.fromClearAria'));
        expect(from.getAttribute('aria-pressed')).toBe('true');
        expect(from.classList.contains('active')).toBe(true);
        // The other end is untouched.
        expect(popup.querySelector('.journey-to-btn').textContent).toBe(t('journey.to'));

        from.click();
        expect(h.onClearRole).toHaveBeenCalledWith(1);
        expect(h.onPickOrigin).not.toHaveBeenCalled();
    });

    it('shows the destination role the same way', () => {
        const h = handlers();
        h.role.mockReturnValue('destination');
        setJourneyPopupHandlers(h);
        const popup = createStopPopup(stopFeature(1), vi.fn());
        expect(popup.querySelector('.journey-to-btn').getAttribute('aria-pressed')).toBe('true');
        expect(popup.querySelector('.journey-from-btn').getAttribute('aria-pressed')).toBe('false');
    });

    it('leaves the popup unchanged when journey planning is not wired', () => {
        setJourneyPopupHandlers(null);
        const popup = createStopPopup(stopFeature(1), vi.fn());
        expect(popup.querySelector('.popup-journey')).toBeNull();
        expect(popup.querySelector('.draw-lines-btn')).not.toBeNull();
    });

    it.each(['en', 'ru'])('labels the journey buttons in %s', (lang) => {
        setJourneyPopupHandlers(handlers());
        setLang(lang);
        const popup = createStopPopup(stopFeature(1), vi.fn());
        expect(popup.querySelector('.journey-from-btn').textContent).toBe(t('journey.from'));
        expect(popup.querySelector('.journey-to-btn').textContent).toBe(t('journey.to'));
        setLang('es');
    });
});

describe('createStopPopup (real data)', () => {
    beforeAll(() => {
        // Re-index with the real dataset (module maps are additive; real codes
        // don't collide with the synthetic 1/2).
        const stopsData = JSON.parse(readFileSync(join(ROOT, 'stops.json'), 'utf8'));
        buildIndexes({ type: 'FeatureCollection', features: [] }, stopsData);
    });

    it('stop 4772 (BUENOS AIRES y ITUZAINGO) renders its 34 lines as chips', () => {
        const feature = uniqueStopsData.find((f) => f.properties.COD_UBIC_P === 4772);
        expect(feature).toBeDefined();
        const popup = createStopPopup(feature, vi.fn());
        const chips = [...popup.querySelectorAll('.line-chip')];
        expect(chips).toHaveLength(34);
        expect(popup.querySelector('.popup-sub').textContent).toContain('34 líneas');
        const texts = chips.map((c) => c.textContent);
        expect(texts).toContain('102');
        expect(texts).toContain('Ce1');
        // numeric-aware order holds across the whole list
        const sorted = [...texts].sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
        );
        expect(texts).toEqual(sorted);
    });

    it('chip count equals stopLinesMap for every busy stop and a sample of the rest', () => {
        const busy = uniqueStopsData.filter(
            (f) => (stopLinesMap.get(f.properties.COD_UBIC_P)?.size ?? 0) >= 10,
        );
        expect(busy.length).toBeGreaterThanOrEqual(200); // 227 in the 2026-06 data
        const sample = uniqueStopsData.filter((_, i) => i % 25 === 0);
        for (const feature of [...busy, ...sample]) {
            const popup = createStopPopup(feature, vi.fn());
            expect(popup.querySelectorAll('.line-chip')).toHaveLength(
                stopLinesMap.get(feature.properties.COD_UBIC_P).size,
            );
        }
    });
});

describe('localized popups (i18n)', () => {
    afterEach(() => setLang('es'));

    it.each(['en', 'ru'])('renders the whole popup in %s', (lang) => {
        setLang(lang);
        const popup = createStopPopup(stopFeature(1), vi.fn());
        const btn = popup.querySelector('.draw-lines-btn');
        expect(btn.textContent).toBe(t('popup.viewAll'));
        expect(btn.getAttribute('aria-label')).toBe(t('popup.viewAllAria'));
        expect(popup.querySelector('.line-chip').getAttribute('aria-label')).toBe(
            t('popup.chipAria', { id: '7' }),
        );
        expect(popup.querySelector('.popup-sub').textContent).toContain(tPlural('popup.lines', 2));
    });

    it('russian line counts pluralize correctly in the popup subtitle', () => {
        setLang('ru');
        const popup = createStopPopup(stopFeature(1), vi.fn());
        // fixture stop serves exactly 2 lines → «2 линии» (few)
        expect(popup.querySelector('.popup-sub').textContent).toContain('2 линии');
        expect(popup.querySelector('.popup-sub').textContent).toContain('Остановка 1');
        expect(popup.querySelector('.popup-sub').textContent).toContain('угол ITUZAINGO');
    });
});
