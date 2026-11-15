// POST /api/partner-report { k, placeId, placeLabel, businessName, websiteUrl,
// keyword, area }: "Run a report" from an agency's portal. k is the portal key
// from the page's address hash. This function forwards the request to the CRM
// (POST {CRM}/api/partners/portal/{k}/reports) and answers with the CRM's
// result, narrowed to { ok, report: "queued" | "rate_limited",
// retryAfterSeconds }. It keeps nothing, and logs neither the key nor what was
// typed. The Place ID is the only way a business is named: the CRM refuses
// anything that is not shaped like one.
const { fail, begin, send, isToken, typedUrl, optionalText, crmCall, clientIpFrom } = require("./_signup");
const { text, cut } = require("./_crm");
const { allowedOrigin, isJsonRequest, createLimiter } = require("./_partner");

const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,1024}$/;
// The CRM holds each agency to one report every 5 minutes. This only stops a
// browser from hammering the function.
const limiter = createLimiter({ windowMs: 5 * 60 * 1000, perVisitor: 10, perInstance: 300 });
const MAX_RETRY_SECONDS = 86400;

// What the CRM receives: only the keys it takes, blanks left out.
function buildReportPayload(body) {
  if (!body) return { error: fail("invalid_input") };
  const placeId = text(body.placeId);
  if (!PLACE_ID_PATTERN.test(placeId)) return { error: fail("invalid_input", "placeId") };
  const keyword = cut(text(body.keyword), 200);
  if (!keyword) return { error: fail("invalid_input", "keyword") };
  const website = typedUrl(body.websiteUrl);
  if (website.invalid) return { error: fail("invalid_input", "websiteUrl") };
  const placeLabel = optionalText(body.placeLabel, 500);
  const businessName = optionalText(body.businessName, 200);
  const area = optionalText(body.area, 200);
  return {
    payload: {
      placeId,
      keyword,
      ...(placeLabel ? { placeLabel } : {}),
      ...(businessName ? { businessName } : {}),
      ...(website.value ? { websiteUrl: website.value } : {}),
      ...(area ? { area } : {}),
    },
  };
}

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
  if (!isToken(body.k)) return send(res, 404, fail("portal_not_found"));

  const built = buildReportPayload(body);
  if (built.error) return send(res, 400, built.error);

  if (!limiter.take(headers)) {
    res.setHeader("Retry-After", "300");
    return send(res, 429, fail("rate_limited"));
  }

  const { status, data } = await crmCall("partner-report", "POST", `/api/partners/portal/${body.k}/reports`, {
    body: built.payload,
    clientIp: clientIpFrom(headers),
  });
  if (status !== 200) {
    // Only the answers the page knows how to say go through.
    if ([400, 404, 429].includes(status)) return send(res, status, data);
    return send(res, 503, fail("report_unavailable"));
  }
  if (data.report === "queued") return send(res, 200, { ok: true, report: "queued" });
  if (data.report === "rate_limited") {
    const wait = Number.isInteger(data.retryAfterSeconds) && data.retryAfterSeconds >= 0 && data.retryAfterSeconds <= MAX_RETRY_SECONDS ? data.retryAfterSeconds : 300;
    return send(res, 200, { ok: true, report: "rate_limited", retryAfterSeconds: wait });
  }
  return send(res, 503, fail("report_unavailable"));
}

module.exports = handler;
module.exports._test = { limiter, buildReportPayload };
