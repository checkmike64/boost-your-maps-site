// BYM CRM side of a form submission: posts it to the CRM's public forms API,
// POST ${CRM_URL}/api/forms/<slug>, next to the GoHighLevel upsert in
// api/_ghl.js (api/_lead.js runs both). Server to server, so the site's CSP
// does not apply. With CRM_URL unset, nothing here runs.
//
// The CRM refuses a whole submission over one value it cannot take, so each
// value is shaped here to what its forms API accepts: a name (120 characters),
// an email, an E.164 phone or null, answers keyed like its form fields, the
// page URL (2,048 characters) and at most the five utm_* values. The API has
// no field for ad click ids, so gclid and fbclid travel inside the page URL.

const TIMEOUT_MS = 8000;

// The CRM form each site form fills, and the env var that can rename it.
const FORM_SLUG_ENV = {
  "visibility-report": "CRM_FORM_VISIBILITY_REPORT",
  inquiry: "CRM_FORM_INQUIRY",
};

// Site form fields sent as answers under their form names, with the longest
// answer the CRM keeps for each: 500 characters for one-line text, 5,000 for
// long text. The CRM drops any answer its form does not define.
const ANSWER_LIMITS = {
  business_name: 500,
  service: 500,
  location: 500,
  website: 500,
  service_interest: 500,
  active_marketing: 500,
  message: 5000,
};

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

function crmUrl() {
  return (process.env.CRM_URL || "").trim().replace(/\/+$/, "");
}

function crmConfigured() {
  return crmUrl() !== "";
}

function crmSlug(form) {
  return (process.env[FORM_SLUG_ENV[form]] || "").trim() || form;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

// At most `max` characters, without cutting an emoji in half (the CRM's
// database refuses half of one).
function cut(value, max) {
  const head = value.slice(0, max);
  return head.length < value.length && /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

// The CRM keeps phones in E.164 and never guesses a country code, so neither
// does this: punctuation goes, a leading 00 becomes +, and a number still not
// shaped +<8-15 digits> is sent as null. GHL gets the number as typed.
function e164(value) {
  let phone = text(value).replace(/[\s().\- ]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  return /^\+[0-9]{8,15}$/.test(phone) ? phone : null;
}

function pageUrlFrom(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

// The page the form was sent from, query included (UTMs, ad click ids, the
// report prefill). A URL longer than the CRM keeps goes without its query.
function sourceUrlFrom(url) {
  if (!url) return null;
  if (url.href.length <= 2048) return url.href;
  const bare = url.origin + url.pathname;
  return bare.length <= 2048 ? bare : null;
}

function utmFrom(url) {
  const utm = {};
  if (!url) return utm;
  for (const key of UTM_KEYS) {
    const value = text(url.searchParams.get(key));
    if (value) utm[key] = cut(value, 200);
  }
  return utm;
}

function answersFrom(fields) {
  const answers = {};
  for (const [key, max] of Object.entries(ANSWER_LIMITS)) {
    const value = text(fields[key]);
    if (value) answers[key] = cut(value, max);
  }
  return answers;
}

// The visitor's address and browser, read the way the coaching site's
// api/lead.js reads them. The CRM passes both to Meta's Conversions API and
// refuses an address over 64 characters, so anything not shaped like an IP
// address is sent as null.
function clientIpFrom(headers) {
  const forwarded = String(headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || String(headers["x-real-ip"] || "").trim();
  return /^[0-9A-Fa-f:.]{3,64}$/.test(ip) ? ip : null;
}

function userAgentFrom(headers) {
  return cut(text(headers["user-agent"]), 512) || null;
}

// The JSON body the CRM receives for one submission (the body forms.js posts,
// plus the request headers), or null when there is no email to file it under:
// the CRM needs one, while GHL can still take a phone-only lead.
function buildCrmPayload(body, headers) {
  const fields = (body && body.fields) || {};
  const email = text(fields.email);
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = [text(fields.first_name), text(fields.last_name)].filter(Boolean).join(" ");
  const pageUrl = pageUrlFrom(body && body.page_url);
  return {
    name: cut(name || email.split("@")[0], 120),
    email,
    phone: e164(fields.phone),
    answers: answersFrom(fields),
    sourceUrl: sourceUrlFrom(pageUrl),
    utm: utmFrom(pageUrl),
    visitorId: null, // no visit tracker on this site (the coaching site's visits.js)
    clientIp: clientIpFrom(headers || {}),
    userAgent: userAgentFrom(headers || {}),
  };
}

// Posts one submission. Resolves { ok: true } only when the CRM answered that
// it stored the lead, and never throws. Failures are logged as "BYM CRM ..." so
// they read apart from GHL's; no submitted value is logged.
async function sendToCrm(form, body, headers) {
  const slug = crmSlug(form);
  try {
    const payload = buildCrmPayload(body, headers);
    if (!payload) {
      console.error("BYM CRM submission skipped: no valid email", slug);
      return { ok: false };
    }

    const response = await fetch(`${crmUrl()}/api/forms/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // So the CRM can rate-limit the visitor rather than this function.
        ...(payload.clientIp ? { "X-Forwarded-For": payload.clientIp } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data || data.ok !== true) {
      // The CRM's error body is a code and, for a refused answer, its field key.
      console.error("BYM CRM submission failed", slug, response.status, String(JSON.stringify(data)).slice(0, 300));
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    console.error("BYM CRM submission error", slug, err);
    return { ok: false };
  }
}

module.exports = { crmConfigured, sendToCrm, buildCrmPayload };
