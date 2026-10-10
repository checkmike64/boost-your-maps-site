// POST /api/signup/access { t }: the buyer says they added our Google login as
// a Manager on the Business Profile.
const { fail, begin, isToken, crmCall, send, clientIpFrom } = require("../_signup");

module.exports = async (req, res) => {
  const body = begin(req, res, "POST");
  if (!body) return;
  if (!isToken(body.t)) return send(res, 404, fail("signup_not_found"));

  const { status, data } = await crmCall("access", "POST", `/api/signup/${body.t}/access`, { body: {}, clientIp: clientIpFrom(req.headers || {}) });
  if (status !== 200) return send(res, status, data);
  return send(res, 200, { ok: true });
};
