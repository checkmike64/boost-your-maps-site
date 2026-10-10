// POST /api/signup/start: a signup page's form becomes a CRM signup, and the
// CRM answers with the Stripe checkout link the page sends the buyer to.
const { fail, begin, buildStartPayload, crmCall, send, httpUrl } = require("../_signup");

module.exports = async (req, res) => {
  const body = begin(req, res, "POST");
  if (!body) return;
  const built = buildStartPayload(body, req.headers || {});
  if (built.error) return send(res, 400, built.error);

  const { status, data } = await crmCall("start", "POST", "/api/signup", { body: built.payload, clientIp: built.payload.clientIp });
  if (status !== 200) return send(res, status, data);

  const checkoutUrl = httpUrl(data.checkoutUrl);
  if (!checkoutUrl) {
    console.error("BYM signup start: no checkout link in the CRM's answer");
    return send(res, 503, fail("signup_unavailable"));
  }
  return send(res, 200, { ok: true, checkoutUrl });
};
