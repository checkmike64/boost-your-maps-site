/* Google review link generator (/tools/google-review-link-generator): the parts that
   need no page. Reads a Place ID or a Google link, builds the review link and draws the
   QR code as SVG or onto a canvas. assets/review-link.js uses it in the browser;
   scripts/check_review_link.js tests it in CI (node). No network, no storage. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BYMReviewLink = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var REVIEW_BASE = "https://search.google.com/local/writereview?placeid=";
  var ID_CHARS = /^[A-Za-z0-9_-]+$/;
  // Hosts whose links hide the Place ID behind a redirect we can't follow from the page.
  var SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl", "share.google", "g.co"];

  // Google says Place IDs vary in length and format (most business IDs start with ChIJ),
  // so this only checks the alphabet and a sane length.
  function isPlaceId(s) {
    return typeof s === "string" && s.length >= 20 && s.length <= 512 && ID_CHARS.test(s);
  }

  function reviewLink(placeId) {
    return REVIEW_BASE + encodeURIComponent(placeId);
  }

  function isGoogleHost(host) {
    return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
  }

  function toUrl(text) {
    var t = text;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
      if (/^(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(\/|$)/i.test(t)) t = "https://" + t;
      else return null;
    }
    var u;
    try { u = new URL(t); } catch (e) { return null; }
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  // Where Google Maps links carry a Place ID: ?placeid=, ?place_id=, ?query_place_id=,
  // "place_id:" inside q or query, and !19s / !1s inside the data part of the path.
  function placeIdFromUrl(u) {
    var keys = ["placeid", "place_id", "query_place_id"];
    for (var i = 0; i < keys.length; i++) {
      var v = u.searchParams.get(keys[i]);
      if (v && isPlaceId(v.trim())) return v.trim();
    }
    var q = (u.searchParams.get("q") || "") + " " + (u.searchParams.get("query") || "");
    var m = q.match(/place_id:([A-Za-z0-9_-]{20,})/);
    if (m) return m[1];
    var whole = safeDecode(u.pathname + u.search + u.hash);
    m = whole.match(/!19s([A-Za-z0-9_-]{20,})/) || whole.match(/!1s(ChIJ[A-Za-z0-9_-]{16,})/);
    if (m) return m[1];
    return null;
  }

  /* parseInput(text) ->
       { ok: true, kind: "place_id", placeId, link }
       { ok: true, kind: "review_link", link }        a g.page review link from the Business Profile
       { ok: false, code: "empty" | "short_link" | "no_place_id" | "not_google" | "unreadable" } */
  function parseInput(raw) {
    var text = String(raw == null ? "" : raw).trim();
    if (!text) return { ok: false, code: "empty" };
    if (isPlaceId(text)) return { ok: true, kind: "place_id", placeId: text, link: reviewLink(text) };

    var u = toUrl(text);
    if (!u) return { ok: false, code: "unreadable" };
    var host = u.hostname.toLowerCase().replace(/^www\./, "");

    if (host === "g.page") {
      var parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "r" && parts[1] && ID_CHARS.test(parts[1]) && (parts.length === 2 || (parts.length === 3 && parts[2] === "review"))) {
        return { ok: true, kind: "review_link", link: "https://g.page/r/" + parts[1] + "/review" };
      }
      if (parts.length === 2 && parts[1] === "review" && ID_CHARS.test(parts[0])) {
        return { ok: true, kind: "review_link", link: "https://g.page/" + parts[0] + "/review" };
      }
      return { ok: false, code: "no_place_id" };
    }
    if (SHORT_HOSTS.indexOf(host) !== -1) return { ok: false, code: "short_link" };
    if (!isGoogleHost(host)) return { ok: false, code: "not_google" };

    var id = placeIdFromUrl(u);
    if (id) return { ok: true, kind: "place_id", placeId: id, link: reviewLink(id) };
    return { ok: false, code: "no_place_id" };
  }

  /* QR code. qrcodeLib is the vendored qrcode-generator (window.qrcode in the browser).
     Error correction M keeps the code readable with a small scratch or smudge. */
  function makeQr(text, qrcodeLib) {
    var qr = qrcodeLib(0, "M");
    qr.addData(text, "Byte");
    qr.make();
    var n = qr.getModuleCount();
    var rows = [];
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) row.push(qr.isDark(r, c));
      rows.push(row);
    }
    return { size: n, rows: rows };
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, function (ch) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  // One path for the whole code: each run of dark modules in a row is one rectangle.
  function qrPath(m, margin) {
    var d = [];
    for (var r = 0; r < m.size; r++) {
      var c = 0;
      while (c < m.size) {
        if (!m.rows[r][c]) { c++; continue; }
        var start = c;
        while (c < m.size && m.rows[r][c]) c++;
        d.push("M" + (start + margin) + " " + (r + margin) + "h" + (c - start) + "v1h-" + (c - start) + "z");
      }
    }
    return d.join("");
  }

  function qrSvg(m, opts) {
    opts = opts || {};
    var margin = opts.margin == null ? 4 : opts.margin;
    var dim = m.size + margin * 2;
    var px = opts.px || dim * 10;
    var color = opts.color || "#000000";
    var bg = opts.background || "#FFFFFF";
    var title = opts.title ? "<title>" + escapeXml(opts.title) + "</title>" : "";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + " " + dim + '" width="' + px +
      '" height="' + px + '" shape-rendering="crispEdges"' + (opts.title ? ' role="img"' : "") + ">" + title +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + bg + '"/>' +
      '<path fill="' + color + '" d="' + qrPath(m, margin) + '"/></svg>';
  }

  // Draws the code onto a 2D canvas context; returns the side length in pixels.
  function drawQr(ctx, m, opts) {
    opts = opts || {};
    var margin = opts.margin == null ? 4 : opts.margin;
    var dim = m.size + margin * 2;
    var scale = Math.max(1, Math.floor((opts.px || 1200) / dim));
    var side = dim * scale;
    ctx.fillStyle = opts.background || "#FFFFFF";
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = opts.color || "#000000";
    for (var r = 0; r < m.size; r++) {
      for (var c = 0; c < m.size; c++) {
        if (m.rows[r][c]) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
      }
    }
    return side;
  }

  // The same ask for every customer: no incentive, no hint that only happy customers should reply.
  function textMessage(name, link) {
    var who = String(name || "").trim();
    return (who ? "Hi, it's " + who + ". Would you" : "Hi, would you") +
      " leave us a Google review about today's job? " + link;
  }

  function fileSlug(name) {
    var s = String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
    return s ? "google-review-qr-" + s : "google-review-qr";
  }

  return {
    REVIEW_BASE: REVIEW_BASE,
    isPlaceId: isPlaceId,
    reviewLink: reviewLink,
    parseInput: parseInput,
    makeQr: makeQr,
    qrSvg: qrSvg,
    drawQr: drawQr,
    escapeXml: escapeXml,
    textMessage: textMessage,
    fileSlug: fileSlug
  };
});
