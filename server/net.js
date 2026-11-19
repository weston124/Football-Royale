// Small helpers for the HTTP/WebSocket plumbing.

// The player's IP address, used only in memory for rate limits (never stored).
// Behind Render's proxy the address is in X-Forwarded-For. Set CLIENT_IP_HEADER (for example
// "cf-connecting-ip" or "true-client-ip") if your host provides a header clients can't fake.
const IP_HEADER = String(process.env.CLIENT_IP_HEADER || '').toLowerCase().trim();
export function clientIp(req) {
  if (IP_HEADER && req.headers[IP_HEADER]) return String(req.headers[IP_HEADER]).split(',')[0].trim().slice(0, 64);
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (xff || req.socket?.remoteAddress || '?').slice(0, 64);
}

// Sliding-window counter: allow(key) is true while key has had fewer than `max` hits in `ms`.
export function rateLimiter(max, ms) {
  const hits = new Map();
  return {
    allow(key) {
      const t = Date.now();
      const list = (hits.get(key) || []).filter((x) => x > t - ms);
      if (list.length >= max) { hits.set(key, list); return false; }
      list.push(t); hits.set(key, list);
      if (hits.size > 50_000) hits.clear(); // memory guard
      return true;
    },
  };
}
