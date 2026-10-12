// POST /api/partner-portal { k }: an agency's private portal (its clients and
// links). POST so the token is never in a URL the site logs; this function
// asks the CRM with GET /api/partners/portal/{k}.
const { fail, begin, isToken, crmCall, send, shapePortal, clientIpFrom } = require("./_signup");

module.exports = async (req, res) => {
  const body = begin(req, res, "POST");
  if (!body) return;
  if (!isToken(body.k)) return send(res, 404, fail("portal_not_found"));

  const { status, data } = await crmCall("portal", "GET", `/api/partners/portal/${body.k}`, { clientIp: clientIpFrom(req.headers || {}) });
  if (status !== 200) return send(res, status, data);
  return send(res, 200, { ok: true, portal: shapePortal(data.portal) });
};
