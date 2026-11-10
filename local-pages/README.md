# Local service pages

Industry × city pages: "Local SEO and Google Maps marketing for [industry] companies in [city]".
Since 2026-11-10 they are local market reports built with **local pages 2.0**: one fixed skeleton,
filled with data that only exists for this trade in this city (who is on the map, how many people
search and when, what customers say and pay, BYM's proof). The process lives in `Impact-Leads-LLC/ai-skills`:
`shared/page-pipeline` (the door for every page: queue row, intent check, gates, cadence, review
record, PR), `shared/local-pages` (skeleton, data modules, gates) and `bym/bym-local-service-pages`
(the BYM layer, also published to the BYM second brain). This folder and the files below are the
site-side half: where pages live and the automatic gate every page must pass.

## Where things live

| Path | What | Deployed? |
|---|---|---|
| `google-maps-marketing.html` | The `/google-maps-marketing` index (write before any city page) | yes |
| `google-maps-marketing/<industry>.html` | Industry hub: the trade's ranking page, plus the city list. A starter hub is created automatically with an industry's first page | yes |
| `google-maps-marketing/<industry>/<city>-<st>.html` | A city page (built by the BYM Team connector or through page-pipeline) | yes |
| `assets/local/<industry>-<city>-<st>-hero.webp` | The cartoon hero, made in a separate tool and added on `/team-upload` | yes |
| `local-pages/<industry>/<city>-<st>/page-data.json` | The page's data: every name, number and date on the page, each with its source and date | no |
| `local-pages/<industry>/<city>-<st>/snapshot.json` | The Maps read from the connector's `maps_snapshot` (optional; when present, its top three must be named on the page) | no |
| `local-pages/<industry>/<city>-<st>/images.md` | Image briefs for the illustrator | no |
| `local-pages/config.json` | Known industry names, the pause switch, the queue policy, site thresholds, banned voice terms. **Mike only.** | no |
| `templates/local-service-page-shell.html` | The page frame (head, nav, footer) | no |
| `templates/local-service-page-main.html` | The fixed 2.0 skeleton drafters fill in (8 slots) | no |
| `templates/local-service-hub-main.html` | The starter hub for a new industry | no |
| `scripts/local_pages/check_local_pages.py` | The publish gate (CI runs it on every PR as the required `local-pages` check) | no |
| `scripts/local_pages/vendor/local-pages/` | `scripts/local_gate.py` and `config.json`, vendored from ai-skills `shared/local-pages` (CI can't read the private skills repo) | no |
| `scripts/local_pages/sync_local_gate.py` | Re-vendors the gate from a local ai-skills checkout | no |
| `team-upload.html` | `/team-upload` (noindex): publishers add a page's images with their BYM Team link, no GitHub account | yes |

`fact-sheet.md`, the ANCHOR fact, hero angles, the module-order fingerprint and the heading registry
were version 1. They are retired.

## How a page gets published

1. A builder runs `bym-local-service-pages` 2.0 (on `shared/local-pages`) from an approved queue
   row: Maps snapshot, `page-data.json`, plan, draft, `local_gate.py`, `shared/anti-ai-writing`,
   review, then `publish_page`.
2. The connector checks the queue row, the intent (no other page owns the search) and cadence, runs
   the same gate as CI, then opens a pull request on a `local-page-<industry>-<city>` branch with the
   page, its `page-data.json`, the Maps read and image briefs, plus the sitemap, llms.txt and hub
   updates. It records the review in the brain.
3. A publisher adds the hero image on `/team-upload?pr=<number>` (or the connector's
   `upload_image`). The connector checks the file type, size and exact dimensions against the
   page spec, then commits it to the branch at `assets/local/<industry>-<city>-hero.webp`.
4. **Local pages** (this checker) and **Site checks** run. Vercel posts a preview link.
5. When both checks pass, a publisher merges (connector `merge_page`, or the green button).
   Merging to `main` deploys to boostyourmaps.com. `merge_page` also marks the queue row live and
   logs the publish in `brain.web_index_events`, which starts the indexing checks.

The checker comments its report on the PR. Anything it lists under "Fix these before
publishing" blocks the merge, because branch protection requires the `local-pages` check.

## What the checker enforces

- **Data (the local-pages 2.0 gate):** `page-data.json` exists, matches the page's path and uses the
  `owner-report` profile, and `local_gate.py` passes with every other city page as a sibling: the
  data floor (12 unique sourced data points from 3 modules), every number backed by a fact, each
  data section opening with a local data point (city-swap test), 5-word overlap with the other city
  pages (15%, or 12% for the same trade or city), no banned filler (census, landmarks, roads,
  weather, permits, utilities, tourism, place lists), the build check, proof labels, and the fixed
  skeleton (slot order and H2 patterns). No word target: 600 to 1,400 words is a warning only.
- **Site rules:** title and meta lengths, canonical, the H1, the JSON-LD graph (FAQPage generated
  from the visible FAQ), dates matching `page-data.json`, banned voice terms, the CTA text, links,
  the hero image (uploaded, size, pixel dimensions), the skeleton's markup and stylesheet classes,
  no template leftovers, the Maps search date on the page.
- **Variety:** no FAQ question repeated from another city page; sitewide boilerplate in the page's
  own (non-fixed) writing.
- **Wiring:** the index and the industry hub exist, the hub links the page, sitemap.xml and llms.txt list it.
- **Governance:** the pause switch. Cadence is advisory and checked by page-pipeline and the
  connector, from `brain.web_sites.cadence`, not here.

## What publishers can and can't change

Pull requests from `local-page-*` branches, or from anyone not in `guard_exempt_users`, may only:
add or edit city pages, their `local-pages/<industry>/<city>/` files (`page-data.json`,
`snapshot.json`, `images.md`) and `assets/local/<industry>-<city>-*` images, add city URLs to
`sitemap.xml`, add lines to `llms.txt`, and change the city list between the markers on a hub. A new
industry's first page may also add that industry's starter hub and list it between the
`industry-pages` markers on the index. Everything else (pricing, legal pages, the homepage,
`config.json`, the checker, other pages) fails the guard.

## New industries and cities

Any industry and any city can be built without asking Mike (decided 2026-10-05). The 2.0 build check
is a data-quality gate on top: no consumer demand and no first-party reason, no proof and no fresh
Maps read, no live hub, or too close to another page, and the page isn't built.

**Pending Mike (2026-11-10): the queue row.** page-pipeline and the connector build a page only from
an `approved` row in `brain.web_page_queue`. `config.json` `queue` decides how that works:
- `"require_approved_row": true, "auto_approve": false` (the default): Mike approves rows, in batches.
- `"auto_approve": true`: keeps the 2026-10-05 "no approval" rule. The connector adds or approves the
  row itself when the page ships, and notes that it did.

The page's spec carries `industry_name` (how the trade reads in "for roofing companies in Tampa").
When the first page in a new industry is published, the connector adds a starter hub from
`templates/local-service-hub-main.html` and lists the industry on `/google-maps-marketing`, in the
same pull request. In 2.0 the hub is the trade's ranking page, so a full hub (built through
page-pipeline, like pest control's in `scripts/local_pages/build_hub_pages.py`) should come first.

## Pausing

Set `"paused": true` and a `pause_reason` in `config.json` when a Search Console pause signal
shows up (see the skill's release rules). New city pages then fail the gate until it's lifted.

## Run the checks locally

```bash
python3 scripts/local_pages/check_local_pages.py                      # every city page
python3 scripts/local_pages/check_local_pages.py --base origin/main    # only what this branch changed
python3 scripts/validate_site.py
```

## Sync the vendored gate

When `shared/local-pages` changes in ai-skills, re-vendor it in its own PR:

```bash
python3 scripts/local_pages/sync_local_gate.py /path/to/ai-skills           # copies local_gate.py + config.json
python3 scripts/local_pages/sync_local_gate.py /path/to/ai-skills --check   # exit 1 if the copy is stale
```

The first line of `vendor/local-pages/scripts/local_gate.py` names the ai-skills commit it came
from, and the checker prints it in its report. The connector reads the same vendored `config.json`
from `main`, so the site, CI and the connector always use one set of rules.
