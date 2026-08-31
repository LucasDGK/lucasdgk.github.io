"""
fetch_fpl.py
Fetches data for FPL league 53413 (FTV Helios) and writes fpl/data.json.
Run locally or via GitHub Actions.
"""

import json
import time
from datetime import datetime, timezone

import requests

# ── Config ────────────────────────────────────────────────────────────────────

LEAGUE_ID = 53413          # FTV Helios (2026/27)
BASE      = "https://fantasy.premierleague.com/api"

# Display order for the "chips left" badges.
CHIP_ORDER = ["wildcard", "freehit", "bboost", "3xc"]
HEADERS   = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def fetch(url: str) -> dict:
    """GET a URL with a small polite delay and return parsed JSON."""
    time.sleep(0.5)
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def match_state(current_gw: int | None) -> tuple[bool, str | None]:
    """
    Return (matches_live, next_kickoff) for the current gameweek.

    A fixture counts as live from kick-off until the API marks it
    `finished_provisional`, which is when its points stop moving. Both callers
    of this data (the refresh loop and the dashboard) use it to poll hard only
    while points can actually change.
    """
    if current_gw is None:
        return False, None

    try:
        fixtures = fetch(f"{BASE}/fixtures/?event={current_gw}")
    except Exception as exc:
        print(f"  ⚠ fixtures unavailable: {exc}")
        return False, None

    live = any(f.get("started") and not f.get("finished_provisional") for f in fixtures)

    now = datetime.now(timezone.utc)
    upcoming = sorted(
        f["kickoff_time"] for f in fixtures
        if f.get("kickoff_time") and not f.get("started")
        and datetime.fromisoformat(f["kickoff_time"].replace("Z", "+00:00")) > now
    )

    print(f"  → matches_live={live}, next_kickoff={upcoming[0] if upcoming else None}")
    return live, (upcoming[0] if upcoming else None)


def chip_windows(chip_defs: list[dict], current_gw: int | None) -> dict[str, tuple[int, int, int]]:
    """
    Build, per chip name, the availability window that covers `current_gw`.

    `chip_defs` is the `chips` array from bootstrap-static. Each entry has a
    `name`, `start_event` and `stop_event`, and the API lists one entry per
    allowed use — e.g. in 2026/27 there are two `wildcard` entries, one for
    GWs 2-19 and one for GWs 20-38. Reading the windows from the API means a
    future rule change (extra chip, different split) needs no code change.

    Returns  {chip_name: (allowed_uses, window_start, window_stop)}  for the
    windows containing `current_gw`. A chip with no window open right now but
    one opening later (the wildcard cannot be played in GW1, for instance) is
    reported against its next window, since the manager still holds it. Falls
    back to the historical "once per half-season" rule if the API gives us
    nothing usable.
    """
    ref_gw = int(current_gw) if current_gw else 1

    windows: dict[str, tuple[int, int, int]] = {}
    upcoming: dict[str, tuple[int, int, int]] = {}
    for c in chip_defs or []:
        name = c.get("name")
        if not name:
            continue
        start = c.get("start_event") or 1
        stop  = c.get("stop_event") or 38

        if start <= ref_gw <= stop:
            allowed, w_start, w_stop = windows.get(name, (0, start, stop))
            windows[name] = (allowed + 1, min(w_start, start), max(w_stop, stop))
        elif start > ref_gw:
            # Keep only the earliest future window for this chip.
            known = upcoming.get(name)
            if known is None or start < known[1]:
                upcoming[name] = (1, start, stop)

    for name, window in upcoming.items():
        windows.setdefault(name, window)

    if not windows:
        # Fallback: one use of each chip per half-season (GWs 1-19, 20-38).
        half = (1, 19) if ref_gw <= 19 else (20, 38)
        windows = {chip: (1, *half) for chip in CHIP_ORDER}

    return windows


