// The agency partner portal at /partners/portal#k=<token>. An inline script
// in <head> moves ?k= into the hash before analytics loads; the token only
// travels to this site's /api/partner-portal function inside a POST body.
(function () {
  "use strict";

  var TOKEN = /^[0-9a-f]{64}$/;
  var TEAM_EMAIL = "team@boostyourmaps.com";

  var STAGES = {
    waiting_for_payment: "Waiting for payment",
    setting_up: "Setting up",
    live: "Live",
    payment_issue: "Payment issue",
    paused: "Paused",
    canceled: "Canceled"
  };
  var LINKS = [["deliverables", "Deliverables"], ["photos", "Photos"], ["dashboard", "Dashboard"]];

  var root = document.querySelector("[data-portal]");
  if (!root) return;
  var $ = function (sel) { return root.querySelector(sel); };

  function isHttpUrl(value) {
    return typeof value === "string" && /^https?:\/\//i.test(value);
  }

  function tokenFromUrl() {
    var match = window.location.hash.match(/(?:^#|&)k=([^&]*)/);
    var raw = match ? match[1] : new URLSearchParams(window.location.search).get("k");
    try { return raw ? decodeURIComponent(raw) : ""; } catch (e) { return ""; }
  }

  function setMessage(el, message) {
    el.textContent = "";
    String(message).split(TEAM_EMAIL).forEach(function (part, i) {
      if (i > 0) {
        var a = document.createElement("a");
        a.href = "mailto:" + TEAM_EMAIL;
        a.textContent = TEAM_EMAIL;
        el.appendChild(a);
      }
      el.appendChild(document.createTextNode(part));
    });
  }

  function showProblem(message, canRetry) {
    $("[data-p-loading]").hidden = true;
    $("[data-p-body]").hidden = true;
    var problem = $("[data-p-problem]");
    problem.hidden = false;
    setMessage($("[data-p-problem-text]"), message);
    $("[data-p-retry]").hidden = !canRetry;
    problem.focus();
  }

  var NOT_FOUND = "This portal link isn't working. It may have been turned off. Ask your Boost Your Maps contact for a new one, or email " + TEAM_EMAIL + ".";

  // "2026-10-09" -> "Oct 9, 2026", read as a calendar date (no time zone shift).
  function formatDate(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
    if (!m) return "";
    var date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  function cell(row, label, text, className) {
    var td = document.createElement("td");
    td.setAttribute("data-label", label);
    if (className) td.className = className;
    if (text !== undefined) td.textContent = text;
    row.appendChild(td);
    return td;
  }

  function render(portal) {
    var title = document.querySelector("[data-p-title]");
    if (portal.partnerName) title.textContent = "Hello, " + portal.partnerName + " team";

    $("[data-p-signup]").href = "/partners/signup" + (portal.partnerSlug ? "?partner=" + encodeURIComponent(portal.partnerSlug) : "");

    var book = $("[data-p-book]");
    if (isHttpUrl(portal.bookingUrl)) {
      book.href = portal.bookingUrl;
      book.hidden = false;
    }

    if (isHttpUrl(portal.reportingDashboardUrl)) {
      $("[data-p-dash-link]").href = portal.reportingDashboardUrl;
      $("[data-p-dash]").hidden = false;
      $("[data-p-dash-wait]").hidden = true;
    }

    var clients = Array.isArray(portal.clients) ? portal.clients : [];
    var rows = $("[data-p-rows]");
    rows.textContent = "";
    clients.forEach(function (client) {
      var tr = document.createElement("tr");
      cell(tr, "Client", client.name || "Unnamed client", "su-name");
      cell(tr, "City", client.city || "Not set");
      cell(tr, "Locations", client.locations === null || client.locations === undefined ? "" : String(client.locations));
      cell(tr, "Stage", STAGES[client.stage] || "Checking", client.stage ? "su-stage-" + client.stage : "");
      cell(tr, "Since", formatDate(client.since));
      var linksCell = cell(tr, "Links");
      var wrap = document.createElement("span");
      wrap.className = "su-cell-links";
      LINKS.forEach(function (pair) {
        var href = client.links && client.links[pair[0]];
        if (!isHttpUrl(href)) return;
        var a = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = pair[1];
        wrap.appendChild(a);
      });
      if (!wrap.childNodes.length) {
        wrap.className = "su-muted";
        wrap.textContent = "None yet";
      }
      linksCell.appendChild(wrap);
      rows.appendChild(tr);
    });
    $("[data-p-table]").hidden = clients.length === 0;
    $("[data-p-empty]").hidden = clients.length !== 0;

    $("[data-p-loading]").hidden = true;
    $("[data-p-problem]").hidden = true;
    $("[data-p-body]").hidden = false;
  }

  async function load() {
    var token = tokenFromUrl();
    if (!TOKEN.test(token)) return showProblem(NOT_FOUND, false);

    $("[data-p-problem]").hidden = true;
    $("[data-p-loading]").hidden = false;
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, 15000);
    var status = 0;
    var data = {};
    try {
      var response = await fetch("/api/partner-portal", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ k: token }),
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal
      });
      status = response.status;
      data = (await response.json().catch(function () { return null; })) || {};
    } catch (e) {
      status = 0;
    } finally {
      window.clearTimeout(timer);
    }

    if (status === 200 && data.ok === true && data.portal) return render(data.portal);
    if (status === 404 || data.error === "portal_not_found") return showProblem(NOT_FOUND, false);
    if (data.error === "rate_limited") return showProblem("Too many tries in a row. Please wait a minute and try again.", true);
    showProblem("We can't load your portal right now. Please try again in a minute, or email " + TEAM_EMAIL + ".", true);
  }

  $("[data-p-retry]").addEventListener("click", load);
  load();
})();
