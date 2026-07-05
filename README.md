# Montevideo Bus Map

## General information

A map of Montevideo bus lines and stops, available at [https://nikolaikolosov.github.io/montevideo-bus-map/](https://nikolaikolosov.github.io/montevideo-bus-map/).

## Updating the data (manual, by design)

The map renders two generated files: `routes.json` and `stops.json`
(format v2 — see `architecture/contracts/data-contract.md`). They are produced
by `fetch_api_data.py` from the official API (`https://api.montevideo.gub.uy/`).

> **Network requirement:** the API gateway only accepts connections from inside
> Uruguay's network. GitHub-hosted Actions runners (in the US/EU) **cannot**
> reach it, and no UY-based server exists — so the data is updated **manually**
> from a machine with Uruguayan connectivity. The site shows the data's
> generation date ("Datos: …") so staleness is always visible.

Short version (full procedure: `docs/data-update-runbook.md`):

```bash
cp .env.example .env          # once: fill in the API credentials
pip install -r requirements.txt
python fetch_api_data.py      # fetches, rebuilds, validates the contract
git add routes.json stops.json && git commit -m "Update bus data" && git push
```

The script auto-loads `.env`, **fails with a non-zero exit code** on any
auth/network/contract error (instead of silently leaving stale data), and
validates both files against the data contract before writing.
`./update_and_push.sh` wraps fetch + commit + push in one command.
Pushing to `main` triggers the GitHub Pages deploy.

## Development

```bash
npm install        # dev tooling (the app itself is a buildless static site)
npm test           # Vitest unit tests
npm run lint       # ESLint
npm run format     # Prettier
pip install -r requirements-dev.txt
python -m pytest   # pipeline tests
python scripts/validate_data.py  # contract check on the committed data
./serve.sh         # local server at http://127.0.0.1:8765
```

CI (`.github/workflows/ci.yml`) runs all of the above plus pip-audit and a
gitleaks secret scan on every push and pull request.
