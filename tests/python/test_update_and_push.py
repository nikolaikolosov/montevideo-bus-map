"""Guards on the publish wrapper (update_and_push.sh).

The script is the only path that puts data on GitHub Pages, and it runs
unattended on a machine with Uruguayan connectivity, so its refusals matter more
than its happy path. Each case below drives the real script in a throwaway git
repo with a stub fetcher and stub npm/npx, so nothing here touches the network,
this repository, or node.

Skipped where bash is unavailable; CI runs on ubuntu, where it exists.
"""

import json
import os
import shutil
import stat
import subprocess
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(REPO, "update_and_push.sh")

pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")

FROZEN_TEST = """\
describe('dataset shape (frozen)', () => {
    it('has the expected cardinalities', () => {
        expect(routesByLine.size).toBe(1);
        expect(routesData.features).toHaveLength(1);
        expect(uniqueStopsData).toHaveLength(1);
    });
});
"""


def git(cwd, *args):
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    ).stdout.strip()


def dataset(variants=1, stops=1, generated_at="2026-01-01T00:00:00+00:00"):
    """A minimal pair of format-v2 files the shape reader can read."""
    routes = {
        "type": "FeatureCollection",
        "format_version": 2,
        "generated_at": generated_at,
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
                "properties": {
                    "COD_VARIAN": i,
                    "DESC_LINEA": "1",
                    "DESC_VARIA": "TEST",
                },
            }
            for i in range(variants)
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
                "properties": {"COD_UBIC_P": i, "CALLE": "A", "ESQUINA": "B"},
            }
            for i in range(stops)
        ],
        "patterns": [],
    }
    return routes, stops_doc


def write_dataset(path, **kwargs):
    routes, stops_doc = dataset(**kwargs)
    (path / "routes.json").write_text(json.dumps(routes), encoding="utf-8")
    (path / "stops.json").write_text(json.dumps(stops_doc), encoding="utf-8")


def executable(path, body):
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return path


@pytest.fixture
def repo(tmp_path):
    """A repo on `main` with committed data files and the script under test."""
    git(tmp_path, "init", "-q", "-b", "main")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "test")

    write_dataset(tmp_path)
    (tmp_path / "src.js").write_text("// unrelated\n", encoding="utf-8")
    for name in ("src", "qa/reports", "scripts", "tests/js"):
        (tmp_path / name).mkdir(parents=True, exist_ok=True)
    palette = tmp_path / "src/line-colors.js"
    palette.write_text("export const LINE_COLORS = {};\n", encoding="utf-8")
    (tmp_path / "tests/js/route-invariants.test.js").write_text(FROZEN_TEST, encoding="utf-8")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "initial")

    shutil.copy(SCRIPT, tmp_path / "update_and_push.sh")
    shutil.copy(
        os.path.join(REPO, "scripts", "dataset_shape.py"), tmp_path / "scripts" / "dataset_shape.py"
    )
    shutil.copy(
        os.path.join(REPO, "scripts", "refreeze_dataset_shape.py"),
        tmp_path / "scripts" / "refreeze_dataset_shape.py",
    )
    # The contract check is exercised by its own suite; here it must merely exist.
    (tmp_path / "scripts" / "validate_data.py").write_text("", encoding="utf-8")
    (tmp_path / ".env").write_text("API_ROUTES_URL=https://example.invalid\n", encoding="utf-8")
    return tmp_path


def stub_npm(repo, fail_test_times=0):
    """An `npm` that logs its calls and can fail `npm test` the first N times.

    Failing a fixed number of times is how the refresh path is exercised: the
    gate must fail, the script must refresh the frozen shape, and the re-run must
    then pass — which is exactly what a real data update looks like.
    """
    counter = repo / ".npm-test-calls"
    palette = "printf 'export const LINE_COLORS = { 1: {} };\\n' > src/line-colors.js"
    return executable(
        repo / "npm-stub",
        f"""#!/usr/bin/env bash
echo "npm $*" >> "{counter.as_posix()}.log"
# The real assign:colors rewrites the palette, and the wrapper must ship that
# regenerated file with the data instead of letting it drift.
if [ "$3" = "assign:colors" ]; then
    {palette}
fi
if [ "$1" = "test" ]; then
    n=$(cat "{counter.as_posix()}" 2>/dev/null || echo 0)
    echo $((n + 1)) > "{counter.as_posix()}"
    if [ "$n" -lt "{fail_test_times}" ]; then
        echo "FAIL dataset shape (frozen)"
        exit 1
    fi
fi
exit 0
""",
    )


def stub_npx(repo, fail_playwright_times=0):
    counter = repo / ".npx-pw-calls"
    return executable(
        repo / "npx-stub",
        f"""#!/usr/bin/env bash
echo "npx $*" >> "{counter.as_posix()}.log"
if [ "$1" = "playwright" ]; then
    n=$(cat "{counter.as_posix()}" 2>/dev/null || echo 0)
    echo $((n + 1)) > "{counter.as_posix()}"
    if [ "$n" -lt "{fail_playwright_times}" ]; then
        echo "FAIL scene: global-stops-dark"
        exit 1
    fi
fi
exit 0
""",
    )


def run(repo, *args, fetcher="pass\n", npm_fail=0, npx_fail=0, **env):
    """Runs the script with stubs standing in for the fetch and for node.

    The script cd's to its own directory and calls `"$PYTHON" fetch_api_data.py`,
    so the stub simply IS that file inside the throwaway repo — no wrapper, and
    no chance of reaching the network or the committed datasets.
    """
    (repo / "fetch_api_data.py").write_text(fetcher, encoding="utf-8")
    return subprocess.run(
        ["bash", "./update_and_push.sh", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PYTHON": sys.executable,
            "NPM": str(stub_npm(repo, npm_fail)),
            "NPX": str(stub_npx(repo, npx_fail)),
            **env,
        },
    )


