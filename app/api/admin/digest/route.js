import { NO_STORE, failure, requireAdmin } from '../../../../lib/admin-api.mjs';
import { sendDigest } from '../../../../lib/digest.mjs';
import { listDives } from '../../../../lib/dives.mjs';
import { audit } from '../../../../lib/audit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Posts the weekly digest now, outside the schedule, so an administrator can check the webhook.
export async function POST(request) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  const titles = new Map(listDives().map(dive => [dive.key, dive.title]));
  try {
    const result = await sendDigest({ once: false, diveTitle: key => titles.get(key) ?? key });
    if (!result.sent) return failure('digest_not_configured', 409);
    await audit(viewer, 'questions.digest_sent', {}, { questions: result.questions });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('digest_failed', error?.code ?? error?.name);
    return failure('digest_failed', 502);
  }
}
