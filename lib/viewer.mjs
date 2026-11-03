import { accountsEnabled, getAuth } from './auth.mjs';
import { authenticated } from './security.mjs';

// One place that answers "who is this and what may they open?" in both modes.
// Shared-password viewers see every Dive and chat; accounts carry per-person access.
const SHARED_VIEWER = Object.freeze({ id: 'shared', name: 'Viewer', username: null, role: 'viewer', isAdmin: false, chat: true, dives: '*', mode: 'password' });

export function parseDiveAccess(raw) {
  const text = String(raw ?? '*').trim();
  if (!text || text === '*') return '*';
  return [...new Set(text.split(',').map(key => key.trim()).filter(key => /^[a-z0-9][a-z0-9-]{0,39}$/.test(key)))];
}

export const canSeeDive = (viewer, key) => Boolean(viewer) && (viewer.dives === '*' || viewer.dives.includes(key));

export function viewerFromUser(user) {
  if (!user || user.banned) return null;
  const roles = String(user.role ?? 'user').split(',').map(role => role.trim());
  return {
    id: user.id, name: user.name || user.displayUsername || user.username || 'User', username: user.displayUsername || user.username || null,
    role: roles.join(','), isAdmin: roles.includes('admin'), chat: user.chatAccess !== false, dives: parseDiveAccess(user.diveAccess), mode: 'accounts',
  };
}

// Accepts a Fetch Headers object or the plain header map the api/ handlers use.
// fresh: skip the one-minute signed cookie cache, so a ban, deletion or access change applies at
// once. Chat, embed sessions and admin routes use it; listing Dives may use the cache.
export async function getViewer(headers, env = process.env, auth = getAuth(env), { fresh = false } = {}) {
  const plain = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers ?? {};
  if (!accountsEnabled(env)) return authenticated({ headers: plain }, env) ? SHARED_VIEWER : null;
  try {
    const session = await auth.api.getSession({ headers: headers instanceof Headers ? headers : new Headers(plain), ...(fresh ? { query: { disableCookieCache: true } } : {}) });
    return viewerFromUser(session?.user);
  } catch (error) {
    console.error('session_lookup_failed', error?.name ?? 'error');
    return null;
  }
}

export const publicViewer = viewer => viewer && { name: viewer.name, username: viewer.username, isAdmin: viewer.isAdmin, chat: viewer.chat, mode: viewer.mode };
