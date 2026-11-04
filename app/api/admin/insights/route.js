import { NO_STORE, failure, requireAdmin } from '../../../../lib/admin-api.mjs';
import { createInsights } from '../../../../lib/insights.mjs';
import { audit } from '../../../../lib/audit.mjs';
import { publicDemo } from '../../../../lib/public-demo.mjs';
import { modelPrices } from '../../../../lib/budgets.mjs';
import { digestWebhook } from '../../../../lib/digest.mjs';
import { chatConfigured } from '../../../../lib/chat-models.mjs';
import { refreshModelSettings } from '../../../../lib/model-settings.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Questions asked in chat: ?days=&dive=&group= narrow the window; ?format=rows returns the
// questions themselves for a CSV download. Group managers see only questions asked as a member
// of the groups they manage, and never the conversations behind them.
export async function GET(request) {
  const { response, viewer, scope } = await requireAdmin(request, { managers: true });
  if (response) return response;
  const params = new URL(request.url).searchParams;
  const managed = scope.all ? null : (viewer.groups ?? []).filter(group => scope.groups.includes(group.id));
  const group = params.get('group') || undefined;
  if (managed && group && !managed.some(item => item.name === group)) return failure('group_not_managed', 403);
  const options = { days: params.get('days'), diveKey: params.get('dive') || undefined, group, groupIds: managed ? managed.map(item => item.id) : undefined };
  const insights = createInsights();
  try {
    if (params.get('format') === 'rows') {
      const rows = await insights.rows(options);
      if (!publicDemo()) await audit(viewer, 'questions.exported', {}, { rows: rows.length, days: Number(options.days) || 30, ...(options.diveKey ? { dive: options.diveKey } : {}), ...(group ? { group } : {}) });
      return Response.json({ rows: managed ? rows.map(({ conversation_id, ...row }) => row) : rows }, { headers: NO_STORE });
    }
    const prices = modelPrices();
    if (!managed) await refreshModelSettings();
    const [summary, facets] = await Promise.all([insights.summary({ ...options, prices }), managed ? { dives: [], groups: managed.map(item => item.name) } : insights.facets()]);
    return Response.json({
      ...summary, facets, scope: managed ? 'manager' : 'admin',
      ...(managed ? {} : { digest: Boolean(digestWebhook()), topicsAvailable: chatConfigured() }),
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('insights_failed', error?.code ?? error?.name);
    // Before `npm run db:migrate` the view or its newer columns do not exist yet.
    if (/chat_questions|group_names|group_ids|classified_at|topic/i.test(String(error?.message)) && /(does not exist|not found)/i.test(String(error?.message))) return failure('insights_need_migration', 503);
    return failure('conversations_unavailable', 503);
  }
}
