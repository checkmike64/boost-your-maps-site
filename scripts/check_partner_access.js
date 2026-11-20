// Checks the Agency Partners email function (api/partner-access.js) and its
// page script (assets/agency-partners.js): the one fixed answer for a partner's
// email and an unknown one, the honeypot, the limit, a bad origin, what the CRM
// receives, and that no email is ever logged. fetch is replaced by a stub, so
// nothing touches the network.
// Run: node scripts/check_partner_access.js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const accessFn = require("../api/partner-access");
const { NEUTRAL_MESSAGE, allowedOrigin, isJsonRequest, createLimiter } = require("../api/_partner");

const ROOT = path.join(__dirname, "..");
const CRM_HOST = "https://crm.example.test";
const PARTNER_EMAIL = "sean@keepers.example";
const OTHER_EMAIL = "nobody@nowhere.example";
const HEADERS = {
  origin: "https://www.boostyourmaps.com",
  "content-type": "application/json",
  "x-forwarded-for": "198.51.100.23, 10.0.0.1",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)",
};

let calls = [];
let reply = { status: 200, body: { ok: true } };
global.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (reply instanceof Error) throw reply;
  return new Response(JSON.stringify(reply.body), { status: reply.status });
};

const logs = [];
async function run({ method = "POST", body = { email: PARTNER_EMAIL }, headers = HEADERS, env = { CRM_URL: `${CRM_HOST}/` } } = {}) {
  delete process.env.CRM_URL;
  Object.assign(process.env, env);
  calls = [];
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (data) => ((res.body = JSON.parse(JSON.stringify(data))), res);
  res.setHeader = (name, value) => (res.headers[name] = value);
  const saved = [console.error, console.log, console.warn, console.info];
  const grab = (...args) => logs.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  console.error = console.log = console.warn = console.info = grab;
  try {
    await accessFn({ method, body, headers }, res);
  } finally {
    [console.error, console.log, console.warn, console.info] = saved;
  }
  return { status: res.statusCode, body: res.body, headers: res.headers, call: calls[0], sent: calls.length };
}

// A fresh visitor for each case that is not about the limit.
let visitor = 0;
const as = (extra = {}) => ({ ...HEADERS, "x-forwarded-for": `203.0.113.${++visitor % 250}`, ...extra });

