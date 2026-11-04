import { COOKIE, DEV_PASSWORD, SESSION_SECONDS, authenticated, configuredPassword, passwordMatches, sameOrigin, sessionSecret, signSession, usingDevPassword } from '../../../lib/security.mjs';
import { PayloadTooLarge, readJsonBody } from '../../../lib/request-body.mjs';
import { NO_STORE, failure } from '../../../lib/admin-api.mjs';
import { DEFAULT_APP_TITLE } from '../../../src/lib/app-meta.mjs';
import { createFailureLimiter, loginClientKey, trustedIPHeader } from '../../../lib/login-limit.mjs';
import { accountsEnabled, publicSsoProviders } from '../../../lib/auth.mjs';
import { getViewer, publicViewer } from '../../../lib/viewer.mjs';
import { recordingEnabled } from '../../../lib/conversations.mjs';
import { demoSignInUrl, publicDemo } from '../../../lib/public-demo.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const attempts = createFailureLimiter();
const appTitle = () => String(process.env.APP_TITLE || DEFAULT_APP_TITLE).slice(0, 80);
const COOKIE_ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Strict';
const withCookie = (data, value, maxAge) => Response.json(data, { headers: { ...NO_STORE, 'Set-Cookie': `${COOKIE}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAge}` } });

// Who is signed in, and how this deployment signs people in.
export async function GET(request) {
  if (accountsEnabled()) {
    // Accounts mode: sign-in happens through Better Auth at /api/account; this reports the result.
    const viewer = await getViewer(request.headers);
    return Response.json({ mode: 'accounts', authenticated: Boolean(viewer), appTitle: appTitle(), sso: publicSsoProviders(), ...(publicDemo() ? { publicDemo: true, ...(demoSignInUrl() ? { demoSignInUrl: demoSignInUrl() } : {}) } : {}), ...(viewer ? { user: publicViewer(viewer), recording: recordingEnabled() } : {}) }, { headers: NO_STORE });
  }
  return Response.json({ mode: 'password', authenticated: authenticated(request), appTitle: appTitle(), ...(usingDevPassword() ? { devPassword: DEV_PASSWORD } : {}) }, { headers: NO_STORE });
}

// Shared-password sign-in.
export async function POST(request) {
  if (!sameOrigin(request)) return failure('origin_not_allowed', 403);
  if (accountsEnabled()) return failure('use_account_sign_in', 409);
  const password = configuredPassword(), secret = sessionSecret();
  const clientKey = loginClientKey(request.headers);
  if (!password || !secret || (process.env.NODE_ENV === 'production' && (!trustedIPHeader() || clientKey === 'shared'))) return failure('auth_not_configured', 503);
  if (attempts.blocked(clientKey)) return Response.json({ error: 'too_many_attempts' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': '600' } });
  let body;
  try { body = await readJsonBody(request, 16384); }
  catch (error) { return error instanceof PayloadTooLarge ? failure('request_too_large', 413) : failure('invalid_body', 400); }
  if (!passwordMatches(body?.password, password)) {
    attempts.failed(clientKey);
    return failure('invalid_password', 401);
  }
  attempts.succeeded(clientKey);
  return withCookie({ authenticated: true }, signSession(secret), SESSION_SECONDS);
}

// Sign-out clears the shared-password cookie.
export async function DELETE(request) {
  if (!sameOrigin(request)) return failure('origin_not_allowed', 403);
  return withCookie({ authenticated: false }, '', 0);
}
