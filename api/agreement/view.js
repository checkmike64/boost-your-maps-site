// POST /api/agreement/view { t }: the signer opened an agreement that is out
// for signing. The page sends it once per visit and does not wait for it.
const { begin, agreementCall, send, clientIpFrom } = require("../_agreement");

module.exports = async (req, res) => {
  const body = begin(req, res);
  if (!body) return;

  const { status, data } = await agreementCall("view", "POST", `/api/agreements/${body.t}/view`, { body: {}, clientIp: clientIpFrom(req.headers || {}) });
  if (status !== 200) return send(res, status, data);
  return send(res, 200, { ok: true });
};