def chips_remaining(
    chips_used: list[dict],
    current_gw: int | None,
    chip_defs: list[dict],
) -> list[str]:
    """
    Compute the chips a manager still has available in the current window.

    `chips_used` is the raw list from the entry history `chips` field; each
    item has a `name` and `event` (GW number) used to place the use inside a
    window. A use with no event is counted against the current window, which
    conservatively reduces availability.
    """
    windows = chip_windows(chip_defs, current_gw)

    used_counts: dict[str, int] = {}
    for c in chips_used or []:
        name = c.get("name") if isinstance(c, dict) else c
        if not name or name not in windows:
            continue

        ev = None
        if isinstance(c, dict):
            ev = c.get("event") or c.get("gw") or c.get("deadline_event")

        _, w_start, w_stop = windows[name]
        in_window = True
        if ev is not None:
            try:
                in_window = w_start <= int(ev) <= w_stop
            except (TypeError, ValueError):
                in_window = True

        if in_window:
            used_counts[name] = used_counts.get(name, 0) + 1

    # Known chips first, in display order; anything new the API adds follows.
    ordered = [c for c in CHIP_ORDER if c in windows]
    ordered += [c for c in windows if c not in CHIP_ORDER]

    remaining: list[str] = []
    for chip in ordered:
        allowed = windows[chip][0]
        remaining.extend([chip] * max(0, allowed - used_counts.get(chip, 0)))

    return remaining


