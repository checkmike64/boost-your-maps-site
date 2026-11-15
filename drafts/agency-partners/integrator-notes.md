# What the integrator runs for W2

1. Brain: insert the queue row (`queue-row.sql`), keep the id, then after the PR opens set it `pr_open`. After Mike
   approves and the merge deploys: the `live` update, a `published`-style `web_index_events` row is NOT needed
   (noindex, not in the sitemap) but the queue row still goes to `live` with `live_url`.
2. Review record: `review-record.md`, after the critic pass and Mike's yes.
3. Open the PR on branch `crm-int-w1` (or its successor) from the pushed branch. W2 merges after b21 and b23 are live.
4. No new environment variable and no new host. Needs the existing `CRM_URL`, and `GOOGLE_PLACES_API_KEY` for the
   portal's business search (without it the portal's run form shows a way to email the team).
5. CRM endpoints used: `POST /api/partners/access` ({email, clientIp, userAgent}, always `{ok:true}`),
   `POST /api/partners/portal/{k}/reports` ({placeId, placeLabel?, businessName?, websiteUrl?, keyword, area?} ->
   `{ok, report: queued | rate_limited, retryAfterSeconds?}`), `GET /api/partners/portal/{k}` (now with `reports` and
   `requestedReports`), `GET /api/signup/partners` (unchanged, the fallback dropdown).
6. The CRM's emailed link points at `{signup_site_url}/partners/portal#k=...`, which exists; the CRM never links to the
   entry page, so its URL does not need to be told to the CRM.
