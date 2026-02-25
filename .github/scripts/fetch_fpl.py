"""
fetch_fpl.py
Fetches data for FPL league 2409531 and writes fpl/data.json.
Run locally or via GitHub Actions.
"""

import json
import time
from datetime import datetime, timezone

import requests

# ── Config ────────────────────────────────────────────────────────────────────

LEAGUE_ID = 2409531
BASE      = "https://fantasy.premierleague.com/api"
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


def chips_remaining(chips_used: list[dict], current_gw: int | None) -> list[str]:
    """
    Compute chips remaining for the CURRENT half of the season.

    Rules used here:
    - Each chip (wildcard, freehit, bboost, 3xc) can be used once per half-season.
      That is, one use in GW 1-19 and one use in GW 20-38.
    - We count only uses that occurred within the same half as `current_gw`.

    `chips_used` is the raw list from the entry history `chips` field; each
    item typically has a `name` and `event` (GW number) that we use to place
    the use into the correct half. If `event` is missing we conservatively
    treat it as having been used earlier in the season (reducing availability).
    """

    # Determine current half (1 = GWs 1-19, 2 = GWs 20+). If unknown, assume 1.
    half = 1
    try:
        if current_gw and int(current_gw) >= 20:
            half = 2
    except Exception:
        half = 1

    # Allowed uses per chip per half
    allowed_per_half = {
        'wildcard': 1,
        'freehit':  1,
        'bboost':   1,
        '3xc':      1,
    }

    # Count uses in the same half
    used_counts: dict[str, int] = {}
    for c in chips_used or []:
        name = c.get('name') if isinstance(c, dict) else c
        if not name:
            continue
        # determine which GW this use happened in
        ev = None
        if isinstance(c, dict):
            ev = c.get('event') or c.get('gw') or c.get('deadline_event')
        # If we have an event number, check which half it belongs to
        in_same_half = True
        try:
            if ev is not None:
                evn = int(ev)
                if half == 1 and evn >= 20:
                    in_same_half = False
                if half == 2 and evn <= 19:
                    in_same_half = False
        except Exception:
            # if parsing fails, assume it was in this half to be conservative
            in_same_half = True

        if in_same_half:
            used_counts[name] = used_counts.get(name, 0) + 1
        else:
            # ignore uses from the other half
            pass

    remaining: list[str] = []
    for chip, allowed in allowed_per_half.items():
        left = max(0, allowed - used_counts.get(chip, 0))
        remaining.extend([chip] * left)

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

    # Fallback: use last finished GW if no current one found
    if current_gw is None:
        for event in reversed(bootstrap["events"]):
            if event["finished"]:
                current_gw  = event["id"]
                gw_finished = True
                break

    print(f"  → GW {current_gw}  (finished={gw_finished})")

    players: dict[int, str] = {
        p["id"]: f"{p['first_name']} {p['second_name']}"
        for p in bootstrap["elements"]
    }

    # 2. League standings (handle pagination for large leagues)
    print(f"Fetching league {LEAGUE_ID} standings …")
    entries: list[dict] = []
    page = 1
    while True:
        data    = fetch(f"{BASE}/leagues-classic/{LEAGUE_ID}/standings/?page_standings={page}")
        results = data["standings"]["results"]
        entries.extend(results)
        if not data["standings"]["has_next"]:
            break
        page += 1

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
        chips_left       = chips_remaining(used_chips_raw, current_gw)
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
