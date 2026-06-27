# Montevideo Bus Map

## General information

A map of Montevideo bus lines and stops. Created with Google Antigravity and publically available data from Montevideo City Hall. The map is available with MIT license.

## La información general

Un mapa de los ómnibus de Montevideo. Creado con Google Antigravity y datos publicamente disponibles de la Intendencia de Montevideo. El mapa está disponible con licencia MIT.

## Updating the data

The map renders two generated files: `routes.json` and `stops.json`. These are
produced by `fetch_api_data.py` from the official API
(`https://api.montevideo.gub.uy/`).

> **Network requirement:** the API gateway only accepts connections from inside
> Uruguay's network. GitHub-hosted Actions runners (in the US/EU) **cannot**
> reach it, so the update must run from a host with Uruguayan connectivity.

### Automated updates via cron (recommended)

Run the fetch from a UY-based server (or your own machine while on a UY network):

1. `cp .env.example .env` and fill in `API_CLIENT_ID` / `API_CLIENT_SECRET`
   (register at <https://api.montevideo.gub.uy/> to get them). `.env` is
   git-ignored.
2. Ensure `git push` works non-interactively from that host (SSH deploy key with
   write access, or a token).
3. Add a cron entry, e.g. to update every day at 04:00:

   ```cron
   0 4 * * *  /path/to/montevideo-bus-map/update_and_push.sh >> /path/to/update.log 2>&1
   ```

`update_and_push.sh` runs the fetch, and commits + pushes only if the data
changed. Pushing to `main` triggers the existing GitHub Pages deploy, so the
live site updates automatically.

### Running the fetch manually

The script auto-loads the `.env` file next to it, so it works from any shell
(PowerShell, cmd, bash):

```bash
pip install -r requirements.txt
python fetch_api_data.py
```

The script **fails with a non-zero exit code** on any auth/network/data error
(instead of silently leaving stale data), and prints a summary of how many
routes and stops it wrote.
