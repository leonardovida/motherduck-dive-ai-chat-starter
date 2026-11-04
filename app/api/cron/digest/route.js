import { timingSafeEqual } from 'node:crypto';
import { accountsEnabled } from '../../../../lib/auth.mjs';
import { recordingEnabled } from '../../../../lib/conversations.mjs';
import { sendDigest } from '../../../../lib/digest.mjs';
import { listDives } from '../../../../lib/dives.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The weekly digest (vercel.json "crons", Mondays). Vercel sends CRON_SECRET as a bearer token;
// without CRON_SECRET or DIGEST_WEBHOOK_URL this route does nothing.
const NO_STORE = { 'Cache-Control': 'private, no-store' };
export async function GET(request) {
  const secret = String(process.env.CRON_SECRET ?? '');
  const given = String(request.headers.get('authorization') ?? '');
  const expected = `Bearer ${secret}`;
  if (secret.length < 16 || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return Response.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
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
