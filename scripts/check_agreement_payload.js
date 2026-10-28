// Checks the agreement functions (api/_agreement.js, api/agreement/*.js): what
// the BYM CRM receives, what the browser gets back, token checks, and that
// nothing submitted or secret is logged. fetch is replaced by a stub, so
// nothing touches the network.
// Run: node scripts/check_agreement_payload.js
"use strict";

const assert = require("node:assert/strict");
const {
  isToken,
  signedName,
  buildSignPayload,
  errorFrom,
  stripeCheckoutUrl,
  shapeAgreement,
} = require("../api/_agreement");
const loadFn = require("../api/agreement/load");
const viewFn = require("../api/agreement/view");
const signFn = require("../api/agreement/sign");

const TOKEN = "9c1e4b7a2f0d8e6c5b3a1f9e7d5c3b1a0f2e4d6c8b0a1928374655647382910a";
const HEADERS = {
  "x-forwarded-for": "198.51.100.23, 10.0.0.1",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
};
const CHECKOUT = "https://checkout.stripe.com/c/pay/cs_test_a1b2c3#fidkdWxOYHwnPyd1blpxYHZxWjA0";

// ---- Token shape: 64 lowercase hex characters -----------------------------

assert.equal(isToken(TOKEN), true);
assert.equal(isToken(TOKEN.toUpperCase()), false);
assert.equal(isToken(TOKEN.slice(1)), false);
assert.equal(isToken(`${TOKEN}0`), false);
assert.equal(isToken(`../${TOKEN.slice(3)}`), false);
assert.equal(isToken(`${TOKEN.slice(0, 63)}/`), false);
assert.equal(isToken(null), false);
assert.equal(isToken(42), false);

// ---- POST /api/agreements/{token}/sign: the body the page posts -------------

// Shaped exactly as assets/agreement.js posts it from the sign form.
const SIGN_BODY = { t: TOKEN, legal_name: " Ruiz Pest Control LLC ", signatory_name: " Ana Ruiz ", consent: true };

assert.deepEqual(buildSignPayload(SIGN_BODY, HEADERS), {
  payload: {
    legalName: "Ruiz Pest Control LLC",
    signatoryName: "Ana Ruiz",
    consent: true,
    clientIp: "198.51.100.23",
    userAgent: HEADERS["user-agent"],
  },
});
// No visitor headers: null, as the signup sends them.
const bare = buildSignPayload(SIGN_BODY, {}).payload;
assert.equal(bare.clientIp, null);
assert.equal(bare.userAgent, null);
assert.equal(buildSignPayload(SIGN_BODY, { "x-forwarded-for": "not an ip" }).payload.clientIp, null);

// "Continue to payment" on a signed agreement: { t } alone, the CRM gets {}.
assert.deepEqual(buildSignPayload({ t: TOKEN }, HEADERS), { payload: {} });
assert.deepEqual(buildSignPayload({ t: TOKEN, legal_name: null, signatory_name: null, consent: null }, HEADERS), { payload: {} });

// Names: trimmed, 200 characters at most, never cut, no control characters.
assert.equal(signedName("  Ana Ruiz  "), "Ana Ruiz");
assert.equal(signedName("José Núñez-O'Brien"), "José Núñez-O'Brien");
assert.equal(signedName("a".repeat(200)), "a".repeat(200));
assert.equal(signedName("a".repeat(201)), null);
for (const bad of ["", "   ", "Ana\nRuiz", "Ana\tRuiz", "Ana\u0000", "Ana\u007f", "Ana\u0085", "Ana\u2028Ruiz", 7, null, undefined, ["Ana"]]) {
  assert.equal(signedName(bad), null, `name ${JSON.stringify(bad)}`);
}

