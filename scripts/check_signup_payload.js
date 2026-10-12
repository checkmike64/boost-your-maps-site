// Checks the self-serve signup and partner portal functions (api/_signup.js,
// api/signup/*.js, api/partner-portal.js): what the BYM CRM receives, what the
// browser gets back, token checks, and that nothing submitted or secret is
// logged. fetch is replaced by a stub, so nothing touches the network.
// Run: node scripts/check_signup_payload.js
"use strict";

const assert = require("node:assert/strict");
const {
  isToken,
  buildStartPayload,
  buildIntakePayload,
  shapeSignup,
  shapePortal,
  shapePartners,
  errorFrom,
} = require("../api/_signup");
const partnersFn = require("../api/signup/partners");
const startFn = require("../api/signup/start");
const statusFn = require("../api/signup/status");
const accessFn = require("../api/signup/access");
const intakeFn = require("../api/signup/intake");
const portalFn = require("../api/partner-portal");

const TOKEN = "3f9a0c4be1d2f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5";
const PORTAL_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const HEADERS = {
  "x-forwarded-for": "198.51.100.23, 10.0.0.1",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)",
};

// ---- Token shape: 64 lowercase hex characters -----------------------------

assert.equal(isToken(TOKEN), true);
assert.equal(isToken(PORTAL_TOKEN), true);
assert.equal(isToken(TOKEN.toUpperCase()), false);
assert.equal(isToken(TOKEN.slice(1)), false);
assert.equal(isToken(`${TOKEN}0`), false);
assert.equal(isToken("Abc_def-0123456789Abc_def-0123456789Abc_def"), false); // 43 base64url
assert.equal(isToken(`${TOKEN.slice(0, 63)}/`), false);
assert.equal(isToken(`../${TOKEN.slice(3)}`), false);
assert.equal(isToken(null), false);
assert.equal(isToken(123), false);

// ---- POST /api/signup: the body the signup pages post ----------------------

// Shaped exactly as assets/signup.js posts it from /get-started.
const US_BODY = {
  plan: "us",
  partner: null,
  first_name: " Ana ",
  last_name: "Ruiz",
  email: " ana@example.com ",
  phone: "(512) 555-0100",
  business_name: " Ruiz Pest Control ",
  website: "ruizpest.com",
  locations: 2,
  page_url: "https://www.boostyourmaps.com/get-started?utm_source=google&utm_medium=cpc&gclid=abc",
  hp_field_2026: "",
};

assert.deepEqual(buildStartPayload(US_BODY, HEADERS), {
  payload: {
    plan: "us",
    partner: null,
    firstName: "Ana",
    lastName: "Ruiz",
    email: "ana@example.com",
    phone: "+15125550100",
    businessName: "Ruiz Pest Control",
    websiteUrl: "https://ruizpest.com/",
    quantity: 2,
    sourceUrl: US_BODY.page_url,
    utm: { utm_source: "google", utm_medium: "cpc" },
    clientIp: "198.51.100.23",
    userAgent: HEADERS["user-agent"],
  },
});

// Partner: the agency slug goes along; a slug on a direct plan is dropped.
const PARTNER_BODY = {
  ...US_BODY,
  plan: "partner",
  partner: "keepers-digital",
  phone: "",
  last_name: "",
  website: "",
  locations: "20",
  page_url: "https://www.boostyourmaps.com/partners/signup?partner=keepers-digital",
};
const partnerPayload = buildStartPayload(PARTNER_BODY, {}).payload;
assert.equal(partnerPayload.plan, "partner");
assert.equal(partnerPayload.partner, "keepers-digital");
assert.equal(partnerPayload.lastName, "");
assert.equal(partnerPayload.phone, null);
assert.equal(partnerPayload.websiteUrl, null);
assert.equal(partnerPayload.quantity, 20);
assert.deepEqual(partnerPayload.utm, {});
assert.equal(partnerPayload.clientIp, null);
assert.equal(partnerPayload.userAgent, null);
assert.equal(buildStartPayload({ ...US_BODY, plan: "canada", partner: "keepers-digital" }, {}).payload.partner, null);
assert.equal(buildStartPayload({ ...US_BODY, website: "http://old.example.com/page" }, {}).payload.websiteUrl, "http://old.example.com/page");

