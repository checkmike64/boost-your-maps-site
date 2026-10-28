// POST /api/agreement/sign { t, legal_name, signatory_name, consent }: the
// signer's typed name signs the agreement, and the CRM answers with the Stripe
// checkout link the page sends them to. { t } alone asks for the way to pay
// on an agreement that is already signed.
const { begin, buildSignPayload, agreementCall, send, stripeCheckoutUrl, clientIpFrom, fail, SIGN_TIMEOUT_MS } = require("../_agreement");

module.exports = async (req, res) => {
  const body = begin(req, res);
  if (!body) return;

  const built = buildSignPayload(body, req.headers || {});
  if (built.error) return send(res, 400, built.error);

  const { status, data } = await agreementCall("sign", "POST", `/api/agreements/${body.t}/sign`, {
    body: built.payload,
    clientIp: clientIpFrom(req.headers || {}),
    timeoutMs: SIGN_TIMEOUT_MS,
  });
  if (status !== 200) return send(res, status, data);

  const checkoutUrl = stripeCheckoutUrl(data.checkoutUrl);
  if (!checkoutUrl) {
    console.error("BYM agreement sign: no Stripe checkout link in the CRM's answer");
    return send(res, 503, fail("agreement_unavailable"));
  }
  return send(res, 200, { ok: true, checkoutUrl });
};
