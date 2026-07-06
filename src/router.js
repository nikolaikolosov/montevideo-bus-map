/**
 * Hash router — the URL is the source of truth for what the map shows
 * (design/ux-review-001.md R2). Every navigation goes through go(); the
 * single onRoute listener renders. Browser back/forward replay states via
 * the hashchange event, which makes every view shareable, bookmarkable and
 * reversible.
 *
 * Hash grammar (components URI-encoded; line ids can contain spaces, "124 Sd"):
 *   #/                          all stops (home)
 *   #/linea/104                 one line, whole route
 *   #/parada/4772               all stops, popup open at stop 4772
 *   #/parada/4772/linea/102     line 102 downstream from stop 4772
 *   #/parada/4772/todas         every line through stop 4772, downstream
 */

/**
 * @typedef {(
 *   {view: 'all'} |
 *   {view: 'line', line: string} |
 *   {view: 'stop', stop: number} |
 *   {view: 'downstream', stop: number, line: string|null}
 * )} RouteState
 */

/** @param {string} hash - window.location.hash (with or without '#') */
export function parseHash(hash) {
    const parts = String(hash ?? '')
        .replace(/^#\/?/, '')
        .split('/')
        .filter((p) => p.length > 0)
        .map(decodeURIComponent);

    if (parts.length === 0) return { view: 'all' };
    if (parts[0] === 'linea' && parts.length === 2) return { view: 'line', line: parts[1] };
    if (parts[0] === 'parada' && parts.length >= 2) {
        const stop = Number.parseInt(parts[1], 10);
        if (!Number.isFinite(stop)) return { view: 'all' };
        if (parts.length === 2) return { view: 'stop', stop };
        if (parts[2] === 'todas' && parts.length === 3) {
            return { view: 'downstream', stop, line: null };
        }
        if (parts[2] === 'linea' && parts.length === 4) {
            return { view: 'downstream', stop, line: parts[3] };
        }
    }
    return { view: 'all' }; // unknown/garbled hash — fail safe to home
}

/** @param {RouteState} state */
export function buildHash(state) {
    switch (state.view) {
        case 'line':
            return `#/linea/${encodeURIComponent(state.line)}`;
        case 'stop':
            return `#/parada/${state.stop}`;
        case 'downstream':
            return state.line === null
                ? `#/parada/${state.stop}/todas`
                : `#/parada/${state.stop}/linea/${encodeURIComponent(state.line)}`;
        default:
            return '#/';
    }
}

/** @type {((state: RouteState) => void)|null} */
let listener = null;
/** The hash this module last wrote or acknowledged. */
let currentHash = null;

const notify = (state) => {
    if (listener) listener(state);
};

/**
 * Navigates to a state: pushes a history entry (unless the state is already
 * current) and triggers the render listener synchronously.
 * @param {RouteState} state
 */
export function go(state) {
    const hash = buildHash(state);
    if (hash !== currentHash) {
        currentHash = hash;
        try {
            history.pushState(null, '', hash);
        } catch {
            location.hash = hash; // exotic environments — degrade gracefully
        }
    }
    notify(state);
}

/**
 * Rewrites the current history entry without adding one (used to normalize
 * the initial URL). Does NOT notify.
 * @param {RouteState} state
 */
export function replace(state) {
    currentHash = buildHash(state);
    try {
        history.replaceState(null, '', currentHash);
    } catch {
        /* ignore */
    }
}

/**
 * Starts routing: registers the render listener, resolves the initial state
 * from the current URL and notifies for it, then follows back/forward.
 * @param {(state: RouteState) => void} onRoute
 * @returns {RouteState} the initial state
 */
export function start(onRoute) {
    listener = onRoute;

    // pushState doesn't fire hashchange, so this only catches real
    // back/forward navigation and hand-edited hashes.
    const follow = () => {
        if (location.hash === currentHash) return;
        currentHash = location.hash;
        notify(parseHash(location.hash));
    };
    window.addEventListener('hashchange', follow);
    window.addEventListener('popstate', follow);

    currentHash = location.hash;
    const initial = parseHash(location.hash);
    notify(initial);
    return initial;
}

/** Test helper: clears module state between unit tests. */
export function __reset() {
    listener = null;
    currentHash = null;
}
