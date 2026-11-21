// BYM CRM side of a form submission: posts it to the CRM's public forms API,
// POST ${CRM_URL}/api/forms/<slug> (api/_lead.js runs it). Server to server,
// so the site's CSP does not apply. With CRM_URL unset, nothing here runs.
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

// The CRM keeps phones in E.164. BYM serves the US and Canada, which share +1,
// so once punctuation is gone a 10-digit number gets +1 and an 11-digit one
// starting with 1 gets +. A number typed with + must be +<8-15 digits>.
// Anything else is sent as null.
function e164(value) {
  const phone = text(value).replace(/[\s().\- ]/g, "");
  if (phone.startsWith("+")) return /^\+[0-9]{8,15}$/.test(phone) ? phone : null;
  if (/^[0-9]{10}$/.test(phone)) return `+1${phone}`;
  if (/^1[0-9]{10}$/.test(phone)) return `+${phone}`;
  return null;
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

// First-touch attribution: where the visitor's browser first came from.
// assets/tracking.js keeps it in the browser for 90 days, and the signup start
// and the agreement signature send it along. The CRM takes these keys only,
// each a string of at most 500 characters, in a 4,096-byte column.
const CAMPAIGN_PARAMS = [...UTM_KEYS, "gclid", "gbraid", "wbraid", "fbclid"];
const ATTRIBUTION_KEYS = ["landing", "referrer", ...CAMPAIGN_PARAMS, "first_seen_at"];
const ATTRIBUTION_VALUE_MAX = 500;
// The whole object as JSON, in bytes: well inside the CRM's column.
const ATTRIBUTION_BYTES_MAX = 3000;
// Control characters, the line and paragraph separators, and half an emoji:
// the CRM's database refuses some of them.
const UNSAFE_TEXT_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// The shape of the welcome, agreement and portal tokens, anywhere in a value.
const KEY_SHAPED_PATTERN = /[0-9a-f]{64}/i;
// A time as the browser writes it: "2026-11-15T18:00:00.000Z".
const FIRST_SEEN_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// The browser keeps a first touch for 90 days. A day either way is allowed for
// a clock that is off.
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_SEEN_MAX_AGE_MS = 91 * DAY_MS;
// How a spreadsheet formula starts. A value like that is left out, so an
// export of the CRM opened in a spreadsheet never runs one.
const FORMULA_PATTERN = /^[=+\-@]/;
// Where the site is served: the live site, this project's Vercel previews and
// a local run (the same origins api/places.js takes requests from).
const SITE_ORIGINS = [
  /^https:\/\/(www\.)?boostyourmaps\.com$/,
  /^https:\/\/boostyourmaps-[a-z0-9-]+-mike-8166s-projects\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

// The landing address as the CRM gets it, or null when it is not one of the
// site's own pages. Only the campaign values stay in its query (the five
// utm_* and the four click ids), so whatever else a link carried, such as an
// email or a phone number, is never stored.
function landingFrom(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (value.includes("#") || url.username || url.password) return null;
  if (!SITE_ORIGINS.some((origin) => origin.test(url.origin))) return null;
  const query = new URLSearchParams();
  for (const [name, item] of url.searchParams) {
    if (CAMPAIGN_PARAMS.includes(name)) query.append(name, item);
  }
  const landing = url.origin + url.pathname + (query.toString() ? `?${query}` : "");
  return landing.length <= ATTRIBUTION_VALUE_MAX ? landing : null;
}

// The site that sent the visitor: an http(s) address, or a phone app's
// (android-app://...), as origin and path only. A query or a fragment can
// hold someone else's keys, so a referrer with either is not taken.
function isReferrer(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:", "android-app:"].includes(url.protocol) && !url.username && !url.password && !value.includes("?") && !value.includes("#");
  } catch {
    return false;
  }
}

// The `attribution` object a page posted, as the CRM receives it, or null for
// none. Attribution must never be why the CRM refuses a signup or a signature,
// and must never carry a private link, so anything odd drops the whole object:
// not a plain object; a value under a key the CRM knows that is not a string,
// is over 500 characters, holds a control character or half an emoji, or is
// shaped like a key (64 hex characters in a row); a landing that is not a page
// of this site, has a login in it or still has its fragment; a referrer that
// is not a plain address; a first-seen time in another shape, over 90 days
// old or in the future (a day of slack either way); an object too large for
// the CRM's column. Left out, with the rest still sent: keys the CRM does not
// know, blank values, values that start like a spreadsheet formula, and
// everything in the landing's query but the campaign values.
function attributionFrom(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (typeof value[key] !== "string") return null;
    const typed = value[key].trim();
    if (!typed) continue;
    if (typed.length > ATTRIBUTION_VALUE_MAX || UNSAFE_TEXT_PATTERN.test(typed) || KEY_SHAPED_PATTERN.test(typed)) return null;
    if (FORMULA_PATTERN.test(typed)) continue;
    attribution[key] = typed;
  }
  if (attribution.landing) {
    attribution.landing = landingFrom(attribution.landing);
    if (!attribution.landing) return null;
  }
  if (attribution.referrer && !isReferrer(attribution.referrer)) return null;
  if (attribution.first_seen_at) {
    const seen = FIRST_SEEN_PATTERN.test(attribution.first_seen_at) ? Date.parse(attribution.first_seen_at) : NaN;
    if (Number.isNaN(seen) || now - seen > FIRST_SEEN_MAX_AGE_MS || seen - now > DAY_MS) return null;
  }
  if (!Object.keys(attribution).length) return null;
  return Buffer.byteLength(JSON.stringify(attribution), "utf8") <= ATTRIBUTION_BYTES_MAX ? attribution : null;
}

