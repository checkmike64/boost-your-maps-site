// POST /api/signup/status { t }: where a paid signup stands, for /welcome.
// The browser sends the token in the body so it never sits in a URL that is
// logged; this function asks the CRM with GET /api/signup/{t}.
const { fail, begin, isToken, crmCall, send, shapeSignup, clientIpFrom } = require("../_signup");

module.exports = async (req, res) => {
  const body = begin(req, res, "POST");
  if (!body) return;
  if (!isToken(body.t)) return send(res, 404, fail("signup_not_found"));

  const { status, data } = await crmCall("status", "GET", `/api/signup/${body.t}`, { clientIp: clientIpFrom(req.headers || {}) });
  if (status !== 200) return send(res, status, data);
  return send(res, 200, { ok: true, signup: shapeSignup(data.signup) });
};