// Long values are cut to what the CRM keeps instead of getting refused.
const long = buildStartPayload({ ...US_BODY, first_name: "a".repeat(200), business_name: "b".repeat(300) }, {}).payload;
assert.equal(long.firstName.length, 120);
assert.equal(long.businessName.length, 200);

// Refusals name the field the way the CRM names it, so the page can point at it.
const fieldOf = (body) => {
  const built = buildStartPayload(body, {});
  assert.ok(built.error, `expected a refusal for ${JSON.stringify(body)}`);
  assert.equal(built.error.ok, false);
  assert.equal(built.error.error, "invalid_input");
  return built.error.field;
};
assert.equal(fieldOf({ ...US_BODY, hp_field_2026: "bot" }), null); // the honeypot, quietly
assert.equal(fieldOf({ ...US_BODY, plan: "gold" }), "plan");
assert.equal(fieldOf({ ...US_BODY, plan: "partner", partner: "" }), "partner");
assert.equal(fieldOf({ ...US_BODY, plan: "partner", partner: "Not A Slug" }), "partner");
assert.equal(fieldOf({ ...US_BODY, first_name: "  " }), "firstName");
assert.equal(fieldOf({ ...US_BODY, email: "ana@example" }), "email");
assert.equal(fieldOf({ ...US_BODY, email: `${"a".repeat(320)}@example.com` }), "email");
assert.equal(fieldOf({ ...US_BODY, phone: "555-0100" }), "phone");
assert.equal(fieldOf({ ...US_BODY, business_name: "" }), "businessName");
assert.equal(fieldOf({ ...US_BODY, website: "javascript:alert(1)" }), "websiteUrl");
assert.equal(fieldOf({ ...US_BODY, website: "not a website" }), "websiteUrl");
assert.equal(fieldOf({ ...US_BODY, website: "ftp://ruizpest.com" }), "websiteUrl");
for (const locations of [0, 21, "abc", 1.5, "", null, undefined]) {
  assert.equal(fieldOf({ ...US_BODY, locations }), "quantity", `locations ${JSON.stringify(locations)}`);
}
assert.equal(buildStartPayload(null, {}).error.field, null);

// ---- POST /api/signup/{token}/intake ---------------------------------------

const INTAKE_BODY = {
  t: TOKEN,
  profileLinks: [" https://maps.app.goo.gl/abc ", "", "Ruiz Pest Control, 12 Main St, Austin TX"],
  websiteUrl: "ruizpest.com",
  mainService: " termite treatment ",
  leadPreference: "calls",
  targetArea: "  ",
  notes: "We run a spring special.",
  photosUrl: "drive.google.com/drive/folders/xyz",
  approval: "call",
};
assert.deepEqual(buildIntakePayload(INTAKE_BODY), {
  payload: {
    profileLinks: ["https://maps.app.goo.gl/abc", "Ruiz Pest Control, 12 Main St, Austin TX"],
    websiteUrl: "https://ruizpest.com/",
    mainService: "termite treatment",
    leadPreference: "calls",
    targetArea: null,
    notes: "We run a spring special.",
    photosUrl: "https://drive.google.com/drive/folders/xyz",
    approval: "call",
  },
});
const intakeLong = buildIntakePayload({ ...INTAKE_BODY, mainService: "s".repeat(250), targetArea: "t".repeat(600), notes: "n".repeat(2100), photosUrl: null, websiteUrl: null }).payload;
assert.equal(intakeLong.mainService.length, 200);
assert.equal(intakeLong.targetArea.length, 500);
assert.equal(intakeLong.notes.length, 2000);
assert.equal(intakeLong.photosUrl, null);
assert.equal(intakeLong.websiteUrl, null);
assert.equal(buildIntakePayload({ ...INTAKE_BODY, approval: "email" }).payload.approval, "email");