// What the visitor picked in the report form's business search. The CRM's
// visibility-report route takes these two beside the answers (placeId up to
// 1,024 characters, placeLabel up to 500, the label never stored) and asks for
// the report with them. The Place ID is optional: a typed business name and
// town still go through. A value that is not shaped like a Place ID is dropped
// rather than sent (the same shape api/places.js hands out).
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{20,512}$/;

function placeFrom(fields) {
  const placeId = text(fields.place_id);
  if (!PLACE_ID_PATTERN.test(placeId)) return {};
  const label = cut(text(fields.place_label).replace(UNSAFE_TEXT_PATTERN, " "), 500);
  return { placeId, ...(label ? { placeLabel: label } : {}) };
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
// the CRM needs one.
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
    ...placeFrom(fields),
    sourceUrl: sourceUrlFrom(pageUrl),
    utm: utmFrom(pageUrl),
    visitorId: null, // no visit tracker on this site (the coaching site's visits.js)
    clientIp: clientIpFrom(headers || {}),
    userAgent: userAgentFrom(headers || {}),
  };
}

// The report step of the CRM's answer: { report: "queued" } or
// { report: "rate_limited", retryAfterSeconds }, or nothing for any other form
// or an answer that is not one of those two.
const RETRY_MAX_SECONDS = 24 * 60 * 60;

function reportFrom(data) {
  if (data && data.report === "rate_limited") {
    const seconds = data.retryAfterSeconds;
    if (Number.isInteger(seconds) && seconds > 0 && seconds <= RETRY_MAX_SECONDS) {
      return { report: "rate_limited", retryAfterSeconds: seconds };
    }
    return { report: "rate_limited", retryAfterSeconds: 20 * 60 };
  }
  return data && data.report === "queued" ? { report: "queued" } : {};
}

// Posts one submission. Resolves { ok: true } only when the CRM answered that
// it stored the lead, and never throws. Failures are logged as "BYM CRM ...";
// no submitted value is logged.
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

    return { ok: true, ...reportFrom(data) };
  } catch (err) {
    console.error("BYM CRM submission error", slug, err);
    return { ok: false };
  }
}

module.exports = {
  crmConfigured,
  sendToCrm,
  buildCrmPayload,
  reportFrom,
  // Shared with the signup functions (api/_signup.js), unchanged.
  crmUrl,
  text,
  cut,
  e164,
  pageUrlFrom,
  sourceUrlFrom,
  utmFrom,
  clientIpFrom,
  userAgentFrom,
  // Shared by the signup start and the agreement signature.
  attributionFrom,
};
