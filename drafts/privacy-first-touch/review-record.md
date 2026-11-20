# Review record: /privacy, first-touch passage (W1)

Update to a live page (`/privacy`), same chain as a new page. Store in `brain.content_items` after Mike's yes
(SQL: `page-pipeline/references/queue-lifecycle.md`, "Step 7"). Tags `page-pipeline`, `web-page`, `site:bym`,
`reviewer:mike`, `update`. Mike approved adding the line on 2026-11-16 (decision when PR #44 was split).

```
Researched and drafted with AI assistance.
Written, fact-checked and edited by Mike Moll, 2026-11-20.
Substantive changes: <what Mike changed or asked for>
Figures checked against: the one figure, 90 days, is FIRST_TOUCH_MS in assets/tracking.js; the list of what
the note holds is tracking.js (landing, referrer, utm_*, gclid/gbraid/wbraid/fbclid, first_seen_at); "we send
the note to our CRM at signup or agreement" is assets/signup.js, assets/agreement.js and api/_signup.js
(attributionFrom); the deletion contact is the page's own section 10.

Page: /privacy (update), PR <url>
Overlap: update-existing, the page's own URL; no new URL, no sitemap or llms.txt change
Gates: page_gate n/a (no money figure or claim row); slopcheck 0 HARD, 0 pieces over grade (grade 4.7; 2 WARN kept:
       a 26-word list sentence, and the closing line is the deletion instruction); read-aloud done;
       critic PASS (independent Sonnet agent, 2026-11-20; no AI tells, every fact matches the code; two optional notes kept as is)
Cadence: n/a (a legal-page update, no new page; effective date set to November 20, 2026, the merge day)
Repo checks: validate_site.py, check_local_pages.py and every node check_* in site-checks.yml pass
```

## What the passage says, and what the code does

| Sentence | Where it comes from |
|---|---|
| "your browser saves a short note for 90 days" | tracking.js writes `bym_first_touch` to localStorage on the first page view; never overwritten while under 90 days old |
| the page you landed on, the site that sent you, UTM tags, ad click ids, the date | `landing` (campaign values only, no hash), `referrer` (origin and path, never this site), `utm_*`, `gclid` `gbraid` `wbraid` `fbclid`, `first_seen_at` |
| "Nothing you type goes in it" | no form field is read; private-link keys (t, k, id, m, crm_vid) and 64-hex values are stripped |
| "If you sign up or sign an agreement, we send the note to our CRM" | only the signup start and the agreement signature send it (`attribution`); no other form does |
| "keep it with your signup" | the CRM keeps it on the signup. The 90 days is the browser's; W1 sets no CRM retention |
| "To have it deleted, email team@boostyourmaps.com" | the privacy page's section 10 contact |

## Copy for the independent critic (fresh agent, `anti-ai-writing/references/critic-brief.md`)

Audience: a small business owner reading the privacy page before signing up. Voice: plain, fifth grade, BYM brief.
Exact new text (section 6, "Cookies & tracking", after the Google Analytics and Meta Pixel paragraph):

> When you first visit, your browser saves a short note for 90 days. It holds the page you landed on, the site that sent you, the campaign tags in the link (UTM), the ad click ids and the date. Nothing you type goes in it. If you sign up or sign an agreement, we send the note to our customer database (our CRM) and keep it with your signup. We use it to see which marketing brings in customers. To have it deleted, email team@boostyourmaps.com.

Also: the changed "Effective date: November 16, 2026" line. Integrator: set the date to the merge day.
