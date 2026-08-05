# Boost Your Maps site — handoff to finish deploy

**Status:** The website uses the approved Style A design (locked 2026-08-04) and is
a no-build static HTML site. The two full-page forms are native, API-ready forms.
Before production launch, add their endpoint URLs, verify real submissions persist,
then push this workspace to GitHub and deploy it on Vercel.

- **GitHub repo (already created, currently empty):** https://github.com/checkmike64/boost-your-maps-site
- **Local repo (this folder):** `/Users/mikemoll/Documents/BYM` on `main`.
- **Why it isn't live yet:** the fine-grained token provided was **Contents: Read-only**, so
  `git push` and the GitHub Contents API both returned 403. A write-capable credential fixes it.

---

## Step 1 — Push to GitHub (pick ONE)

### Option A — GitHub Desktop (no token)
1. GitHub Desktop → **File → Add local repository** → choose this folder.
2. It will show the existing commit + `origin`. Click **Push origin**. Done.

### Option B — Command line with a WRITE token
Use a fine-grained token with **Contents: Read and write** on this repo, OR a
classic token with the **`repo`** scope. Then:
```bash
cd "path/to/bym-site-package"
git push https://x-access-token:<TOKEN>@github.com/checkmike64/boost-your-maps-site.git main:main
```
(Editing the existing fine-grained token's Contents permission to "Read and write"
is enough — the token string stays the same.)

### Option C — Hand to Codex
Give Codex this folder + a write-capable GitHub token and say: "push this git repo
to origin/main." It's a one-liner (Option B).

---

## Step 2 — Deploy on Vercel (static, no build)

**IMPORTANT:** a throwaway Vercel project named `boost-your-maps-site` already exists
and is wrongly **locked to the `astro` framework** (it errors with
`astro: command not found`). Delete it first, or the import will collide/misbuild.

- Team: `mike-8166's projects` (id `team_MRAjTtFXD7eEe2wGC3q9lMuZ`)
- Broken project id to delete: `prj_9pxN0VFUJcEwy9PBx81fXHmBPoN8`
  (Vercel → that project → **Settings → Advanced → Delete Project**)

Then:
1. Vercel → **Add New → Project → Import** the `boost-your-maps-site` GitHub repo.
2. **Framework Preset: `Other`** (critical — this is a plain static site, no build).
3. Leave **Build Command** empty, **Output Directory** = root (default).
4. **Deploy.** ~15s later you get a preview + production URL.
   `vercel.json` auto-applies (cleanUrls + `/rank-report` → `/visibility-report` 301).

Every future push to `main` then auto-redeploys.

---

## Notes
- **www is canonical** — all canonicals + `sitemap.xml` use `https://www.boostyourmaps.com`.
  At domain switch, add both `boostyourmaps.com` and `www.boostyourmaps.com` in Vercel
  (Vercel 308s apex → www). Full domain checklist is in `README.md`.
- Forms are native HTML + JavaScript and intentionally have blank `data-endpoint`
  attributes. Set those to the future API URLs and test both flows before launch.
- Design law is `DESIGN.md`; repo workflow is `CLAUDE.md`. Do NOT redesign — this is locked.
- The two homepage proof-card quotes and the mascot 3D render are owner placeholders.
