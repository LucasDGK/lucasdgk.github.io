# FPL data worker

`fpl-worker.js` is a Cloudflare Worker that builds the dashboard's JSON and
serves it with CORS headers.

It rebuilds on demand rather than on a schedule: the dashboard polls it, and any
request for a payload older than the freshness window triggers a rebuild first.
That means no cron trigger to configure. The windows are 90 seconds while a match
is in play and 10 minutes otherwise, so during a match the TV's 60 second polling
keeps the numbers within about two minutes of the official app.

## Why

The dashboard used to read a `data.json` committed by GitHub Actions. GitHub
delivers scheduled workflows every two to five hours in practice, whatever
interval you request (measured over a week: 5 to 6 runs a day against 48
requested), so during a match the numbers were hours old. A Worker cron trigger
fires on time.

This worker is now the dashboard's only data source. The workflow, its
`fetch_fpl.py` script and the committed `data.json` were removed once the worker
was verified to produce identical output, because that fallback shared the same
logic against the same API (so anything FPL-side would have broken both) and the
worker already keeps serving its last good payload from KV when a rebuild fails.
Look in the history before this commit if you need the Python version.

## Setup, entirely in the browser

No CLI or npm needed.

1. **Create the Worker.** dash.cloudflare.com → Workers & Pages → Create →
   Worker. Name it something like `fpl-helios`. Deploy the placeholder.
2. **Paste the code.** Open the Worker → Edit code. Replace everything with the
   contents of `fpl-worker.js`, then Deploy.
3. **Create the KV namespace.** Storage & Databases → KV → Create namespace,
   name it `fpl-helios-kv`.
4. **Bind it.** Worker → Settings → Bindings → Add → KV namespace.
   Variable name must be exactly `FPL_KV`; pick the namespace from step 3. Deploy.
5. **Test it.** The URL is `https://<worker>.<your-subdomain>.workers.dev`, not
   `https://<worker>.workers.dev`: the account subdomain in the middle is
   required. The Worker's overview page and Settings → Domains & Routes both show
   the full address, and that is also where you enable the workers.dev route if it
   is switched off. Open `/data.json` on it. The first request
   builds the payload and takes a second or so; reloading is instant. `/health`
   reports when it was last built, and `?refresh=1` forces a rebuild.
6. **Point the dashboard at it.** Set `WORKER_URL` at the top of
   `fpl/assets/js/app.js` to `https://<worker>.<your-subdomain>.workers.dev/data.json`, then
   commit and push.

No cron trigger is needed. If you want the data kept warm while the TV is off, so
the first morning load is instant, add one later (Worker → Settings → Trigger
Events → Cron Trigger, `*/3 * * * *`); the `scheduled()` handler is already there
and nothing else changes.

## Endpoints

| Path | Purpose |
| --- | --- |
| `/data.json` (or any path) | The dashboard payload. Serves the stored copy, rebuilding first if it is older than 90s during a match or 10 min otherwise. |
| `/data.json?refresh=1` | Force a rebuild. Useful after editing the code. |
| `/health` | Whether a payload exists and when it was built. |

## Cost and limits

One TV polling every 60 seconds is about 1,500 requests a day against a free-plan
allowance of 100,000. Most of those are served straight from KV in about a
millisecond; only the ones that find a stale payload rebuild, roughly every 90
seconds during a match and every 10 minutes otherwise.

Each build makes about 16 upstream calls: fixtures, standings, one `history` per
manager, and one `transfers` only for managers who actually made a transfer this
gameweek. The picks endpoint is not used at all; the active chip is read from the
history's `chips` list, which agrees with `picks.active_chip` for the live
gameweek (verified across the league).

The free plan caps subrequests at 50 per invocation, which leaves room for the
league to roughly triple. If it ever gets there, split the per-manager work
across two invocations via KV.

CPU per build is a few milliseconds: parsing the 1.7MB `bootstrap-static` is the
expensive part, which is why the events, chip rules and player names it yields
are cached in KV for 10 minutes. A warm rebuild takes about 180ms of wall time, a
cold one about 1.3s. If a build ever fails, the previous payload keeps serving and
the next poll retries.

## Local check

`test-local.mjs` runs the worker in node against the live API with a fake KV, no
deploy and no dependencies:

```sh
node worker/test-local.mjs      # builds the payload, then exercises the endpoints
```

It reports the build's wall time, the payload's `meta`, and the responses from
`/data.json`, `/health` and an OPTIONS preflight. There is also a `--compare`
flag that diffs the output against a `fpl/data.json` produced by the old Python
script; it is only useful if you restore that script from history.
