import { MODEL_KEYS, chatConfigured, enabledModelKeys, listedModelKeys, modelConfigured, routerEnabled, tierModel, utilityModel } from './chat-models.mjs';
import { withModelSettings } from './model-settings.mjs';
import { DEFAULT_MODELS, PRESETS, PROVIDERS_INFO, PROVIDER_IDS, envPresence, missingFor, providerReady } from './provider-registry.mjs';

// What the admin Models tab shows: the saved settings, what each tier resolves to with and without
// them, and for every provider which environment variables are set. Names and presence only:
// no secret, and no value read from the environment other than model ids, leaves the server.
const describe = (model, env) => ({
  provider: model.provider, model: model.id, source: model.source, options: model.source === 'settings' ? model.options : {},
  configured: modelConfigured(model, env), missing: model.id ? missingFor(model.provider, env, model.options) : ['a model id'],
  ...(model.key === 'utility' ? {} : { tier: model.key }),
});

export function modelsOverview({ env = process.env, stored = null } = {}) {
  const settings = stored?.settings ?? null;
  const saved = withModelSettings(env, settings);
  const envOnly = withModelSettings(env, null);
  const presence = envPresence(env);
  return {
    settings,
    updatedAt: stored?.updatedAt ?? null,
    updatedBy: stored?.updatedBy ?? null,
    tiers: MODEL_KEYS.map(key => ({ key, effective: describe(tierModel(key, saved), saved), environment: describe(tierModel(key, envOnly), envOnly) })),
    utility: { effective: describe(utilityModel(saved), saved), environment: describe(utilityModel(envOnly), envOnly) },
    // listed: the tiers chosen for the picker; enabled: those of them that can answer now.
    listed: listedModelKeys(saved),
    enabled: enabledModelKeys(saved),
    router: routerEnabled(saved),
    chatConfigured: chatConfigured(saved),
    providers: PROVIDER_IDS.map(id => ({
      id, label: PROVIDERS_INFO[id].label, fields: PROVIDERS_INFO[id].fields, reasoning: PROVIDERS_INFO[id].reasoning,
      env: presence[id], ready: providerReady(id, env), missing: missingFor(id, env), presets: PRESETS[id], defaults: DEFAULT_MODELS[id],
    })),
  };
}

// The audit entry for a save: providers and model ids per tier, never URLs or other fields.
export const settingsSummary = settings => ({
  tiers: Object.fromEntries(Object.entries(settings?.tiers ?? {}).map(([key, tier]) => [key, `${tier.provider}:${tier.model}`])),
  ...(settings?.utility ? { utility: `${settings.utility.provider}:${settings.utility.model}` } : {}),
  ...(settings?.enabled ? { enabled: settings.enabled } : {}),
});
