/**
 * Triage gallery for route-geometry oracle findings: one self-contained HTML
 * page with, per finding, an SVG sketch of the local geometry (digitised
 * traces in gray, corridor sections in color, anchor crosshair) plus an
 * OpenStreetMap link — enough to classify REAL vs BUG in one sitting
 * without leaving the page.
 *
 * Run: npm run triage:oracles
 * Output: qa/reports/triage/route-geometry-triage.html (git-ignored — a
 * working tool, not a report; the reviewed outcome lives in
 * qa/route-geometry-whitelist.json)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

globalThis.L = {
    point: (x, y) => ({ x, y }),
    Polyline: { extend: (proto) => proto },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { buildIndexes, getSortedLines, getFilteredRouteFeatures } = await import('../src/data.js');
const { prepareRouteFeature } = await import('../src/map.js');
const { measureLine, buildLineGeometry } = await import('./route_oracles.mjs');
const { toMeters } = await import('../src/geometry.js');
const { SVG_PX, toSvgPolylines } = await import('./triage_sketch.mjs');

const routes = JSON.parse(readFileSync(join(root, 'routes.json'), 'utf8'));
const stops = JSON.parse(readFileSync(join(root, 'stops.json'), 'utf8'));
buildIndexes(routes, stops);

const SECTION_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080'];

function sketch(finding, paths, sections) {
    const anchorM = toMeters(finding.at);
    const grayRuns = paths.flatMap((p) => toSvgPolylines(p, anchorM));
    const gray = grayRuns
        .map(
            (r) => `<polyline points="${r.join(' ')}" fill="none" stroke="#bbb" stroke-width="1"/>`,
        )
        .join('');
    // Say so when there is nothing to compare against, instead of letting an
    // empty reference layer read as "the trace genuinely isn't here". With
    // vertex filtering this happened on 2 findings whose trace does cross the
    // window; with clipping it should mean what it says, and if it ever appears
    // the reviewer knows not to trust the card.
    const grayWarning = grayRuns.length
        ? ''
        : `<rect x="6" y="6" width="${SVG_PX - 12}" height="20" fill="#fdecea" stroke="#c0392b" stroke-width="0.8"/>
<text x="${SVG_PX / 2}" y="20" text-anchor="middle" font-size="11" fill="#c0392b">no digitised trace in this window — do not classify</text>`;
    const colored = sections
        .flatMap((s, i) =>
            toSvgPolylines(s.coords, anchorM).map(
                (r) =>
                    `<polyline points="${r.join(' ')}" fill="none" stroke="${SECTION_COLORS[i % SECTION_COLORS.length]}" stroke-width="1.6" opacity="0.85"/>`,
            ),
        )
        .join('');
    const c = SVG_PX / 2;
    return `<svg width="${SVG_PX}" height="${SVG_PX}" viewBox="0 0 ${SVG_PX} ${SVG_PX}" style="background:#fff;border:1px solid #ddd">
${gray}${colored}${grayWarning}
<circle cx="${c}" cy="${c}" r="5" fill="none" stroke="red" stroke-width="1.5"/>
<line x1="${c - 9}" y1="${c}" x2="${c + 9}" y2="${c}" stroke="red" stroke-width="0.7"/>
<line x1="${c}" y1="${c - 9}" x2="${c}" y2="${c + 9}" stroke="red" stroke-width="0.7"/>
</svg>`;
}

// --- Sweep and render ----------------------------------------------------------
const cards = [];
for (const line of getSortedLines()) {
    const prepared = getFilteredRouteFeatures([line], null)
        .map((f) => prepareRouteFeature(f, null))
        .filter(Boolean);
    const findings = measureLine(line, prepared);
    if (findings.length === 0) continue;
    const { paths, sections } = buildLineGeometry(line, prepared);
    for (const f of findings) {
        const [lon, lat] = f.at;
        cards.push({
            f,
            html: `<div class="card ${f.verdict.toLowerCase()}">
<h3>${f.class} — line ${f.line} <span class="v ${f.verdict.toLowerCase()}">${f.verdict}</span></h3>
${sketch(f, paths, sections)}
<p>${JSON.stringify(f.detail)}<br>
<a href="https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=18/${lat.toFixed(6)}/${lon.toFixed(6)}" target="_blank">OSM</a>
· <code>${lat.toFixed(5)}, ${lon.toFixed(5)}</code></p>
</div>`,
        });
    }
}

const order = { BUG: 0, REAL: 1, INFO: 2 };
cards.sort((a, b) => order[a.f.verdict] - order[b.f.verdict] || a.f.class.localeCompare(b.f.class));

const html = `<!doctype html>
<meta charset="utf-8">
<title>Route geometry triage</title>
<style>
body{font:14px system-ui;margin:16px;background:#f6f6f6}
.grid{display:flex;flex-wrap:wrap;gap:12px}
.card{background:#fff;border:1px solid #ddd;border-radius:6px;padding:10px;width:360px}
.card h3{margin:0 0 6px;font-size:14px}
.v{padding:1px 6px;border-radius:4px;color:#fff;font-size:12px}
.v.bug{background:#c0392b}.v.real{background:#27ae60}.v.info{background:#7f8c8d}
p{margin:6px 0 0}
</style>
<h1>Route geometry oracle triage — ${cards.length} findings</h1>
<p>Gray = digitised traces (pipeline input). Color = corridor sections
(pipeline output; one color per section). Red crosshair = finding anchor.
Verdicts are the auto-classification against the raw traces; review BUG
cards first — they gate CI via qa/route-geometry-whitelist.json.</p>
<div class="grid">
${cards.map((c) => c.html).join('\n')}
</div>`;

mkdirSync(join(root, 'qa', 'reports', 'triage'), { recursive: true });
const out = join(root, 'qa', 'reports', 'triage', 'route-geometry-triage.html');
writeFileSync(out, html);
console.log(`${cards.length} findings rendered to ${out}`);
