// Shared by the two agency partner functions (api/partner-access.js and
// api/partner-report.js): which requests are allowed in, and a small
// per-visitor limit. Nothing a visitor typed is logged here or kept.

const { clientIpFrom } = require("./_crm");

// Where the site is served: the live site, this project's Vercel previews and
// a local run (the same origins api/places.js takes requests from). Kept here
// so this piece does not depend on api/_crm.js changes.
const SITE_ORIGINS = [
  /^https:\/\/(www\.)?boostyourmaps\.com$/,
  /^https:\/\/boostyourmaps-[a-z0-9-]+-mike-8166s-projects\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

// The one answer the Agency Partners page gives for every email. The page
// (assets/agency-partners.js) shows this exact text, so nothing the page says
// can tell a partner's email from any other.
const NEUTRAL_MESSAGE = "If that email is on file for a partner, we sent your portal link. Check your spam folder if it has not come in a few minutes.";

// The request came from one of this site's own pages. A form posted from
// another site carries another Origin (or none, and no Referer), so it is
// refused. The same rule api/places.js uses.
function allowedOrigin(headers) {
  const h = headers || {};
  let origin = h.origin;
  if (!origin && h.referer) {
    try {
      origin = new URL(h.referer).origin;
    } catch {
      origin = "";
    }
  }
  return Boolean(origin) && SITE_ORIGINS.some((re) => re.test(origin));
}

// A page script sends JSON. A plain cross-site form cannot, so this is a
// second check beside the origin.
function isJsonRequest(headers) {
  return /^application\/json(\s*;|$)/i.test(String((headers || {})["content-type"] || ""));
}

// A rolling window per visitor, plus a ceiling for the whole function
// instance. Both live in memory, so they start over when Vercel starts a new
// instance; the CRM keeps its own limits (5 an hour per visitor for access,
// one report per agency every 5 minutes) and is the hard stop.
function createLimiter({ windowMs, perVisitor, perInstance }) {
  const visitors = new Map();
  let all = [];

  function recent(list, now) {
    return list.filter((t) => now - t < windowMs);
  }

  return {
    // True when this request may go on, and counts it.
    take(headers, now = Date.now()) {
      const key = clientIpFrom(headers || {}) || "unknown";
      all = recent(all, now);
      if (all.length >= perInstance) return false;
      const mine = recent(visitors.get(key) || [], now);
      if (mine.length >= perVisitor) {
        visitors.set(key, mine);
        return false;
      }
      mine.push(now);
      all.push(now);
      visitors.set(key, mine);
      if (visitors.size > 5000) {
        for (const [name, list] of visitors) {
          if (!recent(list, now).length) visitors.delete(name);
        }
      }
      return true;
    },
    reset() {
      visitors.clear();
      all = [];
    },
  };
}

module.exports = { NEUTRAL_MESSAGE, allowedOrigin, isJsonRequest, createLimiter };
