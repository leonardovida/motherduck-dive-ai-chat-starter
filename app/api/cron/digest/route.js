import { cronAuthorized } from '../../../../lib/cron.mjs';
import { NO_STORE, failure } from '../../../../lib/admin-api.mjs';
import { accountsEnabled } from '../../../../lib/auth.mjs';
import { recordingEnabled } from '../../../../lib/conversations.mjs';
import { sendDigest } from '../../../../lib/digest.mjs';
import { listDives } from '../../../../lib/dives.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The weekly digest (vercel.json "crons", Mondays). Without CRON_SECRET or DIGEST_WEBHOOK_URL
// this route does nothing.
export async function GET(request) {
  if (!cronAuthorized(request)) return failure('not_found', 404);
  if (!accountsEnabled() || !recordingEnabled()) return Response.json({ skipped: 'conversations_not_saved' }, { headers: NO_STORE });
  const titles = new Map(listDives().map(dive => [dive.key, dive.title]));
  try {
    const result = await sendDigest({ diveTitle: key => titles.get(key) ?? key });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('digest_failed', error?.code ?? error?.name);
    return Response.json({ error: 'digest_failed' }, { status: 502, headers: NO_STORE });
  }
}
