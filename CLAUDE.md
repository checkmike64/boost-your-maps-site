# Boost Your Maps — website repo

Static multi-page marketing site for boostyourmaps.com (Google Maps marketing for local businesses). No build step: plain HTML + `assets/styles.css`. Verify the GitHub/Vercel connection before assuming a push deploys.

## Who this is for
Mike Moll (owner, non-developer). Talk plainly, no jargon. He directs; you build, commit, and push.

## Workflow — every change
1. Make the edit.
2. Open the changed page in a browser (or screenshot it) and verify it renders correctly, desktop AND mobile width (~390px).
3. If a page was added or removed: update `sitemap.xml` (with lastmod) and, if nav-worthy, the shared nav/footer on ALL pages.
4. Run `python3 scripts/validate_site.py`, then verify desktop and mobile rendering.
5. Publish through a reviewed feature branch and pull request. Never force-push an unrelated local history.
6. Tell Mike what changed and give him the Vercel preview URL to check.

## Design system — DESIGN.md is law
Read `DESIGN.md` before touching any visual. The short version:
- White canvas ONLY. No colored section backgrounds, ever.
- One accent: red #F04E31 (buttons, numerals, mascot, key stat). Green #12B76A for checkmarks only. Yellow #FFC42E only in the h1 hand-underline.
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
- New service/location pages: START from `templates/service-page-template.html` and obey its compliance comment block — no city-list stuffing, no doorway pages, every page needs real unique local content or it doesn't ship.
- Blog posts: `templates/blog-post-template.html`, answer-first, question-style H2s, Michael Moll byline, into `/blog/`.

## Forms
`visibility-report.html` and `inquiry-form.html` are native forms handled by `assets/forms.js`. They POST JSON to the URL in each form's `data-endpoint` attribute and include validation, accessible status messages, and a honeypot. The API endpoints are intentionally blank until Mike connects his backend. Never show a success message for a real visitor unless the API returns a successful response. The mini-forms on index GET-submit to `/visibility-report?service=&location=` which prefills via the small script there — keep that behavior.

## Do not touch without asking Mike
- The interactive 3-Pack map component on index (`#bym-map`) — best element on the site.
- Pricing numbers ($450/mo, $1,750 once) and the 93% stat + SOCi source line.
- Legal pages content (lawyer review pending).
- Approved customer quotes; do not invent or publish quotes without permission.

## Current state / open items
- Add the production API URL to each native form's `data-endpoint` and test persistence.
- Approved owner quotes can be added later; the current proof cards contain measured result summaries only.
- Mike plans his own full content rewrite pass.
- Speech bubble text ("Hey, found you!") will be replaced by Mike.
- Domain not yet switched from the old GHL site — launch checklist lives in README.md.
