# Boost Your Maps — website repo

Static multi-page marketing site for boostyourmaps.com (Google Maps marketing for local businesses). No build step: plain HTML + `assets/styles.css`. Verify the GitHub/Vercel connection before assuming a push deploys.

## Who this is for
Mike Moll (owner, non-developer). Talk plainly, no jargon. He directs; you build, commit, and push.

## Workflow — every change
0. **New pages and copy rewrites start in `ai-skills/shared/page-pipeline`** (read its SKILL.md whole). It owns the queue row, the intent check, the gates, cadence, the review record and the PR; this file and DESIGN.md are its step 4.
1. Make the edit.
2. Open the changed page in a browser (or screenshot it) and verify it renders correctly, desktop AND mobile width (~390px).
3. If a page was added or removed: update `sitemap.xml` (with lastmod) and, if nav-worthy, the shared nav/footer on ALL pages.
4. Run `python3 scripts/validate_site.py`, then verify desktop and mobile rendering.
5. Publish through a reviewed feature branch and pull request. Never force-push an unrelated local history.
6. Tell Mike what changed and give him the Vercel preview URL to check.

## Design system — DESIGN.md is law
**Stylesheet version:** any PR that changes `assets/styles.css` sets the `?v=` on EVERY page (and template) to one new value. Browsers keep `styles.css?v=X` for up to a week (`stale-while-revalidate`), so a new page that reuses another page's `?v=` can show without its new styles (2026-11-11: the cost guide rendered unstyled this way).

