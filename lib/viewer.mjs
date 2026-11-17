import { accountsEnabled, getAuth, hasPersonalSession, sharedAdminAccounts } from './auth.mjs';
import { createHash } from 'node:crypto';
import { authenticated, sessionCookie } from './security.mjs';
import { applyGroups, createGroupStore, isAdminRole, parseDiveAccess } from './groups.mjs';

// One place that answers "who is this and what may they open?" in every mode.
// Shared-password viewers see every Dive and chat; accounts carry per-person access.
const SHARED_VIEWER = Object.freeze({ id: 'shared', name: 'Viewer', username: null, role: 'viewer', isAdmin: false, chat: true, dives: '*', mode: 'password' });

// SHARED_PASSWORD_ADMIN: the shared password signs in as a built-in administrator with no
// account, so its saved conversations belong to the browser session, named by a hash of its
// cookie. Its id ('shared') is never a Better Auth id, which are random.
const sharedAdminViewer = headers => ({ ...SHARED_VIEWER, name: 'Shared sign-in', role: 'admin', isAdmin: true, shared: true, sessionId: createHash('sha256').update(String(sessionCookie(headers) ?? '')).digest('hex').slice(0, 32) });

export const canSeeDive = (viewer, key) => Boolean(viewer) && (viewer.dives === '*' || viewer.dives.includes(key));

export function viewerFromUser(user) {
  if (!user || user.banned) return null;
  return {
    id: user.id, name: user.name || user.displayUsername || user.username || 'User', username: user.displayUsername || user.username || null,
    role: String(user.role ?? 'user').split(',').map(role => role.trim()).join(','), isAdmin: isAdminRole(user.role), chat: user.chatAccess === true, dives: parseDiveAccess(user.diveAccess), mode: 'accounts',
    motherduckUser: user.motherduckUser || null, groups: [], managerOf: [], dataGroup: null,
  };
}

// headers: the request's Headers.
// fresh: skip the one-minute signed cookie cache, so a ban, deletion or access change applies at
// once. Chat, embed sessions and admin routes use it; listing Dives may use the cache.
// Group access is read on every lookup, so removing someone from a group applies at once.
// If groups cannot be read the person keeps no Dives at all, rather than possibly the wrong data.
//
// With SHARED_PASSWORD_ADMIN both sign-ins exist, and a browser holds one at a time: each sign-in
// expires the other's cookie (app/api/auth, app/api/account, app/api/account-setup). Should both
// cookies still arrive, the personal one decides and nothing falls back: a personal session that
// has ended, been disabled or cannot be read is nobody, never the administrator, so losing a
// person's session can never turn their browser into the administrator. The shared cookie counts
// only on a request with no personal session cookie at all.
export async function getViewer(headers, env = process.env, auth = getAuth(env), options = {}) {
  const shared = sharedAdminAccounts(env);
  if (!accountsEnabled(env) && !shared) return authenticated(headers, env) ? SHARED_VIEWER : null;
  if (shared && !hasPersonalSession(headers)) return authenticated(headers, env) ? sharedAdminViewer(headers) : null;
  return accountViewer(headers, auth, options);
}

async function accountViewer(headers, auth, { fresh = false, groups = createGroupStore() } = {}) {
  try {
    const session = await auth.api.getSession({ headers, ...(fresh ? { query: { disableCookieCache: true } } : {}) });
    const viewer = viewerFromUser(session?.user);
    if (!viewer) return null;
    let memberships;
    try { memberships = await groups.forUser(viewer.id); }
    catch (error) {
      console.error('group_lookup_failed', error?.code ?? error?.name ?? 'error');
      return { ...viewer, dives: [], chat: false, sessionId: session.session?.id ?? null, impersonatedBy: session.session?.impersonatedBy ?? null };
    }
    return { ...applyGroups(viewer, memberships), sessionId: session.session?.id ?? null, impersonatedBy: session.session?.impersonatedBy ?? null };
  } catch (error) {
    console.error('session_lookup_failed', error?.name ?? 'error');
    return null;
  }
}

// Group managers can open the admin portal to look after the people in their groups.
export const canManagePeople = viewer => Boolean(viewer?.isAdmin || viewer?.managerOf?.length);
export const publicViewer = viewer => viewer && { name: viewer.name, username: viewer.username, isAdmin: viewer.isAdmin, canManage: canManagePeople(viewer), chat: viewer.chat, mode: viewer.mode, ...(viewer.shared ? { sharedAdmin: true } : {}), ...(viewer.groups?.length ? { groups: viewer.groups.map(group => group.name) } : {}) };