(async () => {
  // ---- the one answer ------------------------------------------------------
  const hit = await run({ headers: as() });
  const miss = await run({ headers: as(), body: { email: OTHER_EMAIL } });
  assert.equal(hit.status, 200);
  assert.deepEqual(hit.body, { ok: true });
  // A partner's email and an unknown one: the same status, the same body, the
  // same headers, and the same call to the CRM apart from the address.
  assert.equal(miss.status, hit.status);
  assert.deepEqual(miss.body, hit.body);
  assert.deepEqual(miss.headers, hit.headers);
  assert.equal(hit.sent, 1);
  assert.equal(miss.sent, 1);
  // The CRM answers { ok: true } for everyone, so even a different CRM answer
  // body (the CRM adding a key one day) cannot reach the page.
  reply = { status: 200, body: { ok: true, matched: true, agency: "Keepers Digital Marketing" } };
  const leaky = await run({ headers: as() });
  assert.deepEqual(leaky.body, { ok: true });
  reply = { status: 200, body: { ok: true } };

  // ---- what the CRM receives ----------------------------------------------
  assert.equal(hit.call.url, `${CRM_HOST}/api/partners/access`);
  assert.equal(hit.call.init.method, "POST");
  assert.equal(hit.call.init.headers["Content-Type"], "application/json");
  const sent = JSON.parse(hit.call.init.body);
  assert.deepEqual(Object.keys(sent).sort(), ["clientIp", "email", "userAgent"]);
  assert.equal(sent.email, PARTNER_EMAIL);
  assert.match(sent.clientIp, /^203\.0\.113\.\d+$/);
  assert.ok(Buffer.byteLength(hit.call.init.body) < 1024, "the CRM takes at most 1 KiB");
  assert.ok(hit.call.init.signal, "an 8 second timeout is set");
  // The address is trimmed; a body that only looks like it carries more keys is cut down.
  const trimmed = await run({ headers: as(), body: { email: `  ${PARTNER_EMAIL} `, agency: "Keepers", plan: "partner" } });
  assert.deepEqual(Object.keys(JSON.parse(trimmed.call.init.body)).sort(), ["clientIp", "email", "userAgent"]);
  assert.equal(JSON.parse(trimmed.call.init.body).email, PARTNER_EMAIL);

  // ---- the honeypot --------------------------------------------------------
  const bot = await run({ headers: as(), body: { email: PARTNER_EMAIL, hp_field_2026: "http://spam.example" } });
  assert.equal(bot.status, 200);
  assert.deepEqual(bot.body, { ok: true });
  assert.equal(bot.sent, 0);

  // ---- origin and shape ----------------------------------------------------
  for (const origin of ["https://evil.example", "http://www.boostyourmaps.com", "https://boostyourmaps.com.evil.example", "null"]) {
    const r = await run({ headers: as({ origin }) });
    assert.equal(r.status, 403, origin);
    assert.equal(r.sent, 0);
  }
  const noOrigin = await run({ headers: { ...as(), origin: undefined } });
  assert.equal(noOrigin.status, 403);
  assert.equal(noOrigin.sent, 0);
  // A referer on the site stands in for a missing origin, as on /api/places.
  const viaReferer = await run({ headers: { ...as(), origin: undefined, referer: "https://www.boostyourmaps.com/agency-partners" } });
  assert.equal(viaReferer.status, 200);
  const foreignReferer = await run({ headers: { ...as(), origin: undefined, referer: "https://evil.example/agency-partners" } });
  assert.equal(foreignReferer.status, 403);
  // The live site, a preview of this project and a local run are allowed.
  assert.equal(allowedOrigin({ origin: "https://boostyourmaps.com" }), true);
  assert.equal(allowedOrigin({ origin: "https://boostyourmaps-abc123-mike-8166s-projects.vercel.app" }), true);
  assert.equal(allowedOrigin({ origin: "http://localhost:3000" }), true);
  assert.equal(allowedOrigin({ origin: "https://evil-mike-8166s-projects.vercel.app" }), false);
  // A form post (not JSON) cannot get through, which stops a cross-site form.
  assert.equal(isJsonRequest({ "content-type": "application/json; charset=utf-8" }), true);
  assert.equal(isJsonRequest({ "content-type": "application/x-www-form-urlencoded" }), false);
  assert.equal(isJsonRequest({ "content-type": "text/plain" }), false);
  const form = await run({ headers: as({ "content-type": "application/x-www-form-urlencoded" }) });
  assert.equal(form.status, 400);
  assert.equal(form.sent, 0);
  // Methods, bad bodies, bad emails.
  const get = await run({ method: "GET", headers: as() });
  assert.equal(get.status, 405);
  assert.equal(get.headers.Allow, "POST");
  for (const email of ["", "   ", "not-an-email", "a@b", "x".repeat(321) + "@a.example", null, 42, ["a@b.example"]]) {
    const r = await run({ headers: as(), body: { email } });
    assert.equal(r.status, 400, JSON.stringify(email));
    assert.deepEqual(r.body, { ok: false, error: "invalid_input", field: "email" });
    assert.equal(r.sent, 0);
  }
  const garbage = await run({ headers: as(), body: "not json" });
  assert.equal(garbage.status, 400);
  assert.equal(garbage.sent, 0);
  // The CRM's address is not set: the page can say it cannot send, and sends nothing.
  const unset = await run({ headers: as(), env: {} });
  assert.equal(unset.status, 503);
  assert.equal(unset.sent, 0);

  // ---- the CRM being down says nothing about the address -------------------
  for (const down of [
    { status: 503, body: { ok: false, error: "signup_unavailable" } },
    { status: 500, body: "Server error" },
    { status: 400, body: { ok: false, error: "invalid_input" } },
    new TypeError("fetch failed"),
  ]) {
    reply = down;
    const a = await run({ headers: as() });
    const b = await run({ headers: as(), body: { email: OTHER_EMAIL } });
    assert.equal(a.status, 503);
    assert.deepEqual(a.body, { ok: false, error: "access_unavailable", field: null });
    assert.equal(b.status, 503);
    assert.deepEqual(b.body, a.body);
  }
  reply = { status: 200, body: { ok: true } };

  // ---- the limit: five an hour for each visitor ----------------------------
  const same = { ...HEADERS, "x-forwarded-for": "192.0.2.77" };
  for (let i = 1; i <= 5; i++) {
    const r = await run({ headers: same, body: { email: i % 2 ? PARTNER_EMAIL : OTHER_EMAIL } });
    assert.equal(r.status, 200, `request ${i}`);
  }
  const sixth = await run({ headers: same });
  assert.equal(sixth.status, 429);
  assert.equal(sixth.headers["Retry-After"], "3600");
  assert.deepEqual(sixth.body, { ok: false, error: "rate_limited", field: null });
  assert.equal(sixth.sent, 0);
  // The limit does not depend on which email was typed: an unknown one is
  // held exactly like a partner's.
  const sixthOther = await run({ headers: same, body: { email: OTHER_EMAIL } });
  assert.equal(sixthOther.status, 429);
  assert.deepEqual(sixthOther.body, sixth.body);
  // Another visitor is not held.
  assert.equal((await run({ headers: as() })).status, 200);
  // The window and the ceiling for the whole instance, on a limiter of its own.
  const limiter = createLimiter({ windowMs: 1000, perVisitor: 2, perInstance: 3 });
  const h = (ip) => ({ "x-forwarded-for": ip });
  assert.equal(limiter.take(h("198.51.100.1"), 0), true);
  assert.equal(limiter.take(h("198.51.100.1"), 10), true);
  assert.equal(limiter.take(h("198.51.100.1"), 20), false);
  assert.equal(limiter.take(h("198.51.100.2"), 30), true);
  assert.equal(limiter.take(h("198.51.100.3"), 40), false, "instance ceiling");
  assert.equal(limiter.take(h("198.51.100.1"), 1500), true, "the window moves on");

  // ---- the page -------------------------------------------------------------
  const page = fs.readFileSync(path.join(ROOT, "agency-partners.html"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "assets/agency-partners.js"), "utf8");
  // The page script shows the very words the function keeps.
  assert.equal(NEUTRAL_MESSAGE, "If that email is on file for a partner, we sent your portal link. Check your spam folder if it has not come in a few minutes.");
  assert.ok(script.includes(JSON.stringify(NEUTRAL_MESSAGE)), "the page script shows the fixed answer");
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /data-endpoint="\/api\/partner-access"/);
  assert.equal((page.match(/<input/g) || []).length, 2, "the email field and the honeypot, nothing else");
  assert.match(page, /name="hp_field_2026"/);
  assert.match(page, /name="email"/);
  // No agency is named or listed on the page or in its script, and the page
  // asks for no agency choice.
  assert.doesNotMatch(page + script, /<select|<option|datalist|api\/signup\/partners|loadPartners|partner=|partnerSlug|\/partners\/signup/);
  assert.doesNotMatch(page + script, /Keepers|uAscend|Harrison Kelly|Wise Bear|Maps Partner Agency|Digital Rocket/);
  // The page shows nothing from the answer except that it worked.
  assert.doesNotMatch(script, /data\.(message|agency|partner|name|matched)/);
  assert.match(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"), /"source": "\/agency-partners"/);

  // ---- nothing typed is ever logged ----------------------------------------
  assert.ok(logs.length > 0, "CRM failures should be logged");
  for (const line of logs) {
    for (const secret of [PARTNER_EMAIL, OTHER_EMAIL, "keepers", "nowhere", "198.51.100.23", "203.0.113.", "192.0.2.77", "spam.example", "Mozilla"]) {
      assert.ok(!line.includes(secret), `log line leaks ${secret}: ${line}`);
    }
  }

  console.log("Agency Partners access checks passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
