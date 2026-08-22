"""The two helpers update_and_push.sh leans on to decide what to publish.

`dataset_shape.py` answers "did any FEATURE change, and what are the counts";
`refreeze_dataset_shape.py` writes those counts into the frozen assertions. Both
run unattended in the middle of a publish, so their edge cases — no committed
version yet, an assertion that has been renamed — must fail loudly rather than
quietly do the wrong thing.
"""

import json
import os
import shutil
import subprocess
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHAPE = os.path.join(REPO, "scripts", "dataset_shape.py")
REFREEZE = os.path.join(REPO, "scripts", "refreeze_dataset_shape.py")

FROZEN = """\
        expect(routesByLine.size).toBe(140);
        expect(routesData.features).toHaveLength(1083);
        expect(uniqueStopsData).toHaveLength(4901);
"""


def write_data(path, lines=("1", "2"), stops=(10, 20), generated_at="2026-01-01T00:00:00+00:00"):
    routes = {
        "type": "FeatureCollection",
        "format_version": 2,
        "generated_at": generated_at,
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
                "properties": {"COD_VARIAN": i, "DESC_LINEA": line, "DESC_VARIA": "T"},
            }
            for i, line in enumerate(lines)
        ],
    }
    stops_doc = {
        "type": "FeatureCollection",
        "format_version": 2,
        "generated_at": generated_at,
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [0, 0]},
                "properties": {"COD_UBIC_P": code, "CALLE": "A", "ESQUINA": "B"},
            }
            for code in stops
        ],
        "patterns": [],
    }
    (path / "routes.json").write_text(json.dumps(routes), encoding="utf-8")
    (path / "stops.json").write_text(json.dumps(stops_doc), encoding="utf-8")


def git(cwd, *args):
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    ).stdout.strip()


def shape(cwd):
    result = subprocess.run(
        [sys.executable, "scripts/dataset_shape.py"],
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.split()


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init", "-q", "-b", "main")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "test")
    (tmp_path / "scripts").mkdir()
    shutil.copy(SHAPE, tmp_path / "scripts" / "dataset_shape.py")
    shutil.copy(REFREEZE, tmp_path / "scripts" / "refreeze_dataset_shape.py")
    write_data(tmp_path)
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "initial")
    return tmp_path


def test_reports_the_counts_the_frozen_assertions_need(repo):
    state, variants, stops, lines, new_lines = shape(repo)
    assert (state, variants, stops, lines, new_lines) == ("unchanged", "2", "2", "2", "0")


def test_a_new_timestamp_is_not_a_change(repo):
    write_data(repo, generated_at="2026-12-31T23:59:59+00:00")
    assert shape(repo)[0] == "unchanged"


def test_a_moved_feature_is_a_change_and_new_lines_are_counted(repo):
    write_data(repo, lines=("1", "2", "3"), stops=(10, 20, 30))
    state, variants, stops, lines, new_lines = shape(repo)
    assert state == "changed"
    assert (variants, stops, lines, new_lines) == ("3", "3", "3", "1")


def test_uncommitted_data_counts_as_a_change(tmp_path):
    """A first run in a fresh checkout must publish, not compare against nothing."""
    git(tmp_path, "init", "-q", "-b", "main")
    (tmp_path / "scripts").mkdir()
    shutil.copy(SHAPE, tmp_path / "scripts" / "dataset_shape.py")
    write_data(tmp_path)
    assert shape(tmp_path)[0] == "changed"


def refreeze(cwd, *args):
    return subprocess.run(
        [sys.executable, "scripts/refreeze_dataset_shape.py", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
    )


def test_refreeze_writes_all_three_counts(repo):
    (repo / "tests" / "js").mkdir(parents=True)
    target = repo / "tests" / "js" / "route-invariants.test.js"
    target.write_text(FROZEN, encoding="utf-8")

    result = refreeze(repo, "141", "1088", "4938")

    assert result.returncode == 0, result.stderr
    assert target.read_text(encoding="utf-8") == (
        "        expect(routesByLine.size).toBe(141);\n"
        "        expect(routesData.features).toHaveLength(1088);\n"
        "        expect(uniqueStopsData).toHaveLength(4938);\n"
    )


def test_refreeze_refuses_when_an_assertion_is_missing(repo):
    """Renaming the canary must break the publish, not silently patch two of three."""
    (repo / "tests" / "js").mkdir(parents=True)
    target = repo / "tests" / "js" / "route-invariants.test.js"
    target.write_text(FROZEN.replace("expect(uniqueStopsData).toHaveLength(4901);", ""), "utf-8")

    result = refreeze(repo, "141", "1088", "4938")

    assert result.returncode == 1
    assert "stops" in result.stderr


def test_refreeze_rejects_a_count_that_is_not_a_number(repo):
    (repo / "tests" / "js").mkdir(parents=True)
    (repo / "tests" / "js" / "route-invariants.test.js").write_text(FROZEN, encoding="utf-8")

    result = refreeze(repo, "141", "many", "4938")

    assert result.returncode == 2
    assert "not a count" in result.stderr
