(function () {
  "use strict";

  window.dataLayer = window.dataLayer || [];

  function pushEvent(data) {
    data.page_path = window.location.pathname;
    window.dataLayer.push(data);
  }

  var forms = document.querySelectorAll("form[data-native-form]");

  function showStatus(status, type, message, allowMarkup, quiet) {
    status.className = "form-status full is-visible is-" + type;
    if (allowMarkup) {
      status.innerHTML = message;
    } else {
      status.textContent = message;
    }
    if (!quiet) status.focus();
  }

  // The page URL the CRM stores, plus where the lead came from (2026-11-11): landing = first page of the
  // visit and ref = the site that sent the visitor (both from tracking.js), from = the page just before
  // this form. Existing values in the URL win; nothing is added when storage is blocked.
  function pageUrlWithSource() {
    var url;
    try { url = new URL(window.location.href); } catch (e) { return window.location.href; }
    function add(key, value) {
      if (value && !url.searchParams.has(key)) url.searchParams.set(key, String(value).slice(0, 200));
    }
    try {
      add("landing", window.sessionStorage.getItem("bym_landing"));
      add("ref", window.sessionStorage.getItem("bym_landing_ref"));
    } catch (e) {}
    try {
      var prev = document.referrer ? new URL(document.referrer) : null;
      if (prev && prev.hostname === url.hostname && prev.pathname !== url.pathname) add("from", prev.pathname);
    } catch (e) {}
    return url.toString();
  }

  function formPayload(form) {
    var fields = {};
    var data = new FormData(form);

    data.forEach(function (value, key) {
      if (key === "hp_field_2026") return;

      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        if (!Array.isArray(fields[key])) fields[key] = [fields[key]];
        fields[key].push(value);
      } else {
        fields[key] = value;
      }
    });

    return {
      form_type: form.dataset.formType,
      submitted_at: new Date().toISOString(),
      page_url: pageUrlWithSource(),
      fields: fields
    };
  }

  function withToken(payload, token) {
    if (token) payload.human_token = token;
    return payload;
  }

  // Bot check (Cloudflare Turnstile). Only forms marked data-human-check call
  // humanCheck. The widget box and the public site key are in the page's HTML
  // (data-turnstile, data-sitekey). Cloudflare's api.js loads with the page;
  // we wait for it, draw the widget, and keep its token. If the script never
  // loads (blocked), there is no token: the form still sends, the server says
  // no, and the visitor sees a plain message.
  var BLOCKED_MESSAGE = "Please turn on JavaScript or try another browser to send this form.";

  function setupTurnstile(form) {
    var box = form.querySelector("[data-turnstile]");
    var key = box ? (box.getAttribute("data-sitekey") || "").trim() : "";
    if (!box || !key) return;
    var state = { widgetId: null, token: "", failed: false, waiting: [] };
    form._turnstile = state;

    function flush() {
      var list = state.waiting;
      state.waiting = [];
      list.forEach(function (done) { done(); });
    }

    function render() {
      if (state.widgetId !== null) return true;
      if (!window.turnstile || typeof window.turnstile.render !== "function") return false;
      try {
        state.widgetId = window.turnstile.render(box, {
          sitekey: key,
          callback: function (token) { state.token = token; flush(); },
          "expired-callback": function () { state.token = ""; },
          "error-callback": function () { state.token = ""; state.failed = true; flush(); }
        });
      } catch (e) {
        state.failed = true;
        return true;
      }
      return true;
    }

    var tries = 0;
    var poll = window.setInterval(function () {
      tries += 1;
      if (render() || tries > 80) window.clearInterval(poll);
    }, 250);
    render();
  }

  // Resolves with the widget's token, or "" when there is none (script
  // blocked, widget failed, or no answer in 20 seconds).
  function humanCheck(form) {
    var state = form._turnstile;
    if (!state) return Promise.resolve("");
    return new Promise(function (resolve) {
      var timer = null;
      function finish() {
        if (timer) window.clearTimeout(timer);
        resolve(state.token || "");
      }
      if (state.token || state.failed || !window.turnstile) return finish();
      state.waiting.push(finish);
      timer = window.setTimeout(finish, 20000);
    });
  }

  // A token works once. After any send, get a fresh one.
  function resetHumanCheck(form) {
    var state = form._turnstile;
    if (!state) return;
    state.token = "";
    state.failed = false;
    try {
      if (state.widgetId !== null && window.turnstile) window.turnstile.reset(state.widgetId);
    } catch (e) {}
  }

  forms.forEach(function (form) {
    var status = form.querySelector(".form-status");
    var submitButton = form.querySelector('[type="submit"]');
    if (!status || !submitButton) return;
    var originalButtonText = submitButton.textContent;
    if (form.hasAttribute("data-human-check")) setupTurnstile(form);

    var countdown = null;
    var shownOnce = false; // the first message takes focus, later ticks do not

    function lockUntil(seconds) {
      if (countdown) countdown.stop();
      shownOnce = false;
      submitButton.disabled = true;
      countdown = window.BYMRetry.start(seconds, {
        onTick: function (text) { showStatus(status, "error", text, false, shownOnce); shownOnce = true; },
        onDone: function () {
          countdown = null;
          submitButton.disabled = false;
          showStatus(status, "success", "You can send your request again now.", false);
        }
      }, {
        now: function () { return Date.now(); },
        setInterval: function (fn, ms) { return window.setInterval(fn, ms); },
        clearInterval: function (id) { window.clearInterval(id); }
      });
    }

    form.addEventListener("invalid", function (event) {
      event.target.setAttribute("aria-invalid", "true");
    }, true);

    form.addEventListener("input", function (event) {
      if (event.target.matches("input, select, textarea") && event.target.checkValidity()) {
        event.target.removeAttribute("aria-invalid");
      }
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (countdown) return;

      if (!form.reportValidity()) {
        var firstInvalid = form.querySelector(":invalid");
        if (firstInvalid) firstInvalid.focus();
        pushEvent({ event: "form_validation_error", form_id: form.id });
        return;
      }

      var honeypot = form.elements.hp_field_2026;
      if (honeypot && honeypot.value) {
        form.reset();
        showStatus(status, "success", form.dataset.successMessage, false);
        return;
      }

      var endpoint = (form.dataset.endpoint || "").trim();
      if (!endpoint) {
        showStatus(
          status,
          "error",
          'This form is ready, but its API connection has not been added yet. Please email <a href="mailto:team@boostyourmaps.com">team@boostyourmaps.com</a> for now.',
          true
        );
        return;
      }

      var humanToken = "";
      if (form.hasAttribute("data-human-check")) {
        try { humanToken = (await humanCheck(form)) || ""; } catch (e) { humanToken = ""; }
      }

      form.setAttribute("aria-busy", "true");
      submitButton.disabled = true;
      submitButton.textContent = "Sending…";
      status.className = "form-status full";
      status.textContent = "";

      var controller = new AbortController();
      var timeout = window.setTimeout(function () {
        controller.abort();
      }, 12000);

      try {
        var response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(withToken(formPayload(form), humanToken)),
          credentials: "omit",
          signal: controller.signal
        });

        if (!response.ok) {
          var serverError = new Error("Submission failed");
          serverError.name = "ServerError";
          serverError.status = response.status;
          throw serverError;
        }

        var answer = null;
        try { answer = await response.json(); } catch (e) { answer = null; }

        if (answer && answer.report === "rate_limited" && window.BYMRetry) {
          // The lead is filed. The report was asked for too recently, so wait.
          lockUntil(Number(answer.retryAfterSeconds) > 0 ? Number(answer.retryAfterSeconds) : 1200);
          pushEvent({ event: "report_rate_limited", form_id: form.id });
          return;
        }

        form.reset();
        if (form.resetPlace) form.resetPlace();
        showStatus(status, "success", form.dataset.successMessage, false);
        pushEvent({ event: "generate_lead", form_id: form.id });
      } catch (error) {
        var message = error.name === "AbortError"
          ? "That took too long. Please try again, or email team@boostyourmaps.com."
          : "We could not send that just now. Please try again, or email team@boostyourmaps.com.";
        // No token and the server said no: the check could not run in this browser.
        if (error.name === "ServerError" && error.status === 400 && !humanToken && form._turnstile) {
          message = BLOCKED_MESSAGE;
        }
        showStatus(status, "error", message, false);
        pushEvent({
          event: "lead_form_error",
          form_id: form.id,
          error_type: error.name === "AbortError" ? "timeout" : error.name === "ServerError" ? "server" : "network"
        });
      } finally {
        window.clearTimeout(timeout);
        resetHumanCheck(form);
        form.removeAttribute("aria-busy");
        submitButton.textContent = originalButtonText;
        // Only the submit button waits out a countdown; the fields stay open.
        submitButton.disabled = Boolean(countdown);
      }
    });
  });
})();
