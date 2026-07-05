"""One-off migration of the committed data files from format v1 to v2.

v1: routes.json / stops.json are plain FeatureCollections; stops.json has one
feature per (stop x variant) occurrence with full geometry/street duplication.

v2: see the contract header in fetch_api_data.py. This script rebuilds the v2
files from the committed v1 files WITHOUT touching the API (which is reachable
only from Uruguay). `generated_at` must therefore be passed explicitly - use
the date the v1 data was actually fetched (its git commit date), not today.

Usage:
    python scripts/migrate_data_v2.py --generated-at 2026-06-27T11:36:00-03:00
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fetch_api_data import (  # noqa: E402
    FORMAT_VERSION,
    build_routes_collection,
    log,
    save,
    validate_cross,
    validate_routes_collection,
    validate_stops_collection,
)


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def stops_v1_to_v2(stops_v1, generated_at):
    """Split v1 stop occurrences into unique stop features + variant patterns."""
    features_by_code = {}
    patterns = {}
    for f in stops_v1["features"]:
        props = f["properties"]
        cod = props["COD_UBIC_P"]
        if cod not in features_by_code:
            lon, lat = f["geometry"]["coordinates"]
            features_by_code[cod] = {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                "properties": {
                    "COD_UBIC_P": cod,
                    # v1 carried nulls where /busstops had a missing street name;
                    # the v2 contract requires non-empty strings.
                    "CALLE": props["CALLE"] or "Desconocida",
                    "ESQUINA": props["ESQUINA"] or "Desconocida",
                },
            }
        pattern = patterns.setdefault(
            props["COD_VARIAN"], {"linea": props["DESC_LINEA"], "paradas": []}
        )
        pattern["paradas"].append([cod, props["ORDINAL"]])

    for pattern in patterns.values():
        pattern["paradas"].sort(key=lambda p: p[1])
    features = sorted(features_by_code.values(), key=lambda f: str(f["properties"]["COD_UBIC_P"]))
    return {
        "type": "FeatureCollection",
        "format_version": FORMAT_VERSION,
        "generated_at": generated_at,
        "features": features,
        "patterns": patterns,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--generated-at",
        required=True,
        help="ISO-8601 timestamp of when the v1 data was fetched from the API",
    )
    args = parser.parse_args()

    routes_v1 = load("routes.json")
    stops_v1 = load("stops.json")
    if routes_v1.get("format_version") == FORMAT_VERSION:
        log("routes.json is already format v2; nothing to do.")
        return

    log(f"v1 sizes: routes {os.path.getsize('routes.json'):,} B, "
        f"stops {os.path.getsize('stops.json'):,} B")

    routes_v2 = build_routes_collection(routes_v1["features"], args.generated_at)
    stops_v2 = stops_v1_to_v2(stops_v1, args.generated_at)

    validate_routes_collection(routes_v2)
    validate_stops_collection(stops_v2)
    validate_cross(routes_v2, stops_v2)

    save(routes_v2, "routes")
    save(stops_v2, "stops")
    log(f"v2 sizes: routes {os.path.getsize('routes.json'):,} B, "
        f"stops {os.path.getsize('stops.json'):,} B")


if __name__ == "__main__":
    main()
