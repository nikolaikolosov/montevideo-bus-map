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

git add routes.json stops.json

if git diff --staged --quiet; then
    log "No changes to commit."
    exit 0
fi

log "Committing and pushing updated data..."
git -c user.name="montevideo-bus-bot" \
    -c user.email="montevideo-bus-bot@users.noreply.github.com" \
    commit -m "Auto-update bus routes and stops data from API"
git push
log "Done."
