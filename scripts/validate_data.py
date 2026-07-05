"""Validate the committed routes.json / stops.json against the v2 data contract.

Run from the repo root (CI does this on every push):
    python scripts/validate_data.py
Exits non-zero with the first contract violation.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fetch_api_data import (  # noqa: E402
    FetchError,
    log,
    validate_cross,
    validate_routes_collection,
    validate_stops_collection,
)


def main():
    with open("routes.json", encoding="utf-8") as f:
        routes = json.load(f)
    with open("stops.json", encoding="utf-8") as f:
        stops = json.load(f)

    validate_routes_collection(routes)
    validate_stops_collection(stops)
    validate_cross(routes, stops)
    log(
        f"OK: routes {len(routes['features'])} features, "
        f"stops {len(stops['features'])} unique / {len(stops['patterns'])} patterns, "
        f"generated_at {stops['generated_at']}"
    )


if __name__ == "__main__":
    try:
        main()
    except FetchError as e:
        log(f"ERROR: {e}")
        sys.exit(1)
