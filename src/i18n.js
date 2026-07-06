/**
 * Internationalization (brainstorm-006): Spanish (Uruguay, voseo register),
 * English and Russian dictionaries with a tiny runtime — no framework.
 *
 * Spanish is the base language and the fallback for any missing key; the
 * dictionary-completeness unit test keeps all three locales in sync, so the
 * fallback only ever covers programmer error, never ships silently.
 *
 * Terminology (es-UY): a "línea" is the numbered service (Línea 17), its
 * path on the street is a "recorrido" — never "ruta", which reads as
 * highway in Uruguayan usage. Imperatives use voseo ("Elegí", "Reintentá",
 * "Verificá"), the register of local products and public sites.
 *
 * Plurals: values may be objects keyed by CLDR plural categories (plus an
 * optional explicit `zero`); `tPlural` picks via Intl.PluralRules — Russian
 * needs one/few/many (1 линия / 2 линии / 5 линий).
 */

export const LANGS = ['es', 'en', 'ru'];

/** BCP-47 tags used for Intl APIs (dates, plural rules). */
export const LOCALE_TAGS = { es: 'es-UY', en: 'en', ru: 'ru' };

const STORAGE_KEY = 'mvd-lang';

const STRINGS = {
    es: {
        'app.title': 'Montevideo Transit — recorridos de ómnibus de Montevideo',
        'app.subtitle': 'Explorador interactivo de recorridos',
        'loader.text': 'Cargando datos del sistema…',
        'loader.aria': 'Cargando datos del sistema',
        'error.title': '⚠️ Error al cargar',
        'error.body': 'No se pudieron cargar los datos del sistema.',
        'error.retry': 'Reintentá',
        'error.retryAria': 'Reintentá la carga de datos',
        'error.timeout': 'La descarga de datos superó el tiempo límite. Verificá tu conexión.',
        'error.unknown': 'Error desconocido al cargar los datos.',
        'error.badFormat': 'Los datos descargados tienen un formato inesperado.',
        'search.label': 'Buscar',
        'search.aria': 'Buscá una línea o una parada',
        'search.placeholder': 'Línea o parada…',
        'search.noResults': 'Sin resultados',
        'search.clearAria': 'Limpiar búsqueda',
        'map.showAllAria': 'Ver todas las paradas',
        'context.from': 'Desde: {name}',
        'context.wholeLine': 'Toda la línea',
        'context.backToStop': 'Volver a la parada',
        'panel.allStops': '📍 Ver todas las paradas',
        'panel.lineOption': 'Línea {id}',
        'panel.statVariants': 'Variantes de recorrido',
        'panel.statStops': 'Total de paradas',
        'freshness.text': 'Datos al {date}',
        'freshness.title': 'Fecha de la última actualización de recorridos y paradas',
        'theme.toLight': 'Cambiar a tema claro',
        'theme.toDark': 'Cambiar a tema oscuro',
        'lang.groupAria': 'Cambiar idioma',
        'map.aria': 'Mapa interactivo de recorridos de ómnibus',
        'popup.corner': 'esq. {esquina}',
        'popup.stop': 'Parada {cod}',
        'popup.lines': { zero: 'sin líneas', one: '1 línea', other: '{n} líneas' },
        'popup.viewAll': 'Ver todos los recorridos',
        'popup.viewAllAria': 'Ver todos los recorridos desde esta parada',
        'popup.chipAria': 'Ver el recorrido de la línea {id} desde esta parada',
        'section.title': 'Línea {id}',
        'section.variants': { one: 'Variante: {list}', other: 'Variantes: {list}' },
    },
    en: {
        'app.title': 'Montevideo Transit — Montevideo bus routes',
        'app.subtitle': 'Interactive route explorer',
        'loader.text': 'Loading system data…',
        'loader.aria': 'Loading system data',
        'error.title': '⚠️ Loading error',
        'error.body': 'The system data could not be loaded.',
        'error.retry': 'Try again',
        'error.retryAria': 'Retry loading the data',
        'error.timeout': 'The data download timed out. Check your connection.',
        'error.unknown': 'Unknown error while loading the data.',
        'error.badFormat': 'The downloaded data has an unexpected format.',
        'search.label': 'Search',
        'search.aria': 'Search for a line or a stop',
        'search.placeholder': 'Line or stop…',
        'search.noResults': 'No results',
        'search.clearAria': 'Clear the search',
        'map.showAllAria': 'Show all stops',
        'context.from': 'From: {name}',
        'context.wholeLine': 'Whole line',
        'context.backToStop': 'Back to the stop',
        'panel.allStops': '📍 Show all stops',
        'panel.lineOption': 'Line {id}',
        'panel.statVariants': 'Route variants',
        'panel.statStops': 'Total stops',
        'freshness.text': 'Data as of {date}',
        'freshness.title': 'Date of the last routes-and-stops update',
        'theme.toLight': 'Switch to light theme',
        'theme.toDark': 'Switch to dark theme',
        'lang.groupAria': 'Change language',
        'map.aria': 'Interactive bus route map',
        'popup.corner': 'at {esquina}',
        'popup.stop': 'Stop {cod}',
        'popup.lines': { zero: 'no lines', one: '1 line', other: '{n} lines' },
        'popup.viewAll': 'Show all routes',
        'popup.viewAllAria': 'Show all routes from this stop',
        'popup.chipAria': 'Show the route of line {id} from this stop',
        'section.title': 'Line {id}',
        'section.variants': { one: 'Variant: {list}', other: 'Variants: {list}' },
    },
    ru: {
        'app.title': 'Montevideo Transit — маршруты автобусов Монтевидео',
        'app.subtitle': 'Интерактивная карта маршрутов',
        'loader.text': 'Загрузка данных…',
        'loader.aria': 'Загрузка данных',
        'error.title': '⚠️ Ошибка загрузки',
        'error.body': 'Не удалось загрузить данные.',
        'error.retry': 'Повторить',
        'error.retryAria': 'Повторить загрузку данных',
        'error.timeout': 'Загрузка данных превысила лимит времени. Проверьте соединение.',
        'error.unknown': 'Неизвестная ошибка при загрузке данных.',
        'error.badFormat': 'Загруженные данные имеют неожиданный формат.',
        'search.label': 'Поиск',
        'search.aria': 'Найдите линию или остановку',
        'search.placeholder': 'Линия или остановка…',
        'search.noResults': 'Ничего не найдено',
        'search.clearAria': 'Очистить поиск',
        'map.showAllAria': 'Показать все остановки',
        'context.from': 'От: {name}',
        'context.wholeLine': 'Вся линия',
        'context.backToStop': 'К остановке',
        'panel.allStops': '📍 Показать все остановки',
        'panel.lineOption': 'Линия {id}',
        'panel.statVariants': 'Вариантов маршрута',
        'panel.statStops': 'Всего остановок',
        'freshness.text': 'Данные на {date}',
        'freshness.title': 'Дата последнего обновления маршрутов и остановок',
        'theme.toLight': 'Переключить на светлую тему',
        'theme.toDark': 'Переключить на тёмную тему',
        'lang.groupAria': 'Сменить язык',
        'map.aria': 'Интерактивная карта автобусных маршрутов',
        'popup.corner': 'угол {esquina}',
        'popup.stop': 'Остановка {cod}',
        'popup.lines': {
            zero: 'нет линий',
            one: '{n} линия',
            few: '{n} линии',
            many: '{n} линий',
            other: '{n} линии',
        },
        'popup.viewAll': 'Показать все маршруты',
        'popup.viewAllAria': 'Показать все маршруты от этой остановки',
        'popup.chipAria': 'Показать маршрут линии {id} от этой остановки',
        'section.title': 'Линия {id}',
        'section.variants': {
            one: 'Вариант: {list}',
            few: 'Варианты: {list}',
            many: 'Варианты: {list}',
            other: 'Варианты: {list}',
        },
    },
};

