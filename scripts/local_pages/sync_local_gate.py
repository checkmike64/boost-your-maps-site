#!/usr/bin/env python3
"""Copy the local-pages gate from a local ai-skills checkout into this repo (CI can't read the
private skills repo, so the checker runs a vendored copy).

  python3 scripts/local_pages/sync_local_gate.py /path/to/ai-skills            # from that checkout's HEAD
  python3 scripts/local_pages/sync_local_gate.py /path/to/ai-skills --check    # exit 1 if the copy is stale

Copies shared/local-pages/scripts/local_gate.py and shared/local-pages/config.json into
scripts/local_pages/vendor/local-pages/ (same layout as the skill, so the script finds its config) and
writes the source commit on the first line of the vendored script. Commit the result in its own PR.
"""
from __future__ import annotations

import argparse
import datetime as dt
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "scripts" / "local_pages" / "vendor" / "local-pages"
FILES = {"scripts/local_gate.py": "scripts/local_gate.py", "config.json": "config.json"}


def header(sha: str) -> str:
    return (f"# Vendored from Impact-Leads-LLC/ai-skills@{sha} shared/local-pages/scripts/local_gate.py "
            f"({dt.date.today().isoformat()}). Do not edit here: change the skill, then run "
            "scripts/local_pages/sync_local_gate.py.\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("skills", help="path to a local ai-skills checkout")
    ap.add_argument("--check", action="store_true", help="only report whether the vendored copy matches")
    a = ap.parse_args()
    src = Path(a.skills).expanduser().resolve() / "shared" / "local-pages"
    if not (src / "scripts" / "local_gate.py").exists():
        print(f"no shared/local-pages/scripts/local_gate.py under {a.skills}", file=sys.stderr)
        return 2
    sha = subprocess.run(["git", "-C", str(src), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()[:12] or "unknown"
    stale = []
    for rel_src, rel_dest in FILES.items():
        body = (src / rel_src).read_text(encoding="utf-8")
        dest = DEST / rel_dest
        have = dest.read_text(encoding="utf-8") if dest.exists() else ""
        if rel_dest.endswith(".py"):
            have = have.split("\n", 1)[1] if have.startswith("# Vendored from") else have
        if have != body:
            stale.append(rel_dest)
            if not a.check:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text((header(sha) + body) if rel_dest.endswith(".py") else body, encoding="utf-8")
    if a.check:
        print("vendored gate matches ai-skills@" + sha if not stale else "stale: " + ", ".join(stale))
        return 1 if stale else 0
    print(f"synced from ai-skills@{sha}: " + (", ".join(stale) if stale else "already current"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
