import { accountsEnabled } from './auth.mjs';
import { sameOrigin } from './security.mjs';
import { getViewer } from './viewer.mjs';
import { DEMO_READ_ONLY, publicDemo } from './public-demo.mjs';

export const NO_STORE = { 'Cache-Control': 'private, no-store' };
export const failure = (error, status) => Response.json({ error }, { status, headers: NO_STORE });

// Admin routes answer only to signed-in admins, and changes only to same-origin requests.
// A public demo shows every admin screen but refuses every change.
//
// managers: people routes also answer to group managers, scoped to the groups they manage. A
// manager can add people to those groups, send setup links and disable or remove members, but
// cannot grant Dives, change roles or touch administrators.
export async function requireAdmin(request, { write = false, managers = false } = {}) {
  if (!accountsEnabled()) return { response: failure('accounts_not_configured', 404) };
  const viewer = await getViewer(request.headers, process.env, undefined, { fresh: true });
  if (!viewer) return { response: failure('authentication_required', 401) };
  if (!viewer.isAdmin && !(managers && viewer.managerOf?.length)) return { response: failure('admin_required', 403) };
  if (write && !sameOrigin(request)) return { response: failure('origin_not_allowed', 403) };
  if (write && publicDemo()) return { response: failure(DEMO_READ_ONLY, 403) };
  return { viewer, scope: viewer.isAdmin ? { all: true, groups: [] } : { all: false, groups: viewer.managerOf } };
}