const intakeFieldOf = (body) => buildIntakePayload(body).error.field;
assert.equal(intakeFieldOf({ ...INTAKE_BODY, profileLinks: [] }), "profileLinks");
assert.equal(intakeFieldOf({ ...INTAKE_BODY, profileLinks: ["", " "] }), "profileLinks");
assert.equal(intakeFieldOf({ ...INTAKE_BODY, profileLinks: "https://maps.app.goo.gl/abc" }), "profileLinks");
assert.equal(intakeFieldOf({ ...INTAKE_BODY, profileLinks: [`https://maps.app.goo.gl/${"x".repeat(500)}`] }), "profileLinks");
assert.equal(intakeFieldOf({ ...INTAKE_BODY, websiteUrl: "javascript:alert(1)" }), "websiteUrl");
assert.equal(intakeFieldOf({ ...INTAKE_BODY, mainService: "" }), "mainService");
assert.equal(intakeFieldOf({ ...INTAKE_BODY, leadPreference: "smoke signals" }), "leadPreference");
assert.equal(intakeFieldOf({ ...INTAKE_BODY, photosUrl: "http://photos.example.com" }), "photosUrl");
assert.equal(intakeFieldOf({ ...INTAKE_BODY, approval: undefined }), "approval");
assert.equal(intakeFieldOf({ ...INTAKE_BODY, approval: "fax" }), "approval");

// ---- What the browser gets back --------------------------------------------

assert.deepEqual(
  shapeSignup({
    plan: "partner",
    businessName: "Ruiz Pest Control",
    partnerName: "Keepers Digital Marketing",
    firstName: "Ana",
    quantity: 3,
    paid: true,
    accessEmail: "mapsmarketingaccess@gmail.com",
    accessConfirmed: false,
    intakeDone: true,
    bookingUrl: "https://crm.boostyourmaps.com/book/launch-call",
    prefill: {
      websiteUrl: "https://ruizpest.com",
      profileLinks: ["https://maps.app.goo.gl/abc", 7, ""],
      mainService: "termite treatment",
      leadPreference: "calls",
      targetArea: null,
      notes: "Busy in spring",
      photosUrl: "javascript:alert(1)",
      approval: "email",
    },
    stripeCustomerId: "cus_secret", // anything else stays on the server
  }),
  {
    plan: "partner",
    businessName: "Ruiz Pest Control",
    partnerName: "Keepers Digital Marketing",
    firstName: "Ana",
    quantity: 3,
    paid: true,
    accessEmail: "mapsmarketingaccess@gmail.com",
    accessConfirmed: false,
    intakeDone: true,
    bookingUrl: "https://crm.boostyourmaps.com/book/launch-call",
    prefill: {
      websiteUrl: "https://ruizpest.com/",
      profileLinks: ["https://maps.app.goo.gl/abc"],
      mainService: "termite treatment",
      leadPreference: "calls",
      targetArea: null,
      notes: "Busy in spring",
      photosUrl: null,
      approval: "email",
    },
  }
);
const odd = shapeSignup({ plan: "gold", quantity: 99, paid: "yes", accessEmail: "nope", bookingUrl: "javascript:alert(1)" });
assert.equal(odd.plan, "us");
assert.equal(odd.quantity, 1);
assert.equal(odd.paid, false);
assert.equal(odd.accessEmail, null);
assert.equal(odd.bookingUrl, null);
assert.deepEqual(odd.prefill, { websiteUrl: null, profileLinks: [], mainService: null, leadPreference: null, targetArea: null, notes: null, photosUrl: null, approval: null });

