"""Fetch Montevideo bus routes and stops from the official API and write the
GeoJSON datasets (routes.json / stops.json) consumed by the web app.

IMPORTANT: the api.montevideo.gub.uy gateway only accepts connections from
inside Uruguay's network, so this script must run from a host with Uruguayan
connectivity. Updating the published data is a MANUAL procedure by design —
see docs/data-update-runbook.md.

The script FAILS LOUDLY: any authentication, network, data or contract-
validation problem raises and exits with a non-zero status so the caller
surfaces it, instead of silently leaving the old data in place.

Data contract (format_version 2) expected by the front-end — the authoritative
description lives in architecture/contracts/data-contract.md:

  routes.json  GeoJSON FeatureCollection + foreign members
               {format_version: 2, generated_at: ISO-8601}
               features: LineString, properties DESC_LINEA, COD_VARIAN, DESC_VARIA
  stops.json   GeoJSON FeatureCollection + foreign members
               {format_version: 2, generated_at, patterns}
               features: Point, ONE per physical stop,
                         properties COD_UBIC_P (int), CALLE, ESQUINA
               patterns: {COD_VARIAN: {"linea": DESC_LINEA,
                                       "paradas": [[COD_UBIC_P, ORDINAL], ...]}}

COD_VARIAN is the GTFS shape_id and is shared between routes and stops so the
front-end can cross-reference a route variant with its stops. COD_UBIC_P is
always an int. ORDINAL is strictly increasing within a pattern.
"""

import csv
import io
import json
import os
import sys
import zipfile
from datetime import UTC, datetime

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


def _load_dotenv():
    """Load KEY=VALUE pairs from a .env file next to this script, if present.

    Lets `python fetch_api_data.py` work in any shell (PowerShell, cmd, bash)
    without manually exporting the variables. Real environment variables already
    set (e.g. by a wrapper script or CI) take precedence and are not overwritten.
    """
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.isfile(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


_load_dotenv()

# --- Configuration (from environment) ----------------------------------------
CLIENT_ID = os.environ.get("API_CLIENT_ID")
CLIENT_SECRET = os.environ.get("API_CLIENT_SECRET")
AUTH_URL = os.environ.get("API_AUTH_URL")
ROUTES_URL = os.environ.get("API_ROUTES_URL")
STOPS_URL = os.environ.get("API_STOPS_URL")

AUTH_TIMEOUT = 30
GET_TIMEOUT = 120

# --- Output format constants ---------------------------------------------------
FORMAT_VERSION = 2
# 5 decimal places ≈ 1.1 m — far below the front-end's bundling tolerance
# (BUNDLE_TOLERANCE_DEG 0.00013 ≈ 14 m) and its own simplification epsilon.
COORD_DECIMALS = 5
# Offline Douglas–Peucker epsilon for route shapes (~1.1 m). The front-end
# additionally simplifies corridors at 4e-5, so this only strips GPS jitter.
SIMPLIFY_EPS_DEG = 0.00001
# Sanity bounding box for Montevideo metro area — catches lon/lat swaps.
BBOX_LON = (-57.0, -55.0)
BBOX_LAT = (-35.5, -34.0)
# Validation floors: a healthy feed is far above these; below = broken fetch.
MIN_ROUTE_FEATURES = 100
MIN_UNIQUE_STOPS = 1000


class FetchError(Exception):
    """Raised for any unrecoverable problem so main() can exit non-zero."""


def log(msg):
    print(msg, flush=True)


def build_session():
    """A requests session that retries on transient connection / 5xx errors."""
    session = requests.Session()
    retry = Retry(
        total=4,
        connect=4,
        read=2,
        backoff_factor=2,  # 0s, 2s, 4s, 8s
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    # A browser-like User-Agent avoids 403s from the WAF/gateway in front of the
    # API, which blocks the default "python-requests/x.y" agent.
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "*/*",
        }
    )
    return session