def gw_rank_with_ties(stats: list[dict]) -> None:
    """Assign gw_rank in-place, with tied scores sharing the same rank."""
    stats.sort(key=lambda x: x["gw_points"], reverse=True)
    rank = 1
    for i, s in enumerate(stats):
        if i > 0 and s["gw_points"] < stats[i - 1]["gw_points"]:
            rank = i + 1
        s["gw_rank"] = rank


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    # 1. Bootstrap — gives current GW and the player→name map
    print("Fetching bootstrap-static …")
    bootstrap = fetch(f"{BASE}/bootstrap-static/")

    current_gw: int | None = None
    gw_finished = False

    for event in bootstrap["events"]:
        if event["is_current"]:
            current_gw   = event["id"]
            gw_finished  = event["finished"]
            break

    # Find next gameweek deadline — first event whose deadline is still in the future
    next_deadline: str | None = None
    next_gw: int | None = None
    now = datetime.now(timezone.utc)
    for event in bootstrap["events"]:
        dl = event.get("deadline_time")
        if dl and datetime.fromisoformat(dl.replace("Z", "+00:00")) > now:
            next_deadline = dl
            next_gw = event["id"]
            break

    # Fallback: use last finished GW if no current one found
    if current_gw is None:
        for event in reversed(bootstrap["events"]):
            if event["finished"]:
                current_gw  = event["id"]
                gw_finished = True
                break

    # Pre-season: no event is current and none has finished yet.
    preseason = current_gw is None
    print(f"  → GW {current_gw}  (finished={gw_finished}, preseason={preseason})")

    matches_live, next_kickoff = match_state(current_gw)

    chip_defs: list[dict] = bootstrap.get("chips", [])

    players: dict[int, str] = {
        p["id"]: f"{p['first_name']} {p['second_name']}"
        for p in bootstrap["elements"]
    }

    # 2. League standings (handle pagination for large leagues)
    print(f"Fetching league {LEAGUE_ID} standings …")
    entries: list[dict] = []
    new_entries: list[dict] = []
    page = 1
    while True:
        data    = fetch(f"{BASE}/leagues-classic/{LEAGUE_ID}/standings/?page_standings={page}")
        results = data["standings"]["results"]
        entries.extend(results)
        if page == 1:
            new_entries.extend(data.get("new_entries", {}).get("results", []))
        if not data["standings"]["has_next"]:
            break
        page += 1

    # Before the first gameweek is scored, `standings.results` is empty and the
    # league members are only listed under `new_entries`. Synthesise zeroed
    # standings rows from them so the dashboard shows the league right away.
    if not entries and new_entries:
        print(f"  → standings empty, using {len(new_entries)} new entries")
        entries = [
            {
                "entry":        ne["entry"],
                "entry_name":   ne.get("entry_name") or "Unknown",
                "player_name":  f"{ne.get('player_first_name', '')} "
                                f"{ne.get('player_last_name', '')}".strip() or "Unknown",
                "rank":         i + 1,
                "last_rank":    0,
                "total":        0,
                "event_total":  0,
            }
            for i, ne in enumerate(
                sorted(new_entries, key=lambda e: e.get("joined_time") or "")
            )
        ]

    print(f"  → {len(entries)} teams")

    standings:    list[dict] = []
    gw_stats:     list[dict] = []
    transfers_out: list[dict] = []

    # 3. Per-entry details
    for entry in entries:
        eid         = entry["entry"]
        team_name   = entry["entry_name"]
        player_name = entry["player_name"]
        print(f"  Processing  [{eid}]  {team_name}")

        # History: chips used + GW-by-GW points breakdown
        history          = fetch(f"{BASE}/entry/{eid}/history/")
        used_chips_raw   = history.get("chips", [])
        used_chips       = [c.get("name") if isinstance(c, dict) else c for c in used_chips_raw]
        chips_left       = chips_remaining(used_chips_raw, current_gw, chip_defs)
        gw_transfer_cost = 0

        gw_history:     list[dict] = []
        cumulative_hist: list[dict] = []
        running = 0

        for gw_data in history.get("current", []):
            hit     = gw_data.get("event_transfers_cost", 0)
            net_pts = gw_data["points"] - hit
            running += net_pts

            gw_history.append({"gw": gw_data["event"], "points": net_pts})
            cumulative_hist.append({"gw": gw_data["event"], "total": running})

            if gw_data["event"] == current_gw:
                gw_transfer_cost = hit

        # The entry history endpoint only settles a gameweek once it is scored:
        # while a GW is live its `points` stay 0, whereas the league standings
        # (`event_total` / `total`, both net of hits) update in near real time.
        # Overwrite the live GW from the standings so the chart cannot lag the
        # tables. Assigning rather than accumulating keeps this idempotent.
        if current_gw:
            live_net   = entry["event_total"]
            live_total = entry["total"]

            for row in gw_history:
                if row["gw"] == current_gw:
                    row["points"] = live_net
                    break
            else:
                gw_history.append({"gw": current_gw, "points": live_net})

            for row in cumulative_hist:
                if row["gw"] == current_gw:
                    row["total"] = live_total
                    break
            else:
                cumulative_hist.append({"gw": current_gw, "total": live_total})

        # Active chip this GW (from picks)
        chip_this_gw: str | None = None
        if current_gw:
            try:
                picks        = fetch(f"{BASE}/entry/{eid}/event/{current_gw}/picks/")
                chip_this_gw = picks.get("active_chip")
            except Exception as exc:
                print(f"    ⚠ picks unavailable: {exc}")

        # Transfers for the current GW
        t_in:  list[str] = []
        t_out: list[str] = []
        if current_gw:
            try:
                all_t  = fetch(f"{BASE}/entry/{eid}/transfers/")
                gw_t   = [t for t in all_t if t["event"] == current_gw]
                t_in   = [players.get(t["element_in"],  "Unknown") for t in gw_t]
                t_out  = [players.get(t["element_out"], "Unknown") for t in gw_t]
            except Exception as exc:
                print(f"    ⚠ transfers unavailable: {exc}")

        standings.append({
            "rank":               entry["rank"],
            "last_rank":          entry["last_rank"],
            "entry_id":           eid,
            "team_name":          team_name,
            "player_name":        player_name,
            "total_points":       entry["total"],
            "event_total":        entry["event_total"],
            "chips_used":         used_chips,
            "chips_remaining":    chips_left,
            "gw_history":         gw_history,
            "cumulative_history": cumulative_hist,
        })

        gw_stats.append({
            "entry_id":    eid,
            "team_name":   team_name,
            "player_name": player_name,
            "gw_points":   entry["event_total"],
            "chip_used":   chip_this_gw,
        })

        transfers_out.append({
            "entry_id":      eid,
            "team_name":     team_name,
            "player_name":   player_name,
            "transfers_in":  t_in,
            "transfers_out": t_out,
            "transfer_cost": gw_transfer_cost,
        })

    gw_rank_with_ties(gw_stats)

    # 4. Write output
    output = {
        "meta": {
            "updated_at":       datetime.now(timezone.utc).isoformat(),
            "current_gameweek": current_gw,
            "gameweek_finished": gw_finished,
            "preseason":        preseason,
            "next_deadline":    next_deadline,
            "next_gw":          next_gw,
            "matches_live":     matches_live,
            "next_kickoff":     next_kickoff,
        },
        "standings":        standings,
        "current_gw_stats": gw_stats,
        "transfers":        transfers_out,
    }

    out_path = "fpl/data.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Written to {out_path}")


if __name__ == "__main__":
    main()
