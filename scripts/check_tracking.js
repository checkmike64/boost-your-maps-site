// Checks the browser side of first-touch attribution and the purchase event:
// assets/tracking.js (the first touch kept in localStorage for 90 days),
// assets/signup.js (the signup start sends it; the welcome page pushes one
// purchase event) and assets/agreement.js (the signature sends it).
// The three scripts run here exactly as the pages load them, against a small
// stand-in for the browser: no network, no real storage, and a clock the
// checks move by hand. What a page posts then goes through the site's own
// functions (api/_signup.js, api/_agreement.js), so the checks follow a first
// touch all the way to the body the CRM receives.
// Run: node scripts/check_tracking.js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, webcrypto } = require("node:crypto");
const { buildStartPayload, shapeSignup } = require("../api/_signup");
const { buildSignPayload, shapeAgreement } = require("../api/_agreement");

const SITE = "https://www.boostyourmaps.com";
const TOKEN = "3f9a0c4be1d2f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5";
const OTHER_TOKEN = "9c1e4b7a2f0d8e6c5b3a1f9e7d5c3b1a0f2e4d6c8b0a1928374655647382910a";
const PORTAL_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const MEETING_ID = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const VISITOR_KEY = "vis_7Qm2xK9pLw";
const BOOKING_TOKEN = "bk_Zt5nR8uYc3";
const SECRETS = [TOKEN, OTHER_TOKEN, PORTAL_KEY, MEETING_ID, VISITOR_KEY, BOOKING_TOKEN];
const CHECKOUT = "https://checkout.stripe.com/c/pay/cs_test_a1b2c3";
const START = "2026-11-15T18:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const HEADERS = { "x-forwarded-for": "198.51.100.23", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)" };
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// ---- A small stand-in for the browser ---------------------------------------

const SCRIPTS = {};
for (const name of ["tracking.js", "signup.js", "agreement.js"]) {
  SCRIPTS[name] = fs.readFileSync(path.join(__dirname, "..", "assets", name), "utf8");
}

// A page element that takes whatever the scripts do to it. querySelector hands
// back the same child for the same selector, so a check can reach a button.
function element(extra = {}) {
  const children = {};
  const listeners = {};
  return {
    hidden: false,
    disabled: false,
    checked: false,
    textContent: "",
    innerHTML: "",
    className: "",
    value: "",
    dataset: {},
    style: {},
    elements: {},
    classList: { toggle() {} },
    listeners,
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    querySelector(selector) {
      return children[selector] || (children[selector] = element());
    },
    querySelectorAll() {
      return [];
    },
    getAttribute() {
      return null;
    },
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    remove() {},
    focus() {},
    closest() {
      return null;
    },
    ...extra,
  };
}

function storage() {
  const items = new Map();
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => void items.set(String(key), String(value)),
    removeItem: (key) => void items.delete(key),
  };
}

