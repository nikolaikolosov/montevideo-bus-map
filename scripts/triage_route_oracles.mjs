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

const routes = JSON.parse(readFileSync(join(root, 'routes.json'), 'utf8'));
const stops = JSON.parse(readFileSync(join(root, 'stops.json'), 'utf8'));
buildIndexes(routes, stops);

const BOX_M = 260; // half-size of the sketch window
const SVG_PX = 340;

/** Clips a polyline to the box around anchor and converts to SVG points. */
function toSvgPolylines(coords, anchorM) {
    const scale = SVG_PX / (2 * BOX_M);
    const runs = [];
    let run = [];
    for (const p of coords) {
        const m = toMeters(p);
        const x = m[0] - anchorM[0];
        const y = m[1] - anchorM[1];
        if (Math.abs(x) <= BOX_M && Math.abs(y) <= BOX_M) {
            run.push(`${((x + BOX_M) * scale).toFixed(1)},${((BOX_M - y) * scale).toFixed(1)}`);
        } else if (run.length > 0) {
            if (run.length > 1) runs.push(run);
            run = [];
        }
    }
    if (run.length > 1) runs.push(run);
    return runs;
}

const SECTION_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080'];

function sketch(finding, paths, sections) {
    const anchorM = toMeters(finding.at);
    const gray = paths
        .flatMap((p) => toSvgPolylines(p, anchorM))
        .map(
            (r) => `<polyline points="${r.join(' ')}" fill="none" stroke="#bbb" stroke-width="1"/>`,
        )
        .join('');
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
${gray}${colored}
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
