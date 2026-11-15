// Checks "Run a report" from an agency's portal: the site function
// (api/partner-report.js: what the CRM receives, the answers the page gets,
// the limit, the origin, nothing logged) and the portal page script
// (assets/portal.js: report links per client, expired links, the list of
// reports the agency ran, the business search and the run form). fetch is
// replaced by a stub and the page by a small stand-in, so nothing touches the
// network.
// Run: node scripts/check_partner_report.js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const reportFn = require("../api/partner-report");

const ROOT = path.join(__dirname, "..");
const CRM_HOST = "https://crm.example.test";
const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const HEADERS = {
  origin: "https://www.boostyourmaps.com",
  "content-type": "application/json",
  "x-forwarded-for": "198.51.100.23",
  "user-agent": "Mozilla/5.0",
};
const BODY = { k: KEY, placeId: PLACE_ID, placeLabel: "Maple Dental, Mesa, AZ", businessName: "Maple Dental", keyword: "dentist", area: "Mesa, AZ" };

let calls = [];
let reply = { status: 200, body: { ok: true, report: "queued" } };
global.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (reply instanceof Error) throw reply;
  return new Response(JSON.stringify(reply.body), { status: reply.status });
};

const logs = [];
async function run({ method = "POST", body = BODY, headers = HEADERS, env = { CRM_URL: `${CRM_HOST}/` } } = {}) {
  delete process.env.CRM_URL;
  Object.assign(process.env, env);
  calls = [];
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (data) => ((res.body = JSON.parse(JSON.stringify(data))), res);
  res.setHeader = (name, value) => (res.headers[name] = value);
  const saved = [console.error, console.log, console.warn];
  console.error = console.log = console.warn = (...args) => logs.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  try {
    await reportFn({ method, body, headers }, res);
  } finally {
    [console.error, console.log, console.warn] = saved;
  }
  return { status: res.statusCode, body: res.body, headers: res.headers, call: calls[0], sent: calls.length };
}
let visitor = 0;
const as = (extra = {}) => ({ ...HEADERS, "x-forwarded-for": `203.0.113.${++visitor % 250}`, ...extra });

// ---- A small stand-in for the page --------------------------------------------

function element(tag = "div") {
  const memo = {};
  let own = "";
  const el = {
    tag,
    children: [],
    hidden: false,
    disabled: false,
    className: "",
    value: "",
    href: "",
    attrs: {},
    listeners: {},
    addEventListener(type, fn) {
      (el.listeners[type] = el.listeners[type] || []).push(fn);
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      el.attrs[name] = value;
    },
    querySelector(selector) {
      return memo[selector] || (memo[selector] = element());
    },
    focus() {},
    get childNodes() {
      return el.children;
    },
    get textContent() {
      return own + el.children.map((c) => c.textContent).join("");
    },
    set textContent(value) {
      own = String(value);
      el.children = [];
    },
  };
  return el;
}
const fire = async (el, type, event = {}) => {
  for (const fn of el.listeners[type] || []) await fn({ preventDefault() {}, key: "", ...event });
  await settle();
};
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};
const links = (el) => {
  const found = [];
  (function walk(node) {
    if (node.tag === "a") found.push({ text: node.textContent, href: node.href });
    node.children.forEach(walk);
  })(el);
  return found;
};

const PORTAL = {
  ok: true,
  portal: {
    partnerName: "Keepers Digital Marketing",
    partnerSlug: "keepers-digital",
    reportingDashboardUrl: null,
    bookingUrl: null,
    contact: null,
    clients: [
      {
        name: "Ruiz Pest Control",
        city: "Austin, TX",
        locations: 1,
        stage: "live",
        since: "2026-10-09",
        links: { deliverables: null, photos: null, dashboard: null },
        reports: [
          { month: "2026-10", url: "https://reports.example.test/r/oct", expiresAt: "2026-12-01", state: "link_published" },
          { month: "2026-09", url: null, expiresAt: "2026-10-01", state: "expired" },
        ],
      },
      { name: "Odd Client", city: null, locations: 1, stage: "live", since: null, links: {}, reports: [] },
    ],
    requestedReports: [
      { business: "Maple Dental", requestedAt: "2026-11-15", state: "ready", url: "https://reports.example.test/r/maple", expiresAt: "2026-12-15" },
      { business: "Oak Dental", requestedAt: "2026-11-15", state: "being_reviewed", url: null, expiresAt: null },
      { business: "Pine Dental", requestedAt: "2026-11-14", state: "unavailable", url: null, expiresAt: null },
      { business: "Elm Dental", requestedAt: "2026-10-01", state: "expired", url: null, expiresAt: "2026-11-01" },
    ],
  },
};

