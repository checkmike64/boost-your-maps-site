#!/usr/bin/env python3
"""Build the /google-maps-marketing index and the industry hub pages from the local page shell.

The hub and index are written by Mike (not the connector). Their copy lives in this file so the
head, nav, footer and JSON-LD always match the city pages. Run from the repo root:

  python3 scripts/local_pages/build_hub_pages.py

It rewrites google-maps-marketing.html and google-maps-marketing/pest-control.html, keeping whatever the
connector listed between the industry-pages markers (index) and city-pages markers (hub). Starter hubs
for other industries come from templates/local-service-hub-main.html via the connector.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = "https://www.boostyourmaps.com"
ORG = f"{ORIGIN}/#organization"
UPDATED = "2026-09-27"
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
      <li>{CHECK}<p><b><a class="plainlink" href="/google-maps-marketing/pest-control">Pest control</a></b> What we change on a pest control profile, when to start before your busy season, and the cities we've looked at.</p></li>
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

# ---------------------------------------------------------------- /google-maps-marketing/pest-control
PEST_FAQ = [
    ("Can you promise our company will make the top three?",
     "No. Google decides rankings, so nobody can honestly promise a spot. We promise the work: a rebuilt profile, "
     "monthly posts, photos and listings, and a report that shows what changed."),
    ("Do we have to sign a contract?",
     "No long contract. You pay month to month and can leave with 7 days' written notice. The profile and everything "
     "we add stay yours."),
    ("Do you work with other pest control companies near us?",
     "We take one pest control company in each area. If we already work with one near you, your free report will say so."),
    ("Will you write reviews for our company?",
     "No. We never write or buy reviews, and Google's rules don't allow fake ones. Your reviews belong to you. We give "
     "your techs a simple way to ask customers after a visit that went well."),
    ("How long before our profile shows up more often?",
     "Most profiles show a change on the map within 60 to 90 days. Your monthly report shows where you appear and what "
     "we did that month."),
]

PEST_MAIN = f"""
<section class="page-hero">
  <div class="wrap">
    <span class="eyebrow"><span class="dot"></span> Pest control</span>
    <h1 style="margin-top:18px;max-width:880px;">Local SEO and Google Maps marketing for <span class="hand">pest control{UNDERLINE}</span> companies</h1>
    <p class="lead" style="max-width:720px;">When homeowners find termites, ants or mosquitoes, many of them search Google Maps and call one of the first three companies they see. We rebuild your Google profile and keep it active every month so it shows up in more of the searches around you. It costs $450 a month.</p>
    <div class="btns" style="margin-top:28px;"><a href="/visibility-report?service=Pest+control" class="btn btn-primary">{CTA}</a></div>
    <p class="micro" style="margin-top:10px;">There's no setup fee, and you can leave with 7 days' notice. The profile and everything we add stay yours.</p>
    <p class="micro" style="margin-top:4px;">We work with pest control companies that have 20 or more Google reviews and at least a year on Google Maps. We take one pest control company in each area.</p>
  </div>
</section>

<section class="section tight">
  <div class="wrap">
    <div class="prose">
      <h2>How does Google choose the pest control companies it shows first?</h2>
      <p>Google looks at three things: how well a profile matches the search, how close the company is to the person searching, and how well known the company is. You can't move your office, but you can change almost everything else on your profile.</p>
      <p>That matters more in pest control than in most trades. Google gives this trade one category, "Pest control service," so every company on the map has the same one. Your service list, business description, photos and posts are how Google and homeowners learn that you handle termites, bed bugs or mosquitoes.</p>
      <p class="src">Source: Google Business Profile Help, "Tips to improve your local ranking on Google."</p>
    </div>
  </div>
</section>

<section class="section flow">
  <div class="wrap">
    <div class="prose">
      <span class="eyebrow"><span class="dot"></span> What we handle</span>
      <h2 style="margin-top:18px;">What we change on a pest control profile</h2>
    </div>
    <ul class="checklist">
      <li>{CHECK}<p><b>Your service list.</b> Each service by the name homeowners search for, like termite inspection or mosquito control, with a short description Google can read.</p></li>
      <li>{CHECK}<p><b>Your license.</b> Pest control companies are licensed by the state. Where homeowners can look up a license, we put yours in your business description.</p></li>
      <li>{CHECK}<p><b>Your service area.</b> Most customers never visit a pest control office, so Google asks you to hide the address and list the areas you serve. We set it to match where your trucks go.</p></li>
      <li>{CHECK}<p><b>Posts and photos.</b> Six posts and four new photos each month, planned around the weeks your phones ring most.</p></li>
      <li>{CHECK}<p><b>Your listings.</b> Thirty new map and directory listings each month with your name, address and phone the same everywhere, so Google trusts the details.</p></li>
      <li>{CHECK}<p><b>Your reviews.</b> They stay yours. We never write or buy them, and we give you a simple plan for asking happy customers.</p></li>
    </ul>
    <p style="margin-top:22px;"><a class="tlink" href="/pricing">See everything in the monthly plan →</a></p>
  </div>
