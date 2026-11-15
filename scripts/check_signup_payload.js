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

// ---- POST /api/signup from the partner portal (partner_token) ---------------

// Shaped as assets/signup.js posts it on /partners/signup#k=<key> when the
// agency and its contact are known: no name or email, the portal key instead
// of the agency slug.
const PORTAL_BODY = {
  plan: "partner",
  partner: null,
  partner_token: PORTAL_TOKEN,
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  business_name: "Green Leaf Lawn",
  website: "greenleaf.example.com",
  locations: 2,
  page_url: `https://www.boostyourmaps.com/partners/signup?utm_source=portal#k=${PORTAL_TOKEN}`,
  hp_field_2026: "",
};
assert.deepEqual(buildStartPayload(PORTAL_BODY, HEADERS), {
  payload: {
    plan: "partner",
    partnerToken: PORTAL_TOKEN,
    phone: null,
    businessName: "Green Leaf Lawn",
    websiteUrl: "https://greenleaf.example.com/",
    quantity: 2,
    sourceUrl: "https://www.boostyourmaps.com/partners/signup?utm_source=portal", // never the #k= key
    utm: { utm_source: "portal" },
    clientIp: "198.51.100.23",
    userAgent: HEADERS["user-agent"],
  },
});
// Every page address goes without its fragment.
assert.equal(buildStartPayload({ ...US_BODY, page_url: "https://www.boostyourmaps.com/get-started#top" }, {}).payload.sourceUrl, "https://www.boostyourmaps.com/get-started");

// No contact on file: the page asks, and the person goes along with the key.
const asked = buildStartPayload({ ...PORTAL_BODY, first_name: "Sam", last_name: "Lee", email: "sam@acme.example" }, {}).payload;
assert.equal(asked.partnerToken, PORTAL_TOKEN);
assert.equal("partner" in asked, false);
assert.deepEqual([asked.firstName, asked.lastName, asked.email], ["Sam", "Lee", "sam@acme.example"]);
// Once any of them is typed, the usual checks apply.
assert.equal(buildStartPayload({ ...PORTAL_BODY, email: "sam@acme.example" }, {}).error.field, "firstName");
assert.equal(buildStartPayload({ ...PORTAL_BODY, first_name: "Sam" }, {}).error.field, "email");
assert.equal(buildStartPayload({ ...PORTAL_BODY, last_name: "Lee" }, {}).error.field, "firstName");
// The key wins over a slug; a malformed key is refused before anything is sent.
const both = buildStartPayload({ ...PORTAL_BODY, partner: "keepers-digital" }, {}).payload;
assert.equal(both.partnerToken, PORTAL_TOKEN);
assert.equal("partner" in both, false);
for (const bad of [PORTAL_TOKEN.toUpperCase(), PORTAL_TOKEN.slice(1), `${PORTAL_TOKEN}a`, "k".repeat(64), "../"]) {
  assert.equal(buildStartPayload({ ...PORTAL_BODY, partner_token: bad }, {}).error.field, "partnerToken", `token ${bad}`);
}
// A blank key falls back to the dropdown's slug, and a key on a direct plan is dropped.
assert.equal(buildStartPayload({ ...PORTAL_BODY, partner_token: "  ", partner: "keepers-digital", first_name: "Sam", email: "sam@acme.example" }, {}).payload.partner, "keepers-digital");
assert.equal(buildStartPayload({ ...PORTAL_BODY, partner_token: " ", partner: "" }, {}).error.field, "partner");
const direct = buildStartPayload({ ...US_BODY, partner_token: PORTAL_TOKEN }, {}).payload;
assert.equal("partnerToken" in direct, false);
assert.equal(direct.partner, null);
assert.equal(direct.firstName, "Ana");
// Without a key the name and email are still required on every plan.
assert.equal(buildStartPayload({ ...PORTAL_BODY, partner_token: "", partner: "keepers-digital" }, {}).error.field, "firstName");

// ---- First-touch attribution on the signup start ---------------------------

// Shaped as assets/tracking.js keeps it and assets/signup.js posts it: where
// the buyer's browser first came from, often days before the signup page.
const ATTRIBUTION = {
  landing: "https://www.boostyourmaps.com/google-maps-marketing/pest-control?utm_source=google&utm_medium=cpc&utm_campaign=pest-phoenix&gclid=Cj0KCQjw-first_touch",
  referrer: "https://www.google.com/",
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "pest-phoenix",
  gclid: "Cj0KCQjw-first_touch",
  first_seen_at: "2026-11-02T15:04:05.678Z",
};
const NO_ATTRIBUTION = buildStartPayload(US_BODY, HEADERS).payload;
const startWith = (attribution, body = US_BODY) => buildStartPayload({ ...body, attribution }, HEADERS);

