# Data Contract — routes.json / stops.json (format_version 2)

> Owner: api-designer (change requests go through this contract, never silently).
> Producer: `fetch_api_data.py` (validates before writing; see `validate_*_collection`).
> Consumer: `src/data.js` (`buildIndexes`) and `src/map.js`.
> CI check: `python scripts/validate_data.py` runs on every push (`.github/workflows/ci.yml`).
> Status: ACTIVE since 2026-07-05 (v1 → v2 migration: `scripts/migrate_data_v2.py`).

Both files are GeoJSON FeatureCollections with **foreign members** (allowed by
RFC 7946 §6.1) carrying versioning and the normalized stop-pattern relation.
They live at the repo root and are served by GitHub Pages under those exact
names — the file names and location are part of the contract
(`src/config.js` → `DATA_URLS`).

## routes.json

```jsonc
{
  "type": "FeatureCollection",
  "format_version": 2,
  "generated_at": "2026-06-27T11:37:49-03:00",   // ISO-8601, when fetched from the API
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "LineString", "coordinates": [[lon, lat], ...] },
      "properties": {
        "COD_VARIAN": "237",        // string; GTFS shape_id; JOIN KEY to stops patterns
        "DESC_LINEA": "100",        // string; line number shown to users
        "DESC_VARIA": "Villa Farré" // string; headsign/destination (may be "")
      }
    }
  ]
}
```

Guarantees:
- One feature per route variant; geometry is `LineString` with ≥ 2 points.
- Coordinates: `[lon, lat]`, quantized to 5 decimals (~1.1 m), Douglas–Peucker
  simplified at ε = 1e-5 deg. Every point inside the Montevideo bbox
  (lon −57…−55, lat −35.5…−34).
- Features sorted by (`DESC_LINEA`, `COD_VARIAN`) — deterministic git diffs.
- ≥ 100 features (validation floor; a healthy feed has ~1000+).

## stops.json

```jsonc
{
  "type": "FeatureCollection",
  "format_version": 2,
  "generated_at": "2026-06-27T11:37:49-03:00",
  "features": [                      // ONE feature per PHYSICAL stop
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [lon, lat] },
      "properties": {
        "COD_UBIC_P": 3413,          // int — ALWAYS an int; Map-key identity in the front-end
        "CALLE": "RBLA O´HIGGINS",   // non-empty string ("Desconocida" when unknown)
        "ESQUINA": "AV 18 DE DICIEMBRE"
      }
    }
  ],
  "patterns": {                      // stop<->variant relation, keyed by COD_VARIAN
    "237": {
      "linea": "100",                // DESC_LINEA of the variant
      "paradas": [[3413, 1], [4018, 2], ...]  // [COD_UBIC_P, ORDINAL]
    }
  }
}
```

Guarantees:
- `features`: unique `COD_UBIC_P` (int), non-empty `CALLE`/`ESQUINA`, Point in bbox,
  sorted by `COD_UBIC_P` (as string). ≥ 1000 features (floor).
- `patterns`: non-empty; every `paradas` entry references an existing feature code;
  `ORDINAL` is an int and **strictly increasing** within a pattern (gaps allowed —
  GTFS stop_sequence is preserved, occurrences without location metadata are dropped).
- Cross-file: every pattern key exists as a `COD_VARIAN` in routes.json
  (route variants without a pattern are allowed and logged as a warning).

## Consumption notes (front-end)

- `src/data.js` builds all indexes from `features` + `patterns`; per-variant stop
  lists carry `{feature, ordinal}` pairs.
- Freshness: the UI shows `generated_at` (fallback: HTTP `Last-Modified`) —
  `renderDataFreshness` in `src/ui.js`.
- v1 (one feature per stop-occurrence, properties `DESC_LINEA`/`COD_VARIAN`/`ORDINAL`
  on stops, no foreign members) is retired; the front-end does not read v1.

## Change process

Any property rename, type change, or structural change bumps `format_version`,
updates producer validation + `src/data.js` + the tests
(`tests/python/test_fetch_api_data.py`, `tests/js/data.test.js`) in the same change,
and goes through api-designer review.
