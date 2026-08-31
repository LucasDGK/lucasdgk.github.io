"""
should_keep_polling.py
Exits 0 while the refresh loop should keep going, 1 when it should stop.

Points only move while a match is in play, so outside a match window a single
fetch per scheduled run is enough and the runner can be released. Reads the meta
block that fetch_fpl.py just wrote.
"""

import json
import os
import sys
from datetime import datetime, timezone

LOOKAHEAD_MIN = int(os.environ.get("KICKOFF_LOOKAHEAD_MIN", "20"))


def main() -> int:
    try:
        with open("fpl/data.json", encoding="utf-8") as f:
            meta = json.load(f)["meta"]
    except Exception as exc:
        # No usable data: stop looping and let the next scheduled run try again.
        print(f"could not read meta ({exc})")
        return 1

    if meta.get("matches_live"):
        print("a match is in play")
        return 0

    kickoff = meta.get("next_kickoff")
    if kickoff:
        starts_in = (
            datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
            - datetime.now(timezone.utc)
        ).total_seconds()
        if 0 < starts_in <= LOOKAHEAD_MIN * 60:
            print(f"kick-off in {starts_in / 60:.0f} min")
            return 0
        print(f"next kick-off in {starts_in / 60:.0f} min")
    else:
        print("no upcoming fixture this gameweek")

    return 1


if __name__ == "__main__":
    sys.exit(main())
