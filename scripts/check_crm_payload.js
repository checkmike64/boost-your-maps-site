// Checks what the BYM CRM receives from the site's two lead forms
// (api/_crm.js) and the either-one rule the two endpoints share (api/_lead.js).
// fetch is replaced by a stub, so nothing touches the network.
// Run: node scripts/check_crm_payload.js
"use strict";

const assert = require("node:assert/strict");
const { buildCrmPayload } = require("../api/_crm");
const visibilityReport = require("../api/visibility-report");
const inquiry = require("../api/inquiry");

const HEADERS = {
  "x-forwarded-for": "203.0.113.7, 10.0.0.1",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
};

// Bodies shaped exactly as assets/forms.js posts them.
const VISIBILITY_REPORT = {
  form_type: "visibility_report",
  submitted_at: "2026-10-05T18:00:00.000Z",
  page_url:
    "https://www.boostyourmaps.com/visibility-report?service=pest+control&utm_source=google&utm_medium=cpc&utm_campaign=tampa&gclid=Cj0KCQjw",
  fields: {
    business_name: " Bay Pest Co ",
    service: "pest control",
    location: "Tampa, FL",
    first_name: "Dana",
    last_name: "Reyes",
    phone: "+1 (813) 555-0142",
    email: "dana@example.com",
    website: "https://baypest.example.com",
    message: "",
  },
};

const INQUIRY = {
  form_type: "inquiry",
  submitted_at: "2026-10-05T18:05:00.000Z",
  page_url: "https://www.boostyourmaps.com/inquiry-form",
  fields: {
    first_name: "Sam",
    last_name: "",
    email: "sam@example.com",
    phone: "813-555-0199",
    business_name: "Sam's Plumbing",
    service_interest: "Ongoing management",
    website: "",
    active_marketing: "no",
    message: "Please call after 3pm.",
  },
};

// ---- The payload builder -------------------------------------------------

assert.deepEqual(buildCrmPayload(VISIBILITY_REPORT, HEADERS), {
  name: "Dana Reyes",
  email: "dana@example.com",
  phone: "+18135550142",
  answers: {
    business_name: "Bay Pest Co",
    service: "pest control",
    location: "Tampa, FL",
    website: "https://baypest.example.com",
  },
  sourceUrl: VISIBILITY_REPORT.page_url,
  utm: { utm_source: "google", utm_medium: "cpc", utm_campaign: "tampa" },
  visitorId: null,
  clientIp: "203.0.113.7",
  userAgent: HEADERS["user-agent"],
});

// A number typed without a country code is not guessed at, and x-real-ip
// stands in when x-forwarded-for is missing.
assert.deepEqual(buildCrmPayload(INQUIRY, { "x-real-ip": "2001:db8::1" }), {
  name: "Sam",
  email: "sam@example.com",
  phone: null,
  answers: {
    business_name: "Sam's Plumbing",
    service_interest: "Ongoing management",
    active_marketing: "no",
    message: "Please call after 3pm.",
  },
  sourceUrl: "https://www.boostyourmaps.com/inquiry-form",
  utm: {},
  visitorId: null,
  clientIp: "2001:db8::1",
  userAgent: null,
});

// Values cut to what the CRM accepts instead of getting the lead refused.
const edge = buildCrmPayload(
  {
    page_url: `https://www.boostyourmaps.com/visibility-report?utm_source=${"x".repeat(300)}&pad=${"y".repeat(2100)}`,
    fields: {
      email: "  owner@example.com ",
      phone: "0044 20 7946 0958",
      service: "s".repeat(600),
      message: `${"m".repeat(4999)}😀`,
      some_new_field: "not sent",
      hp_field_2026: "not sent",
    },
  },
  { "x-forwarded-for": "not-an-address", "user-agent": "u".repeat(600) }
);
assert.equal(edge.name, "owner"); // no name given: the part of the email before @
assert.equal(edge.email, "owner@example.com");
assert.equal(edge.phone, "+442079460958"); // a leading 00 means +
assert.deepEqual(Object.keys(edge.answers).sort(), ["message", "service"]);
assert.equal(edge.answers.service.length, 500);
assert.equal(edge.answers.message, "m".repeat(4999)); // the emoji is not cut in half
assert.equal(edge.sourceUrl, "https://www.boostyourmaps.com/visibility-report"); // too long: no query
assert.equal(edge.utm.utm_source.length, 200);
assert.equal(edge.clientIp, null);
assert.equal(edge.userAgent.length, 512);