# --- Authentication -----------------------------------------------------------
def get_access_token(session):
    if not CLIENT_ID or not CLIENT_SECRET:
        raise FetchError("API_CLIENT_ID / API_CLIENT_SECRET are not set.")
    if not AUTH_URL:
        raise FetchError("API_AUTH_URL is not set.")

    payload = {"grant_type": "client_credentials"}
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    log("Authenticating (HTTP Basic)...")
    resp = session.post(
        AUTH_URL,
        auth=(CLIENT_ID, CLIENT_SECRET),
        data=payload,
        headers=headers,
        timeout=AUTH_TIMEOUT,
    )

    # Some OAuth2 servers (Keycloak/WSO2) prefer the credentials in the body.
    if resp.status_code in (400, 401, 403):
        log(f"Basic auth returned {resp.status_code}; retrying with credentials in body...")
        body = dict(payload, client_id=CLIENT_ID, client_secret=CLIENT_SECRET)
        resp = session.post(AUTH_URL, data=body, headers=headers, timeout=AUTH_TIMEOUT)

    if not resp.ok:
        server = resp.headers.get("Server", "?")
        ctype = resp.headers.get("Content-Type", "?")
        raise FetchError(
            f"Auth failed ({resp.status_code}) [Server={server}, Content-Type={ctype}]: "
            f"{resp.text[:300]}"
        )

    token = resp.json().get("access_token")
    if not token:
        raise FetchError(f"Auth response had no access_token: {resp.text[:300]}")
    log("Authenticated OK.")
    return token


def fetch(session, url, token, as_zip=False):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    log(f"GET {url}")
    resp = session.get(url, headers=headers, timeout=GET_TIMEOUT)
    if not resp.ok:
        raise FetchError(f"GET {url} failed ({resp.status_code}): {resp.text[:300]}")
    return resp.content if as_zip else resp.json()


# --- GTFS parsing -------------------------------------------------------------
def _read_csv(zf, name):
    """Yield rows of a GTFS .txt file as dicts (utf-8-sig handles the BOM)."""
    with zf.open(name) as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        yield from reader


def _coerce_code(value):
    """Keep numeric stop codes as ints (parity with the legacy dataset)."""
    if value is None:
        return None
    value = value.strip()
    return int(value) if value.isdigit() else value


def parse_gtfs(zip_content):
    """Parse the GTFS static feed into routes features and raw stop occurrences.

    Returns (routes_features, stop_occurrences, stops_meta) where:
      routes_features  -> list of GeoJSON LineString features
      stop_occurrences -> list of dicts {stop_id, shape_id, line, ordinal}
      stops_meta       -> {stop_id: {lat, lon, name, code}}
    """
    with zipfile.ZipFile(io.BytesIO(zip_content)) as zf:
        names = set(zf.namelist())
        for required in ("routes.txt", "trips.txt", "stops.txt", "stop_times.txt", "shapes.txt"):
            if required not in names:
                raise FetchError(f"GTFS feed is missing {required} (has: {sorted(names)})")

        # routes.txt: route_id -> short/long name
        routes = {}
        for row in _read_csv(zf, "routes.txt"):
            routes[row["route_id"]] = row

        # stops.txt: stop_id -> location + names
        stops_meta = {}
        for row in _read_csv(zf, "stops.txt"):
            try:
                stops_meta[row["stop_id"]] = {
                    "lat": float(row["stop_lat"]),
                    "lon": float(row["stop_lon"]),
                    "name": row.get("stop_name", ""),
                    "code": (row.get("stop_code") or "").strip() or None,
                }
            except (KeyError, ValueError):
                continue

        # trips.txt: pick one representative trip per shape (variant).
        shape_rep_trip = {}  # shape_id -> trip_id
        shape_info = {}  # shape_id -> {route_id, headsign}
        for row in _read_csv(zf, "trips.txt"):
            shape_id = (row.get("shape_id") or "").strip()
            if not shape_id:
                continue
            if shape_id not in shape_rep_trip:
                shape_rep_trip[shape_id] = row["trip_id"]
                shape_info[shape_id] = {
                    "route_id": row.get("route_id"),
                    "headsign": (row.get("trip_headsign") or "").strip(),
                }
        rep_trip_to_shape = {tid: sid for sid, tid in shape_rep_trip.items()}

        # stop_times.txt is large: keep only the representative trips' stops.
        trip_stops = {}  # trip_id -> list of (sequence, stop_id)
        for row in _read_csv(zf, "stop_times.txt"):
            tid = row["trip_id"]
            if tid in rep_trip_to_shape:
                trip_stops.setdefault(tid, []).append((int(row["stop_sequence"]), row["stop_id"]))

        # shapes.txt: shape_id -> ordered points
        shapes = {}  # shape_id -> list of (sequence, lat, lon)
        for row in _read_csv(zf, "shapes.txt"):
            shapes.setdefault(row["shape_id"], []).append(
                (
                    int(row["shape_pt_sequence"]),
                    float(row["shape_pt_lat"]),
                    float(row["shape_pt_lon"]),
                )
            )

    # Build route (LineString) features, one per shape/variant.
    routes_features = []
    for shape_id, pts in shapes.items():
        pts.sort(key=lambda p: p[0])
        coords = [[lon, lat] for _seq, lat, lon in pts]
        info = shape_info.get(shape_id, {})
        route_row = routes.get(info.get("route_id"), {})
        routes_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {
                    "COD_VARIAN": shape_id,
                    "DESC_LINEA": route_row.get("route_short_name") or shape_id,
                    "DESC_VARIA": info.get("headsign") or route_row.get("route_long_name") or "",
                },
            }
        )

    # Build stop occurrences (one per stop-in-variant) from the representative trips.
    stop_occurrences = []
    for tid, seq_stops in trip_stops.items():
        shape_id = rep_trip_to_shape[tid]
        info = shape_info.get(shape_id, {})
        route_row = routes.get(info.get("route_id"), {})
        line = route_row.get("route_short_name") or shape_id
        for sequence, stop_id in sorted(seq_stops, key=lambda s: s[0]):
            stop_occurrences.append(
                {
                    "stop_id": stop_id,
                    "shape_id": shape_id,
                    "line": line,
                    "ordinal": sequence,
                }
            )

    return routes_features, stop_occurrences, stops_meta


