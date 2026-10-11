// POST /api/signup/intake { t, profileLinks, websiteUrl, mainService,
// leadPreference, targetArea, notes, photosUrl, approval }: the welcome page's
// short questions. Sending again replaces the earlier answers.
const { fail, begin, isToken, buildIntakePayload, crmCall, send, clientIpFrom } = require("../_signup");

module.exports = async (req, res) => {
  const body = begin(req, res, "POST");
  if (!body) return;
  if (!isToken(body.t)) return send(res, 404, fail("signup_not_found"));

  const built = buildIntakePayload(body);
  if (built.error) return send(res, 400, built.error);

  const { status, data } = await crmCall("intake", "POST", `/api/signup/${body.t}/intake`, { body: built.payload, clientIp: clientIpFrom(req.headers || {}) });
  if (status !== 200) return send(res, status, data);
  return send(res, 200, { ok: true });
};
