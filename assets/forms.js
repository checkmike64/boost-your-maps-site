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
      if (key === "company_fax") return;

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
    var submitButton = form.querySelector('button[type="submit"]');
    var originalButtonText = submitButton.textContent;

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      if (!form.reportValidity()) return;

      var honeypot = form.elements.company_fax;
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
          'This form is ready, but its API connection has not been added yet. Please email <a href="mailto:mike@boostyourmaps.com">mike@boostyourmaps.com</a> for now.',
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
          ? "That took too long. Please try again, or email mike@boostyourmaps.com."
          : "We could not send that just now. Please try again, or email mike@boostyourmaps.com.";
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
