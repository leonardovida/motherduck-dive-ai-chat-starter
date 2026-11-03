import { NO_STORE, failure, requireAdmin } from '../../../../lib/admin-api.mjs';
import { AUDIT_ACTIONS, createAuditLog } from '../../../../lib/audit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The activity log, newest first. ?q= matches who acted or who was affected; ?action= filters.
export async function GET(request) {
  const { response } = await requireAdmin(request);
  if (response) return response;
  const params = new URL(request.url).searchParams;
  const action = AUDIT_ACTIONS.includes(params.get('action')) ? params.get('action') : '';
  try {
    const events = await createAuditLog().list({ q: String(params.get('q') ?? '').slice(0, 100), action, limit: 100, offset: Number.parseInt(params.get('offset') ?? '0', 10) || 0 });
    return Response.json({ events, actions: AUDIT_ACTIONS }, { headers: NO_STORE });
  } catch (error) {
    console.error('audit_list_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
