import { DEV_PASSWORD, SESSION_SECONDS, authenticated, configuredPassword, passwordMatches, sameOrigin, sessionCookieHeader, sessionSecret, signSession, usingDevPassword } from '../../../lib/security.mjs';
import { PayloadTooLarge, readJsonBody } from '../../../lib/request-body.mjs';
import { NO_STORE, failure } from '../../../lib/admin-api.mjs';
import { DEFAULT_APP_TITLE } from '../../../src/lib/app-meta.mjs';
import { createFailureLimiter, loginClientKey, trustedIPHeader } from '../../../lib/login-limit.mjs';
import { accountsEnabled, getAuth, hasPersonalSession, publicSsoProviders, sharedAdminAccounts } from '../../../lib/auth.mjs';
import { getViewer, publicViewer } from '../../../lib/viewer.mjs';
import { recordingEnabled } from '../../../lib/conversations.mjs';
import { demoSignInUrl, publicDemo } from '../../../lib/public-demo.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const attempts = createFailureLimiter();
const appTitle = () => String(process.env.APP_TITLE || DEFAULT_APP_TITLE).slice(0, 80);
const withCookie = (data, value, maxAge, more = []) => {
  const response = Response.json(data, { headers: { ...NO_STORE, 'Set-Cookie': sessionCookieHeader(value, maxAge) } });
  for (const cookie of more) response.headers.append('Set-Cookie', cookie);
  return response;
};

// SHARED_PASSWORD_ADMIN: ends the personal session this browser holds, if any, and returns the
// Set-Cookie values that clear it. Better Auth clears its cookies even when deleting the session
// row fails; anything it throws is passed on, so the caller changes nothing and says so.
async function endPersonalSession(request) {
  if (!sharedAdminAccounts() || !hasPersonalSession(request.headers)) return [];
  const ended = await getAuth().api.signOut({ headers: request.headers, asResponse: true });
  if (!ended.ok) throw Object.assign(new Error('sign_out_refused'), { code: `http_${ended.status}` });
  return ended.headers.getSetCookie?.() ?? [];
}

// Who is signed in, and how this deployment signs people in.
// With SHARED_PASSWORD_ADMIN the page offers both: a username signs in through Better Auth, and
// the shared password alone (sharedPassword: true) through POST below, as the administrator.
export async function GET(request) {
  const shared = sharedAdminAccounts();
  if (accountsEnabled() || shared) {
    // Accounts mode: sign-in happens through Better Auth at /api/account; this reports the result.
    const viewer = await getViewer(request.headers);
    return Response.json({ mode: 'accounts', ...(shared ? { sharedPassword: true, ...(usingDevPassword() ? { devPassword: DEV_PASSWORD } : {}) } : {}), authenticated: Boolean(viewer), appTitle: appTitle(), sso: publicSsoProviders(), ...(publicDemo() ? { publicDemo: true, ...(demoSignInUrl() ? { demoSignInUrl: demoSignInUrl() } : {}) } : {}), ...(viewer ? { user: publicViewer(viewer), recording: recordingEnabled() } : {}) }, { headers: NO_STORE });
  }
  return Response.json({ mode: 'password', authenticated: authenticated(request), appTitle: appTitle(), ...(usingDevPassword() ? { devPassword: DEV_PASSWORD } : {}) }, { headers: NO_STORE });
}

// Shared-password sign-in. With SHARED_PASSWORD_ADMIN it signs in the built-in administrator,
// under the same per-client failure limit, and ends any personal session in the browser first, so
// the browser holds one identity.
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
  let ended;
  try { ended = await endPersonalSession(request); }
  catch (error) {
    console.error('account_sign_out_failed', error?.code ?? error?.name);
    return failure('sign_in_unavailable', 503);
  }
  return withCookie({ authenticated: true }, signSession(secret), SESSION_SECONDS, ended);
}

// Sign-out clears the shared-password cookie. With SHARED_PASSWORD_ADMIN it also ends any personal
// session in this browser. It is all or nothing: if the personal session cannot be ended, neither
// cookie changes and the page says signing out did not work, rather than leaving one sign-in behind.
export async function DELETE(request) {
  if (!sameOrigin(request)) return failure('origin_not_allowed', 403);
  try { return withCookie({ authenticated: false }, '', 0, await endPersonalSession(request)); }
  catch (error) {
    console.error('account_sign_out_failed', error?.code ?? error?.name);
    return failure('sign_out_failed', 503);
  }
}
