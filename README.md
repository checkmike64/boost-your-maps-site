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

### Visibility report form: business search, wait time, bot check

- **Business search.** `assets/place-search.js` (only on `/visibility-report`) calls this site's
  `/api/places` (Google Places API (New) autocomplete, key `GOOGLE_PLACES_API_KEY`, server side only,
  so the CSP is unchanged). Picking a result fills hidden `place_id` and `place_label`; the endpoint
  sends them to the CRM as top-level `placeId` and `placeLabel`, the two fields the CRM's
  `POST /api/forms/visibility-report` takes beside `answers` (the CRM never stores the label). The
  Place ID is optional: with no JavaScript, search off or down, the typed business name and town go
  through as before.
- **Asked too recently.** When the CRM files the lead but answers `report: "rate_limited"` with
  `retryAfterSeconds`, `api/_lead.js` passes both on and `assets/forms.js` shows "You asked for this
  report a few minutes ago. You can ask again in N minutes." and disables only the submit button until
  the time passes (`assets/retry-countdown.js`). The honeypot is unchanged.
- **Turnstile (off today).** `assets/forms.js` calls `humanCheck(form)` for forms marked
  `data-human-check` (a no-op that sends no token), and `api/_human.js` checks the token on the server
  only when BOTH `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set. To turn it on: (1) create a
  Turnstile widget in Cloudflare for boostyourmaps.com; (2) in `vercel.json` add
  `https://challenges.cloudflare.com` to `script-src`, `frame-src` and `connect-src`, and update the
  asserts in `scripts/check_csp.js` (Mike decides, per that file); (3) load Cloudflare's
  `api.js` on the page and make `humanCheck` resolve with the widget token (sent as `human_token`);
  (4) set the two env vars in Vercel. Do step 4 last: with the secret set and no token sent, every
  submission is refused. A Cloudflare outage lets visitors through. `node scripts/check_visibility_form.js`
  covers all of this with fakes.

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
- `/partners/portal#k=<token>`: an agency's clients, their monthly report links, the reports it ran,
  and a "Run a report" form (business search, service, area) that posts to `api/partner-report.js`.
- `/agency-partners`: where the footer's "Agency Partners" link goes (`/partners` redirects to it). One
  email field. `api/partner-access.js` asks the CRM to email that agency its portal link and gives the
  same answer for every email, so the page never shows or hints at which agencies exist. noindex, not in the
  sitemap. `/partners/signup` leads with a link here and keeps its agency dropdown as the fallback.
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
network; CI runs both, plus `check_partner_access.js`, `check_partner_report.js`, `check_footer.js`
and `check_csp.js` for the agency partner pages.

**Where a paid signup came from.** `assets/tracking.js` keeps a first touch in the browser
(`localStorage` key `bym_first_touch`, for 90 days): the landing address, the site that sent
the visitor, the `utm_*` values, the ad click ids (`gclid`, `gbraid`, `wbraid`, `fbclid`) and
the time. It is written on the first page view and not overwritten. The landing has no hash,
and its query keeps those campaign values and nothing else, so a welcome, agreement or portal
key, or an email in a link, is never kept. The signup start and the agreement signature send
it as `attribution`; the `utm` and `sourceUrl` of the signup page itself go as before.
`attributionFrom` in `api/_crm.js` passes it to the CRM only when it is well formed: known
keys, strings up to 500 characters, 3,000 bytes in all, a landing on this site, a referrer as
origin and path, a first-seen time within 90 days. Anything else drops it whole, and the
browser keeps nothing the function would drop. Attribution can never be why a signup fails:
when the CRM answers 400 to a body that carried it, the site's function asks once more
without it and uses that answer.

**The purchase event.** The welcome page pushes one `purchase` event to Tag Manager the first
time it sees the signup paid, in the browser that started the checkout. That browser is
marked at `begin_checkout` and when the agreement page sends its signer to Stripe
(`localStorage` key `bym_checkout_started`, a time and nothing else, good for 7 days and used
up by the push). Another browser that opens the same welcome link has no marker and pushes
nothing. `transaction_id` is the SHA-256 of the welcome token (never the token), and `value`
is the checkout total the CRM sends as `amountCents`; without an amount nothing is pushed. A
second key made from the start of that hash stops a reload from pushing twice. Nothing goes
to the Meta pixel: the CRM's server-side conversion is the one ad platforms count.

`node scripts/check_tracking.js` runs the three page scripts against a stand-in browser and
follows a first touch to the body the CRM receives; CI runs it.

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

Every new page goes through `ai-skills/shared/page-pipeline` (see CLAUDE.md). The templates below are its step 4 markup.

- **Service pages:** `templates/service-page-template.html`. READ THE
  COMMENT BLOCK AT THE TOP — it encodes Google's spam policies (no city-list stuffing,
  no doorway pages, every page needs real unique local content).
- **City pages** (`/google-maps-marketing/<industry>/<city-st>`): market reports for a named prospect or
  campaign (sales assets, never built to rank), on the local-pages skeleton in
  `templates/local-service-page-main.html`, built from real local data. See `local-pages/README.md`.
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
