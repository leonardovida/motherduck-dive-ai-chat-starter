import { sameOrigin } from '../../../../../lib/security.mjs';
import { getViewer, canSeeDive } from '../../../../../lib/viewer.mjs';
import { conversationOwner, createConversationStore, recordingEnabled } from '../../../../../lib/conversations.mjs';
import { publicDemo } from '../../../../../lib/public-demo.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const failure = (error, status) => Response.json({ error }, { status, headers: NO_STORE });

async function own(request, params) {
  if (!recordingEnabled()) return { response: failure('history_not_available', 404) };
  const viewer = await getViewer(request.headers);
  if (!viewer) return { response: failure('authentication_required', 401) };
  const owner = conversationOwner(viewer, publicDemo());
  const conversation = await createConversationStore().getOwn((await params).id, owner);
  // Someone else's conversation looks the same as one that does not exist.
  if (!conversation || !canSeeDive(viewer, conversation.dive_key)) return { response: failure('not_found', 404) };
  return { viewer, conversation };
}

// The messages of one of the person's own conversations, as the chat panel shows them.
export async function GET(request, { params }) {
  try {
    const { response, conversation } = await own(request, params);
    if (response) return response;
    return Response.json({
      conversation: {
        id: conversation.id, dive: conversation.dive_key, title: conversation.title,
        messages: conversation.messages.map(message => ({
          id: message.id, role: message.role, text: message.content,
          ...(message.role === 'assistant' ? { model: message.model_tier, status: message.status, feedback: message.feedback ?? 0, workedMs: message.worked_ms == null ? null : Number(message.worked_ms) } : {}),
        })),
      },
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('history_read_failed', error?.code ?? error?.name);
    return failure('history_unavailable', 503);
  }
}

// People can delete their own conversations. A public demo keeps them for every visitor.
export async function DELETE(request, { params }) {
  if (!sameOrigin({ headers: Object.fromEntries(request.headers.entries()) })) return failure('origin_not_allowed', 403);
  if (publicDemo()) return failure('demo_read_only', 403);
  try {
    const { response, conversation } = await own(request, params);
    if (response) return response;
    await createConversationStore().remove(conversation.id);
    return Response.json({ deleted: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('history_delete_failed', error?.code ?? error?.name);
    return failure('history_unavailable', 503);
  }
}
