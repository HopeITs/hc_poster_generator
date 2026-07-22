#!/usr/bin/env python3
"""Recompute the CSP script hashes in .htaccess from the inline <script> blocks.

CSP allows an inline script by the sha256 of its exact body, so the hashes go
stale the moment the JavaScript in index.html changes -- and a stale hash means
the script is blocked and the app silently stops working. Run this after any
edit to an inline block:

    python tools/csp-hashes.py          # rewrite .htaccess
    python tools/csp-hashes.py --check  # verify only, non-zero exit if stale

Inline event handlers (onclick="...") cannot be hashed at all; they need
'unsafe-inline'. Keep them out of the markup.
"""
import base64
import hashlib
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
HTACCESS = ROOT / ".htaccess"

# Inline blocks only: <script> with no attributes. External <script src=...> is
# covered by the origin in script-src instead.
BLOCK = re.compile(r"<script>(.*?)</script>", re.S)


def hashes():
    src = io.open(HTML, encoding="utf-8").read()
    out = []
    for body in BLOCK.findall(src):
        digest = hashlib.sha256(body.encode("utf-8")).digest()
        out.append("'sha256-" + base64.b64encode(digest).decode() + "'")
    return out


def main():
    check = "--check" in sys.argv
    found = hashes()
    if not found:
        print("no inline <script> blocks found -- check the regex", file=sys.stderr)
        return 1

    conf = io.open(HTACCESS, encoding="utf-8").read()
    directive = "script-src 'self' " + " ".join(found) + ";"
    updated, n = re.subn(r"script-src [^;]*;", directive, conf)
    if n != 1:
        print("expected exactly one script-src in .htaccess, found %d" % n, file=sys.stderr)
        return 1

    if updated == conf:
        print("up to date (%d inline block(s))" % len(found))
        return 0
    if check:
        print("STALE: .htaccess hashes do not match index.html", file=sys.stderr)
        return 1

    io.open(HTACCESS, "w", encoding="utf-8", newline="").write(updated)
    print("updated .htaccess with %d hash(es):" % len(found))
    for h in found:
        print("  " + h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
