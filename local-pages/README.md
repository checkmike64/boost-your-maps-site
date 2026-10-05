# Local service pages

Industry × city pages: "Local SEO and Google Maps marketing for [industry] companies in [city]".
The process (how to research, plan and write a page) is the `bym-local-service-pages` skill in
`checkmike64/ai-skills` (also published to the BYM second brain). This folder and the files
below are the site-side half: where pages live and the automatic gate every page must pass.

## Where things live

| Path | What | Deployed? |
|---|---|---|
| `google-maps-marketing.html` | The `/google-maps-marketing` index (write before any city page) | yes |
| `google-maps-marketing/<industry>.html` | Industry hub: city list plus the explanations that apply to every city. A starter hub is created automatically with an industry's first page | yes |
| `google-maps-marketing/<industry>/<city>-<st>.html` | A city page (built by the BYM Team connector) | yes |
| `assets/local/<industry>-<city>-<st>-hero.webp` | The cartoon hero, made in a separate tool and added on `/team-upload` | yes |
| `local-pages/<industry>/<city>-<st>/fact-sheet.md` | Sourced facts, one tagged ANCHOR | no |
| `local-pages/<industry>/<city>-<st>/snapshot.json` | The one Google Maps search (top three) | no |
| `local-pages/<industry>/<city>-<st>/images.md` | Image briefs for the illustrator | no |
| `local-pages/config.json` | Known industry names, pause switch, thresholds, banned terms. **Mike only.** | no |
| `templates/local-service-page-shell.html` | The page frame (head, nav, footer) | no |
| `templates/local-service-page-main.html` | The section skeleton drafters fill in | no |
| `templates/local-service-hub-main.html` | The starter hub for a new industry | no |
| `scripts/local_pages/check_local_pages.py` | The publish gate (CI runs it on every PR) | no |
| `team-upload.html` | `/team-upload` (noindex): publishers add a page's images with their BYM Team link, no GitHub account | yes |

## How a page gets published

1. A builder runs the skill in ChatGPT or Claude with the **BYM Team connector**: Maps snapshot,
   fact sheet, plan, draft, humanizer loop, review, then `publish_page`.
2. The connector opens a pull request on a `local-page-<industry>-<city>` branch with the page,
   its fact sheet, snapshot and image briefs, plus the sitemap, llms.txt and hub updates.
3. A publisher adds the hero image on `/team-upload?pr=<number>` (or the connector's
   `upload_image`). The connector checks the file type, size and exact dimensions against the
   page spec, then commits it to the branch at `assets/local/<industry>-<city>-hero.webp`.
4. **Local pages** (this checker) and **Site checks** run. Vercel posts a preview link.
5. When both checks pass, a publisher merges (connector `merge_page`, or the green button).
   Merging to `main` deploys to boostyourmaps.com.

The checker comments its report on the PR. Anything it lists under "Fix these before
publishing" blocks the merge once branch protection requires the check.

## What publishers can and can't change

Pull requests from `local-page-*` branches, or from anyone not in `guard_exempt_users`, may only:
add or edit city pages, their `local-pages/<industry>/<city>/` sidecars and
`assets/local/<industry>-<city>-*` images, add city URLs to `sitemap.xml`, add lines to
`llms.txt`, and change the city list between the markers on a hub. A new industry's first page
may also add that industry's starter hub and list it between the `industry-pages` markers on the
index. Everything else (pricing,
legal pages, the homepage, `config.json`, other pages) fails the guard.

## New industries and cities

Any industry and any city can be built, with nobody's sign-off (decided 2026-10-05). The page's
spec carries `industry_name` (how the trade reads in "for roofing companies in Tampa"). When the
first page in a new industry is published, the connector adds a starter hub from
`templates/local-service-hub-main.html` and lists the industry on `/google-maps-marketing`, in the
same pull request. Mike can later replace a starter hub with a full one (as with pest control,
built by `scripts/local_pages/build_hub_pages.py`) and add an industry brief to the brain.

There are no volume limits. The quality gates (Maps snapshot, sourced facts with an anchor,
overlap limits, voice rules) still apply to every page.

## Pausing

Set `"paused": true` and a `pause_reason` in `config.json` when a Search Console pause signal
shows up (see the skill's release rules). New city pages then fail the gate until it's lifted.

## Run the checks locally

```bash
python3 scripts/local_pages/check_local_pages.py                      # every city page
python3 scripts/local_pages/check_local_pages.py --base origin/main    # only what this branch changed
python3 scripts/validate_site.py
```
