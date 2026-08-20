#!/usr/bin/env python3
"""Dependency-free guardrails for the Boost Your Maps static site."""

from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
CANONICAL_ORIGIN = "https://www.boostyourmaps.com"
HTML_FILES = sorted(ROOT.glob("*.html"))
errors: list[str] = []


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.description = ""
        self.robots = ""
        self.canonical = ""
        self.h1_count = 0
        self.heading_levels: list[int] = []
        self.main_ids: list[str | None] = []
        self.skip_links: list[str] = []
        self.links: list[str] = []
        self.json_ld: list[str] = []
        self.has_breadcrumbs = False
        self._capture: str | None = None
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = dict(attrs)
        if tag == "title":
            self._capture = "title"
            self._buffer = []
        elif tag == "script" and data.get("type") == "application/ld+json":
            self._capture = "json"
            self._buffer = []
        elif tag == "meta" and data.get("name") == "description":
            self.description = data.get("content") or ""
        elif tag == "meta" and data.get("name") == "robots":
            self.robots = data.get("content") or ""
        elif tag == "link" and data.get("rel") == "canonical":
            self.canonical = data.get("href") or ""
        elif tag == "main":
            self.main_ids.append(data.get("id"))
        elif re.fullmatch(r"h[1-6]", tag):
            level = int(tag[1])
            self.heading_levels.append(level)
            if level == 1:
                self.h1_count += 1
        elif tag == "a":
            href = data.get("href") or ""
            self.links.append(href)
            if "skip-link" in (data.get("class") or "").split():
                self.skip_links.append(href)
        elif tag == "nav" and "breadcrumbs" in (data.get("class") or "").split():
            self.has_breadcrumbs = True

    def handle_endtag(self, tag: str) -> None:
        if self._capture == "title" and tag == "title":
            self.title = "".join(self._buffer).strip()
            self._capture = None
        elif self._capture == "json" and tag == "script":
            self.json_ld.append("".join(self._buffer).strip())
            self._capture = None

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buffer.append(data)


def fail(path: Path | str, message: str) -> None:
    errors.append(f"{path}: {message}")


def clean_target(href: str) -> str | None:
    if not href or href.startswith(("#", "mailto:", "tel:", "http://", "https://")):
        return None
    path = urlsplit(href).path
    if not path.startswith("/"):
        return None
    return path


indexable_canonicals: set[str] = set()
for page in HTML_FILES:
    parser = PageParser()
    source = page.read_text(encoding="utf-8")
    parser.feed(source)

    if parser.h1_count != 1:
        fail(page.name, f"expected one H1, found {parser.h1_count}")
    if parser.main_ids != ["main-content"]:
        fail(page.name, "expected one <main id=\"main-content\">")
    if parser.skip_links != ["#main-content"]:
        fail(page.name, "missing or invalid skip link")
    for previous, current in zip(parser.heading_levels, parser.heading_levels[1:]):
        if current > previous + 1:
            fail(page.name, f"heading level skips from H{previous} to H{current}")

    noindex = "noindex" in parser.robots.lower()
    if not noindex:
        if not 20 <= len(parser.title) <= 65:
            fail(page.name, f"title length is {len(parser.title)}")
        if not 120 <= len(parser.description) <= 170:
            fail(page.name, f"description length is {len(parser.description)}")
        if not parser.canonical.startswith(CANONICAL_ORIGIN):
            fail(page.name, "missing canonical on canonical origin")
        indexable_canonicals.add(parser.canonical)
    elif parser.canonical:
        fail(page.name, "noindex page should not declare a canonical")

    if not parser.json_ld:
        fail(page.name, "missing JSON-LD")
    for block in parser.json_ld:
        try:
            data = json.loads(block)
        except json.JSONDecodeError as exc:
            fail(page.name, f"invalid JSON-LD: {exc}")
            continue
        graph = data.get("@graph", [data])
        if any(node.get("@type") == "BreadcrumbList" for node in graph) and not parser.has_breadcrumbs:
            fail(page.name, "BreadcrumbList schema has no visible breadcrumb")

    for href in parser.links:
        target = clean_target(href)
        if target is None:
            continue
        if target == "/":
            candidate = ROOT / "index.html"
        elif target.startswith("/assets/"):
            candidate = ROOT / target.lstrip("/")
        else:
            candidate = ROOT / f"{target.strip('/')}.html"
        if not candidate.exists():
            fail(page.name, f"broken internal link {href}")

    for forbidden in ("Owner quote goes here", "review keyword seeding", "geo-tagged image uploads"):
        if forbidden.lower() in source.lower():
            fail(page.name, f"forbidden placeholder or policy-risk phrase: {forbidden}")


sitemap = ET.parse(ROOT / "sitemap.xml")
ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
sitemap_urls = {node.text or "" for node in sitemap.findall("sm:url/sm:loc", ns)}
if sitemap_urls != indexable_canonicals:
    fail("sitemap.xml", f"URLs differ from indexable canonicals: {sitemap_urls ^ indexable_canonicals}")
for node in sitemap.findall("sm:url/sm:lastmod", ns):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", node.text or ""):
        fail("sitemap.xml", f"invalid lastmod {node.text!r}")

try:
    json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
except json.JSONDecodeError as exc:
    fail("vercel.json", f"invalid JSON: {exc}")

for required in ("robots.txt", "sitemap.xml", "llms.txt", "pricing.txt", "pricing.html"):
    if not (ROOT / required).exists():
        fail(required, "required discovery or pricing file is missing")

combined = "\n".join((ROOT / name).read_text(encoding="utf-8") for name in (
    "index.html", "pricing.html", "pricing.txt", "service-agreement.html"
))
if combined.lower().count("6 monthly posts") < 2 or "4 monthly posts" in combined.lower():
    fail("pricing", "monthly post deliverables are inconsistent")

if errors:
    print("Site validation failed:")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print(f"Validated {len(HTML_FILES)} HTML pages, {len(indexable_canonicals)} indexable canonicals, schema, links, sitemap, and config.")
