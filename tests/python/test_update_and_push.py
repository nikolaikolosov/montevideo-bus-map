"""Guards on the publish wrapper (update_and_push.sh).

The script is the only path that puts data on GitHub Pages, and it runs
unattended on a machine with Uruguayan connectivity, so its refusals matter more
than its happy path. Each case below drives the real script in a throwaway git
repo with a stub fetcher, so nothing here touches the network or this repository.

Skipped where bash or flock is unavailable (a plain Windows checkout); CI runs on
ubuntu, where both exist.
"""

import os
import shutil
import subprocess
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(REPO, "update_and_push.sh")

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("flock") is None,
    reason="needs bash + flock",
)


def git(cwd, *args):
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path):
    """A repo on `main` with committed data files and the script under test."""
    git(tmp_path, "init", "-q", "-b", "main")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "test")
    for name in ("routes.json", "stops.json"):
        (tmp_path / name).write_text('{"features": []}', encoding="utf-8")
    (tmp_path / "src.js").write_text("// unrelated\n", encoding="utf-8")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "initial")

    shutil.copy(SCRIPT, tmp_path / "update_and_push.sh")
    (tmp_path / ".env").write_text("API_ROUTES_URL=https://example.invalid\n", encoding="utf-8")
    return tmp_path


def run(repo, fetcher="pass\n", **env):
    """Runs the script with `fetcher` standing in for the real fetch.

    The script cd's to its own directory and calls `"$PYTHON" fetch_api_data.py`,
    so the stub simply IS that file inside the throwaway repo — no wrapper, and
    no chance of reaching the network or the committed datasets.
    """
    (repo / "fetch_api_data.py").write_text(fetcher, encoding="utf-8")
    return subprocess.run(
        ["bash", "./update_and_push.sh"],
        cwd=repo,
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHON": sys.executable, **env},
    )


def test_refuses_to_sweep_unrelated_staged_changes_into_the_bot_commit(repo):
    """The pathspec-less version committed whatever else was in the index.

    An operator with a staged config tweak got it published under the bot
    identity, with a message claiming it was a data update, straight to Pages.
    """
    (repo / "src.js").write_text("// tweaked while tuning\n", encoding="utf-8")
    git(repo, "add", "src.js")

    result = run(repo)

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


def test_unchanged_data_is_not_committed(repo):
    """Coverage, not regression proof: with a clean index the old script agreed.

    The "is the index empty?" vs "did the data change?" difference only shows up
    when something else is staged, which the first case above covers.
    """
    result = run(repo)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "No changes to commit" in result.stdout
    assert git(repo, "rev-list", "--count", "HEAD") == "1"


def test_commits_only_the_data_files(repo):
    """Coverage for the happy path (the old script passed this one too)."""
    # The fetcher rewrites the data; an unrelated file is dirty but NOT staged.
    fetcher = (
        "import pathlib\n"
        "pathlib.Path('routes.json').write_text('{\"features\": [1]}', encoding='utf-8')\n"
    )
    (repo / "src.js").write_text("// dirty but unstaged\n", encoding="utf-8")

    result = run(repo, fetcher=fetcher)

    # git push fails (no remote) — everything up to it must have worked.
    assert "Committing and pushing updated data" in result.stdout
    assert git(repo, "rev-list", "--count", "HEAD") == "2"
    assert git(repo, "show", "--pretty=", "--name-only", "HEAD") == "routes.json"
    assert git(repo, "log", "-1", "--pretty=%an") == "montevideo-bus-bot"
    # The unrelated edit stayed out of the commit and out of the index.
    assert "src.js" in git(repo, "status", "--porcelain")
