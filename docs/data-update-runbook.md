# Runbook — Manual Data Update

The map's data (`routes.json`, `stops.json`) is updated **manually, by design**.
The source API (`api.montevideo.gub.uy`) only accepts connections from inside
Uruguay's network, and there is no UY-based server — so a person with Uruguayan
connectivity runs the update when they want fresher data. The site shows the
data's generation date ("Datos: …"), turning amber after 45 days
(`FRESHNESS_WARN_DAYS` in `src/config.js`) as a reminder.

## Prerequisites (once per machine)

1. A machine on a Uruguayan network (physically in UY or a UY exit node).
2. Python 3.11+ with `pip install -r requirements.txt`.
3. Credentials: register at <https://api.montevideo.gub.uy/>, then
   `cp .env.example .env` and fill in `API_CLIENT_ID`, `API_CLIENT_SECRET`,
   `API_AUTH_URL`, `API_ROUTES_URL`, `API_STOPS_URL`. `.env` is git-ignored — never
   commit it.
4. Push access to the GitHub repo.

## Procedure

1. From the repo root, on the UY-network machine:

   ```bash
   python fetch_api_data.py
   ```

   The script authenticates, downloads the GTFS feed, rebuilds both files in
   format v2, and **validates them against the data contract before writing**
   (`architecture/contracts/data-contract.md`). Any auth/network/contract problem
   exits non-zero with a message — old files stay in place on failure.

   Two volume guards run after the contract checks, because a *partial* feed
   satisfies the contract perfectly — `stop_times.txt` is the largest member of
   the GTFS zip, so an upstream regeneration caught in flight yields intact
   shapes with a few per cent of the stop patterns:

   - patterns must cover ≥ 95 % of route variants, and
   - no count may drop below 90 % of what is already committed on disk.

   If a contraction is real (a chunk of the network genuinely retired), re-run
   with `python fetch_api_data.py --allow-shrink`; the script logs what it waved
   through. Do not reach for the flag to make an unexplained shrink go away.

   Both files are published together: each is written to `<name>.json.tmp`,
   flushed, and only renamed once both are complete, so a crash or a full disk
   can no longer leave a truncated `routes.json` or a fresh routes file paired
   with the previous stops file.

2. Sanity-check the result:

   ```bash
   python scripts/validate_data.py   # re-validates the files on disk
   git diff --stat routes.json stops.json
   ```

   Expect both files to change moderately. A wild size swing (e.g. −80%) means a
   broken feed — stop and investigate before committing.

3. Refresh the line color palette (only does anything when lines were added or
   removed):

   ```bash
   npm run assign:colors    # appends colors for NEW lines; never recolors existing ones
   npm run verify:colors    # gates: coverage, uniqueness, in-clique ΔE, contrast
   git diff --stat src/line-colors.js qa/reports/line-colors-report.md
   ```

   Expect at most a few added entries. If `verify:colors` fails its in-clique
   distance gate, a new line landed in a crowded stop the incremental mode
   can't serve — rerun with `node scripts/assign_line_colors.mjs
   --regenerate-all` and review the visual scene diffs (all baselines change).
   CI fails on a missing palette entry, so skipping this step cannot ship.

4. Re-derive the geometry scale ladder (the bundling constants are sized
   against measured data properties — a new dataset must not drift past them):

   ```bash
   npm run verify:scales    # regenerates qa/reports/geometry-scales-report.md
   ```

   A FAILed assertion means the digitisation style of the feed changed (e.g.
   ida/vuelta offsets grew past the merge radius). Do NOT loosen the bound:
   re-derive the constant per `architecture/contracts/route-geometry-contract.md` and
   review the render diffs (golden + baselines will change).

5. Re-check the journey cost model (the planner charges straight-line distance
   × a factor measured from the traces; a new feed can move it):

   ```bash
   npm run verify:journey   # regenerates qa/reports/journey-planner-report.md
   ```

   A FAILed assertion means either the detour factor drifted past 5 % (update
   `CONFIG.JOURNEY_BUS_DETOUR_FACTOR` to the measured value, per ADR-001) or the
   network lost reachability (investigate the feed before shipping).

6. Optional visual check: `./serve.sh`, pick a line, click a stop → "Ver rutas",
   then plan a trip with "Desde acá" / "Hacia acá". The panel's "Datos: …" date
   must show today.

7. Commit and push (push to `main` **is** the production deploy — GitHub Pages
   rebuilds automatically; CI validates the data again on the push):

   ```bash
   git add routes.json stops.json src/line-colors.js qa/reports/line-colors-report.md qa/reports/geometry-scales-report.md qa/reports/journey-planner-report.md
   git commit -m "Update bus routes and stops data from API"
   git push
   ```

   `./update_and_push.sh` does steps 1 + 6 in one go (it only commits when the
   data actually changed) — run steps 3–5 first when the line set changed.

8. Verify: <https://nikolaikolosov.github.io/montevideo-bus-map/> shows the new
   date in "Datos: …" (allow a couple of minutes for the Pages build; hard-refresh
   to skip the browser cache).

## Failure modes

| Symptom | Cause | Action |
|---|---|---|
| `Auth failed (403)` with HTML body | not on a UY network (gateway geo-block) or WAF rejected the client | run from UY connectivity; don't change the User-Agent in `build_session()` |
| `API_* are not set` | `.env` missing/incomplete | copy `.env.example`, fill values |
| `Contract violation: …` | API changed its feed format | do NOT force-commit; open an issue, adjust the pipeline + contract + tests together |
| `GTFS feed is missing …` | partial/broken download | retry; the session already retries transient 5xx |
| `… route variants have no stop pattern (… > 5%)` | `stop_times.txt` truncated upstream — shapes fine, patterns mostly absent | retry later; the feed is mid-regeneration. Never bypass this one |
| `… is …% of the … already on disk … refusing to overwrite good data` | the new dataset is a fraction of the committed one | investigate; if the contraction is genuine, re-run with `--allow-shrink` |
| `unrelated staged changes present; refusing to commit` (wrapper) | something else was `git add`ed before running `update_and_push.sh` | `git restore --staged <path>` and re-run — the wrapper publishes data files only |
| `on branch 'x', expected 'main'` (wrapper) | publishing from a feature branch | check out `main`, or set `TARGET_BRANCH` deliberately |
