// The private agreement page at /agreement#t=<token>. A lead the CRM sent the
// link to reads the service agreement (their details filled in), signs it with
// their typed name and goes straight to Stripe to pay. Stripe sends them back
// to /agreement?paid=1#t=<token>, or to /agreement#t=<token> on cancel.
//
// The browser only calls this site's own /api/agreement/* functions (the CSP
// allows nothing else); they talk to the BYM CRM. The token lives in the URL
// hash (an inline script in <head> moves ?t= there and reads ?paid=1, both
// before analytics loads) and only ever travels inside POST bodies. Every word
// from the CRM is set as text, never as HTML.
(function () {
  "use strict";

  var TOKEN = /^[0-9a-f]{64}$/;
  var TEAM_EMAIL = "team@boostyourmaps.com";
  var CHECKOUT_PREFIX = "https://checkout.stripe.com/";
  var TIMEOUT_MS = 15000;
  // Signing makes a PDF and a Stripe session; the site function waits up to
  // 10 seconds for the CRM.
  var SIGN_TIMEOUT_MS = 20000;
  // After Stripe: look again every 3 seconds for up to 30 seconds.
  var POLL_MS = 3000;
  var POLL_FOR_MS = 30000;

  var root = document.querySelector("[data-agreement]");
  if (!root) return;
  var $ = function (sel) { return root.querySelector(sel); };

  window.dataLayer = window.dataLayer || [];

  function pushEvent(data) {
    data.page_path = window.location.pathname;
    window.dataLayer.push(data);
  }

  // ---- messages ---------------------------------------------------------------

  var NOT_FOUND = "We can't find this agreement. The link may be missing a piece. Email " + TEAM_EMAIL + " and we'll send you the right link.";
  var VOIDED = "This agreement isn't active anymore. If you still want to sign up, email " + TEAM_EMAIL + ".";
  var EXPIRED = "This agreement link has expired. Email " + TEAM_EMAIL + " and we'll send you a new one.";
  var LOAD_FAILED = "We can't load your agreement right now. Please try again in a minute, or email " + TEAM_EMAIL + ".";
  var PAY_FAILED = "We couldn't open the payment page just now. Please try again in a minute, or email " + TEAM_EMAIL + ".";
  var CHECK_FORM = "Something in the form doesn't look right. Please check it and try again.";
  var GENERIC_ERRORS = {
    "-1": "That took too long. Please try again, or email " + TEAM_EMAIL + ".",
    "0": "We could not reach our system just now. Check your connection and try again, or email " + TEAM_EMAIL + ".",
    rate_limited: "Too many tries in a row. Please wait a minute and try again."
  };

  // The sign form's fields as the CRM names them: [input name, message].
  var SIGN_FIELDS = {
    legalName: ["legal_name", "Please check the business name."],
    signatoryName: ["signatory_name", "Please check your name. Type your full name to sign."],
    consent: ["consent", "Please check the box to agree."]
  };

  // ---- small helpers ----------------------------------------------------------

  // POSTs JSON to a site function. Resolves { status, data }: status 0 for a
  // network failure, -1 for a timeout. Never throws.
  async function call(url, body, timeoutMs) {
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, timeoutMs || TIMEOUT_MS);
    try {
      var response = await fetch(url, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal
      });
      var data = await response.json().catch(function () { return null; });
      return { status: response.status, data: data && typeof data === "object" ? data : {} };
    } catch (error) {
      return { status: error && error.name === "AbortError" ? -1 : 0, data: {} };
    } finally {
      window.clearTimeout(timer);
    }
  }

  function loaded(result) {
    return result.status === 200 && result.data.ok === true && result.data.agreement && typeof result.data.agreement === "object";
  }

  // Puts a message into an element, turning the team address into a link.
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

  function showStatus(status, message) {
    status.className = "form-status full is-visible is-error";
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
    var holder = field.closest("div");
    var id = "err-" + field.id;
    var note = document.getElementById(id);
    if (!note) {
      note = document.createElement("p");
      note.className = "su-error";
      note.id = id;
      holder.appendChild(note);
    }
    note.textContent = message;
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", ((field.getAttribute("aria-describedby") || "") + " " + id).trim());
    field.focus();
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function setText(sel, text) {
    var node = $(sel);
    node.textContent = text || "";
    node.hidden = !text;
  }

  // "2026-10-27T19:05:09.000Z" -> "October 27, 2026", in the reader's time zone.
  function formatDate(iso) {
    var date = iso ? new Date(iso) : null;
    if (!date || isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  // FNV-1a, 32 bits, as 8 hex characters: the storage key, never the token.
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

  // ---- page parts -------------------------------------------------------------

  var token = tokenFromUrl();
  var agreement = null;
  var builtFor = null; // the status the summary and the agreement were drawn for
  var viewSent = false;
  var busy = false;
  var pollTimer = null;
  var pollDeadline = 0;
  var confirmSlow = false;

  var loading = $("[data-a-loading]");
  var problem = $("[data-a-problem]");
  var problemText = $("[data-a-problem-text]");
  var retry = $("[data-a-retry]");
  var content = $("[data-a-content]");
  var help = $("[data-a-help]");
  var stateEl = $("[data-a-state]");
  var doc = $("[data-a-doc]");
  var form = document.getElementById("sign-form");
  var formStatus = form.querySelector(".form-status");
  var signButton = form.querySelector('[type="submit"]');
  var signButtonText = signButton.textContent;
  var payButton = $("[data-pay]");
  var payButtonText = payButton.textContent;
  var payStatus = $("[data-pay-status]");
  var titleEl = document.querySelector("[data-a-title]");
  var leadEl = document.querySelector("[data-a-lead]");

  // Stripe's return (?paid=1), kept for this tab under a short hash of the
  // token: a reload while the payment is confirmed must not offer "Continue to
  // payment" again. The head script read and removed it from the address.
  var paidKey = "bym-agreement-" + shortHash(token);
  var paidReturn = readPaidReturn();

  function readPaidReturn() {
    var fromStripe = window.__bymAgreementPaid === true;
    if (window.__bymAgreementPaid === undefined) {
      // The head script could not run: read and remove it here.
      try {
        var url = new URL(window.location.href);
        if (url.searchParams.has("paid")) {
          fromStripe = url.searchParams.get("paid") === "1";
          url.searchParams.delete("paid");
          window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        }
      } catch (e) { /* the page still works */ }
    }
    try {
      if (fromStripe) window.sessionStorage.setItem(paidKey, "1");
      return fromStripe || window.sessionStorage.getItem(paidKey) === "1";
    } catch (e) {
      return fromStripe;
    }
  }

  function forgetPaidReturn() {
    paidReturn = false;
    try { window.sessionStorage.removeItem(paidKey); } catch (e) { /* fine */ }
  }

  function showProblem(message, canRetry) {
    window.clearTimeout(pollTimer);
    loading.hidden = true;
    content.hidden = true;
    help.hidden = true;
    titleEl.textContent = "Your service agreement";
    leadEl.hidden = true;
    problem.hidden = false;
    setMessage(problemText, message);
    retry.hidden = !canRetry;
    problem.focus();
  }

  function problemFor(result) {
    if (result.status === 404 || result.data.error === "agreement_not_found") showProblem(NOT_FOUND, false);
    else if (result.data.error === "rate_limited") showProblem(GENERIC_ERRORS.rate_limited, true);
    else showProblem(LOAD_FAILED, true);
  }

  // The business on the agreement: the legal name it was signed under, else
  // the name the CRM has.
  function clientName(a) {
    return a.legalName || a.businessName || "";
  }

  // "Ana Ruiz signed for Ruiz Pest Control LLC on October 27, 2026."
  function signedLine(a) {
    var date = formatDate(a.signedAt);
    if (!a.signatoryName && !a.legalName && !date) return "";
    return (a.signatoryName ? a.signatoryName + " signed" : "Signed") +
      (a.legalName ? " for " + a.legalName : "") + (date ? " on " + date : "") + ".";
  }

  // "$900 per month": the amount large, the rest small, like the prices on
  // the signup pages. A price in another shape is shown as it is.
  function fillPrice(holder, price) {
    holder.textContent = "";
    holder.hidden = !price;
    if (!price) return;
    var parts = /^([^\s\d]*\s?\d[\d,.]*)\s+(.+)$/.exec(price);
    holder.appendChild(document.createTextNode(parts ? parts[1] : price));
    if (parts) holder.appendChild(el("span", null, " " + parts[2]));
  }

  // "Month to month. Cancel with 7 days' written notice." with the first
  // sentence in bold, as on the signup pages.
  function fillTerms(holder, terms) {
    holder.textContent = "";
    holder.hidden = !terms;
    if (!terms) return;
    var cut = terms.indexOf(". ");
    if (cut < 0) {
      holder.textContent = terms;
      return;
    }
    holder.appendChild(el("strong", null, terms.slice(0, cut + 1)));
    holder.appendChild(document.createTextNode(terms.slice(cut + 1)));
  }

  function fillSummary(a) {
    var signable = a.status === "sent" || a.status === "viewed";
    setText("[data-sum-business]", clientName(a));
    setText("[data-sum-service]", a.service);
    fillPrice($("[data-sum-total]"), a.totalPrice);
    var count = a.locations ? a.locations + (a.locations === 1 ? " location" : " locations") : "";
    setText("[data-sum-calc]", count && a.unitPrice ? count + " at " + a.unitPrice : count);
    fillTerms($("[data-sum-terms]"), a.summary);
    var expires = formatDate(a.expiresAt);
    setText("[data-sum-expires]", signable && expires ? "Please sign by " + expires + "." : "");
  }

  // One party: a label, then lines with no gaps, the name in bold.
  function party(label, lines) {
    var box = el("div", "ag-party");
    box.appendChild(el("p", "ag-label", label));
    var p = el("p", "ag-lines");
    lines.filter(Boolean).forEach(function (line, i) {
      if (i > 0) p.appendChild(document.createElement("br"));
      p.appendChild(i === 0 ? el("strong", null, line) : document.createTextNode(line));
    });
    box.appendChild(p);
    return box;
  }

  // The full agreement: title, the two parties, the order, every section,
  // and the signature once there is one.
  function buildDoc(a) {
    doc.textContent = "";
    var title = el("h2", null, a.title || "Service Agreement");
    title.id = "ag-doc-title";
    doc.appendChild(title);
    if (a.version) doc.appendChild(el("p", "ag-doc-meta", "Version " + a.version));

    var parties = el("div", "ag-parties");
    parties.appendChild(party("Client", [clientName(a), a.contactName, a.email]));
    parties.appendChild(party("Provider", [a.provider.name].concat(a.provider.lines)));
    doc.appendChild(parties);

    var rows = [
      ["Service", a.service],
      ["Locations", a.locations ? String(a.locations) : ""],
      ["Price per location", a.unitPrice],
      ["Monthly total", a.totalPrice]
    ].filter(function (row) { return row[1]; });
    if (rows.length) {
      var order = el("div", "ag-order");
      order.appendChild(el("p", "ag-label", "Order"));
      var dl = el("dl");
      rows.forEach(function (row) {
        var line = el("div");
        line.appendChild(el("dt", null, row[0]));
        line.appendChild(el("dd", null, row[1]));
        dl.appendChild(line);
      });
      order.appendChild(dl);
      doc.appendChild(order);
    }

    a.sections.forEach(function (section) {
      if (section.heading) doc.appendChild(el("h3", null, section.heading));
      var list = null;
      var lines = null;
      section.blocks.forEach(function (block) {
        if (block.kind !== "li") list = null;
        if (block.kind !== "line") lines = null;
        if (block.kind === "li") {
          if (!list) {
            list = el("ul");
            doc.appendChild(list);
          }
          list.appendChild(el("li", null, block.text));
        } else if (block.kind === "line") {
          // Consecutive lines are one block, like an address.
          if (lines) {
            lines.appendChild(document.createElement("br"));
          } else {
            lines = el("p", "ag-lines");
            doc.appendChild(lines);
          }
          lines.appendChild(document.createTextNode(block.text));
        } else {
          doc.appendChild(el("p", null, block.text));
        }
      });
    });

    if (a.status === "signed" || a.status === "paid") {
      var sig = el("div", "ag-sig");
      sig.appendChild(el("h3", null, "Signature"));
      if (a.signatoryName) sig.appendChild(el("p", "ag-sig-name", a.signatoryName));
      if (a.legalName) sig.appendChild(el("p", null, "For " + a.legalName));
      var date = formatDate(a.signedAt);
      sig.appendChild(el("p", "su-note", date ? "Signed electronically on " + date + "." : "Signed electronically."));
      doc.appendChild(sig);
    }
  }

  // Draws the page from the agreement's status.
  function render() {
    var a = agreement;
    var signable = a.status === "sent" || a.status === "viewed";
    if (a.status === "void") return showProblem(VOIDED, false);
    if (a.status === "expired") return showProblem(EXPIRED, false);
    if (a.status !== "paid" && a.status !== "signed" && !signable) return showProblem(LOAD_FAILED, true);
    // Never offer a signature without the text and the consent line.
    if (signable && (!a.consentText || !a.sections || !a.sections.length)) return showProblem(LOAD_FAILED, true);

    var confirming = a.status === "signed" && paidReturn;
    loading.hidden = true;
    problem.hidden = true;
    content.hidden = false;
    help.hidden = false;
    leadEl.hidden = false;

    if (a.status === "paid") {
      titleEl.textContent = "You're all set";
      leadEl.textContent = "Your agreement is signed and paid. We'll email you about the next steps.";
    } else if (confirming) {
      titleEl.textContent = "Payment received";
      leadEl.textContent = confirmSlow ? "This is taking longer than usual." : "We're confirming it with Stripe now.";
    } else if (a.status === "signed") {
      titleEl.textContent = "Your service agreement";
      leadEl.textContent = "You signed it. The last step is payment.";
    } else {
      titleEl.textContent = "Your service agreement";
      leadEl.textContent = "Check the details, sign at the bottom, then pay on Stripe.";
    }

    // Signed, confirming the payment, or paid.
    stateEl.hidden = signable;
    $("[data-state-signed]").hidden = !(a.status === "signed" && !confirming);
    $("[data-state-confirming]").hidden = !(confirming && !confirmSlow);
    $("[data-state-slow]").hidden = !(confirming && confirmSlow);
    $("[data-state-paid]").hidden = a.status !== "paid";
    setText("[data-signed-line]", signedLine(a));
    setText("[data-paid-line]", signedLine(a));

    if (builtFor !== a.status) {
      builtFor = a.status;
      fillSummary(a);
      buildDoc(a);
    }
    $("[data-sum-starts]").hidden = a.status === "paid" || confirming;

    form.hidden = !signable;
    if (signable) {
      $("[data-consent-text]").textContent = a.consentText;
      form.elements.signatory_name.placeholder = a.contactName || "";
      if (!form.dataset.filled) {
        form.dataset.filled = "1";
        if (a.businessName && !form.elements.legal_name.value) form.elements.legal_name.value = a.businessName;
      }
    }
  }

  // ---- loading, and the wait for Stripe's confirmation ------------------------

  async function load(focusState) {
    window.clearTimeout(pollTimer);
    problem.hidden = true;
    if (content.hidden) loading.hidden = false;
    var result = await call("/api/agreement/load", { t: token });
    loading.hidden = true;
    if (!loaded(result)) return problemFor(result);

    agreement = result.data.agreement;
    if (agreement.status !== "signed" && paidReturn) {
      if (agreement.status === "paid") pushEvent({ event: "agreement_step", agreement_step: "payment_confirmed" });
      forgetPaidReturn();
    }
    if (agreement.status === "signed" && paidReturn) startConfirming();
    render();

    // Tell the CRM it was opened, once per visit; nobody waits for it.
    if (!viewSent && (agreement.status === "sent" || agreement.status === "viewed")) {
      viewSent = true;
      call("/api/agreement/view", { t: token });
    }
    if (focusState) focusStatus();
  }

  // After an action changed where the agreement stands: focus what is shown now.
  function focusStatus() {
    var heading = agreement && agreement.status === "paid" ? $("[data-paid-title]") : null;
    if (heading && !content.hidden) heading.focus();
  }

  function startConfirming() {
    confirmSlow = false;
    pollDeadline = Date.now() + POLL_FOR_MS;
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(poll, POLL_MS);
  }

  async function poll() {
    var result = await call("/api/agreement/load", { t: token });
    if (loaded(result)) {
      agreement = result.data.agreement;
      if (agreement.status !== "signed") {
        if (agreement.status === "paid") pushEvent({ event: "agreement_step", agreement_step: "payment_confirmed" });
        forgetPaidReturn();
        render();
        focusStatus();
        return;
      }
    } else if (result.status === 404) {
      return problemFor(result);
    }
    if (Date.now() < pollDeadline) {
      pollTimer = window.setTimeout(poll, POLL_MS);
    } else {
      confirmSlow = true;
      render();
    }
  }

  $("[data-check-again]").addEventListener("click", function () {
    startConfirming();
    render();
    window.clearTimeout(pollTimer);
    poll();
  });

  retry.addEventListener("click", function () { load(false); });

  // ---- signing and paying -----------------------------------------------------

  // Sends the signer to Stripe when the answer carries a checkout link.
  function goToCheckout(result, step, button) {
    var url = result.status === 200 && result.data.ok === true ? result.data.checkoutUrl : null;
    if (typeof url !== "string" || url.indexOf(CHECKOUT_PREFIX) !== 0) return false;
    button.textContent = "Opening payment…";
    pushEvent({ event: "agreement_step", agreement_step: step });
    window.location.assign(url);
    return true;
  }

  // A sign or pay call that did not end at Stripe.
  function handleFailure(result, status, signing) {
    var error = result.data.error;
    pushEvent({ event: "agreement_error", error_type: error || String(result.status) });
    // Paid, voided or expired meanwhile, or gone: show where it stands now.
    if (result.status === 404 || result.status === 409 || /^agreement_(paid|void|expired|not_found)$/.test(error || "")) {
      return load(true);
    }
    if (signing && error === "invalid_input" && SIGN_FIELDS[result.data.field]) {
      var spec = SIGN_FIELDS[result.data.field];
      return markField(form.elements[spec[0]], spec[1]);
    }
    showStatus(status, GENERIC_ERRORS[error] || GENERIC_ERRORS[String(result.status)] ||
      (error === "invalid_input" ? CHECK_FORM : PAY_FAILED));
  }

  function resetButtons() {
    busy = false;
    form.removeAttribute("aria-busy");
    signButton.disabled = false;
    signButton.textContent = signButtonText;
    payButton.disabled = false;
    payButton.textContent = payButtonText;
  }

  form.addEventListener("input", function (event) {
    var field = event.target;
    if (field.getAttribute && field.getAttribute("aria-invalid")) {
      var note = document.getElementById("err-" + field.id);
      if (note) note.remove();
      field.removeAttribute("aria-invalid");
    }
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (busy) return;
    clearFieldErrors(form);
    hideStatus(formStatus);

    var legalName = form.elements.legal_name.value.trim();
    var signatoryName = form.elements.signatory_name.value.trim();
    var checks = [
      [!legalName, "legal_name", "Please enter the legal name of your business."],
      [!signatoryName, "signatory_name", "Please type your full name to sign."],
      [!form.elements.consent.checked, "consent", "Please check the box to agree."]
    ];
    for (var i = 0; i < checks.length; i++) {
      if (checks[i][0]) {
        markField(form.elements[checks[i][1]], checks[i][2]);
        pushEvent({ event: "form_validation_error", form_id: form.id });
        return;
      }
    }

    busy = true;
    form.setAttribute("aria-busy", "true");
    signButton.disabled = true;
    signButton.textContent = "Signing…";
    var result = await call("/api/agreement/sign", {
      t: token,
      legal_name: legalName,
      signatory_name: signatoryName,
      consent: true
    }, SIGN_TIMEOUT_MS);
    if (goToCheckout(result, "signed", signButton)) return;
    resetButtons();
    handleFailure(result, formStatus, true);
  });

  // Signed but not paid: { t } alone asks the CRM for the way to pay.
  payButton.addEventListener("click", async function () {
    if (busy) return;
    busy = true;
    hideStatus(payStatus);
    payButton.disabled = true;
    payButton.textContent = "Opening payment…";
    var result = await call("/api/agreement/sign", { t: token }, SIGN_TIMEOUT_MS);
    if (goToCheckout(result, "checkout_opened", payButton)) return;
    resetButtons();
    handleFailure(result, payStatus, false);
  });

  // Back from Stripe, the browser can restore this page as it was left, with
  // a button still busy. Reset it and look again: it may be signed now.
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    resetButtons();
    if (TOKEN.test(token)) load(false);
  });

  // ---- start ------------------------------------------------------------------

  if (!TOKEN.test(token)) {
    showProblem(NOT_FOUND, false);
    return;
  }
  load(false);
})();
