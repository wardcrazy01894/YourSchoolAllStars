#!/usr/bin/env python3
"""UNC honors: extract the OFFICIAL media guide's honors sections into clean,
column-ordered text (the input for parse-honors-guide.mjs).

Usage:  python3 data-work/unc/extract-honors-guide.py <media-guide.pdf>

Why not plain pdftotext: these pages are 2–3 column layouts. Plain extraction
interleaves the columns (a year's selections get spliced with another year's),
and `-layout` still glues columns side-by-side on one line. So we take word
BOUNDING BOXES (`pdftotext -bbox`), cluster the words into columns by their x
position, and emit each column top-to-bottom, left-to-right — which restores
the reading order the guide actually intends.

Sections (2025 guide):
  pp. 96–99  First-Team All-America Selections  -> honors-src/all-america.txt
  p.  100    National Awards                    -> honors-src/national-awards.txt
  pp. 104–106 All-Conference Selections         -> honors-src/all-conference.txt

The page numbers are asserted by content, not trusted blindly: each output is
checked for its expected heading, so a future guide with different pagination
fails loudly instead of writing the wrong pages.
"""

import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "honors-src")

SECTIONS = [
    # (first, last, out-file, heading that MUST appear)
    (96, 99, "all-america.txt", "ALL-AMERICA"),
    (100, 100, "national-awards.txt", "NATIONAL AWARD"),
    (104, 106, "all-conference.txt", "ALL-CONFERENCE SELECTIONS"),
]


def page_words(pdf, page):
    """[(x0, y0, text)] for one page, via pdftotext -bbox."""
    out = subprocess.run(
        ["pdftotext", "-bbox", "-f", str(page), "-l", str(page), pdf, "-"],
        capture_output=True,
        check=True,
    ).stdout.decode("utf-8", "replace")
    # The guide's copy contains raw '&' and stray entities that make the
    # pdftotext XHTML non-well-formed, so read the <word> elements with a
    # regex instead of a strict XML parse.
    words = []
    for m in re.finditer(
        r'<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>(.*?)</word>', out, re.S
    ):
        t = re.sub(r"\s+", " ", m.group(3)).strip()
        t = (
            t.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
            .replace("&apos;", "'")
        )
        if t:
            words.append((float(m.group(1)), float(m.group(2)), t))
    return words


def columns(words, gap=60.0):
    """Cluster words into columns by x, then read each column top→bottom.

    The column edges come from the x of each visual LINE'S FIRST word, not from
    every word — within a column the words sit at many x offsets, so clustering
    all of them finds no gutters at all (and silently collapses the page to one
    column, splicing three columns' worth of years together).
    """
    if not words:
        return []
    # group words into visual lines by y, and take each line's left edge
    by_line = {}
    for x, y, t in words:
        k = round(y / 3)
        by_line.setdefault(k, []).append(x)
    line_starts = sorted(min(v) for v in by_line.values())
    starts = [line_starts[0]]
    for a, b in zip(line_starts, line_starts[1:]):
        if b - a > gap:
            starts.append(b)
    # assign each word to the rightmost column edge at or left of it
    cols = {s: [] for s in starts}
    for x, y, t in words:
        s = max((s for s in starts if s <= x + 5), default=starts[0])
        cols[s].append((y, x, t))
    lines_out = []
    for s in starts:
        ws = sorted(cols[s])
        line_y, buf = None, []
        for y, x, t in ws:
            if line_y is None or abs(y - line_y) <= 3:
                buf.append(t)
                line_y = y if line_y is None else line_y
            else:
                lines_out.append(" ".join(buf))
                buf, line_y = [t], y
        if buf:
            lines_out.append(" ".join(buf))
    return lines_out


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: extract-honors-guide.py <media-guide.pdf>")
    pdf = sys.argv[1]
    os.makedirs(OUT_DIR, exist_ok=True)
    for first, last, name, heading in SECTIONS:
        lines = []
        for p in range(first, last + 1):
            lines += columns(page_words(pdf, p))
        text = "\n".join(lines)
        if heading not in text.upper():
            sys.exit(
                f"{name}: expected heading {heading!r} not found on pp.{first}-{last} "
                "— the guide's pagination changed; re-check SECTIONS."
            )
        path = os.path.join(OUT_DIR, name)
        with open(path, "w") as f:
            f.write(text + "\n")
        print(f"{name}: {len(lines)} lines (pp.{first}-{last})")


if __name__ == "__main__":
    main()
