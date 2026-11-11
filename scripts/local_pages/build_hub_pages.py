#!/usr/bin/env python3
"""Build the /google-maps-marketing index and the industry hub pages from the local page shell.

The hub and index are written by Mike (not the connector). Their copy lives in this file so the
head, nav, footer and JSON-LD always match the city pages. Run from the repo root:

  python3 scripts/local_pages/build_hub_pages.py

It rewrites google-maps-marketing.html, keeping whatever the connector listed between the industry-pages
markers. Starter hubs for other industries come from templates/local-service-hub-main.html via the connector.

Since 2026-11-11 the pest control hub (google-maps-marketing/pest-control.html) is a hand-built page, rebuilt
through ai-skills shared/page-pipeline as the "pest control seo" page. This script no longer writes it; edit the
page itself (its city-pages markers still take the connector's city list).
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = "https://www.boostyourmaps.com"
ORG = f"{ORIGIN}/#organization"
UPDATED = "2026-11-11"
UNDERLINE = ('<svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true"><path d="M3 8 C60 2, 150 2, '
             '197 6" stroke="#FFC42E" stroke-width="7" fill="none" stroke-linecap="round"/></svg>')
CHECK = '<span class="c"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg></span>'
CTA = "Get my free visibility report →"


def faq_block(pairs):
    items = "\n".join(f'      <div class="qa"><h3>{html.escape(q, quote=False)}</h3><p>{html.escape(a, quote=False)}</p></div>'
                      for q, a in pairs)
    return items


def faq_schema(pairs):
    return {"@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in pairs]}


def render(path: str, title: str, meta: str, crumbs: list[tuple[str, str]], main: str, graph: list[dict]) -> str:
    shell = (ROOT / "templates" / "local-service-page-shell.html").read_text(encoding="utf-8")
    url = f"{ORIGIN}/{path}"
    trail = "".join(f'<li><a href="{href}">{html.escape(name)}</a></li>' for name, href in crumbs[:-1])
    crumb = (f'<div class="wrap"><nav class="breadcrumbs" aria-label="Breadcrumb"><ol>{trail}'
             f'<li aria-current="page">{html.escape(crumbs[-1][0])}</li></ol></nav></div>')
    items = [{"@type": "ListItem", "position": i + 1, "name": name,
              "item": ORIGIN + ("/" if href == "/" else href)} for i, (name, href) in enumerate(crumbs)]
    items[-1]["item"] = url
    full = {"@context": "https://schema.org", "@graph": graph + [{"@type": "BreadcrumbList", "itemListElement": items}]}
    out = shell.replace("{{PAGE_META}}\n", "")
    for token, value in [("{{TITLE}}", html.escape(title)), ("{{META}}", html.escape(meta)), ("{{CANONICAL}}", url),
                         ("{{SCHEMA}}", json.dumps(full, ensure_ascii=False).replace("<", "\\u003c")),
                         ("{{BREADCRUMB}}", crumb), ("{{MAIN}}", main.strip())]:
        out = out.replace(token, value)
    assert len(title) <= 60 and 150 <= len(meta) <= 160, (path, len(title), len(meta))
    return out


def webpage(path: str, name: str, extra: dict | None = None) -> dict:
    url = f"{ORIGIN}/{path}"
    node = {"@type": "WebPage", "@id": f"{url}#webpage", "url": url, "name": name,
            "isPartOf": {"@id": f"{ORIGIN}/#website"}, "publisher": {"@id": ORG},
            "author": {"@type": "Person", "name": "Michael Moll", "url": f"{ORIGIN}/about-us"},
            "dateModified": UPDATED}
    node.update(extra or {})
    return node


# ---------------------------------------------------------------- /google-maps-marketing
INDEX_MAIN = f"""
<section class="page-hero">
  <div class="wrap">
    <span class="eyebrow"><span class="dot"></span> By industry</span>
    <h1 style="margin-top:18px;max-width:880px;">Local SEO and Google Maps marketing for <span class="hand">service companies{UNDERLINE}</span></h1>
    <p class="lead" style="max-width:720px;">Your customers look you up on Google Maps when something breaks, bites or needs fixing. Each trade shows up differently there, so we write a page for each one we work with. It covers what we change on a profile in that trade and links to the cities we've studied.</p>
    <p class="micro" style="margin-top:14px;">We work with established companies: 20 or more Google reviews and about a year on Google Maps.</p>
  </div>
</section>

<section class="section tight">
  <div class="wrap">
    <div class="prose">
      <h2>Industries we write about</h2>
    </div>
    <ul class="checklist">
      <!-- industry-pages:start -->
      <li>{CHECK}<p><b><a class="plainlink" href="/google-maps-marketing/pest-control">Pest control</a></b> Pest control SEO step by step, what we found when we searched 15 cities, and what we change on a pest control profile.</p></li>
      <!-- industry-pages:end -->
    </ul>
    <p style="margin-top:22px;">Don't see your trade? The free report works for any established local service company. <a class="tlink" href="/visibility-report">Get the report →</a></p>
  </div>
</section>

<section class="section flow">
  <div class="wrap">
    <div class="prose">
      <h2>How we decide which city pages to write</h2>
      <p>We only write a city page after we've looked at that market. Each one starts with a Google Maps search we ran in that city on a stated date, names the three companies that showed up first, and uses local facts we checked against their sources.</p>
      <p>That's why the pages don't read alike. A pest control owner in one city has a different season, different roads to cover and different competition than an owner a few hours away.</p>
    </div>
  </div>
</section>

<section class="section tight">
  <div class="wrap">
    <div class="cta-panel">
      <h2>See where your company shows up now</h2>
      <p>The free visibility report shows where you appear on the map, who holds the top three near you, and whether your area is available. It comes by email within 24 hours.</p>
      <a href="/visibility-report" class="btn btn-primary">{CTA}</a>
      <svg class="mini-mascot" viewBox="0 0 260 350" aria-hidden="true"><use href="#mascot"/></svg>
    </div>
  </div>
</section>
"""

def keep_listed(new: str, old_path: Path, marker: str) -> str:
    """Keep whatever the connector listed between the <marker>:start/end comments in the current file."""
    if not old_path.exists():
        return new
    pattern = rf"<!--\s*{marker}:start\s*-->.*?<!--\s*{marker}:end\s*-->"
    old = re.search(pattern, old_path.read_text(encoding="utf-8"), re.S)
    return re.sub(pattern, lambda _: old.group(0), new, flags=re.S) if old else new


def main():
    index_path = "google-maps-marketing"
    index = render(index_path, "Google Maps Marketing by Industry | Boost Your Maps",
                   "Local SEO and Google Maps marketing for established service companies, by industry. See what we change "
                   "in your trade and the cities we have studied so far.",
                   [("Home", "/"), ("Google Maps marketing", f"/{index_path}")], INDEX_MAIN,
                   [webpage(index_path, "Google Maps marketing by industry", {"@type": "CollectionPage"})])
    index_file = ROOT / f"{index_path}.html"
    index_file.write_text(keep_listed(index, index_file, "industry-pages"), encoding="utf-8")

    print("wrote", f"{index_path}.html")


if __name__ == "__main__":
    main()
