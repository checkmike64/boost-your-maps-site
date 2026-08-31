(function () {
  "use strict";

  window.dataLayer = window.dataLayer || [];

  function pushEvent(data) {
    data.page_path = window.location.pathname;
    window.dataLayer.push(data);
  }

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
