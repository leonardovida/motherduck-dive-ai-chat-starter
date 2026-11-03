import { accountsEnabled } from './auth.mjs';
import { sameOrigin } from './security.mjs';
import { getViewer } from './viewer.mjs';

export const NO_STORE = { 'Cache-Control': 'private, no-store' };
export const failure = (error, status) => Response.json({ error }, { status, headers: NO_STORE });

// Admin routes answer only to signed-in admins, and changes only to same-origin requests.
export async function requireAdmin(request, { write = false } = {}) {
  if (!accountsEnabled()) return { response: failure('accounts_not_configured', 404) };
  const headers = Object.fromEntries(request.headers.entries());
  const viewer = await getViewer(request.headers, process.env, undefined, { fresh: true });
  if (!viewer) return { response: failure('authentication_required', 401) };
  if (!viewer.isAdmin) return { response: failure('admin_required', 403) };
  if (write && !sameOrigin({ headers })) return { response: failure('origin_not_allowed', 403) };
  return { viewer };
}