// One browser: its storage and clock outlive the pages opened in it.
//   blocked: every use of localStorage or sessionStorage throws, as it does
//            with site data turned off.
//   subtle:  false for a browser without crypto.subtle.
function browser({ start = START, blocked = false, subtle = true } = {}) {
  let now = Date.parse(start);
  // What the scripts see as Date.
  class PageDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(now);
    }
    static now() {
      return now;
    }
  }
  const local = storage();
  const session = storage();
  const digests = [];

  // Lets every promise a page started finish: its fetches and its hashes.
  async function settle() {
    for (let i = 0; i < 6; i++) {
      await Promise.allSettled(digests);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  // Opens a page and runs its scripts, in the order the page lists them.
  //   selectors, ids: what document.querySelector and getElementById find.
  //   answer(to, body): what the site's functions answer, as { status, data }.
  async function open(url, { referrer = "", scripts = ["tracking.js"], selectors = {}, ids = {}, answer = null } = {}) {
    const at = new URL(url);
    const timers = new Map();
    const posts = [];
    let timerId = 0;
    const window = {
      dataLayer: [],
      location: {
        href: at.href,
        pathname: at.pathname,
        search: at.search,
        hash: at.hash,
        hostname: at.hostname,
        assigned: null,
        assign(to) {
          this.assigned = to;
        },
        reload() {},
      },
      history: { state: null, replaceState() {} },
      crypto: subtle
        ? {
            subtle: {
              digest(...args) {
                const digest = webcrypto.subtle.digest(...args);
                digests.push(digest);
                return digest;
              },
            },
          }
        : {},
      setTimeout(fn, ms) {
        timers.set(++timerId, { fn, ms });
        return timerId;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
      addEventListener() {},
    };
    for (const [name, store] of [["localStorage", local], ["sessionStorage", session]]) {
      Object.defineProperty(window, name, {
        get() {
          if (blocked) throw new Error("SecurityError: the browser blocks storage for this site");
          return store;
        },
      });
    }
    const document = {
      referrer,
      createElement: () => element(),
      createTextNode: () => element(),
      getElementsByTagName: () => [element({ parentNode: { insertBefore() {} } })],
      addEventListener() {},
      getElementById: (id) => ids[id] || null,
      querySelector: (selector) => selectors[selector] || null,
    };
    const fetch = async (to, init) => {
      const body = init && init.body ? JSON.parse(init.body) : null;
      posts.push({ to, body });
      const reply = (answer && answer(to, body)) || { status: 503, data: { ok: false, error: "signup_unavailable", field: null } };
      return { status: reply.status, json: async () => reply.data };
    };

    for (const name of scripts) {
      new Function("window", "document", "fetch", "Date", SCRIPTS[name])(window, document, fetch, PageDate);
    }
    await settle();

    return {
      window,
      posts,
      events: (name) => window.dataLayer.filter((entry) => entry && entry.event === name),
      // Runs the timers set for `ms` milliseconds (the welcome page looks
      // again every 3 seconds).
      async tick(ms) {
        for (const [id, timer] of [...timers]) {
          if (timer.ms !== ms) continue;
          timers.delete(id);
          timer.fn();
        }
        await settle();
      },
      // Sends an event to an element's listeners, as a click or a submit does.
      async send(target, type) {
        for (const listener of target.listeners[type] || []) listener({ preventDefault() {}, target, currentTarget: target });
        await settle();
      },
    };
  }

  return {
    local,
    session,
    open,
    advance(ms) {
      now += ms;
    },
    // The first touch as it sits in localStorage: the raw text, and read.
    rawFirstTouch: () => local.items.get("bym_first_touch"),
    firstTouch: () => (local.items.has("bym_first_touch") ? JSON.parse(local.items.get("bym_first_touch")) : null),
  };
}

// Nothing kept in localStorage is a private link's token or key, or anything
// shaped like one.
function assertNoSecrets(store, what) {
  for (const [key, value] of store.items) {
    const kept = `${key} ${value}`;
    assert.ok(!/[0-9a-f]{64}/i.test(kept), `${what}: 64 hex characters kept in ${key}`);
    for (const secret of SECRETS) assert.ok(!kept.toLowerCase().includes(secret.toLowerCase()), `${what}: ${secret} kept in ${key}`);
  }
}

// The pages' own markup, as far as the scripts reach into it.
function startPage(fields = {}) {
  const values = { locations: "2", first_name: "Ana", last_name: "Ruiz", email: "ana@example.com", phone: "", business_name: "Ruiz Pest Control", website: "", ...fields };
  const elements = {};
  for (const [name, value] of Object.entries(values)) elements[name] = element({ name, value });
  const form = element({ id: "signup-form", dataset: { plan: "us", price: "450" }, elements });
  return { form, selectors: { "form[data-signup-form]": form } };
}

function welcomePage() {
  const root = element();
  return {
    root,
    selectors: { "[data-welcome]": root, "[data-w-title]": element(), "[data-w-lead]": element() },
    ids: { "intake-form": element() },
  };
}

function agreementPage() {
  const root = element();
  const form = element({
    id: "sign-form",
    elements: {
      legal_name: element({ id: "legal_name", value: " Ruiz Pest Control LLC " }),
      signatory_name: element({ id: "signatory_name", value: "Ana Ruiz" }),
      consent: element({ id: "consent", checked: true }),
    },
  });
  return {
    root,
    form,
    selectors: { "[data-agreement]": root, "[data-a-title]": element(), "[data-a-lead]": element() },
    ids: { "sign-form": form },
  };
}

// ---- The first page view: a campaign link with every value ------------------

const FIRST_URL =
  `${SITE}/google-maps-marketing/pest-control?utm_source=google&utm_medium=cpc&utm_campaign=pest-phoenix&utm_term=pest+control+seo` +
  "&utm_content=ad-2&gclid=Cj0KCQjw-gclid&gbraid=0AAAAAo4m-gbraid&wbraid=CjkKCQjw-wbraid&fbclid=IwAR0-fbclid#pricing";
const FIRST_REFERRER = "https://www.google.com/search?q=pest+control+marketing#top";
const FIRST_TOUCH = {
  landing: FIRST_URL.split("#")[0],
  referrer: "https://www.google.com/search",
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "pest-phoenix",
  utm_term: "pest control seo",
  utm_content: "ad-2",
  gclid: "Cj0KCQjw-gclid",
  gbraid: "0AAAAAo4m-gbraid",
  wbraid: "CjkKCQjw-wbraid",
  fbclid: "IwAR0-fbclid",
  first_seen_at: START,
};

// Every first touch the checks below see kept, to send through the site's
// functions at the end.
const keptTouches = [];
function kept(visitor) {
  const touch = visitor.firstTouch();
  keptTouches.push(touch);
  return touch;
}

async function checkFirstTouch() {
  // Written on the first page view: the landing without its hash, the site
  // that sent the visitor without its query, the campaign values, the click
  // ids and the time. Nothing else is kept in localStorage.
  const visitor = browser();
  await visitor.open(FIRST_URL, { referrer: FIRST_REFERRER });
  assert.deepEqual(kept(visitor), FIRST_TOUCH);
  assert.deepEqual([...visitor.local.items.keys()], ["bym_first_touch"]);
  // The session values the lead forms use sit beside it, as before.
  assert.equal(visitor.session.items.get("bym_landing"), "/google-maps-marketing/pest-control");
  assert.equal(visitor.session.items.get("bym_landing_ref"), "www.google.com");

  // Written once: later page views, with other campaign values, change nothing.
  const first = visitor.rawFirstTouch();
  visitor.advance(60 * 1000);
  await visitor.open(`${SITE}/pricing?utm_source=facebook&utm_medium=paid-social&fbclid=IwAR9-later`, { referrer: "https://l.facebook.com/" });
  assert.equal(visitor.rawFirstTouch(), first);
  visitor.advance(30 * DAY);
  await visitor.open(`${SITE}/get-started?utm_source=newsletter&gclid=later`, { referrer: "" });
  assert.equal(visitor.rawFirstTouch(), first);
  // Still kept one millisecond short of 90 days.
  visitor.advance(60 * DAY - 60 * 1000 - 1);
  await visitor.open(`${SITE}/?utm_source=bing`);
  assert.equal(visitor.rawFirstTouch(), first);
  // At 90 days it has run out, and the page view then is the new first touch.
  visitor.advance(1);
  await visitor.open(`${SITE}/?utm_source=bing`, { referrer: "https://www.bing.com/" });
  assert.deepEqual(kept(visitor), {
    landing: `${SITE}/?utm_source=bing`,
    referrer: "https://www.bing.com/",
    utm_source: "bing",
    first_seen_at: new Date(Date.parse(START) + 90 * DAY).toISOString(),
  });

  // A visit with nothing to tell: the landing and the time, no empty values.
  const direct = browser();
  await direct.open(`${SITE}/`);
  assert.deepEqual(kept(direct), { landing: `${SITE}/`, first_seen_at: START });

  // This site is not a source; a phone app is.
  const inside = browser();
  await inside.open(`${SITE}/pricing`, { referrer: `${SITE}/services?utm_source=google` });
  assert.deepEqual(kept(inside), { landing: `${SITE}/pricing`, first_seen_at: START });
  const app = browser();
  await app.open(`${SITE}/`, { referrer: "android-app://com.google.android.googlequicksearchbox/" });
  assert.equal(kept(app).referrer, "android-app://com.google.android.googlequicksearchbox/");
  for (const referrer of ["javascript:alert(1)", "not an address", "about:blank"]) {
    const odd = browser();
    await odd.open(`${SITE}/`, { referrer });
    assert.equal("referrer" in kept(odd), false, `referrer ${referrer}`);
  }

  // Something unreadable under the key is not a first touch: it is replaced.
  for (const junk of ["not json", "null", "[]", "{}", "7", '"text"', '{"first_seen_at":"soon"}', '{"landing":"https://example.com/"}']) {
    const odd = browser();
    odd.local.setItem("bym_first_touch", junk);
    await odd.open(FIRST_URL, { referrer: FIRST_REFERRER });
    assert.deepEqual(kept(odd), FIRST_TOUCH, `junk ${junk}`);
  }

  // The longest value the CRM keeps is 500 characters. A landing over that
  // goes without its query, a campaign value over it is left out, and control
  // characters are taken out.
  const long = browser();
  await long.open(`${SITE}/pricing?utm_source=google&utm_campaign=pest%00phoenix%0A&utm_content=${"x".repeat(600)}&gclid=${"y".repeat(500)}`);
  assert.deepEqual(kept(long), {
    landing: `${SITE}/pricing`,
    utm_source: "google",
    utm_campaign: "pestphoenix",
    gclid: "y".repeat(500),
    first_seen_at: START,
  });
}

// ---- Private links: a token or a key is never kept --------------------------

async function checkPrivateLinks() {
  const BOOKED = `${SITE}/booked?type=review-call&name=Review+call&at=2026-11-20T18%3A00%3A00.000Z`;
  const cases = [
    // [what, the address, the referrer, the first touch without its time]
    ["a welcome link before its token moves to the hash", `${SITE}/welcome?t=${TOKEN}`, CHECKOUT, { landing: `${SITE}/welcome`, referrer: "https://checkout.stripe.com/c/pay/cs_test_a1b2c3" }],
    ["a welcome link", `${SITE}/welcome#t=${TOKEN}`, "", { landing: `${SITE}/welcome` }],
    ["an agreement link back from Stripe", `${SITE}/agreement?paid=1&t=${TOKEN}`, "", { landing: `${SITE}/agreement?paid=1` }],
    ["an agreement link", `${SITE}/agreement#t=${TOKEN}`, "https://mail.example.com/", { landing: `${SITE}/agreement`, referrer: "https://mail.example.com/" }],
    [
      "a partner signup link before its key moves to the hash",
      `${SITE}/partners/signup?partner=keepers-digital&k=${PORTAL_KEY}&utm_source=portal`,
      "",
      { landing: `${SITE}/partners/signup?partner=keepers-digital&utm_source=portal`, utm_source: "portal" },
    ],
    ["a partner signup link", `${SITE}/partners/signup?utm_source=portal#k=${PORTAL_KEY}`, "", { landing: `${SITE}/partners/signup?utm_source=portal`, utm_source: "portal" }],
    ["a portal link", `${SITE}/partners/portal#k=${PORTAL_KEY}`, "", { landing: `${SITE}/partners/portal` }],
    [
      "the booked page before its ids leave the address",
      `${BOOKED}&id=${MEETING_ID}&crm_vid=${VISITOR_KEY}&m=${BOOKING_TOKEN}`,
      "https://crm.boostyourmaps.com/book/review-call",
      { landing: BOOKED, referrer: "https://crm.boostyourmaps.com/book/review-call" },
    ],
    // t and k go whatever they hold, not only when they look like a token.
    ["a welcome link with a short t", `${SITE}/welcome?t=abc123&utm_source=email`, "", { landing: `${SITE}/welcome?utm_source=email`, utm_source: "email" }],
    ["a portal link with a short k", `${SITE}/partners/portal?utm_source=email&k=abc123`, "", { landing: `${SITE}/partners/portal?utm_source=email`, utm_source: "email" }],
    ["a token under another name", `${SITE}/pricing?utm_source=email&key=${TOKEN}`, "", { landing: `${SITE}/pricing?utm_source=email`, utm_source: "email" }],
    ["a token in capitals", `${SITE}/pricing?utm_source=email&key=${TOKEN.toUpperCase()}`, "", { landing: `${SITE}/pricing?utm_source=email`, utm_source: "email" }],
    ["a token as a campaign value", `${SITE}/?utm_source=email&utm_content=${TOKEN}`, "", { landing: `${SITE}/?utm_source=email`, utm_source: "email" }],
    ["a token as a click id", `${SITE}/?gclid=${OTHER_TOKEN}&fbclid=IwAR0-fbclid`, "", { landing: `${SITE}/?fbclid=IwAR0-fbclid`, fbclid: "IwAR0-fbclid" }],
    ["a token in the path", `${SITE}/go/${TOKEN}?utm_source=email`, "", { utm_source: "email" }],
    ["a login in the address", `https://ana:${TOKEN}@www.boostyourmaps.com/pricing`, "", { landing: `${SITE}/pricing` }],
    ["a welcome link on this site as the referrer", `${SITE}/pricing`, `${SITE}/welcome?t=${TOKEN}`, { landing: `${SITE}/pricing` }],
    ["a key in an outside referrer's query and hash", `${SITE}/pricing`, `https://mail.example.com/open?session=${OTHER_TOKEN}#${TOKEN}`, { landing: `${SITE}/pricing`, referrer: "https://mail.example.com/open" }],
    ["a key in an outside referrer's path", `${SITE}/pricing`, `https://links.example.com/r/${OTHER_TOKEN}`, { landing: `${SITE}/pricing` }],
  ];
  for (const [what, url, referrer, expected] of cases) {
    const visitor = browser();
    await visitor.open(url, { referrer });
    assert.deepEqual(kept(visitor), { ...expected, first_seen_at: START }, what);
    assertNoSecrets(visitor.local, what);
  }
}

// ---- Storage blocked: nothing kept, nothing breaks --------------------------

async function checkBlockedStorage() {
  const visitor = browser({ blocked: true });
  const page = await visitor.open(FIRST_URL, { referrer: FIRST_REFERRER });
  assert.equal(visitor.local.items.size, 0);
  assert.equal(visitor.session.items.size, 0);
  // The rest of tracking.js still ran: an event pushed later reaches the dataLayer.
  page.window.dataLayer.push({ event: "generate_lead" });
  assert.equal(page.events("generate_lead").length, 1);

  // The checkout form still opens checkout, without attribution.
  const start = startPage();
  const checkout = await visitor.open(`${SITE}/get-started`, {
    scripts: ["tracking.js", "signup.js"],
    selectors: start.selectors,
    answer: () => ({ status: 200, data: { ok: true, checkoutUrl: CHECKOUT } }),
  });
  await checkout.send(start.form, "submit");
  assert.equal(checkout.posts.length, 1);
  assert.equal(checkout.posts[0].body.attribution, null);
  assert.equal(checkout.window.location.assigned, CHECKOUT);
  const built = buildStartPayload(checkout.posts[0].body, HEADERS);
  assert.equal(built.error, undefined);
  assert.equal("attribution" in built.payload, false);

  // So does the agreement's sign form.
  const agreement = agreementPage();
  const signing = await visitor.open(`${SITE}/agreement#t=${TOKEN}`, {
    scripts: ["tracking.js", "agreement.js"],
    selectors: agreement.selectors,
    ids: agreement.ids,
    answer: agreementAnswers("sent"),
  });
  await signing.send(agreement.form, "submit");
  const signed = signing.posts.find((post) => post.to === "/api/agreement/sign");
  assert.equal(signed.body.attribution, null);
  assert.equal(signing.window.location.assigned, CHECKOUT);
  assert.equal("attribution" in buildSignPayload(signed.body, HEADERS).payload, false);
}

// ---- The signup start sends the first touch ---------------------------------

async function checkSignupStart() {
  // Three days after the campaign link, the buyer is on /get-started with no
  // campaign values in its address.
  const buyer = browser();
  await buyer.open(FIRST_URL, { referrer: FIRST_REFERRER });
  buyer.advance(3 * DAY);
  const start = startPage();
  const page = await buyer.open(`${SITE}/get-started#top`, {
    referrer: `${SITE}/pricing`,
    scripts: ["tracking.js", "signup.js"],
    selectors: start.selectors,
    answer: () => ({ status: 200, data: { ok: true, checkoutUrl: CHECKOUT } }),
  });
  await page.send(start.form, "submit");

  assert.equal(page.posts.length, 1);
  const { to, body } = page.posts[0];
  assert.equal(to, "/api/signup/start");
  assert.deepEqual(body.attribution, FIRST_TOUCH);
  assert.equal(body.page_url, `${SITE}/get-started`);
  assert.equal(page.window.location.assigned, CHECKOUT);
  assert.equal(page.events("begin_checkout").length, 1);

  // Through the site's function: the CRM gets the first touch as `attribution`,
  // and the page's own sourceUrl and utm are what they were.
  const { payload } = buildStartPayload(body, HEADERS);
  assert.deepEqual(payload.attribution, FIRST_TOUCH);
  assert.equal(payload.sourceUrl, `${SITE}/get-started`);
  assert.deepEqual(payload.utm, {});

  // signup.js does not need tracking.js (an ad blocker can stop it): with
  // nothing kept, or a first touch that ran out, the form still opens checkout.
  for (const [what, setUp] of [
    ["nothing kept", () => {}],
    ["a first touch 90 days old", (visitor) => visitor.local.setItem("bym_first_touch", JSON.stringify({ ...FIRST_TOUCH, first_seen_at: new Date(Date.parse(START) - 90 * DAY).toISOString() }))],
    ["something unreadable", (visitor) => visitor.local.setItem("bym_first_touch", "{not json")],
  ]) {
    const visitor = browser();
    setUp(visitor);
    const form = startPage();
    const alone = await visitor.open(`${SITE}/get-started`, {
      scripts: ["signup.js"],
      selectors: form.selectors,
      answer: () => ({ status: 200, data: { ok: true, checkoutUrl: CHECKOUT } }),
    });
    await alone.send(form.form, "submit");
    assert.equal(alone.posts[0].body.attribution, null, what);
    assert.equal(alone.window.location.assigned, CHECKOUT, what);
  }

  // A record under the key that tracking.js would never write (a welcome link
  // as the landing) is posted as it is, and the site's function drops it.
  const tampered = browser();
  tampered.local.setItem("bym_first_touch", JSON.stringify({ ...FIRST_TOUCH, landing: `${SITE}/welcome?t=${TOKEN}` }));
  const form = startPage();
  const odd = await tampered.open(`${SITE}/get-started`, {
    scripts: ["tracking.js", "signup.js"],
    selectors: form.selectors,
    answer: () => ({ status: 200, data: { ok: true, checkoutUrl: CHECKOUT } }),
  });
  await odd.send(form.form, "submit");
  const dropped = buildStartPayload(odd.posts[0].body, HEADERS);
  assert.equal(dropped.error, undefined);
  assert.equal("attribution" in dropped.payload, false);
  assert.ok(!JSON.stringify(dropped.payload).includes(TOKEN));
}

// ---- The agreement signature sends the first touch --------------------------

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
  sections: [{ heading: "1. Services", blocks: [{ kind: "p", text: "We provide Google Maps organic marketing services." }] }],
  consentText: "I have read this agreement and agree to its terms.",
  expiresAt: "2026-11-27T18:00:00.000Z",
  signedAt: null,
  legalName: null,
  signatoryName: null,
};

// What the site's agreement functions answer, for an agreement in `status`.
function agreementAnswers(status) {
  return (to) => {
    if (to === "/api/agreement/load") return { status: 200, data: { ok: true, agreement: shapeAgreement({ ...AGREEMENT, status }) } };
    if (to === "/api/agreement/sign") return { status: 200, data: { ok: true, checkoutUrl: CHECKOUT } };
    return { status: 200, data: { ok: true } };
  };
}

async function checkAgreementSign() {
  // The lead first came from the campaign link, and opens the emailed
  // agreement in the same browser ten days later.
  const lead = browser();
  await lead.open(FIRST_URL, { referrer: FIRST_REFERRER });
  lead.advance(10 * DAY);
  const agreement = agreementPage();
  const page = await lead.open(`${SITE}/agreement#t=${TOKEN}`, {
    scripts: ["tracking.js", "agreement.js"],
    selectors: agreement.selectors,
    ids: agreement.ids,
    answer: agreementAnswers("sent"),
  });
  await page.send(agreement.form, "submit");

  const signed = page.posts.filter((post) => post.to === "/api/agreement/sign");
  assert.equal(signed.length, 1);
  assert.deepEqual(signed[0].body, {
    t: TOKEN,
    legal_name: "Ruiz Pest Control LLC",
    signatory_name: "Ana Ruiz",
    consent: true,
    attribution: FIRST_TOUCH,
  });
  assert.equal(page.window.location.assigned, CHECKOUT);
  // Through the site's function: the CRM gets it beside the signature.
  const { payload } = buildSignPayload(signed[0].body, HEADERS);
  assert.deepEqual(payload.attribution, FIRST_TOUCH);
  assert.equal(payload.legalName, "Ruiz Pest Control LLC");
  assertNoSecrets(lead.local, "after signing");

  // The agreement link as the very first page view: the first touch is the
  // agreement page without its token, and that is what goes along.
  const fresh = browser();
  const direct = agreementPage();
  const first = await fresh.open(`${SITE}/agreement#t=${TOKEN}`, {
    referrer: "https://mail.example.com/",
    scripts: ["tracking.js", "agreement.js"],
    selectors: direct.selectors,
    ids: direct.ids,
    answer: agreementAnswers("sent"),
  });
  await first.send(direct.form, "submit");
  const sent = first.posts.find((post) => post.to === "/api/agreement/sign").body;
  assert.deepEqual(sent.attribution, { landing: `${SITE}/agreement`, referrer: "https://mail.example.com/", first_seen_at: START });
  assert.deepEqual(buildSignPayload(sent, HEADERS).payload.attribution, sent.attribution);
  assertNoSecrets(fresh.local, "the agreement as the first page");

  // agreement.js does not need tracking.js either: with nothing kept, or a
  // first touch that ran out, the signature goes without attribution.
  for (const [what, setUp] of [
    ["nothing kept", () => {}],
    ["a first touch 90 days old", (visitor) => visitor.local.setItem("bym_first_touch", JSON.stringify({ ...FIRST_TOUCH, first_seen_at: new Date(Date.parse(START) - 90 * DAY).toISOString() }))],
    ["something unreadable", (visitor) => visitor.local.setItem("bym_first_touch", "{not json")],
  ]) {
    const visitor = browser();
    setUp(visitor);
    const alone = agreementPage();
    const signing = await visitor.open(`${SITE}/agreement#t=${TOKEN}`, {
      scripts: ["agreement.js"],
      selectors: alone.selectors,
      ids: alone.ids,
      answer: agreementAnswers("sent"),
    });
    await signing.send(alone.form, "submit");
    assert.equal(signing.posts.find((post) => post.to === "/api/agreement/sign").body.attribution, null, what);
    assert.equal(signing.window.location.assigned, CHECKOUT, what);
  }
  // One day short of 90, it still goes.
  const late = browser();
  late.local.setItem("bym_first_touch", JSON.stringify({ ...FIRST_TOUCH, first_seen_at: new Date(Date.parse(START) - 89 * DAY).toISOString() }));
  const lateForm = agreementPage();
  const latePage = await late.open(`${SITE}/agreement#t=${TOKEN}`, { scripts: ["agreement.js"], selectors: lateForm.selectors, ids: lateForm.ids, answer: agreementAnswers("sent") });
  await latePage.send(lateForm.form, "submit");
  assert.equal(latePage.posts.find((post) => post.to === "/api/agreement/sign").body.attribution.utm_source, "google");

  // "Continue to payment" on a signed agreement still posts { t } alone.
  const later = agreementPage();
  const pay = await lead.open(`${SITE}/agreement#t=${TOKEN}`, {
    scripts: ["tracking.js", "agreement.js"],
    selectors: later.selectors,
    ids: later.ids,
    answer: agreementAnswers("signed"),
  });
  await pay.send(later.root.querySelector("[data-pay]"), "click");
  assert.deepEqual(pay.posts.find((post) => post.to === "/api/agreement/sign").body, { t: TOKEN });
}

// ---- The welcome page: one purchase event -----------------------------------

// The signup as the CRM answers it; the site's function shapes it for the page.
const CRM_SIGNUP = {
  plan: "us",
  businessName: "Ruiz Pest Control",
  partnerName: null,
  firstName: "Ana",
  quantity: 2,
  paid: false,
  accessEmail: "team@boostyourmaps.com",
  accessConfirmed: false,
  intakeDone: false,
  bookingUrl: null,
  prefill: {},
};
const PAID = { paid: true, amountCents: 90000 };
const status = (changes) => ({ status: 200, data: { ok: true, signup: shapeSignup({ ...CRM_SIGNUP, ...changes }) } });
const PURCHASE = {
  event: "purchase",
  transaction_id: sha256(TOKEN),
  value: 900,
  currency: "USD",
  items: [{ item_id: "us", quantity: 2 }],
  page_path: "/welcome",
};
const purchaseKey = (token) => `bym_purchase_${sha256(token).slice(0, 16)}`;

// Opens /welcome for `token`. `answers` are the status answers, in order; the
// last one repeats.
async function openWelcome(buyer, answers, { token = TOKEN, hash = `#t=${token}`, scripts = ["tracking.js", "signup.js"] } = {}) {
  const welcome = welcomePage();
  const queue = [...answers];
  const page = await buyer.open(`${SITE}/welcome${hash}`, {
    referrer: "https://checkout.stripe.com/",
    scripts,
    selectors: welcome.selectors,
    ids: welcome.ids,
    answer: () => (queue.length > 1 ? queue.shift() : queue[0]),
  });
  page.root = welcome.root;
  // The steps are on screen: the page drew itself from the status answer.
  page.drawn = () => welcome.root.querySelector("[data-w-steps]").hidden === false && welcome.root.querySelector("[data-w-problem]").hidden !== false;
  return page;
}

// The token never reaches analytics or storage, in any form but its hash.
function assertTokenStaysHome(page, buyer, what) {
  assert.ok(!JSON.stringify(page.window.dataLayer).includes(TOKEN), `${what}: the token is in the dataLayer`);
  assert.ok(!JSON.stringify(Array.from(page.window.fbq.queue || [], (args) => Array.from(args))).includes(TOKEN), `${what}: the token went to the Meta pixel`);
  assertNoSecrets(buyer.local, what);
  assertNoSecrets(buyer.session, what);
}

async function checkPurchase() {
  // Back from Stripe before the payment is confirmed: the page waits, sees
  // the signup paid on its next look, and pushes one purchase.
  const buyer = browser();
  let page = await openWelcome(buyer, [status({}), status({}), status(PAID)]);
  assert.equal(page.drawn(), true);
  assert.equal(page.events("purchase").length, 0);
  await page.tick(3000);
  assert.equal(page.events("purchase").length, 0);
  await page.tick(3000);
  assert.deepEqual(page.events("purchase"), [PURCHASE]);
  assert.equal(PURCHASE.transaction_id.length, 64);
  assert.equal(page.events("signup_step").length, 1); // payment_received, as before
  assert.equal(buyer.local.items.get(purchaseKey(TOKEN)), "1");
  assert.deepEqual([...buyer.local.items.keys()].sort(), ["bym_first_touch", purchaseKey(TOKEN)]);
  assertTokenStaysHome(page, buyer, "paid while waiting");
  // The purchase is for Google Analytics only: nothing goes to the Meta pixel
  // for it (the CRM's server-side conversion is the one ad platforms count).
  const pixel = JSON.stringify(Array.from(page.window.fbq.queue, (args) => Array.from(args)));
  assert.ok(pixel.includes("PageView"));
  assert.ok(!/purchase/i.test(pixel));
  // "Check again" on the same page: no second purchase.
  await page.send(page.root.querySelector("[data-pay-again]"), "click");
  assert.equal(page.events("purchase").length, 1);

  // A reload, and a visit a month later, in the same browser: no purchase.
  page = await openWelcome(buyer, [status(PAID)]);
  assert.equal(page.drawn(), true);
  assert.equal(page.events("purchase").length, 0);
  buyer.advance(30 * DAY);
  page = await openWelcome(buyer, [status({ ...PAID, accessConfirmed: true })]);
  assert.equal(page.events("purchase").length, 0);

  // Another signup paid in the same browser is its own purchase.
  page = await openWelcome(buyer, [status({ ...PAID, plan: "partner", partnerName: "Keepers Digital Marketing", quantity: 1, amountCents: 25000 })], { token: OTHER_TOKEN });
  assert.deepEqual(page.events("purchase"), [
    { event: "purchase", transaction_id: sha256(OTHER_TOKEN), value: 250, currency: "USD", items: [{ item_id: "partner", quantity: 1 }], page_path: "/welcome" },
  ]);
  page = await openWelcome(buyer, [status({ ...PAID, plan: "partner", quantity: 1, amountCents: 25000 })], { token: OTHER_TOKEN });
  assert.equal(page.events("purchase").length, 0);

  // Already paid when the page first loads in this browser (the buyer opens
  // the welcome email on another device): one purchase, then none on reload.
  const phone = browser();
  page = await openWelcome(phone, [status(PAID)]);
  assert.deepEqual(page.events("purchase"), [PURCHASE]);
  assert.equal(page.events("signup_step").length, 0);
  assertTokenStaysHome(page, phone, "paid on load");
  page = await openWelcome(phone, [status(PAID)]);
  assert.equal(page.events("purchase").length, 0);

  // A welcome link whose token is still in the query (?t=) works the same.
  const query = browser();
  page = await openWelcome(query, [status(PAID)], { hash: `?t=${TOKEN}` });
  assert.deepEqual(page.events("purchase"), [PURCHASE]);
  assertTokenStaysHome(page, query, "token in the query");

  // Two tabs waiting on the same payment: one purchase between them.
  const tabs = browser();
  const one = await openWelcome(tabs, [status({}), status(PAID)]);
  const two = await openWelcome(tabs, [status({}), status(PAID)]);
  await Promise.all([one.tick(3000), two.tick(3000)]);
  assert.equal(one.events("purchase").length + two.events("purchase").length, 1);

  // Only with an amount. Paid, but the CRM sent no checkout total (or one
  // that is not a whole number of cents above zero): no purchase, and nothing
  // remembered, so the event still goes once the amount is there.
  for (const amountCents of [undefined, null, 0, -90000, 900.5, "90000"]) {
    const noAmount = browser();
    page = await openWelcome(noAmount, [status({}), status({ paid: true, amountCents })]);
    await page.tick(3000);
    assert.equal(page.drawn(), true);
    assert.equal(page.events("signup_step").length, 1, `amountCents ${amountCents}`);
    assert.equal(page.events("purchase").length, 0, `amountCents ${amountCents}`);
    assert.equal(noAmount.local.items.has(purchaseKey(TOKEN)), false);
    page = await openWelcome(noAmount, [status({ paid: true, amountCents })]);
    assert.equal(page.events("purchase").length, 0, `amountCents ${amountCents} on load`);
    page = await openWelcome(noAmount, [status(PAID)]);
    assert.deepEqual(page.events("purchase"), [PURCHASE]);
  }

  // Not paid: never a purchase, however long the page waits, amount or not.
  const waiting = browser();
  page = await openWelcome(waiting, [status({ amountCents: 90000 })]);
  for (let i = 0; i < 25; i++) await page.tick(3000);
  assert.equal(page.events("purchase").length, 0);
  assert.equal(waiting.local.items.has(purchaseKey(TOKEN)), false);

  // No crypto.subtle: nothing pushed, nothing remembered, the page still works.
  const old = browser({ subtle: false });
  page = await openWelcome(old, [status({}), status(PAID)]);
  await page.tick(3000);
  assert.equal(page.drawn(), true);
  assert.equal(page.events("signup_step").length, 1);
  assert.equal(page.events("purchase").length, 0);
  assert.equal(old.local.items.has(purchaseKey(TOKEN)), false);

  // Storage blocked: a reload could not be told apart, so nothing is pushed.
  // The page still draws its steps.
  const blocked = browser({ blocked: true });
  page = await openWelcome(blocked, [status(PAID)]);
  assert.equal(page.drawn(), true);
  assert.equal(page.events("purchase").length, 0);
  page = await openWelcome(blocked, [status({}), status(PAID)]);
  await page.tick(3000);
  assert.equal(page.events("signup_step").length, 1);
  assert.equal(page.events("purchase").length, 0);

  // signup.js alone (tracking.js stopped by an ad blocker) still pushes once.
  const alone = browser();
  page = await openWelcome(alone, [status(PAID)], { scripts: ["signup.js"] });
  assert.deepEqual(page.events("purchase"), [PURCHASE]);
  page = await openWelcome(alone, [status(PAID)], { scripts: ["signup.js"] });
  assert.equal(page.events("purchase").length, 0);

  // The preview asks for nothing and pushes nothing.
  const preview = browser();
  page = await openWelcome(preview, [status(PAID)], { hash: "#preview=direct" });
  assert.equal(page.posts.length, 0);
  assert.equal(page.events("purchase").length, 0);
  assert.equal(page.events("signup_step").length, 0);

  // A signup the CRM does not know: no purchase.
  const unknown = browser();
  page = await openWelcome(unknown, [{ status: 404, data: { ok: false, error: "signup_not_found", field: null } }]);
  assert.equal(page.events("purchase").length, 0);
  assert.equal(page.drawn(), false);
}

// ---- Every first touch kept above is one the CRM will get -------------------

function checkRoundTrip() {
  assert.ok(keptTouches.length > 30);
  const START_BODY = { plan: "us", first_name: "Ana", email: "ana@example.com", business_name: "Ruiz Pest Control", locations: 1, page_url: `${SITE}/get-started` };
  const SIGN_BODY = { t: TOKEN, legal_name: "Ruiz Pest Control LLC", signatory_name: "Ana Ruiz", consent: true };
  for (const touch of keptTouches) {
    // Only the keys the CRM takes, each a string of 500 characters at most.
    for (const [key, value] of Object.entries(touch)) {
      assert.ok(["landing", "referrer", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid", "first_seen_at"].includes(key), `key ${key}`);
      assert.equal(typeof value, "string");
      assert.ok(value.length > 0 && value.length <= 500, `${key} is ${value.length} characters`);
    }
    // The site's functions pass it on exactly as the browser kept it.
    assert.deepEqual(buildStartPayload({ ...START_BODY, attribution: touch }, HEADERS).payload.attribution, touch);
    assert.deepEqual(buildSignPayload({ ...SIGN_BODY, attribution: touch }, HEADERS).payload.attribution, touch);
  }
}

(async () => {
  await checkFirstTouch();
  await checkPrivateLinks();
  await checkBlockedStorage();
  await checkSignupStart();
  await checkAgreementSign();
  await checkPurchase();
  checkRoundTrip();
  console.log("First touch, attribution and purchase event checks passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
