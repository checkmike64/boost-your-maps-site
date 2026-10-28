// Shared helpers for the private agreement page (/agreement#t=<token>) and its
// functions (api/agreement/*.js). The browser only ever talks to these site
// functions; they call the BYM CRM's /api/agreements/{token} endpoints server
// to server, like api/_signup.js does for the signup, so the site's CSP stays
// as it is.
//
// The token travels in POST bodies and in the CRM path, never in a URL the
// site logs. Every answer is narrowed to the keys the page uses before it
// reaches the browser. Nothing submitted (names, IPs, emails) and no token is
// ever logged: only the call, the status and the error code.
//
// The small request helpers below follow api/_signup.js on purpose but stay
// separate, so the live signup functions never change for the agreement: the
// agreement has its own error code (agreement_unavailable), log label and
// timeouts.

const { crmUrl, crmConfigured, text, cut, clientIpFrom, userAgentFrom } = require("./_crm");

const TIMEOUT_MS = 8000;
// Signing makes the PDF and the Stripe checkout session, so it gets longer.
const SIGN_TIMEOUT_MS = 10000;

const STATUSES = ["sent", "viewed", "signed", "paid", "void", "expired"];
const SIGNABLE = ["sent", "viewed"];
const BLOCK_KINDS = ["p", "li", "line"];

// Agreement tokens (the link the CRM emails) are 64 lowercase hex characters.
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// "2026-11-27T18:00:00.000Z" or with an offset.
const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
// Control characters, and the line and paragraph separators, are refused in a
// signed name.
const CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

const NAME_MAX = 200;
const STRIPE_CHECKOUT_PREFIX = "https://checkout.stripe.com/";

// Limits for the agreement text. Real agreements are far below them; an
// answer over them is not shown at all rather than shown cut.
const MAX_SECTIONS = 100;
const MAX_BLOCKS = 300;
const MAX_HEADING = 300;
const MAX_BLOCK_TEXT = 10000;
const MAX_TOTAL_TEXT = 200000;

// Every error answer has the same shape: { ok: false, error, field }.
function fail(error, field = null) {
  return { ok: false, error, field };
}

const UNAVAILABLE = fail("agreement_unavailable");
const NOT_FOUND = fail("agreement_not_found");

