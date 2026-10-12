// Shared handler for the site's two lead forms (api/visibility-report.js and
// api/inquiry.js). Takes the JSON assets/forms.js posts and sends the lead to
// GoHighLevel (api/_ghl.js) and, when CRM_URL is set, to the BYM CRM
// (api/_crm.js) at the same time. The visitor sees success when either one
// stored it: the CRM is new, and no lead may be lost while both run.

const { ghlConfigured, sendToGhl } = require("./_ghl");
const { crmConfigured, sendToCrm } = require("./_crm");

// The browser gives up after 12 seconds (assets/forms.js). With the CRM in
// play, GHL gets at most 10, so a slow GHL can't hide a lead the CRM already
// stored. On its own, GHL is waited on as long as it takes, as before.
const GHL_TIMEOUT_WITH_CRM_MS = 10000;

const NOT_SENT = { ok: false };

async function submitLead(req, res, { tag, source, crmForm }) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ghlOn = ghlConfigured();
  const crmOn = crmConfigured();

  if (!ghlOn) {
    console.error("Missing GHL_API_TOKEN or GHL_LOCATION_ID env var");
    if (!crmOn) return res.status(500).json({ error: "Server is not configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  const fields = (body && body.fields) || {};
  const email = typeof fields.email === "string" ? fields.email.trim() : "";
  const phone = typeof fields.phone === "string" ? fields.phone.trim() : "";

  if (!email && !phone) {
    return res.status(400).json({ error: "Email or phone is required" });
  }

  const [ghl, crm] = await Promise.all([
    ghlOn ? sendToGhl(fields, { tag, source, timeoutMs: crmOn ? GHL_TIMEOUT_WITH_CRM_MS : 0 }) : NOT_SENT,
    crmOn ? sendToCrm(crmForm, body, req.headers || {}) : NOT_SENT,
  ]);

  if (ghl.ok || crm.ok) {
    return res.status(200).json({ ok: true, contactId: ghl.contactId });
  }
  return res.status(502).json({ error: "CRM submission failed" });
}

module.exports = { submitLead };
