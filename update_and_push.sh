#!/usr/bin/env bash
#
# Fetch the latest Montevideo bus data, commit and push it in one go.
#
# Convenience wrapper for the MANUAL update procedure (docs/data-update-runbook.md).
# Must run from a machine WITH Uruguayan connectivity
# (api.montevideo.gub.uy only accepts connections from inside UY).
#
# Setup:
#   1. cp .env.example .env   and fill in the API_* variables
#   2. Make sure `git push` works non-interactively (SSH key or token).
#
# (Can also be cron'd on a UY host if one ever exists — the flock guard below
# protects against overlapping runs.)
#
set -euo pipefail

# Always run from the repo root (directory of this script).
cd "$(dirname "$0")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Prevent overlapping runs.
exec 9>/tmp/montevideo-bus-map.lock
if ! flock -n 9; then
    log "Another run is in progress; exiting."
    exit 0
fi

# Load credentials and endpoint URLs (not committed; see .env.example).
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
else
    log "ERROR: .env not found. Copy .env.example to .env and fill in the credentials."
    exit 1
fi

PYTHON="${PYTHON:-python3}"

log "Fetching latest bus data..."
"$PYTHON" fetch_api_data.py

# Every git operation below is scoped to these paths with an explicit pathspec.
# Without one, `git diff --staged --quiet` asked "is the index empty?" instead of
# "did the data change?", and `git commit` committed whatever else happened to be
# staged — publishing an unreviewed edit under the bot identity, with a message
# claiming it is a data update, straight to GitHub Pages.
DATA_FILES=(routes.json stops.json)
BRANCH="${TARGET_BRANCH:-main}"

# Refuse to touch a dirty index rather than sweeping it into the bot commit.
other_staged=$(git diff --staged --name-only -- . \
    ':(exclude)routes.json' ':(exclude)stops.json')
if [ -n "$other_staged" ]; then
    log "ERROR: unrelated staged changes present; refusing to commit:"
    printf '  %s\n' $other_staged
    log "Unstage them (git restore --staged <path>) and re-run."
    exit 1
fi

current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" != "$BRANCH" ]; then
    log "ERROR: on branch '$current_branch', expected '$BRANCH'."
    log "Check out $BRANCH (or set TARGET_BRANCH) before publishing data."
    exit 1
fi

git add -- "${DATA_FILES[@]}"

if git diff --staged --quiet -- "${DATA_FILES[@]}"; then
    log "No changes to commit."
    exit 0
fi

log "Committing and pushing updated data..."
git -c user.name="montevideo-bus-bot" \
    -c user.email="montevideo-bus-bot@users.noreply.github.com" \
    commit -m "Auto-update bus routes and stops data from API" -- "${DATA_FILES[@]}"
git push origin "$BRANCH"
log "Done."