// Present: the CRM gets it as `attribution`. The page's own utm and sourceUrl
// stay as they were.
assert.deepEqual(startWith(ATTRIBUTION).payload, { ...NO_ATTRIBUTION, attribution: ATTRIBUTION });
assert.deepEqual(startWith(ATTRIBUTION).payload.utm, { utm_source: "google", utm_medium: "cpc" });
assert.equal(startWith(ATTRIBUTION).payload.sourceUrl, US_BODY.page_url);
// Every key the CRM takes, and nothing renamed.
const FULL_ATTRIBUTION = {
  ...ATTRIBUTION,
  utm_term: "pest control seo",
  utm_content: "ad-2",
  gbraid: "0AAAAAo4mICH-gbraid",
  wbraid: "CjkKCQjw-wbraid",
  fbclid: "IwAR0-fbclid",
};
assert.deepEqual(startWith(FULL_ATTRIBUTION).payload.attribution, FULL_ATTRIBUTION);
assert.deepEqual(Object.keys(FULL_ATTRIBUTION).sort(), [
  "fbclid", "first_seen_at", "gbraid", "gclid", "landing", "referrer", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term", "wbraid",
]);
// It goes with a portal signup too, and a phone app as the referrer is kept.
assert.deepEqual(startWith(ATTRIBUTION, PORTAL_BODY).payload.attribution, ATTRIBUTION);
assert.equal(startWith({ ...ATTRIBUTION, referrer: "android-app://com.google.android.gm/" }).payload.attribution.referrer, "android-app://com.google.android.gm/");
// Values are trimmed, a blank one is left out, 500 characters is the most.
assert.deepEqual(startWith({ utm_source: " google ", utm_medium: "  ", gclid: "" }).payload.attribution, { utm_source: "google" });
assert.equal(startWith({ utm_campaign: "z".repeat(500) }).payload.attribution.utm_campaign.length, 500);

// Absent, or nothing in it: the payload is exactly what it was before, with no
// `attribution` key at all.
for (const none of [undefined, null, {}, { utm_source: "   " }]) {
  assert.deepEqual(startWith(none).payload, NO_ATTRIBUTION, `attribution ${JSON.stringify(none)}`);
  assert.equal("attribution" in startWith(none).payload, false);
}

// Unknown keys are left out; the keys the CRM knows still go.
assert.deepEqual(
  startWith({ ...ATTRIBUTION, msclkid: "abc", email: "ana@example.com", visitor: { id: 7 }, expires_at: "2027-01-31T00:00:00.000Z" }).payload.attribution,
  ATTRIBUTION
);
assert.deepEqual(startWith({ msclkid: "abc", note: "x".repeat(9000) }).payload, NO_ATTRIBUTION);
assert.deepEqual(startWith(JSON.parse('{"__proto__": {"utm_source": "google"}, "constructor": "x"}')).payload, NO_ATTRIBUTION);

// Malformed or oversized: dropped whole, never repaired, and the signup still
// goes exactly as it would without it.
const TOKEN_IN_LINK = `https://www.boostyourmaps.com/welcome?t=${TOKEN}`;
const dropped = {
  "not an object: a string": "utm_source=google",
  "not an object: a number": 42,
  "not an object: true": true,
  "a list": [ATTRIBUTION],
  "an empty list": [],
  "a number as a value": { ...ATTRIBUTION, utm_source: 7 },
  "null as a value": { ...ATTRIBUTION, gclid: null },
  "a list as a value": { ...ATTRIBUTION, utm_campaign: ["pest-phoenix"] },
  "an object as a value": { ...ATTRIBUTION, landing: { href: ATTRIBUTION.landing } },
  "a control character": { ...ATTRIBUTION, utm_campaign: "pest\u0000phoenix" },
  "a line break": { ...ATTRIBUTION, utm_term: "pest\ncontrol" },
  "half an emoji": { ...ATTRIBUTION, utm_content: "ad-\ud83d" },
  "a landing that is not a web address": { ...ATTRIBUTION, landing: "javascript:alert(1)" },
  "a landing that is only a path": { ...ATTRIBUTION, landing: "/pricing?utm_source=google" },
  "a landing with its fragment": { ...ATTRIBUTION, landing: "https://www.boostyourmaps.com/pricing#faq" },
  "a referrer that is not an address": { ...ATTRIBUTION, referrer: "google" },
  "a referrer that is a script": { ...ATTRIBUTION, referrer: "javascript:alert(1)" },
  "a first-seen time in words": { ...ATTRIBUTION, first_seen_at: "yesterday" },
  "a first-seen date without a time": { ...ATTRIBUTION, first_seen_at: "2026-11-02" },
  "a first-seen time that does not exist": { ...ATTRIBUTION, first_seen_at: "2026-13-45T99:99:99.000Z" },
  // Never a private link: 64 hex characters in a row is the shape of a token.
  "a welcome link as the landing": { ...ATTRIBUTION, landing: TOKEN_IN_LINK },
  "a portal key in the referrer": { ...ATTRIBUTION, referrer: `https://www.boostyourmaps.com/partners/portal?k=${PORTAL_TOKEN}` },
  "a token as a campaign value": { ...ATTRIBUTION, utm_content: TOKEN.toUpperCase() },
  // Oversized: one value over 500 characters, or the whole object over what
  // the CRM's column takes (each value here is within 500 characters).
  "a value of 501 characters": { ...ATTRIBUTION, utm_campaign: "z".repeat(501) },
  "a landing of 501 characters": { ...ATTRIBUTION, landing: `https://www.boostyourmaps.com/?q=${"x".repeat(468)}` },
  "an object over the column size": Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].map((key) => [key, "é".repeat(500)])),
};
assert.equal(dropped["a landing of 501 characters"].landing.length, 501);
for (const [what, attribution] of Object.entries(dropped)) {
  const built = startWith(attribution);
  assert.equal(built.error, undefined, `the signup is never refused over ${what}`);
  assert.deepEqual(built.payload, NO_ATTRIBUTION, `dropped whole: ${what}`);
}
// A large one that still fits is kept: what the CRM receives is never over
// 3,000 bytes as JSON, well inside its 4,096-byte column.
const LARGE_ATTRIBUTION = Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].map((key) => [key, "é".repeat(290)]));
for (const attribution of [ATTRIBUTION, FULL_ATTRIBUTION, LARGE_ATTRIBUTION]) {
  const kept = startWith(attribution).payload.attribution;
  assert.deepEqual(kept, attribution);
  assert.ok(Buffer.byteLength(JSON.stringify(kept), "utf8") <= 3000);
}

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

