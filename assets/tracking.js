(function () {
  "use strict";

  window.dataLayer = window.dataLayer || [];

  // Meta pixel "Boost Your Maps Site" (Impact Leads LLC). PageView on every page;
  // the site's own dataLayer events map to Meta standard events below.
  var META_PIXEL_ID = "1483845383633230";
  var META_EVENTS = {
    generate_lead: "Lead",
    begin_checkout: "InitiateCheckout",
    book_appointment: "Schedule"
  };
  (function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  window.fbq("init", META_PIXEL_ID);
  window.fbq("track", "PageView");

  function sendMeta(data) {
    var name = data && META_EVENTS[data.event];
    if (name) window.fbq("trackSingle", META_PIXEL_ID, name);
  }
  // Events already in the dataLayer (e.g. /booked pushes before this loads),
  // then every later push. GTM keeps and calls this wrapper when it loads.
  window.dataLayer.forEach(sendMeta);
  var originalPush = window.dataLayer.push;
  window.dataLayer.push = function () {
    for (var i = 0; i < arguments.length; i++) sendMeta(arguments[i]);
    return originalPush.apply(window.dataLayer, arguments);
  };

  function pushEvent(data) {
    data.page_path = window.location.pathname;
    window.dataLayer.push(data);
  }

  // Lead source per page (2026-11-11): the first page of the visit and the site that sent the visitor,
  // kept for this tab only. forms.js adds them to the page URL the CRM stores, so each lead shows the page
  // that brought it. Paths and a host name only; nothing about the person.
  try {
    if (!window.sessionStorage.getItem("bym_landing")) {
      window.sessionStorage.setItem("bym_landing", window.location.pathname);
      var refHost = "";
      try { refHost = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) {}
      window.sessionStorage.setItem("bym_landing_ref", refHost === window.location.hostname ? "" : refHost);
    }
  } catch (e) {}

  // First touch (2026-11-15): where this browser first came from, kept in localStorage for 90 days and sent
  // with a signup start and an agreement signature (signup.js, agreement.js), so a paid signup keeps its
  // source. Written on the first page view and never overwritten while it is under 90 days old. It holds the
  // landing address, the site that sent the visitor, the utm_* values, the ad click ids and the time: nothing
  // the person typed. A private link never gets in: the landing goes without its hash and without t, k, id, m
  // and crm_vid (what the private pages take out of the address in <head>), and no value shaped like a key
  // (64 hex characters in a row) is kept. With storage blocked nothing is kept and every form still works.
  var FIRST_TOUCH_KEY = "bym_first_touch";
  var FIRST_TOUCH_MS = 90 * 24 * 60 * 60 * 1000;
  var FIRST_TOUCH_MAX = 500; // the CRM keeps 500 characters per value
  var PRIVATE_PARAMS = ["t", "k", "id", "m", "crm_vid"];
  var CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid"];
  var KEY_SHAPED = /[0-9a-f]{64}/i;

  // The saved first touch while it is under 90 days old; null when there is none or it cannot be read.
  function savedFirstTouch() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(FIRST_TOUCH_KEY) || "null");
      var seen = saved && typeof saved === "object" ? Date.parse(saved.first_seen_at) : NaN;
      return Date.now() - seen < FIRST_TOUCH_MS ? saved : null;
    } catch (e) {
      return null;
    }
  }

  // One value to keep: trimmed, without control characters. "" when it is too long or shaped like a key.
  function touchValue(value) {
    var kept = String(value || "").replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, "").trim();
    return kept.length > FIRST_TOUCH_MAX || KEY_SHAPED.test(kept) ? "" : kept;
  }

  // This page's address without its hash and private parameters. When that is still too long it goes
  // without its query: the utm_* values and click ids are kept on their own.
  function landingAddress() {
    var url = new URL(window.location.href);
    url.hash = "";
    url.username = "";
    url.password = "";
    var drop = PRIVATE_PARAMS.slice();
    url.searchParams.forEach(function (value, name) {
      if (KEY_SHAPED.test(value)) drop.push(name);
    });
    drop.forEach(function (name) {
      if (url.searchParams.has(name)) url.searchParams.delete(name);
    });
    return url.href.length > FIRST_TOUCH_MAX ? url.origin + url.pathname : url.href;
  }

  // The site that sent the visitor: its address without query or hash, which can hold someone else's
  // keys. This site itself is not a source.
  function referrerAddress() {
    try {
      var ref = new URL(document.referrer);
      if (!/^(https?|android-app):$/.test(ref.protocol) || ref.hostname === window.location.hostname) return "";
      return ref.protocol + "//" + ref.host + ref.pathname;
    } catch (e) {
      return "";
    }
  }

  try {
    if (!savedFirstTouch()) {
      var touch = {};
      var query = new URL(window.location.href).searchParams;
      var keep = function (key, value) {
        value = touchValue(value);
        if (value) touch[key] = value;
      };
      keep("landing", landingAddress());
      keep("referrer", referrerAddress());
      CAMPAIGN_KEYS.forEach(function (key) { keep(key, query.get(key)); });
      touch.first_seen_at = new Date().toISOString();
      window.localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(touch));
    }
  } catch (e) {}

  function ctaLocation(el) {
    if (el.closest("nav")) return "nav";
    if (el.closest(".page-hero")) return "hero";
    if (el.closest("#pricing")) return "pricing";
    if (el.closest("#rank")) return "rank_section";
    if (el.closest(".cta-panel")) return "cta_panel";
    if (el.closest("footer")) return "footer";
    return "other";
  }

  document.addEventListener("click", function (event) {
    var link = event.target.closest("a[href]");
    if (!link) return;

    var href = link.getAttribute("href") || "";

    if (link.matches(".btn, .tlink")) {
      pushEvent({
        event: "cta_click",
        cta_label: (link.textContent || "").trim(),
        cta_location: ctaLocation(link)
      });
    }

    if (href.indexOf("/assets/visibility-report-sample") === 0) {
      pushEvent({ event: "view_sample_report" });
      return;
    }

    if (/^https?:\/\//i.test(href) && href.indexOf(window.location.hostname) === -1) {
      pushEvent({ event: "outbound_click", link_url: href });
    }
  });

  var bymMap = document.getElementById("bym-map");
  if (bymMap) {
    bymMap.addEventListener("click", function (event) {
      var pin = event.target.closest(".bym-pin");
      var row = event.target.closest(".bym-row");
      var el = pin || row;
      if (!el) return;

      pushEvent({
        event: "map_demo_interact",
        element_type: pin ? "pin" : "row",
        element_index: row && row.dataset.i !== undefined ? row.dataset.i : null,
        element_label: (el.getAttribute("aria-label") || "").trim()
      });
    });
  }
})();
