/**
 * fpl-worker.js
 *
 * Cloudflare Worker that produces the dashboard's data.json.
 *
 * Why this exists: GitHub Actions' cron is delivered every two to five hours in
 * practice, however often you ask for it, so the committed data.json went stale
 * during matches. A Worker cron trigger fires on time, so this does the same job
 * as .github/scripts/fetch_fpl.py and serves the result over HTTP with CORS.
 *
 * Shape of the response is identical to fpl/data.json, so the dashboard can read
 * either source.
 *
 * Bindings expected:
 *   FPL_KV   KV namespace, holds the last built payload and the bootstrap cache
 * Cron trigger:
 *   the schedule you set in the dashboard, e.g. every 3 minutes
 */

const LEAGUE_ID = 53413;                                  // FTV Helios (2026/27)
const BASE = 'https://fantasy.premierleague.com/api';

// Display order for the "chips left" badges.
const CHIP_ORDER = ['wildcard', 'freehit', 'bboost', '3xc'];

const KV_PAYLOAD = 'payload';
const KV_BOOTSTRAP = 'bootstrap-facts';

// bootstrap-static is 1.7MB and parsing it is the most expensive thing we do, so
// the handful of facts we need from it are cached. is_current/finished only flip
// a couple of times a day, so a few minutes of staleness costs nothing.
const BOOTSTRAP_TTL_MS = 10 * 60 * 1000;

// Freshness is driven by the dashboard's own polling rather than a cron trigger:
// a request for a payload older than these windows rebuilds it first. The TV
// polls every 60s during a match, so a 90s window puts the numbers within about
// two minutes of the FPL app; when nothing is in play there is nothing to chase.
// A cron trigger is optional and simply keeps the payload warm when nobody is
// watching (see scheduled() below).
const STALE_LIVE_MS = 90 * 1000;
const STALE_IDLE_MS = 10 * 60 * 1000;

// FPL is fine with a burst from one client, but there is no reason to open 24
// sockets at once either.
const CONCURRENCY = 6;