</section>

<section class="section flow">
  <div class="wrap">
    <div class="prose">
      <h2>When should a pest control company start?</h2>
      <p>Profile work usually takes 60 to 90 days to show up on the map, so start about three months before your busiest weeks. For many companies that means winter work for spring termite swarms, or spring work for summer mosquito calls.</p>
      <p>Seasons change from one market to the next. Each city page below covers the season in that market and who held the top three when we searched.</p>
    </div>
  </div>
</section>

<section class="section section-break">
  <div class="wrap">
    <div class="prose">
      <span class="eyebrow"><span class="dot"></span> Pricing</span>
      <h2 style="margin-top:18px;">What it costs, and what you keep</h2>
      <p>Ongoing management is $450 a month, and the full profile rebuild is included. There's no setup fee, and you can leave with 7 days' written notice. If you'd rather have the rebuild alone, it's $1,750 once.</p>
      <p>If you've paid for SEO before and couldn't tell what you got, look at your first monthly report. It lists every post, photo and listing we added and shows where your profile appears on the map. Google decides rankings, so we won't promise you a spot.</p>
    </div>
  </div>
</section>

<section class="section tight">
  <div class="wrap">
    <div class="prose">
      <h2>Pest control pages by city</h2>
      <p>Each city page starts with a Google Maps search we ran there and the local facts that shape the season in that market.</p>
    </div>
    <ul class="city-list">
      <!-- city-pages:start -->
      <!-- city-pages:end -->
    </ul>
  </div>
</section>

<section class="section tight">
  <div class="wrap">
    <div class="cta-panel">
      <h2>See where your pest control company shows up</h2>
      <p>Tell us your company and the area you serve. Within 24 hours we'll email a short report on where you appear, who holds the top three near you, and whether we already work with a pest control company in your area. If we're not a fit, the report will say so.</p>
      <a href="/visibility-report?service=Pest+control" class="btn btn-primary">{CTA}</a>
      <svg class="mini-mascot" viewBox="0 0 260 350" aria-hidden="true"><use href="#mascot"/></svg>
    </div>
  </div>
</section>

<section class="section section-break">
  <div class="wrap">
    <div class="center narrow"><h2>Pest control owners ask us</h2></div>
    <div class="faq">
{faq_block(PEST_FAQ)}
    </div>
  </div>
</section>

<section class="section flow final-cta">
  <div class="wrap center narrow">
    <h2>Find out where you stand before your busy season</h2>
    <div class="btns" style="justify-content:center;"><a href="/visibility-report?service=Pest+control" class="btn btn-primary">{CTA}</a></div>
    <p class="byline">Written by Michael Moll, founder of Boost Your Maps. Updated September 27, 2026.</p>
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

    hub_path = "google-maps-marketing/pest-control"
    service = {"@type": "Service", "@id": f"{ORIGIN}/{hub_path}#service",
               "name": "Local SEO and Google Maps marketing for pest control companies",
               "serviceType": "Google Business Profile management",
               "description": "Done-for-you Google Business Profile rebuild and monthly management for established pest control companies.",
               "audience": {"@type": "BusinessAudience", "audienceType": "Pest control companies"},
               "provider": {"@id": ORG}, "areaServed": {"@type": "Country", "name": "United States"},
               "offers": {"@type": "Offer", "price": "450", "priceCurrency": "USD",
                          "priceSpecification": {"@type": "UnitPriceSpecification", "price": "450", "priceCurrency": "USD", "unitCode": "MON"},
                          "url": f"{ORIGIN}/pricing"}}
    hub = render(hub_path, "Pest Control SEO & Google Maps Marketing | Boost Your Maps",
                 "Local SEO and Google Maps marketing for pest control companies: how Google picks the top three, what "
                 "we change on your profile, and what $450 a month covers.",
                 [("Home", "/"), ("Google Maps marketing", "/google-maps-marketing"), ("Pest control", f"/{hub_path}")],
                 PEST_MAIN, [webpage(hub_path, "Pest control SEO and Google Maps marketing", {"about": {"@id": f"{ORIGIN}/{hub_path}#service"}}),
                             service, faq_schema(PEST_FAQ)])
    out = ROOT / f"{hub_path}.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(keep_listed(hub, out, "city-pages"), encoding="utf-8")
    print("wrote", f"{index_path}.html", f"{hub_path}.html")


if __name__ == "__main__":
    main()
