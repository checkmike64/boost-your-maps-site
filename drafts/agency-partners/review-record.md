# Review record: /agency-partners (W2)

Store this in `brain.content_items` once Mike has approved the preview (SQL: `page-pipeline/references/queue-lifecycle.md`,
"Step 7"). `brain_id` = the `bym` site's `web_sites.brain_id`; tags `page-pipeline`, `web-page`, `site:bym`,
`queue:<id>`, `reviewer:mike`, `new`.

```
Researched and drafted with AI assistance.
Written, fact-checked and edited by Mike Moll, <YYYY-MM-DD>.
Substantive changes: <what Mike changed or asked for>
Figures checked against: none; the page and its messages hold no figure. Process facts (no password, one
fixed answer, a person reads each report first, one report per agency every 5 minutes) checked against
PRODUCT-CRM US-66.2, US-79 and bym-crm-mint docs/reference/integrations.md.

Page: /agency-partners (new), queue <id>, PR <url>
Overlap: new, nothing in the way (no target query; private utility page)
Gates: seo_audit 0 new findings (30 findings, all on HEAD already; none on /agency-partners); page_gate n/a
       (no figures, noindex); local_gate n/a; overlap --draft n/a; slopcheck 0 HARD (see below);
       read-aloud done; critic <PENDING: integrator runs the independent critic pass>
Cadence: n/a (noindex utility page, no index event)
Repo checks: validate_site.py pass; check_local_pages.py PASS; check_partner_access, check_partner_report,
       check_footer, check_csp, check_signup_payload, check_crm_payload, check_agreement_payload,
       check_tracking, check_review_link all pass
```

## Copy gate (anti-ai-writing)

`slopcheck.py --split --bans guardrail-bans.txt` on the page text (`page_text.py`) and on the other copy:
0 HARD hits, 0 pieces over the grade. Grades 2.9 to 5.6. Remaining warnings, kept on purpose:
- "closes on a tidy line" on two error messages and the signup page's help line: each ends on the next step the
  reader takes ("try again in a minute, or email the team"), which the skill allows ("end on the last useful thing").
- The title and meta description piece grades 7.2, but it is a no-grade piece.

## Copy for the independent critic (fresh agent, `anti-ai-writing/references/critic-brief.md`)

Audience: agency owners who already work with Boost Your Maps. Voice: plain, fifth grade, BYM brief.
1. `agency-partners.html` (all visible copy; extract with `page_text.py`).
2. The answer: "If that email belongs to a partner, we sent a sign-in link." (`api/_partner.js`, `assets/agency-partners.js`)
3. Error messages in `assets/agency-partners.js`: "Please check the email address.", "Too many tries in a row. Please
   wait an hour and try again, or email team@boostyourmaps.com.", "We can't send the link right now. Please try
   again in a minute, or email team@boostyourmaps.com."
4. Footer link label: "Agency Partners".
5. `partners/signup.html`, the new block: "Already a partner? Open your partner portal and sign up your client from
   there, and the form will know your agency." / "Open your partner portal →" / "If your portal won't open, you
   can pick your agency from the list below."
6. `partners/portal.html` and `assets/portal.js`: the "Run a report" and "Reports you ran" sections, "Reports"
   column text ("Link expired: ask us for a new one", "None yet"), states ("Building", "Being reviewed", "Ready",
   "Declined", "Link expired", "We couldn't run this one. Ask your BYM contact."), the run messages ("Got it. We
   are building your report. It will show in your list below when it is ready.", "You can run another report in N
   minutes.", "You can run one report every 5 minutes.", "Too many tries in a row. Please wait a minute and try
   again.", "We can't take that right now. ...", "Business search is not on right now, so email ...").
