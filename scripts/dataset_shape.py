#!/usr/bin/env python3
"""Report the shape of the dataset on disk, and whether it differs from HEAD.

Used by update_and_push.sh to decide two things before it spends five minutes
on the gates: is there anything to publish at all, and what are the numbers the
frozen assertions in tests/js/route-invariants.test.js should carry.

The comparison is over FEATURES, not bytes: `generated_at` moves on every fetch,
so a byte diff would call an unchanged feed a change and redeploy the site for a
new timestamp.

Prints one line: "<changed|unchanged> <variants> <stops> <lines> <new lines>".
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROUTES = Path("routes.json")
STOPS = Path("stops.json")


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def committed(path: Path) -> dict | None:
    """The version in HEAD, or None when it is not committed (yet)."""
    result = subprocess.run(
        ["git", "show", f"HEAD:{path.as_posix()}"],
        capture_output=True,
    )
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)


def main() -> int:
    new_routes, new_stops = load(ROUTES), load(STOPS)
    old_routes, old_stops = committed(ROUTES), committed(STOPS)

    unchanged = (
        old_routes is not None
        and old_stops is not None
        and old_routes["features"] == new_routes["features"]
        and old_stops["features"] == new_stops["features"]
    )

    lines = {f["properties"]["DESC_LINEA"] for f in new_routes["features"]}
    stops = {f["properties"]["COD_UBIC_P"] for f in new_stops["features"]}
    old_lines = (
        {f["properties"]["DESC_LINEA"] for f in old_routes["features"]}
        if old_routes
        else set()
    )

    print(
        "unchanged" if unchanged else "changed",
        len(new_routes["features"]),
        len(stops),
        len(lines),
        len(lines - old_lines),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
