// Checks the visibility report form's place search payload, the CRM's
// "asked too recently" answer, the countdown, and the bot-check hook.
// fetch and the clock are fakes, so nothing touches the network.
// Run: node scripts/check_visibility_form.js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildCrmPayload, reportFrom } = require("../api/_crm");
const { humanCheckOn, humanCheckFailed } = require("../api/_human");
const visibilityReport = require("../api/visibility-report");
const retry = require("../assets/retry-countdown");

const ROOT = path.join(__dirname, "..");
const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4"; // Google's documented example
const HEADERS = { "x-forwarded-for": "203.0.113.7", "user-agent": "Mozilla/5.0" };
const BODY = {
  form_type: "visibility_report",
  page_url: "https://www.boostyourmaps.com/visibility-report",
  fields: {
    business_name: "Bay Pest Co",
    place_id: PLACE_ID,
    place_label: "Bay Pest Co, 12 Main St, Tampa, FL",
    service: "pest control",
    location: "Tampa, FL",
    phone: "813-555-0142",
    email: "dana@example.com",
  },
};

// ---- Payload: field names the CRM's forms route accepts ---------------------
// The route takes placeId and placeLabel beside answers (strict schema).
let payload = buildCrmPayload(BODY, HEADERS);
assert.equal(payload.placeId, PLACE_ID);
assert.equal(payload.placeLabel, "Bay Pest Co, 12 Main St, Tampa, FL");
assert.equal(payload.answers.business_name, "Bay Pest Co");
assert.ok(!("place_id" in payload.answers) && !("place_label" in payload.answers));
const allowed = ["name", "email", "phone", "answers", "placeId", "placeLabel", "sourceUrl", "utm", "visitorId", "clientIp", "userAgent"];
assert.deepEqual(Object.keys(payload).filter((k) => !allowed.includes(k)), []);

// The place is optional: none, empty or a wrong shape sends neither key.
for (const fields of [{ email: "a@example.com" }, { email: "a@example.com", place_id: "", place_label: "x" }, { email: "a@example.com", place_id: "short id!", place_label: "x" }]) {
  payload = buildCrmPayload({ fields }, {});
  assert.ok(!("placeId" in payload) && !("placeLabel" in payload));
}
// A label is cut to the CRM's 500 characters; a Place ID alone is fine.
payload = buildCrmPayload({ fields: { email: "a@example.com", place_id: PLACE_ID, place_label: "L".repeat(900) } }, {});
assert.equal(payload.placeLabel.length, 500);
payload = buildCrmPayload({ fields: { email: "a@example.com", place_id: PLACE_ID } }, {});
assert.equal(payload.placeId, PLACE_ID);
assert.ok(!("placeLabel" in payload));

// ---- The CRM's report answer ------------------------------------------------
assert.deepEqual(reportFrom({ ok: true, report: "queued", retryAfterSeconds: null }), { report: "queued" });
assert.deepEqual(reportFrom({ ok: true, report: "rate_limited", retryAfterSeconds: 840 }), { report: "rate_limited", retryAfterSeconds: 840 });
assert.deepEqual(reportFrom({ ok: true, report: "rate_limited", retryAfterSeconds: "soon" }), { report: "rate_limited", retryAfterSeconds: 1200 });
assert.deepEqual(reportFrom({ ok: true, report: "rate_limited", retryAfterSeconds: 99999999 }), { report: "rate_limited", retryAfterSeconds: 1200 });
assert.deepEqual(reportFrom({ ok: true }), {});
assert.deepEqual(reportFrom(null), {});

// ---- The endpoint passes the wait on, and nothing else ----------------------
const CRM_HOST = "https://crm.example.test";
let reply;
let calls = [];
global.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify(reply), { status: 200 });
};
async function post(body) {
  process.env.CRM_URL = CRM_HOST;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  calls = [];
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (d) => ((res.body = JSON.parse(JSON.stringify(d))), res);
  res.setHeader = () => {};
  await visibilityReport({ method: "POST", body, headers: HEADERS }, res);
  for (const c of calls) assert.ok(c.url.startsWith(CRM_HOST), `unexpected request to ${c.url}`);
  return { res, calls };
}

