// Shared handler for the site's two lead forms (api/visibility-report.js and
// api/inquiry.js). Takes the JSON assets/forms.js posts and sends the lead to
// the BYM CRM (api/_crm.js). The visitor sees success only when the CRM
// stored it.

const { crmConfigured, sendToCrm, placeFrom } = require("./_crm");
const { humanCheckFailed } = require("./_human");

async function submitLead(req, res, { crmForm }) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!crmConfigured()) {
    console.error("Missing CRM_URL env var");
    return res.status(500).json({ error: "Server is not configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  // The CRM files every lead under its email, and both forms require one.
  const fields = (body && body.fields) || {};
  const email = typeof fields.email === "string" ? fields.email.trim() : "";
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  // The free report is a scan of one place on Google Maps, so the visitor must
  // have picked their business from the search list. A typed name is a guess,
  // and the scan provider refuses a request without a real Place ID.
  if (crmForm === "visibility-report" && !placeFrom(fields).placeId) {
    return res.status(422).json({ error: "place_required" });
  }

  // Bot check: a no-op until Turnstile is switched on (api/_human.js).
  if (await humanCheckFailed(body, req.headers || {})) {
    return res.status(400).json({ error: "Human check failed" });
  }

  const crm = await sendToCrm(crmForm, body, req.headers || {});
  if (crm.ok) {
    // When the CRM filed the lead but says this email or place asked too
    // recently, tell the page how long to wait (it shows a countdown).
    if (crm.report === "rate_limited") {
      return res.status(200).json({ ok: true, report: "rate_limited", retryAfterSeconds: crm.retryAfterSeconds });
    }
    return res.status(200).json({ ok: true });
  }
  return res.status(502).json({ error: "CRM submission failed" });
}

module.exports = { submitLead };