Read `DESIGN.md` before touching any visual. The short version:
- White canvas ONLY. No colored section backgrounds, ever.
- One accent: deep red #C5221F (buttons, numerals, mascot, key stat). Green #12B76A for checkmarks only. Yellow #FFC42E only in the h1 hand-underline.
- Gabarito 800 display + Hanken Grotesk body. EXACTLY three body sizes: 1.05rem / 1.2rem lead / .9rem caption.
- 1px hairlines (#E7EAE8) inside components; section-break borders only before pricing + FAQ. Dashed route connectors with red dots between story sections.
- One gray panel (#F5F7F5) exists: the Visibility Report card (1.5px red border).
- Every primary button says exactly: "Get my free visibility report →". Secondary actions are text links (.tlink), never boxed buttons.
- Mascot: the ultra-simple flat pin in the `#mascot` symbol (dot eyes + smile). NEVER redraw it detailed, glossy, or 3D — this failed twice and Mike hated it. His real 3D render may replace it later as an image.
- Banned fonts (AI tells): Bricolage Grotesque, Space Grotesk, Clash Display, Geist, Cal Sans, Instrument Serif, Inter-as-display.
- No hard offset shadows, no pill chips, no icon-box grids, no centered hero, no purple gradients.

## Copy voice
Plain-spoken, honest, lightly playful. Fifth-grade reading level. NO em dashes. No marketer idioms ("leaving money on the table"), no staccato fragment chains ("We run all three. You never log in."), no AI vocabulary (elevate, seamless, unleash, delve). Never guarantee rankings anywhere — honesty is the brand's positioning. Timeline claim: "60 to 90 days". One business per industry per area is real scarcity — use it, don't dilute it.

## SEO rules — every page
- Unique `<title>` (~50-60 chars, topic first) + unique meta description (~150-160 chars).
- One `<h1>`. Logical h2→h3. Self-referencing canonical on `https://www.boostyourmaps.com/...` (www is canonical).
- JSON-LD `@graph` referencing the Organization node `https://www.boostyourmaps.com/#organization`; BreadcrumbList on subpages; FAQPage only when Q&A is visible on the page.
- Add every new page to `sitemap.xml`. robots.txt + llms.txt already welcome AI crawlers — don't remove that.
- New service, location and city pages: built through page-pipeline with `shared/local-pages` (industry x city: `bym-local-service-pages`). No census, landmark, permit or weather filler; a page without real local data isn't built. `templates/service-page-template.html` is markup only.
- Blog posts and guides: through page-pipeline; `templates/blog-post-template.html` is the markup at its step 4, answer-first, Michael Moll byline, into `/blog/`.

## Local service pages (/google-maps-marketing/…)
Industry × city pages are sales assets: market reports made for a named prospect company or campaign, never targeted for ranking or reported on rank (Mike, 2026-11-11). BYM's ranking work goes to the industry hubs. They are built with the `bym-local-service-pages` skill (version 3.0, on `ai-skills/shared/local-pages` 0.3) and published through the BYM Team connector, which opens a `local-page-*` pull request; in Claude the same page goes through page-pipeline. Read `local-pages/README.md` before touching them. Never hand-write a city page from scratch: start from `templates/local-service-page-main.html` (the fixed report skeleton) and assemble with the connector so the schema, report form and page-meta stay correct. Every page carries `local-pages/<industry>/<city-st>/page-data.json`: each name, number and date on the page is a fact there with its source and date, and `build_check.sales_asset.target` names who the report is for (a company or campaign, never a person). `scripts/local_pages/check_local_pages.py` is the publish gate: the local-pages 0.3 gate vendored from ai-skills (sales target, sourcing, city swap, city-neutral overlap, banned filler incl. review-content requests, build check, proof labels and lead-gen listings in the top three, fixed skeleton; the data floor as a warning) plus schema, markup, images, wiring, the FAQ registry and the pause switch. CI runs it on every PR. Cadence is advisory and lives in page-pipeline and the connector, not in CI. Any industry and any city can be built without asking Mike (decided 2026-10-05). page-pipeline and the connector record each page as an `approved` `sales-asset` row in `brain.web_page_queue` with its target; to keep that rule, the connector approves (or adds) the row itself when the page ships (`queue.auto_approve`, true or absent in `local-pages/config.json`; Mike sets it to false only if he wants to approve rows himself). Proof on city pages is anonymous (type of business and city, no name, no profile link; Mike, 2026-11-10). A new industry's first page gets a starter hub from `templates/local-service-hub-main.html` automatically. `local-pages/config.json` is Mike's to change. City page report forms hand off to `/visibility-report` (pre-filled with company name and part of town), which submits to the BYM CRM (see Forms); no city page posts anywhere else. A sales call still follows the report, so never write "no sales call" or similar (decided 2026-09-27; the gate blocks it).

## Forms
`visibility-report.html` and `inquiry-form.html` are native forms handled by `assets/forms.js`. They POST JSON to the URL in each form's `data-endpoint` attribute (`/api/visibility-report`, `/api/inquiry`) and include validation, accessible status messages, and a honeypot. Each endpoint sends the lead to the BYM CRM's forms API at the `CRM_URL` env var (`api/_crm.js`; CRM form slugs `visibility-report` and `inquiry` unless `CRM_FORM_VISIBILITY_REPORT` / `CRM_FORM_INQUIRY` say otherwise). The visitor sees success only when the CRM stores the lead. GoHighLevel was removed on 2026-10-27; the site sends nothing to it. CI runs `node scripts/check_crm_payload.js` and `node scripts/check_signup_payload.js`; keep both passing when you change `api/`. The signup pages (`/get-started`, `/get-started/canada`, `/partners/signup`, `/welcome`, `/partners/portal`) are private, noindex, and stay out of the sitemap and nav; see README.md. Never show a success message for a real visitor unless the API returns a successful response. The mini-forms on index GET-submit to `/visibility-report?service=&location=` which prefills via the small script there — keep that behavior.

## Do not touch without asking Mike
- The interactive 3-Pack map component on index (`#bym-map`) — best element on the site.
- Pricing numbers ($450/mo, $1,750 once) and the 93% stat + SOCi source line.
- Legal pages content (lawyer review pending).
- Approved customer quotes; do not invent or publish quotes without permission.

## Current state / open items
- Approved owner quotes can be added later; the current proof cards contain measured result summaries only.
- Mike plans his own full content rewrite pass.
- Hero speech bubble reads "I'm looking for you." and supports the low-visibility message.