(async () => {
  reply = { ok: true, result: {}, report: "queued", retryAfterSeconds: null };
  let r = await post(BODY);
  assert.deepEqual(r.res.body, { ok: true });
  assert.equal(JSON.parse(r.calls[0].init.body).placeId, PLACE_ID);

  reply = { ok: true, result: {}, report: "rate_limited", retryAfterSeconds: 840 };
  r = await post(BODY);
  assert.equal(r.res.statusCode, 200);
  assert.deepEqual(r.res.body, { ok: true, report: "rate_limited", retryAfterSeconds: 840 });

  // No place at all: a typed name and town are refused, and nothing is sent.
  reply = { ok: true, result: {} };
  r = await post({ ...BODY, fields: { business_name: "Bay Pest Co", location: "Tampa", email: "dana@example.com" } });
  assert.equal(r.res.statusCode, 422);
  assert.deepEqual(r.res.body, { error: "place_required" });
  assert.equal(r.calls.length, 0);

  // ---- The countdown, with a fake clock -------------------------------------
  assert.equal(retry.message(840), "You asked for this report a few minutes ago. You can ask again in 14 minutes.");
  assert.equal(retry.message(841), "You asked for this report a few minutes ago. You can ask again in 15 minutes.");
  assert.equal(retry.message(61), "You asked for this report a few minutes ago. You can ask again in 2 minutes.");
  assert.equal(retry.message(60), "You asked for this report a few minutes ago. You can ask again in less than a minute.");
  assert.equal(retry.message(1), "You asked for this report a few minutes ago. You can ask again in less than a minute.");

  let clock = 1_000_000;
  let tickFn = null;
  let cleared = 0;
  const env = {
    now: () => clock,
    setInterval: (fn) => ((tickFn = fn), 7),
    clearInterval: () => { cleared += 1; },
  };
  const shown = [];
  let done = 0;
  const handle = retry.start(840, { onTick: (t) => shown.push(t), onDone: () => (done += 1) }, env);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].endsWith("in 14 minutes."));
  // Seconds pass without a new message (a screen reader is not flooded) ...
  for (let i = 0; i < 60; i++) { clock += 1000; tickFn(); }
  assert.equal(shown.length, 2); // ... except when the minute count changes: 13 minutes
  assert.ok(shown[1].endsWith("in 14 minutes.") === false && shown[1].endsWith("in 13 minutes."));
  clock += 749_000; // 809 s passed in all: 31 s left
  tickFn();
  assert.ok(shown[shown.length - 1].endsWith("less than a minute."));
  assert.equal(done, 0);
  clock += 31_000;
  tickFn();
  assert.equal(done, 1);
  assert.ok(cleared >= 1);
  tickFn(); // a late tick does nothing
  assert.equal(done, 1);
  handle.stop();

  // forms.js disables only the submit button while a countdown runs.
  const forms = fs.readFileSync(path.join(ROOT, "assets/forms.js"), "utf8");
  assert.match(forms, /answer\.report === "rate_limited"/);
  assert.match(forms, /submitButton\.disabled = Boolean\(countdown\)/);
  assert.doesNotMatch(forms, /form\.querySelectorAll\([^)]*\)\.forEach\([^)]*disabled/);

  // ---- The honeypot stays ---------------------------------------------------
  const page = fs.readFileSync(path.join(ROOT, "visibility-report.html"), "utf8");
  assert.match(page, /name="hp_field_2026"/);
  assert.match(forms, /if \(honeypot && honeypot\.value\)/);
  // Works with no search script: the typed fields are plain inputs.
  assert.match(page, /id="business_name" name="business_name" type="text"/);
  assert.match(page, /<input type="hidden" name="place_id" value="">/);

  // ---- The bot check (Turnstile): on when the secret is set ------------------
  assert.equal(humanCheckOn({}), false);
  assert.equal(humanCheckOn({ TURNSTILE_SECRET_KEY: "  " }), false);
  assert.equal(humanCheckOn({ TURNSTILE_SITE_KEY: "s" }), false); // the site key alone does nothing
  assert.equal(humanCheckOn({ TURNSTILE_SECRET_KEY: "secret" }), true); // the site key lives in the HTML
  assert.equal(await humanCheckFailed({}, {}, {}, async () => { throw new Error("must not call"); }), false);
  const on = { TURNSTILE_SECRET_KEY: "secret" };
  const verify = (data, ok = true) => async () => new Response(JSON.stringify(data), { status: ok ? 200 : 500 });
  assert.equal(await humanCheckFailed({}, {}, on, verify({ success: true })), true); // secret set, token missing: refused
  assert.equal(await humanCheckFailed({ human_token: "t" }, {}, on, verify({ success: true })), false); // token ok
  assert.equal(await humanCheckFailed({ human_token: "t" }, {}, on, verify({ success: false })), true);
  assert.equal(await humanCheckFailed({ human_token: "t" }, {}, on, async () => { throw new Error("down"); }), false); // outage lets through
  assert.equal(await humanCheckFailed({ human_token: "t" }, {}, on, verify({}, false)), false);

  // The page carries the widget box with the public site key, and loads Cloudflare's script.
  assert.match(page, /<form[^>]*data-human-check/);
  assert.match(page, /<div class="full" id="vr-turnstile" data-turnstile data-sitekey="0x4AAAAAAGMZcHFSMZEKeATU"><\/div>/);
  assert.match(page, /<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit" async defer><\/script>/);
  assert.doesNotMatch(page, /TURNSTILE_SECRET/);
  // The browser side sends the token as human_token and has the plain blocked message.
  assert.match(forms, /function humanCheck\(form\)/);
  assert.match(forms, /window\.turnstile\.render/);
  assert.match(forms, /payload\.human_token = token/);
  assert.match(forms, /window\.turnstile\.reset/);
  assert.match(forms, /Please turn on JavaScript or try another browser to send this form\./);

  // CSP: this page alone allows Cloudflare, in three places and from one origin.
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const cspOf = (source) => config.headers.find((h) => h.source === source).headers.find((h) => h.key === "Content-Security-Policy").value;
  const vrCsp = cspOf("/visibility-report");
  assert.deepEqual(vrCsp.match(/https:\/\/[a-z.]*cloudflare\.com/g), ["https://challenges.cloudflare.com", "https://challenges.cloudflare.com", "https://challenges.cloudflare.com"]);
  assert.ok(!cspOf("/(.*)").includes("cloudflare"));

  console.log("Visibility form checks passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
