#!/usr/bin/env python3
"""Publish gate for the industry x city local service pages (/google-maps-marketing/<industry>/<city-st>).

Version 2 (2026-11-10): pages are built with ai-skills `shared/local-pages` 2.0. The content gate is
that skill's own `local_gate.py`, vendored in `scripts/local_pages/vendor/local-pages/` (CI can't
read the private skills repo). This script adds the site rules around it.

Runs in CI on every pull request and can be run locally:

  python3 scripts/local_pages/check_local_pages.py                  # check every city page
  python3 scripts/local_pages/check_local_pages.py --base origin/main  # check pages changed vs main
  python3 scripts/local_pages/check_local_pages.py --base origin/main --guard   # + publisher path guard

What it enforces (rules come from local-pages/config.json and the vendored local-pages config):
  data        local-pages/<industry>/<city>/page-data.json exists, matches the page's path, uses the
              owner-report profile, and local_gate.py passes on the page with every other city page as
              a sibling: data floor (G1), sourcing and every number backed by a fact (G2), city swap
              (G3), 5-word overlap with siblings (G4), banned filler (G5), build check (G7), proof
              labels (G8), and the fixed skeleton (slot order and H2 patterns)
  structure   title/meta lengths, canonical, one H1, JSON-LD graph (WebPage, Service, BreadcrumbList,
              FAQPage == visible FAQ), dates match page-data, banned voice terms, CTA text, links,
              images (hero required, uploaded, size and pixel dimensions)
  markup      section wrappers, the hero and closing blocks, the FAQ wrapper, only classes the site
              stylesheet defines, no placeholders
  variety     the FAQ registry (no question repeated from another city page) and sitewide
              boilerplate in the non-fixed text
  wiring      the index and the industry hub exist, the hub links the page, sitemap.xml (with
              lastmod) and llms.txt list it
  governance  publishing not paused (local-pages/config.json). Cadence is advisory and lives in
              ai-skills shared/page-pipeline (cadence.py) and the BYM Team connector, not here
  guard       (--guard) a publisher pull request only touches local-page files

Retired with version 1: the fact sheet (8 facts, ANCHOR), hero angles and snapshot observations, the
module-order fingerprint, the heading registry, the 1,000-1,600 word band (now 600-1,400, a warning
only), the first-batch hold and the monthly cap.
Standard library only. Exit code 1 when anything fails.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "local-pages" / "config.json").read_text(encoding="utf-8"))
T = CONFIG["thresholds"]
ORIGIN = CONFIG["site_origin"]
SECTION = CONFIG["section"]
SITE_KEY = CONFIG.get("site_key", "bym")
PROFILE = "owner-report"
CITY_RE = re.compile(rf"^{SECTION}/([a-z0-9-]+)/([a-z0-9-]+-[a-z]{{2}})\.html$")
VENDOR = ROOT / "scripts" / "local_pages" / "vendor" / "local-pages"
GATE = VENDOR / "scripts" / "local_gate.py"
SIDECARS = ("page-data.json", "snapshot.json", "images.md")
STOP = set("a an the and or of for to in on at by with your our you we us is are it its this that from how "
           "what why when who which do does can be".split())
MONTHS = "January February March April May June July August September October November December".split()


# ---------------------------------------------------------------- git helpers
def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def changed_files(base: str) -> dict[str, str]:
    out = git("diff", "--name-status", "--no-renames", f"{base}...HEAD")
    result = {}
    for line in out.splitlines():
        status, _, path = line.partition("\t")
        result[path] = status[0]
    return result


def base_text(base: str, path: str) -> str | None:
    try:
        return git("show", f"{base}:{path}")
    except subprocess.CalledProcessError:
        return None


def base_city_pages(base: str) -> list[str]:
    out = git("ls-tree", "-r", "--name-only", base, f"{SECTION}/")
    return [p for p in out.splitlines() if CITY_RE.match(p)]


# ---------------------------------------------------------------- page parsing
def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", s))


def squash(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def main_html(src: str) -> str:
    m = re.search(r"<main\b.*?</main>", src, re.S)
    return m.group(0) if m else ""


def authored_html(main: str) -> str:
    """Main content minus generated blocks (form, image markup) and comments."""
    m = re.sub(r"<!--\s*generated:start.*?generated:end\s*-->", " ", main, flags=re.S)
    m = re.sub(r"<select\b.*?</select>", " ", m, flags=re.S)
    return re.sub(r"<!--.*?-->", " ", m, flags=re.S)


def written_html(main: str) -> str:
    """The page's own writing: authored content minus fixed blocks (offer, report line, CTA) and headings."""
    m = re.sub(r"<!--\s*fixed:start\s*-->.*?<!--\s*fixed:end\s*-->", " ", main, flags=re.S)
    m = re.sub(r"<h[1-4]\b.*?</h[1-4]>", " ", m, flags=re.S)
    return authored_html(m)


