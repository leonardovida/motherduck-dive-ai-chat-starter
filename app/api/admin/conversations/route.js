import { NO_STORE, failure, requireAdmin } from '../../../../lib/admin-api.mjs';
import { createConversationStore } from '../../../../lib/conversations.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { response } = await requireAdmin(request);
  if (response) return response;
  const query = new URL(request.url).searchParams;
  try {
    const conversations = await createConversationStore().list({
      userId: query.get('user')?.slice(0, 64) || undefined, diveKey: query.get('dive')?.slice(0, 40) || undefined,
      search: query.get('q')?.slice(0, 100) || undefined, limit: query.get('limit'), offset: query.get('offset'),
    });
    return Response.json({ conversations }, { headers: NO_STORE });
  } catch (error) {
    console.error('conversation_list_failed', error?.code ?? error?.name);
    return failure('conversations_unavailable', 503);
  }
}
