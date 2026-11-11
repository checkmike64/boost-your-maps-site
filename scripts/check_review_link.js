// Checks the Google review link tool (/tools/google-review-link-generator):
// reading Place IDs and links (assets/review-link-core.js), the QR code drawn with the
// vendored qrcode-generator, and the business-name search route (api/places.js).
// fetch is replaced by a stub, so nothing touches the network.
// Run: node scripts/check_review_link.js
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../assets/review-link-core.js");
const qrcode = require("../assets/vendor/qrcode-generator-2.0.4.js");

const ID = "ChIJN1t_tDeuEmsRUsoyG83frY4"; // Google's own example Place ID (Sydney office)
const LINK = "https://search.google.com/local/writereview?placeid=" + ID;

async function main() {
  // ---------- the vendored library is the file we reviewed ----------
  const vendored = fs.readFileSync(path.join(__dirname, "..", "assets", "vendor", "qrcode-generator-2.0.4.js"));
  assert.equal(
    crypto.createHash("sha256").update(vendored).digest("hex"),
    "79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c",
    "assets/vendor/qrcode-generator-2.0.4.js changed; re-check it and update the hash in the LICENSE file and here"
  );

  // ---------- reading what people paste ----------
  const ok = (input, link, kind = "place_id") => {
    const r = core.parseInput(input);
    assert.equal(r.ok, true, `should read: ${input}`);
    assert.equal(r.kind, kind, `kind for: ${input}`);
    assert.equal(r.link, link, `link for: ${input}`);
  };
  const no = (input, code) => {
    const r = core.parseInput(input);
    assert.equal(r.ok, false, `should refuse: ${input}`);
    assert.equal(r.code, code, `code for: ${input}`);
  };

  assert.equal(core.reviewLink(ID), LINK);
  ok(ID, LINK);
  ok(`  ${ID}\n`, LINK);
  ok("GhIJQWDl0CIeQUARxks3icF8U8A", "https://search.google.com/local/writereview?placeid=GhIJQWDl0CIeQUARxks3icF8U8A");
  ok(LINK, LINK);
  ok("search.google.com/local/writereview?placeid=" + ID, LINK);
  ok("https://www.google.com/maps/search/?api=1&query=Google&query_place_id=" + ID, LINK);
  ok("https://www.google.com/maps/place/?q=place_id:" + ID, LINK);
  ok("https://www.google.com/maps/place/Google+Sydney/@-33.866,151.195,17z/data=!4m6!3m5!1s0x6b12ae37b47f5b37:0x8eaddfcd1b32ca52!8m2!3d-33.866!4d151.196!16s%2Fg%2F1tf4x3p5!19s" + ID + "?entry=ttu", LINK);
  ok("https://maps.google.com/?placeid=" + ID, LINK);
  ok("https://www.google.co.uk/maps/place/data=!4m2!3m1!1s" + ID, LINK);
  ok("https://g.page/r/CQf3kLmNoPqrEBM/review", "https://g.page/r/CQf3kLmNoPqrEBM/review", "review_link");
  ok("https://g.page/r/CQf3kLmNoPqrEBM", "https://g.page/r/CQf3kLmNoPqrEBM/review", "review_link");
  ok("g.page/r/CQf3kLmNoPqrEBM/review", "https://g.page/r/CQf3kLmNoPqrEBM/review", "review_link");
  ok("https://g.page/joes-plumbing/review", "https://g.page/joes-plumbing/review", "review_link");

  no("", "empty");
  no("   ", "empty");
  no("Joe's Plumbing Tampa", "unreadable");
  no("ChIJshort", "unreadable");
  no("javascript:alert(1)", "unreadable");
  no("https://maps.app.goo.gl/AbCdEf123", "short_link");
  no("maps.app.goo.gl/AbCdEf123", "short_link");
  no("https://goo.gl/maps/AbCdEf123", "short_link");
  no("https://share.google/AbCdEf123", "short_link");
  no("https://www.google.com/maps/place/Joe's/@27.9,-82.4,17z/data=!4m6!3m5!1s0x88c2c5fa8d8fc631:0x187b14501a450bad!8m2", "no_place_id");
  no("https://maps.google.com/?cid=1768563447612755885", "no_place_id");
  no("https://g.page/r/", "no_place_id");
  no("https://www.yelp.com/biz/joes?placeid=" + ID, "not_google");
  no("https://evil-google.com/?placeid=" + ID, "not_google");
  no("https://google.com.evil.example/?placeid=" + ID, "not_google");

  // ---------- the text message asks everyone the same way ----------
  assert.equal(core.textMessage("", LINK), "Hi, would you leave us a Google review about today's job? " + LINK);
  assert.equal(core.textMessage(" Bay Pest ", LINK), "Hi, it's Bay Pest. Would you leave us a Google review about today's job? " + LINK);
  assert.doesNotMatch(core.textMessage("x", LINK), /5|five|star|discount|gift|happy|free/i);

  // ---------- file names ----------
  assert.equal(core.fileSlug(""), "google-review-qr");
  assert.equal(core.fileSlug("Joe's Plumbing & Heating, Tampa"), "google-review-qr-joe-s-plumbing-heating-tampa");
  assert.equal(core.fileSlug("Café Olé"), "google-review-qr-cafe-ole");

  // ---------- QR code ----------
  const m = core.makeQr(LINK, qrcode);
  assert.equal(m.size % 4, 1, "QR side must be 4n+17 modules");
  assert.ok(m.size >= 29 && m.size <= 57, `unexpected QR size ${m.size}`);
  // the three finder patterns: a 7x7 ring with a 3x3 centre
  const finder = (r0, c0) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const ring = r === 0 || r === 6 || c === 0 || c === 6;
        const centre = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        assert.equal(m.rows[r0 + r][c0 + c], ring || centre, `finder at ${r0},${c0} cell ${r},${c}`);
      }
    }
  };
  finder(0, 0);
  finder(0, m.size - 7);
  finder(m.size - 7, 0);
  // same data, same code as the library's own renderer
  const lib = qrcode(0, "M");
  lib.addData(LINK, "Byte");
  lib.make();
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) assert.equal(m.rows[r][c], lib.isDark(r, c));

  const svg = core.qrSvg(m, { px: 600, color: "#17282E", title: 'Joe\'s <"QR">' });
  const dim = m.size + 8;
  assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="600" height="600"`));
  assert.match(svg, /<title>Joe&#39;s &lt;&quot;QR&quot;&gt;<\/title>/);
  assert.doesNotMatch(svg, /<script/i);
  // the path covers exactly the dark modules
  let dark = 0;
  for (const row of m.rows) for (const d of row) dark += d ? 1 : 0;
  const pathD = svg.match(/ d="([^"]+)"/)[1];
  const area = [...pathD.matchAll(/h(\d+)v1h-\d+z/g)].reduce((sum, x) => sum + Number(x[1]), 0);
  assert.equal(area, dark);

  const calls = [];
  const ctx = { fillRect: (...a) => calls.push(a), set fillStyle(v) { calls.push(["style", v]); } };
  const side = core.drawQr(ctx, m, { px: 1200 });
  assert.equal(side, dim * Math.floor(1200 / dim));
  assert.equal(calls.filter((c) => c.length === 4).length, dark + 1, "one background fill plus one fill per dark module");

  // ---------- business-name search route ----------
  const places = require("../api/places.js");
  const realFetch = global.fetch;
  const run = async ({ method = "POST", body, headers = {}, env, fetchImpl }) => {
    const saved = process.env.GOOGLE_PLACES_API_KEY;
    if (env === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = env;
    global.fetch = fetchImpl || (async () => { throw new Error("network not allowed in this test"); });
    const res = {
      statusCode: 0, headers: {}, body: null,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    try {
      await places({ method, body, headers }, res);
    } finally {
      global.fetch = realFetch;
      if (saved === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = saved;
    }
    return res;
  };
  const SITE = { origin: "https://www.boostyourmaps.com", "x-forwarded-for": "203.0.113.9" };
  const KEY = "test-key-not-real-123";

  let r = await run({ method: "GET" });
  assert.deepEqual([r.statusCode, r.body], [200, { enabled: false }]);
  r = await run({ method: "GET", env: KEY });
  assert.deepEqual([r.statusCode, r.body], [200, { enabled: true }]);
  r = await run({ body: { q: "joes plumbing" }, headers: SITE });
  assert.equal(r.statusCode, 503, "no key: search is off");
  r = await run({ method: "PUT", env: KEY });
  assert.equal(r.statusCode, 405);
  r = await run({ body: { q: "joes plumbing" }, headers: { origin: "https://example.com" }, env: KEY });
  assert.equal(r.statusCode, 403, "other sites can't use the key");
  r = await run({ body: { q: "joes plumbing" }, headers: {}, env: KEY });
  assert.equal(r.statusCode, 403, "no origin, no search");
  r = await run({ body: { q: "jo" }, headers: SITE, env: KEY });
  assert.equal(r.statusCode, 400);
  r = await run({ body: "not json", headers: SITE, env: KEY });
  assert.equal(r.statusCode, 400);

  let sent;
  const google = async (url, init) => {
    sent = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [
          { placePrediction: { placeId: ID, structuredFormat: { mainText: { text: "Joe's Plumbing" }, secondaryText: { text: "Tampa, FL, USA" } } } },
          { placePrediction: { placeId: "bad id with spaces", structuredFormat: { mainText: { text: "Bad" } } } },
          { queryPrediction: { text: { text: "joes plumbing near me" } } },
        ],
      }),
    };
  };
  r = await run({ body: { q: " joes plumbing tampa " }, headers: SITE, env: KEY, fetchImpl: google });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { places: [{ placeId: ID, name: "Joe's Plumbing", address: "Tampa, FL, USA" }] });
  assert.equal(sent.url, "https://places.googleapis.com/v1/places:autocomplete");
  assert.equal(sent.init.headers["X-Goog-Api-Key"], KEY);
  assert.deepEqual(JSON.parse(sent.init.body), { input: "joes plumbing tampa" });
  assert.equal(r.headers["cache-control"], "no-store");
  assert.doesNotMatch(JSON.stringify(r.body), new RegExp(KEY), "the key never goes back to the browser");

  r = await run({
    body: { q: "joes plumbing" },
    headers: { referer: "https://boostyourmaps-git-page-google-review-link-generator-mike-8166s-projects.vercel.app/tools/google-review-link-generator", "x-forwarded-for": "203.0.113.10" },
    env: KEY,
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: KEY } }) }),
  });
  assert.equal(r.statusCode, 502, "preview referer is allowed; Google errors become 502");
  assert.doesNotMatch(JSON.stringify(r.body), new RegExp(KEY));

  // per-visitor cap
  const { counters, LIMITS } = places._test;
  counters.visitors.clear();
  counters.total = 0;
  const visitor = { origin: "https://boostyourmaps.com", "x-forwarded-for": "198.51.100.4" };
  for (let i = 0; i < LIMITS.perVisitorPerMinute; i++) {
    r = await run({ body: { q: "joes plumbing" }, headers: visitor, env: KEY, fetchImpl: google });
    assert.equal(r.statusCode, 200);
  }
  r = await run({ body: { q: "joes plumbing" }, headers: visitor, env: KEY, fetchImpl: google });
  assert.equal(r.statusCode, 429);
  assert.equal(r.headers["retry-after"], "60");

  console.log("Review link tool: parsing, text message, QR code and the places route check out.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