def fetcher_writing(variants=1, stops=1, generated_at="2026-06-06T00:00:00+00:00"):
    """A stub fetcher that writes the dataset it is told to."""
    return (
        "import json, pathlib, sys\n"
        f"sys.path.insert(0, {json.dumps(os.path.dirname(os.path.abspath(__file__)))})\n"
        "from test_update_and_push import dataset\n"
        f"routes, stops = dataset({variants}, {stops}, {json.dumps(generated_at)})\n"
        "pathlib.Path('routes.json').write_text(json.dumps(routes), encoding='utf-8')\n"
        "pathlib.Path('stops.json').write_text(json.dumps(stops), encoding='utf-8')\n"
    )


def test_refuses_to_sweep_unrelated_staged_changes_into_the_bot_commit(repo):
    """The pathspec-less version committed whatever else was in the index.

    An operator with a staged config tweak got it published under the bot
    identity, with a message claiming it was a data update, straight to Pages.
    """
    (repo / "src.js").write_text("// tweaked while tuning\n", encoding="utf-8")
    git(repo, "add", "src.js")

    result = run(repo, fetcher=fetcher_writing(variants=2))

    assert result.returncode == 1, result.stdout + result.stderr
    assert "unrelated staged changes" in result.stdout
    assert "src.js" in result.stdout
    # Nothing was committed and the tweak is still staged, not published.
    assert git(repo, "rev-list", "--count", "HEAD") == "1"
    assert "src.js" in git(repo, "diff", "--staged", "--name-only")


def test_refuses_to_publish_from_the_wrong_branch(repo):
    git(repo, "checkout", "-qb", "experiment")
    result = run(repo)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "expected 'main'" in result.stdout
    assert git(repo, "rev-list", "--count", "HEAD") == "1"


def test_a_fresh_timestamp_alone_is_not_a_reason_to_publish(repo):
    """Every fetch moves `generated_at`; only a FEATURE change is worth a deploy.

    Publishing the timestamp would rebuild Pages and burn a gate run for a file
    the visitors cannot tell apart from the previous one.
    """
    result = run(repo, fetcher=fetcher_writing(generated_at="2026-09-09T09:09:09+00:00"))

    assert result.returncode == 0, result.stdout + result.stderr
    assert "nothing to publish" in result.stdout
    assert git(repo, "rev-list", "--count", "HEAD") == "1"
    # The files are put back, so the tree is left as it was found.
    assert git(repo, "status", "--porcelain", "--", "routes.json", "stops.json") == ""
    # And no gate was spent on it.
    assert not (repo / ".npm-test-calls.log").exists()


def test_publishes_the_data_and_what_the_gates_regenerate(repo):
    """The happy path: data plus the artifacts that are functions of the data."""
    (repo / "src.js").write_text("// dirty but unstaged\n", encoding="utf-8")

    result = run(repo, fetcher=fetcher_writing(variants=3, stops=5))

    # git push fails (no remote) — everything up to it must have worked.
    assert "Committing and pushing updated data" in result.stdout, result.stdout + result.stderr
    assert git(repo, "rev-list", "--count", "HEAD") == "2"
    committed = git(repo, "show", "--pretty=", "--name-only", "HEAD").split()
    assert set(committed) == {"routes.json", "stops.json", "src/line-colors.js"}
    assert git(repo, "log", "-1", "--pretty=%an") == "montevideo-bus-bot"
    # The unrelated edit stayed out of the commit and out of the index.
    assert "src.js" in git(repo, "status", "--porcelain")


def test_a_failing_gate_stops_the_publish(repo):
    """The 2026-08-22 incident: data shipped while its expectations did not.

    The unit suite pins the dataset's cardinalities, so a feed change fails it —
    and until a human has looked, nothing may reach Pages.
    """
    result = run(repo, fetcher=fetcher_writing(variants=4, stops=9), npm_fail=99)

    assert result.returncode == 1, result.stdout + result.stderr
    assert "unit suite failed on the new data" in result.stdout
    assert "--refresh-expectations" in result.stdout
    assert git(repo, "rev-list", "--count", "HEAD") == "1"


def test_refresh_expectations_refreezes_the_shape_and_ships_it(repo):
    """With the flag, the counts are refreshed FROM the data and published."""
    result = run(
        repo,
        "--refresh-expectations",
        fetcher=fetcher_writing(variants=4, stops=9),
        npm_fail=1,
    )

    assert "Committing and pushing updated data" in result.stdout, result.stdout + result.stderr
    frozen = (repo / "tests/js/route-invariants.test.js").read_text(encoding="utf-8")
    assert "toHaveLength(4)" in frozen  # variants
    assert "toHaveLength(9)" in frozen  # stops
    assert "toBe(1)" in frozen  # one line in the fixture
    committed = git(repo, "show", "--pretty=", "--name-only", "HEAD").split()
    assert "tests/js/route-invariants.test.js" in committed


def test_skip_e2e_says_so_instead_of_pretending(repo):
    result = run(repo, fetcher=fetcher_writing(variants=2), SKIP_E2E="1")
    assert "are NOT checked here; CI will" in result.stdout
    assert not (repo / ".npx-pw-calls").exists()


def test_dry_run_stages_but_does_not_commit(repo):
    result = run(repo, fetcher=fetcher_writing(variants=2), DRY_RUN="1")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "stopping before the commit" in result.stdout
    assert git(repo, "rev-list", "--count", "HEAD") == "1"
    assert "routes.json" in git(repo, "diff", "--staged", "--name-only")