// Refusals name the field the way the CRM names it, so the page can point at it.
const fieldOf = (body) => {
  const built = buildSignPayload(body, {});
  assert.ok(built.error, `expected a refusal for ${JSON.stringify(body)}`);
  assert.equal(built.error.ok, false);
  assert.equal(built.error.error, "invalid_input");
  return built.error.field;
};
assert.equal(fieldOf({ ...SIGN_BODY, legal_name: "" }), "legalName");
assert.equal(fieldOf({ ...SIGN_BODY, legal_name: "x".repeat(201) }), "legalName");
assert.equal(fieldOf({ ...SIGN_BODY, legal_name: "Ruiz\r\nPest" }), "legalName");
assert.equal(fieldOf({ ...SIGN_BODY, legal_name: undefined }), "legalName");
assert.equal(fieldOf({ ...SIGN_BODY, signatory_name: "  " }), "signatoryName");
assert.equal(fieldOf({ ...SIGN_BODY, signatory_name: "Ana\u0007" }), "signatoryName");
assert.equal(fieldOf({ ...SIGN_BODY, signatory_name: 12 }), "signatoryName");
for (const consent of [false, "true", 1, "yes", undefined, null]) {
  assert.equal(fieldOf({ ...SIGN_BODY, consent }), "consent", `consent ${JSON.stringify(consent)}`);
}
// Any one of the three sent means a signature: all three are then required.
assert.equal(fieldOf({ t: TOKEN, consent: true }), "legalName");
assert.equal(fieldOf({ t: TOKEN, signatory_name: "Ana Ruiz" }), "legalName");
assert.equal(fieldOf({ t: TOKEN, legal_name: "Ruiz Pest Control" }), "signatoryName");
assert.equal(fieldOf({ t: TOKEN, consent: false }), "legalName");
assert.equal(buildSignPayload(null, {}).error.field, null);

// ---- What the browser gets back --------------------------------------------

// Only a Stripe checkout link ever goes back to the page.
assert.equal(stripeCheckoutUrl(CHECKOUT), CHECKOUT);
for (const bad of [
  "http://checkout.stripe.com/c/pay/cs_test_a1b2c3",
  "https://checkout.stripe.com.evil.example/c/pay",
  "https://checkout.stripe.com@evil.example/c/pay",
  "https://user:pw@checkout.stripe.com/c/pay",
  "https://evil.example/https://checkout.stripe.com/",
  "https://billing.stripe.com/p/session/x",
  "javascript:alert(1)",
  "https://checkout.stripe.com",
  `https://checkout.stripe.com/c/pay/${"x".repeat(2100)}`,
  "",
  null,
  42,
]) {
  assert.equal(stripeCheckoutUrl(bad), null, `checkout ${String(bad).slice(0, 60)}`);
}

assert.deepEqual(errorFrom({ ok: false, error: "invalid_input", field: "signatoryName", detail: "x" }), { ok: false, error: "invalid_input", field: "signatoryName" });
assert.deepEqual(errorFrom({ ok: false, error: "agreement_expired", field: null }), { ok: false, error: "agreement_expired", field: null });
assert.deepEqual(errorFrom({ ok: false, error: "<script>", field: "a b" }), { ok: false, error: "agreement_unavailable", field: null });
assert.deepEqual(errorFrom(null), { ok: false, error: "agreement_unavailable", field: null });

// The CRM's agreement, as the contract describes it (plus keys that must stay
// on the server).
const SECTIONS = [
  { heading: null, blocks: [{ kind: "p", text: "This Service Agreement is between the Client and Impact Leads LLC. By purchasing or using our services, you agree to the terms below." }] },
  {
    heading: "1. Services",
    blocks: [
      { kind: "p", text: "We provide Google Maps organic marketing services including:" },
      { kind: "li", text: "Initial profile optimization" },
      { kind: "li", text: "30 local map citations per month" },
    ],
  },
  {
    heading: "9. Contact",
    blocks: [
      { kind: "line", text: "Michael Moll" },
      { kind: "line", text: "Impact Leads LLC" },
      { kind: "line", text: "Email: team@boostyourmaps.com" },
    ],
  },
];
const CONSENT = "I have read this agreement and agree to its terms. I agree to sign it electronically, and my typed name is my signature.";
const AGREEMENT = {
  status: "sent",
  title: "Service Agreement",
  version: 1,
  businessName: "Ruiz Pest Control",
  contactName: "Ana Ruiz",
  email: "ana@ruizpest.com",
  service: "GBP Marketing",
  locations: 2,
  unitPrice: "$450 per month",
  totalPrice: "$900 per month",
  summary: "Month to month. Cancel with 7 days' written notice.",
  provider: { name: "Impact Leads LLC (Boost Your Maps)", lines: ["1021 E Lincolnway, Suite #5789", "Cheyenne, WY 82001, USA"] },
  sections: SECTIONS,
  consentText: CONSENT,
  expiresAt: "2026-11-27T18:00:00.000Z",
  signedAt: null,
  legalName: null,
  signatoryName: null,
  // Never for the browser:
  id: "agr_123",
  stripeCustomerId: "cus_secret",
  signerIp: "203.0.113.9",
  pdfUrl: "https://crm.example.test/private.pdf",
};
const SHAPED = {
  status: "sent",
  title: "Service Agreement",
  version: 1,
  businessName: "Ruiz Pest Control",
  contactName: "Ana Ruiz",
  email: "ana@ruizpest.com",
  service: "GBP Marketing",
  locations: 2,
  unitPrice: "$450 per month",
  totalPrice: "$900 per month",
  summary: "Month to month. Cancel with 7 days' written notice.",
  provider: { name: "Impact Leads LLC (Boost Your Maps)", lines: ["1021 E Lincolnway, Suite #5789", "Cheyenne, WY 82001, USA"] },
  sections: SECTIONS,
  consentText: CONSENT,
  expiresAt: "2026-11-27T18:00:00.000Z",
  signedAt: null,
  legalName: null,
  signatoryName: null,
};
assert.deepEqual(shapeAgreement(AGREEMENT), SHAPED);
for (const status of ["viewed", "signed", "paid"]) assert.equal(shapeAgreement({ ...AGREEMENT, status }).status, status);

