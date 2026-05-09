import re

with open('index.html', 'r') as f:
    content = f.read()

# 1. Meta tags
content = content.replace(
    '<title>Mapa de los bondis de Montevideo</title>',
    '<meta name="description" content="Explorador interactivo de rutas de ómnibus de Montevideo">\n    <link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'><text y=\'80\' font-size=\'80\'>🚌</text></svg>" type="image/svg+xml">\n    <title>Mapa de los bondis de Montevideo</title>'
)

# 2. Loader ARIA
content = content.replace(
    '<div id="loader">',
    '<div id="loader" role="status" aria-live="polite" aria-label="Cargando datos del sistema">'
)

# 3. CSS transform conflict
content = content.replace(
    '            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);\n            transform: translate(-50%, -50%);\n        }',
    '            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);\n        }'
)

# 4. IIFE and Constants
content = content.replace(
    '    <script>\n        // Initialize Map centered on Montevideo',
    '''    <script>
        (function() {
            const BAD_STOP_COORDS = [-56.169029, -34.918964];
            const BAD_STOP_REMOVE_RADIUS_DEG = 0.003; // ~300 meters
            const LABEL_CLUSTER_THRESHOLD_DEG = 0.0005; // ~50 meters
            const GOLDEN_RATIO = 0.618033988749895;

            const escapeHTML = (str) => String(str).replace(/[&<>'"]/g, match => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
            }[match]));

            // Initialize Map centered on Montevideo'''
)
content = content.replace(
    '        document.addEventListener(\'DOMContentLoaded\', initApp);\n\n    </script>',
    '        document.addEventListener(\'DOMContentLoaded\', initApp);\n        })();\n\n    </script>'
)

# 5. processStops Guard
content = content.replace(
    '        function processStops() {\n            const seenStops = new Set();\n\n            stopsData.features.forEach(f => {',
    '''        function processStops() {
            if (typeof stopsData === 'undefined' || !stopsData.features) return;
            const seenStops = new Set();

            stopsData.features.forEach(f => {'''
)

# 6. Magic numbers replacement
content = content.replace(
    "const isBadStop = f.properties.CALLE === 'AV DR JUAN ANDRES CACHON' && f.properties.ESQUINA === 'AV JULIO MARIA SOSA';",
    "const isBadStop = f.properties.CALLE === 'AV DR JUAN ANDRES CACHON' && f.properties.ESQUINA === 'AV JULIO MARIA SOSA';"
)
content = content.replace(
    'const goldenRatio = 0.618033988749895;\n            sortedLines.forEach((linea, index) => {\n                const hue = ((index * goldenRatio) % 1) * 360;',
    'sortedLines.forEach((linea, index) => {\n                const hue = ((index * GOLDEN_RATIO) % 1) * 360;'
)
content = content.replace(
    'const badPoint = [-56.169029, -34.918964];\n        const removeRadius = 0.003; // ~300 meters\n        const cleanCoordinates = (coords) => {',
    'const cleanCoordinates = (coords) => {'
)
content = content.replace(
    'return coords.filter(c => Math.sqrt(Math.pow(c[0] - badPoint[0], 2) + Math.pow(c[1] - badPoint[1], 2)) > removeRadius);',
    'return coords.filter(c => Math.sqrt(Math.pow(c[0] - BAD_STOP_COORDS[0], 2) + Math.pow(c[1] - BAD_STOP_COORDS[1], 2)) > BAD_STOP_REMOVE_RADIUS_DEG);'
)
content = content.replace(
    'const threshold = 0.0005;',
    'const threshold = LABEL_CLUSTER_THRESHOLD_DEG;'
)

# 7. initApp Loader hide
content = content.replace(
    '''            // Hide loader
            setTimeout(() => {
                const loader = document.getElementById('loader');
                loader.style.opacity = '0';
                setTimeout(() => loader.style.display = 'none', 500);
            }, 500);''',
    '''            // Hide loader once app is initialized
            const loader = document.getElementById('loader');
            loader.style.opacity = '0';
            setTimeout(() => loader.style.display = 'none', 500);'''
)

