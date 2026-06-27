#!/usr/bin/env bash
#
# Fetch the latest Montevideo bus data and push it to the repo.
#
# Designed to run from cron on a host WITH Uruguayan connectivity
# (api.montevideo.gub.uy only accepts connections from inside UY).
#
# Setup:
#   1. cp .env.example .env   and fill in API_CLIENT_ID / API_CLIENT_SECRET
#   2. Make sure `git push` works non-interactively (SSH deploy key or token).
#   3. crontab -e:
#        0 4 * * *  /path/to/montevideo-bus-map/update_and_push.sh >> /path/to/update.log 2>&1
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

git add routes.js routes.json stops.js stops.json

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
