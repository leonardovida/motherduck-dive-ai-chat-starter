import { timingSafeEqual } from 'node:crypto';
import { accountsEnabled } from '../../../../lib/auth.mjs';
import { requestSync } from '../../../../lib/access-sync.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// A scheduled reconcile (vercel.json "crons"), so MotherDuck grants changed outside the app, or a
// sync that failed, are put right without waiting for the next change in the portal. Vercel sends
// CRON_SECRET as a bearer token; without CRON_SECRET this route does nothing.
const NO_STORE = { 'Cache-Control': 'private, no-store' };
export async function GET(request) {
  const secret = String(process.env.CRON_SECRET ?? '');
  const given = String(request.headers.get('authorization') ?? '');
  const expected = `Bearer ${secret}`;
  if (secret.length < 16 || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return Response.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  if (!accountsEnabled()) return Response.json({ skipped: 'accounts_not_configured' }, { headers: NO_STORE });
  const result = await requestSync();
  return Response.json({ mode: result?.mode ?? 'error' }, { status: result?.mode === 'error' ? 502 : 200, headers: NO_STORE });
}
