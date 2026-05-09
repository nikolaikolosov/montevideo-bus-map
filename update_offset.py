import re

with open('index.html', 'r') as f:
    content = f.read()

# 1. Add script tag for leaflet-polylineoffset
script_tag = """    <!-- Leaflet JS -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <script src="https://unpkg.com/leaflet-polylineoffset@1.1.1/leaflet.polylineoffset.js"></script>"""

content = content.replace(
    '''    <!-- Leaflet JS -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>''',
    script_tag
)

# 2. Update style function to include offset
old_style = '''                    const color = lineColorsMap.get(feature.properties.DESC_LINEA) || 'var(--route-color)';
                    return {
                        color: color,
                        weight: lineIds.length === 1 ? 4 : 3,
                        opacity: 0.8,
                        lineCap: 'round',
                        lineJoin: 'round'
                    };'''

new_style = '''                    const color = lineColorsMap.get(feature.properties.DESC_LINEA) || 'var(--route-color)';
                    const idx = lineIds.indexOf(feature.properties.DESC_LINEA);
                    
                    // Calculate offset to prevent overlap (draw lines in parallel)
                    let lineOffset = 0;
                    if (lineIds.length > 1) {
                        const step = 6; // 6 pixels distance between parallel lines
                        const center = (lineIds.length - 1) / 2;
                        lineOffset = (idx - center) * step;
                    }

                    return {
                        color: color,
                        weight: lineIds.length === 1 ? 4 : 3,
                        opacity: 0.8,
                        lineCap: 'round',
                        lineJoin: 'round',
                        offset: lineOffset
                    };'''

content = content.replace(old_style, new_style)

with open('index.html', 'w') as f:
    f.write(content)
