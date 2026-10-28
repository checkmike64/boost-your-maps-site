// POST /api/agreement/load { t }: the agreement behind a private /agreement
// link, for the page to show. The browser sends the token in the body so it
// never sits in a URL that is logged; this function asks the CRM with
// GET /api/agreements/{t}.
const { begin, agreementCall, send, shapeAgreement, clientIpFrom, UNAVAILABLE } = require("../_agreement");

module.exports = async (req, res) => {
  const body = begin(req, res);
  if (!body) return;

  const { status, data } = await agreementCall("load", "GET", `/api/agreements/${body.t}`, { clientIp: clientIpFrom(req.headers || {}) });
  if (status !== 200) return send(res, status, data);

  const agreement = shapeAgreement(data.agreement);
  if (!agreement) {
    console.error("BYM agreement load: the CRM's agreement could not be shown");
    return send(res, 503, UNAVAILABLE);
  }
  return send(res, 200, { ok: true, agreement });
};
