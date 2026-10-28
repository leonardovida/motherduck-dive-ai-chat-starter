import { isIP } from 'node:net';

// Trust a proxy header only when the deployer explicitly names one that their
// proxy overwrites. Next.js route handlers expose no socket: use a shared bucket
// there by default rather than letting a caller invent an IP address.
export function trustedIPHeader(env = process.env) {
  const header = String(env.AUTH_TRUSTED_IP_HEADER || (env.VERCEL === '1' ? 'x-forwarded-for' : '')).toLowerCase();
  return /^[a-z0-9-]{1,100}$/.test(header) ? header : '';
}

export function loginClientKey(request, env = process.env) {
  const header = trustedIPHeader(env);
  const forwarded = /^[a-z0-9-]{1,100}$/.test(header) ? String(request.headers[header] ?? '').trim() : '';
  if (isIP(forwarded)) return forwarded;
  return request.socket?.remoteAddress || 'shared';
}

export function createFailureLimiter({ limit = 10, maxKeys = 1000, windowMs = 600000, now = Date.now } = {}) {
  const entries = new Map();
  const current = key => {
    const entry = entries.get(key);
    if (entry && entry.until <= now()) { entries.delete(key); return undefined; }
    return entry;
  };
  const full = () => {
    if (entries.size < maxKeys) return false;
    for (const [key, entry] of entries) if (entry.until <= now()) entries.delete(key);
    return entries.size >= maxKeys;
  };
  return {
    blocked(key) { const entry = current(key); return entry ? entry.count >= limit : full(); },
    failed(key) {
      let entry = current(key);
      if (!entry) {
        if (full()) return;
        entry = { count: 0, until: now() + windowMs }; entries.set(key, entry);
      }
      entry.count++;
    },
    succeeded(key) { if (key !== 'shared') entries.delete(key); },
  };
}