// The checkout total, for the welcome page's one purchase event: it goes along
// when the CRM sends a whole number of cents above zero. Otherwise the key is
// not there at all, and the page pushes no purchase event.
assert.equal(shapeSignup({ plan: "us", quantity: 2, paid: true, amountCents: 90000 }).amountCents, 90000);
assert.equal(shapeSignup({ plan: "partner", paid: true, amountCents: 1 }).amountCents, 1);
assert.equal(shapeSignup({ plan: "us", paid: false, amountCents: 45000 }).amountCents, 45000);
for (const amountCents of [undefined, null, 0, -45000, 450.5, "90000", NaN, Infinity, 100000001, [90000], { cents: 90000 }, true]) {
  assert.equal("amountCents" in shapeSignup({ plan: "us", paid: true, amountCents }), false, `amountCents ${String(amountCents)}`);
}
assert.equal("amountCents" in odd, false);

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
    contact: null,
    clients: [
      { name: "Ruiz Pest Control", city: "Austin, TX", locations: 1, stage: "live", since: "2026-10-09", links: { deliverables: "https://docs.google.com/x", photos: null, dashboard: null } },
      { name: "Odd", city: null, locations: null, stage: null, since: null, links: { deliverables: null, photos: null, dashboard: null } },
    ],
  }
);

