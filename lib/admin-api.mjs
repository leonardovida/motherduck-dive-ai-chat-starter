import { PayloadTooLarge } from './request-body.mjs';
import { accountsEnabled, sharedAdminAccounts } from './auth.mjs';
export { MOTHERDUCK_OFF } from './auth.mjs';
import { sameOrigin } from './security.mjs';
import { getViewer } from './viewer.mjs';
import { DEMO_READ_ONLY, publicDemo } from './public-demo.mjs';

export const NO_STORE = { 'Cache-Control': 'private, no-store' };
export const failure = (error, status) => Response.json({ error }, { status, headers: NO_STORE });
// The response for a body that readJsonBody or a schema refused.
export const badBody = (error, code) => (error instanceof PayloadTooLarge ? failure('request_too_large', 413) : failure(code, 400));

// Admin routes answer only to signed-in admins, and changes only to same-origin requests.
// A public demo shows every admin screen but refuses every change.
//
// managers: people routes also answer to group managers, scoped to the groups they manage. A
// manager can add people to those groups, send setup links and disable or remove members, but
// cannot grant Dives, change roles or touch administrators.
//
// Shared-password admin manages people and groups as accounts mode does, but never MotherDuck:
// anyone with the shared password is an administrator, so the whole mode has no grants, no access
// sync and no service accounts, whoever is signed in (MOTHERDUCK_OFF, lib/access-sync.mjs). The
// digest needs a schedule this mode does not set up.
const NOT_IN_SHARED_ADMIN = /^\/api\/admin\/(access-sync|digest|groups\/[^/]+\/service-account)(\/|$)/;
export async function requireAdmin(request, { write = false, managers = false } = {}) {
  const shared = sharedAdminAccounts();
  if (!accountsEnabled() && !shared) return { response: failure('accounts_not_configured', 404) };
  if (shared && NOT_IN_SHARED_ADMIN.test(new URL(request.url).pathname)) return { response: failure('accounts_not_configured', 404) };
  const viewer = await getViewer(request.headers, process.env, undefined, { fresh: true });
  if (!viewer) return { response: failure('authentication_required', 401) };
  if (!viewer.isAdmin && !(managers && viewer.managerOf?.length)) return { response: failure('admin_required', 403) };
  if (write && !sameOrigin(request)) return { response: failure('origin_not_allowed', 403) };
  if (write && publicDemo()) return { response: failure(DEMO_READ_ONLY, 403) };
  return { viewer, scope: viewer.isAdmin ? { all: true, groups: [] } : { all: false, groups: viewer.managerOf } };
}
