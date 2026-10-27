import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE = '__Host-dive_session';
export const SESSION_SECONDS = 8 * 60 * 60;
// Local development only. Production refuses to sign anyone in without DEMO_PASSWORD.
export const DEV_PASSWORD = 'duckdemo';

const isProduction = env => env.NODE_ENV === 'production';

export function configuredPassword(env = process.env) {
  if (env.DEMO_PASSWORD) return env.DEMO_PASSWORD;
  return isProduction(env) ? null : DEV_PASSWORD;
}

export const usingDevPassword = (env = process.env) => !env.DEMO_PASSWORD && !isProduction(env);

// Route bundles can load this module more than once in dev, so share one random secret.
export function sessionSecret(env = process.env) {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return env.SESSION_SECRET;
  if (isProduction(env)) return null;
  globalThis.__embeddedDiveChatDevSecret ??= randomBytes(32).toString('hex');
  return globalThis.__embeddedDiveChatDevSecret;
}

// Hashing first gives equal-length buffers, so the comparison time does not leak the length.
export function passwordMatches(input, expected) {
  if (typeof input !== 'string' || !input || input.length > 256 || typeof expected !== 'string' || !expected) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(input), digest(expected));
}

export function signSession(secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_SECONDS, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function validSession(value, secret, now = Date.now()) {
  if (!secret || secret.length < 32 || typeof value !== 'string' || value.length > 512) return false;
  const [body, signature, extra] = value.split('.');
  if (!body || !signature || extra) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(expected, received)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    const seconds = Math.floor(now / 1000);
    return Number.isInteger(payload.exp) && payload.exp > seconds && payload.exp <= seconds + SESSION_SECONDS && /^[a-f0-9]{32}$/.test(payload.nonce);
  } catch { return false; }
}

export function sessionCookie(request) {
  const value = String(request.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`));
  return value?.slice(COOKIE.length + 1);
}

export function authenticated(request, env = process.env) {
  return validSession(sessionCookie(request), sessionSecret(env));
}

export function sameOrigin(request, env = process.env) {
  try {
    const origin = new URL(request.headers.origin);
    if (origin.host !== request.headers.host) return false;
    return origin.protocol === 'https:' || (!isProduction(env) && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname));
  } catch { return false; }
}

export function send(response, status, data) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.statusCode = status;
  response.end(JSON.stringify(data));
}

export async function readBody(request) {
  if (!String(request.headers['content-type'] || '').startsWith('application/json')) throw new Error('invalid_body');
  if (request.body !== undefined) {
    const value = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    if (JSON.stringify(value).length > 16384) throw new Error('invalid_body');
    return value;
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16384) throw new Error('invalid_body');
  }
  return JSON.parse(body);
}

// The Dive state bag a viewer can pass back to the server: plain JSON, small, simple keys.
export function sanitizeState(value, maxChars = 8192) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(([key]) => /^[A-Za-z0-9_.-]{1,64}$/.test(key) && key !== '__proto__');
  try {
    const serialized = JSON.stringify(Object.fromEntries(entries));
    return serialized.length <= maxChars ? JSON.parse(serialized) : {};
  } catch { return {}; }
}
