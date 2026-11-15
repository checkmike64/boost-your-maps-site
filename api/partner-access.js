// POST /api/partner-access { email }: the Agency Partners page asks for an
// agency's portal link. The CRM looks the address up and, only when it is on
// file for an agency whose portal is on, emails that address the link
// (POST {CRM}/api/partners/access). This function never shows a link and
// never says whether the address matched.
//
// Every request that is allowed in and sent on gets the same answer, status
// and body: { ok: true }. What decides the answer is the request itself (its
// origin, its shape, its limit) and never the email, so the answer, its
// wording and the time it takes cannot tell a partner's address from any
// other. No agency list exists here. The email is never logged.
const { fail, begin, send, isEmail, crmCall, clientIpFrom } = require("./_signup");
const { text, userAgentFrom } = require("./_crm");
const { allowedOrigin, isJsonRequest, createLimiter } = require("./_partner");

// Five an hour for each visitor, as at the CRM, and a ceiling for the instance.
const limiter = createLimiter({ windowMs: 60 * 60 * 1000, perVisitor: 5, perInstance: 300 });

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, fail("method_not_allowed"));
  }
  const headers = req.headers || {};
  if (!allowedOrigin(headers)) return send(res, 403, fail("not_allowed"));
  if (!isJsonRequest(headers)) return send(res, 400, fail("invalid_input"));
  const body = begin(req, res, "POST");
  if (!body) return;

  // The honeypot: a person never fills it. A bot gets the same answer and
  // nothing is sent.
  if (text(body.hp_field_2026)) return send(res, 200, { ok: true });

  const email = text(body.email);
  if (!isEmail(email)) return send(res, 400, fail("invalid_input", "email"));

  if (!limiter.take(headers)) {
    res.setHeader("Retry-After", "3600");
    return send(res, 429, fail("rate_limited"));
  }

  const clientIp = clientIpFrom(headers);
  const { status } = await crmCall("partner-access", "POST", "/api/partners/access", {
    body: { email, clientIp, userAgent: userAgentFrom(headers) },
    clientIp,
  });
  // A CRM that is down says nothing about the address, so this is safe to tell.
  if (status !== 200) return send(res, 503, fail("access_unavailable"));
  return send(res, 200, { ok: true });
}

module.exports = handler;
module.exports._test = { limiter };
