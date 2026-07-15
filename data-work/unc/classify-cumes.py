#!/usr/bin/env python3
"""UNC gap years: classify every archived page in the old official football
stats/archive dirs, to FIND the season cumes.

Usage:  python3 data-work/unc/classify-cumes.py

Input:  data-work/unc/cdx-candidates.txt  (CDX: "<original-url> <timestamp>")
Output: data-work/unc/cume-scan.jsonl     (one line per page, incrementally —
        so a throttled/killed run RESUMES instead of starting over)
        data-work/unc/cume-candidates.json (the pages that carry a defensive
        table, with the season + printed scope)

Two Wayback gotchas, both of which cost real time on this school:
  * CDX prints the host with an explicit ":80" port; Wayback 404s that form —
    strip it before building the snapshot URL.
  * A plain /web/<ts>/<url> fetch returns the Wayback INTERSTITIAL page, not
    the archived bytes. The "id_" suffix (/web/<ts>id_/<url>) returns the raw
    original.

Season assignment uses the page's PRINTED scope ("FINAL STATS" / "as of
Dec 01, 2001"), never the capture date — a mid-season capture of a cume is the
classic trap (the Pitt lesson).
"""

import gzip
import json
import os
import re
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CANDS = os.path.join(HERE, "cdx-candidates.txt")
SCAN = os.path.join(HERE, "cume-scan.jsonl")
OUT = os.path.join(HERE, "cume-candidates.json")

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def get(url, tries=3):
    for i in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            raw = urllib.request.urlopen(req, timeout=60).read()
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            return raw.decode("utf-8", "replace")
        except Exception:
            if i == tries:
                raise
            time.sleep(4 * i)


def main():
    cands = []
    for line in open(CANDS):
        p = line.split()
        if len(p) == 2 and p[0].endswith(".html"):
            cands.append((p[0].replace(":80/", "/"), p[1]))

    done = {}
    if os.path.exists(SCAN):
        for line in open(SCAN):
            try:
                r = json.loads(line)
                done[r["url"]] = r
            except Exception:
                pass
    print(f"candidates: {len(cands)} | already scanned: {len(done)}", flush=True)

    with open(SCAN, "a") as log:
        for url, ts in cands:
            if url in done:
                continue
            snap = f"http://web.archive.org/web/{ts}id_/{url}"
            rec = {"url": url, "ts": ts, "snapshot": snap}
            try:
                html = get(snap)
            except Exception as e:
                rec["error"] = f"{type(e).__name__}"
                log.write(json.dumps(rec) + "\n")
                log.flush()
                continue
            t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))
            rec["hasDefense"] = "Overall Defensive Statistics" in t
            m = re.search(
                r"\((FINAL STATS|as of ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}))\)", t
            )
            rec["scope"] = m.group(1) if m else None
            season = None
            if m and m.group(4):
                y = int(m.group(4))
                season = y - 1 if MONTHS.index(m.group(2)) <= 5 else y
            elif "teamcume-02" in url:
                season = 2002
            rec["season"] = season
            log.write(json.dumps(rec) + "\n")
            log.flush()
            if rec["hasDefense"] and season:
                print(f"  {season}: {rec['scope']} | {url.split('/')[-1]}", flush=True)
            time.sleep(0.3)

    # keep the LATEST-SCOPE cume per season
    best = {}
    for line in open(SCAN):
        r = json.loads(line)
        if not r.get("hasDefense") or not r.get("season"):
            continue

        def score(x):
            if x.get("scope") == "FINAL STATS":
                return float("inf")
            m = re.match(r"as of ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})", x.get("scope") or "")
            if not m:
                return 0
            return (
                int(m.group(3)) * 400 + MONTHS.index(m.group(1)) * 32 + int(m.group(2))
            )

        s = r["season"]
        if s not in best or score(r) > score(best[s]):
            best[s] = r
    json.dump(
        {str(k): best[k] for k in sorted(best)}, open(OUT, "w"), indent=1
    )
    print("\nfinal cume per season:", flush=True)
    for s in sorted(best):
        print(f"  {s}: {best[s]['scope']} {best[s]['url']}", flush=True)


if __name__ == "__main__":
    main()