const HEADERS = {
  'User-Agent': 'fpl-helios-dashboard (+https://github.com/LucasDGK/lucasdgk.github.io)',
  Accept: 'application/json',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

/** Run `fn` over `items` a few at a time, preserving order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Availability window per chip, covering `currentGw`.
 *
 * bootstrap-static's `chips` array lists one entry per allowed use, so in
 * 2026/27 there are two `wildcard` entries (GWs 2-19 and 20-38). Reading the
 * windows from the API means a future rule change needs no code change. A chip
 * whose window has not opened yet is reported against its next window, since
 * the manager still holds it.
 *
 * Returns { chipName: [allowedUses, windowStart, windowStop] }.
 */
function chipWindows(chipDefs, currentGw) {
  const refGw = currentGw ? Number(currentGw) : 1;

  const windows = {};
  const upcoming = {};

  for (const c of chipDefs ?? []) {
    const name = c?.name;
    if (!name) continue;
    const start = c.start_event || 1;
    const stop = c.stop_event || 38;

    if (start <= refGw && refGw <= stop) {
      const [allowed, wStart, wStop] = windows[name] ?? [0, start, stop];
      windows[name] = [allowed + 1, Math.min(wStart, start), Math.max(wStop, stop)];
    } else if (start > refGw) {
      // Keep only the earliest future window for this chip.
      const known = upcoming[name];
      if (!known || start < known[1]) upcoming[name] = [1, start, stop];
    }
  }

  for (const [name, window] of Object.entries(upcoming)) {
    if (!(name in windows)) windows[name] = window;
  }

  if (Object.keys(windows).length === 0) {
    // Fallback: one use of each chip per half-season (GWs 1-19, 20-38).
    const half = refGw <= 19 ? [1, 19] : [20, 38];
    for (const chip of CHIP_ORDER) windows[chip] = [1, ...half];
  }

  return windows;
}

/**
 * Chips a manager still holds in the current window.
 *
 * `chipsUsed` is the raw `chips` list from the entry history endpoint. A use
 * with no event is counted against the current window, which conservatively
 * reduces availability.
 */
function chipsRemaining(chipsUsed, currentGw, chipDefs) {
  const windows = chipWindows(chipDefs, currentGw);

  const usedCounts = {};
  for (const c of chipsUsed ?? []) {
    const name = typeof c === 'string' ? c : c?.name;
    if (!name || !(name in windows)) continue;

    const ev = typeof c === 'object' ? (c.event ?? c.gw ?? c.deadline_event) : null;
    const [, wStart, wStop] = windows[name];

    let inWindow = true;
    if (ev != null) {
      const n = Number(ev);
      inWindow = Number.isNaN(n) ? true : wStart <= n && n <= wStop;
    }

    if (inWindow) usedCounts[name] = (usedCounts[name] ?? 0) + 1;
  }

  // Known chips first, in display order; anything new the API adds follows.
  const ordered = [
    ...CHIP_ORDER.filter(c => c in windows),
    ...Object.keys(windows).filter(c => !CHIP_ORDER.includes(c)),
  ];

  const remaining = [];
  for (const chip of ordered) {
    const allowed = windows[chip][0];
    const left = Math.max(0, allowed - (usedCounts[chip] ?? 0));
    for (let i = 0; i < left; i++) remaining.push(chip);
  }

  return remaining;
}

/** Assign gw_rank in place, with tied scores sharing a rank. */
function gwRankWithTies(stats) {
  stats.sort((a, b) => b.gw_points - a.gw_points);
  let rank = 1;
  stats.forEach((s, i) => {
    if (i > 0 && s.gw_points < stats[i - 1].gw_points) rank = i + 1;
    s.gw_rank = rank;
  });
}

/**
 * Whether points can currently move, and when they next can.
 *
 * A fixture counts as live from kick-off until the API marks it
 * `finished_provisional`, which is when its points stop moving. The lookahead
 * spills into the next gameweek on purpose: between the last match of one GW
 * and the next GW's first kick-off, the current GW has no unstarted fixtures,
 * and without this the dashboard would never know a match was about to start.
 */
async function matchState(currentGw, nextGw) {
  if (!currentGw) return { matches_live: false, next_kickoff: null };

  const kickoffsAfterNow = fixtures => {
    const now = Date.now();
    return fixtures
      .filter(f => f.kickoff_time && !f.started && Date.parse(f.kickoff_time) > now)
      .map(f => f.kickoff_time)
      .sort();
  };

  let fixtures;
  try {
    fixtures = await getJson(`/fixtures/?event=${currentGw}`);
  } catch (err) {
    console.log(`fixtures unavailable: ${err.message}`);
    return { matches_live: false, next_kickoff: null };
  }

  const live = fixtures.some(f => f.started && !f.finished_provisional);
  let upcoming = kickoffsAfterNow(fixtures);

  if (upcoming.length === 0 && nextGw && nextGw !== currentGw) {
    try {
      upcoming = kickoffsAfterNow(await getJson(`/fixtures/?event=${nextGw}`));
    } catch (err) {
      console.log(`next-gw fixtures unavailable: ${err.message}`);
    }
  }

  return { matches_live: live, next_kickoff: upcoming[0] ?? null };
}

/** Events, chip definitions and the player id → name map, cached in KV. */
async function bootstrapFacts(env) {
  const cached = await env.FPL_KV.get(KV_BOOTSTRAP, 'json');
  if (cached && Date.now() - cached.cached_at < BOOTSTRAP_TTL_MS) return cached;

  const bootstrap = await getJson('/bootstrap-static/');

  const facts = {
    cached_at: Date.now(),
    events: bootstrap.events.map(e => ({
      id: e.id,
      deadline_time: e.deadline_time,
      is_current: e.is_current,
      finished: e.finished,
    })),
    chips: bootstrap.chips ?? [],
    players: Object.fromEntries(
      bootstrap.elements.map(p => [p.id, `${p.first_name} ${p.second_name}`]),
    ),
  };

  await env.FPL_KV.put(KV_BOOTSTRAP, JSON.stringify(facts));
  return facts;
}

// ── Payload ──────────────────────────────────────────────────────────────────

async function buildPayload(env) {
  const { events, chips: chipDefs, players } = await bootstrapFacts(env);

  let currentGw = null;
  let gwFinished = false;
  for (const e of events) {
    if (e.is_current) {
      currentGw = e.id;
      gwFinished = e.finished;
      break;
    }
  }

  // Next deadline: the first event whose deadline is still in the future.
  let nextDeadline = null;
  let nextGw = null;
  const now = Date.now();
  for (const e of events) {
    if (e.deadline_time && Date.parse(e.deadline_time) > now) {
      nextDeadline = e.deadline_time;
      nextGw = e.id;
      break;
    }
  }

  // Fall back to the last finished GW if none is current.
  if (currentGw === null) {
    for (const e of [...events].reverse()) {
      if (e.finished) {
        currentGw = e.id;
        gwFinished = true;
        break;
      }
    }
  }

  // Pre-season: no event is current and none has finished yet.
  const preseason = currentGw === null;

  const { matches_live, next_kickoff } = await matchState(currentGw, nextGw);

  // League standings, paginated for large leagues.
  let entries = [];
  let newEntries = [];
  for (let page = 1; ; page++) {
    const data = await getJson(`/leagues-classic/${LEAGUE_ID}/standings/?page_standings=${page}`);
    entries.push(...data.standings.results);
    if (page === 1) newEntries = data.new_entries?.results ?? [];
    if (!data.standings.has_next) break;
  }

  // Before GW1 is scored, `standings.results` is empty and members only appear
  // under `new_entries`. Synthesise zeroed rows so the league shows up anyway.
  if (entries.length === 0 && newEntries.length > 0) {
    entries = [...newEntries]
      .sort((a, b) => String(a.joined_time ?? '').localeCompare(String(b.joined_time ?? '')))
      .map((ne, i) => ({
        entry: ne.entry,
        entry_name: ne.entry_name || 'Unknown',
        player_name: `${ne.player_first_name ?? ''} ${ne.player_last_name ?? ''}`.trim() || 'Unknown',
        rank: i + 1,
        last_rank: 0,
        total: 0,
        event_total: 0,
      }));
  }

  const perEntry = await mapLimit(entries, CONCURRENCY, async entry => {
    const eid = entry.entry;

    const history = await getJson(`/entry/${eid}/history/`);
    const usedChipsRaw = history.chips ?? [];
    const usedChips = usedChipsRaw.map(c => (typeof c === 'string' ? c : c?.name));
    const chipsLeft = chipsRemaining(usedChipsRaw, currentGw, chipDefs);

    let gwTransferCost = 0;
    let gwTransferCount = 0;
    const gwHistory = [];
    const cumulativeHistory = [];
    let running = 0;

    for (const gw of history.current ?? []) {
      const hit = gw.event_transfers_cost ?? 0;
      const netPts = gw.points - hit;
      running += netPts;

      gwHistory.push({ gw: gw.event, points: netPts });
      cumulativeHistory.push({ gw: gw.event, total: running });

      if (gw.event === currentGw) {
        gwTransferCost = hit;
        gwTransferCount = gw.event_transfers ?? 0;
      }
    }

    // The entry history endpoint only settles a gameweek once it is scored:
    // while a GW is live its `points` stay 0, whereas the standings
    // (`event_total` / `total`, both net of hits) update in near real time.
    // Overwrite the live GW from the standings so the chart cannot lag the
    // tables. Assigning rather than accumulating keeps this idempotent.
    if (currentGw) {
      const liveNet = entry.event_total;
      const liveTotal = entry.total;

      const netRow = gwHistory.find(r => r.gw === currentGw);
      if (netRow) netRow.points = liveNet;
      else gwHistory.push({ gw: currentGw, points: liveNet });

      const totalRow = cumulativeHistory.find(r => r.gw === currentGw);
      if (totalRow) totalRow.total = liveTotal;
      else cumulativeHistory.push({ gw: currentGw, total: liveTotal });
    }

    // Active chip this GW. The history `chips` list already records the chip
    // against the gameweek it was played in, and it matches the picks endpoint's
    // `active_chip` for the live gameweek, so there is no need to ask for picks.
    const chipThisGw = currentGw
      ? (usedChipsRaw.find(c => c?.event === currentGw)?.name ?? null)
      : null;

    // Transfers made for the current GW. History reports how many there were, so
    // managers who sat the gameweek out cost us nothing.
    let tIn = [];
    let tOut = [];
    if (currentGw && gwTransferCount > 0) {
      try {
        const all = await getJson(`/entry/${eid}/transfers/`);
        const gwT = all.filter(t => t.event === currentGw);
        tIn = gwT.map(t => players[t.element_in] ?? 'Unknown');
        tOut = gwT.map(t => players[t.element_out] ?? 'Unknown');
      } catch (err) {
        console.log(`[${eid}] transfers unavailable: ${err.message}`);
      }
    }

    return {
      standing: {
        rank: entry.rank,
        last_rank: entry.last_rank,
        entry_id: eid,
        team_name: entry.entry_name,
        player_name: entry.player_name,
        total_points: entry.total,
        event_total: entry.event_total,
        chips_used: usedChips,
        chips_remaining: chipsLeft,
        gw_history: gwHistory,
        cumulative_history: cumulativeHistory,
      },
      gwStat: {
        entry_id: eid,
        team_name: entry.entry_name,
        player_name: entry.player_name,
        gw_points: entry.event_total,
        chip_used: chipThisGw,
      },
      transfers: {
        entry_id: eid,
        team_name: entry.entry_name,
        player_name: entry.player_name,
        transfers_in: tIn,
        transfers_out: tOut,
        transfer_cost: gwTransferCost,
      },
    };
  });

  const gwStats = perEntry.map(r => r.gwStat);
  gwRankWithTies(gwStats);

  return {
    meta: {
      updated_at: new Date().toISOString(),
      current_gameweek: currentGw,
      gameweek_finished: gwFinished,
      preseason,
      next_deadline: nextDeadline,
      next_gw: nextGw,
      matches_live,
      next_kickoff,
    },
    standings: perEntry.map(r => r.standing),
    current_gw_stats: gwStats,
    transfers: perEntry.map(r => r.transfers),
  };
}

async function refresh(env) {
  const payload = await buildPayload(env);
  await env.FPL_KV.put(KV_PAYLOAD, JSON.stringify(payload));
  console.log(
    `refreshed: GW ${payload.meta.current_gameweek}, ` +
    `live=${payload.meta.matches_live}, teams=${payload.standings.length}`,
  );
  return payload;
}

// ── Handlers ─────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The dashboard polls with a cache-buster; nothing here should be held.
      'cache-control': 'no-store',
      ...CORS,
    },
  });
}

export default {
  // Optional. Nothing depends on it: the fetch handler rebuilds stale payloads on
  // demand. Add a cron trigger only to keep the data warm while the TV is off.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refresh(env));
  },

  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      const stored = await env.FPL_KV.get(KV_PAYLOAD, 'json');
      return json({
        ok: true,
        has_payload: Boolean(stored),
        updated_at: stored?.meta?.updated_at ?? null,
      });
    }

    const stored = await env.FPL_KV.get(KV_PAYLOAD, 'json');
    const age = stored?.meta?.updated_at
      ? Date.now() - Date.parse(stored.meta.updated_at)
      : Infinity;
    const staleAfter = stored?.meta?.matches_live ? STALE_LIVE_MS : STALE_IDLE_MS;

    // Serve the stored payload while it is fresh enough; otherwise rebuild now.
    if (stored && age < staleAfter && url.searchParams.get('refresh') !== '1') {
      return json(stored);
    }

    try {
      return json(await refresh(env));
    } catch (err) {
      console.log(`build failed: ${err.message}`);
      // Stale beats nothing on a TV that runs unattended.
      if (stored) return json(stored);
      return json({ error: 'no data available', detail: err.message }, 503);
    }
  },
};
