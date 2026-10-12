// Shared helpers for the self-serve signup and the partner portal
// (api/signup/*.js, api/partner-portal.js). The browser only ever talks to
// these site functions; they talk to the BYM CRM server to server, like
// api/_crm.js does for the lead forms, so the site's CSP stays as it is.
//
// Every value is shaped here to what the CRM's signup API accepts, and every
// answer is narrowed to the keys the pages use before it reaches the browser.
// Nothing submitted and no token is ever logged.

const {
  crmUrl,
  crmConfigured,
  text,
  cut,
  e164,
  pageUrlFrom,
  sourceUrlFrom,
  utmFrom,
  clientIpFrom,
  userAgentFrom,
} = require("./_crm");

const TIMEOUT_MS = 8000;

const PLANS = ["us", "canada", "partner"];
const LEAD_PREFERENCES = ["calls", "forms", "bookings", "orders"];
const APPROVALS = ["email", "call"];
const STAGES = ["waiting_for_payment", "setting_up", "live", "payment_issue", "paused", "canceled"];
const MAX_LOCATIONS = 20;

// Signup tokens (the welcome link) and partner portal tokens are 64
// lowercase hex characters.
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const PARTNER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

// Every error answer has the same shape: { ok: false, error, field }.
function fail(error, field = null) {
  return { ok: false, error, field };
}

const UNAVAILABLE = fail("signup_unavailable");

// ---- small shapers ---------------------------------------------------------

function isToken(value) {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

function isEmail(value) {
  return typeof value === "string" && value.length <= 320 && EMAIL_PATTERN.test(value);
}

// An http(s) URL, or null. Used for every link the CRM hands back, so a page
// never renders a javascript: or data: link.
function httpUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

// A website typed by a person: "ruizpest.com" becomes "https://ruizpest.com/".
// Returns { value } (null when blank) or { invalid: true }.
function typedUrl(value, { httpsOnly = false } = {}) {
  let typed = text(value);
  if (!typed) return { value: null };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(typed)) typed = `https://${typed}`;
  try {
    const url = new URL(typed);
    const okProtocol = httpsOnly ? url.protocol === "https:" : url.protocol === "https:" || url.protocol === "http:";
    if (!okProtocol || !url.hostname.includes(".") || url.href.length > 2048) return { invalid: true };
    return { value: url.href };
  } catch {
    return { invalid: true };
  }
}

function optionalText(value, max) {
  const typed = text(value);
  return typed ? cut(typed, max) : null;
}

function parseBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
}

function invalid(field) {
  return { error: fail("invalid_input", field || null) };
}

// ---- what the CRM receives -------------------------------------------------

// POST {CRM}/api/signup, from the body the signup pages post (assets/signup.js)
// and the request headers. Returns { payload } or { error } with the field the
// page should point at (named as the CRM names it).
function buildStartPayload(body, headers) {
  if (!body) return invalid(null);
  // The honeypot: a person never fills it. Refused quietly, nothing sent.
  if (text(body.hp_field_2026)) return invalid(null);

  const plan = text(body.plan);
  if (!PLANS.includes(plan)) return invalid("plan");

  let partner = null;
  if (plan === "partner") {
    partner = text(body.partner);
    if (!PARTNER_SLUG_PATTERN.test(partner)) return invalid("partner");
  }

  const firstName = cut(text(body.first_name), 120);
  if (!firstName) return invalid("firstName");
  const lastName = cut(text(body.last_name), 120);

  const email = text(body.email);
  if (!isEmail(email)) return invalid("email");

  const typedPhone = text(body.phone);
  const phone = e164(typedPhone);
  if (typedPhone && !phone) return invalid("phone");

  const businessName = cut(text(body.business_name), 200);
  if (!businessName) return invalid("businessName");

  const website = typedUrl(body.website);
  if (website.invalid) return invalid("websiteUrl");

  const quantity = Number(text(String(body.locations ?? "")));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LOCATIONS) return invalid("quantity");

  const pageUrl = pageUrlFrom(body.page_url);
  return {
    payload: {
      plan,
      partner,
      firstName,
      lastName,
      email,
      phone,
      businessName,
      websiteUrl: website.value,
      quantity,
      sourceUrl: sourceUrlFrom(pageUrl),
      utm: utmFrom(pageUrl),
      clientIp: clientIpFrom(headers || {}),
      userAgent: userAgentFrom(headers || {}),
    },
  };
}

