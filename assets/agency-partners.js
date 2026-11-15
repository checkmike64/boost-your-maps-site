// The Agency Partners page (/agency-partners): one email field. Whatever the
// email is, a request that goes through gets the same words back, so the page
// never says whether an address belongs to a partner. It names no agency and
// asks only this site's /api/partner-access function.
(function () {
  "use strict";

  // The one answer. api/_partner.js keeps the same text, and the site checks
  // that the two match.
  var NEUTRAL = "If that email belongs to a partner, we sent a sign-in link.";
  var TEAM_EMAIL = "team@boostyourmaps.com";
  var MESSAGES = {
    email: "Please check the email address.",
    rate_limited: "Too many tries in a row. Please wait an hour and try again, or email " + TEAM_EMAIL + ".",
    unavailable: "We can't send the link right now. Please try again in a minute, or email " + TEAM_EMAIL + "."
  };

  var form = document.getElementById("partner-access-form");
  if (!form) return;
  var status = form.querySelector(".form-status");
  var button = form.querySelector("button[type=submit]");
  var email = form.elements.email;

  function say(kind, text) {
    status.textContent = text;
    status.className = "form-status full is-visible is-" + kind;
    status.focus();
  }

  function clear() {
    status.textContent = "";
    status.className = "form-status full";
    email.removeAttribute("aria-invalid");
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clear();
    var typed = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed) || typed.length > 320) {
      email.setAttribute("aria-invalid", "true");
      say("error", MESSAGES.email);
      email.focus();
      return;
    }
    button.disabled = true;
    form.setAttribute("aria-busy", "true");
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, 15000);
    var code = "unavailable";
    var ok = false;
    try {
      var response = await fetch(form.getAttribute("data-endpoint"), {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ email: typed, hp_field_2026: form.elements.hp_field_2026.value }),
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal
      });
      var data = (await response.json().catch(function () { return null; })) || {};
      if (response.status === 200 && data.ok === true) ok = true;
      else if (response.status === 429) code = "rate_limited";
      else if (response.status === 400 && data.field === "email") code = "email";
    } catch (e) {
      code = "unavailable";
    } finally {
      window.clearTimeout(timer);
      button.disabled = false;
      form.removeAttribute("aria-busy");
    }
    if (ok) {
      say("success", NEUTRAL);
      email.value = "";
    } else {
      say("error", MESSAGES[code]);
    }
  });
})();
