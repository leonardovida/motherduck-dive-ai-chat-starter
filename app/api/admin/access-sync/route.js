import { z } from 'zod';
import { NO_STORE, failure, requireAdmin } from '../../../../lib/admin-api.mjs';
import { createGrantStore, requestSync, syncStatus } from '../../../../lib/access-sync.mjs';
import { motherDuckAdmin } from '../../../../lib/motherduck-admin.mjs';
import { publicDemo } from '../../../../lib/public-demo.mjs';
import { audit } from '../../../../lib/audit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Share URLs stay private: a public demo shows share names only.
const HIDDEN = 'md:_share/…';
const forDemo = status => ({
  ...status,
  grants: status.grants.map(row => ({ ...row, url: HIDDEN })),
  sql: status.sql.replace(/md:_share\/[^\s'>]+/g, HIDDEN),
});

// What the app has granted in MotherDuck, what is outstanding, and the SQL for manual mode.
export async function GET(request) {
  const { response } = await requireAdmin(request);
  if (response) return response;
  try {
    const status = await syncStatus();
    return Response.json(publicDemo() ? forDemo(status) : status, { headers: NO_STORE });
  } catch (error) {
    console.error('access_status_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}

// Runs a sync now and waits for it, so the portal can show the result. In manual mode,
// { confirm: true } records that a share owner ran the SQL shown.
export async function POST(request) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  let body;
  try { body = z.object({ confirm: z.boolean().optional() }).parse(await request.json().catch(() => ({}))); } catch { return failure('invalid_sync', 400); }
  if (body.confirm) {
    if (motherDuckAdmin().configured()) return failure('automatic_mode', 409);
    try {
      const result = await createGrantStore().confirmManual();
      await audit(viewer, 'access_sync.confirmed', {}, result);
      return Response.json({ result, status: await syncStatus() }, { headers: NO_STORE });
    } catch (error) {
      console.error('access_confirm_failed', error?.code ?? error?.name);
      return failure('accounts_unavailable', 503);
    }
  }
  const result = await requestSync();
  if (result?.mode === 'error') return failure('sync_failed', 502);
  await audit(viewer, 'access_sync.run', {}, { mode: result.mode, synced: result.synced, failed: result.failed, revoked: result.revoked, pending: result.pending });
  return Response.json({ result, status: await syncStatus() }, { headers: NO_STORE });
}
