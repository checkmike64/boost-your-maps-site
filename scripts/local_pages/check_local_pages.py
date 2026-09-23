#!/usr/bin/env python3
"""Publish gate for the industry x city local service pages (/google-maps-marketing/<industry>/<city-st>).

Runs in CI on every pull request and can be run locally:

  python3 scripts/local_pages/check_local_pages.py                  # check every city page
  python3 scripts/local_pages/check_local_pages.py --base origin/main  # check pages changed vs main
  python3 scripts/local_pages/check_local_pages.py --base origin/main --guard   # + publisher path guard

What it enforces (rules come from local-pages/config.json and the BYM local service page process):
  structure   page-meta, title/meta lengths, canonical, one H1, JSON-LD graph, FAQ schema == visible FAQ,
              module order, 4-6 module sections, word count, banned voice terms, CTA text, images
  facts       fact sheet (>= 8 sourced facts, one ANCHOR) and Maps snapshot sidecars; snapshot names,
              review counts and date appear on the page
  variety     5-word shingle Jaccard vs every other city page (15% any, 12% same industry or city),
              sitewide boilerplate (8%), heading and FAQ registry, module fingerprint
  wiring      industry hub exists and links the page, sitemap.xml (with lastmod) and llms.txt list it
  governance  industry approved, publishing not paused, first-batch hold and monthly cadence,
              hero angle not repeated back to back in an industry
  guard       (--guard) a publisher pull request only touches local-page files
Standard library only. Exit code 1 when anything fails.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "local-pages" / "config.json").read_text(encoding="utf-8"))
T = CONFIG["thresholds"]
ORIGIN = CONFIG["site_origin"]
SECTION = CONFIG["section"]
CITY_RE = re.compile(rf"^{SECTION}/([a-z0-9-]+)/([a-z0-9-]+-[a-z]{{2}})\.html$")
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
    """Main content minus generated blocks (form, fixed report lines, image markup)."""
    m = re.sub(r"<!--\s*generated:start.*?generated:end\s*-->", " ", main, flags=re.S)
    m = re.sub(r"<select\b.*?</select>", " ", m, flags=re.S)
    return re.sub(r"<!--.*?-->", " ", m, flags=re.S)


def words_for_similarity(main: str) -> list[str]:
    t = strip_tags(authored_html(main)).lower()
    for phrase in CONFIG["allowed_repeat_phrases"]:
        t = t.replace(phrase, " ")
    return re.findall(r"[a-z0-9$']+", t)


def shingles(words: list[str], n: int) -> set[str]:
    return {" ".join(words[i:i + n]) for i in range(len(words) - n + 1)}


def page_meta(src: str) -> dict[str, str]:
    m = re.search(r"<!--\s*page-meta\b(.*?)-->", src, re.S)
    return dict(re.findall(r'([a-z_]+)="([^"]*)"', m.group(1))) if m else {}


def fingerprint(main: str) -> list[str]:
    codes = re.findall(r"<!--\s*((?:R\d|M\d+)(?:\s*\+\s*M\d+)*|CLOSE)\b", main)
    return [re.sub(r"\s+", "", c) for c in codes]


def norm_heading(h: str, industry: str, city: str) -> str:
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


class Page:
    def __init__(self, path: str, src: str):
        self.path, self.src = path, src
        m = CITY_RE.match(path)
        self.industry, self.city = (m.group(1), m.group(2)) if m else ("", "")
        self.meta = page_meta(src)
        self.main = main_html(src)
        self.text = squash(strip_tags(authored_html(self.main)))
        self.sh = shingles(words_for_similarity(self.main), T["shingle_size"])
        self.fp = fingerprint(self.main)
        self.faq = faq_pairs(self.main)
        heads = re.findall(r"<h[23][^>]*>(.*?)</h[23]>", self.main, re.S)
        self.heads = [norm_heading(h, self.industry, self.city) for h in heads]
        self.url = f"{ORIGIN}/{SECTION}/{self.industry}/{self.city}"
        self.published = self.meta.get("published", "")
        self.angle = self.meta.get("hero_angle", "")


# ---------------------------------------------------------------- checks
class Report:
    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.lines: list[str] = []

    def err(self, where: str, msg: str):
        self.errors.append(f"`{where}`: {msg}")

    def warn(self, where: str, msg: str):
        self.warnings.append(f"`{where}`: {msg}")


def check_structure(p: Page, r: Report):
    where = p.path
    src = p.src
    if p.meta.get("industry") != p.industry or p.meta.get("city") != p.city:
        r.err(where, "page-meta industry/city must match the file path")
    if p.industry not in CONFIG["approved_industries"]:
        r.err(where, f"industry '{p.industry}' is not approved in local-pages/config.json (Mike opens new industries)")
    if p.angle not in CONFIG["hero_angles"]:
        r.err(where, f"page-meta hero_angle '{p.angle}' is not one of {CONFIG['hero_angles']}")
    if p.meta.get("snapshot_observation") not in CONFIG["snapshot_observations"]:
        r.err(where, "page-meta snapshot_observation is missing or not in the approved list")
    for key in ("published", "modified", "snapshot_date"):
        try:
            dt.date.fromisoformat(p.meta.get(key, ""))
        except ValueError:
            r.err(where, f"page-meta {key} must be a YYYY-MM-DD date")

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

    # module order
    fp = p.fp
    modules = [c for c in fp if c.startswith("M")]
    if not fp or fp[0] != "R1":
        r.err(where, f"R1 HERO must be the first section (found {' '.join(fp)})")
    if "R2" not in fp[1:3]:
        r.err(where, "R2 MARKET SNAPSHOT must be the second or third section")
    for code in ("R3", "R4", "CLOSE"):
        if code not in fp:
            r.err(where, f"missing required section {code}")
    if "R3" in fp and "R4" in fp and fp.index("R3") > fp.index("R4"):
        r.err(where, "R3 (price, terms, proof) must come before R4 (report panel)")
    if fp and fp[-1] != "CLOSE":
        r.err(where, "CLOSE must be the last section")
    if not any(c.startswith("M12") for c in modules):
        r.err(where, "M12 FAQ is required on every page")
    if not T["module_sections_min"] <= len(modules) <= T["module_sections_max"]:
        r.err(where, f"use {T['module_sections_min']}-{T['module_sections_max']} module sections including the FAQ (found {len(modules)})")
    if len(set(fp)) != len(fp):
        r.err(where, "a section code appears twice")

    # FAQ + schema
    if not T["faq_min"] <= len(p.faq) <= T["faq_max"]:
        r.err(where, f"FAQ needs {T['faq_min']}-{T['faq_max']} questions (found {len(p.faq)})")
    try:
        blocks = json_ld(src)
    except json.JSONDecodeError as exc:
        r.err(where, f"JSON-LD does not parse: {exc}")
        blocks = []
    graph = [n for b in blocks for n in b.get("@graph", [b])]
    types = {n.get("@type"): n for n in graph}
    for t in ("WebPage", "Service", "BreadcrumbList", "FAQPage"):
        if t not in types:
            r.err(where, f"JSON-LD graph is missing {t}")
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
        if wp.get("datePublished") != p.published or wp.get("dateModified") != p.meta.get("modified"):
            r.err(where, "WebPage datePublished/dateModified must match page-meta published/modified")
    if "BreadcrumbList" in types:
        items = [i.get("item") for i in types["BreadcrumbList"].get("itemListElement", [])]
        want = [f"{ORIGIN}/", f"{ORIGIN}/{SECTION}", f"{ORIGIN}/{SECTION}/{p.industry}", p.url]
        if items != want:
            r.err(where, f"BreadcrumbList must be {want}")

    # length + voice
    n_words = len(p.text.split())
    if not T["words_min"] <= n_words <= T["words_max"]:
        r.err(where, f"main content must be {T['words_min']}-{T['words_max']} words (has {n_words})")
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


def check_sidecars(p: Page, r: Report):
    folder = ROOT / "local-pages" / p.industry / p.city
    fs = folder / "fact-sheet.md"
    if not fs.exists():
        r.err(p.path, f"missing fact sheet {fs.relative_to(ROOT)}")
    else:
        text = fs.read_text(encoding="utf-8")
        facts, anchors, section = 0, 0, ""
        for line in text.splitlines():
            if line.startswith("#"):
                section = line.lower()
                continue
            if any(k in section for k in ("snapshot", "unverified", "correction", "not used")):
                continue
            if re.match(r"\s*(?:[-*]|\d+\.)\s", line) and "http" in line:
                facts += 1
                anchors += bool(re.search(r"anchor", line, re.I))
        if facts < T["fact_sheet_min_facts"]:
            r.err(p.path, f"fact sheet has {facts} sourced facts; the gate needs {T['fact_sheet_min_facts']}")
        if anchors < 1:
            r.err(p.path, "fact sheet must tag one fact as the page's ANCHOR fact")
    sp = folder / "snapshot.json"
    if not sp.exists():
        r.err(p.path, f"missing Maps snapshot {sp.relative_to(ROOT)}")
        return
    try:
        snap = json.loads(sp.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        r.err(p.path, f"snapshot.json does not parse: {exc}")
        return
    results = snap.get("results", [])
    if len(results) != 3:
        r.err(p.path, "snapshot.json must hold exactly the top three results")
    run = str(snap.get("run_at", ""))[:10]
    if run != p.meta.get("snapshot_date"):
        r.err(p.path, "page-meta snapshot_date must match snapshot.json run_at")
    else:
        if long_date(run) not in p.text:
            r.err(p.path, f"the page must state the search date ({long_date(run)})")
    low = p.text.lower().replace("&", "and")
    for res in results:
        name = str(res.get("name", "")).lower().replace("&", "and")
        if name and name not in low:
            r.err(p.path, f"snapshot result '{res.get('name')}' is not named on the page as it appears on Google")
        reviews = res.get("reviews")
        if isinstance(reviews, int) and f"{reviews:,}" not in p.text and str(reviews) not in p.text:
            r.err(p.path, f"review count {reviews:,} for '{res.get('name')}' does not appear on the page")


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
    elif sitemap[p.url] != p.meta.get("modified"):
        r.warn(p.path, f"sitemap lastmod {sitemap[p.url]} differs from page-meta modified {p.meta.get('modified')}")
    if p.url not in llms:
        r.err(p.path, "add the page to llms.txt")


def check_variety(p: Page, others: list[Page], r: Report):
    for o in others:
        j = len(p.sh & o.sh) / max(1, len(p.sh | o.sh))
        same = o.industry == p.industry or o.city == p.city
        limit = T["same_industry_or_city"] if same else T["any_page"]
        tag = "FAIL" if j > limit else "ok"
        r.lines.append(f"| {p.path} | {o.path} | {j:.1%} | {limit:.0%}{' (same industry or city)' if same else ''} | {tag} |")
        if j > limit:
            r.err(p.path, f"{j:.1%} text overlap with {o.path} (limit {limit:.0%}); rewrite the overlapping sections")
        if o.fp == p.fp and same:
            r.err(p.path, f"module order {' '.join(p.fp)} matches {o.path}; reorder or swap a module")
    if len(others) >= T["boilerplate_min_pages"]:
        common = {s for s in p.sh if sum(s in o.sh for o in others) >= T["boilerplate_min_pages"]}
        share = len(common) / max(1, len(p.sh))
        r.lines.append(f"| {p.path} | shared boilerplate (5+ pages) | {share:.1%} | {T['sitewide_boilerplate']:.0%} | {'FAIL' if share > T['sitewide_boilerplate'] else 'ok'} |")
        if share > T["sitewide_boilerplate"]:
            r.err(p.path, f"{share:.1%} of this page's phrasing also appears on 5+ other pages (limit {T['sitewide_boilerplate']:.0%})")
    used = {}
    for o in others:
        for h in o.heads:
            used.setdefault(h, o.path)
    for h in p.heads:
        if h in used:
            r.err(p.path, f"heading or FAQ question repeats one on {used[h]} (normalized: '{h}'); write a new one")


def check_governance(new_pages: list[Page], base_pages: list[Page], r: Report, today: dt.date):
    pub = CONFIG["publishing"]
    if new_pages and pub.get("paused"):
        for p in new_pages:
            r.err(p.path, f"publishing is paused: {pub.get('pause_reason') or 'see local-pages/config.json'}")
    dated = sorted((dt.date.fromisoformat(p.published), p) for p in base_pages if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.published))
    order = [d for d, _ in dated]
    for p in sorted(new_pages, key=lambda x: x.published):
        try:
            order.append(dt.date.fromisoformat(p.published))
        except ValueError:
            continue
        position = len(order)
        n = pub["first_batch_size"]
        if position > n:
            batch_end = sorted(order)[n - 1]
            if (today - batch_end).days < pub["first_batch_hold_days"]:
                r.err(p.path, f"the first {n} pages went live by {batch_end}; wait {pub['first_batch_hold_days']} days after that before page {position}")
        recent = [d for d in order if (today - d).days < 30]
        if len(recent) > pub["max_new_pages_per_30_days"]:
            r.err(p.path, f"more than {pub['max_new_pages_per_30_days']} new city pages in 30 days")
        same = sorted((x for x in base_pages if x.industry == p.industry and x.published), key=lambda x: x.published)
        if same and same[-1].angle == p.angle:
            r.err(p.path, f"hero angle '{p.angle}' was used by the last {p.industry} page ({same[-1].path}); pick another")


def check_guard(changes: dict[str, str], base: str, r: Report):
    """Publisher pull requests may only add or edit local-page files."""
    city_pages = {m.groups() for f in changes if (m := CITY_RE.match(f))}
    allowed_pages = {f"{SECTION}/{i}/{c}.html" for i, c in city_pages}
    for path, status in changes.items():
        if status == "D":
            r.err(path, "publisher pull requests may not delete files")
            continue
        if path in allowed_pages:
            continue
        m = re.fullmatch(r"local-pages/([a-z0-9-]+)/([a-z0-9-]+)/(fact-sheet\.md|snapshot\.json|images\.md)", path)
        if m and (m.group(1), m.group(2)) in city_pages:
            continue
        m = re.fullmatch(r"assets/local/([a-z0-9-]+)\.(webp|png|jpe?g|avif)", path)
        if m and any(m.group(1).startswith(f"{i}-{c}-") for i, c in city_pages):
            continue
        hub = re.fullmatch(rf"{SECTION}/([a-z0-9-]+)\.html", path)
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
            extra = {u for u in new - old if not re.fullmatch(rf"{re.escape(ORIGIN)}/{SECTION}/[a-z0-9-]+/[a-z0-9-]+", u)}
            if old - new or extra:
                r.err(path, "publishers may only add city page URLs (and update their lastmod) in sitemap.xml")
            continue
        if path == "llms.txt":
            old = set((base_text(base, path) or "").splitlines())
            new = set((ROOT / path).read_text(encoding="utf-8").splitlines())
            if old - new:
                r.err(path, "publishers may only add lines to llms.txt")
            continue
        r.err(path, "outside the files a local page pull request may change")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", help="git ref to compare against (checks only pages changed since it)")
    ap.add_argument("--guard", action="store_true", help="also enforce the publisher path guard")
    ap.add_argument("--report", help="write the Markdown report to this file")
    ap.add_argument("--today", help="override today's date (YYYY-MM-DD) for cadence checks")
    a = ap.parse_args()
    today = dt.date.fromisoformat(a.today) if a.today else dt.date.today()

    all_paths = sorted(str(p.relative_to(ROOT)) for p in (ROOT / SECTION).glob("*/*.html")) if (ROOT / SECTION).exists() else []
    pages = {path: Page(path, (ROOT / path).read_text(encoding="utf-8")) for path in all_paths if CITY_RE.match(path)}
    r = Report()
    for path in all_paths:
        if not CITY_RE.match(path):
            r.err(path, f"city pages must be named {SECTION}/<industry>/<city>-<st>.html")

    changes: dict[str, str] = {}
    if a.base:
        changes = changed_files(a.base)
        base_set = set(base_city_pages(a.base))
        targets = [pages[p] for p in pages if p in changes]
        new = [pages[p] for p in pages if p not in base_set]
        base_pages = [pages[p] for p in pages if p in base_set]
        for p, status in changes.items():   # images or sidecars changed without the page
            m = re.match(r"(?:local-pages/([a-z0-9-]+)/([a-z0-9-]+)/|assets/local/)", p)
            if m and m.group(1):
                key = f"{SECTION}/{m.group(1)}/{m.group(2)}.html"
                if key in pages and pages[key] not in targets:
                    targets.append(pages[key])
    else:
        targets = list(pages.values())
        new, base_pages = [], list(pages.values())

    sm_path = ROOT / "sitemap.xml"
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    sitemap = {u.findtext("sm:loc", "", ns): u.findtext("sm:lastmod", "", ns) for u in ET.parse(sm_path).findall("sm:url", ns)}
    llms = (ROOT / "llms.txt").read_text(encoding="utf-8")

    r.lines += ["| Page | Compared with | Overlap | Limit | Result |", "|---|---|---|---|---|"]
    for p in targets:
        check_structure(p, r)
        check_sidecars(p, r)
        check_wiring(p, r, sitemap, llms)
        check_variety(p, [o for o in pages.values() if o.path != p.path], r)
    check_governance(new, base_pages, r, today)
    if a.guard and a.base:
        check_guard(changes, a.base, r)

    out = ["## Local service page check", ""]
    if not targets:
        out.append("No local service pages changed in this pull request.")
    else:
        for p in targets:
            out.append(f"- **{p.path}**: {len(p.text.split())} words, modules `{' '.join(p.fp)}`, hero angle `{p.angle}`, {len(p.faq)} FAQ")
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
