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
