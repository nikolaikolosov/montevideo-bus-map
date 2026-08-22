#!/usr/bin/env bash
#
# Fetch the latest Montevideo bus data, run every gate a data change can break,
# then commit and push it in one go.
#
# Convenience wrapper for the MANUAL update procedure (docs/data-update-runbook.md).
# Must run from a machine WITH Uruguayan connectivity
# (api.montevideo.gub.uy only accepts connections from inside UY).
#
# The gates are here because publishing the data alone is not enough: the shape
# of the dataset is pinned in three places that a legitimate feed change moves —
# the frozen cardinalities, the golden render manifest and the pixel baselines —
# and on 2026-08-22 a data-only push left main red in two jobs for exactly that
# reason. Everything below runs BEFORE the commit, so a surprise stops the
# publish instead of being found in CI afterwards.
#
# Setup:
#   1. cp .env.example .env   and fill in the API_* variables
#   2. Make sure `git push` works non-interactively (SSH key or token).
#   3. npm ci   (the gates are npm scripts; the e2e gate also needs
#      `npx playwright install chromium`).
#
# Usage:
#   ./update_and_push.sh                          # fetch, gate, publish
#   ./update_and_push.sh --refresh-expectations   # …and refresh what the data legitimately moved
#
# Environment:
#   REFRESH_EXPECTATIONS=1   same as --refresh-expectations
#   SKIP_FETCH=1             gate and publish the files already on disk
#   SKIP_E2E=1               skip the Playwright gate (golden manifest + pixel scenes)
#   DRY_RUN=1                run everything, then print what would be published instead
#                            of committing and pushing it
#   TARGET_BRANCH=…          publish somewhere other than main
#   PYTHON=… NPM=… NPX=…     the interpreters/runners to use (the wrapper's own
#                            tests inject stubs through these)
#
# (Can also be cron'd on a UY host if one ever exists — the flock guard below
# protects against overlapping runs.)
#
set -euo pipefail

# Always run from the repo root (directory of this script).
cd "$(dirname "$0")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() {
    log "ERROR: $*"
    exit 1
}

REFRESH="${REFRESH_EXPECTATIONS:-0}"
for arg in "$@"; do
    case "$arg" in
        --refresh-expectations) REFRESH=1 ;;
        *) die "unknown argument '$arg' (see the header of this script)" ;;
    esac
done

# Prevent overlapping runs. flock does not exist on Git Bash, where a human is
# driving the script anyway — warn rather than refuse to run at all.
if command -v flock >/dev/null 2>&1; then
    exec 9>/tmp/montevideo-bus-map.lock
    if ! flock -n 9; then
        log "Another run is in progress; exiting."
        exit 0
    fi
else
    log "NOTE: flock unavailable; overlapping runs are not guarded against."
fi

# Load credentials and endpoint URLs (not committed; see .env.example).
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
else
    die ".env not found. Copy .env.example to .env and fill in the credentials."
fi

# python3 is the name on a UY Linux host; Git Bash on Windows only has python.
if [ -n "${PYTHON:-}" ]; then
    :
elif command -v python3 >/dev/null 2>&1; then
    PYTHON=python3
elif command -v python >/dev/null 2>&1; then
    PYTHON=python
else
    die "no python interpreter found (set PYTHON=…)"
fi

NPM="${NPM:-npm}"
NPX="${NPX:-npx}"

BRANCH="${TARGET_BRANCH:-main}"
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" != "$BRANCH" ]; then
    die "on branch '$current_branch', expected '$BRANCH'. Check out $BRANCH (or set TARGET_BRANCH) before publishing data."
fi

# ---------------------------------------------------------------------------
# 1. Fetch
# ---------------------------------------------------------------------------

if [ "${SKIP_FETCH:-0}" = "1" ]; then
    log "SKIP_FETCH=1 — gating the files already on disk."
else
    log "Fetching latest bus data..."
    "$PYTHON" fetch_api_data.py
fi

# ---------------------------------------------------------------------------
# 2. Is there anything to publish?
# ---------------------------------------------------------------------------
#
# `generated_at` moves on every fetch, so a byte diff is not the question — the
# question is whether any FEATURE changed. Gating and publishing a commit for a
# fresh timestamp alone would redeploy the site for nothing.

shape=$("$PYTHON" scripts/dataset_shape.py) || die "could not read routes.json / stops.json"
read -r data_state variant_count stop_count line_count new_line_count <<EOF
$shape
EOF

if [ "$data_state" = "unchanged" ]; then
    log "Feed carries the same $variant_count variants and $stop_count stops as HEAD — nothing to publish."
    git restore -- routes.json stops.json 2>/dev/null || true
    exit 0
fi

log "Feed changed: $variant_count variants, $stop_count stops, $line_count lines ($new_line_count new)."

# ---------------------------------------------------------------------------
# 3. Gates
# ---------------------------------------------------------------------------
#
# Two kinds. The first group REGENERATES files that are pure functions of the
# data — a palette entry per line, the measurement reports — so they ship WITH
# the data instead of drifting away from it. The second group CHECKS
# expectations a human owns, and stops the publish when one no longer holds.

log "Gate: data contract"
"$PYTHON" scripts/validate_data.py

log "Gate: line colours (incremental — never recolours an existing line)"
"$NPM" run --silent assign:colors
# assign_line_colors.mjs emits JSON-quoted keys; the committed file is Prettier's
# style, and CI runs `npm run format:check`. Without this pass every run stages a
# 842-line requoting diff — and one that would fail that check.
"$NPX" prettier --write src/line-colors.js >/dev/null
"$NPM" run --silent verify:colors

