-- Page queue row for /agency-partners (W2). Run through the brain connector (brain.web_page_queue).
-- A utility page for existing partners: noindex, no target query, not in the sitemap. The owner named it
-- (Mike, 2026-11-13, OX-8 and OX-9 in PRODUCT-CRM), so the row goes in as approved and goes straight to pr_open.
insert into brain.web_page_queue (site_key, slug, page_type, primary_keyword, secondary_keywords, cluster,
                                  parent_slug, priority, status, notes)
values ('bym', '/agency-partners', 'utility', null, null, 'partner-portal',
        null, 50, 'approved',
        $t$named by Mike 2026-11-13 (OX-8, OX-9): the footer's "Agency Partners" page, one email field, one fixed answer, no agency list. noindex, not in the sitemap, job: conversion/utility, never judged on rank (rank-check Check 1 not applicable: no query).$t$)
on conflict (site_key, slug) do update
  set status = 'approved', notes = concat_ws(' | ', brain.web_page_queue.notes, excluded.notes), updated_at = now()
returning id;

-- After the PR opens (replace <id> and the PR url):
update brain.web_page_queue set status = 'pr_open', pr_url = '<PR url>', updated_at = now() where id = <id>;
