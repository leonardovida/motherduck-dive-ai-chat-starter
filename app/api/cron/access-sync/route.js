import { cronAuthorized } from '../../../../lib/cron.mjs';
import { NO_STORE, failure } from '../../../../lib/admin-api.mjs';
import { accountsEnabled } from '../../../../lib/auth.mjs';
import { requestSync } from '../../../../lib/access-sync.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// A scheduled reconcile (vercel.json "crons"), so MotherDuck grants changed outside the app, or a
// sync that failed, are put right without waiting for the next change in the portal. Without
// CRON_SECRET this route does nothing.
export async function GET(request) {
  if (!cronAuthorized(request)) return failure('not_found', 404);
  if (!accountsEnabled()) return Response.json({ skipped: 'accounts_not_configured' }, { headers: NO_STORE });
  const result = await requestSync();
  return Response.json({ mode: result?.mode ?? 'error' }, { status: result?.mode === 'error' ? 502 : 200, headers: NO_STORE });
}
