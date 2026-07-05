# Data Payload Report — GeoJSON v1 → v2 optimization

> Date: 2026-07-05 · Owner: performance-engineer (executed by adoption wave)
> Backlog items: B-06 (measure), B-07 (optimize). Estimate class: **definitive**
> for file/transfer sizes (measured); parse/TTI impact **not measured** (no
> browser-lab run in this pass).

## Method (reproducible)

```bash
# raw sizes
ls -la routes.json stops.json
# compressed size proxy for GitHub Pages transfer
gzip -9 -c routes.json | wc -c
gzip -9 -c stops.json  | wc -c
# live production transfer (before only — v2 not deployed yet)
curl -sI -H "Accept-Encoding: gzip" https://nikolaikolosov.github.io/montevideo-bus-map/routes.json
curl -sI -H "Accept-Encoding: gzip" https://nikolaikolosov.github.io/montevideo-bus-map/stops.json
# route vertex count
python -c "import json;r=json.load(open('routes.json',encoding='utf-8'));print(sum(len(f['geometry']['coordinates']) for f in r['features']))"
```

Representativeness: static files, cold measurement, no cache effects. Local
`gzip -9` tracks Pages' transfer size within ~10% (verified against live
Content-Length for v1: routes 1,652,694 local vs 1,694,707 live; stops
1,139,143 vs 1,264,019).

## Results

| Metric | v1 (before) | v2 (after) | Δ |
|---|---|---|---|
| routes.json raw | 10,030,691 B | 3,049,454 B | **−69.6%** |
| stops.json raw | 14,813,946 B | 1,471,277 B | **−90.1%** |
| total raw (browser parse input) | 24.84 MB | 4.52 MB | **−81.8%** |
| routes.json gzip −9 | 1,652,694 B | 299,182 B | −81.9% |
| stops.json gzip −9 | 1,139,143 B | 236,280 B | −79.3% |
| **total transfer (gzip)** | **2,791,837 B (live: 2,958,726 B)** | **535,462 B** | **−80.8%** |
| route vertices | 330,837 | 132,478 | −60.0% |
| stop features | 60,834 occurrences | 4,901 unique + 1,083 patterns | structure change |

## What produced the wins

1. **stops.json normalization** (the ~12× duplication found in
   audit/current-state-report.md §Data): one Point feature per physical stop;
   the stop↔variant relation moved to a compact `patterns` foreign member.
2. **Route geometry compaction**: coordinates quantized 8→5 decimals (~1.1 m)
   and Douglas–Peucker simplified at ε=1e-5 deg — both far below the renderer's
   own bundling tolerance (1.3e-4 deg) and corridor simplification (4e-5 deg).
3. **Compact JSON separators** (v1 had `", "`/`": "` padding).

## Functional parity evidence

- 44 JS unit tests + 20 pipeline tests green; contract validation passes on the
  migrated files (`python scripts/validate_data.py`).
- Browser check (local server, fresh origin): global stops view renders; Línea
  100 → 9 variants / 121 stops / bundled corridors with labels; stop 4018
  (15-line reference case) renders downstream view (22 unique stops — consistent
  with the raw data: 4018 sits at ordinal 67 of 68 on its variants); terminal
  stop 4967 renders 0 downstream stops (expected edge case); freshness label
  "Datos: 27 de junio de 2026"; console clean.

## Not measured (follow-up candidates)

- Core Web Vitals / TTI on mid-range mobile (needs Lighthouse run post-deploy).
- `buildIndexes` timing before/after (expected to improve with 4.5× smaller parse input).
- Pages bandwidth actuals (repo insights, admin only).
