// Self-serve signup: the checkout forms on /get-started, /get-started/canada
// and /partners/signup, and the steps on /welcome after payment.
// The browser only calls this site's own /api/signup/* functions (the CSP
// allows nothing else); they talk to the BYM CRM. The welcome token lives in
// the URL hash (an inline script in <head> moves ?t= there before analytics
// loads) and only ever travels to the functions inside a POST body.
(function () {
  "use strict";

  var TOKEN = /^[0-9a-f]{64}$/;
  var TEAM_EMAIL = "team@boostyourmaps.com";
  var TIMEOUT_MS = 15000;

  window.dataLayer = window.dataLayer || [];

  function pushEvent(data) {
    data.page_path = window.location.pathname;
    window.dataLayer.push(data);
  }

  // ---- small helpers ---------------------------------------------------------

  // Calls a site function. Resolves { status, data }: status 0 for a network
  // failure, -1 for a timeout. Never throws.
  async function call(method, url, body) {
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    try {
      var response = await fetch(url, {
        method: method,
        headers: body ? { "Accept": "application/json", "Content-Type": "application/json" } : { "Accept": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal
      });
      var data = await response.json().catch(function () { return null; });
      return { status: response.status, data: data || {} };
    } catch (error) {
      return { status: error && error.name === "AbortError" ? -1 : 0, data: {} };
    } finally {
      window.clearTimeout(timer);
    }
  }

  function isHttpUrl(value) {
    return typeof value === "string" && /^https?:\/\//i.test(value);
  }

  // Puts a message into an element, turning the team address into a link.
  function setMessage(el, message) {
    el.textContent = "";
    var parts = String(message).split(TEAM_EMAIL);
    parts.forEach(function (part, i) {
      if (i > 0) {
        var a = document.createElement("a");
        a.href = "mailto:" + TEAM_EMAIL;
        a.textContent = TEAM_EMAIL;
        el.appendChild(a);
      }
      el.appendChild(document.createTextNode(part));
    });
  }

  function showStatus(status, type, message) {
    status.className = "form-status full is-visible is-" + type;
    setMessage(status, message);
    status.focus();
  }

  function hideStatus(status) {
    status.className = "form-status full";
    status.textContent = "";
  }

  function clearFieldErrors(form) {
    form.querySelectorAll(".su-error").forEach(function (el) { el.remove(); });
    form.querySelectorAll("[aria-invalid]").forEach(function (el) {
      el.removeAttribute("aria-invalid");
      var described = (el.getAttribute("aria-describedby") || "").split(" ").filter(function (id) { return id && id.indexOf("err-") !== 0; });
      if (described.length) el.setAttribute("aria-describedby", described.join(" ")); else el.removeAttribute("aria-describedby");
    });
  }

  // Points at one field: red outline, a short message under it, focus.
  function markField(field, message) {
    if (!field) return;
    var holder = field.closest("fieldset") || field.closest("div") || field.parentNode;
    var target = field.type === "radio" ? holder : field;
    var id = "err-" + (field.id || field.name || "field");
    var note = document.getElementById(id);
    if (!note) {
      note = document.createElement("p");
      note.className = "su-error";
      note.id = id;
      holder.appendChild(note);
    }
    note.textContent = message;
    target.setAttribute("aria-invalid", "true");
    var focusEl = field.type === "radio" ? holder.querySelector("input") : field;
    focusEl.setAttribute("aria-describedby", ((focusEl.getAttribute("aria-describedby") || "") + " " + id).trim());
    focusEl.focus();
  }

  function value(form, name) {
    var el = form.elements[name];
    return el && typeof el.value === "string" ? el.value.trim() : "";
  }

  // A named control; for a radio group, its first button.
  function fieldEl(form, name) {
    var el = form.elements[name];
    return el && !el.tagName && el.length ? el[0] : el;
  }

  var GENERIC_ERRORS = {
    "-1": "That took too long. Please try again, or email " + TEAM_EMAIL + ".",
    "0": "We could not reach our system just now. Check your connection and try again, or email " + TEAM_EMAIL + ".",
    rate_limited: "Too many tries in a row. Please wait a minute and try again."
  };

  // ==========================================================================
  // Checkout forms: /get-started, /get-started/canada, /partners/signup
  // ==========================================================================

  var START_FIELDS = {
    plan: ["locations", "Something went wrong with this page. Please reload it and try again."],
    partner: ["partner", "Please choose your agency."],
    firstName: ["first_name", "Please enter your first name."],
    lastName: ["last_name", "Please check the last name."],
    email: ["email", "Please enter a valid email address."],
    phone: ["phone", "Please check the phone number, or leave it blank."],
    businessName: ["business_name", "Please enter the business name."],
    websiteUrl: ["website", "Please check the website address, or leave it blank."],
    quantity: ["locations", "Please pick the number of locations."]
  };

  function initStart(form) {
    var plan = form.dataset.plan;
    var price = Number(form.dataset.price);
    var suffix = form.dataset.totalSuffix || "";
    var select = form.elements.locations;
    var total = form.querySelector("[data-total]");
    var status = form.querySelector(".form-status");
    var button = form.querySelector('[type="submit"]');
    var buttonText = button.textContent;
    var partnerSelect = form.elements.partner || null;

    function updateTotal() {
      var n = Number(select.value) || 1;
      total.textContent = "Your total: $" + (price * n).toLocaleString("en-US") + " a month" + suffix +
        (n > 1 ? " (" + n + " locations at $" + price + " each)" : "");
    }
    select.addEventListener("change", updateTotal);
    updateTotal();

    function resetButton() {
      button.disabled = false;
      button.textContent = buttonText;
      form.removeAttribute("aria-busy");
    }
    // Coming back from Stripe with the Back button restores this page from
    // the browser's cache with the button still busy.
    window.addEventListener("pageshow", function (event) {
      if (event.persisted) resetButton();
    });

    form.addEventListener("input", function (event) {
      if (event.target.getAttribute("aria-invalid")) {
        var note = document.getElementById("err-" + (event.target.id || event.target.name));
        if (note) note.remove();
        event.target.removeAttribute("aria-invalid");
      }
    });

    if (partnerSelect) loadPartners(form, partnerSelect, button);

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      clearFieldErrors(form);
      hideStatus(status);

      if (partnerSelect && partnerSelect.disabled) {
        showStatus(status, "error", "Ask your Boost Your Maps contact for your signup link.");
        return;
      }
      var checks = [
        [partnerSelect && !partnerSelect.value, "partner"],
        [!value(form, "first_name"), "firstName"],
        [!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value(form, "email")), "email"],
        [!value(form, "business_name"), "businessName"]
      ];
      for (var i = 0; i < checks.length; i++) {
        if (checks[i][0]) {
          var spec = START_FIELDS[checks[i][1]];
          markField(fieldEl(form, spec[0]), spec[1]);
          pushEvent({ event: "form_validation_error", form_id: form.id });
          return;
        }
      }

      form.setAttribute("aria-busy", "true");
      button.disabled = true;
      button.textContent = "Opening checkout…";

      var result = await call("POST", "/api/signup/start", {
        plan: plan,
        partner: partnerSelect ? partnerSelect.value : null,
        first_name: value(form, "first_name"),
        last_name: value(form, "last_name"),
        email: value(form, "email"),
        phone: value(form, "phone"),
        business_name: value(form, "business_name"),
        website: value(form, "website"),
        locations: Number(select.value) || 1,
        page_url: window.location.href,
        hp_field_2026: value(form, "hp_field_2026")
      });

      if (result.status === 200 && result.data.ok === true && isHttpUrl(result.data.checkoutUrl)) {
        pushEvent({ event: "begin_checkout", signup_plan: plan, quantity: Number(select.value) || 1 });
        window.location.assign(result.data.checkoutUrl);
        return;
      }

      resetButton();
      var error = result.data.error;
      pushEvent({ event: "signup_error", form_id: form.id, error_type: error || String(result.status) });

      if (error === "invalid_input" && START_FIELDS[result.data.field]) {
        var field = START_FIELDS[result.data.field];
        markField(fieldEl(form, field[0]), field[1]);
      } else if (error === "partner_unknown" && partnerSelect) {
        markField(partnerSelect, "We don't recognize that agency. Ask your Boost Your Maps contact for your signup link.");
      } else if (error === "signup_unavailable" || result.status === 503) {
        showStatus(status, "error", "Checkout is not available right now. Email " + TEAM_EMAIL + " and we'll send you a link.");
      } else if (GENERIC_ERRORS[error] || GENERIC_ERRORS[String(result.status)]) {
        showStatus(status, "error", GENERIC_ERRORS[error] || GENERIC_ERRORS[String(result.status)]);
      } else if (error === "invalid_input") {
        showStatus(status, "error", "Something in the form doesn't look right. Please check it and try again.");
      } else {
        showStatus(status, "error", "We could not open checkout just now. Please try again, or email " + TEAM_EMAIL + ".");
      }
    });
  }

  // The agency dropdown on /partners/signup. ?partner=<slug> picks one.
  async function loadPartners(form, select, button) {
    var missing = form.querySelector("[data-partner-missing]");
    var wanted = new URLSearchParams(window.location.search).get("partner");
    var result = await call("GET", "/api/signup/partners");
    var list = result.status === 200 && result.data.ok === true && Array.isArray(result.data.partners) ? result.data.partners : [];

    select.textContent = "";
    if (!list.length) {
      var none = document.createElement("option");
      none.value = "";
      none.textContent = "No agencies to choose from";
      select.appendChild(none);
      select.disabled = true;
      button.disabled = true;
      missing.hidden = false;
      select.setAttribute("aria-describedby", "partner-missing");
      missing.id = "partner-missing";
      return;
    }

    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose your agency";
    select.appendChild(placeholder);
    list.forEach(function (partner) {
      var option = document.createElement("option");
      option.value = partner.slug;
      option.textContent = partner.name;
      if (partner.slug === wanted) option.selected = true;
      select.appendChild(option);
    });
    select.disabled = false;
  }

  // ==========================================================================
  // /welcome: payment, access, questions, launch call
  // ==========================================================================

  var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';

  var INTAKE_FIELDS = {
    profileLinks: ["profile_link_1", "Please paste the Google Business Profile link (500 characters at most)."],
    websiteUrl: ["websiteUrl", "Please check the website address, or leave it blank."],
    mainService: ["mainService", "Please tell us which service to grow."],
    leadPreference: ["leadPreference", "Please pick how new customers should get in touch."],
    targetArea: ["targetArea", "Please keep this to 500 characters or fewer."],
    notes: ["notes", "Please keep this to 2,000 characters or fewer."],
    photosUrl: ["photosUrl", "Please paste a link that starts with https://, or leave it blank."],
    approval: ["approval", "Please pick how you want to approve the changes."]
  };

  // FNV-1a, 32 bits, as 8 hex characters.
  function shortHash(text) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return ("0000000" + hash.toString(16)).slice(-8);
  }

  function tokenFromUrl() {
    var match = window.location.hash.match(/(?:^#|&)t=([^&]*)/);
    var raw = match ? match[1] : new URLSearchParams(window.location.search).get("t");
    try { return raw ? decodeURIComponent(raw) : ""; } catch (e) { return ""; }
  }

  function initWelcome(root) {
    var token = tokenFromUrl();
    var signup = null;
    var editing = false;
    var prefilled = false;

    // Steps the buyer folded away on this device without telling the CRM
    // ("I'll do this later", an agency's "Skip this step"), kept for this tab
    // so a reload keeps them folded. The key is a short hash of the token, never
    // the token. Without storage the page still works; the fold just doesn't
    // survive a reload.
    var localKey = "bym-welcome-" + shortHash(token);
    var local = readLocal();

    function readLocal() {
      try {
        var saved = JSON.parse(window.sessionStorage.getItem(localKey) || "{}");
        return saved && typeof saved === "object" ? saved : {};
      } catch (e) {
        return {};
      }
    }

    function writeLocal() {
      try {
        window.sessionStorage.setItem(localKey, JSON.stringify(local));
      } catch (e) { /* storage blocked: fine */ }
    }
    var pollDeadline = 0;
    var pollTimer = null;

    var $ = function (sel) { return root.querySelector(sel); };
    var loading = $("[data-w-loading]");
    var problem = $("[data-w-problem]");
    var problemText = $("[data-w-problem-text]");
    var retry = $("[data-w-retry]");
    var stepsEl = $("[data-w-steps]");
    var help = $("[data-w-help]");
    var intakeForm = document.getElementById("intake-form");
    var titleEl = document.querySelector("[data-w-title]");
    var leadEl = document.querySelector("[data-w-lead]");

    function showProblem(message, canRetry) {
      loading.hidden = true;
      stepsEl.hidden = true;
      problem.hidden = false;
      setMessage(problemText, message);
      retry.hidden = !canRetry;
      problem.focus();
    }

    function problemFor(result) {
      if (result.status === 404 || result.data.error === "signup_not_found") {
        showProblem("We can't find this signup. The link may be missing a piece. Email " + TEAM_EMAIL + " and we'll send you the right link.", false);
      } else if (result.data.error === "rate_limited") {
        showProblem(GENERIC_ERRORS.rate_limited, true);
      } else {
        showProblem("We can't load your signup right now. Please try again in a minute, or email " + TEAM_EMAIL + ".", true);
      }
    }

    async function load() {
      problem.hidden = true;
      loading.hidden = false;
      var result = await call("POST", "/api/signup/status", { t: token });
      loading.hidden = true;
      if (result.status === 200 && result.data.ok === true && result.data.signup) {
        signup = result.data.signup;
        if (!signup.paid) startPolling();
        render();
      } else {
        problemFor(result);
      }
    }

    retry.addEventListener("click", load);

    // ---- payment: poll every 3 seconds for up to a minute ----

    function startPolling() {
      pollDeadline = Date.now() + 60000;
      $("[data-pay-slow]").hidden = true;
      $("[data-pay-wait]").hidden = false;
      window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(poll, 3000);
    }

    async function poll() {
      var result = await call("POST", "/api/signup/status", { t: token });
      if (result.status === 200 && result.data.ok === true && result.data.signup) {
        signup = result.data.signup;
        if (signup.paid) {
          pushEvent({ event: "signup_step", signup_step: "payment_received", signup_plan: signup.plan });
          render();
          var accessTitle = root.querySelector('[data-step="access"] .su-step-title');
          if (accessTitle) { accessTitle.setAttribute("tabindex", "-1"); accessTitle.focus(); }
          return;
        }
      } else if (result.status === 404) {
        problemFor(result);
        return;
      }
      if (Date.now() < pollDeadline) {
        pollTimer = window.setTimeout(poll, 3000);
      } else {
        $("[data-pay-wait]").hidden = true;
        $("[data-pay-slow]").hidden = false;
      }
    }

    $("[data-pay-again]").addEventListener("click", function () {
      startPolling();
      window.clearTimeout(pollTimer);
      poll();
    });

    // ---- access ----

    var accessStatus = $("[data-access-status]");
    var accessConfirm = $("[data-access-confirm]");
    var accessSkip = $("[data-access-skip]");
    var accessLater = $("[data-access-later]");

    // After the access step folds, move focus to whatever is still to do.
    function focusAfterAccess() {
      focusStep(signup.intakeDone ? "call" : "intake");
    }

    // "I've added you": the only access action the CRM hears about (it turns
    // it into a team task to accept the invite).
    async function sendAccess() {
      hideStatus(accessStatus);
      accessConfirm.disabled = true;
      var result = await call("POST", "/api/signup/access", { t: token });
      accessConfirm.disabled = false;
      if (result.status === 200 && result.data.ok === true) {
        signup.accessConfirmed = true;
        delete local.access;
        writeLocal();
        pushEvent({ event: "signup_step", signup_step: "access_added", signup_plan: signup.plan });
        render();
        focusAfterAccess();
      } else if (result.status === 404) {
        problemFor(result);
      } else {
        showStatus(accessStatus, "error", GENERIC_ERRORS[result.data.error] || GENERIC_ERRORS[String(result.status)] ||
          "We could not save that just now. Please try again, or email " + TEAM_EMAIL + ".");
      }
    }

    // "I'll do this later" and the agency's "Skip this step" only fold the
    // step on this device. No CRM call: for a client we already manage, an
    // "accept the invite" task would be wrong.
    function foldAccess(kind) {
      hideStatus(accessStatus);
      local.access = kind;
      writeLocal();
      pushEvent({ event: "signup_step", signup_step: kind === "skipped" ? "access_skipped" : "access_later", signup_plan: signup.plan });
      render();
      focusAfterAccess();
    }

    accessConfirm.addEventListener("click", sendAccess);
    accessLater.addEventListener("click", function () { foldAccess("later"); });
    accessSkip.addEventListener("click", function () { foldAccess("skipped"); });
    $("[data-access-reopen]").addEventListener("click", function () {
      delete local.access;
      writeLocal();
      render();
      focusStep("access");
    });

    $("[data-copy]").addEventListener("click", async function (event) {
      var button = event.currentTarget;
      var email = $("[data-access-email]");
      try {
        await navigator.clipboard.writeText(email.textContent);
        button.textContent = "Copied";
      } catch (e) {
        var range = document.createRange();
        range.selectNodeContents(email);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = "Selected. Press copy.";
      }
      window.setTimeout(function () { button.textContent = "Copy email"; }, 2500);
    });

    // ---- questions ----

    function buildProfileLinks() {
      var holder = $("[data-profile-links]");
      if (holder.dataset.count === String(signup.quantity)) return;
      holder.dataset.count = String(signup.quantity);
      holder.textContent = "";
      var partner = signup.plan === "partner";
      for (var i = 1; i <= signup.quantity; i++) {
        var wrap = document.createElement("div");
        if (i > 1) wrap.style.marginTop = "16px";
        var label = document.createElement("label");
        label.htmlFor = "profile_link_" + i;
        label.textContent = (signup.quantity > 1 ? "Location " + i + ": " : "") + "Google Business Profile link" + (i > 1 ? " (optional)" : " ");
        if (i === 1) {
          var star = document.createElement("span");
          star.textContent = "*";
          label.appendChild(star);
        }
        var input = document.createElement("input");
        input.type = "text";
        input.inputMode = "url";
        input.id = "profile_link_" + i;
        input.name = "profile_link_" + i;
        input.maxLength = 500;
        input.autocomplete = "off";
        if (i === 1) {
          input.required = true;
          input.setAttribute("aria-describedby", "profile_link_help");
        }
        wrap.appendChild(label);
        wrap.appendChild(input);
        if (i === 1) {
          var tip = document.createElement("p");
          tip.className = "su-help";
          tip.id = "profile_link_help";
          tip.textContent = partner
            ? "Search your client's business on Google Maps, tap Share, copy the link."
            : "Search your business on Google Maps, tap Share, copy the link.";
          wrap.appendChild(tip);
        }
        holder.appendChild(wrap);
      }
    }

    // Earlier answers (or the website from checkout) from the CRM, filled in
    // once per visit so a returning buyer sees what they sent.
    function fillFromPrefill() {
      if (prefilled) return;
      prefilled = true;
      var p = signup.prefill || {};
      var set = function (name, v) {
        var el = intakeForm.elements[name];
        if (el && typeof v === "string" && v && !el.value) el.value = v;
      };
      (Array.isArray(p.profileLinks) ? p.profileLinks : []).forEach(function (link, i) {
        set("profile_link_" + (i + 1), link);
      });
      set("websiteUrl", p.websiteUrl);
      set("mainService", p.mainService);
      set("targetArea", p.targetArea);
      set("notes", p.notes);
      set("photosUrl", p.photosUrl);
      [["leadPreference", p.leadPreference], ["approval", p.approval]].forEach(function (pair) {
        if (!pair[1]) return;
        var radio = intakeForm.querySelector('input[name="' + pair[0] + '"][value="' + pair[1] + '"]');
        if (radio) radio.checked = true;
      });
    }

    function setLabel(key, text, required) {
      var el = intakeForm.querySelector('[data-q="' + key + '"]');
      if (!el) return;
      el.textContent = text + (required ? " " : "");
      if (required) {
        var star = document.createElement("span");
        star.textContent = "*";
        el.appendChild(star);
      }
    }

    function applyPartnerCopy() {
      if (signup.plan !== "partner") return;
      $("[data-intake-intro]").textContent = "We pull the rest, like target keywords, FAQs and categories, from the profile and website.";
      setLabel("website", "Client's website (optional)");
      setLabel("service", "Which service does your client want more customers for?", true);
      setLabel("lead", "How should new customers reach your client?", true);
      setLabel("area", "Want customers from somewhere other than your client's city? (optional)");
      setLabel("area-help", "Leave it blank and we'll target the area around their address.");
      setLabel("notes-help", "For example, services missing from the profile, an offer they run, or their busy seasons.");
      intakeForm.querySelector("[data-approval]").hidden = false;
      intakeForm.querySelector('input[name="approval"]').required = true;
    }

    intakeForm.addEventListener("input", function (event) {
      var target = event.target.type === "radio" ? event.target.closest("fieldset") : event.target;
      if (target && target.getAttribute("aria-invalid")) {
        var note = target.querySelector ? target.querySelector(".su-error") : null;
        var own = document.getElementById("err-" + (event.target.id || event.target.name));
        if (own) own.remove();
        if (note) note.remove();
        target.removeAttribute("aria-invalid");
      }
    });

    intakeForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var status = intakeForm.querySelector(".form-status");
      var button = intakeForm.querySelector('[type="submit"]');
      clearFieldErrors(intakeForm);
      hideStatus(status);

      var partner = signup.plan === "partner";
      var links = [];
      for (var i = 1; i <= signup.quantity; i++) {
        var link = value(intakeForm, "profile_link_" + i);
        if (link) links.push(link);
      }
      var lead = intakeForm.querySelector('input[name="leadPreference"]:checked');
      var approval = intakeForm.querySelector('input[name="approval"]:checked');

      var problems = [
        [!value(intakeForm, "profile_link_1"), "profileLinks"],
        [!value(intakeForm, "mainService"), "mainService"],
        [!lead, "leadPreference"],
        [partner && !approval, "approval"]
      ];
      for (var p = 0; p < problems.length; p++) {
        if (problems[p][0]) {
          var spec = INTAKE_FIELDS[problems[p][1]];
          markField(fieldEl(intakeForm, spec[0]), spec[1]);
          return;
        }
      }

      intakeForm.setAttribute("aria-busy", "true");
      button.disabled = true;
      var buttonText = button.textContent;
      button.textContent = "Saving…";

      var answers = {
        profileLinks: links,
        websiteUrl: value(intakeForm, "websiteUrl") || null,
        mainService: value(intakeForm, "mainService"),
        leadPreference: lead.value,
        targetArea: value(intakeForm, "targetArea") || null,
        notes: value(intakeForm, "notes") || null,
        photosUrl: value(intakeForm, "photosUrl") || null,
        approval: partner ? approval.value : "call"
      };
      var result = await call("POST", "/api/signup/intake", Object.assign({ t: token }, answers));

      intakeForm.removeAttribute("aria-busy");
      button.disabled = false;
      button.textContent = buttonText;

      if (result.status === 200 && result.data.ok === true) {
        signup.intakeDone = true;
        editing = false;
        signup.prefill = answers;
        pushEvent({ event: "signup_step", signup_step: "intake_saved", signup_plan: signup.plan });
        render();
        focusStep("call");
        return;
      }
      if (result.status === 404) return problemFor(result);
      var error = result.data.error;
      if (error === "invalid_input" && INTAKE_FIELDS[result.data.field]) {
        var field = INTAKE_FIELDS[result.data.field];
        markField(fieldEl(intakeForm, field[0]), field[1]);
      } else {
        showStatus(status, "error", GENERIC_ERRORS[error] || GENERIC_ERRORS[String(result.status)] ||
          (error === "invalid_input" ? "Something in the form doesn't look right. Please check it and try again." :
            "We could not save your answers just now. Please try again, or email " + TEAM_EMAIL + "."));
      }
    });

    $("[data-intake-edit]").addEventListener("click", function () {
      editing = true;
      render();
      focusStep("intake");
    });

    // ---- launch call ----

    function renderCall() {
      var box = $("[data-call-open]");
      var title = $("[data-call-title]");
      box.textContent = "";
      var partner = signup.plan === "partner";
      var approval = signup.prefill && signup.prefill.approval;
      var p = document.createElement("p");
      box.appendChild(p);

      if (partner && approval === "email") {
        title.textContent = "Launch call";
        p.textContent = "No call needed. We'll email the changes for your approval within 48 hours.";
        return "done";
      }
      title.textContent = isHttpUrl(signup.bookingUrl) ? "Book your launch call" : "Launch call";
      if (!isHttpUrl(signup.bookingUrl)) {
        p.textContent = partner && !approval
          ? "We'll email you about the next step."
          : "We'll email you to set a time.";
        return "done";
      }
      var link = document.createElement("a");
      link.href = signup.bookingUrl;
      link.textContent = "Book your launch call →";
      var wrap = document.createElement("p");
      wrap.style.marginTop = "18px";
      wrap.appendChild(link);
      if (partner && !approval) {
        p.textContent = "If you asked for a call, book it here. Pick a time at least 24 hours from now. If you picked email, there's nothing to book. We'll email the changes for your approval within 48 hours.";
        link.className = "tlink";
      } else {
        p.textContent = "Pick a time at least 24 hours from now. Same-day calls aren't available.";
        link.className = "btn btn-primary";
      }
      box.appendChild(wrap);
      return "active";
    }

    // ---- drawing the steps from the signup's state ----

    // state: "next" (waiting on payment), "open", "active" (the first open
    // step, red numeral), "later" (folded, not done) or "done" (green check).
    function setStep(name, state, number) {
      var li = root.querySelector('[data-step="' + name + '"]');
      li.classList.toggle("is-active", state === "active");
      li.classList.toggle("is-open", state === "open" || state === "later");
      li.classList.toggle("is-done", state === "done");
      li.querySelector(".pin").innerHTML = state === "done" ? CHECK_SVG : "<span>" + number + "</span>";
    }

    function focusStep(name) {
      var heading = root.querySelector('[data-step="' + name + '"] .su-step-title');
      if (!heading) return;
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }

    function render() {
      var partner = signup.plan === "partner";
      stepsEl.hidden = false;
      help.hidden = false;
      problem.hidden = true;

      if (partner) {
        titleEl.textContent = signup.businessName ? "Let's set up " + signup.businessName : "Let's set up your client";
        leadEl.textContent = (signup.partnerName ? "Thanks, " + signup.partnerName + ". " : "") +
          "Three short steps and we can start the GBP marketing for your client.";
      } else {
        titleEl.textContent = signup.firstName ? "Welcome, " + signup.firstName : "Welcome to Boost Your Maps";
        leadEl.textContent = "Three short steps and we can start work on " + (signup.businessName || "your profile") + ".";
      }

      // 1. Payment
      $("[data-pay-done]").hidden = !signup.paid;
      if (signup.paid) {
        window.clearTimeout(pollTimer);
        $("[data-pay-wait]").hidden = true;
        $("[data-pay-slow]").hidden = true;
      }
      var states = { pay: signup.paid ? "done" : "active" };

      // 2. Access and 3. Questions open together once paid; neither waits for
      // the other.
      var accessEmail = signup.accessEmail || TEAM_EMAIL;
      var fold = signup.accessConfirmed ? "confirmed"
        : local.access === "skipped" && partner ? "skipped"
        : local.access === "later" ? "later" : null;
      var accessOpen = signup.paid && !fold;
      $("[data-access-next]").hidden = signup.paid;
      $("[data-access-open]").hidden = !accessOpen;
      $("[data-access-closed]").hidden = !(signup.paid && fold);
      $("[data-access-reopen]").hidden = fold !== "later" && fold !== "skipped";
      $("[data-access-closed-text]").textContent =
        fold === "skipped" ? "Done. You told us we already have access."
        : fold === "later" ? "No problem. Add " + accessEmail + " as a Manager when you can. We need it before we can change the profile."
        : "Done. We'll accept the invite on our side.";
      if (accessOpen) {
        $("[data-access-email]").textContent = signup.accessEmail || TEAM_EMAIL;
        $("[data-access-intro]").textContent = partner
          ? "Add " + (signup.accessEmail || TEAM_EMAIL) + " as a Manager on your client's Google Business Profile. The address is generic on purpose, so your client never sees our name."
          : "Add " + (signup.accessEmail || TEAM_EMAIL) + " as a Manager on your Google Business Profile. This lets us make the changes for you. You stay the owner.";
        accessSkip.hidden = !partner;
      }
      states.access = !signup.paid ? "next" : fold === "later" ? "later" : fold ? "done" : "open";

      var intakeReady = signup.paid;
      var intakeOpen = intakeReady && (!signup.intakeDone || editing);
      $("[data-intake-next]").hidden = intakeReady;
      $("[data-intake-open]").hidden = !intakeOpen;
      $("[data-intake-done]").hidden = !(intakeReady && signup.intakeDone && !editing);
      if (intakeOpen) {
        buildProfileLinks();
        applyPartnerCopy();
        fillFromPrefill();
      }
      states.intake = !intakeReady ? "next" : intakeOpen ? "open" : "done";

      // 4. Launch call, once the questions are answered.
      var callReady = intakeReady && signup.intakeDone && !editing;
      $("[data-call-next]").hidden = callReady;
      $("[data-call-open]").hidden = !callReady;
      states.call = callReady ? (renderCall() === "active" ? "open" : "done") : "next";

      // One red numeral: only the first open step is "active".
      var order = ["pay", "access", "intake", "call"];
      var first = order.filter(function (name) { return states[name] === "open" || states[name] === "active"; })[0];
      order.forEach(function (name, i) {
        var state = states[name];
        if (state === "active" || state === "open") state = name === first ? "active" : "open";
        setStep(name, state, i + 1);
      });
    }

    if (!TOKEN.test(token)) {
      showProblem("We can't find this signup. The link may be missing a piece. Email " + TEAM_EMAIL + " and we'll send you the right link.", false);
      return;
    }
    load();
  }

  // ---- start ----
  var startForm = document.querySelector("form[data-signup-form]");
  if (startForm) initStart(startForm);
  var welcome = document.querySelector("[data-welcome]");
  if (welcome) initWelcome(welcome);
})();
