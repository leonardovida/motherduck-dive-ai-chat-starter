import { accountsEnabled, getAuth } from './auth.mjs';
import { authenticated } from './security.mjs';
import { applyGroups, createGroupStore, parseDiveAccess } from './groups.mjs';

export { parseDiveAccess };

// One place that answers "who is this and what may they open?" in both modes.
// Shared-password viewers see every Dive and chat; accounts carry per-person access.
const SHARED_VIEWER = Object.freeze({ id: 'shared', name: 'Viewer', username: null, role: 'viewer', isAdmin: false, chat: true, dives: '*', mode: 'password' });

export const canSeeDive = (viewer, key) => Boolean(viewer) && (viewer.dives === '*' || viewer.dives.includes(key));

export function viewerFromUser(user) {
  if (!user || user.banned) return null;
  const roles = String(user.role ?? 'user').split(',').map(role => role.trim());
  return {
    id: user.id, name: user.name || user.displayUsername || user.username || 'User', username: user.displayUsername || user.username || null,
    role: roles.join(','), isAdmin: roles.includes('admin'), chat: user.chatAccess !== false, dives: parseDiveAccess(user.diveAccess), mode: 'accounts',
    motherduckUser: user.motherduckUser || null, groups: [], managerOf: [], dataGroup: null,
  };
}

// Accepts a Fetch Headers object or the plain header map the api/ handlers use.
// fresh: skip the one-minute signed cookie cache, so a ban, deletion or access change applies at
// once. Chat, embed sessions and admin routes use it; listing Dives may use the cache.
// Group access is read on every lookup, so removing someone from a group applies at once.
// If groups cannot be read the person keeps no Dives at all, rather than possibly the wrong data.
export async function getViewer(headers, env = process.env, auth = getAuth(env), { fresh = false, groups = createGroupStore() } = {}) {
  const plain = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers ?? {};
  if (!accountsEnabled(env)) return authenticated({ headers: plain }, env) ? SHARED_VIEWER : null;
  try {
    const session = await auth.api.getSession({ headers: headers instanceof Headers ? headers : new Headers(plain), ...(fresh ? { query: { disableCookieCache: true } } : {}) });
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
export const publicViewer = viewer => viewer && { name: viewer.name, username: viewer.username, isAdmin: viewer.isAdmin, canManage: canManagePeople(viewer), chat: viewer.chat, mode: viewer.mode, ...(viewer.groups?.length ? { groups: viewer.groups.map(group => group.name) } : {}) };