const noPage = buildCrmPayload({ page_url: "javascript:alert(1)", fields: { email: "a@example.com" } }, {});
assert.equal(noPage.sourceUrl, null);
assert.deepEqual(noPage.utm, {});

// No email, no CRM payload: the CRM requires one.
assert.equal(buildCrmPayload({ fields: { phone: "+18135550142" } }, {}), null);
assert.equal(buildCrmPayload({ fields: { email: "not-an-email" } }, {}), null);
assert.equal(buildCrmPayload(null, {}), null);

// ---- Both destinations, through the two endpoints --------------------------

const GHL_HOST = "https://services.leadconnectorhq.com";
const CRM_HOST = "https://crm.example.test";
const GHL_ENV = { GHL_API_TOKEN: "test-token", GHL_LOCATION_ID: "test-location" };
const BOTH_ENV = { ...GHL_ENV, CRM_URL: `${CRM_HOST}/` };

// What GoHighLevel has always received for the visibility report body above.
const GHL_VISIBILITY_REPORT = {
  locationId: "test-location",
  email: "dana@example.com",
  phone: "+1 (813) 555-0142",
  firstName: "Dana",
  lastName: "Reyes",
  companyName: " Bay Pest Co ",
  website: "https://baypest.example.com",
  source: "Website - Visibility Report",
  tags: ["rank report"],
  customFields: [
    { key: "top_service_to_grow", field_value: "pest control" },
    { key: "target_location", field_value: "Tampa, FL" },
  ],
};

const GHL_OK = { status: 200, body: { contact: { id: "ghl-contact-1" } } };
const GHL_DOWN = { status: 500, body: { message: "Internal Server Error" } };
const CRM_OK = { status: 200, body: { ok: true, result: { redirectUrl: null, eventId: "8d5c6f1e-2b1a-4c3d-9e8f-0a1b2c3d4e5f" } } };
const CRM_REFUSED = { status: 400, body: { ok: false, error: "form_answer_rejected", fieldKey: "active_marketing" } };

let replies = {};
let calls = [];
global.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const reply = String(url).startsWith(GHL_HOST) ? replies.ghl : replies.crm;
  if (reply instanceof Error) throw reply;
  const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
  return new Response(body, { status: reply.status });
};

const ENV_KEYS = ["GHL_API_TOKEN", "GHL_LOCATION_ID", "CRM_URL", "CRM_FORM_VISIBILITY_REPORT", "CRM_FORM_INQUIRY"];