let current = 'es';
const listeners = new Set();

const interpolate = (str, params) =>
    str.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));

/** @returns {'es'|'en'|'ru'} active language */
export function getLang() {
    return current;
}

/**
 * Switches the UI language, persists the choice and notifies subscribers.
 * @param {string} lang - one of LANGS (anything else is ignored)
 */
export function setLang(lang, { persist = true } = {}) {
    if (!LANGS.includes(lang)) return;
    current = lang;
    if (persist) {
        try {
            localStorage.setItem(STORAGE_KEY, lang);
        } catch {
            // Storage unavailable (private mode) — the choice just won't stick.
        }
    }
    document.documentElement.lang = lang;
    for (const cb of listeners) cb(lang);
}

/**
 * Resolves the initial language: persisted choice first, then the browser's
 * preferred languages (first match wins), Spanish otherwise.
 */
export function initLang() {
    let lang = null;
    try {
        lang = localStorage.getItem(STORAGE_KEY);
    } catch {
        /* storage unavailable */
    }
    if (!LANGS.includes(lang)) {
        lang = 'es';
        for (const pref of navigator.languages ?? [navigator.language]) {
            const base = String(pref).slice(0, 2).toLowerCase();
            if (LANGS.includes(base)) {
                lang = base;
                break;
            }
        }
    }
    setLang(lang, { persist: false });
}

/** @param {(lang: string) => void} cb - called after every language switch */
export function onLangChange(cb) {
    listeners.add(cb);
}

/**
 * Translates a key with `{param}` interpolation. Falls back to Spanish, then
 * to the key itself (a completeness unit test keeps locales in sync).
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params = {}) {
    const raw = STRINGS[current][key] ?? STRINGS.es[key] ?? key;
    return typeof raw === 'string' ? interpolate(raw, params) : key;
}

/**
 * Translates a plural-aware key for a count n via Intl.PluralRules
 * (explicit `zero` wins at n === 0 when present).
 * @param {string} key
 * @param {number} n
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function tPlural(key, n, params = {}) {
    const entry = STRINGS[current][key] ?? STRINGS.es[key];
    if (!entry || typeof entry === 'string') return t(key, { n, ...params });
    const cat =
        n === 0 && entry.zero ? 'zero' : new Intl.PluralRules(LOCALE_TAGS[current]).select(n);
    return interpolate(entry[cat] ?? entry.other, { n, ...params });
}

/**
 * Applies translations to static DOM: elements carrying `data-i18n`
 * (textContent), `data-i18n-aria` (aria-label) and `data-i18n-title`
 * (title), plus the document title.
 * @param {ParentNode} [root]
 */
export function applyTranslations(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) {
        el.textContent = t(el.getAttribute('data-i18n'));
    }
    for (const el of root.querySelectorAll('[data-i18n-aria]')) {
        el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    }
    for (const el of root.querySelectorAll('[data-i18n-title]')) {
        el.title = t(el.getAttribute('data-i18n-title'));
    }
    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
        el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    }
    document.title = t('app.title');
}

/** Exposed for the dictionary-completeness test only. */
export const __STRINGS = STRINGS;
