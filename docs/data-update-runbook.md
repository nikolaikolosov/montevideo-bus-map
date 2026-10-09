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

3. Refresh the line color palette and re-check it against the new stops. The
   in-clique gate depends on which lines share a stop, so it can fail even when
   no line was added: a retired line or a reshaped variant can leave an existing
   pair at a smaller stop, where the gate is stricter.

   ```bash
   npm run assign:colors    # appends colors for NEW lines; never recolors existing ones
   npx prettier --write src/line-colors.js   # back to the committed (Prettier) style
   npm run verify:colors    # gates: coverage, uniqueness, in-clique ΔE, contrast
   git diff --stat src/line-colors.js qa/reports/line-colors-report.md
   ```

   Expect at most a few added entries. If `verify:colors` fails its in-clique
   gate (`A vs B (smallest shared stop: N lines) too close`), do not lower the
   gate — stop and let the owner choose. On 2026-10-09, with Ce2 and L40
   retired, L14 and L4 met at a 4-line stop at ΔE 0.072 against a 0.08 gate.

   - **Recolor one line** — delete the entry of either line in the failing
     pair from `src/line-colors.js` and re-run `npm run assign:colors`. Only
     that line moves; its golden-manifest entry and the scenes that show it
     change.
   - **Rebuild the palette** — `node scripts/assign_line_colors.mjs
     --regenerate-all` (deterministic, about a minute). Every line is
     recolored, so the golden manifest and every visual baseline change.

   The search treats the test's gates as hard floors (`DELTA_E_FLOORS`), so
   either way it lands on a palette that clears them whenever one is within
   its reach. CI fails on a missing palette entry, so skipping this step cannot
   ship.

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

6b. Re-check what PINS the dataset's shape. A feed change legitimately moves
   three expectations — and only these three — and each of them fails CI if it
   ships stale; this is what left `main` red on 2026-08-22:

   ```bash
   npm test                                 # frozen cardinalities (lines / variants / stops)
   UPDATE_GOLDEN=1 npx playwright test render-sweep
   npx playwright test tests/e2e/visual.spec.js --update-snapshots=all
   ```

   The frozen counts in `tests/js/route-invariants.test.js` are the canary for
   "the dataset changed", so they are updated deliberately, with the numbers the
   fetch just printed. Pixel baselines are per platform: regenerating them here
   only covers the platform you are on, and the other one needs the CI-artifact
   round-trip below.

   Nothing else is frozen. Every other expectation that is a fact about the feed
   — the lines calling at the reference stops 4772 and 4018, the network's line
   list, line 104's destinations — is read from `routes.json` / `stops.json`
   inside the test, so it follows the data with no edit. (Read from the raw
   files, not the app's indexes, so it still catches a code regression. Until
   2026-10-09 these were literals, and a clean update kept failing after the
   refresh as if the app had broken.) So once the three steps above pass, a
   failing test is not the feed moving — with one exception: a test built around
   a particular stop, line or headsign (the `102` chip at stop 4772, line 104's
   "Pocitos") fails when the feed retires it. The test names its fixture; move
   it to another one rather than deleting it.

7. Commit and push (push to `main` **is** the production deploy — GitHub Pages
   rebuilds automatically; CI validates the data again on the push):

   ```bash
   git add routes.json stops.json src/line-colors.js qa/reports/line-colors-report.md qa/reports/geometry-scales-report.md qa/reports/journey-planner-report.md qa/reports/route-geometry-oracles-report.md tests/js/route-invariants.test.js tests/e2e/golden/render-manifest.json tests/e2e/__screenshots__
   git commit -m "Update bus routes and stops data from API"
   git push
   ```

   If the pixel baselines moved and you are not on Linux, delete the
   `*-linux.png` baselines before pushing: the first CI run then writes them and
   uploads them as the `screenshot-baselines` artifact, you commit its images,
   and the run after that is green.

### The wrapper

`./update_and_push.sh` does all of the above in one go, and refuses to publish
when a gate fails — the point being that a surprise stops the update instead of
turning up in CI:

```bash
./update_and_push.sh                          # fetch → gate → publish
./update_and_push.sh --refresh-expectations   # …and refresh what the data legitimately moved
```

- It publishes nothing when the feed's FEATURES are unchanged; a fresh
  `generated_at` alone is not a reason to redeploy.
- It regenerates and ships what is a pure function of the data: the palette
  (step 3, Prettier-formatted so `format:check` stays green) and the four
  measurement reports (steps 3-5).
- It runs `npm test` and the full Playwright suite (`SKIP_E2E=1` opts out and
  says so). Without `--refresh-expectations` a failure prints the exact commands
  from step 6b and exits before the commit; with it, the frozen counts, the
  golden manifest and this platform's baselines are refreshed from the new data,
  the suites are re-run, and only what the script itself refreshed joins the
  commit. If regenerating the golden or the baselines fails in its own right, it
  stops there and says which. On a non-Linux machine it also drops the linux
  baselines and reminds you about the artifact round-trip.
- `DRY_RUN=1` stops after staging and prints what would ship; `SKIP_FETCH=1`
  gates the files already on disk.

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
| `verify:colors`: `A vs B (smallest shared stop: N lines) too close` | the feed changed which lines share a stop, or a new line landed where the incremental mode can't serve it | step 3: never lower the gate; the owner picks a one-line recolor or `--regenerate-all` |
| `unrelated staged changes present; refusing to commit` (wrapper) | something else was `git add`ed before running `update_and_push.sh` | `git restore --staged <path>` and re-run — the wrapper publishes data files only |
| `unit suite failed on the new data` / `e2e failed on the new data` (wrapper) | the frozen counts, the golden manifest or a pixel baseline still describe the old dataset | check the printed diff is just the feed moving, then re-run with `--refresh-expectations` |
| `still failing after refreshing the expectations` (wrapper) | the failure is not the dataset moving — or the feed retired a test's fixture (step 6b) | read the suite output; a retired fixture is named by its test — move the test to another one. Anything else: do not publish |
| `the golden manifest could not be regenerated` / `the pixel baselines could not be refreshed` (wrapper) | render-sweep or a visual scene fails on the new data for a reason other than the expectation being refreshed | read the Playwright output above the error; do not publish |
| `on branch 'x', expected 'main'` (wrapper) | publishing from a feature branch | check out `main`, or set `TARGET_BRANCH` deliberately |
