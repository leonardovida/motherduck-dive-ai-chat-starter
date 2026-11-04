import { getViewer, canSeeDive } from '../../../../lib/viewer.mjs';
import { conversationOwner, createConversationStore, recordingEnabled } from '../../../../lib/conversations.mjs';
import { publicDemo } from '../../../../lib/public-demo.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const failure = (error, status) => Response.json({ error }, { status, headers: NO_STORE });

// A person's own saved conversations for one Dive, newest first, so they can pick one up again.
export async function GET(request) {
  if (!recordingEnabled()) return failure('history_not_available', 404);
  const viewer = await getViewer(request.headers);
  if (!viewer) return failure('authentication_required', 401);
  const params = new URL(request.url).searchParams;
  const dive = String(params.get('dive') ?? '').slice(0, 40);
  if (!dive || !canSeeDive(viewer, dive)) return failure('invalid_dive', 400);
  const owner = conversationOwner(viewer, publicDemo());
  try {
    const rows = await createConversationStore().list({ userId: owner.userId, sessionId: owner.sessionId, diveKey: dive, search: params.get('q')?.slice(0, 100) || undefined, limit: 30, offset: params.get('offset') });
    return Response.json({ conversations: rows.map(row => ({ id: row.id, title: row.title, updatedAt: row.updated_at, messageCount: Number(row.message_count) })) }, { headers: NO_STORE });
  } catch (error) {
    console.error('history_list_failed', error?.code ?? error?.name);
    return failure('history_unavailable', 503);
  }
}