function isToken(value) {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

function isEmail(value) {
  return typeof value === "string" && value.length <= 320 && EMAIL_PATTERN.test(value);
}

function optionalText(value, max) {
  const typed = text(value);
  return typed ? cut(typed, max) : null;
}

function isoTime(value) {
  if (typeof value !== "string" || !ISO_TIME_PATTERN.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
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

// ---- what the CRM receives -------------------------------------------------

// A name typed on the page: trimmed, at most 200 characters, no control
// characters. Refused rather than cut, because it goes on a signed agreement.
function signedName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > NAME_MAX || CONTROL_PATTERN.test(name)) return null;
  return name;
}

// POST {CRM}/api/agreements/{token}/sign, from the body the page posts
// (assets/agreement.js) and the request headers. The sign form sends
// { t, legal_name, signatory_name, consent }; an agreement that is already
// signed only needs the way to pay, so the page sends { t } alone and the CRM
// gets {}. Returns { payload } or { error } naming the field as the CRM does.
function buildSignPayload(body, headers) {
  if (!body) return { error: fail("invalid_input") };
  const sent = ["legal_name", "signatory_name", "consent"].some((key) => body[key] !== undefined && body[key] !== null);
  if (!sent) return { payload: {} };

  const legalName = signedName(body.legal_name);
  if (!legalName) return { error: fail("invalid_input", "legalName") };
  const signatoryName = signedName(body.signatory_name);
  if (!signatoryName) return { error: fail("invalid_input", "signatoryName") };
  if (body.consent !== true) return { error: fail("invalid_input", "consent") };

  return {
    payload: {
      legalName,
      signatoryName,
      consent: true,
      clientIp: clientIpFrom(headers || {}),
      userAgent: userAgentFrom(headers || {}),
    },
  };
}

// ---- what the browser receives ---------------------------------------------

// The CRM's error answer, narrowed to { ok, error, field }.
function errorFrom(data) {
  const code = data && typeof data.error === "string" && ERROR_CODE_PATTERN.test(data.error) ? data.error : "agreement_unavailable";
  const field = data && typeof data.field === "string" && FIELD_PATTERN.test(data.field) ? data.field : null;
  return fail(code, field);
}

// A Stripe checkout link, or null. The page sends the signer nowhere else.
function stripeCheckoutUrl(value) {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith(STRIPE_CHECKOUT_PREFIX)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

// The agreement's own text: sections of { heading, blocks }. It is legal text,
// so it is passed on exactly as the CRM sent it (trimmed) or not at all: one
// malformed piece makes the whole answer null and the page shows nothing
// rather than a changed agreement. An unknown block kind is shown as a
// paragraph, so no words go missing; an empty block is skipped.
function shapeSections(value) {
  if (!Array.isArray(value) || value.length > MAX_SECTIONS) return null;
  let total = 0;
  const sections = [];
  for (const section of value) {
    if (!section || typeof section !== "object" || Array.isArray(section)) return null;
    let heading = null;
    if (section.heading !== null && section.heading !== undefined) {
      if (typeof section.heading !== "string" || section.heading.length > MAX_HEADING) return null;
      heading = section.heading.trim() || null;
    }
    if (!Array.isArray(section.blocks) || section.blocks.length > MAX_BLOCKS) return null;
    const blocks = [];
    for (const block of section.blocks) {
      if (!block || typeof block !== "object" || typeof block.text !== "string" || block.text.length > MAX_BLOCK_TEXT) return null;
      const words = block.text.trim();
      if (!words) continue;
      total += words.length;
      if (total > MAX_TOTAL_TEXT) return null;
      blocks.push({ kind: BLOCK_KINDS.includes(block.kind) ? block.kind : "p", text: words });
    }
    if (heading || blocks.length) sections.push({ heading, blocks });
  }
  return sections;
}

// The CRM's agreement, narrowed to the keys the page uses. null when it cannot
// be shown: an unknown status, malformed agreement text, or an agreement open
// for signing without its text or the consent line.
function shapeAgreement(agreement) {
  const a = agreement && typeof agreement === "object" && !Array.isArray(agreement) ? agreement : null;
  if (!a || !STATUSES.includes(a.status)) return null;
  const sections = shapeSections(a.sections);
  if (!sections) return null;
  const consentText = typeof a.consentText === "string" && a.consentText.length <= 2000 ? a.consentText.trim() || null : null;
  if (SIGNABLE.includes(a.status) && (!sections.length || !consentText)) return null;

  const provider = a.provider && typeof a.provider === "object" && !Array.isArray(a.provider) ? a.provider : {};
  const lines = Array.isArray(provider.lines) ? provider.lines : [];
  const email = text(a.email);
  return {
    status: a.status,
    title: optionalText(a.title, 200),
    version: Number.isInteger(a.version) && a.version > 0 ? a.version : null,
    businessName: optionalText(a.businessName, 200),
    contactName: optionalText(a.contactName, 200),
    email: isEmail(email) ? email : null,
    service: optionalText(a.service, 200),
    locations: Number.isInteger(a.locations) && a.locations > 0 && a.locations <= 10000 ? a.locations : null,
    unitPrice: optionalText(a.unitPrice, 100),
    totalPrice: optionalText(a.totalPrice, 100),
    summary: optionalText(a.summary, 500),
    provider: {
      name: optionalText(provider.name, 200),
      lines: lines
        .filter((line) => typeof line === "string")
        .map((line) => cut(line.trim(), 200))
        .filter(Boolean)
        .slice(0, 10),
    },
    sections,
    consentText,
    expiresAt: isoTime(a.expiresAt),
    signedAt: isoTime(a.signedAt),
    legalName: optionalText(a.legalName, NAME_MAX),
    signatoryName: optionalText(a.signatoryName, NAME_MAX),
  };
}

// ---- talking to the CRM ----------------------------------------------------

// One call to the CRM. Resolves { status, data } and never throws. `op` names
// the call in the logs ("load", "view", "sign"); the path, which holds the
// token, is never logged.
async function agreementCall(op, method, path, { body, clientIp, timeoutMs = TIMEOUT_MS } = {}) {
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
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data && data.ok === true) return { status: 200, data };
    if (!response.ok && data && data.ok === false) {
      const error = errorFrom(data);
      console.error("BYM agreement", op, "refused", response.status, error.error, error.field || "");
      return { status: response.status, data: error };
    }
    console.error("BYM agreement", op, "unexpected answer", response.status);
    return { status: 503, data: UNAVAILABLE };
  } catch (err) {
    // Name and code only: a fetch error message can carry the URL, and so the token.
    const code = err && err.cause && typeof err.cause.code === "string" ? err.cause.code : "";
    console.error("BYM agreement", op, "error", err && err.name === "TimeoutError" ? "timeout" : (err && err.name) || "unknown", code);
    return { status: 503, data: UNAVAILABLE };
  }
}

function send(res, status, data) {
  if (data && data.ok === false && !("field" in data)) data = { ...data, field: null };
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

// The common start of every handler: POST only, CRM_URL set, a JSON body with
// a well-formed token. Returns the parsed body, or null when it already
// answered (a malformed token answers 404 without calling the CRM).
function begin(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(res, 405, fail("method_not_allowed"));
    return null;
  }
  if (!crmConfigured()) {
    console.error("BYM agreement: CRM_URL is not set");
    send(res, 503, UNAVAILABLE);
    return null;
  }
  const body = parseBody(req.body);
  if (!body) {
    send(res, 400, fail("invalid_input"));
    return null;
  }
  if (!isToken(body.t)) {
    send(res, 404, NOT_FOUND);
    return null;
  }
  return body;
}

module.exports = {
  SIGN_TIMEOUT_MS,
  UNAVAILABLE,
  fail,
  isToken,
  signedName,
  buildSignPayload,
  errorFrom,
  stripeCheckoutUrl,
  shapeAgreement,
  agreementCall,
  send,
  begin,
  clientIpFrom,
};