def build_street_lookup(busstops):
    """Map a stop id/code -> (street1, street2) from the /busstops endpoint."""
    lookup = {}
    if not isinstance(busstops, list):
        log(
            f"Warning: /busstops did not return a list (got {type(busstops).__name__}); "
            "skipping street enrichment."
        )
        return lookup
    for s in busstops:
        bid = s.get("busstopId")
        if bid is None:
            continue
        lookup[str(bid)] = (s.get("street1"), s.get("street2"))
    return lookup


# --- Geometry helpers (format v2) ----------------------------------------------
def simplify_dp(coords, eps):
    """Iterative Douglas–Peucker on a [[lon, lat], ...] polyline."""
    n = len(coords)
    if n <= 2:
        return coords
    eps_sq = eps * eps
    keep = [False] * n
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = coords[s]
        bx, by = coords[e]
        dx, dy = bx - ax, by - ay
        len2 = dx * dx + dy * dy
        worst, worst_d = -1, eps_sq
        for i in range(s + 1, e):
            px, py = coords[i]
            t = ((px - ax) * dx + (py - ay) * dy) / len2 if len2 > 0 else 0.0
            t = max(0.0, min(1.0, t))
            ex = px - (ax + t * dx)
            ey = py - (ay + t * dy)
            d2 = ex * ex + ey * ey
            if d2 > worst_d:
                worst_d, worst = d2, i
        if worst != -1:
            keep[worst] = True
            stack.append((s, worst))
            stack.append((worst, e))
    return [c for c, k in zip(coords, keep, strict=True) if k]


def compact_coords(coords):
    """Quantize to COORD_DECIMALS, drop consecutive duplicates, DP-simplify."""
    quantized = [[round(lon, COORD_DECIMALS), round(lat, COORD_DECIMALS)] for lon, lat in coords]
    deduped = [quantized[0]]
    for pt in quantized[1:]:
        if pt != deduped[-1]:
            deduped.append(pt)
    return simplify_dp(deduped, SIMPLIFY_EPS_DEG)


# --- Output assembly (format v2) -----------------------------------------------
def build_routes_collection(routes_features, generated_at):
    """Compact route geometries into the versioned FeatureCollection."""
    features = []
    for f in routes_features:
        coords = compact_coords(f["geometry"]["coordinates"])
        if len(coords) < 2:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": dict(f["properties"]),
            }
        )
    # Deterministic ordering keeps git diffs meaningful between runs.
    features.sort(key=lambda f: (f["properties"]["DESC_LINEA"], str(f["properties"]["COD_VARIAN"])))
    return {
        "type": "FeatureCollection",
        "format_version": FORMAT_VERSION,
        "generated_at": generated_at,
        "features": features,
    }