def similarity_words(main: str) -> list[str]:
    t = strip_tags(written_html(main)).lower()
    for phrase in CONFIG.get("allowed_repeat_phrases", []):
        t = t.replace(phrase, " ")
    return re.findall(r"[a-z0-9$']+", t)


def shingles(words: list[str], n: int) -> set[str]:
    return {" ".join(words[i:i + n]) for i in range(len(words) - n + 1)}


def page_meta(src: str) -> dict[str, str]:
    m = re.search(r"<!--\s*page-meta\b(.*?)-->", src, re.S)
    return dict(re.findall(r'([a-z_]+)="([^"]*)"', m.group(1))) if m else {}


def norm_question(h: str, industry: str, city: str) -> str:
    h = strip_tags(h).lower()
    for w in industry.split("-") + city.split("-"):
        h = re.sub(r"\b%s\b" % re.escape(w), " ", h)
    return " ".join(w for w in re.findall(r"[a-z0-9']+", h) if w not in STOP)


def faq_pairs(main: str) -> list[tuple[str, str]]:
    return [(squash(strip_tags(q)), squash(strip_tags(a)))
            for q, a in re.findall(r'<div class="qa">\s*<h3>(.*?)</h3>\s*<p>(.*?)</p>\s*</div>', main, re.S)]


def json_ld(src: str) -> list:
    out = []
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', src, re.S):
        out.append(json.loads(block))
    return out


def img_tags(fragment: str) -> list[dict[str, str]]:
    return [dict(re.findall(r'([a-z-]+)="([^"]*)"', tag)) for tag in re.findall(r"<img\b[^>]*>", fragment)]


