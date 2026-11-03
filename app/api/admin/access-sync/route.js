import { NO_STORE, failure, requireAdmin } from '../../../../lib/admin-api.mjs';
import { requestSync, syncStatus } from '../../../../lib/access-sync.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// What the app has granted in MotherDuck, what is outstanding, and the SQL for manual mode.
export async function GET(request) {
  const { response } = await requireAdmin(request);
  if (response) return response;
  try { return Response.json(await syncStatus(), { headers: NO_STORE }); }
  catch (error) {
    console.error('access_status_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}

// Runs a sync now and waits for it, so the portal can show the result.
export async function POST(request) {
  const { response } = await requireAdmin(request, { write: true });
  if (response) return response;
  const result = await requestSync();
  if (result?.mode === 'error') return failure('sync_failed', 502);
  return Response.json({ result, status: await syncStatus() }, { headers: NO_STORE });
}