// Runs assets/portal.js against the stand-in. `answers` gives the site's
// functions' replies by path.
async function openPortal(answers) {
  const root = element("section");
  const doc = element("document");
  const popups = {};
  const fetches = [];
  const sandbox = {
    document: {
      querySelector: (sel) => (sel === "[data-portal]" ? root : doc.querySelector(sel)),
      createElement: (tag) => element(tag),
      createTextNode: (text) => {
        const t = element("#text");
        t.textContent = text;
        return t;
      },
    },
    window: {
      location: { hash: `#k=${KEY}`, search: "" },
      setTimeout: () => 0,
      clearTimeout() {},
      setInterval: () => 1,
      clearInterval() {},
    },
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      fetches.push({ url, method: init.method || "GET", body });
      const answer = typeof answers === "function" ? answers(url, init, body) : answers[url];
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    },
    AbortController,
    URLSearchParams,
    Date,
    Number,
    Math,
    RegExp,
    String,
    Array,
    JSON,
    Promise,
    Intl,
  };
  sandbox.window.Date = Date;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "assets/portal.js"), "utf8"), sandbox);
  await settle();
  return { root, fetches, popups, q: (sel) => root.querySelector(sel) };
}

(async () => {
  // ---- the function --------------------------------------------------------
  let r = await run({ headers: as() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, report: "queued" });
  assert.equal(r.call.url, `${CRM_HOST}/api/partners/portal/${KEY}/reports`);
  assert.equal(r.call.init.method, "POST");
  assert.deepEqual(JSON.parse(r.call.init.body), {
    placeId: PLACE_ID,
    keyword: "dentist",
    placeLabel: "Maple Dental, Mesa, AZ",
    businessName: "Maple Dental",
    area: "Mesa, AZ",
  });
  // Only the keys the CRM takes. The key is in the path, not the body.
  r = await run({ headers: as(), body: { ...BODY, k: KEY, plan: "us", partner: "keepers", email: "x@y.example", hp_field_2026: "" } });
  assert.deepEqual(Object.keys(JSON.parse(r.call.init.body)).sort(), ["area", "businessName", "keyword", "placeId", "placeLabel"]);
  // A website typed as "mapledental.com" goes as an address; blanks are left out.
  r = await run({ headers: as(), body: { k: KEY, placeId: PLACE_ID, keyword: " dentist ", websiteUrl: "mapledental.com", area: "  " } });
  assert.deepEqual(JSON.parse(r.call.init.body), { placeId: PLACE_ID, keyword: "dentist", websiteUrl: "https://mapledental.com/" });

  // Answers narrowed to what the page uses.
  reply = { status: 200, body: { ok: true, report: "rate_limited", retryAfterSeconds: 240, agency: "Keepers", queue: 7 } };
  r = await run({ headers: as() });
  assert.deepEqual(r.body, { ok: true, report: "rate_limited", retryAfterSeconds: 240 });
  reply = { status: 200, body: { ok: true, report: "rate_limited", retryAfterSeconds: "soon" } };
  assert.deepEqual((await run({ headers: as() })).body, { ok: true, report: "rate_limited", retryAfterSeconds: 300 });
  reply = { status: 200, body: { ok: true, report: "something_else" } };
  assert.equal((await run({ headers: as() })).status, 503);
  reply = { status: 404, body: { ok: false, error: "portal_not_found" } };
  r = await run({ headers: as() });
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { ok: false, error: "portal_not_found", field: null });
  reply = { status: 400, body: { ok: false, error: "invalid_input", field: "placeId" } };
  r = await run({ headers: as() });
  assert.deepEqual([r.status, r.body.field], [400, "placeId"]);
  reply = { status: 429, body: { ok: false, error: "rate_limited" } };
  assert.equal((await run({ headers: as() })).status, 429);
  for (const down of [{ status: 500, body: "x" }, { status: 503, body: { ok: false, error: "signup_unavailable" } }, new TypeError("fetch failed")]) {
    reply = down;
    r = await run({ headers: as() });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { ok: false, error: "report_unavailable", field: null });
  }
  reply = { status: 200, body: { ok: true, report: "queued" } };

  // What never goes to the CRM.
  for (const [what, change, field, status] of [
    ["no key", { k: undefined }, null, 404],
    ["short key", { k: "abc" }, null, 404],
    ["upper-case key", { k: KEY.toUpperCase() }, null, 404],
    ["key with a path", { k: `../${KEY.slice(3)}` }, null, 404],
    ["no Place ID", { placeId: "" }, "placeId", 400],
    ["a name instead of a Place ID", { placeId: "Maple Dental" }, "placeId", 400],
    ["a link instead of a Place ID", { placeId: "https://maps.app.goo.gl/abc" }, "placeId", 400],
    ["no service", { keyword: " " }, "keyword", 400],
    ["a bad website", { websiteUrl: "not a site" }, "websiteUrl", 400],
  ]) {
    r = await run({ headers: as(), body: { ...BODY, ...change } });
    assert.equal(r.status, status, what);
    assert.equal(r.body.field, field, what);
    assert.equal(r.sent, 0, what);
  }

  // Origin, form posts, methods, honeypot-free, CRM not set.
  for (const origin of ["https://evil.example", "http://www.boostyourmaps.com", "null"]) {
    r = await run({ headers: as({ origin }) });
    assert.equal(r.status, 403, origin);
    assert.equal(r.sent, 0);
  }
  r = await run({ headers: { ...as(), origin: undefined } });
  assert.equal(r.status, 403);
  r = await run({ headers: as({ "content-type": "text/plain" }) });
  assert.equal(r.status, 400);
  assert.equal(r.sent, 0);
  r = await run({ method: "GET", headers: as() });
  assert.equal(r.status, 405);
  r = await run({ headers: as(), env: {} });
  assert.equal(r.status, 503);
  assert.equal(r.sent, 0);

  // The site-side limit: ten in five minutes for a visitor (the CRM holds an
  // agency to one every 5 minutes; this only stops hammering).
  const same = { ...HEADERS, "x-forwarded-for": "192.0.2.88" };
  for (let i = 1; i <= 10; i++) assert.equal((await run({ headers: same })).status, 200, `request ${i}`);
  r = await run({ headers: same });
  assert.equal(r.status, 429);
  assert.equal(r.headers["Retry-After"], "300");
  assert.equal(r.sent, 0);

  // ---- the page script -----------------------------------------------------
  const PLACES = { status: 200, body: { places: [{ placeId: PLACE_ID, name: "Maple Dental", address: "12 Main St, Mesa, AZ" }, { placeId: "ChIJother_place_id_0001", name: "Maple Dental Care", address: "Tempe, AZ" }] } };
  const site = (extra = {}) => (url, init) => {
    if (url === "/api/partner-portal") return { status: 200, body: PORTAL };
    if (url === "/api/places") return init.method === "POST" ? PLACES : { status: 200, body: { enabled: true } };
    if (url === "/api/partner-report") return extra.report || { status: 200, body: { ok: true, report: "queued" } };
    throw new Error(`unexpected ${url}`);
  };

  let page = await openPortal(site());
  // Per client: a link per live month, one line for an expired one, "None yet".
  const rows = page.q("[data-p-rows]").children;
  assert.equal(rows.length, 2);
  const reportsCell = (tr) => tr.children[tr.children.length - 1];
  assert.deepEqual(links(reportsCell(rows[0])), [{ text: "Oct 2026", href: "https://reports.example.test/r/oct" }]);
  assert.match(reportsCell(rows[0]).textContent, /Link expired: ask us for a new one/);
  assert.equal(reportsCell(rows[1]).textContent, "None yet");
  // The list of reports the agency ran: state words, a link only for Ready.
  const ran = page.q("[data-r-rows]").children;
  assert.equal(ran.length, 4);
  assert.match(ran[0].textContent, /Maple Dental.*Nov 15, 2026.*Ready.*Open the report/);
  assert.deepEqual(links(ran[0]), [{ text: "Open the report", href: "https://reports.example.test/r/maple" }]);
  assert.match(ran[1].textContent, /Being reviewed/);
  assert.match(ran[2].textContent, /We couldn't run this one\. Ask your BYM contact\./);
  assert.match(ran[3].textContent, /Link expired: ask us for a new one/);
  assert.equal(links(ran[1]).length, 0);
  assert.equal(page.q("[data-r-empty]").hidden, true);
  assert.equal(page.q("[data-r-table]").hidden, false);
  assert.equal(page.q("[data-p-body]").hidden, false);
  assert.equal(page.q("[data-r-form]").hidden, false, "search is on");

  // Run a report: search, pick, fill in, send.
  page.q("[data-r-q]").value = "maple dental mesa";
  await fire(page.q("[data-r-search]"), "click");
  const results = page.q("[data-r-results]");
  assert.equal(results.children.length, 2);
  // Nothing is sent before a business is picked.
  await fire(page.q("[data-r-form]"), "submit");
  assert.match(page.q("[data-r-status]").textContent, /pick the business/);
  assert.equal(page.fetches.filter((f) => f.url === "/api/partner-report").length, 0);
  await fire(results.children[0].children[0], "click");
  assert.match(page.q("[data-r-picked]").textContent, /Picked: Maple Dental, 12 Main St, Mesa, AZ/);
  await fire(page.q("[data-r-form]"), "submit");
  assert.match(page.q("[data-r-status]").textContent, /what the business does/);
  page.q("[data-r-keyword]").value = "dentist";
  page.q("[data-r-area]").value = "Mesa, AZ";
  await fire(page.q("[data-r-form]"), "submit");
  const sentReport = page.fetches.filter((f) => f.url === "/api/partner-report");
  assert.equal(sentReport.length, 1);
  assert.deepEqual(sentReport[0].body, { k: KEY, placeId: PLACE_ID, placeLabel: "Maple Dental, 12 Main St, Mesa, AZ", businessName: "Maple Dental", keyword: "dentist", area: "Mesa, AZ" });
  assert.match(page.q("[data-r-status]").textContent, /We are building your report/);
  assert.match(page.q("[data-r-limit]").textContent, /You can run another report in 5 minutes\./);
  assert.equal(page.q("[data-r-go]").disabled, true, "the button waits out the 5 minutes");
  assert.equal(page.q("[data-r-picked]").hidden, true);

  // The CRM says to wait: the countdown reads minutes from the seconds it gave.
  page = await openPortal(site({ report: { status: 200, body: { ok: true, report: "rate_limited", retryAfterSeconds: 125 } } }));
  page.q("[data-r-q]").value = "maple dental mesa";
  await fire(page.q("[data-r-search]"), "click");
  await fire(page.q("[data-r-results]").children[0].children[0], "click");
  page.q("[data-r-keyword]").value = "dentist";
  await fire(page.q("[data-r-form]"), "submit");
  assert.equal(page.q("[data-r-status]").textContent, "You can run another report in 3 minutes.");
  assert.equal(page.q("[data-r-go]").disabled, true);

  // Errors say something plain, and the button comes back.
  page = await openPortal(site({ report: { status: 503, body: { ok: false, error: "report_unavailable", field: null } } }));
  page.q("[data-r-q]").value = "maple dental mesa";
  await fire(page.q("[data-r-search]"), "click");
  await fire(page.q("[data-r-results]").children[0].children[0], "click");
  page.q("[data-r-keyword]").value = "dentist";
  await fire(page.q("[data-r-form]"), "submit");
  assert.match(page.q("[data-r-status]").textContent, /We can't take that right now/);
  assert.equal(page.q("[data-r-go]").disabled, false);

  // No Places key on the site: no form, a way to ask the team instead.
  page = await openPortal((url, init) => (url === "/api/places" ? { status: 200, body: { enabled: false } } : site()(url, init)));
  assert.equal(page.q("[data-r-form]").hidden, true);
  assert.equal(page.q("[data-r-off]").hidden, false);

  // An agency with no reports yet.
  page = await openPortal((url, init) => (url === "/api/partner-portal" ? { status: 200, body: { ok: true, portal: { ...PORTAL.portal, clients: [], requestedReports: [] } } } : site()(url, init)));
  assert.equal(page.q("[data-r-empty]").hidden, false);
  assert.equal(page.q("[data-r-table]").hidden, true);

  // The page itself.
  const html = fs.readFileSync(path.join(ROOT, "partners/portal.html"), "utf8");
  assert.doesNotMatch(html, /href="\/visibility-report"/, "a partner's report request comes from the portal, not the public form");
  assert.match(html, /portal\.js\?v=20261115-1/);

  // ---- nothing typed or secret is logged ------------------------------------
  assert.ok(logs.length > 0, "CRM failures should be logged");
  for (const line of logs) {
    for (const secret of [KEY, PLACE_ID, "Maple", "dentist", "Mesa", "198.51.100.23", "203.0.113.", "192.0.2.88", "Mozilla", "mapledental"]) {
      assert.ok(!line.includes(secret), `log line leaks ${secret}: ${line}`);
    }
  }

  console.log("Partner report function and portal page checks passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
