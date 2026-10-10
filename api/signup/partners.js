// GET /api/signup/partners: the agencies listed for partner signup, for the
// dropdown on /partners/signup. A public list, so browsers may keep it for
// five minutes.
const { begin, crmCall, send, shapePartners, clientIpFrom } = require("../_signup");

module.exports = async (req, res) => {
  if (!begin(req, res, "GET")) return;
  const { status, data } = await crmCall("partners", "GET", "/api/signup/partners", { clientIp: clientIpFrom(req.headers || {}) });
  if (status !== 200) return send(res, status, data);
  return send(res, 200, { ok: true, partners: shapePartners(data) }, "public, max-age=300");
};
