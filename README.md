# Boost Your Maps — website

Static multi-page site for **boostyourmaps.com**, designed to replace the current GoHighLevel pages. No build step: plain HTML + one shared stylesheet. Deploys as-is on Vercel (or any static host).

## Structure

```
index.html                 Homepage (incl. interactive 3-Pack demo + on-page report teaser forms)
about-us.html              About
services.html              Services
visibility-report.html     THE conversion page — free report request form
inquiry-form.html          Contact / inquiry form
privacy.html               Privacy Policy
terms.html                 Terms & Conditions (site terms; NEW page)
service-agreement.html     Client service agreement (existing content)
404.html                   Custom not-found page
assets/styles.css          The entire design system (see DESIGN.md for the rules)
assets/forms.js            Native validation + API-ready JSON submission handling
assets/favicon.svg, og.png, icon-512.png
robots.txt                 Allows all search + AI crawlers, declares sitemap
llms.txt                   AI-engine site overview (llmstxt.org format)
sitemap.xml                All 8 canonical pages
vercel.json                cleanUrls + 301 /rank-report → /visibility-report
templates/                 Copy-paste templates for new SERVICE PAGES and BLOG POSTS
DESIGN.md                  The design system contract — follow it for anything new
```

## THE TWO FORMS — API connection required before launch

`visibility-report.html` and `inquiry-form.html` use native HTML forms with browser
validation and shared submission handling in `assets/forms.js`. Each form sends JSON,
shows accessible loading/success/error states, and includes a spam honeypot.

To connect a backend, set each form's empty `data-endpoint` attribute to its API URL.
The request body contains `form_type`, `submitted_at`, `page_url`, and a `fields` object.
Until an endpoint is configured, the form honestly directs visitors to the business email
instead of pretending an unpersisted submission succeeded.

The two mini-forms on `index.html` are intentional teasers — they GET-submit to
`/visibility-report?service=…&location=…`, which prefills the real form via the small
script on that page. No backend needed for those.

## Deploy (Vercel)

```
git init && git add -A && git commit -m "Boost Your Maps site v1"
git remote add origin https://github.com/checkmike64/boost-your-maps-site.git
git branch -M main && git push -u origin main
```
Then in Vercel: Add New → Project → import the repo → Framework preset: **Other** →
no build command, output dir = root. Every push to `main` auto-deploys.

A preview deployment of this exact package already exists (see the project in the
Vercel dashboard) for click-through testing before the domain switch.

## Domain switchover checklist

1. Add the two API endpoints (above) and test that both submission types persist successfully.
2. In Vercel → Project → Domains: add `boostyourmaps.com` + `www.boostyourmaps.com`
   (www is the canonical — all canonicals/sitemap use www; Vercel will 308 apex → www).
3. Update DNS at the registrar per Vercel's instructions (A/ALIAS + CNAME).
4. After cutover, verify: `/rank-report` 301s to `/visibility-report`; 404 page works;
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

## Notes

- Legal pages were carried over from the live site (privacy, service agreement) plus a new
  Terms & Conditions. **Have a lawyer review all three** — they were prepared editorially,
  not as legal advice.
- Proof cards on the homepage contain two placeholder owner quotes pending client permission.
- Design rules live in DESIGN.md. The short version: one red, three text sizes, hairlines,
  no colored section bands, flat simple mascot only.
