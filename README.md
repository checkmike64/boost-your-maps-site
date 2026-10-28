# Boost Your Maps — website

Static multi-page site for **boostyourmaps.com**. No build step: plain HTML + one shared stylesheet. Deploys as-is on Vercel (or any static host).

## Structure

```
index.html                 Homepage (incl. interactive 3-Pack demo + on-page report teaser forms)
about-us.html              About
services.html              Services
pricing.html               Canonical pricing and deliverables page
visibility-report.html     THE conversion page — free report request form
inquiry-form.html          Contact / inquiry form
privacy.html               Privacy Policy
terms.html                 Terms & Conditions (site terms; NEW page)
service-agreement.html     Client service agreement (existing content)
404.html                   Custom not-found page
assets/styles.css          The entire design system (see DESIGN.md for the rules)
assets/forms.js            Native validation + API-ready JSON submission handling
assets/favicon-character PNGs, Apple touch icon, og.png, icon-512.png, responsive mascot and report-sample WebP/AVIF files
api/                       Form endpoints: each lead goes to the BYM CRM
robots.txt                 Allows all search + AI crawlers, declares sitemap
llms.txt                   AI-engine site overview (llmstxt.org format)
pricing.txt                Machine-readable pricing for answer engines and agents
sitemap.xml                All 9 canonical pages
vercel.json                Clean URLs, redirects, caching, CSP + security headers
scripts/validate_site.py    Dependency-free SEO/accessibility/link/schema checks
.github/workflows/         Runs validation on pull requests and main
templates/                 Copy-paste templates for new SERVICE PAGES and BLOG POSTS
DESIGN.md                  The design system contract — follow it for anything new
```

## THE TWO FORMS — where the leads go

`visibility-report.html` and `inquiry-form.html` use native HTML forms with browser
validation and shared submission handling in `assets/forms.js`. Each form sends JSON
(`form_type`, `submitted_at`, `page_url`, and a `fields` object) to its `data-endpoint`,
shows accessible loading/success/error states, and includes a spam honeypot.

The endpoints, `/api/visibility-report` and `/api/inquiry`, send each lead to the BYM CRM
through its public forms API (`api/_crm.js`), at the address in the `CRM_URL` env var
(`https://crm.boostyourmaps.com`). Leads go to the CRM forms `visibility-report` and
`inquiry`; `CRM_FORM_VISIBILITY_REPORT` and `CRM_FORM_INQUIRY` change those slugs. The other
form fields arrive as answers under their form names (`business_name`, `service`,
`location`, `website`, `message`, `service_interest`, `active_marketing`), and the CRM keeps
only the ones its form defines.

The visitor sees the success message only when the CRM stored the lead. Failures are
logged as `BYM CRM ...` in the Vercel function logs. `node scripts/check_crm_payload.js`
checks what the CRM receives without touching the network; CI runs it. GoHighLevel was
removed on 2026-10-27: the site sends nothing to it.

The two mini-forms on `index.html` are intentional teasers — they GET-submit to
`/visibility-report?service=…&location=…`, which prefills the real form via the small
script on that page. No backend needed for those.

## Self-serve signup and the partner portal

Private pages the team sends by link. They are `noindex`, not in the sitemap, and not in
the nav or footer.

- `/get-started` (US, $450 a month per location), `/get-started/canada` ($300, billed in
  USD) and `/partners/signup` (agencies, $250, agency picked from a dropdown; `?partner=<slug>`
  preselects one): details form, then Stripe checkout.
  From the portal's "Sign up a new client" link (`/partners/signup#k=<portal key>`) the agency
  and its contact come from the CRM, so only the client's details are asked.
- `/welcome`: where Stripe sends the buyer. Payment, Google Business Profile access,
  a few questions, launch call.
- `/partners/portal#k=<token>`: an agency's clients and links.
- `/booked`: where the CRM's booking pages send someone who booked a call. Shows the call and
  its time, pushes `book_appointment` to Tag Manager once per meeting id, and takes the
  meeting id, token and visitor key out of the address before Tag Manager loads.
- `/agreement#t=<token>`: the service agreement the CRM emails to a lead, with their details
  filled in. They read it, sign with their typed name and go straight to Stripe to pay. Stripe
  sends them back to `/agreement?paid=1#t=<token>` (the page waits for the payment to confirm)
  or, on cancel, to `/agreement#t=<token>` ("Continue to payment"). Also sent with an
  `X-Robots-Tag: noindex` header (`vercel.json`).

The pages (`assets/signup.js`, `assets/portal.js`, `assets/agreement.js`) only call this
site's functions (`api/signup/*.js`, `api/partner-portal.js`, `api/agreement/*.js`, helpers in
`api/_signup.js` and `api/_agreement.js`), which call the BYM CRM's `/api/signup`,
`/api/partners/portal` and `/api/agreements` endpoints server to server, using the same
`CRM_URL` as the lead forms. Without it they answer 503 and the pages say to email the team.
The welcome, portal and agreement tokens move from `?t=` / `?k=` into the URL hash before
analytics loads and only travel inside POST bodies. `node scripts/check_signup_payload.js` and
`node scripts/check_agreement_payload.js` check what the CRM receives without touching the
network; CI runs both.

## Deploy (Vercel)

The canonical repository is `https://github.com/checkmike64/boost-your-maps-site`.
Clone that repository before publishing; do not force-push an independently initialized
local history. In Vercel, import the repository with Framework preset **Other**, no build
command, and the repository root as the output directory. Configure `main` as the production
branch so pull requests receive previews and merges deploy automatically.

A preview deployment of this exact package already exists (see the project in the
Vercel dashboard) for click-through testing before the domain switch.

## Domain switchover checklist

1. Test that both submission types persist successfully (see the two forms, above).
2. In Vercel → Project → Domains: add `boostyourmaps.com` + `www.boostyourmaps.com`
   (www is the canonical — all canonicals/sitemap use www; Vercel will 308 apex → www).
3. Update DNS at the registrar per Vercel's instructions (A/ALIAS + CNAME).
4. After cutover, verify: `/rank-report` redirects to `/visibility-report`, `/contact`
   redirects to `/inquiry-form`, the 404 page works, and
   `https://www.boostyourmaps.com/sitemap.xml` and `/robots.txt` resolve.
5. Google Search Console: add/verify the property, submit sitemap.xml.
6. Update the website link on the Google Business Profile if it points at any old path.

## Adding pages (SEO rules baked in)

- **Service/location pages:** copy `templates/service-page-template.html`. READ THE
  COMMENT BLOCK AT THE TOP — it encodes Google's spam policies (no city-list stuffing,
  no doorway pages, every page needs real unique local content). One service+city per page.
- **Blog posts:** copy `templates/blog-post-template.html` into `/blog/`. Answer-first
  structure, question H2s, real author byline.
- Every new page: unique title (~50-60 chars) + meta description (~150-160), one H1,
  self-canonical, add to `sitemap.xml` with lastmod. The JSON-LD blocks in the templates
  are pre-wired to the site's Organization entity.
- Before publishing, run `python3 scripts/validate_site.py`.

## Notes

- Legal pages were carried over from the live site (privacy, service agreement) plus a new
  Terms & Conditions. **Have a lawyer review all three** — they were prepared editorially,
  not as legal advice.
- Proof cards intentionally omit owner quotes until approved quotes are available.
- Design rules live in DESIGN.md. The short version: one red, three text sizes, hairlines,
  no colored section bands, flat simple mascot only.