log "Gate: geometry scale ladder"
"$NPM" run --silent verify:scales

log "Gate: route geometry oracles"
"$NPM" run --silent verify:oracles

log "Gate: journey cost model"
"$NPM" run --silent verify:journey

REFRESHED=()

refresh_hint() {
    printf '%s\n' \
        "    Re-run with --refresh-expectations to update what the new data legitimately moved," \
        "    or update it by hand:" \
        "      frozen counts    tests/js/route-invariants.test.js ($line_count lines, $variant_count variants, $stop_count stops)" \
        "      golden manifest  UPDATE_GOLDEN=1 npx playwright test render-sweep" \
        "      pixel scenes     npx playwright test tests/e2e/visual.spec.js --update-snapshots=all"
}

log "Gate: unit suite"
if ! "$NPM" test --silent; then
    if [ "$REFRESH" != "1" ]; then
        refresh_hint
        die "unit suite failed on the new data."
    fi

    log "Refreshing the frozen dataset shape..."
    "$PYTHON" scripts/refreeze_dataset_shape.py "$line_count" "$variant_count" "$stop_count"
    REFRESHED+=(tests/js/route-invariants.test.js)
    "$NPM" test --silent ||
        die "unit suite still failing after refreshing the frozen shape — a real failure, not the dataset canary."
fi

if [ "${SKIP_E2E:-0}" = "1" ]; then
    log "SKIP_E2E=1 — the golden manifest and the pixel scenes are NOT checked here; CI will."
else
    log "Gate: e2e (interaction flows, golden render manifest, pixel scenes)"
    if ! "$NPX" playwright test; then
        if [ "$REFRESH" != "1" ]; then
            refresh_hint
            die "e2e failed on the new data."
        fi

        log "Refreshing the golden manifest and this platform's pixel baselines..."
        UPDATE_GOLDEN=1 "$NPX" playwright test render-sweep
        "$NPX" playwright test tests/e2e/visual.spec.js --update-snapshots=all
        REFRESHED+=(tests/e2e/golden/render-manifest.json tests/e2e/__screenshots__)

        # Baselines are committed per platform, and this refreshes only the
        # platform it runs on; the other one keeps images of the OLD data, which
        # is precisely what turns CI red after a data update. Dropping them makes
        # CI write them on its first run and upload them as the
        # `screenshot-baselines` artifact — the round-trip in the runbook.
        if [ "$(uname -s)" != "Linux" ]; then
            log "Dropping the linux baselines for the CI-artifact round-trip (see the runbook)."
            find tests/e2e/__screenshots__ -name '*-linux.png' -delete
        fi

        "$NPX" playwright test ||
            die "e2e still failing after refreshing the expectations — a real failure, not the dataset moving."
    fi
fi

# ---------------------------------------------------------------------------
# 4. Publish
# ---------------------------------------------------------------------------
#
# Every git operation below is scoped to these paths with an explicit pathspec.
# Without one, `git diff --staged --quiet` asked "is the index empty?" instead of
# "did the data change?", and `git commit` committed whatever else happened to be
# staged — publishing an unreviewed edit under the bot identity, with a message
# claiming it is a data update, straight to GitHub Pages.
PUBLISH_PATHS=(
    routes.json
    stops.json
    src/line-colors.js
    qa/reports/line-colors-report.md
    qa/reports/geometry-scales-report.md
    qa/reports/journey-planner-report.md
    qa/reports/route-geometry-oracles-report.md
)
# Only what THIS run refreshed is added, never a file a human happened to edit.
if [ ${#REFRESHED[@]} -gt 0 ]; then
    PUBLISH_PATHS+=("${REFRESHED[@]}")
fi

# Refuse to touch a dirty index rather than sweeping it into the bot commit.
exclude_args=()
for path in "${PUBLISH_PATHS[@]}"; do
    exclude_args+=(":(exclude)$path")
done
other_staged=$(git diff --staged --name-only -- . "${exclude_args[@]}")
if [ -n "$other_staged" ]; then
    log "ERROR: unrelated staged changes present; refusing to commit:"
    printf '  %s\n' $other_staged
    die "Unstage them (git restore --staged <path>) and re-run."
fi

# A pathspec matching nothing is fatal to git, and a publishable file this run
# did not produce (a report a skipped gate would have written) is a normal state
# — so the add list is those paths that exist on disk or are already tracked.
add_paths=()
for path in "${PUBLISH_PATHS[@]}"; do
    if [ -e "$path" ] || git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
        add_paths+=("$path")
    fi
done

git add -A -- "${add_paths[@]}"

if git diff --staged --quiet -- "${add_paths[@]}"; then
    log "No changes to commit."
    exit 0
fi

log "Publishing:"
git diff --staged --name-only -- "${add_paths[@]}" | sed 's/^/  /'

if [ "${DRY_RUN:-0}" = "1" ]; then
    log "DRY_RUN=1 — stopping before the commit. The staged files above are what would ship."
    exit 0
fi

log "Committing and pushing updated data..."
git -c user.name="montevideo-bus-bot" \
    -c user.email="montevideo-bus-bot@users.noreply.github.com" \
    commit -m "Auto-update bus routes and stops data from API" -- "${add_paths[@]}"
git push origin "$BRANCH"
log "Done."

if [ "$REFRESH" = "1" ] && [ "${SKIP_E2E:-0}" != "1" ] && [ "$(uname -s)" != "Linux" ]; then
    log "REMINDER: the linux baselines were dropped. The next CI run fails render-e2e and"
    log "  uploads the screenshot-baselines artifact — commit its *-linux.png files to this"
    log "  branch, and the run after that is green (docs/data-update-runbook.md)."
fi
