import { z } from 'zod';
import { NO_STORE, failure, requireAdmin } from '../../../../lib/admin-api.mjs';
import { audit } from '../../../../lib/audit.mjs';
import { PayloadTooLarge, readRequestText } from '../../../../lib/request-body.mjs';
import { SettingsError, createModelSettingsStore, parseModelSettings, setCachedModelSettings, withModelSettings } from '../../../../lib/model-settings.mjs';
import { modelsOverview, settingsSummary } from '../../../../lib/model-admin.mjs';
import { tierModel, utilityModel } from '../../../../lib/chat-models.mjs';
import { testModel } from '../../../../lib/model-test.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admins only. Settings hold non-secret values; credentials stay in the environment and only
// their names and presence are returned. Changes are refused cross-origin and in a public demo.
const invalid = error => Response.json({ error: error.code, ...(error.path ? { path: error.path } : {}) }, { status: 400, headers: NO_STORE });
async function readJson(request) {
  const text = await readRequestText(request, 20000);
  return text ? JSON.parse(text) : {};
}
async function load(store) {
  const stored = await store.get();
  setCachedModelSettings(stored?.settings ?? null);
  return stored;
}

export async function GET(request) {
  const { response } = await requireAdmin(request);
  if (response) return response;
  try {
    return Response.json(modelsOverview({ stored: await load(createModelSettingsStore()) }), { headers: NO_STORE });
  } catch (error) {
    console.error('model_settings_read_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}

// Save: replaces the saved settings. Tiers left out follow the environment.
export async function PUT(request) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  let settings;
  try { settings = parseModelSettings((await readJson(request)).settings); }
  catch (error) {
    if (error instanceof SettingsError) return invalid(error);
    return failure(error instanceof PayloadTooLarge ? 'request_too_large' : 'invalid_settings', error instanceof PayloadTooLarge ? 413 : 400);
  }
  try {
    const store = createModelSettingsStore();
    await store.save(settings, viewer.username || viewer.id);
    await audit(viewer, 'models.updated', { id: 'models', label: 'Models' }, settingsSummary(settings));
    return Response.json(modelsOverview({ stored: await load(store) }), { headers: NO_STORE });
  } catch (error) {
    console.error('model_settings_save_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}

// Reset: forget the saved settings, so environment variables and defaults apply again.
export async function DELETE(request) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  try {
    const store = createModelSettingsStore();
    await store.clear();
    setCachedModelSettings(null);
    await audit(viewer, 'models.reset', { id: 'models', label: 'Models' });
    return Response.json(modelsOverview({ stored: null }), { headers: NO_STORE });
  } catch (error) {
    console.error('model_settings_reset_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}

// Test: one tiny prompt with one tool call, sent from the server, for a saved tier or an unsaved
// draft from the form. It spends a few tokens, so it is a write: admins, same origin, no demo.
const testSchema = z.object({ tier: z.enum(['luna', 'sol', 'astra', 'utility']), config: z.unknown().optional() }).strict();
const tests = new Map();
export async function POST(request) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  const now = Date.now(), recent = (tests.get(viewer.id) ?? []).filter(at => at > now - 60000);
  if (recent.length >= 10) return failure('test_rate_limited', 429);
  tests.set(viewer.id, [...recent, now]);
  if (tests.size > 200) for (const [id, times] of tests) if (times.every(at => at <= now - 60000)) tests.delete(id);
  let body, model;
  try {
    body = testSchema.parse(await readJson(request));
    if (body.config !== undefined) {
      const draft = parseModelSettings(body.tier === 'utility' ? { utility: body.config } : { tiers: { [body.tier]: body.config } });
      const tier = body.tier === 'utility' ? draft.utility : draft.tiers[body.tier];
      model = { key: body.tier, provider: tier.provider, id: tier.model, options: tier.options };
    }
  } catch (error) {
    if (error instanceof SettingsError) return invalid(error);
    return failure('invalid_test', 400);
  }
  if (!model) {
    let stored;
    try { stored = await load(createModelSettingsStore()); } catch { return failure('accounts_unavailable', 503); }
    const env = withModelSettings(process.env, stored?.settings ?? null);
    model = body.tier === 'utility' ? utilityModel(env) : tierModel(body.tier, env);
  }
  const result = await testModel(model, process.env);
  return Response.json({ tier: body.tier, provider: model.provider, model: model.id, ...result }, { headers: NO_STORE });
}
