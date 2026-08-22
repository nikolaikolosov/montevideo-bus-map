#!/usr/bin/env python3
"""Re-freeze the dataset cardinalities pinned in tests/js/route-invariants.test.js.

`dataset shape (frozen)` is the canary for "the dataset changed" — it exists so
a PR that is NOT a data update cannot move the numbers unnoticed. A data update
IS allowed to move them, so update_and_push.sh runs this with the counts it
measured from the files it just fetched (--refresh-expectations only).

Doing it here rather than with sed in the shell keeps two properties: the numbers
come from the data, never from a hand-typed guess, and a missing assertion is an
error instead of a silent no-op.

Usage: refreeze_dataset_shape.py <lines> <variants> <stops>
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

TEST = Path("tests/js/route-invariants.test.js")

PATTERNS = (
    ("lines", r"(expect\(routesByLine\.size\)\.toBe\()\d+(\))"),
    ("variants", r"(expect\(routesData\.features\)\.toHaveLength\()\d+(\))"),
    ("stops", r"(expect\(uniqueStopsData\)\.toHaveLength\()\d+(\))"),
)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2

    source = TEST.read_text(encoding="utf-8")
    for value, (name, pattern) in zip(argv, PATTERNS, strict=True):
        if not value.isdigit():
            print(f"{name}: '{value}' is not a count", file=sys.stderr)
            return 2
        source, hits = re.subn(
            pattern,
            lambda match, v=value: f"{match.group(1)}{v}{match.group(2)}",
            source,
            count=1,
        )
        if hits != 1:
            print(f"could not find the frozen assertion for {name}", file=sys.stderr)
            return 1

    TEST.write_text(source, encoding="utf-8", newline="")
    print(f"frozen shape now {argv[0]} lines / {argv[1]} variants / {argv[2]} stops")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
