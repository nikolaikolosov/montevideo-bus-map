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

2. Sanity-check the result:

   ```bash
   python scripts/validate_data.py   # re-validates the files on disk
   git diff --stat routes.json stops.json
   ```

   Expect both files to change moderately. A wild size swing (e.g. −80%) means a
   broken feed — stop and investigate before committing.

3. Optional visual check: `./serve.sh`, pick a line, click a stop → "Ver rutas".
   The panel's "Datos: …" date must show today.

4. Commit and push (push to `main` **is** the production deploy — GitHub Pages
   rebuilds automatically; CI validates the data again on the push):

   ```bash
   git add routes.json stops.json
   git commit -m "Update bus routes and stops data from API"
   git push
   ```

   `./update_and_push.sh` does steps 1 + 4 in one go (it only commits when the
   data actually changed).

5. Verify: <https://nikolaikolosov.github.io/montevideo-bus-map/> shows the new
   date in "Datos: …" (allow a couple of minutes for the Pages build; hard-refresh
   to skip the browser cache).

## Failure modes

| Symptom | Cause | Action |
|---|---|---|
| `Auth failed (403)` with HTML body | not on a UY network (gateway geo-block) or WAF rejected the client | run from UY connectivity; don't change the User-Agent in `build_session()` |
| `API_* are not set` | `.env` missing/incomplete | copy `.env.example`, fill values |
| `Contract violation: …` | API changed its feed format | do NOT force-commit; open an issue, adjust the pipeline + contract + tests together |
| `GTFS feed is missing …` | partial/broken download | retry; the session already retries transient 5xx |
