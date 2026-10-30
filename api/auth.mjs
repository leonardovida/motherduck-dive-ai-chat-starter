import { COOKIE, DEV_PASSWORD, SESSION_SECONDS, authenticated, configuredPassword, passwordMatches, readBody, sameOrigin, send, sessionSecret, signSession, usingDevPassword } from '../lib/security.mjs';
import { DEFAULT_APP_TITLE } from '../src/lib/app-meta.mjs';
import { createFailureLimiter, loginClientKey, trustedIPHeader } from '../lib/login-limit.mjs';
import { accountsEnabled, publicSsoProviders } from '../lib/auth.mjs';
import { getViewer, publicViewer } from '../lib/viewer.mjs';
import { recordingEnabled } from '../lib/conversations.mjs';
import { publicDemo } from '../lib/public-demo.mjs';

const attempts = createFailureLimiter();

const appTitle = () => String(process.env.APP_TITLE || DEFAULT_APP_TITLE).slice(0, 80);

export default async function handler(request, response) {
  if (request.method === 'GET') {
    if (accountsEnabled()) {
      // Accounts mode: sign-in happens through Better Auth at /api/account; this reports the result.
      const viewer = await getViewer(request.headers);
      return send(response, 200, { mode: 'accounts', authenticated: Boolean(viewer), appTitle: appTitle(), sso: publicSsoProviders(), ...(publicDemo() ? { publicDemo: true } : {}), ...(viewer ? { user: publicViewer(viewer), recording: recordingEnabled() } : {}) });
    }
    return send(response, 200, { mode: 'password', authenticated: authenticated(request), appTitle: appTitle(), ...(usingDevPassword() ? { devPassword: DEV_PASSWORD } : {}) });
  }
  if (!['POST', 'DELETE'].includes(request.method)) return send(response, 405, { error: 'method_not_allowed' });
  if (!sameOrigin(request)) return send(response, 403, { error: 'origin_not_allowed' });
  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    return send(response, 200, { authenticated: false });
  }
  if (accountsEnabled()) return send(response, 409, { error: 'use_account_sign_in' });
  const password = configuredPassword(), secret = sessionSecret();
  const clientKey = loginClientKey(request);
  if (!password || !secret || (process.env.NODE_ENV === 'production' && (!trustedIPHeader() || clientKey === 'shared'))) return send(response, 503, { error: 'auth_not_configured' });
  if (attempts.blocked(clientKey)) {
    response.setHeader('Retry-After', '600');
    return send(response, 429, { error: 'too_many_attempts' });
  }
  let body;
  try { body = await readBody(request); } catch { return send(response, 400, { error: 'invalid_body' }); }
  if (!passwordMatches(body?.password, password)) {
    attempts.failed(clientKey);
    return send(response, 401, { error: 'invalid_password' });
  }
  attempts.succeeded(clientKey);
  response.setHeader('Set-Cookie', `${COOKIE}=${signSession(secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
  return send(response, 200, { authenticated: true });
}
