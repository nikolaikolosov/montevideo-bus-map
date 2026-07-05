// @vitest-environment jsdom
/**
 * i18n gates (brainstorm-006): dictionary completeness across es/en/ru,
 * CLDR plural behavior (Russian one/few/many), interpolation, fallback,
 * persistence and browser-preference detection, static-DOM application.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    LANGS,
    __STRINGS,
    t,
    tPlural,
    setLang,
    getLang,
    initLang,
    applyTranslations,
    onLangChange,
} from '../../src/i18n.js';

afterEach(() => {
    setLang('es'); // resets the module singleton (and re-persists 'es')…
    localStorage.clear(); // …so the storage wipe must come last
});

describe('dictionary completeness', () => {
    it('all locales carry exactly the same keys', () => {
        const esKeys = Object.keys(__STRINGS.es).sort();
        for (const lang of LANGS) {
            expect(Object.keys(__STRINGS[lang]).sort(), `locale ${lang}`).toEqual(esKeys);
        }
    });

    it('plural entries stay plural in every locale and always provide "other" and "one"', () => {
        for (const [key, value] of Object.entries(__STRINGS.es)) {
            if (typeof value === 'string') continue;
            for (const lang of LANGS) {
                const entry = __STRINGS[lang][key];
                expect(typeof entry, `${lang}:${key}`).toBe('object');
                expect(entry.other, `${lang}:${key}.other`).toBeTypeOf('string');
                expect(entry.one, `${lang}:${key}.one`).toBeTypeOf('string');
            }
        }
    });

    it('russian plural entries cover few and many (1 линия / 2 линии / 5 линий)', () => {
        for (const [key, value] of Object.entries(__STRINGS.ru)) {
            if (typeof value === 'string') continue;
            expect(value.few, `ru:${key}.few`).toBeTypeOf('string');
            expect(value.many, `ru:${key}.many`).toBeTypeOf('string');
        }
    });
});

describe('t / tPlural', () => {
    it('interpolates parameters', () => {
        expect(t('panel.lineOption', { id: '17' })).toBe('Línea 17');
        setLang('ru');
        expect(t('panel.lineOption', { id: '17' })).toBe('Линия 17');
    });

    it('falls back to Spanish for a missing key, then to the key itself', () => {
        expect(t('no.such.key')).toBe('no.such.key');
    });

    it('spanish plurals: 0 / 1 / n', () => {
        expect(tPlural('popup.lines', 0)).toBe('sin líneas');
        expect(tPlural('popup.lines', 1)).toBe('1 línea');
        expect(tPlural('popup.lines', 34)).toBe('34 líneas');
    });

    it('russian plurals: one/few/many incl. the 11–14 exception', () => {
        setLang('ru');
        expect(tPlural('popup.lines', 1)).toBe('1 линия');
        expect(tPlural('popup.lines', 2)).toBe('2 линии');
        expect(tPlural('popup.lines', 5)).toBe('5 линий');
        expect(tPlural('popup.lines', 11)).toBe('11 линий');
        expect(tPlural('popup.lines', 21)).toBe('21 линия');
        expect(tPlural('popup.lines', 0)).toBe('нет линий');
    });

    it('english plurals', () => {
        setLang('en');
        expect(tPlural('popup.lines', 1)).toBe('1 line');
        expect(tPlural('popup.lines', 2)).toBe('2 lines');
    });
});

describe('language selection', () => {
    it('setLang persists, syncs <html lang> and notifies subscribers', () => {
        let notified = null;
        onLangChange((l) => {
            notified = l;
        });
        setLang('ru');
        expect(getLang()).toBe('ru');
        expect(localStorage.getItem('mvd-lang')).toBe('ru');
        expect(document.documentElement.lang).toBe('ru');
        expect(notified).toBe('ru');
    });

    it('ignores unknown languages', () => {
        setLang('de');
        expect(getLang()).toBe('es');
    });

    it('initLang prefers the persisted choice', () => {
        localStorage.setItem('mvd-lang', 'en');
        initLang();
        expect(getLang()).toBe('en');
    });

    it('initLang falls back to browser preference, then Spanish', () => {
        const orig = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
        Object.defineProperty(navigator, 'languages', {
            configurable: true,
            get: () => ['ru-RU', 'en-US'],
        });
        initLang();
        expect(getLang()).toBe('ru');

        Object.defineProperty(navigator, 'languages', {
            configurable: true,
            get: () => ['de-DE'],
        });
        initLang();
        expect(getLang()).toBe('es');

        if (orig) Object.defineProperty(Navigator.prototype, 'languages', orig);
        else delete navigator.languages;
    });
});

describe('applyTranslations', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <p data-i18n="app.subtitle">x</p>
            <div data-i18n-aria="map.aria"></div>
            <span data-i18n-title="freshness.title"></span>
        `;
    });

    it('fills textContent, aria-label, title and document.title', () => {
        setLang('en');
        applyTranslations();
        expect(document.querySelector('p').textContent).toBe('Interactive route explorer');
        expect(document.querySelector('div').getAttribute('aria-label')).toBe(
            'Interactive bus route map',
        );
        expect(document.querySelector('span').title).toBe(
            'Date of the last routes-and-stops update',
        );
        expect(document.title).toBe('Montevideo Transit — Montevideo bus routes');
    });
});
