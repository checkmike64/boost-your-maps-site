// Shared handler: proxies a form submission from assets/forms.js to a
// GoHighLevel contact upsert, tagged by form source. Keeps the GHL
// Private Integration token server-side (never exposed to the browser).

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

function splitName(fields) {
  if (fields.first_name || fields.last_name) {
    return { firstName: fields.first_name || "", lastName: fields.last_name || "" };
  }
  return {};
}

// Maps form field names to GHL custom field keys (Settings > Custom Fields > Contact).
const CUSTOM_FIELD_KEYS = {
  service_interest: "service_interest",
  message: "message__anything_we_should_know",
  service: "top_service_to_grow",
  location: "target_location",
  active_marketing: "active_marketing",
};

function buildCustomFields(fields) {
  const customFields = [];
  for (const [formKey, ghlKey] of Object.entries(CUSTOM_FIELD_KEYS)) {
    const value = fields[formKey];
    if (typeof value === "string" && value.trim()) {
      customFields.push({ key: ghlKey, field_value: value.trim() });
    }
  }
  return customFields;
}

async function submitToGhl(req, res, { tag, source }) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!token || !locationId) {
    console.error("Missing GHL_API_TOKEN or GHL_LOCATION_ID env var");
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

  const fields = (body && body.fields) || {};
  const email = typeof fields.email === "string" ? fields.email.trim() : "";
  const phone = typeof fields.phone === "string" ? fields.phone.trim() : "";

  if (!email && !phone) {
    return res.status(400).json({ error: "Email or phone is required" });
  }

  const payload = {
    locationId,
    email: email || undefined,
    phone: phone || undefined,
    ...splitName(fields),
    companyName: fields.business_name || undefined,
    website: fields.website || undefined,
    source,
    tags: [tag],
    customFields: buildCustomFields(fields),
  };

  try {
    const ghlResponse = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_API_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await ghlResponse.json().catch(() => ({}));

    if (!ghlResponse.ok) {
      console.error("GHL upsert failed", ghlResponse.status, data);
      return res.status(502).json({ error: "CRM submission failed" });
    }

    return res.status(200).json({ ok: true, contactId: data && data.contact && data.contact.id });
  } catch (err) {
    console.error("GHL upsert error", err);
    return res.status(502).json({ error: "CRM submission failed" });
  }
}

module.exports = { submitToGhl };
