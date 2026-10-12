// GoHighLevel side of a form submission: a contact upsert, tagged by form
// source. Keeps the GHL Private Integration token server-side (never exposed
// to the browser). api/_lead.js runs it next to the BYM CRM (api/_crm.js).

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

function ghlConfigured() {
  return Boolean(process.env.GHL_API_TOKEN && process.env.GHL_LOCATION_ID);
}

// Upserts the contact. Resolves { ok, contactId } and never throws: failures
// are logged as "GHL ..." and api/_lead.js weighs them against the CRM's
// result. timeoutMs bounds the wait; 0 waits as long as GHL takes.
async function sendToGhl(fields, { tag, source, timeoutMs }) {
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  const email = typeof fields.email === "string" ? fields.email.trim() : "";
  const phone = typeof fields.phone === "string" ? fields.phone.trim() : "";

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
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });

    const data = await ghlResponse.json().catch(() => ({}));

    if (!ghlResponse.ok) {
      console.error("GHL upsert failed", ghlResponse.status, data);
      return { ok: false };
    }

    return { ok: true, contactId: data && data.contact && data.contact.id };
  } catch (err) {
    console.error("GHL upsert error", err);
    return { ok: false };
  }
}

module.exports = { ghlConfigured, sendToGhl };
