# Intent check: /agency-partners

**Page:** `/agency-partners` (file `agency-partners.html`). The footer link "Agency Partners" on every page opens it.

**What the reader does:** an agency that already works with Boost Your Maps types its agency email and gets the
link to its own partner portal by email. The page lists no agency and gives one answer for every email.

**Target query:** none. The page is `noindex, nofollow`, has no canonical, is not in `sitemap.xml` or `llms.txt`,
and is sent `X-Robots-Tag: noindex` and `Cache-Control: no-store` (`vercel.json`). It is a private utility page
like `/welcome` and `/agreement`, so rank-check Check 1 and Check 2 do not apply and the page is never judged on rank.

**Which URL owns the intent today:** none. `/partners` has no page of its own (only `/partners/portal` and
`/partners/signup`, both private). `/partners/signup` stays the agency signup page and now links here first.
The spec calls the page `/partners` (PRODUCT-CRM US-79, BUILD-PLAN 4.1); the W2 brief named `/agency-partners`, so
that is the URL, and `vercel.json` sends `/partners` to it (temporary redirect) so either address works.
Overlap script: not run (no query to collide with; the only look-alikes are the two private partner pages above).

**Evidence nobody else can fabricate:** none is claimed. The page makes no market claim and holds no figure.
The only facts are how the portal works (CRM b23, US-79), each taken from the spec.

**Reviewer:** Mike Moll (owner). The page is not live to search engines either way: approval is for the copy and
the flow, then the merge.