def build_stops_collection(stop_occurrences, stops_meta, street_lookup, generated_at):
    """Build the normalized stops collection: unique stop features + patterns.

    One Point feature per physical stop; the stop<->variant relation (with the
    line and the strictly increasing ORDINAL) lives in the `patterns` foreign
    member keyed by COD_VARIAN.
    """
    features_by_code = {}
    patterns = {}
    matched_streets = 0
    missing_meta = 0

    for occ in stop_occurrences:
        meta = stops_meta.get(occ["stop_id"])
        if not meta:
            missing_meta += 1
            continue

        code = meta["code"]
        cod_ubic = _coerce_code(code) if code else _coerce_code(occ["stop_id"])

        if cod_ubic not in features_by_code:
            # Resolve CALLE/ESQUINA: prefer the /busstops streets, fall back to
            # the GTFS stop_name (kept whole in CALLE) so the popup always has
            # something.
            calle = esquina = None
            for key in (code, occ["stop_id"]):
                if key is not None and str(key) in street_lookup:
                    calle, esquina = street_lookup[str(key)]
                    matched_streets += 1
                    break
            if calle is None and esquina is None:
                calle = meta["name"] or "Desconocida"
                esquina = "Desconocida"
            features_by_code[cod_ubic] = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        round(meta["lon"], COORD_DECIMALS + 1),
                        round(meta["lat"], COORD_DECIMALS + 1),
                    ],
                },
                "properties": {
                    "COD_UBIC_P": cod_ubic,
                    "CALLE": calle or "Desconocida",
                    "ESQUINA": esquina or "Desconocida",
                },
            }

        pattern = patterns.setdefault(
            occ["shape_id"], {"linea": occ["line"], "paradas": []}
        )
        pattern["paradas"].append([cod_ubic, occ["ordinal"]])

    # Deterministic ordering keeps git diffs meaningful between runs.
    for pattern in patterns.values():
        pattern["paradas"].sort(key=lambda p: p[1])
    features = sorted(features_by_code.values(), key=lambda f: str(f["properties"]["COD_UBIC_P"]))

    log(
        f"Stops: {len(features)} unique stops, {len(patterns)} patterns, "
        f"{matched_streets} matched street names, {missing_meta} occurrences dropped "
        "(no GTFS location)."
    )
    return {
        "type": "FeatureCollection",
        "format_version": FORMAT_VERSION,
        "generated_at": generated_at,
        "features": features,
        "patterns": patterns,
    }


# --- Contract validation --------------------------------------------------------
def _check(condition, message):
    if not condition:
        raise FetchError(f"Contract violation: {message}")


def _in_bbox(lon, lat):
    return BBOX_LON[0] <= lon <= BBOX_LON[1] and BBOX_LAT[0] <= lat <= BBOX_LAT[1]


def _check_header(collection, name):
    _check(collection.get("type") == "FeatureCollection", f"{name}: not a FeatureCollection")
    _check(collection.get("format_version") == FORMAT_VERSION, f"{name}: format_version != 2")
    generated_at = collection.get("generated_at")
    try:
        datetime.fromisoformat(generated_at)
    except (TypeError, ValueError):
        raise FetchError(
            f"Contract violation: {name}: generated_at is not ISO-8601 ({generated_at!r})"
        ) from None


def validate_routes_collection(collection):
    """Raise FetchError if routes.json violates the v2 contract."""
    _check_header(collection, "routes")
    features = collection.get("features") or []
    _check(
        len(features) >= MIN_ROUTE_FEATURES,
        f"routes: only {len(features)} features (< {MIN_ROUTE_FEATURES})",
    )
    for f in features:
        props = f.get("properties") or {}
        variant = props.get("COD_VARIAN")
        _check(
            isinstance(variant, str) and variant,
            f"routes: COD_VARIAN missing/empty in {props!r}",
        )
        _check(
            isinstance(props.get("DESC_LINEA"), str) and props["DESC_LINEA"],
            f"routes[{variant}]: DESC_LINEA missing/empty",
        )
        _check(isinstance(props.get("DESC_VARIA"), str), f"routes[{variant}]: DESC_VARIA missing")
        geom = f.get("geometry") or {}
        _check(geom.get("type") == "LineString", f"routes[{variant}]: geometry != LineString")
        coords = geom.get("coordinates") or []
        _check(len(coords) >= 2, f"routes[{variant}]: fewer than 2 coordinates")
        for lon, lat in coords:
            _check(_in_bbox(lon, lat), f"routes[{variant}]: point outside Montevideo bbox")