// Signed: who and when come along; a time with an offset reads as UTC.
const signed = shapeAgreement({ ...AGREEMENT, status: "signed", signedAt: "2026-10-27T14:05:09-05:00", legalName: "Ruiz Pest Control LLC", signatoryName: "Ana Ruiz" });
assert.equal(signed.signedAt, "2026-10-27T19:05:09.000Z");
assert.equal(signed.legalName, "Ruiz Pest Control LLC");
assert.equal(signed.signatoryName, "Ana Ruiz");

// Void and expired come without text, and still read.
assert.equal(shapeAgreement({ ...AGREEMENT, status: "void", sections: [], consentText: null }).status, "void");
assert.deepEqual(shapeAgreement({ ...AGREEMENT, status: "expired", sections: [] }).sections, []);

// Odd display values become null rather than reaching the page.
const odd = shapeAgreement({
  ...AGREEMENT,
  title: 7,
  version: "1",
  businessName: "  ",
  email: "not-an-email",
  locations: 2.5,
  unitPrice: { amount: 450 },
  expiresAt: "next week",
  signedAt: "2026-13-45T99:99:99Z",
  provider: { name: null, lines: ["  ", 5, "Cheyenne, WY", "x".repeat(250)] },
});
assert.equal(odd.title, null);
assert.equal(odd.version, null);
assert.equal(odd.businessName, null);
assert.equal(odd.email, null);
assert.equal(odd.locations, null);
assert.equal(odd.unitPrice, null);
assert.equal(odd.expiresAt, null);
assert.equal(odd.signedAt, null);
assert.equal(odd.provider.name, null);
assert.deepEqual(odd.provider.lines, ["Cheyenne, WY", "x".repeat(200)]);
assert.deepEqual(shapeAgreement({ ...AGREEMENT, provider: null }).provider, { name: null, lines: [] });
assert.equal(shapeAgreement({ ...AGREEMENT, locations: 0 }).locations, null);
assert.equal(shapeAgreement({ ...AGREEMENT, businessName: "b".repeat(300) }).businessName.length, 200);

// The text is passed on as sent: an unknown block kind reads as a paragraph,
// an empty block or heading goes, nothing else changes.
const kinds = shapeAgreement({
  ...AGREEMENT,
  sections: [
    { heading: "  ", blocks: [{ kind: "h4", text: "Kept as a paragraph" }, { kind: "li", text: "   " }] },
    { heading: "2. Term ", blocks: [] },
    { heading: null, blocks: [] },
  ],
}).sections;
assert.deepEqual(kinds, [
  { heading: null, blocks: [{ kind: "p", text: "Kept as a paragraph" }] },
  { heading: "2. Term", blocks: [] },
]);

