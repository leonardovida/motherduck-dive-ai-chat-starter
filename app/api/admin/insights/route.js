import { NO_STORE, failure, requireAdmin } from '../../../../lib/admin-api.mjs';
import { createInsights } from '../../../../lib/insights.mjs';
import { audit } from '../../../../lib/audit.mjs';
import { publicDemo } from '../../../../lib/public-demo.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Questions asked in chat: ?days=&dive=&group= narrow the window; ?format=rows returns the
// questions themselves for a CSV download.
export async function GET(request) {
  const { response, viewer } = await requireAdmin(request);
  if (response) return response;
  const params = new URL(request.url).searchParams;
  const options = { days: params.get('days'), diveKey: params.get('dive') || undefined, group: params.get('group') || undefined };
  const insights = createInsights();
  try {
    if (params.get('format') === 'rows') {
      const rows = await insights.rows(options);
      if (!publicDemo()) await audit(viewer, 'questions.exported', {}, { rows: rows.length, days: Number(options.days) || 30, ...(options.diveKey ? { dive: options.diveKey } : {}), ...(options.group ? { group: options.group } : {}) });
      return Response.json({ rows }, { headers: NO_STORE });
    }
    const [summary, facets] = await Promise.all([insights.summary(options), insights.facets()]);
    return Response.json({ ...summary, facets }, { headers: NO_STORE });
  } catch (error) {
    console.error('insights_failed', error?.code ?? error?.name);
    // Before `npm run db:migrate` the view does not exist yet.
    if (/chat_questions|group_names/i.test(String(error?.message)) && /(does not exist|not found)/i.test(String(error?.message))) return failure('insights_need_migration', 503);
    return failure('conversations_unavailable', 503);
  }
}
