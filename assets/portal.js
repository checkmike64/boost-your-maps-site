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
  var REQUEST_STATES = {
    building: "Building",
    being_reviewed: "Being reviewed",
    ready: "Ready",
    declined: "Declined",
    expired: "Link expired",
    unavailable: "We couldn't run this one. Ask your BYM contact."
  };
  var EXPIRED = "Link expired: ask us for a new one";

  var root = document.querySelector("[data-portal]");
  if (!root) return;
  var $ = function (sel) { return root.querySelector(sel); };
  var currentToken = "";

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

  // "2026-10" -> "Oct 2026".
  function formatMonth(month) {
    var m = /^(\d{4})-(\d{2})$/.exec(month || "");
    if (!m) return "";
    var date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }

  function cell(row, label, text, className) {
    var td = document.createElement("td");
    td.setAttribute("data-label", label);
    if (className) td.className = className;
    if (text !== undefined) td.textContent = text;
    row.appendChild(td);
    return td;
  }

  // A client's monthly report links: a link per month while it is live, and
  // one line when a link has expired. Published links only; never a score.
  function reportsCell(td, reports) {
    var list = Array.isArray(reports) ? reports : [];
    var wrap = document.createElement("span");
    wrap.className = "su-cell-links";
    var expired = false;
    list.forEach(function (report) {
      if (report.state === "expired" || !isHttpUrl(report.url)) {
        expired = true;
        return;
      }
      var a = document.createElement("a");
      a.href = report.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = formatMonth(report.month);
      wrap.appendChild(a);
    });
    if (expired) {
      var note = document.createElement("span");
      note.className = "su-muted";
      note.textContent = EXPIRED;
      wrap.appendChild(note);
    }
    if (!wrap.childNodes.length) {
      wrap.className = "su-muted";
      wrap.textContent = "None yet";
    }
    td.appendChild(wrap);
  }

  // The reports this agency asked for from "Run a report".
  function renderRequested(list) {
    var requested = Array.isArray(list) ? list : [];
    var rows = $("[data-r-rows]");
    rows.textContent = "";
    requested.forEach(function (item) {
      var tr = document.createElement("tr");
      cell(tr, "Business", item.business || "Unnamed business", "su-name");
      cell(tr, "Asked", formatDate(item.requestedAt));
      cell(tr, "State", REQUEST_STATES[item.state] || "Checking");
      var td = cell(tr, "Report");
      if (item.state === "ready" && isHttpUrl(item.url)) {
        var a = document.createElement("a");
        a.href = item.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Open the report";
        td.appendChild(a);
      } else if (item.state === "expired") {
        td.className = "su-muted";
        td.textContent = EXPIRED;
      }
      rows.appendChild(tr);
    });
    $("[data-r-table]").hidden = requested.length === 0;
    $("[data-r-empty]").hidden = requested.length !== 0;
  }

  function render(portal, token) {
    currentToken = token;
    var title = document.querySelector("[data-p-title]");
    if (portal.partnerName) title.textContent = "Hello, " + portal.partnerName + " team";

    // The signup form knows the agency (and its contact) from the same key,
    // carried in the fragment so it never reaches a server log or analytics.
    $("[data-p-signup]").href = "/partners/signup#k=" + token;

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
      reportsCell(cell(tr, "Reports"), client.reports);
      rows.appendChild(tr);
    });
    $("[data-p-table]").hidden = clients.length === 0;
    $("[data-p-empty]").hidden = clients.length !== 0;
    renderRequested(portal.requestedReports);

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

    if (status === 200 && data.ok === true && data.portal) return render(data.portal, token);
    if (status === 404 || data.error === "portal_not_found") return showProblem(NOT_FOUND, false);
    if (data.error === "rate_limited") return showProblem("Too many tries in a row. Please wait a minute and try again.", true);
    showProblem("We can't load your portal right now. Please try again in a minute, or email " + TEAM_EMAIL + ".", true);
  }

  // ---- Run a report ---------------------------------------------------------
  // The business comes from the site's search (/api/places); the Place ID it
  // gives is the only way the CRM is told which business. Nothing is kept in
  // the browser. The CRM allows one report per agency every 5 minutes, and the
  // page counts that down from what the CRM says.
  var picked = null;
  var lockTimer = 0;
  var rForm = $("[data-r-form]");
  var rStatus = $("[data-r-status]");
  var rGo = $("[data-r-go]");
  var rLimit = $("[data-r-limit]");
  var LIMIT_TEXT = "You can run one report every 5 minutes.";

  function rSay(kind, text) {
    rStatus.textContent = text;
    rStatus.className = "form-status full is-visible" + (kind ? " is-" + kind : "");
  }

  function rClear() {
    rStatus.textContent = "";
    rStatus.className = "form-status full";
  }

  function lockFor(seconds) {
    window.clearInterval(lockTimer);
    var until = Date.now() + seconds * 1000;
    rGo.disabled = true;
    function tick() {
      var left = Math.ceil((until - Date.now()) / 1000);
      if (left <= 0) {
        window.clearInterval(lockTimer);
        rGo.disabled = false;
        rLimit.textContent = LIMIT_TEXT;
        return;
      }
      var minutes = Math.max(1, Math.ceil(left / 60));
      rLimit.textContent = "You can run another report in " + minutes + (minutes === 1 ? " minute." : " minutes.");
    }
    tick();
    lockTimer = window.setInterval(tick, 1000);
  }

  function choose(place) {
    picked = place;
    var line = $("[data-r-picked]");
    line.textContent = "Picked: " + place.name + (place.address ? ", " + place.address : "");
    line.hidden = false;
    $("[data-r-results]").textContent = "";
  }

  async function search() {
    var q = $("[data-r-q]").value.trim();
    var list = $("[data-r-results]");
    list.textContent = "";
    if (q.length < 3) return rSay("error", "Type the business name and town.");
    rSay("", "Searching…");
    var places = null;
    try {
      var response = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ q: q }),
        credentials: "omit",
        cache: "no-store"
      });
      var data = (await response.json().catch(function () { return null; })) || {};
      places = response.ok && Array.isArray(data.places) ? data.places : null;
    } catch (e) {
      places = null;
    }
    if (places === null) return rSay("error", "Search isn't working right now. Please try again in a minute.");
    if (!places.length) return rSay("error", "We found no match. Try the name as it shows on Google, plus the town.");
    rClear();
    places.forEach(function (place) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "su-linkbtn";
      b.textContent = place.name + (place.address ? ", " + place.address : "");
      b.addEventListener("click", function () { choose(place); });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  // After a request goes in, read the portal again so the new row shows.
  async function refreshRequested() {
    try {
      var response = await fetch("/api/partner-portal", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ k: currentToken }),
        credentials: "omit",
        cache: "no-store"
      });
      var data = (await response.json().catch(function () { return null; })) || {};
      if (response.status === 200 && data.ok === true && data.portal) renderRequested(data.portal.requestedReports);
    } catch (e) { /* the list shows on the next visit */ }
  }

  async function runReport(event) {
    event.preventDefault();
    rClear();
    var keyword = $("[data-r-keyword]").value.trim();
    if (!picked) return rSay("error", "Please search, then pick the business from the results.");
    if (!keyword) return rSay("error", "Please say what the business does, like plumber.");
    rGo.disabled = true;
    var status = 0;
    var data = {};
    try {
      var response = await fetch("/api/partner-report", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          k: currentToken,
          placeId: picked.placeId,
          placeLabel: picked.name + (picked.address ? ", " + picked.address : ""),
          businessName: picked.name,
          keyword: keyword,
          area: $("[data-r-area]").value.trim()
        }),
        credentials: "omit",
        cache: "no-store"
      });
      status = response.status;
      data = (await response.json().catch(function () { return null; })) || {};
    } catch (e) {
      status = 0;
    }
    if (status === 200 && data.ok === true && data.report === "queued") {
      rSay("success", "We are building your report. It will show in your list below when it is ready.");
      picked = null;
      $("[data-r-picked]").hidden = true;
      $("[data-r-q]").value = "";
      $("[data-r-keyword]").value = "";
      $("[data-r-area]").value = "";
      lockFor(300);
      return refreshRequested();
    }
    if (status === 200 && data.ok === true && data.report === "rate_limited") {
      var wait = Number.isInteger(data.retryAfterSeconds) && data.retryAfterSeconds > 0 ? data.retryAfterSeconds : 300;
      var minutes = Math.max(1, Math.ceil(wait / 60));
      rSay("error", "You can run another report in " + minutes + (minutes === 1 ? " minute." : " minutes."));
      return lockFor(wait);
    }
    rGo.disabled = false;
    if (status === 429) return rSay("error", "Too many tries in a row. Please wait a minute and try again.");
    if (status === 404) return rSay("error", NOT_FOUND);
    if (data.error === "invalid_input" && data.field === "placeId") return rSay("error", "Please search again and pick the business from the results.");
    if (data.error === "invalid_input" && data.field === "keyword") return rSay("error", "Please say what the business does, like plumber.");
    rSay("error", "We can't take that right now. Please try again in a minute, or email " + TEAM_EMAIL + ".");
  }

  function setUpRunReport() {
    if (!rForm) return;
    // The search needs the site's Places key. Without it there is no way to
    // pick a business, so the form is replaced by a way to ask the team.
    function turnOff() {
      rForm.hidden = true;
      $("[data-r-off]").hidden = false;
    }
    fetch("/api/places", { headers: { "Accept": "application/json" }, credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : { enabled: false }; })
      .then(function (d) { if (!d || !d.enabled) turnOff(); })
      .catch(turnOff);
    $("[data-r-search]").addEventListener("click", search);
    $("[data-r-q]").addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); search(); }
    });
    rForm.addEventListener("submit", runReport);
  }

  $("[data-p-retry]").addEventListener("click", load);
  setUpRunReport();
  load();
})();