# 8. XSS & Consts in createStopPopupContent
content = content.replace(
    '''        function createStopPopupContent(feature) {
            const calle = feature.properties.CALLE || 'Desconocida';
            const esquina = feature.properties.ESQUINA || 'Desconocida';
            const cod = feature.properties.COD_UBIC_P;

            let linesText = 'Ninguna';
            let linesArr = [];
            let variantsArr = [];
            if (stopLinesMap.has(cod)) {
                linesArr = Array.from(stopLinesMap.get(cod)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
                linesText = linesArr.join(', ');
            }
            if (stopVariantsMap.has(cod)) {
                variantsArr = Array.from(stopVariantsMap.get(cod));
            }

            // Create a wrapper div to attach the click event to draw lines
            const div = document.createElement('div');
            div.className = 'popup-content';
            div.innerHTML = `
                <h3>Parada</h3>
                <p><strong>Calle:</strong> ${calle}</p>
                <p><strong>Esquina:</strong> ${esquina}</p>
                <p><strong>Líneas:</strong> ${linesText}</p>
                <button class="draw-lines-btn" style="margin-top: 12px; padding: 10px 16px; background: var(--accent); border: none; border-radius: 6px; color: white; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 0.85rem; font-weight: 600; width: 100%; transition: background 0.2s;">Ver todos estos trayectos</button>
            `;''',
    '''        function createStopPopupContent(feature) {
            const calle = feature.properties.CALLE || 'Desconocida';
            const esquina = feature.properties.ESQUINA || 'Desconocida';
            const cod = feature.properties.COD_UBIC_P;

            const linesArr = stopLinesMap.has(cod) ? Array.from(stopLinesMap.get(cod)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })) : [];
            const variantsArr = stopVariantsMap.has(cod) ? Array.from(stopVariantsMap.get(cod)) : [];
            const linesText = linesArr.length > 0 ? linesArr.join(', ') : 'Ninguna';

            // Create a wrapper div to attach the click event to draw lines
            const div = document.createElement('div');
            div.className = 'popup-content';
            div.innerHTML = `
                <h3>Parada</h3>
                <p><strong>Calle:</strong> ${escapeHTML(calle)}</p>
                <p><strong>Esquina:</strong> ${escapeHTML(esquina)}</p>
                <p><strong>Líneas:</strong> ${escapeHTML(linesText)}</p>
                <button type="button" class="draw-lines-btn" style="margin-top: 12px; padding: 10px 16px; background: var(--accent); border: none; border-radius: 6px; color: white; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 0.85rem; font-weight: 600; width: 100%; transition: background 0.2s;">Ver todos estos trayectos</button>
            `;'''
)
content = content.replace(
    '''                        <div class="popup-content">
                            <h3>Línea ${feature.properties.DESC_LINEA}</h3>
                            <p>Variante: ${feature.properties.DESC_VARIA || 'N/A'}</p>
                        </div>''',
    '''                        <div class="popup-content">
                            <h3>Línea ${escapeHTML(feature.properties.DESC_LINEA)}</h3>
                            <p>Variante: ${escapeHTML(feature.properties.DESC_VARIA || 'N/A')}</p>
                        </div>'''
)

# 9. structuredClone
content = content.replace(
    'const newFeature = JSON.parse(JSON.stringify(f));',
    'const newFeature = structuredClone(f);'
)

# 10. CSS transform conflict inline style override
content = content.replace(
    'position: relative; transform: none; margin: 2px;',
    'position: relative; margin: 2px;'
)

# 11. Unused e parameter
content = content.replace(
    "layer.on('mouseover', function (e) { this.setStyle({ weight: 6, opacity: 1 }); this.bringToFront(); });",
    "layer.on('mouseover', function () { this.setStyle({ weight: 6, opacity: 1 }); this.bringToFront(); });"
)
content = content.replace(
    "layer.on('mouseout', function (e) { currentRouteLayer.resetStyle(this); });",
    "layer.on('mouseout', function () { currentRouteLayer.resetStyle(this); });"
)

with open('index.html', 'w') as f:
    f.write(content)
