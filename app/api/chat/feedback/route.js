import { z } from 'zod';
import { sameOrigin } from '../../../../lib/security.mjs';
import { PayloadTooLarge, readRequestText } from '../../../../lib/request-body.mjs';
import { getViewer } from '../../../../lib/viewer.mjs';
import { FEEDBACK_REASONS, conversationOwner, createConversationStore, recordingEnabled } from '../../../../lib/conversations.mjs';
import { publicDemo } from '../../../../lib/public-demo.mjs';

export const runtime = 'nodejs';
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const failure = (error, status) => Response.json({ error }, { status, headers: NO_STORE });
const feedbackSchema = z.object({
  conversationId: z.string().max(64), answerId: z.string().max(64), value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  reason: z.enum(FEEDBACK_REASONS).nullable().optional(), note: z.string().max(500).nullable().optional(),
});

// Thumbs up or down on a saved answer. Only the person who asked can rate it.
export async function POST(request) {
  if (!recordingEnabled()) return failure('feedback_not_available', 404);
  const viewer = await getViewer(request.headers, process.env, undefined, { fresh: true });
  if (!viewer) return failure('authentication_required', 401);
  if (!sameOrigin({ headers: Object.fromEntries(request.headers.entries()) })) return failure('origin_not_allowed', 403);
  let body;
  try { body = feedbackSchema.parse(JSON.parse(await readRequestText(request, 2000))); }
  catch (error) { return failure(error instanceof PayloadTooLarge ? 'request_too_large' : 'invalid_feedback', error instanceof PayloadTooLarge ? 413 : 400); }
  try {
    // The answer is saved just after it finishes streaming, so a very quick click can arrive first.
    const { sessionId } = conversationOwner(viewer, publicDemo());
    if (!await createConversationStore().setFeedback({ viewer, ...body, reason: body.reason ?? null, note: body.note ?? null, sessionId })) return failure('answer_not_found', 404);
    return Response.json({ saved: true, value: body.value }, { headers: NO_STORE });
  } catch (error) {
    console.error('feedback_save_failed', error?.code ?? error?.name);
    return failure('feedback_unavailable', 503);
  }
}
