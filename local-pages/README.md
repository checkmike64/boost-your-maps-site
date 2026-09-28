# Local service pages

Industry × city pages: "Local SEO and Google Maps marketing for [industry] companies in [city]".
The process (how to research, plan and write a page) is the `bym-local-service-pages` skill in
`checkmike64/ai-skills` (also published to the BYM second brain). This folder and the files
below are the site-side half: where pages live and the automatic gate every page must pass.

## Where things live

| Path | What | Deployed? |
|---|---|---|
| `google-maps-marketing.html` | The `/google-maps-marketing` index (write before any city page) | yes |
| `google-maps-marketing/<industry>.html` | Industry hub: universal explanations + hub FAQ + city list | yes |
| `google-maps-marketing/<industry>/<city>-<st>.html` | A city page (built by the BYM Team connector) | yes |
| `assets/local/<industry>-<city>-<st>-hero.webp` | The cartoon hero, made in a separate tool and uploaded by hand | yes |
| `local-pages/<industry>/<city>-<st>/fact-sheet.md` | Sourced facts, one tagged ANCHOR | no |
| `local-pages/<industry>/<city>-<st>/snapshot.json` | The one Google Maps search (top three) | no |
| `local-pages/<industry>/<city>-<st>/images.md` | Image briefs for the illustrator | no |
| `local-pages/config.json` | Approved industries, pause switch, cadence, thresholds, banned terms. **Mike only.** | no |
| `templates/local-service-page-shell.html` | The page frame (head, nav, footer) | no |
| `templates/local-service-page-main.html` | The section skeleton drafters fill in | no |
| `scripts/local_pages/check_local_pages.py` | The publish gate (CI runs it on every PR) | no |

## How a page gets published

1. A builder runs the skill in ChatGPT or Claude with the **BYM Team connector**: Maps snapshot,
   fact sheet, plan, draft, humanizer loop, review, then `publish_page`.
2. The connector opens a pull request on a `local-page-<industry>-<city>` branch with the page,
   its fact sheet, snapshot and image briefs, plus the sitemap, llms.txt and hub updates.
3. The hero image is uploaded into that branch at `assets/local/<industry>-<city>-hero.webp`
   (the PR description has the upload link).
4. **Local pages** (this checker) and **Site checks** run. Vercel posts a preview link.
5. When both checks pass, a publisher merges (connector `merge_page`, or the green button).
   Merging to `main` deploys to boostyourmaps.com.

The checker comments its report on the PR. Anything it lists under "Fix these before
publishing" blocks the merge once branch protection requires the check.

## What publishers can and can't change

Pull requests from `local-page-*` branches, or from anyone not in `guard_exempt_users`, may only:
add or edit city pages, their `local-pages/<industry>/<city>/` sidecars and
`assets/local/<industry>-<city>-*` images, add city URLs to `sitemap.xml`, add lines to
`llms.txt`, and change the city list between the markers on a hub. Everything else (pricing,
legal pages, the homepage, `config.json`, other pages) fails the guard.

## Opening a new industry (Mike)

1. Build the industry brief in the brain ("BYM Industry Brief — <Industry>").
2. Write the hub `google-maps-marketing/<industry>.html` with a city list block:

   ```html
   <ul class="city-list">
     <!-- city-pages:start -->
     <!-- city-pages:end -->
   </ul>
   ```
3. Add the industry to `approved_industries` in `config.json`.

## Pausing

Set `"paused": true` and a `pause_reason` in `config.json` when a Search Console pause signal
shows up (see the skill's release rules). New city pages then fail the gate until it's lifted.

## Run the checks locally

```bash
python3 scripts/local_pages/check_local_pages.py                      # every city page
python3 scripts/local_pages/check_local_pages.py --base origin/main    # only what this branch changed
python3 scripts/validate_site.py
```