assert.deepEqual(
  shapePortal({
    partnerName: "Keepers Digital Marketing",
    partnerSlug: "keepers-digital",
    reportingDashboardUrl: null,
    bookingUrl: "https://crm.boostyourmaps.com/book/partner-call",
    clients: [
      { name: "Ruiz Pest Control", city: "Austin, TX", locations: 1, stage: "live", since: "2026-10-09", links: { deliverables: "https://docs.google.com/x", photos: "data:text/html,hi", dashboard: null } },
      { name: "Odd", city: null, locations: "two", stage: "exploded", since: "yesterday", links: null },
      null,
    ],
  }),
  {
    partnerName: "Keepers Digital Marketing",
    partnerSlug: "keepers-digital",
    reportingDashboardUrl: null,
    bookingUrl: "https://crm.boostyourmaps.com/book/partner-call",
    clients: [
      { name: "Ruiz Pest Control", city: "Austin, TX", locations: 1, stage: "live", since: "2026-10-09", links: { deliverables: "https://docs.google.com/x", photos: null, dashboard: null } },
      { name: "Odd", city: null, locations: null, stage: null, since: null, links: { deliverables: null, photos: null, dashboard: null } },
    ],
  }
);

assert.deepEqual(shapePartners({ partners: [{ slug: "keepers-digital", name: "Keepers Digital Marketing", secret: 1 }, { slug: "Bad Slug", name: "x" }, { slug: "no-name", name: "" }] }), [
  { slug: "keepers-digital", name: "Keepers Digital Marketing" },
]);
assert.deepEqual(errorFrom({ ok: false, error: "invalid_input", field: "mainService", detail: "x" }), { ok: false, error: "invalid_input", field: "mainService" });
assert.deepEqual(errorFrom({ ok: false, error: "<script>", field: "a b" }), { ok: false, error: "signup_unavailable", field: null });

// ---- The functions, end to end, with fetch stubbed --------------------------

const CRM_HOST = "https://crm.example.test";
let reply = null;
let calls = [];
global.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (reply instanceof Error) throw reply;
  const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
  return new Response(body, { status: reply.status });
};

const allLogs = [];
async function run(fn, { env = { CRM_URL: `${CRM_HOST}/` }, crm = null, method = "POST", body = {}, headers = HEADERS } = {}) {
  delete process.env.CRM_URL;
  Object.assign(process.env, env);
  reply = crm;
  calls = [];
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (data) => ((res.body = JSON.parse(JSON.stringify(data))), res);
  res.setHeader = (name, value) => (res.headers[name] = value);
  const consoleError = console.error;
  console.error = (...args) => allLogs.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  try {
    await fn({ method, body, headers }, res);
  } finally {
    console.error = consoleError;
  }
  return { status: res.statusCode, body: res.body, cache: res.headers["Cache-Control"], call: calls[0], sent: calls.length };
}

const OK_SIGNUP = {
  ok: true,
  signup: { plan: "us", businessName: "Ruiz Pest Control", partnerName: null, firstName: "Ana", quantity: 1, paid: false, accessEmail: "team@boostyourmaps.com", accessConfirmed: false, intakeDone: false, bookingUrl: null, prefill: { websiteUrl: "https://ruizpest.com" } },
};

