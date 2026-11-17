import { toNextJsHandler } from 'better-auth/next-js';
import { AUTH_BASE_PATH, getAuth, sharedAdminAccounts, startsPersonalSession } from '../../../../lib/auth.mjs';
import { DEMO_READ_ONLY, demoAllowsAuthRoute, publicDemo } from '../../../../lib/public-demo.mjs';
import { createFailureLimiter } from '../../../../lib/login-limit.mjs';
import { getViewer } from '../../../../lib/viewer.mjs';
import { audit, userLabel } from '../../../../lib/audit.mjs';
import { scheduleSync } from '../../../../lib/access-sync.mjs';
import { appQuery } from '../../../../lib/app-db.mjs';
import { NO_STORE, failure } from '../../../../lib/admin-api.mjs';
import { createPeopleService } from '../../../../lib/people.mjs';
import { sameOrigin, sessionCookieHeader } from '../../../../lib/security.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Better Auth's endpoints (sign-in, SSO callbacks, admin user management) in accounts mode, and
// for personal accounts next to the shared password with SHARED_PASSWORD_ADMIN.

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

// Better Auth only replaces the hash, so the person's other sessions and any unused setup link
// would still work after an administrator resets a password they believe is compromised.
async function endAccessAfterPasswordSet(auth, userId) {
  try {
    await (await auth.$context).internalAdapter.deleteUserSessions(userId);
    await appQuery('DELETE FROM account_setup WHERE user_id = $1 AND used_at IS NULL', [userId]);
  } catch (error) {
    console.error('password_set_signout_failed', error?.code ?? error?.name);
  }
}

// The person is already gone at this point, so a failure here is logged rather than reported.
async function removeAppRows(userId) {
  try {
    await appQuery('DELETE FROM access_group_member WHERE user_id = $1', [userId]);
    await appQuery('DELETE FROM account_setup WHERE user_id = $1', [userId]);
  } catch (error) {
    console.error('removed_user_cleanup_failed', error?.code ?? error?.name);
  }
}

// SHARED_PASSWORD_ADMIN: the administrator who signed in with the shared password has no Better
// Auth session, so Better Auth would refuse the portal's role, password and removal requests.
// Those three run through lib/people.mjs instead, after the same-origin check Better Auth would
// apply. Every other admin endpoint, impersonation included, stays refused for that sign-in.
// Errors carry a message so the portal's Better Auth client shows the reason.
const SHARED_ADMIN_ACTIONS = {
  '/admin/set-role': (people, userId, body) => people.setRole(userId, body?.role),
  '/admin/set-user-password': (people, userId, body) => people.setPassword(userId, body?.newPassword),
  '/admin/remove-user': (people, userId) => people.remove(userId),
};
const refused = (code, status) => Response.json({ error: code, message: code }, { status, headers: NO_STORE });
async function sharedAdminAction(request, path, userId, body, auth) {
  const action = SHARED_ADMIN_ACTIONS[path];
  if (!action) return refused('not_available_for_shared_password', 403);
  if (!sameOrigin(request)) return refused('origin_not_allowed', 403);
  try {
    return Response.json(await action(createPeopleService(appQuery, { auth: () => auth }), userId, body), { headers: NO_STORE });
  } catch (error) {
    if (error.status) return refused(error.message, error.status);
    console.error('shared_admin_action_failed', error?.code ?? error?.name);
    return refused('accounts_unavailable', 503);
  }
}

// SHARED_PASSWORD_ADMIN: a browser holds one identity. Any response that starts a personal session
// (sign-in with a password or single sign-on) also expires the shared-password cookie.
const handle = method => async request => {
  const response = await respond(method, request);
  if (!sharedAdminAccounts() || !startsPersonalSession(response)) return response;
  const copy = new Response(response.body, response);
  copy.headers.append('Set-Cookie', sessionCookieHeader('', 0));
  return copy;
};

// Endpoints the app does not use and that answer without a session: editing one's own profile
// (a free-text display name would let anyone appear in the portal under someone else's name;
// administrators use /admin/update-user) and checking whether a username exists.
const REFUSED = new Set(['/update-user', '/is-username-available']);

async function respond(method, request) {
  const auth = getAuth();
  if (!auth) return failure('accounts_not_configured', 404);
  const path = new URL(request.url).pathname.slice(AUTH_BASE_PATH.length);
  if (publicDemo() && !demoAllowsAuthRoute(method, path)) return failure(DEMO_READ_ONLY, 403);
  if (REFUSED.has(path)) return failure('not_allowed', 403);
  const run = () => toNextJsHandler(auth)[method](request);
  if (method !== 'POST') return run();
  if (SIGN_IN[path]) {
    const body = await request.clone().json().catch(() => ({}));
    const key = `${SIGN_IN[path]}:${String(body?.[SIGN_IN[path]] ?? '').trim().toLowerCase().slice(0, 254)}`;
    if (perAccount.blocked(key)) return Response.json({ code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Wait a few minutes and try again.' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': '600' } });
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
  const response = actor?.shared ? await sharedAdminAction(request, path, userId === body?.userId ? userId : null, body, auth) : await run();
  if (response.ok && actor?.isAdmin) {
    // Better Auth deletes the person, their sessions and accounts; the app's own rows go too, or a
    // deleted person's group memberships would still count when their groups change.
    if (path === '/admin/remove-user' && userId) await removeAppRows(userId);
    if (path === '/admin/set-user-password' && userId) await endAccessAfterPasswordSet(auth, userId);
    await audit(actor, name, target, path === '/admin/set-role' ? { role: String(body.role ?? '') } : null);
    if (changesAccess) await scheduleSync();
  }
  return response;
}

export const GET = handle('GET');
export const POST = handle('POST');
