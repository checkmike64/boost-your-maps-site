(function () {
  "use strict";

  var forms = document.querySelectorAll("form[data-native-form]");

  function showStatus(status, type, message, allowMarkup) {
    status.className = "form-status full is-visible is-" + type;
    if (allowMarkup) {
      status.innerHTML = message;
    } else {
      status.textContent = message;
    }
    status.focus();
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
      page_url: window.location.href,
      fields: fields
    };
  }

  forms.forEach(function (form) {
    var status = form.querySelector(".form-status");
    var submitButton = form.querySelector('[type="submit"]');
    if (!status || !submitButton) return;
    var originalButtonText = submitButton.textContent;

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

      if (!form.reportValidity()) {
        var firstInvalid = form.querySelector(":invalid");
        if (firstInvalid) firstInvalid.focus();
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
          body: JSON.stringify(formPayload(form)),
          credentials: "omit",
          signal: controller.signal
        });

        if (!response.ok) throw new Error("Submission failed");

        form.reset();
        showStatus(status, "success", form.dataset.successMessage, false);
      } catch (error) {
        var message = error.name === "AbortError"
          ? "That took too long. Please try again, or email team@boostyourmaps.com."
          : "We could not send that just now. Please try again, or email team@boostyourmaps.com.";
        showStatus(status, "error", message, false);
      } finally {
        window.clearTimeout(timeout);
        form.removeAttribute("aria-busy");
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
      }
    });
  });
})();
