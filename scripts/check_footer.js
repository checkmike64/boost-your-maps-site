// Checks what the site shows about its agency partners (P25): every page with
// a footer links to "Agency Partners", only the agency signup page loads the
// agency list, and no page but the portal links to /partners/signup. Also that
// the signup page still has its "Your agency" dropdown, below a block that
// leads with the portal, and that no page names an agency.
// Run: node scripts/check_footer.js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SKIP = new Set([".git", ".github", ".claude", ".tools", ".vercel", "node_modules", "scripts", "drafts"]);

function htmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

const pages = htmlFiles(ROOT).map((file) => ({ name: path.relative(ROOT, file), source: fs.readFileSync(file, "utf8") }));
assert.ok(pages.length > 25, "the site's pages were found");

// ---- the footer link ------------------------------------------------------------

let footers = 0;
for (const { name, source } of pages) {
  if (!/<footer\b/.test(source)) continue;
  footers += 1;
  const flinks = source.match(/<p class="flinks">[^\n]*<\/p>/);
  assert.ok(flinks, `${name}: footer has no flinks line`);
  assert.equal((flinks[0].match(/<a href="\/agency-partners">Agency Partners<\/a>/g) || []).length, 1, `${name}: footer needs one "Agency Partners" link to /agency-partners`);
}
assert.ok(footers >= 27, `expected every page with a footer to be checked, got ${footers}`);
// New local pages are built from this shell, so they get the link too.
assert.match(fs.readFileSync(path.join(ROOT, "templates/local-service-page-shell.html"), "utf8"), /<a href="\/agency-partners">Agency Partners<\/a>/);

// ---- no agency list ----------------------------------------------------------------

const withList = pages.filter(({ source }) => source.includes("/api/signup/partners") || source.includes("signup.js")).map((p) => p.name);
// signup.js asks for the list only on a page with the agency dropdown.
for (const { name, source } of pages) {
  const hasDropdown = /<select[^>]*name="partner"/.test(source);
  assert.equal(hasDropdown, name === path.join("partners", "signup.html"), `${name}: only the agency signup page may have the agency dropdown`);
  assert.doesNotMatch(source, /\/api\/signup\/partners/, `${name}: the agency list route is only for signup.js`);
}
assert.ok(withList.includes(path.join("partners", "signup.html")));
const signupJs = fs.readFileSync(path.join(ROOT, "assets/signup.js"), "utf8");
assert.equal((signupJs.match(/\/api\/signup\/partners/g) || []).length, 1, "signup.js asks for the list in one place");
// Nothing else in the site's own scripts asks for it.
for (const file of fs.readdirSync(path.join(ROOT, "assets"))) {
  if (!file.endsWith(".js") || file === "signup.js") continue;
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "assets", file), "utf8"), /api\/signup\/partners/, `assets/${file}`);
}

// No page links to the agency signup but the portal (it carries the portal key).
for (const { name, source } of pages) {
  if (name === path.join("partners", "portal.html")) continue;
  assert.doesNotMatch(source, /href="[^"]*\/partners\/signup/, `${name}: links to /partners/signup`);
}
assert.match(fs.readFileSync(path.join(ROOT, "assets/portal.js"), "utf8"), /\/partners\/signup#k=/);
assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8"), /partners|agency-partners/);
assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "llms.txt"), "utf8"), /agency-partners|partners\/signup/);

// ---- the signup page leads with the portal and keeps the dropdown ---------------

const signup = pages.find((p) => p.name === path.join("partners", "signup.html")).source;
const lead = signup.indexOf("data-portal-first");
const dropdown = signup.indexOf('<select id="partner" name="partner"');
assert.ok(lead > 0 && dropdown > lead, "the portal block comes before the dropdown");
assert.match(signup, /<div class="su-panel" data-portal-first hidden>[\s\S]*Open your partner portal →[\s\S]*<\/div>/);
assert.match(signup, /<a class="tlink" href="\/agency-partners">Open your partner portal →<\/a>/);
assert.match(signup, /data-partner-field/);
assert.match(signup, /<meta name="robots" content="noindex, nofollow">/);
// signup.js: the block is shown unless the agency came from its portal.
assert.match(signupJs, /showPortalFirst\(true\)/);
assert.match(signupJs, /showPortalFirst\(false\)/);
assert.match(signupJs, /loadPartners\(form, partnerSelect, button\)/, "the dropdown still loads its list");
assert.match(signupJs, /get\("partner"\)/, "?partner=<slug> still picks one");

// ---- no page names an agency ------------------------------------------------------

const AGENCIES = ["Keepers", "uAscend", "Harrison Kelly", "Wise Bear", "Maps Partner Agency", "T2 Pest"];
for (const { name, source } of pages) {
  for (const agency of AGENCIES) assert.ok(!source.includes(agency), `${name} names an agency: ${agency}`);
}
assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "agency-partners.html"), "utf8"), /<select|<option|<datalist/);

console.log(`Footer link on ${footers} pages, agency list and signup page checks passed.`);
