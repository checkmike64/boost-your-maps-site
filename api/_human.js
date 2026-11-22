// Bot check for the lead forms (Cloudflare Turnstile). ON when the env var
//   TURNSTILE_SECRET_KEY  (private; this file checks the token with it)
// is set in Vercel. The public site key lives in visibility-report.html, so
// no site key is needed here. With no secret the check does nothing. The
// browser sends the token as `human_token` in the form's JSON body. Only the
// visibility report form asks for it (data-human-check on the form).

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

function humanCheckOn(env = process.env) {
  return Boolean((env.TURNSTILE_SECRET_KEY || "").trim());
}

// Resolves true when the request must be refused. Never throws. With the
// check off it is always false. With it on, a missing or refused token is
// true; a Cloudflare outage (network error) lets the visitor through, so the
// form never goes down with it.
async function humanCheckFailed(body, headers, env = process.env, doFetch = fetch) {
  if (!humanCheckOn(env)) return false;
  const token = body && typeof body.human_token === "string" ? body.human_token.trim() : "";
  if (!token || token.length > 2048) return true;
  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY.trim(), response: token });
    const ip = String((headers && headers["x-forwarded-for"]) || "").split(",")[0].trim();
    if (ip) form.set("remoteip", ip);
    const response = await doFetch(VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) return false;
    return data.success !== true;
  } catch (err) {
    console.error("Turnstile check unavailable");
    return false;
  }
}

module.exports = { humanCheckOn, humanCheckFailed };
