import { cronAuthorized } from '../../../../lib/cron.mjs';
import { NO_STORE, failure } from '../../../../lib/admin-api.mjs';
import { accountsEnabled } from '../../../../lib/auth.mjs';
import { requestSync } from '../../../../lib/access-sync.mjs';
import { createConversationStore, recordingEnabled, retentionDays } from '../../../../lib/conversations.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Daily upkeep (vercel.json "crons"). Deletes saved messages older than CHAT_RETENTION_DAYS, and
// reconciles MotherDuck grants, so grants changed outside the app or a sync that failed are put
// right without waiting for the next change in the portal. Without CRON_SECRET this route does
// nothing.
export async function GET(request) {
  if (!cronAuthorized(request)) return failure('not_found', 404);
  if (!accountsEnabled()) return Response.json({ skipped: 'accounts_not_configured' }, { headers: NO_STORE });
  let retention = 'off';
  const days = retentionDays();
  if (days && recordingEnabled()) {
    try { await createConversationStore().purgeOlderThan(days); retention = 'purged'; }
    catch (error) { console.error('retention_purge_failed', error?.code ?? error?.name); retention = 'error'; }
  }
  const result = await requestSync();
  const mode = result?.mode ?? 'error';
  return Response.json({ mode, retention }, { status: mode === 'error' || retention === 'error' ? 502 : 200, headers: NO_STORE });
}