async function run({ env, ghl, crm, body = VISIBILITY_REPORT, endpoint = visibilityReport, method = "POST" }) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  replies = { ghl, crm };
  calls = [];
  const logs = [];
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (data) => ((res.body = JSON.parse(JSON.stringify(data))), res);
  res.setHeader = (name, value) => (res.headers[name] = value);
  const consoleError = console.error;
  console.error = (...args) => logs.push(args.map((arg) => (arg instanceof Error ? arg.message : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  try {
    await endpoint({ method, body, headers: HEADERS }, res);
  } finally {
    console.error = consoleError;
  }
  const crmCall = calls.find((call) => call.url.startsWith(CRM_HOST));
  const ghlCall = calls.find((call) => call.url.startsWith(GHL_HOST));
  return { status: res.statusCode, body: res.body, logs, crmCall, ghlCall, sent: calls.length };
}

const logged = (logs, start) => logs.some((line) => line.startsWith(start));

(async () => {
  // CRM_URL unset: GHL alone, exactly as before, with no time limit on GHL.
  let r = await run({ env: GHL_ENV, ghl: GHL_OK });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, contactId: "ghl-contact-1" });
  assert.equal(r.sent, 1);
  assert.equal(r.ghlCall.url, `${GHL_HOST}/contacts/upsert`);
  assert.deepEqual(JSON.parse(r.ghlCall.init.body), GHL_VISIBILITY_REPORT);
  assert.equal(r.ghlCall.init.headers.Authorization, "Bearer test-token");
  assert.equal(r.ghlCall.init.signal, undefined);

  r = await run({ env: GHL_ENV, ghl: GHL_DOWN });
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: "CRM submission failed" });

  // Both on: the CRM gets the payload built above, at the form's slug.
  r = await run({ env: BOTH_ENV, ghl: GHL_OK, crm: CRM_OK });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, contactId: "ghl-contact-1" });
  assert.equal(r.crmCall.url, `${CRM_HOST}/api/forms/visibility-report`);
  assert.deepEqual(JSON.parse(r.crmCall.init.body), buildCrmPayload(VISIBILITY_REPORT, HEADERS));
  assert.equal(r.crmCall.init.headers["X-Forwarded-For"], "203.0.113.7");
  assert.ok(r.crmCall.init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(r.ghlCall.init.body), GHL_VISIBILITY_REPORT);
  assert.ok(r.ghlCall.init.signal instanceof AbortSignal);
  assert.deepEqual(r.logs, []);

  // Either one storing the lead is a success; each failure is logged apart.
  r = await run({ env: BOTH_ENV, ghl: GHL_DOWN, crm: CRM_OK });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.ok(logged(r.logs, "GHL upsert failed 500"));

  r = await run({ env: BOTH_ENV, ghl: GHL_OK, crm: CRM_REFUSED });
  assert.equal(r.status, 200);
  assert.ok(logged(r.logs, 'BYM CRM submission failed visibility-report 400 {"ok":false,"error":"form_answer_rejected","fieldKey":"active_marketing"}'));

  r = await run({ env: BOTH_ENV, ghl: GHL_DOWN, crm: new TypeError("fetch failed") });
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: "CRM submission failed" });
  assert.ok(logged(r.logs, "GHL upsert failed"));
  assert.ok(logged(r.logs, "BYM CRM submission error visibility-report fetch failed"));

  // A 200 that is not the CRM saying ok (say, a wrong CRM_URL) is no success.
  r = await run({ env: BOTH_ENV, ghl: GHL_DOWN, crm: { status: 200, body: "<html>Not the CRM</html>" } });
  assert.equal(r.status, 502);
  r = await run({ env: BOTH_ENV, ghl: GHL_DOWN, crm: { status: 200, body: { status: "received" } } });
  assert.equal(r.status, 502);
  assert.ok(logged(r.logs, 'BYM CRM submission failed visibility-report 200 {"status":"received"}'));

  // GHL not configured: the CRM alone decides.
  r = await run({ env: { CRM_URL: CRM_HOST }, crm: CRM_OK });
  assert.equal(r.status, 200);
  assert.equal(r.sent, 1);
  assert.ok(logged(r.logs, "Missing GHL_API_TOKEN or GHL_LOCATION_ID env var"));

  // Nothing configured: the same 500 as before, nothing sent.
  r = await run({ env: {} });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: "Server is not configured" });
  assert.equal(r.sent, 0);

  // The inquiry form, with its CRM slug renamed in Vercel.
  r = await run({ env: BOTH_ENV, ghl: GHL_OK, crm: CRM_OK, body: INQUIRY, endpoint: inquiry });
  assert.equal(r.status, 200);
  assert.equal(r.crmCall.url, `${CRM_HOST}/api/forms/inquiry`);
  assert.deepEqual(JSON.parse(r.crmCall.init.body), buildCrmPayload(INQUIRY, HEADERS));
  assert.deepEqual(JSON.parse(r.ghlCall.init.body).tags, ["inquiry"]);
  assert.equal(JSON.parse(r.ghlCall.init.body).source, "Website - Contact Form");

  r = await run({ env: { ...BOTH_ENV, CRM_FORM_INQUIRY: "website-inquiry" }, ghl: GHL_OK, crm: CRM_OK, body: INQUIRY, endpoint: inquiry });
  assert.equal(r.crmCall.url, `${CRM_HOST}/api/forms/website-inquiry`);
  r = await run({ env: { ...BOTH_ENV, CRM_FORM_VISIBILITY_REPORT: "free-report" }, ghl: GHL_OK, crm: CRM_OK });
  assert.equal(r.crmCall.url, `${CRM_HOST}/api/forms/free-report`);

  // A phone-only lead (only possible past the browser's own checks) still
  // reaches GHL; the CRM, which needs an email, is skipped and that is logged.
  r = await run({ env: BOTH_ENV, ghl: GHL_OK, crm: CRM_OK, body: { fields: { phone: "+18135550142" } } });
  assert.equal(r.status, 200);
  assert.equal(r.sent, 1);
  assert.ok(logged(r.logs, "BYM CRM submission skipped: no valid email visibility-report"));

  // The existing request checks are unchanged and send nothing.
  r = await run({ env: BOTH_ENV, method: "GET" });
  assert.equal(r.status, 405);
  r = await run({ env: BOTH_ENV, body: "{not json" });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: "Invalid JSON" });
  r = await run({ env: BOTH_ENV, body: { fields: { first_name: "Dana" } } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: "Email or phone is required" });
  assert.equal(r.sent, 0);

  console.log("CRM payload and lead routing checks passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