// The agency's primary contact: { name, email } with a real email, else null.
const contactOf = (contact) => shapePortal({ partnerName: "Keepers Digital Marketing", contact }).contact;
assert.deepEqual(contactOf({ name: "Sean Grabowski", email: "sean@keepers.example", phone: "+15125550100" }), { name: "Sean Grabowski", email: "sean@keepers.example" });
assert.deepEqual(contactOf({ name: "  ", email: "sean@keepers.example" }), { name: null, email: "sean@keepers.example" });
assert.equal(contactOf({ name: "Sean", email: "not-an-email" }), null);
assert.equal(contactOf(null), null);
assert.equal(contactOf(undefined), null);
assert.equal(contactOf("sean@keepers.example"), null);
assert.equal(contactOf({ name: "n".repeat(200), email: "sean@keepers.example" }).name.length, 120);

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
  assert.equal("amountCents" in r.body.signup, false); // the CRM sent none
  r = await run(statusFn, { body: { t: TOKEN }, crm: { status: 404, body: { ok: false, error: "signup_not_found", field: null } } });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { ok: false, error: "signup_not_found", field: null });
  // Paid, with the checkout total: the page gets amountCents for its purchase event.
  r = await run(statusFn, { body: { t: TOKEN }, crm: { status: 200, body: { ok: true, signup: { ...OK_SIGNUP.signup, quantity: 2, paid: true, amountCents: 90000 } } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.signup, { ...shapeSignup(OK_SIGNUP.signup), quantity: 2, paid: true, amountCents: 90000 });
  r = await run(statusFn, { body: { t: TOKEN }, crm: { status: 200, body: { ok: true, signup: { ...OK_SIGNUP.signup, paid: true, amountCents: "90000" } } } });
  assert.equal("amountCents" in r.body.signup, false);

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
  r = await run(portalFn, { body: { k: PORTAL_TOKEN }, crm: { status: 200, body: { ok: true, portal: { partnerName: "Keepers Digital Marketing", partnerSlug: "keepers-digital", reportingDashboardUrl: null, bookingUrl: null, contact: { name: "Sean Grabowski", email: "sean@keepers.example" }, clients: [] } } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, portal: { partnerName: "Keepers Digital Marketing", partnerSlug: "keepers-digital", reportingDashboardUrl: null, bookingUrl: null, contact: { name: "Sean Grabowski", email: "sean@keepers.example" }, clients: [] } });
  assert.equal(r.call.url, `${CRM_HOST}/api/partners/portal/${PORTAL_TOKEN}`);
  assert.equal(r.call.init.method, "GET");
  r = await run(portalFn, { body: { k: "short" } });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { ok: false, error: "portal_not_found", field: null });
  assert.equal(r.sent, 0);
  r = await run(portalFn, { body: { k: PORTAL_TOKEN }, crm: { status: 404, body: { ok: false, error: "portal_not_found", field: null } } });
  assert.equal(r.status, 404);

  // Start from the portal: the CRM gets partnerToken and no person; its
  // refusal for a missing contact points the page at the name or email.
  r = await run(startFn, { body: PORTAL_BODY, crm: { status: 200, body: { ok: true, checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_456" } } });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.call.init.body), buildStartPayload(PORTAL_BODY, HEADERS).payload);
  assert.ok(!r.call.init.body.includes("#k="));
  for (const field of ["firstName", "email"]) {
    r = await run(startFn, { body: PORTAL_BODY, crm: { status: 400, body: { ok: false, error: "invalid_input", field } } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { ok: false, error: "invalid_input", field });
  }
  r = await run(startFn, { body: PORTAL_BODY, crm: { status: 400, body: { ok: false, error: "partner_unknown", field: null } } });
  assert.deepEqual(r.body, { ok: false, error: "partner_unknown", field: null });
  r = await run(startFn, { body: { ...PORTAL_BODY, partner_token: "nope" } });
  assert.deepEqual(r.body, { ok: false, error: "invalid_input", field: "partnerToken" });
  assert.equal(r.sent, 0);
  r = await run(startFn, { body: PORTAL_BODY, crm: new TypeError(`fetch failed for ${CRM_HOST}/api/signup ${PORTAL_TOKEN}`) });
  assert.equal(r.status, 503);

  // Start with attribution: the CRM gets it in the same body, without the
  // keys it does not know. A malformed one is left out and the signup goes
  // through all the same.
  const OK_CHECKOUT = { status: 200, body: { ok: true, checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_789" } };
  r = await run(startFn, { body: { ...US_BODY, attribution: { ...ATTRIBUTION, msclkid: "abc" } }, crm: OK_CHECKOUT });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_789" });
  assert.deepEqual(JSON.parse(r.call.init.body), { ...NO_ATTRIBUTION, attribution: ATTRIBUTION });
  r = await run(startFn, { body: { ...US_BODY, attribution: null }, crm: OK_CHECKOUT });
  assert.deepEqual(JSON.parse(r.call.init.body), NO_ATTRIBUTION);
  for (const attribution of [{ ...ATTRIBUTION, landing: TOKEN_IN_LINK }, { ...ATTRIBUTION, utm_source: 7 }, "utm_source=google", { ...ATTRIBUTION, utm_campaign: "z".repeat(501) }]) {
    r = await run(startFn, { body: { ...US_BODY, attribution }, crm: OK_CHECKOUT });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.call.init.body), NO_ATTRIBUTION);
    assert.ok(!r.call.init.body.includes(TOKEN));
  }
  // A refusal with attribution on board is logged like any other: no value of it.
  r = await run(startFn, { body: { ...US_BODY, attribution: ATTRIBUTION }, crm: { status: 429, body: { ok: false, error: "rate_limited", field: null } } });
  assert.equal(r.status, 429);
  r = await run(startFn, { body: { ...US_BODY, attribution: ATTRIBUTION }, crm: new TypeError("fetch failed") });
  assert.equal(r.status, 503);

  // Nothing submitted and no token ever reaches the logs.
  assert.ok(allLogs.length > 0, "failures should be logged");
  const secrets = [TOKEN, PORTAL_TOKEN, "ana@example.com", "Ruiz", "+15125550100", "555-0100", "termite", "secret detail", "maps.app.goo.gl", "198.51.100.23", "pest-phoenix", "first_touch", "google.com"];
  for (const line of allLogs) {
    for (const secret of secrets) assert.ok(!line.includes(secret), `log line leaks ${secret}: ${line}`);
  }

  console.log("Signup payload, token and routing checks passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
