// Business-name search for the review link tool (/tools/google-review-link-generator).
// Off until GOOGLE_PLACES_API_KEY is set in Vercel; the page then shows a search box.
//   GET  /api/places          -> { enabled: true | false }
//   POST /api/places {q}      -> { places: [{ placeId, name, address }] }   (up to 5)
// It calls Google Places API (New) Autocomplete server side, so the key never reaches the
// browser. Guards: same-site Origin only, short queries only, and a per-visitor and
// per-instance request cap. The caps live in memory, so they reset when Vercel starts a new
// instance: set a daily quota on the key in Google Cloud as the hard limit.

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const FIELD_MASK = "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat";
const ALLOWED_ORIGINS = [
  /^https:\/\/(www\.)?boostyourmaps\.com$/,
  /^https:\/\/boostyourmaps-[a-z0-9-]+-mike-8166s-projects\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];
const LIMITS = { perVisitorPerMinute: 10, perVisitorPerDay: 60, perInstancePerDay: 2000 };
const TIMEOUT_MS = 5000;

const counters = { visitors: new Map(), day: dayKey(), total: 0 };

function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function visitorOf(req) {
  const h = req.headers || {};
  const fwd = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || String(h["x-real-ip"] || "") || "unknown";
}

function allowedOrigin(req) {
  const h = req.headers || {};
  let origin = h.origin;
  if (!origin && h.referer) {
    try {
      origin = new URL(h.referer).origin;
    } catch {
      origin = "";
    }
  }
  return Boolean(origin) && ALLOWED_ORIGINS.some((re) => re.test(origin));
}

// Returns true when this request may go to Google, and counts it.
function takeSlot(visitor, now = Date.now()) {
  const today = dayKey(now);
  if (counters.day !== today) {
    counters.day = today;
    counters.total = 0;
    counters.visitors.clear();
  }
  if (counters.total >= LIMITS.perInstancePerDay) return false;
  const v = counters.visitors.get(visitor) || { minute: 0, minuteStart: now, day: 0 };
  if (now - v.minuteStart >= 60000) {
    v.minute = 0;
    v.minuteStart = now;
  }
  if (v.minute >= LIMITS.perVisitorPerMinute || v.day >= LIMITS.perVisitorPerDay) return false;
  v.minute += 1;
  v.day += 1;
  counters.visitors.set(visitor, v);
  counters.total += 1;
  return true;
}

function readQuery(body) {
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  const q = body && typeof body.q === "string" ? body.q.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  return q.length >= 3 && q.length <= 100 ? q : null;
}

function toPlaces(data) {
  const out = [];
  for (const s of (data && data.suggestions) || []) {
    const p = s && s.placePrediction;
    if (!p || typeof p.placeId !== "string" || !/^[A-Za-z0-9_-]{20,512}$/.test(p.placeId)) continue;
    const f = p.structuredFormat || {};
    out.push({
      placeId: p.placeId,
      name: String((f.mainText && f.mainText.text) || "").slice(0, 120),
      address: String((f.secondaryText && f.secondaryText.text) || "").slice(0, 160),
    });
    if (out.length === 5) break;
  }
  return out;
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.GOOGLE_PLACES_API_KEY || "";

  if (req.method === "GET") {
    return res.status(200).json({ enabled: Boolean(key) });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!key) {
    return res.status(503).json({ error: "Search is not set up" });
  }
  if (!allowedOrigin(req)) {
    return res.status(403).json({ error: "Not allowed" });
  }
  const q = readQuery(req.body);
  if (!q) {
    return res.status(400).json({ error: "Send a business name and town (3 to 100 characters)" });
  }
  if (!takeSlot(visitorOf(req))) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Too many searches. Try again in a minute." });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify({ input: q }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error(`Places autocomplete failed: HTTP ${r.status}`);
      return res.status(502).json({ error: "Search failed" });
    }
    return res.status(200).json({ places: toPlaces(await r.json()) });
  } catch (err) {
    console.error(`Places autocomplete failed: ${err && err.name === "AbortError" ? "timeout" : "network error"}`);
    return res.status(502).json({ error: "Search failed" });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = handler;
module.exports._test = { counters, LIMITS, takeSlot, toPlaces, readQuery, allowedOrigin };