// POST {CRM}/api/signup/{token}/intake, from the welcome page's step 3.
function buildIntakePayload(body) {
  if (!body) return invalid(null);

  const links = Array.isArray(body.profileLinks) ? body.profileLinks : [];
  const profileLinks = links.map(text).filter(Boolean);
  if (profileLinks.length < 1 || profileLinks.length > MAX_LOCATIONS || profileLinks.some((link) => link.length > 500)) {
    return invalid("profileLinks");
  }

  const website = typedUrl(body.websiteUrl);
  if (website.invalid) return invalid("websiteUrl");

  const mainService = cut(text(body.mainService), 200);
  if (!mainService) return invalid("mainService");

  const leadPreference = text(body.leadPreference);
  if (!LEAD_PREFERENCES.includes(leadPreference)) return invalid("leadPreference");

  const photos = typedUrl(body.photosUrl, { httpsOnly: true });
  if (photos.invalid) return invalid("photosUrl");

  const approval = text(body.approval);
  if (!APPROVALS.includes(approval)) return invalid("approval");

  return {
    payload: {
      profileLinks,
      websiteUrl: website.value,
      mainService,
      leadPreference,
      targetArea: optionalText(body.targetArea, 500),
      notes: optionalText(body.notes, 2000),
      photosUrl: photos.value,
      approval,
    },
  };
}

// ---- what the browser receives ---------------------------------------------

// The CRM's error answer, narrowed to { ok, error, field }.
function errorFrom(data) {
  const code = data && typeof data.error === "string" && ERROR_CODE_PATTERN.test(data.error) ? data.error : "signup_unavailable";
  const field = data && typeof data.field === "string" && FIELD_PATTERN.test(data.field) ? data.field : null;
  return fail(code, field);
}

function shapePartners(data) {
  const list = Array.isArray(data && data.partners) ? data.partners : [];
  return list
    .filter((p) => p && typeof p.slug === "string" && PARTNER_SLUG_PATTERN.test(p.slug) && text(p.name))
    .slice(0, 500)
    .map((p) => ({ slug: p.slug, name: cut(text(p.name), 200) }));
}

// The earlier intake answers (or, before any, the website from checkout), so
// a returning buyer sees what they sent.
function shapePrefill(prefill) {
  const p = prefill && typeof prefill === "object" ? prefill : {};
  const links = Array.isArray(p.profileLinks) ? p.profileLinks : [];
  return {
    websiteUrl: httpUrl(p.websiteUrl),
    profileLinks: links
      .filter((link) => typeof link === "string")
      .map((link) => cut(link.trim(), 500))
      .filter(Boolean)
      .slice(0, MAX_LOCATIONS),
    mainService: optionalText(p.mainService, 200),
    leadPreference: LEAD_PREFERENCES.includes(p.leadPreference) ? p.leadPreference : null,
    targetArea: optionalText(p.targetArea, 500),
    notes: optionalText(p.notes, 2000),
    photosUrl: httpUrl(p.photosUrl),
    approval: APPROVALS.includes(p.approval) ? p.approval : null,
  };
}

function shapeSignup(signup) {
  const s = signup && typeof signup === "object" ? signup : {};
  const quantity = Number.isInteger(s.quantity) && s.quantity >= 1 && s.quantity <= MAX_LOCATIONS ? s.quantity : 1;
  return {
    plan: PLANS.includes(s.plan) ? s.plan : "us",
    businessName: optionalText(s.businessName, 200),
    partnerName: optionalText(s.partnerName, 200),
    firstName: optionalText(s.firstName, 120),
    quantity,
    paid: s.paid === true,
    accessEmail: isEmail(s.accessEmail) ? s.accessEmail : null,
    accessConfirmed: s.accessConfirmed === true,
    intakeDone: s.intakeDone === true,
    bookingUrl: httpUrl(s.bookingUrl),
    prefill: shapePrefill(s.prefill),
  };
}

