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
        'map.locateAria': 'Mostrar mi ubicación',
        'map.locateDenied': 'Ubicación no disponible: no diste permiso',
        'context.from': 'Desde: {name}',
        'context.wholeLine': 'Toda la línea',
        'context.backToStop': 'Volver a la parada',
        'panel.allStops': 'Ver todas las paradas',
        'panel.lineOption': 'Línea {id}',
        'panel.destinations': 'Destino',
        'hint.firstUse': 'Tocá una parada del mapa o buscá una línea acá arriba.',
        'hint.dismiss': 'Entendido',
        'hint.dismissAria': 'Cerrar la ayuda',
        'panel.allDestinations': 'Todos',
        'panel.destinationAria': 'Elegí el destino de la línea',
        'panel.statStops': 'Total de paradas',
        'freshness.text': 'Datos al {date}',
        'freshness.title': 'Fecha de la última actualización de recorridos y paradas',
        'theme.toLight': 'Cambiar a tema claro',
        'theme.toDark': 'Cambiar a tema oscuro',
        'lang.groupAria': 'Cambiar idioma',
        'map.aria': 'Mapa interactivo de recorridos de ómnibus',
        'popup.corner': 'esq. {esquina}',
        'stop.unknownStreet': 'Calle sin nombre',
        'popup.stop': 'Parada {cod}',
        'popup.lines': { zero: 'sin líneas', one: '1 línea', other: '{n} líneas' },
        'popup.viewAll': 'Ver todos los recorridos',
        'popup.viewAllAria': 'Ver todos los recorridos desde esta parada',
        'popup.chipAria': 'Ver el recorrido de la línea {id} desde esta parada',
        'section.title': 'Línea {id}',
        'section.variants': { one: 'Variante: {list}', other: 'Variantes: {list}' },
        'journey.from': 'Desde acá',
        'journey.fromAria': 'Empezar el viaje en esta parada',
        'journey.fromClear': 'Quitar origen',
        'journey.fromClearAria': 'Quitar esta parada como origen del viaje',
        'journey.to': 'Hasta acá',
        'journey.toAria': 'Terminar el viaje en esta parada',
        'journey.toClear': 'Quitar destino',
        'journey.toClearAria': 'Quitar esta parada como destino del viaje',
        'journey.title': 'Viaje',
        'journey.origin': 'Origen',
        'journey.destination': 'Destino',
        'journey.changeOriginAria': 'Cambiar la parada de origen',
        'journey.changeDestinationAria': 'Cambiar la parada de destino',
        'journey.pickOrigin': 'Elegí en el mapa la parada de origen.',
        'journey.pickDestination': 'Elegí en el mapa la parada de destino.',
        'journey.clear': 'Cancelar',
        'journey.clearAria': 'Cancelar el viaje y volver al mapa',
        'journey.swap': 'Invertir',
        'journey.swapAria': 'Intercambiar origen y destino',
        'journey.noRoute': 'No encontramos combinación entre estas paradas.',
        'journey.sameStop': 'El origen y el destino son la misma parada.',
        'journey.unknownStop': 'Esa parada no está en los datos.',
        'journey.approx': 'Tiempos estimados: los datos no traen horarios ni frecuencias.',
        'journey.minutes': '{n} min',
        'journey.hoursMinutes': '{h} h {m} min',
        'journey.transfers': {
            zero: 'sin trasbordos',
            one: '1 trasbordo',
            other: '{n} trasbordos',
        },
        'journey.walkTotal': '{m} m a pie',
        'journey.waitNote': 'incluye ≈ {n} min de espera',
        'journey.optionLabel': 'Opción {n}',
        'journey.optionAria': 'Opción {n}: {summary}',
        'journey.legBoard': 'Subí en {stop}',
        'journey.legAlight': 'Bajá en {stop}',
        'journey.legWalk': 'Caminá {m} m hasta {stop}',
        'journey.legStops': { one: '{n} parada', other: '{n} paradas' },
        'journey.towards': 'hacia {headsign}',
        'journey.walk': 'A pie',
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
        'map.locateAria': 'Show my location',
        'map.locateDenied': 'Location unavailable: permission denied',
        'context.from': 'From: {name}',
        'context.wholeLine': 'Whole line',
        'context.backToStop': 'Back to the stop',
        'panel.allStops': 'Show all stops',
        'panel.lineOption': 'Line {id}',
        'panel.destinations': 'Destination',
        'hint.firstUse': 'Tap a stop on the map, or search for a line above.',
        'hint.dismiss': 'Got it',
        'hint.dismissAria': 'Dismiss the hint',
        'panel.allDestinations': 'All',
        'panel.destinationAria': 'Choose the line’s destination',
        'panel.statStops': 'Total stops',
        'freshness.text': 'Data as of {date}',
        'freshness.title': 'Date of the last routes-and-stops update',
        'theme.toLight': 'Switch to light theme',
        'theme.toDark': 'Switch to dark theme',
        'lang.groupAria': 'Change language',
        'map.aria': 'Interactive bus route map',
        'popup.corner': 'at {esquina}',
        'stop.unknownStreet': 'Unnamed street',
        'popup.stop': 'Stop {cod}',
        'popup.lines': { zero: 'no lines', one: '1 line', other: '{n} lines' },
        'popup.viewAll': 'Show all routes',
        'popup.viewAllAria': 'Show all routes from this stop',
        'popup.chipAria': 'Show the route of line {id} from this stop',
        'section.title': 'Line {id}',
        'section.variants': { one: 'Variant: {list}', other: 'Variants: {list}' },
        'journey.from': 'From here',
        'journey.fromAria': 'Start the trip at this stop',
        'journey.fromClear': 'Clear origin',
        'journey.fromClearAria': 'Stop using this stop as the trip origin',
        'journey.to': 'To here',
        'journey.toAria': 'End the trip at this stop',
        'journey.toClear': 'Clear destination',
        'journey.toClearAria': 'Stop using this stop as the trip destination',
        'journey.title': 'Trip',
        'journey.origin': 'From',
        'journey.destination': 'To',
        'journey.changeOriginAria': 'Change the origin stop',
        'journey.changeDestinationAria': 'Change the destination stop',
        'journey.pickOrigin': 'Pick the origin stop on the map.',
        'journey.pickDestination': 'Pick the destination stop on the map.',
        'journey.clear': 'Cancel',
        'journey.clearAria': 'Cancel the trip and go back to the map',
        'journey.swap': 'Swap',
        'journey.swapAria': 'Swap origin and destination',
        'journey.noRoute': 'No connection found between these stops.',
        'journey.sameStop': 'Origin and destination are the same stop.',
        'journey.unknownStop': 'That stop is not in the data.',
        'journey.approx': 'Times are estimates: the data has no schedules or frequencies.',
        'journey.minutes': '{n} min',
        'journey.hoursMinutes': '{h} h {m} min',
        'journey.transfers': { zero: 'no transfers', one: '1 transfer', other: '{n} transfers' },
        'journey.walkTotal': '{m} m on foot',
        'journey.waitNote': 'includes ≈ {n} min of waiting',
        'journey.optionLabel': 'Option {n}',
        'journey.optionAria': 'Option {n}: {summary}',
        'journey.legBoard': 'Board at {stop}',
        'journey.legAlight': 'Get off at {stop}',
        'journey.legWalk': 'Walk {m} m to {stop}',
        'journey.legStops': { one: '{n} stop', other: '{n} stops' },
        'journey.towards': 'towards {headsign}',
        'journey.walk': 'On foot',
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
        'map.locateAria': 'Показать моё местоположение',
        'map.locateDenied': 'Местоположение недоступно: доступ запрещён',
        'context.from': 'От: {name}',
        'context.wholeLine': 'Вся линия',
        'context.backToStop': 'К остановке',
        'panel.allStops': 'Показать все остановки',
        'panel.lineOption': 'Линия {id}',
        'panel.destinations': 'Направление',
        'hint.firstUse': 'Нажмите остановку на карте или найдите линию выше.',
        'hint.dismiss': 'Понятно',
        'hint.dismissAria': 'Закрыть подсказку',
        'panel.allDestinations': 'Все',
        'panel.destinationAria': 'Выберите направление линии',
        'panel.statStops': 'Всего остановок',
        'freshness.text': 'Данные на {date}',
        'freshness.title': 'Дата последнего обновления маршрутов и остановок',
        'theme.toLight': 'Переключить на светлую тему',
        'theme.toDark': 'Переключить на тёмную тему',
        'lang.groupAria': 'Сменить язык',
        'map.aria': 'Интерактивная карта автобусных маршрутов',
        'popup.corner': 'угол {esquina}',
        'stop.unknownStreet': 'Улица без названия',
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
        'journey.from': 'Отсюда',
        'journey.fromAria': 'Начать поездку с этой остановки',
        'journey.fromClear': 'Убрать начало',
        'journey.fromClearAria': 'Убрать эту остановку как начало поездки',
        'journey.to': 'Сюда',
        'journey.toAria': 'Завершить поездку на этой остановке',
        'journey.toClear': 'Убрать конец',
        'journey.toClearAria': 'Убрать эту остановку как конец поездки',
        'journey.title': 'Поездка',
        'journey.origin': 'Откуда',
        'journey.destination': 'Куда',
        'journey.changeOriginAria': 'Сменить начальную остановку',
        'journey.changeDestinationAria': 'Сменить конечную остановку',
        'journey.pickOrigin': 'Выберите на карте начальную остановку.',
        'journey.pickDestination': 'Выберите на карте конечную остановку.',
        'journey.clear': 'Отменить',
        'journey.clearAria': 'Отменить поездку и вернуться к карте',
        'journey.swap': 'Поменять',
        'journey.swapAria': 'Поменять местами начало и конец',
        'journey.noRoute': 'Между этими остановками маршрут не найден.',
        'journey.sameStop': 'Начальная и конечная остановки совпадают.',
        'journey.unknownStop': 'Такой остановки нет в данных.',
        'journey.approx': 'Время примерное: в данных нет расписаний и интервалов.',
        'journey.minutes': '{n} мин',
        'journey.hoursMinutes': '{h} ч {m} мин',
        'journey.transfers': {
            zero: 'без пересадок',
            one: '{n} пересадка',
            few: '{n} пересадки',
            many: '{n} пересадок',
            other: '{n} пересадки',
        },
        'journey.walkTotal': '{m} м пешком',
        'journey.waitNote': 'включая ≈ {n} мин ожидания',
        'journey.optionLabel': 'Вариант {n}',
        'journey.optionAria': 'Вариант {n}: {summary}',
        'journey.legBoard': 'Сядьте на остановке {stop}',
        'journey.legAlight': 'Выйдите на остановке {stop}',
        'journey.legWalk': 'Пройдите {m} м до {stop}',
        'journey.legStops': {
            one: '{n} остановка',
            few: '{n} остановки',
            many: '{n} остановок',
            other: '{n} остановки',
        },
        'journey.towards': 'в сторону {headsign}',
        'journey.walk': 'Пешком',
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
