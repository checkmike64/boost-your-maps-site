/* Google review link generator page (/tools/google-review-link-generator).
   Needs assets/vendor/qrcode-generator-2.0.4.js (window.qrcode) and
   assets/review-link-core.js (window.BYMReviewLink). Everything runs in the browser.
   The business-name search turns on only when /api/places says a Places key is set. */
(function () {
  "use strict";

  var core = window.BYMReviewLink;
  var INK = "#17282E";
  var MESSAGES = {
    empty: "Paste your Place ID or a Google link first.",
    short_link: "That's a short share link, and it hides the Place ID. Copy the link from \"Ask for reviews\" in your Business Profile, or look up your Place ID with Google's Place ID Finder.",
    no_place_id: "That Google link doesn't have a Place ID in it. Copy the link from \"Ask for reviews\" in your Business Profile, or look up your Place ID with Google's Place ID Finder.",
    not_google: "That link isn't a Google link. Paste your Place ID, or the link from \"Ask for reviews\" in your Business Profile.",
    unreadable: "We couldn't find a Place ID in that. Look up your business with Google's Place ID Finder, then paste the ID here."
  };

  function $(id) { return document.getElementById(id); }

  function say(el, text, kind) {
    el.textContent = text;
    el.className = "form-status is-visible" + (kind ? " is-" + kind : "");
  }

  function hide(el) { el.className = "form-status"; el.textContent = ""; }

  var state = { link: "", qr: null, name: "" };

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function svgFor(px, title) {
    return core.qrSvg(state.qr, { px: px, color: INK, title: title });
  }

  function render(result, name, focus) {
    state.link = result.link;
    state.name = name;
    state.qr = core.makeQr(result.link, window.qrcode);

    $("rl-link").value = result.link;
    $("rl-msg").value = core.textMessage(name, result.link);
    $("rl-open").href = result.link;
    $("rl-qr").innerHTML = svgFor(240, "QR code that opens the Google review box");
    $("rl-card-qr").innerHTML = svgFor(480, "QR code that opens the Google review box");
    $("rl-card-name").textContent = name;
    $("rl-card-name").hidden = !name;

    var out = $("rl-result");
    out.hidden = false;
    hide($("rl-copy-status"));
    if (focus !== false) $("rl-result-h").focus();
  }

  function onSubmit(ev) {
    ev.preventDefault();
    var status = $("rl-status");
    var result = core.parseInput($("rl-input").value);
    if (!result.ok) {
      $("rl-result").hidden = true;
      $("rl-input").setAttribute("aria-invalid", "true");
      say(status, MESSAGES[result.code] || MESSAGES.unreadable, "error");
      status.focus();
      return;
    }
    $("rl-input").removeAttribute("aria-invalid");
    hide(status);
    render(result, $("rl-name").value.trim().slice(0, 80));
  }

  // The name on the card and in the text message can be typed after the link is made.
  function onName() {
    if (!state.link) return;
    var name = $("rl-name").value.trim().slice(0, 80);
    state.name = name;
    $("rl-card-name").textContent = name;
    $("rl-card-name").hidden = !name;
    $("rl-msg").value = core.textMessage(name, state.link);
  }

  function copyFrom(input, note) {
    function fallback() {
      input.focus();
      input.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      say(note, ok ? "Copied." : "Select it and copy it by hand.", ok ? "success" : "error");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(function () { say(note, "Copied.", "success"); }, fallback);
    } else {
      fallback();
    }
  }

  function copyLink() { copyFrom($("rl-link"), $("rl-copy-status")); }
  function copyMessage() { copyFrom($("rl-msg"), $("rl-msg-status")); }

  function downloadPng() {
    var canvas = document.createElement("canvas");
    var dim = state.qr.size + 8;
    var side = dim * Math.max(1, Math.floor(1200 / dim));
    canvas.width = side;
    canvas.height = side;
    core.drawQr(canvas.getContext("2d"), state.qr, { px: 1200, color: INK });
    var name = core.fileSlug(state.name) + ".png";
    if (canvas.toBlob) {
      canvas.toBlob(function (blob) { download(blob, name); }, "image/png");
    } else {
      var a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = name;
      a.click();
    }
  }

  function downloadSvg() {
    var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgFor(1200, "Google review QR code");
    download(new Blob([svg], { type: "image/svg+xml" }), core.fileSlug(state.name) + ".svg");
  }

  function printCard() {
    var holder = $("rl-print");
    holder.innerHTML = "";
    holder.appendChild($("rl-card").cloneNode(true));
    holder.firstChild.removeAttribute("id");
    window.print();
  }

  /* Business-name search: only when the site has a Places key (GOOGLE_PLACES_API_KEY). */
  function setUpSearch() {
    var box = $("rl-search");
    if (!box || !window.fetch) return;
    fetch("/api/places", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : { enabled: false }; })
      .then(function (d) { if (d && d.enabled) box.hidden = false; })
      .catch(function () {});

    $("rl-search-go").addEventListener("click", function () {
      var q = $("rl-search-q").value.trim();
      var list = $("rl-search-results");
      var note = $("rl-search-status");
      list.innerHTML = "";
      if (q.length < 3) { say(note, "Type your business name and town.", "error"); return; }
      say(note, "Searching…");
      fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ q: q })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          var places = (res.ok && res.d && res.d.places) || [];
          if (!places.length) {
            say(note, res.ok ? "No match. Try the name the way it shows on Google, plus your town." : "Search isn't working right now. Paste your Place ID instead.", "error");
            return;
          }
          hide(note);
          places.forEach(function (p) {
            var li = document.createElement("li");
            var b = document.createElement("button");
            b.type = "button";
            b.className = "rl-pick";
            var strong = document.createElement("strong");
            strong.textContent = p.name;
            var span = document.createElement("span");
            span.textContent = p.address;
            b.appendChild(strong);
            b.appendChild(span);
            b.addEventListener("click", function () {
              $("rl-input").value = p.placeId;
              if (!$("rl-name").value.trim()) $("rl-name").value = p.name;
              $("rl-form").requestSubmit ? $("rl-form").requestSubmit() : onSubmit(new Event("submit"));
            });
            li.appendChild(b);
            list.appendChild(li);
          });
        })
        .catch(function () { say(note, "Search isn't working right now. Paste your Place ID instead.", "error"); });
    });
  }

  function init() {
    if (!core || !window.qrcode) return;
    $("rl-form").addEventListener("submit", onSubmit);
    $("rl-name").addEventListener("input", onName);
    $("rl-copy").addEventListener("click", copyLink);
    $("rl-copy-msg").addEventListener("click", copyMessage);
    $("rl-png").addEventListener("click", downloadPng);
    $("rl-svg").addEventListener("click", downloadSvg);
    $("rl-print-btn").addEventListener("click", printCard);
    setUpSearch();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