(async () => {
  // CRM_URL unset: every function answers 503 signup_unavailable, sends nothing.
  for (const [fn, method] of [[partnersFn, "GET"], [startFn, "POST"], [statusFn, "POST"], [accessFn, "POST"], [intakeFn, "POST"], [portalFn, "POST"]]) {
    const r = await run(fn, { env: {}, method, body: { t: TOKEN, k: PORTAL_TOKEN } });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { ok: false, error: "signup_unavailable", field: null });
    assert.equal(r.sent, 0);
    assert.equal(r.cache, "no-store");
  }

  // Wrong method: 405 with Allow, nothing sent.
  let r = await run(startFn, { method: "GET" });
  assert.equal(r.status, 405);
  assert.equal(r.sent, 0);
  r = await run(statusFn, { method: "GET" });
  assert.equal(r.status, 405);
  r = await run(partnersFn, { method: "POST" });
  assert.equal(r.status, 405);

  // Partners: the public list, cached five minutes; failures are not cached.
  r = await run(partnersFn, { method: "GET", crm: { status: 200, body: { ok: true, partners: [{ slug: "keepers-digital", name: "Keepers Digital Marketing" }] } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, partners: [{ slug: "keepers-digital", name: "Keepers Digital Marketing" }] });
  assert.equal(r.cache, "public, max-age=300");
  assert.equal(r.call.url, `${CRM_HOST}/api/signup/partners`);
  assert.equal(r.call.init.method, "GET");
  assert.equal(r.call.init.body, undefined);
  assert.equal(r.call.init.headers["X-Forwarded-For"], "198.51.100.23");
  r = await run(partnersFn, { method: "GET", crm: { status: 500, body: { ok: false, error: "internal" } } });
  assert.equal(r.status, 500);
  assert.equal(r.cache, "no-store");

  // Start: the CRM gets the shaped payload; the page gets the checkout link.
  r = await run(startFn, { body: US_BODY, crm: { status: 200, body: { ok: true, checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123" } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123" });
  assert.equal(r.cache, "no-store");
  assert.equal(r.call.url, `${CRM_HOST}/api/signup`);
  assert.equal(r.call.init.method, "POST");
  assert.deepEqual(JSON.parse(r.call.init.body), buildStartPayload(US_BODY, HEADERS).payload);
  assert.equal(r.call.init.headers["Content-Type"], "application/json");
  assert.equal(r.call.init.headers["X-Forwarded-For"], "198.51.100.23");
  assert.ok(r.call.init.signal instanceof AbortSignal);

  // A body that arrives as a string is read the same way.
  r = await run(startFn, { body: JSON.stringify(US_BODY), crm: { status: 200, body: { ok: true, checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123" } } });
  assert.equal(r.status, 200);
  r = await run(startFn, { body: "{not json" });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { ok: false, error: "invalid_input", field: null });
  assert.equal(r.sent, 0);

  // Honeypot and site-side refusals: 400, nothing sent.
  r = await run(startFn, { body: { ...US_BODY, hp_field_2026: "x" } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { ok: false, error: "invalid_input", field: null });
  assert.equal(r.sent, 0);
  r = await run(startFn, { body: { ...US_BODY, phone: "12" } });
  assert.deepEqual(r.body, { ok: false, error: "invalid_input", field: "phone" });
  assert.equal(r.sent, 0);

  // The CRM's refusals pass through with their status, narrowed to { ok, error, field }.
  for (const [status, body] of [
    [400, { ok: false, error: "invalid_input", field: "email", detail: "secret detail" }],
    [400, { ok: false, error: "partner_unknown", field: null }],
    [429, { ok: false, error: "rate_limited", field: null }],
    [503, { ok: false, error: "signup_unavailable", field: null }],
  ]) {
    r = await run(startFn, { body: US_BODY, crm: { status, body } });
    assert.equal(r.status, status);
    assert.deepEqual(r.body, { ok: false, error: body.error, field: body.field });
  }

  // Anything that is not the CRM answering properly reads as unavailable.
  for (const crm of [
    new TypeError("fetch failed"),
    new TypeError(`Failed to parse URL from ${CRM_HOST}/api/signup/${TOKEN}`),
    Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    { status: 200, body: "<html>Not the CRM</html>" },
    { status: 200, body: { status: "received" } },
    { status: 502, body: "Bad gateway" },
    { status: 200, body: { ok: true, checkoutUrl: "javascript:alert(1)" } },
    { status: 200, body: { ok: true } },
  ]) {
    r = await run(startFn, { body: US_BODY, crm });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { ok: false, error: "signup_unavailable", field: null });
  }

  // Status: token checked first; the CRM is asked with GET /api/signup/{t}.
  r = await run(statusFn, { body: { t: "not-a-token" } });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { ok: false, error: "signup_not_found", field: null });
  assert.equal(r.sent, 0);
  r = await run(statusFn, { body: { t: TOKEN.toUpperCase() } });
  assert.equal(r.sent, 0);
  r = await run(statusFn, { body: { t: TOKEN }, crm: { status: 200, body: OK_SIGNUP } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, signup: shapeSignup(OK_SIGNUP.signup) });
  assert.equal(r.call.url, `${CRM_HOST}/api/signup/${TOKEN}`);
  assert.equal(r.call.init.method, "GET");
  assert.equal(r.cache, "no-store");
  r = await run(statusFn, { body: { t: TOKEN }, crm: { status: 404, body: { ok: false, error: "signup_not_found", field: null } } });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { ok: false, error: "signup_not_found", field: null });

  // Access: POST /api/signup/{t}/access with an empty object.
  r = await run(accessFn, { body: { t: TOKEN }, crm: { status: 200, body: { ok: true } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(r.call.url, `${CRM_HOST}/api/signup/${TOKEN}/access`);
  assert.equal(r.call.init.method, "POST");
  assert.equal(r.call.init.body, "{}");
  r = await run(accessFn, { body: { t: "x" } });
  assert.equal(r.status, 404);
  assert.equal(r.sent, 0);

  // Intake: shaped answers to /intake; refusals before sending name the field.
  r = await run(intakeFn, { body: INTAKE_BODY, crm: { status: 200, body: { ok: true } } });
  assert.equal(r.status, 200);
  assert.equal(r.call.url, `${CRM_HOST}/api/signup/${TOKEN}/intake`);
  assert.deepEqual(JSON.parse(r.call.init.body), buildIntakePayload(INTAKE_BODY).payload);
  assert.equal("t" in JSON.parse(r.call.init.body), false);
  r = await run(intakeFn, { body: { ...INTAKE_BODY, mainService: "" } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { ok: false, error: "invalid_input", field: "mainService" });
  assert.equal(r.sent, 0);
  r = await run(intakeFn, { body: INTAKE_BODY, crm: { status: 400, body: { ok: false, error: "invalid_input", field: "profileLinks" } } });
  assert.deepEqual(r.body, { ok: false, error: "invalid_input", field: "profileLinks" });

  // Portal: POST { k } -> GET /api/partners/portal/{k}.
  r = await run(portalFn, { body: { k: PORTAL_TOKEN }, crm: { status: 200, body: { ok: true, portal: { partnerName: "Keepers Digital Marketing", partnerSlug: "keepers-digital", reportingDashboardUrl: null, bookingUrl: null, clients: [] } } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, portal: { partnerName: "Keepers Digital Marketing", partnerSlug: "keepers-digital", reportingDashboardUrl: null, bookingUrl: null, clients: [] } });
  assert.equal(r.call.url, `${CRM_HOST}/api/partners/portal/${PORTAL_TOKEN}`);
  assert.equal(r.call.init.method, "GET");
  r = await run(portalFn, { body: { k: "short" } });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { ok: false, error: "portal_not_found", field: null });
  assert.equal(r.sent, 0);
  r = await run(portalFn, { body: { k: PORTAL_TOKEN }, crm: { status: 404, body: { ok: false, error: "portal_not_found", field: null } } });
  assert.equal(r.status, 404);

  // Nothing submitted and no token ever reaches the logs.
  assert.ok(allLogs.length > 0, "failures should be logged");
  const secrets = [TOKEN, PORTAL_TOKEN, "ana@example.com", "Ruiz", "+15125550100", "555-0100", "termite", "secret detail", "maps.app.goo.gl", "198.51.100.23"];
  for (const line of allLogs) {
    for (const secret of secrets) assert.ok(!line.includes(secret), `log line leaks ${secret}: ${line}`);
  }

  console.log("Signup payload, token and routing checks passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
