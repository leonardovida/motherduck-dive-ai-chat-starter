import { generateText, Output } from 'ai';
import { NO_STORE, failure, requireAdmin } from '../../../../../lib/admin-api.mjs';
import { classifyTopics, topicSchema } from '../../../../../lib/topics.mjs';
import { chatConfigured, utilityModel } from '../../../../../lib/chat-models.mjs';
import { languageModel, PROVIDER_OPTIONS } from '../../../../../lib/model-providers.mjs';
import { audit } from '../../../../../lib/audit.mjs';
import { refreshModelSettings } from '../../../../../lib/model-settings.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Groups the filtered questions that have no topic yet, a few batches per request.
export async function POST(request) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  await refreshModelSettings();
  if (!chatConfigured()) return failure('topics_need_model', 503);
  const params = new URL(request.url).searchParams;
  const options = { days: params.get('days'), diveKey: params.get('dive') || undefined, group: params.get('group') || undefined };
  const generate = async ({ instructions, prompt }) => (await generateText({
    model: languageModel(utilityModel()), reasoning: 'none', output: Output.object({ schema: topicSchema }), instructions, prompt,
    maxOutputTokens: 4000, maxRetries: 1, abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]), providerOptions: PROVIDER_OPTIONS,
  })).output;
  try {
    const result = await classifyTopics({ ...options, generate });
    await audit(viewer, 'questions.classified', {}, { classified: result.classified });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('topics_failed', error?.code ?? error?.name);
    return failure('topics_failed', 502);
  }
}
