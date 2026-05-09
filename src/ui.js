/**
 * UI module — owns all DOM reads/writes unrelated to the map canvas.
 * Keeps the data and map layers decoupled from DOM manipulation.
 */

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
// Dropdown population
// ---------------------------------------------------------------------------

/**
 * Populates the route selector with sorted line options.
 * @param {string[]} sortedLines
 */
export function populateRouteSelect(sortedLines) {
    const select = document.getElementById('routeSelect');

    const clearOpt = document.createElement('option');
    clearOpt.value = 'ALL_STOPS';
    clearOpt.textContent = '📍 Ver todas las paradas';
    select.appendChild(clearOpt);

    sortedLines.forEach((linea) => {
        const opt = document.createElement('option');
        opt.value = linea;
        opt.textContent = `Línea ${linea}`;
        select.appendChild(opt);
    });
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
 * @param {string|null} [options.selectedValue] - value to set on the select element
 */
export function updateStatsPanel({ show, variantCount = null, stopCount = 0, selectedValue = null }) {
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

    if (selectedValue !== null) {
        const select = document.getElementById('routeSelect');
        if (select) select.value = selectedValue;
    }
}