function shapePortal(portal) {
  const p = portal && typeof portal === "object" ? portal : {};
  const clients = Array.isArray(p.clients) ? p.clients : [];
  return {
    partnerName: optionalText(p.partnerName, 200),
    partnerSlug: typeof p.partnerSlug === "string" && PARTNER_SLUG_PATTERN.test(p.partnerSlug) ? p.partnerSlug : null,
    reportingDashboardUrl: httpUrl(p.reportingDashboardUrl),
    bookingUrl: httpUrl(p.bookingUrl),
    clients: clients
      .filter((c) => c && typeof c === "object")
      .slice(0, 1000)
      .map((c) => {
        const links = c.links && typeof c.links === "object" ? c.links : {};
        return {
          name: optionalText(c.name, 200),
          city: optionalText(c.city, 200),
          locations: Number.isInteger(c.locations) && c.locations >= 0 ? c.locations : null,
          stage: STAGES.includes(c.stage) ? c.stage : null,
          since: typeof c.since === "string" && /^\d{4}-\d{2}-\d{2}/.test(c.since) ? c.since.slice(0, 10) : null,
          links: {
            deliverables: httpUrl(links.deliverables),
            photos: httpUrl(links.photos),
            dashboard: httpUrl(links.dashboard),
          },
        };
      }),
  };
}

// ---- talking to the CRM ----------------------------------------------------

// One call to the CRM. Resolves { status, data } and never throws. `op` names
// the call in the logs ("start", "status", ...); the path, which can hold a
// token, is never logged.
async function crmCall(op, method, path, { body, clientIp } = {}) {
  try {
    const response = await fetch(`${crmUrl()}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        // So the CRM can rate-limit the visitor rather than this function.
        ...(clientIp ? { "X-Forwarded-For": clientIp } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data && data.ok === true) return { status: 200, data };
    if (!response.ok && data && data.ok === false) {
      const error = errorFrom(data);
      console.error("BYM signup", op, "refused", response.status, error.error, error.field || "");
      return { status: response.status, data: error };
    }
    console.error("BYM signup", op, "unexpected answer", response.status);
    return { status: 503, data: UNAVAILABLE };
  } catch (err) {
    // Name and code only: a fetch error message can carry the URL, and so a token.
    const code = err && err.cause && typeof err.cause.code === "string" ? err.cause.code : "";
    console.error("BYM signup", op, "error", err && err.name === "TimeoutError" ? "timeout" : (err && err.name) || "unknown", code);
    return { status: 503, data: UNAVAILABLE };
  }
}

function send(res, status, data, cache = "no-store") {
  if (data && data.ok === false && !("field" in data)) data = { ...data, field: null };
  res.setHeader("Cache-Control", cache);
  return res.status(status).json(data);
}

// The common start of every handler: method check, CRM_URL check, JSON body.
// Returns the parsed body ({} for GET), or null when it already answered.
function begin(req, res, method) {
  if (req.method !== method) {
    res.setHeader("Allow", method);
    send(res, 405, fail("method_not_allowed"));
    return null;
  }
  if (!crmConfigured()) {
    console.error("BYM signup: CRM_URL is not set");
    send(res, 503, UNAVAILABLE);
    return null;
  }
  if (method === "GET") return {};
  const body = parseBody(req.body);
  if (!body) {
    send(res, 400, fail("invalid_input"));
    return null;
  }
  return body;
}

module.exports = {
  TOKEN_PATTERN,
  fail,
  isToken,
  typedUrl,
  buildStartPayload,
  buildIntakePayload,
  shapePartners,
  shapeSignup,
  shapePortal,
  errorFrom,
  crmCall,
  send,
  begin,
  clientIpFrom,
  httpUrl,
};