def image_size(path: Path) -> tuple[int, int] | None:
    """Width and height for WebP, PNG and JPEG without third-party libraries."""
    data = path.read_bytes()
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X":
            return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
        if chunk == b"VP8 ":
            w, h = struct.unpack("<HH", data[26:30])
            return w & 0x3FFF, h & 0x3FFF
        if chunk == b"VP8L":
            b = int.from_bytes(data[21:25], "little")
            return (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i < len(data) - 9:
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h
            i += 2 + int.from_bytes(data[i + 2:i + 4], "big")
    return None


def long_date(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{MONTHS[d.month - 1]} {d.day}, {d.year}"


def load_json(path: Path) -> tuple[dict | None, str | None]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except json.JSONDecodeError as exc:
        return None, str(exc)


class Page:
    def __init__(self, path: str, src: str):
        self.path, self.src = path, src
        m = CITY_RE.match(path)
        self.industry, self.city = (m.group(1), m.group(2)) if m else ("", "")
        self.meta = page_meta(src)
        self.main = main_html(src)
        self.text = squash(strip_tags(authored_html(self.main)))
        self.sh = shingles(similarity_words(self.main), T.get("shingle_size", 5))
        self.faq = faq_pairs(self.main)
        self.questions = [norm_question(q, self.industry, self.city) for q, _ in self.faq]
        self.url = f"{ORIGIN}/{SECTION}/{self.industry}/{self.city}"
        self.folder = ROOT / "local-pages" / self.industry / self.city
        self.data_path = self.folder / "page-data.json"
        self.data, self.data_error = load_json(self.data_path) if self.data_path.exists() else (None, None)
        d = self.data or {}
        self.published = str(d.get("published") or self.meta.get("published", ""))
        self.modified = str(d.get("modified") or self.meta.get("modified", ""))


# ---------------------------------------------------------------- checks
class Report:
    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.lines: list[str] = []
        self.gate: dict[str, dict] = {}

    def err(self, where: str, msg: str):
        self.errors.append(f"`{where}`: {msg}")

    def warn(self, where: str, msg: str):
        self.warnings.append(f"`{where}`: {msg}")


def check_structure(p: Page, r: Report):
    where = p.path
    src = p.src
    if p.meta and (p.meta.get("industry") != p.industry or p.meta.get("city") != p.city):
        r.err(where, "page-meta industry/city must match the file path")
    known = {**CONFIG.get("approved_industries", {}), **CONFIG.get("industries", {})}
    if CONFIG.get("restrict_industries") and p.industry not in known:
        r.err(where, f"industry '{p.industry}' is not on the industry list in local-pages/config.json (restrict_industries is on)")
    for key, value in (("published", p.published), ("modified", p.modified)):
        try:
            dt.date.fromisoformat(value)
        except ValueError:
            r.err(where, f"{key} must be a YYYY-MM-DD date in page-data.json")

    title = html.unescape(squash(re.search(r"<title>(.*?)</title>", src, re.S).group(1))) if "<title>" in src else ""
    if not title:
        r.err(where, "missing <title>")
    elif len(title) > T["title_max"] or not title.endswith("| Boost Your Maps"):
        r.err(where, f"title must be {T['title_max']} characters or fewer and end with '| Boost Your Maps' ({len(title)}: {title})")
    md = re.search(r'<meta name="description" content="([^"]*)"', src)
    desc = html.unescape(md.group(1)) if md else ""
    if not T["meta_min"] <= len(desc) <= T["meta_max"]:
        r.err(where, f"meta description must be {T['meta_min']}-{T['meta_max']} characters (has {len(desc)})")
    canon = re.search(r'<link rel="canonical" href="([^"]*)"', src)
    if not canon or canon.group(1) != p.url:
        r.err(where, f"canonical must be {p.url}")

    h1s = re.findall(r"<h1\b[^>]*>(.*?)</h1>", src, re.S)
    if len(h1s) != 1:
        r.err(where, f"expected one H1, found {len(h1s)}")
    elif not squash(strip_tags(h1s[0])).startswith("Local SEO and Google Maps marketing for"):
        r.err(where, "H1 must read 'Local SEO and Google Maps marketing for [industry] companies in [City]'")

    # FAQ + schema. The questions slot may drop out (local-pages 2.0); when it's there it has 3-5 questions.
    if p.faq and not T["faq_min"] <= len(p.faq) <= T["faq_max"]:
        r.err(where, f"FAQ needs {T['faq_min']}-{T['faq_max']} questions (found {len(p.faq)})")
    try:
        blocks = json_ld(src)
    except json.JSONDecodeError as exc:
        r.err(where, f"JSON-LD does not parse: {exc}")
        blocks = []
    graph = [n for b in blocks for n in b.get("@graph", [b])]
    types = {n.get("@type"): n for n in graph}
    for t in ("WebPage", "Service", "BreadcrumbList"):
        if t not in types:
            r.err(where, f"JSON-LD graph is missing {t}")
    if p.faq and "FAQPage" not in types:
        r.err(where, "JSON-LD graph is missing FAQPage (the page shows a FAQ)")
    if "FAQPage" in types:
        schema_faq = [(squash(q.get("name", "")), squash(q.get("acceptedAnswer", {}).get("text", "")))
                      for q in types["FAQPage"].get("mainEntity", [])]
        if schema_faq != p.faq:
            r.err(where, "FAQPage schema does not match the visible FAQ word for word")
    if "Service" in types:
        svc = types["Service"]
        if str(svc.get("offers", {}).get("price")) != "450":
            r.err(where, "Service offer price must be 450")
        if svc.get("provider", {}).get("@id") != f"{ORIGIN}/#organization":
            r.err(where, "Service provider must reference the Organization by @id")
    if "WebPage" in types:
        wp = types["WebPage"]
        if wp.get("author", {}).get("name") != "Michael Moll":
            r.err(where, "WebPage author must be Michael Moll")
        if wp.get("datePublished") != p.published or wp.get("dateModified") != p.modified:
            r.err(where, f"WebPage datePublished/dateModified must match page-data.json published/modified ({p.published}, {p.modified})")
    if "BreadcrumbList" in types:
        items = [i.get("item") for i in types["BreadcrumbList"].get("itemListElement", [])]
        want = [f"{ORIGIN}/", f"{ORIGIN}/{SECTION}", f"{ORIGIN}/{SECTION}/{p.industry}", p.url]
        if items != want:
            r.err(where, f"BreadcrumbList must be {want}")

    # voice
    visible = f"{title}\n{desc}\n{p.text}"
    for pat in CONFIG["banned_terms"]:
        for m in re.finditer(pat, visible, re.I):
            ctx = visible[max(0, m.start() - 40):m.end() + 40].replace("\n", " ")
            r.err(where, f"banned voice term {m.group(0)!r}: …{ctx}…")

    # CTAs and links
    for tag, label in re.findall(r'<(a|button)\b[^>]*class="btn btn-primary"[^>]*>(.*?)</\1>', p.main, re.S):
        if squash(strip_tags(label)) != CONFIG["cta_text"]:
            r.err(where, f"primary button text must be exactly '{CONFIG['cta_text']}' (found '{squash(strip_tags(label))}')")
    ids = set(re.findall(r'\bid="([^"]+)"', src))
    for href in re.findall(r'href="([^"]*)"', p.main):
        if href == "#" or href == "":
            r.err(where, "empty or '#' link in main content")
        elif href.startswith("#") and href[1:] not in ids:
            r.err(where, f"in-page link {href} has no target")
    for leftover in re.findall(r"\{\{[A-Za-z_:]+\}\}|__[A-Z0-9_]+__", src) + [
            x for x in ('class="ph"', "img-slot", "mock-note") if x in src]:
        r.err(where, f"template leftover {leftover!r} still on the page")

    # images
    imgs = img_tags(p.main)
    if not imgs:
        r.err(where, "no images: the hero illustration is required")
    for i, im in enumerate(imgs):
        src_attr = im.get("src", "")
        if not im.get("width") or not im.get("height"):
            r.err(where, f"image {src_attr} needs width and height")
        if not im.get("alt"):
            r.err(where, f"image {src_attr} needs alt text")
        if i == 0 and im.get("fetchpriority") != "high":
            r.err(where, "the hero image must load with fetchpriority=\"high\"")
        if src_attr.startswith("/assets/"):
            f = ROOT / src_attr.lstrip("/")
            if not f.exists():
                r.err(where, f"image file {src_attr} is not uploaded yet (upload it to {f.relative_to(ROOT)})")
            elif src_attr.startswith("/assets/local/"):
                kb = f.stat().st_size / 1024
                if kb > T["image_max_kb"]:
                    r.err(where, f"{src_attr} is {kb:.0f} KB; keep images under {T['image_max_kb']} KB")
                size = image_size(f)
                if size and im.get("width") and (str(size[0]), str(size[1])) != (im["width"], im.get("height")):
                    r.err(where, f"{src_attr} is {size[0]}x{size[1]} but the page declares {im['width']}x{im.get('height')}")
        elif not src_attr.startswith("/"):
            r.err(where, f"image {src_attr[:60]} must be a site file under /assets/")


def stylesheet_classes() -> set[str]:
    """Class names the page shell's stylesheet defines. A city page may only use these."""
    shell = (ROOT / "templates" / "local-service-page-shell.html").read_text(encoding="utf-8")
    m = re.search(r'<link rel="stylesheet" href="/([^"?]+\.css)', shell)
    css_path = ROOT / (m.group(1) if m else "assets/styles.css")
    css = re.sub(r"/\*.*?\*/", "", css_path.read_text(encoding="utf-8"), flags=re.S)
    return set(re.findall(r"\.(-?[A-Za-z_][\w-]*)", css))


# Template instructions left on the page: [Bracketed] text from the 2.0 skeleton, version 1 <Angle bracket> notes.
PLACEHOLDER = re.compile(r"\[(?:PENDING|TODO|TBD|INSERT|PLACEHOLDER)[^\]]*\]|\bPENDING_[A-Z_]+|lorem ipsum|MAIN CONTENT SKELETON"
                         r"|<[A-Z][a-zA-Z]*\s[^>]*>|\[(?:[A-Z]|\.\.\.)[^\]]{0,300}\]")


def classes_of(attrs: str) -> set[str]:
    m = re.search(r'\bclass="([^"]*)"', attrs)
    return set(m.group(1).split()) if m else set()


def check_markup(p: Page, r: Report, css: set[str]):
    """The skeleton's markup (mirrors markupProblems in the BYM Team connector)."""
    where = p.path
    found: list[str] = []
    authored = authored_html(re.sub(r"<!-- R4 REPORT PANEL.*?<!-- /R4 -->", " ", p.main, flags=re.S))  # R4 is generated
    body = re.sub(r"<!--.*?-->", " ", p.main, flags=re.S)
    sections = list(re.finditer(r"<section\b([^>]*)>\s*(?:<([a-z0-9]+)\b([^>]*)>)?", body))
    for m in sections:
        cls = classes_of(m.group(1))
        label = f'<section class="{" ".join(sorted(cls))}">' if cls else "<section>"
        if not cls & {"section", "page-hero"}:
            found.append(f"{label} needs the skeleton's section classes (\"page-hero\" for the hero, \"section …\" for the rest)")
        if m.group(2) != "div" or "wrap" not in classes_of(m.group(3) or ""):
            found.append(f"the first thing inside {label} must be <div class=\"wrap\">, as in the skeleton")
    if not sections:
        found.append("no <section> blocks: use the skeleton in templates/local-service-page-main.html")
    else:
        first, last = sections[0], sections[-1]
        if "page-hero" not in classes_of(first.group(1)) or "lsp-hero" not in classes_of(first.group(3) or ""):
            found.append('the hero must be the first section: <section class="page-hero"><div class="wrap lsp-hero">, as in the skeleton')
        if "final-cta" not in classes_of(last.group(1)):
            found.append('the last section must be <section class="section flow final-cta">, as in the skeleton')
    if 'class="qa"' in p.main and 'class="faq"' not in p.main:
        found.append('FAQ items go inside <div class="faq">')
    unknown = sorted({c for attrs in re.findall(r'\bclass="([^"]*)"', authored) for c in attrs.split()} - css)
    if unknown:
        found.append(f"classes {', '.join(repr(c) for c in unknown)} are not in the site stylesheet; use the skeleton's markup")
    ph = PLACEHOLDER.search(authored)
    if ph:
        found.append(f"placeholder still on the page: {ph.group(0)[:80]}")
    for msg in dict.fromkeys(found):
        r.err(where, msg)


def check_data(p: Page, r: Report):
    """page-data.json is there, belongs to this page, and the page states the search it reports."""
    where = p.path
    rel = p.data_path.relative_to(ROOT)
    if p.data is None:
        r.err(where, f"missing {rel}: local-pages 2.0 pages carry their data file (the fact sheet is retired)"
              if not p.data_error else f"{rel} does not parse: {p.data_error}")
        return False
    d = p.data
    want_slug = f"/{SECTION}/{p.industry}/{p.city}"
    if d.get("slug") != want_slug:
        r.err(where, f"{rel}: slug must be {want_slug} (has {d.get('slug')!r})")
    if d.get("site_key") != SITE_KEY:
        r.err(where, f"{rel}: site_key must be {SITE_KEY!r}")
    if d.get("profile", PROFILE) != PROFILE:
        r.err(where, f"{rel}: BYM city pages use the {PROFILE!r} profile (has {d.get('profile')!r})")
    if d.get("page_type", "city") != "city":
        r.err(where, f"{rel}: page_type must be 'city'")
    searched = ((d.get("modules") or {}).get("map") or {}).get("meta", {}).get("searched_on")
    if searched:
        try:
            if long_date(str(searched)[:10]) not in p.text:
                r.err(where, f"the page must state the date of its Maps search ({long_date(str(searched)[:10])})")
        except ValueError:
            pass  # local_gate reports the bad date
    sp = p.folder / "snapshot.json"
    if sp.exists():
        snap, problem = load_json(sp)
        if snap is None:
            r.err(where, f"{sp.relative_to(ROOT)} does not parse: {problem}")
        else:
            low = p.text.lower().replace("&", "and")
            for res in (snap.get("results") or [])[:3]:
                name = str(res.get("name", "")).lower().replace("&", "and")
                if name and name not in low:
                    r.err(where, f"snapshot result '{res.get('name')}' (top three) is not named on the page as it appears on Google")
    return True


V1_ONLY_KEYS = ("fact_sheet_min_facts", "module_sections_min", "module_sections_max")


def gate_override() -> dict:
    """Site values that override the vendored local-pages config: similarity limits, the length band and
    anything under "local_gate" in local-pages/config.json. Anything the site file doesn't set falls back to the
    vendored defaults. A site file still in its version 1 layout (it carries the v1-only fact-sheet and section
    keys) keeps its similarity limits, but its 1,000-1,600 word band was v1's, so the vendored profile's applies."""
    ov: dict = {"similarity": {"shingle_size": T.get("shingle_size", 5)}}
    if "any_page" in T:
        ov["similarity"]["any_page_max"] = T["any_page"]
    if "same_industry_or_city" in T:
        ov["similarity"]["same_service_or_city_max"] = T["same_industry_or_city"]
    if "words_min" in T and "words_max" in T and not any(k in T for k in V1_ONLY_KEYS):
        ov["profiles"] = {PROFILE: {"words_min": T["words_min"], "words_max": T["words_max"]}}
    return deep_merge(ov, CONFIG.get("local_gate") or {})


def deep_merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def run_local_gate(p: Page, pages: dict[str, Page], tmp: Path, r: Report):
    """local_gate.py on the page, with every other city page (and its page-data.json) as a sibling."""
    sib = tmp / f"siblings-{p.industry}-{p.city}"
    sib.mkdir(parents=True, exist_ok=True)
    for o in pages.values():
        if o.path == p.path:
            continue
        stem = f"{o.industry}__{o.city}"
        (sib / f"{stem}.html").write_text(o.src, encoding="utf-8")
        if o.data_path.exists():
            shutil.copyfile(o.data_path, sib / f"{stem}.data.json")
    override = tmp / "site-override.json"
    override.write_text(json.dumps(gate_override()), encoding="utf-8")
    cmd = [sys.executable, "-I", str(GATE), "--data", str(p.data_path), "--file", str(ROOT / p.path),
           "--siblings", str(sib), "--config", str(override), "--json"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 2 or not res.stdout.strip().startswith("{"):
        r.err(p.path, f"local_gate could not run: {(res.stderr or res.stdout).strip()[:300]}")
        return
    out = json.loads(res.stdout)
    r.gate[p.path] = out
    for e in out["errors"]:
        r.err(p.path, f"local_gate [{e['gate']}] {e['msg']}")
    for w in out["warnings"]:
        r.warn(p.path, f"local_gate [{w['gate']}] {w['msg']}")


def check_wiring(p: Page, r: Report, sitemap: dict[str, str], llms: str):
    hub = ROOT / SECTION / f"{p.industry}.html"
    index = ROOT / f"{SECTION}.html"
    path = f"/{SECTION}/{p.industry}/{p.city}"
    if not index.exists():
        r.err(p.path, f"the /{SECTION} index page must exist before any city page goes live")
    if not hub.exists():
        r.err(p.path, f"the industry hub {hub.relative_to(ROOT)} must exist before its city pages go live")
    elif f'href="{path}"' not in hub.read_text(encoding="utf-8"):
        r.err(p.path, f"the hub {hub.relative_to(ROOT)} must link to {path}")
    if p.url not in sitemap:
        r.err(p.path, "add the page to sitemap.xml with a lastmod date")
    elif sitemap[p.url] != p.modified:
        r.warn(p.path, f"sitemap lastmod {sitemap[p.url]} differs from page-data modified {p.modified}")
    if p.url not in llms:
        r.err(p.path, "add the page to llms.txt")


def check_variety(p: Page, others: list[Page], r: Report):
    """FAQ registry and sitewide boilerplate. Pairwise overlap is local_gate's G4."""
    used: dict[str, str] = {}
    for o in others:
        for q in o.questions:
            used.setdefault(q, o.path)
    for q in p.questions:
        if q in used:
            r.err(p.path, f"FAQ question repeats one on {used[q]} (normalized: '{q}'); write a new one from this city's data")
    if len(others) >= T.get("boilerplate_min_pages", 5):
        n = T.get("boilerplate_min_pages", 5)
        common = {s for s in p.sh if sum(s in o.sh for o in others) >= n}
        share = len(common) / max(1, len(p.sh))
        limit = T.get("sitewide_boilerplate", 0.08)
        r.lines.append(f"| {p.path} | shared phrasing on {n}+ pages (fixed blocks excluded) | {share:.1%} | {limit:.0%} | {'FAIL' if share > limit else 'ok'} |")
        if share > limit:
            r.err(p.path, f"{share:.1%} of this page's own phrasing also appears on {n}+ other pages (limit {limit:.0%})")


def check_governance(new_pages: list[Page], r: Report):
    pub = CONFIG.get("publishing") or {}
    if new_pages and pub.get("paused"):
        for p in new_pages:
            r.err(p.path, f"publishing is paused: {pub.get('pause_reason') or 'see local-pages/config.json'}")


def check_guard(changes: dict[str, str], base: str, r: Report):
    """Publisher pull requests may only add or edit local-page files. A new industry's first page may
    also add its starter hub (built from templates/local-service-hub-main.html) and list the industry
    between the industry-pages markers on the /google-maps-marketing index."""
    city_pages = {m.groups() for f in changes if (m := CITY_RE.match(f))}
    allowed_pages = {f"{SECTION}/{i}/{c}.html" for i, c in city_pages}
    industries = {i for i, _ in city_pages}
    sidecars = "|".join(re.escape(s) for s in SIDECARS)
    for path, status in changes.items():
        if status == "D":
            r.err(path, "publisher pull requests may not delete files")
            continue
        if path in allowed_pages:
            continue
        m = re.fullmatch(rf"local-pages/([a-z0-9-]+)/([a-z0-9-]+)/({sidecars})", path)
        if m and (m.group(1), m.group(2)) in city_pages:
            continue
        m = re.fullmatch(r"assets/local/([a-z0-9-]+)\.(webp|png|jpe?g|avif)", path)
        if m and any(m.group(1).startswith(f"{i}-{c}-") for i, c in city_pages):
            continue
        hub = re.fullmatch(rf"{SECTION}/([a-z0-9-]+)\.html", path)
        if hub and status == "A":
            if hub.group(1) not in industries or "hub:auto-starter" not in (ROOT / path).read_text(encoding="utf-8"):
                r.err(path, "a new hub must be the starter hub built for an industry with a city page in this pull request")
            continue
        if path == f"{SECTION}.html" and status == "M":
            old = base_text(base, path) or ""
            new = (ROOT / path).read_text(encoding="utf-8")
            cut = lambda s: re.sub(r"<!--\s*industry-pages:start\s*-->.*?<!--\s*industry-pages:end\s*-->", "", s, flags=re.S)
            if cut(old) != cut(new):
                r.err(path, "page pull requests may only add an industry between the industry-pages markers on the index")
            continue
        if hub and status == "M":
            old = base_text(base, path) or ""
            new = (ROOT / path).read_text(encoding="utf-8")
            cut = lambda s: re.sub(r"<!--\s*city-pages:start\s*-->.*?<!--\s*city-pages:end\s*-->", "", s, flags=re.S)
            if cut(old) != cut(new):
                r.err(path, "publishers may only change the city list between the city-pages markers on a hub")
            continue
        if path == "sitemap.xml":
            old = set(re.findall(r"<loc>(.*?)</loc>", base_text(base, path) or ""))
            new = set(re.findall(r"<loc>(.*?)</loc>", (ROOT / path).read_text(encoding="utf-8")))
            extra = {u for u in new - old if not re.fullmatch(rf"{re.escape(ORIGIN)}/{SECTION}/[a-z0-9-]+/[a-z0-9-]+", u)
                     and u not in {f"{ORIGIN}/{SECTION}/{i}" for i in industries}}
            if old - new or extra:
                r.err(path, "page pull requests may only add city page and new hub URLs (and update lastmod) in sitemap.xml")
            continue
        if path == "llms.txt":
            old = set((base_text(base, path) or "").splitlines())
            new = set((ROOT / path).read_text(encoding="utf-8").splitlines())
            if old - new:
                r.err(path, "publishers may only add lines to llms.txt")
            continue
        r.err(path, "outside the files a local page pull request may change")


def vendored_from() -> str:
    first = GATE.read_text(encoding="utf-8").splitlines()[0] if GATE.exists() else ""
    m = re.search(r"ai-skills@([0-9a-f]{7,40})", first)
    return m.group(1)[:7] if m else "unknown"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", help="git ref to compare against (checks only pages changed since it)")
    ap.add_argument("--guard", action="store_true", help="also enforce the publisher path guard")
    ap.add_argument("--report", help="write the Markdown report to this file")
    a = ap.parse_args()

    all_paths = sorted(str(p.relative_to(ROOT)) for p in (ROOT / SECTION).glob("*/*.html")) if (ROOT / SECTION).exists() else []
    pages = {path: Page(path, (ROOT / path).read_text(encoding="utf-8")) for path in all_paths if CITY_RE.match(path)}
    r = Report()
    for path in all_paths:
        if not CITY_RE.match(path):
            r.err(path, f"city pages must be named {SECTION}/<industry>/<city>-<st>.html")
    if not GATE.exists():
        r.err(str(GATE.relative_to(ROOT)), "the vendored local_gate.py is missing; see local-pages/README.md (sync the gate)")

    changes: dict[str, str] = {}
    if a.base:
        changes = changed_files(a.base)
        base_set = set(base_city_pages(a.base))
        targets = [pages[p] for p in pages if p in changes]
        new = [pages[p] for p in pages if p not in base_set]
        for p in changes:   # images or sidecars changed without the page
            m = re.match(r"(?:local-pages/([a-z0-9-]+)/([a-z0-9-]+)/|assets/local/)", p)
            if m and m.group(1):
                key = f"{SECTION}/{m.group(1)}/{m.group(2)}.html"
                if key in pages and pages[key] not in targets:
                    targets.append(pages[key])
    else:
        targets = list(pages.values())
        new = []

    sm_path = ROOT / "sitemap.xml"
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    sitemap = {u.findtext("sm:loc", "", ns): u.findtext("sm:lastmod", "", ns) for u in ET.parse(sm_path).findall("sm:url", ns)}
    llms = (ROOT / "llms.txt").read_text(encoding="utf-8")

    css = stylesheet_classes()
    r.lines += ["| Page | Compared with | Share | Limit | Result |", "|---|---|---|---|---|"]
    with tempfile.TemporaryDirectory(prefix="local-pages-") as tmp:
        for p in targets:
            check_structure(p, r)
            check_markup(p, r, css)
            if check_data(p, r) and GATE.exists():
                run_local_gate(p, pages, Path(tmp), r)
            check_wiring(p, r, sitemap, llms)
            check_variety(p, [o for o in pages.values() if o.path != p.path], r)
    check_governance(new, r)
    if a.guard and a.base:
        check_guard(changes, a.base, r)

    out = ["## Local service page check", "",
           f"Gate: `shared/local-pages` 2.0 (`local_gate.py` vendored from ai-skills@{vendored_from()}).", ""]
    if not targets:
        out.append("No local service pages changed in this pull request.")
    else:
        for p in targets:
            g = (r.gate.get(p.path) or {}).get("stats") or {}
            bits = [f"{len(p.text.split())} words", f"{len(p.faq)} FAQ"]
            if "unique_total" in g:
                bits.append(f"{g['unique_total']} unique data points from {len(g.get('data_modules_present', []))} modules "
                            f"({', '.join(g.get('data_modules_present', []))})")
            if "swap_test" in g:
                bits.append(f"city swap {g['swap_test']['share']:.0%}")
            if "similarity_max" in g:
                bits.append(f"closest page {g['similarity_max']['jaccard']:.1%} ({Path(g['similarity_max']['sibling']).stem.replace('__', '/')})")
            if "filler_hits" in g:
                bits.append(f"{g['filler_hits']} filler hits")
            out.append(f"- **{p.path}**: " + ", ".join(bits))
        if len(r.lines) > 2:
            out += ["", *r.lines]
    out += ["", f"**Result: {'PASS' if not r.errors else 'FAIL'}**"]
    if r.errors:
        out += ["", "### Fix these before publishing", *[f"- {e}" for e in r.errors]]
    if r.warnings:
        out += ["", "### Warnings", *[f"- {w}" for w in r.warnings]]
    text = "\n".join(out) + "\n"
    print(text)
    if a.report:
        Path(a.report).write_text(text, encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as fh:
            fh.write(text)
    return 1 if r.errors else 0


if __name__ == "__main__":
    sys.exit(main())
