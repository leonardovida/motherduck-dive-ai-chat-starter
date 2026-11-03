import { NO_STORE, failure, requireAdmin } from '../../../../../lib/admin-api.mjs';
import { createConversationStore } from '../../../../../lib/conversations.mjs';
import { audit } from '../../../../../lib/audit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { response } = await requireAdmin(request);
  if (response) return response;
  try {
    const conversation = await createConversationStore().get((await params).id);
    return conversation ? Response.json({ conversation }, { headers: NO_STORE }) : failure('not_found', 404);
  } catch (error) {
    console.error('conversation_read_failed', error?.code ?? error?.name);
    return failure('conversations_unavailable', 503);
  }
}

export async function DELETE(request, { params }) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  try {
    const id = (await params).id;
    if (!await createConversationStore().remove(id)) return failure('not_found', 404);
    await audit(viewer, 'conversation.deleted', { id });
    return Response.json({ deleted: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('conversation_delete_failed', error?.code ?? error?.name);
    return failure('conversations_unavailable', 503);
  }
}