def validate_stops_collection(collection):
    """Raise FetchError if stops.json violates the v2 contract."""
    _check_header(collection, "stops")
    features = collection.get("features") or []
    _check(
        len(features) >= MIN_UNIQUE_STOPS,
        f"stops: only {len(features)} unique stops (< {MIN_UNIQUE_STOPS})",
    )
    codes = set()
    for f in features:
        props = f.get("properties") or {}
        cod = props.get("COD_UBIC_P")
        _check(isinstance(cod, int), f"stops: COD_UBIC_P not int ({cod!r})")
        _check(cod not in codes, f"stops: duplicate COD_UBIC_P {cod}")
        codes.add(cod)
        for key in ("CALLE", "ESQUINA"):
            _check(
                isinstance(props.get(key), str) and props[key],
                f"stops[{cod}]: {key} missing/empty",
            )
        geom = f.get("geometry") or {}
        _check(geom.get("type") == "Point", f"stops[{cod}]: geometry != Point")
        lon, lat = geom.get("coordinates") or (None, None)
        _check(
            isinstance(lon, float) and isinstance(lat, float) and _in_bbox(lon, lat),
            f"stops[{cod}]: point outside Montevideo bbox",
        )

    patterns = collection.get("patterns")
    _check(isinstance(patterns, dict) and patterns, "stops: patterns missing/empty")
    for variant, pattern in patterns.items():
        linea = pattern.get("linea")
        _check(isinstance(linea, str) and linea, f"patterns[{variant}]: linea missing/empty")
        paradas = pattern.get("paradas")
        _check(
            isinstance(paradas, list) and paradas, f"patterns[{variant}]: paradas missing/empty"
        )
        prev = None
        for entry in paradas:
            _check(
                isinstance(entry, list) and len(entry) == 2,
                f"patterns[{variant}]: parada entry {entry!r} is not [cod, ordinal]",
            )
            cod, ordinal = entry
            _check(cod in codes, f"patterns[{variant}]: stop {cod} not in features")
            _check(isinstance(ordinal, int), f"patterns[{variant}]: ordinal not int ({ordinal!r})")
            _check(
                prev is None or ordinal > prev,
                f"patterns[{variant}]: ORDINAL not strictly increasing ({prev} -> {ordinal})",
            )
            prev = ordinal


def validate_cross(routes_collection, stops_collection):
    """Cross-file integrity: every stop pattern must reference a route variant."""
    route_variants = {f["properties"]["COD_VARIAN"] for f in routes_collection["features"]}
    pattern_variants = set(stops_collection["patterns"].keys())
    orphans = pattern_variants - route_variants
    _check(not orphans, f"{len(orphans)} pattern variants have no route geometry: "
                        f"{sorted(orphans)[:5]}...")
    unpatterned = route_variants - pattern_variants
    if unpatterned:
        log(f"Warning: {len(unpatterned)} route variants have no stop pattern.")


# --- Output -------------------------------------------------------------------
def save(collection, basename):
    json_path = f"{basename}.json"
    log(f"Writing {json_path} ({len(collection['features'])} features)...")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(collection, f, ensure_ascii=False, separators=(",", ":"))


def main():
    if not ROUTES_URL:
        raise FetchError("API_ROUTES_URL is not set.")

    session = build_session()
    token = get_access_token(session)

    # Routes (GTFS zip) — also the source of the stop<->variant relationships.
    routes_features, stop_occurrences, stops_meta = parse_gtfs(
        fetch(session, ROUTES_URL, token, as_zip=True)
    )
    if not routes_features:
        raise FetchError("GTFS feed produced 0 route features.")

    # Optional street-name enrichment from the /busstops endpoint.
    street_lookup = {}
    if STOPS_URL:
        try:
            street_lookup = build_street_lookup(fetch(session, STOPS_URL, token))
        except FetchError as e:
            log(f"Warning: could not fetch /busstops ({e}); using GTFS stop names only.")
    else:
        log("API_STOPS_URL not set; using GTFS stop names for CALLE/ESQUINA.")

    generated_at = datetime.now(UTC).isoformat(timespec="seconds")
    routes_collection = build_routes_collection(routes_features, generated_at)
    stops_collection = build_stops_collection(
        stop_occurrences, stops_meta, street_lookup, generated_at
    )

    # Validate the contract BEFORE touching the files on disk.
    validate_routes_collection(routes_collection)
    validate_stops_collection(stops_collection)
    validate_cross(routes_collection, stops_collection)

    save(routes_collection, "routes")
    save(stops_collection, "stops")
    log("Done.")


if __name__ == "__main__":
    try:
        main()
    except FetchError as e:
        log(f"ERROR: {e}")
        sys.exit(1)
    except Exception as e:  # noqa: BLE001 - surface anything unexpected as a failure
        log(f"UNEXPECTED ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
