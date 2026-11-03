import { toNextJsHandler } from 'better-auth/next-js';
import { AUTH_BASE_PATH, getAuth } from '../../../../lib/auth.mjs';
import { DEMO_READ_ONLY, demoAllowsAuthRoute, publicDemo } from '../../../../lib/public-demo.mjs';
import { createFailureLimiter } from '../../../../lib/login-limit.mjs';
import { getViewer } from '../../../../lib/viewer.mjs';
import { audit, userLabel } from '../../../../lib/audit.mjs';
import { scheduleSync } from '../../../../lib/access-sync.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Better Auth's endpoints (sign-in, SSO callbacks, admin user management) in accounts mode only.
const refuse = (error, status) => Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });

// Better Auth limits sign-in per IP address, which needs a trusted proxy header (Vercel's, or
// AUTH_TRUSTED_IP_HEADER). This limit applies on every host: ten failed attempts per account in
// ten minutes. It is keyed on the field that path signs in with, so extra fields cannot dodge it.
const perAccount = createFailureLimiter({ limit: 10, maxKeys: 5000, evict: true });
const SIGN_IN = { '/sign-in/username': 'username', '/sign-in/email': 'email' };

// Admin actions the portal sends straight to Better Auth. Each is recorded in the activity log,
// and those that change who may open what start an access sync on the server.
const ADMIN_ACTIONS = {
  '/admin/set-role': ['person.role_changed', true], '/admin/remove-user': ['person.removed', true],
  '/admin/ban-user': ['person.disabled', true], '/admin/unban-user': ['person.enabled', true],
  '/admin/set-user-password': ['person.password_set', false], '/admin/revoke-user-sessions': ['person.signed_out', false],
  '/admin/impersonate-user': ['person.impersonated', false], '/admin/update-user': ['person.updated', true],
};

const handle = method => async request => {
  const auth = getAuth();
  if (!auth) return refuse('accounts_not_configured', 404);
  const path = new URL(request.url).pathname.slice(AUTH_BASE_PATH.length);
  if (publicDemo() && !demoAllowsAuthRoute(method, path)) return refuse(DEMO_READ_ONLY, 403);
  const run = () => toNextJsHandler(auth)[method](request);
  if (method !== 'POST') return run();
  if (SIGN_IN[path]) {
    const body = await request.clone().json().catch(() => ({}));
    const key = `${SIGN_IN[path]}:${String(body?.[SIGN_IN[path]] ?? '').trim().toLowerCase().slice(0, 254)}`;
    if (perAccount.blocked(key)) return Response.json({ code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Wait a few minutes and try again.' }, { status: 429, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '600' } });
    const response = await run();
    if (response.ok) perAccount.succeeded(key);
    else if (response.status === 401 || response.status === 403) perAccount.failed(key);
    return response;
  }
  if (path === '/change-password') {
    // Read who it is first: changing the password ends the session the request came with.
    const person = await getViewer(request.headers, process.env, auth, { fresh: true });
    const response = await run();
    if (response.ok && person) await audit(person, 'person.password_changed');
    return response;
  }
  const action = ADMIN_ACTIONS[path];
  // Only signed-in requests are worth reading before Better Auth refuses the rest.
  if (!action || !request.headers.get('cookie')) return run();
  const [name, changesAccess] = action;
  const body = await request.clone().json().catch(() => ({}));
  const userId = typeof body?.userId === 'string' ? body.userId.slice(0, 64) : null;
  const actor = await getViewer(request.headers, process.env, auth, { fresh: true });
  // Read the target's name first, so removing them still leaves a readable entry.
  const target = userId ? { user: userId, label: await userLabel(userId) } : {};
  const response = await run();
  if (response.ok && actor?.isAdmin) {
    await audit(actor, name, target, path === '/admin/set-role' ? { role: String(body.role ?? '') } : null);
    if (changesAccess) await scheduleSync();
  }
  return response;
};

export const GET = handle('GET');
export const POST = handle('POST');
