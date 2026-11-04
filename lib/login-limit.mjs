import { isIP } from 'node:net';

// Trust a proxy header only when the deployer explicitly names one that their
// proxy overwrites. Route handlers see no client socket, so without that header
// every caller shares one bucket rather than inventing an IP address.
export function trustedIPHeader(env = process.env) {
  const header = String(env.AUTH_TRUSTED_IP_HEADER || (env.VERCEL === '1' ? 'x-forwarded-for' : '')).toLowerCase();
  return /^[a-z0-9-]{1,100}$/.test(header) ? header : '';
}

export function loginClientKey(headers, env = process.env) {
  const header = trustedIPHeader(env);
  const forwarded = header ? String(headers.get(header) ?? '').trim() : '';
  return isIP(forwarded) ? forwarded : 'shared';
}

// evict: when every bucket is in use, forget the oldest one that is not blocking anyone instead
// of refusing everyone new. Use it for buckets an attacker can create at will, such as one per
// username. Blocked buckets are forgotten last, so filling the table with junk keys does not
// clear the block on an account under attack.
export function createFailureLimiter({ limit = 10, maxKeys = 1000, windowMs = 600000, now = Date.now, evict = false } = {}) {
  const entries = new Map();
  const current = key => {
    const entry = entries.get(key);
    if (entry && entry.until <= now()) { entries.delete(key); return undefined; }
    return entry;
  };
  const full = () => {
    if (entries.size < maxKeys) return false;
    for (const [key, entry] of entries) if (entry.until <= now()) entries.delete(key);
    if (evict && entries.size >= maxKeys) {
      let oldest;
      for (const [key, entry] of entries) if (entry.count < limit) { oldest = key; break; }
      entries.delete(oldest ?? entries.keys().next().value);
    }
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