// Anything that would change or hide the agreement's text: not shown at all.
for (const bad of [
  null,
  "agreement",
  [],
  { ...AGREEMENT, status: "draft" },
  { ...AGREEMENT, status: undefined },
  { ...AGREEMENT, sections: undefined },
  { ...AGREEMENT, sections: "1. Services" },
  { ...AGREEMENT, sections: [null] },
  { ...AGREEMENT, sections: [{ heading: 3, blocks: [] }] },
  { ...AGREEMENT, sections: [{ heading: "1. Services" }] },
  { ...AGREEMENT, sections: [{ heading: "1. Services", blocks: [{ kind: "p", text: 42 }] }] },
  { ...AGREEMENT, sections: [{ heading: "1. Services", blocks: [{ kind: "p", text: "x".repeat(10001) }] }] },
  { ...AGREEMENT, sections: Array.from({ length: 101 }, () => ({ heading: "x", blocks: [] })) },
  { ...AGREEMENT, sections: Array.from({ length: 30 }, () => ({ heading: "x", blocks: [{ kind: "p", text: "y".repeat(9000) }] })) },
  // Out for signing without its text or the consent line.
  { ...AGREEMENT, sections: [] },
  { ...AGREEMENT, status: "viewed", consentText: "" },
  { ...AGREEMENT, consentText: null },
  { ...AGREEMENT, consentText: "c".repeat(2001) },
]) {
  assert.equal(shapeAgreement(bad), null, `should not show ${JSON.stringify(bad).slice(0, 120)}`);
}

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
// Records the timeout each call asks for.
const timeouts = [];
const realTimeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = (ms) => {
  timeouts.push(ms);
  return realTimeout(ms);
};

const allLogs = [];
async function run(fn, { env = { CRM_URL: `${CRM_HOST}/` }, crm = null, method = "POST", body = { t: TOKEN }, headers = HEADERS } = {}) {
  delete process.env.CRM_URL;
  Object.assign(process.env, env);
  reply = crm;
  calls = [];
  timeouts.length = 0;
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
  return { status: res.statusCode, body: res.body, cache: res.headers["Cache-Control"], allow: res.headers.Allow, call: calls[0], sent: calls.length, timeout: timeouts[0] };
}

const UNAVAILABLE = { ok: false, error: "agreement_unavailable", field: null };
const NOT_FOUND = { ok: false, error: "agreement_not_found", field: null };

