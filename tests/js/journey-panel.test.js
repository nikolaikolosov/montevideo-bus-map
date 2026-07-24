// @vitest-environment jsdom
/**
 * Journey panel rendering (src/ui.js): endpoints, the alternatives as an ARIA
 * tablist, the leg list, and the honesty note about estimated times.
 *
 * The itinerary objects here are hand-built so the panel is tested against a
 * contract, not against whatever the planner happens to produce today.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderJourneyPanel, initJourneyControls, formatDuration } from '../../src/ui.js';
import { setLang, t, tPlural } from '../../src/i18n.js';

const PANEL_HTML = `
    <section id="journeyPanel" hidden>
        <button type="button" id="journeySwap"></button>
        <button type="button" id="journeyClear"></button>
        <button type="button" id="journeyEditOrigin"><span id="journeyOrigin"></span></button>
        <button type="button" id="journeyEditDestination">
            <span id="journeyDestination"></span>
        </button>
        <p id="journeyMessage" hidden></p>
        <div id="journeyOptions" role="tablist" hidden></div>
        <ol id="journeyLegs" role="tabpanel"></ol>
        <p id="journeyNote" hidden></p>
    </section>`;

const ride = (line, fromCode, toCode, stops, seconds, headsign = '') => ({
    type: 'ride',
    line,
    variantId: `v-${line}`,
    headsign,
    fromCode,
    toCode,
    boardIdx: 0,
    alightIdx: stops - 1,
    stopCodes: Array.from({ length: stops }, (_, i) => fromCode + i),
    meters: seconds * 5,
    seconds,
});

const walk = (fromCode, toCode, meters, seconds) => ({
    type: 'walk',
    fromCode,
    toCode,
    meters,
    seconds,
});

const option = (legs, seconds, transfers, walkMeters = 0, waitSeconds = 300) => ({
    legs,
    seconds,
    waitSeconds,
    transfers,
    rideMeters: 1000,
    walkMeters,
});

const NAMES = { 1: 'AV CIBILS y VERDUN', 5: 'JAPON y VIGO', 9: 'AV MILLAN y SITIO GRANDE' };
const stopName = (code) => NAMES[code] ?? `parada ${code}`;

const baseModel = (overrides = {}) => ({
    visible: true,
    originName: NAMES[1],
    destinationName: NAMES[9],
    message: '',
    options: [],
    activeIndex: 0,
    stopName,
    ...overrides,
});

beforeEach(() => {
    document.body.innerHTML = PANEL_HTML;
});

afterEach(() => setLang('es'));

describe('renderJourneyPanel', () => {
    it('stays hidden until there is something to show', () => {
        renderJourneyPanel({ visible: false });
        expect(document.getElementById('journeyPanel').hidden).toBe(true);
    });

    it('shows the endpoints and the hint while only one end is picked', () => {
        renderJourneyPanel(
            baseModel({ destinationName: '', message: t('journey.pickDestination') }),
        );
        expect(document.getElementById('journeyPanel').hidden).toBe(false);
        expect(document.getElementById('journeyOrigin').textContent).toBe(NAMES[1]);
        expect(document.getElementById('journeyDestination').textContent).toBe('—');
        expect(document.getElementById('journeyMessage').hidden).toBe(false);
        expect(document.getElementById('journeyMessage').textContent).toBe(
            t('journey.pickDestination'),
        );
        // Nothing to swap or explain yet, and only the known end is re-pickable.
        expect(document.getElementById('journeySwap').disabled).toBe(true);
        expect(document.getElementById('journeyEditOrigin').disabled).toBe(false);
        expect(document.getElementById('journeyEditDestination').disabled).toBe(true);
        expect(document.getElementById('journeyOptions').hidden).toBe(true);
        expect(document.getElementById('journeyNote').hidden).toBe(true);
        expect(document.querySelectorAll('#journeyLegs li')).toHaveLength(0);
    });

    it('renders one row per leg, board → detail → alight', () => {
        renderJourneyPanel(
            baseModel({
                options: [
                    option(
                        [
                            ride('137', 1, 5, 14, 720, 'Plaza España'),
                            walk(5, 6, 190, 152),
                            ride('546', 6, 9, 5, 300),
                        ],
                        2000,
                        1,
                        190,
                        600,
                    ),
                ],
            }),
        );

        const rows = [...document.querySelectorAll('#journeyLegs li')];
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.className)).toEqual([
            'journey-leg journey-leg-ride',
            'journey-leg journey-leg-walk',
            'journey-leg journey-leg-ride',
        ]);

        expect(rows[0].querySelector('.line-chip').textContent).toBe('137');
        const lines = [...rows[0].querySelectorAll('p')].map((p) => p.textContent);
        expect(lines[0]).toBe(t('journey.legBoard', { stop: NAMES[1] }));
        expect(lines[1]).toContain(t('journey.towards', { headsign: 'Plaza España' }));
        expect(lines[1]).toContain(tPlural('journey.legStops', 13)); // 14 stops = 13 hops
        expect(lines[2]).toBe(t('journey.legAlight', { stop: NAMES[5] }));

        expect(rows[1].querySelector('.journey-leg-main').textContent).toBe(
            t('journey.legWalk', { m: 190, stop: 'parada 6' }),
        );
    });

    it('omits the headsign clause when the feed has none', () => {
        renderJourneyPanel(baseModel({ options: [option([ride('546', 1, 9, 5, 300)], 600, 0)] }));
        const detail = document.querySelector('#journeyLegs .journey-leg-sub').textContent;
        expect(detail).not.toContain('hacia');
        expect(detail).toContain(tPlural('journey.legStops', 4));
    });

    it('exposes the alternatives as a tablist and switches on click', () => {
        const onSelectOption = vi.fn();
        renderJourneyPanel(
            baseModel({
                options: [
                    option([ride('1', 1, 5, 3, 600)], 900, 0),
                    option([ride('2', 1, 6, 2, 400), ride('3', 6, 9, 2, 400)], 1100, 1),
                ],
                activeIndex: 1,
            }),
            { onSelectOption },
        );

        const tabs = [...document.querySelectorAll('#journeyOptions [role="tab"]')];
        expect(document.getElementById('journeyOptions').hidden).toBe(false);
        expect(tabs).toHaveLength(2);
        expect(tabs.map((b) => b.getAttribute('aria-selected'))).toEqual(['false', 'true']);
        expect(tabs.map((b) => b.tabIndex)).toEqual([-1, 0]);
        expect(document.getElementById('journeyLegs').getAttribute('aria-labelledby')).toBe(
            tabs[1].id,
        );
        // The panel shows the ACTIVE option's legs, not the first one's.
        expect(document.querySelectorAll('#journeyLegs li')).toHaveLength(2);

        tabs[0].click();
        expect(onSelectOption).toHaveBeenCalledWith(0);
    });

    it('moves between alternatives with the arrow keys', () => {
        const onSelectOption = vi.fn();
        renderJourneyPanel(
            baseModel({
                options: [
                    option([ride('1', 1, 5, 3, 600)], 900, 0),
                    option([ride('2', 1, 9, 3, 700)], 1100, 0),
                ],
            }),
            { onSelectOption },
        );
        const tabs = [...document.querySelectorAll('#journeyOptions [role="tab"]')];
        tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(onSelectOption).toHaveBeenCalledWith(1);
        tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(onSelectOption).toHaveBeenLastCalledWith(1); // wraps to the last one
    });

    it('builds no tablist for a single itinerary, and no orphan tabpanel', () => {
        renderJourneyPanel(baseModel({ options: [option([ride('1', 1, 9, 4, 600)], 900, 0)] }));
        const legs = document.getElementById('journeyLegs');
        expect(document.getElementById('journeyOptions').hidden).toBe(true);
        expect(document.querySelectorAll('#journeyOptions [role="tab"]')).toHaveLength(0);
        expect(legs.getAttribute('role')).toBe('list');
        expect(legs.hasAttribute('aria-labelledby')).toBe(false);
        expect(legs.querySelectorAll('li')).toHaveLength(1);
    });

    it('clamps an out-of-range active index instead of blanking the panel', () => {
        renderJourneyPanel(
            baseModel({ options: [option([ride('1', 1, 9, 4, 600)], 900, 0)], activeIndex: 7 }),
        );
        expect(document.querySelectorAll('#journeyLegs li')).toHaveLength(1);
    });

    it('says the times are estimates and how much of it is waiting', () => {
        renderJourneyPanel(
            baseModel({ options: [option([ride('1', 1, 9, 4, 600)], 900, 0, 0, 300)] }),
        );
        const note = document.getElementById('journeyNote');
        expect(note.hidden).toBe(false);
        expect(note.textContent).toContain(t('journey.approx'));
        expect(note.textContent).toContain(t('journey.waitNote', { n: 5 }));
    });

    it('re-renders cleanly instead of stacking rows', () => {
        const model = baseModel({ options: [option([ride('1', 1, 9, 4, 600)], 900, 0)] });
        renderJourneyPanel(model);
        renderJourneyPanel(model);
        expect(document.querySelectorAll('#journeyLegs li')).toHaveLength(1);
        expect(document.querySelectorAll('#journeyOptions [role="tab"]')).toHaveLength(0);
    });

    it('renders the whole panel in every language', () => {
        for (const lang of ['en', 'ru']) {
            setLang(lang);
            renderJourneyPanel(
                baseModel({
                    options: [option([ride('1', 1, 5, 3, 600), walk(5, 9, 120, 96)], 996, 0, 120)],
                }),
            );
            const rows = [...document.querySelectorAll('#journeyLegs li')];
            expect(rows[0].querySelector('.journey-leg-main').textContent).toBe(
                t('journey.legBoard', { stop: NAMES[1] }),
            );
            expect(rows[1].querySelector('.journey-leg-main').textContent).toBe(
                t('journey.legWalk', { m: 120, stop: NAMES[9] }),
            );
            expect(document.getElementById('journeyNote').textContent).toContain(
                t('journey.approx'),
            );
        }
    });

    it('survives a missing panel (other views do not build it)', () => {
        document.body.innerHTML = '';
        expect(() => renderJourneyPanel(baseModel())).not.toThrow();
    });
});

describe('formatDuration', () => {
    it('prints whole minutes below an hour', () => {
        expect(formatDuration(0)).toBe(t('journey.minutes', { n: 1 })); // never "0 min"
        expect(formatDuration(90)).toBe(t('journey.minutes', { n: 2 }));
        expect(formatDuration(59 * 60)).toBe(t('journey.minutes', { n: 59 }));
    });

    it('switches to hours + minutes at an hour', () => {
        expect(formatDuration(60 * 60)).toBe(t('journey.hoursMinutes', { h: 1, m: 0 }));
        expect(formatDuration(95 * 60)).toBe(t('journey.hoursMinutes', { h: 1, m: 35 }));
    });

    it('follows the active language', () => {
        setLang('ru');
        expect(formatDuration(300)).toBe('5 мин');
        setLang('en');
        expect(formatDuration(300)).toBe('5 min');
    });
});

describe('initJourneyControls', () => {
    const handlers = () => ({
        onClear: vi.fn(),
        onSwap: vi.fn(),
        onChangeOrigin: vi.fn(),
        onChangeDestination: vi.fn(),
    });

    it('wires every persistent control', () => {
        const h = handlers();
        initJourneyControls(h);
        for (const id of [
            'journeyClear',
            'journeySwap',
            'journeyEditOrigin',
            'journeyEditDestination',
        ]) {
            document.getElementById(id).click();
        }
        expect(h.onClear).toHaveBeenCalledTimes(1);
        expect(h.onSwap).toHaveBeenCalledTimes(1);
        expect(h.onChangeOrigin).toHaveBeenCalledTimes(1);
        expect(h.onChangeDestination).toHaveBeenCalledTimes(1);
    });

    it('a disabled end cannot be re-picked', () => {
        const h = handlers();
        initJourneyControls(h);
        renderJourneyPanel(baseModel({ destinationName: '' }));
        document.getElementById('journeyEditDestination').click();
        expect(h.onChangeDestination).not.toHaveBeenCalled();
    });

    it('does not throw when the panel is absent', () => {
        document.body.innerHTML = '';
        expect(() => initJourneyControls(handlers())).not.toThrow();
    });
});
