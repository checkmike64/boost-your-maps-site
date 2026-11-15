// Checks the site's Content-Security-Policy still holds after the Agency
// Partners work: the header in vercel.json keeps its limits and gains no host,
// and the new page and its scripts need nothing more. The page logic is in
// files (assets/agency-partners.js, assets/portal.js, assets/signup.js); the
// only inline scripts on the new page are Tag Manager's and the page's JSON-LD,
// as on every page. Every call the pages make is to this site.
// Run: node scripts/check_csp.js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const all = config.headers.find((h) => h.source === "/(.*)");
const csp = Object.fromEntries(
  all.headers
    .find((h) => h.key === "Content-Security-Policy")
    .value.split(";")
    .map((part) => part.trim().split(/\s+/))
    .filter((p) => p[0])
    .map(([name, ...values]) => [name, values])
);

// The policy as it stood before the Agency Partners work. Adding a host to it
// is a decision for Mike, so any change fails here.
assert.deepEqual(csp["default-src"], ["'self'"]);
assert.deepEqual(csp["base-uri"], ["'self'"]);
assert.deepEqual(csp["object-src"], ["'none'"]);
assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
assert.deepEqual(csp["form-action"], ["'self'"]);
assert.deepEqual(csp["script-src"], ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com", "https://connect.facebook.net"]);
assert.deepEqual(csp["connect-src"], ["'self'", "https://www.google-analytics.com", "https://analytics.google.com", "https://www.googletagmanager.com", "https://www.facebook.com", "https://connect.facebook.net"]);
assert.deepEqual(csp["frame-src"], ["https://www.googletagmanager.com"]);
assert.ok(!csp["connect-src"].includes("*") && !csp["script-src"].includes("*") && !csp["script-src"].includes("'unsafe-eval'"));
// The site's own functions are same-origin, so connect-src 'self' covers them.
assert.ok(csp["connect-src"].includes("'self'"));

// The new page: noindex and not stored, like the other private pages.
const route = config.headers.find((h) => h.source === "/agency-partners");
assert.ok(route, "headers for /agency-partners");
assert.equal(route.headers.find((h) => h.key === "X-Robots-Tag").value, "noindex, nofollow");
assert.equal(route.headers.find((h) => h.key === "Cache-Control").value, "no-store");
assert.ok(!route.headers.some((h) => h.key === "Content-Security-Policy"), "the page uses the site's policy, with no looser one of its own");

// ---- what the new page loads and runs ---------------------------------------------

const page = fs.readFileSync(path.join(ROOT, "agency-partners.html"), "utf8");
const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(([, attrs, body]) => ({ attrs, body }));
assert.ok(scripts.length >= 3);
for (const { attrs, body } of scripts) {
  const src = /src="([^"]+)"/.exec(attrs);
  if (src) {
    assert.match(src[1], /^\/assets\/[a-z-]+\.js\?v=[\w-]+$/, `a script from the site's own files: ${src[1]}`);
    assert.equal(body.trim(), "");
  } else if (/application\/ld\+json/.test(attrs)) {
    JSON.parse(body);
  } else {
    // The only inline script is Tag Manager's, which every page carries.
    assert.match(body, /googletagmanager\.com\/gtm\.js/, "an inline script that is not Tag Manager's");
  }
}
// The page's own logic is a file.
assert.ok(scripts.some(({ attrs }) => attrs.includes("/assets/agency-partners.js")));
// No inline event handler and no script address in a link.
assert.doesNotMatch(page, /\son[a-z]+\s*=/i);
assert.doesNotMatch(page, /href="\s*javascript:/i);
// The form posts through the script to this site only.
assert.match(page, /data-endpoint="\/api\/partner-access"/);
for (const file of ["assets/agency-partners.js", "assets/portal.js"]) {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const [, url] of code.matchAll(/fetch\(\s*"([^"]+)"/g)) assert.ok(url.startsWith("/api/"), `${file} calls ${url}`);
  assert.doesNotMatch(code, /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}\/api|eval\(|new Function\(|document\.write|innerHTML\s*=/, file);
}

// Every page that loads a new script gives it a version, and one version only.
const versions = new Map();
for (const dir of ["", "partners", "get-started"]) {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    if (!name.endsWith(".html")) continue;
    const text = fs.readFileSync(path.join(ROOT, dir, name), "utf8");
    for (const [, asset, v] of text.matchAll(/\/assets\/(portal|signup|agency-partners)\.js\?v=([\w-]+)/g)) {
      versions.set(asset, new Set([...(versions.get(asset) || []), v]));
    }
  }
}
for (const [asset, set] of versions) assert.equal(set.size, 1, `${asset}.js is loaded with more than one version: ${[...set]}`);

console.log("Content-Security-Policy and the new page's scripts check out.");