(async () => {
  const fns = [["load", loadFn], ["view", viewFn], ["sign", signFn]];

  for (const [name, fn] of fns) {
    // CRM_URL unset: 503 agreement_unavailable, nothing sent.
    let r = await run(fn, { env: {} });
    assert.equal(r.status, 503, name);
    assert.deepEqual(r.body, UNAVAILABLE);
    assert.equal(r.sent, 0);
    assert.equal(r.cache, "no-store");

    // POST only.
    r = await run(fn, { method: "GET" });
    assert.equal(r.status, 405, name);
    assert.equal(r.allow, "POST");
    assert.equal(r.sent, 0);

    // A malformed token is refused before the CRM is asked.
    for (const t of ["not-a-token", TOKEN.toUpperCase(), TOKEN.slice(2), `${TOKEN}/view`, undefined, 12]) {
      r = await run(fn, { body: { t } });
      assert.equal(r.status, 404, `${name} token ${t}`);
      assert.deepEqual(r.body, NOT_FOUND);
      assert.equal(r.sent, 0);
      assert.equal(r.cache, "no-store");
    }

    // A body that is not JSON: 400, nothing sent. A JSON string is read.
    r = await run(fn, { body: "{not json" });
    assert.equal(r.status, 400, name);
    assert.deepEqual(r.body, { ok: false, error: "invalid_input", field: null });
    assert.equal(r.sent, 0);

    // The CRM's refusals pass through with their status, narrowed.
    for (const [status, body] of [
      [404, { ok: false, error: "agreement_not_found", field: null }],
      [429, { ok: false, error: "rate_limited", field: null, retryAfter: 30 }],
      [503, { ok: false, error: "agreement_unavailable", field: null }],
    ]) {
      r = await run(fn, { body: JSON.stringify({ t: TOKEN }), crm: { status, body } });
      assert.equal(r.status, status, `${name} ${status}`);
      assert.deepEqual(r.body, { ok: false, error: body.error, field: body.field });
      assert.equal(r.cache, "no-store");
    }

    // Anything that is not the CRM answering properly reads as unavailable.
    for (const crm of [
      new TypeError("fetch failed"),
      new TypeError(`Failed to parse URL from ${CRM_HOST}/api/agreements/${TOKEN}`),
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
      { status: 200, body: "<html>Not the CRM</html>" },
      { status: 200, body: { status: "sent" } },
      { status: 502, body: "Bad gateway" },
    ]) {
      r = await run(fn, { crm });
      assert.equal(r.status, 503, `${name} ${crm instanceof Error ? crm.name : crm.status}`);
      assert.deepEqual(r.body, UNAVAILABLE);
    }
  }

  // Load: POST { t } -> GET /api/agreements/{t}, the shaped agreement back.
  let r = await run(loadFn, { crm: { status: 200, body: { ok: true, agreement: AGREEMENT } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, agreement: SHAPED });
  assert.equal(r.cache, "no-store");
  assert.equal(r.call.url, `${CRM_HOST}/api/agreements/${TOKEN}`);
  assert.equal(r.call.init.method, "GET");
  assert.equal(r.call.init.body, undefined);
  assert.equal(r.call.init.headers.Accept, "application/json");
  assert.equal(r.call.init.headers["X-Forwarded-For"], "198.51.100.23");
  assert.ok(r.call.init.signal instanceof AbortSignal);
  assert.equal(r.timeout, 8000);
  assert.ok(!JSON.stringify(r.body).includes("cus_secret"));
  // An agreement the page cannot show reads as unavailable.
  for (const agreement of [{ ...AGREEMENT, status: "draft" }, { ...AGREEMENT, consentText: null }, null]) {
    r = await run(loadFn, { crm: { status: 200, body: { ok: true, agreement } } });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, UNAVAILABLE);
  }

  // View: POST /api/agreements/{t}/view with {}; the page only needs ok.
  r = await run(viewFn, { crm: { status: 200, body: { ok: true, status: "viewed" } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(r.call.url, `${CRM_HOST}/api/agreements/${TOKEN}/view`);
  assert.equal(r.call.init.method, "POST");
  assert.equal(r.call.init.body, "{}");
  assert.equal(r.call.init.headers["Content-Type"], "application/json");
  assert.equal(r.timeout, 8000);

  // Sign: the shaped signature to /sign; the page gets the checkout link.
  r = await run(signFn, { body: SIGN_BODY, crm: { status: 200, body: { ok: true, checkoutUrl: CHECKOUT, agreementId: "agr_123" } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, checkoutUrl: CHECKOUT });
  assert.equal(r.cache, "no-store");
  assert.equal(r.call.url, `${CRM_HOST}/api/agreements/${TOKEN}/sign`);
  assert.equal(r.call.init.method, "POST");
  assert.deepEqual(JSON.parse(r.call.init.body), buildSignPayload(SIGN_BODY, HEADERS).payload);
  assert.equal("t" in JSON.parse(r.call.init.body), false);
  assert.equal(r.call.init.headers["X-Forwarded-For"], "198.51.100.23");
  assert.equal(r.timeout, 10000);
  // The way to pay on a signed agreement: { t } alone, the CRM gets {}.
  r = await run(signFn, { body: { t: TOKEN }, crm: { status: 200, body: { ok: true, checkoutUrl: CHECKOUT } } });
  assert.equal(r.status, 200);
  assert.equal(r.call.init.body, "{}");
  // Site-side refusals: 400 naming the field, nothing sent.
  for (const [body, field] of [
    [{ ...SIGN_BODY, legal_name: " " }, "legalName"],
    [{ ...SIGN_BODY, signatory_name: "x".repeat(201) }, "signatoryName"],
    [{ ...SIGN_BODY, consent: false }, "consent"],
  ]) {
    r = await run(signFn, { body });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { ok: false, error: "invalid_input", field });
    assert.equal(r.sent, 0);
  }
  // The CRM's refusals pass through: field errors and a closed agreement.
  for (const [status, body] of [
    [400, { ok: false, error: "invalid_input", field: "legalName" }],
    [409, { ok: false, error: "agreement_paid", field: null }],
    [409, { ok: false, error: "agreement_void", field: null }],
    [409, { ok: false, error: "agreement_expired", field: null }],
  ]) {
    r = await run(signFn, { body: SIGN_BODY, crm: { status, body } });
    assert.equal(r.status, status);
    assert.deepEqual(r.body, body);
  }
  // A link that is not Stripe checkout (or none) never reaches the page.
  for (const checkoutUrl of ["https://evil.example/pay", "http://checkout.stripe.com/c/pay/x", "javascript:alert(1)", undefined]) {
    r = await run(signFn, { body: SIGN_BODY, crm: { status: 200, body: { ok: true, checkoutUrl } } });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, UNAVAILABLE);
  }

  // Nothing submitted, no token, IP, email or browser ever reaches the logs.
  assert.ok(allLogs.length > 0, "failures should be logged");
  const secrets = [TOKEN, "Ana", "Ruiz", "ana@ruizpest.com", "198.51.100.23", "iPhone", "cs_test", "cus_secret"];
  for (const line of allLogs) {
    for (const secret of secrets) assert.ok(!line.includes(secret), `log line leaks ${secret}: ${line}`);
  }

  console.log("Agreement payload, token and routing checks passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
