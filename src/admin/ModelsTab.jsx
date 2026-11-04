import * as React from "react";
import { CircleCheck, CircleAlert, FlaskConical, RotateCcw, Save, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api.mjs";
import { fill } from "@/lib/text.mjs";

// The admin Models tab: which provider and model powers each chat tier. Only non-secret values
// are entered here. Keys stay in the deployment's environment and this page only shows whether
// each variable is set.
const COPY = {
  title: "Models",
  body: "Choose the provider and model behind each chat tier. Saved choices apply within a few seconds and take precedence over environment variables; tiers you leave on the environment follow CHAT_MODEL_* and the built-in defaults. API keys and cloud credentials are never entered or shown here: set them in your host's environment or secret manager, then press Test.",
  docs: "Setup steps for each provider are in docs/model-providers.md.",
  savedBy: "Saved by {who} on {when}.",
  usingEnv: "No saved choices: every tier follows the environment.",
  quickTitle: "Quick setup",
  quickBody: "Use one provider for every tier. Pick a provider and a model family, then fill the tiers below and review them before saving.",
  provider: "Provider",
  family: "Models",
  model: "Model",
  allTiersModel: "Model for every tier",
  fill: "Fill all tiers",
  tiers: { luna: ["Luna", "Fast"], sol: ["Sol", "Balanced"], astra: ["Astra", "Deep analysis"], utility: ["Utility", "Routing and suggested questions"] },
  useEnv: "Use the environment for this tier",
  useEnvUtility: "Use the fastest enabled tier",
  current: "Now: {provider} · {model} ({source})",
  sources: { settings: "saved here", environment: "from environment variables", default: "built-in default" },
  noModel: "no model set",
  shown: "Show in the chat picker",
  envTitle: "Environment variables for {provider}",
  set: "set",
  missing: "missing",
  optional: "optional",
  missingNow: "Missing: {names}",
  stillNeeded: "Still needed in the environment: {names}",
  envReady: "The environment has what this provider needs.",
  hidden: "Hidden from the picker until this tier is configured.",
  fields: {
    baseURL: "Base URL, including /v1",
    resourceName: "Azure resource name",
    apiVersion: "API version (optional)",
    api: "API",
    region: "AWS region",
    project: "Google Cloud project ID",
    location: "Location",
  },
  placeholders: {
    "openai-compatible": { baseURL: "http://localhost:11434/v1" },
    openrouter: { baseURL: "https://openrouter.ai/api/v1 (default)" },
    azure: { baseURL: "https://my-resource.openai.azure.com/openai/v1", resourceName: "my-resource", apiVersion: "v1" },
    bedrock: { region: "us-east-1" },
    vertex: { project: "my-project", location: "global" },
  },
  apis: { responses: "Responses (default)", chat: "Chat Completions" },
  hints: {
    openai: "Uses OPENAI_API_KEY and, if set, OPENAI_BASE_URL.",
    anthropic: "Uses ANTHROPIC_API_KEY and, if set, ANTHROPIC_BASE_URL.",
    openrouter: "Model ids look like openai/gpt-6-luna. OPENROUTER_API_KEY is sent only to openrouter.ai or to OPENROUTER_BASE_URL.",
    azure: "The model is your deployment name. Fill either the resource name or the base URL. Leave both empty to use AZURE_RESOURCE_NAME or AZURE_BASE_URL.",
    bedrock: "Use an inference profile ID such as global.anthropic.claude-sonnet-5-5. Leave the region empty to use AWS_REGION.",
    vertex: "Gemini or Claude model ids. Leave the project empty to use GOOGLE_VERTEX_PROJECT; the location defaults to global.",
    "openai-compatible": "vLLM, Ollama, LM Studio, TGI, LiteLLM and similar servers. The model must support tool calling. OPENAI_COMPATIBLE_API_KEY is sent only to OPENAI_COMPATIBLE_BASE_URL, so a base URL entered here gets no key.",
  },
  test: "Test",
  testing: "Testing…",
  testOk: "Works: answered in {ms} ms and called a tool.",
  testNoTool: "Answered in {ms} ms, but did not call a tool.",
  testFailed: "Failed: {error}",
  save: "Save",
  saving: "Saving…",
  saved: "Saved. The chat uses these choices from now on.",
  reset: "Reset to environment defaults",
  confirmReset: "Confirm reset",
  resetDone: "Saved choices removed. Every tier follows the environment again.",
  unsaved: "You have unsaved changes.",
  demo: "Changes and tests are not available in a public demo.",
  failed: "That did not work: {reason}",
  reasons: {
    unknown_provider: "pick a provider from the list",
    invalid_model_id: "the model id has characters that are not allowed",
    invalid_url: "the base URL is not a valid URL",
    url_must_be_http: "the base URL must start with http:// or https://",
    url_has_credentials: "the base URL must not contain a user name or password. Put keys in the environment",
    url_has_query: "the base URL must not contain a query string",
    url_too_long: "the base URL is too long",
    field_not_allowed: "this provider does not take that field",
    invalid_region: "use an AWS region such as us-east-1",
    invalid_resourcename: "use the Azure resource name only, such as my-resource",
    invalid_apiversion: "use an API version such as v1 or 2025-04-01-preview",
    invalid_project: "use a Google Cloud project ID: 6-30 lowercase letters, digits and hyphens",
    invalid_location: "use a location such as global, us or us-central1",
    invalid_api: "pick an API from the list",
    azure_resource_or_url: "fill either the resource name or the base URL, not both",
    looks_like_secret: "a value looks like a key or password. Keys belong in the environment, never here",
    invalid_settings: "check the values and try again",
    test_rate_limited: "too many tests in a minute. Wait a moment",
    demo_read_only: "this is not available in a public demo",
    origin_not_allowed: "the request came from another site",
    admin_required: "only administrators can do this",
    authentication_required: "your session ended. Sign in again",
    accounts_unavailable: "the app database did not answer. Run npm run db:migrate if this is a new install, then try again",
    request_too_large: "the request is too large",
  },
};
const KEYS = ["luna", "sol", "astra"];
const select = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground";
const tierName = path => { const key = String(path || "").split(".")[1] || String(path || "").split(".")[0]; return COPY.tiers[key]?.[0]; };
const reasonFor = error => {
  const reason = COPY.reasons[error?.message] || error?.message || "";
  const where = tierName(error?.data?.path);
  return where ? `${where}: ${reason}` : reason;
};

// The form keeps one entry per tier: inherit (follow the environment) or a provider, model and fields.
const toDraft = overview => {
  const entry = saved => (saved ? { inherit: false, provider: saved.provider, model: saved.model, options: { ...saved.options } } : { inherit: true, provider: "", model: "", options: {} });
  return {
    tiers: Object.fromEntries(KEYS.map(key => [key, entry(overview.settings?.tiers?.[key])])),
    utility: entry(overview.settings?.utility),
    enabled: overview.settings?.enabled ?? overview.listed,
    enabledSaved: Boolean(overview.settings?.enabled),
  };
};
const fieldsOf = (providers, id) => providers.find(item => item.id === id)?.fields ?? [];
const clean = (providers, entry) => ({ provider: entry.provider, model: entry.model.trim(), options: Object.fromEntries(fieldsOf(providers, entry.provider).map(field => [field, String(entry.options[field] ?? "").trim()]).filter(([, item]) => item)) });
const toSettings = (providers, draft) => ({
  tiers: Object.fromEntries(KEYS.filter(key => !draft.tiers[key].inherit).map(key => [key, clean(providers, draft.tiers[key])])),
  ...(draft.utility.inherit ? {} : { utility: clean(providers, draft.utility) }),
  ...(draft.enabledSaved ? { enabled: KEYS.filter(key => draft.enabled.includes(key)) } : {}),
});

// Environment values a field on this form replaces, so they are not reported as still needed.
const COVERED = { region: ["AWS_REGION"], project: ["GOOGLE_VERTEX_PROJECT"], resourceName: ["AZURE_RESOURCE_NAME or AZURE_BASE_URL"], baseURL: ["AZURE_RESOURCE_NAME or AZURE_BASE_URL", "OPENAI_COMPATIBLE_BASE_URL"] };
function EnvList({ provider, options = {} }) {
  if (!provider) return null;
  const covered = Object.entries(options).filter(([, item]) => String(item ?? "").trim()).flatMap(([field]) => COVERED[field] ?? []);
  const needed = (provider.missing ?? []).filter(name => !covered.includes(name));
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">{fill(COPY.envTitle, { provider: provider.label })}</p>
      <ul className="flex flex-wrap gap-1.5">
        {provider.env.map(item => (
          <li key={item.name} className="max-w-full">
            <Badge variant={item.set ? "secondary" : "outline"} className="h-auto max-w-full whitespace-normal break-all">
              {item.set ? <CircleCheck data-icon="inline-start" aria-hidden="true" /> : <CircleAlert data-icon="inline-start" aria-hidden="true" />}
              {item.name}: {item.set ? COPY.set : item.optional ? `${COPY.missing} (${COPY.optional})` : COPY.missing}
            </Badge>
          </li>
        ))}
      </ul>
      <p className={`text-xs ${needed.length ? "text-destructive" : "text-muted-foreground"}`}>{needed.length ? fill(COPY.stillNeeded, { names: needed.join("; ") }) : COPY.envReady}</p>
    </div>
  );
}

function TestResult({ result }) {
  if (!result) return null;
  if (result.pending) return <p role="status" className="text-sm text-muted-foreground">{COPY.testing}</p>;
  const lines = result.ok
    ? [fill(result.toolCall ? COPY.testOk : COPY.testNoTool, { ms: result.latencyMs })]
    : [fill(COPY.testFailed, { error: [result.status ? `HTTP ${result.status}` : "", result.error].filter(Boolean).join(" · ") }), result.hint];
  const tone = result.ok && result.toolCall ? "text-foreground" : "text-destructive";
  return (
    <div role="status" className={`grid gap-1 text-sm ${tone}`}>
      {[...lines, ...(result.notes ?? [])].filter(Boolean).map(line => <p key={line} className="break-words">{line}</p>)}
    </div>
  );
}

function TierEditor({ id, entry, overview, onChange, enabled, onEnabled, onTest, result, demo }) {
  const [name, hint] = COPY.tiers[id];
  const providers = overview.providers;
  const provider = providers.find(item => item.id === entry.provider);
  const effective = id === "utility" ? overview.utility.effective : overview.tiers.find(tier => tier.key === id).effective;
  const label = providers.find(item => item.id === effective.provider)?.label ?? effective.provider;
  const presetKey = id === "utility" ? "luna" : id;
  const suggestions = provider ? [...new Set([provider.defaults[presetKey], ...provider.presets.map(preset => preset.models[presetKey])].filter(Boolean))] : [];
  const pickProvider = next => {
    const info = providers.find(item => item.id === next);
    onChange({ inherit: false, provider: next, model: info?.defaults[presetKey] || info?.presets[0]?.models[presetKey] || "", options: {} });
  };
  const setOption = (field, value) => onChange({ ...entry, options: { ...entry.options, [field]: value } });
  const fid = field => `models-${id}-${field}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3} className="flex flex-wrap items-baseline gap-x-2">{name}<span className="text-sm font-normal text-muted-foreground">{hint}</span></CardTitle>
        <CardDescription className="break-words">
          {fill(COPY.current, { provider: label, model: effective.model || COPY.noModel, source: COPY.sources[effective.source] ?? effective.source })}
          {!effective.configured && effective.missing?.length ? <span className="block text-destructive">{fill(COPY.missingNow, { names: effective.missing.join("; ") })}</span> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={entry.inherit} onChange={() => (entry.inherit ? onChange({ inherit: false, provider: effective.provider, model: effective.model, options: { ...effective.options } }) : onChange({ ...entry, inherit: true }))} />{id === "utility" ? COPY.useEnvUtility : COPY.useEnv}<span className="sr-only">: {name}</span></label>
          {id !== "utility" && <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={enabled} onChange={onEnabled} />{COPY.shown}<span className="sr-only">: {name}</span></label>}
          {id !== "utility" && enabled && !overview.enabled.includes(id) && <p className="text-xs text-muted-foreground">{COPY.hidden}</p>}
        </div>
        {!entry.inherit && (
          <fieldset className="grid gap-3">
            <legend className="sr-only">{name}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={fid("provider")}>{COPY.provider}</Label>
                <select id={fid("provider")} className={select} value={entry.provider} onChange={event => pickProvider(event.target.value)}>
                  {providers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={fid("model")}>{COPY.model}</Label>
                <Input id={fid("model")} value={entry.model} list={suggestions.length ? fid("suggestions") : undefined} autoComplete="off" spellCheck={false} onChange={event => onChange({ ...entry, model: event.target.value })} />
                {suggestions.length > 0 && <datalist id={fid("suggestions")}>{suggestions.map(model => <option key={model} value={model} />)}</datalist>}
              </div>
              {(provider?.fields ?? []).map(field => (
                <div key={field} className="grid gap-1.5">
                  <Label htmlFor={fid(field)}>{COPY.fields[field]}</Label>
                  {field === "api"
                    ? <select id={fid(field)} className={select} value={entry.options.api || "responses"} onChange={event => setOption("api", event.target.value)}>{Object.entries(COPY.apis).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
                    : <Input id={fid(field)} value={entry.options[field] ?? ""} placeholder={COPY.placeholders[entry.provider]?.[field] ?? ""} autoComplete="off" spellCheck={false} inputMode={field === "baseURL" ? "url" : undefined} onChange={event => setOption(field, event.target.value)} />}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{COPY.hints[entry.provider]}</p>
            <EnvList provider={provider} options={entry.options} />
          </fieldset>
        )}
        <div className="grid gap-2">
          <div><Button type="button" size="sm" variant="outline" aria-label={`${result?.pending ? COPY.testing : COPY.test} ${name}`} aria-disabled={demo || result?.pending || undefined} title={demo ? COPY.demo : undefined} onClick={result?.pending ? undefined : onTest}><FlaskConical data-icon="inline-start" aria-hidden="true" />{result?.pending ? COPY.testing : COPY.test}</Button></div>
          <TestResult result={result} />
        </div>
      </CardContent>
    </Card>
  );
}

function QuickSetup({ providers, onFill }) {
  const [providerId, setProviderId] = React.useState(providers.find(item => item.ready)?.id ?? providers[0].id);
  const provider = providers.find(item => item.id === providerId);
  const [presetId, setPresetId] = React.useState("");
  const [model, setModel] = React.useState("");
  const [baseURL, setBaseURL] = React.useState("");
  const preset = provider.presets.find(item => item.id === presetId) ?? provider.presets[0];
  const single = !provider.presets.length;
  const apply = () => onFill(provider.id, single ? { luna: model, sol: model, astra: model } : preset.models, single && baseURL ? { baseURL } : {});
  return (
    <Card>
      <CardHeader><CardTitle role="heading" aria-level={3}>{COPY.quickTitle}</CardTitle><CardDescription>{COPY.quickBody}</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="models-quick-provider">{COPY.provider}</Label>
            <select id="models-quick-provider" className={select} value={providerId} onChange={event => { setProviderId(event.target.value); setPresetId(""); }}>
              {providers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          {single ? (
            <>
              <div className="grid gap-1.5"><Label htmlFor="models-quick-model">{COPY.allTiersModel}</Label><Input id="models-quick-model" value={model} placeholder="llama3.1:8b" autoComplete="off" spellCheck={false} onChange={event => setModel(event.target.value)} /></div>
              <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="models-quick-url">{COPY.fields.baseURL}</Label><Input id="models-quick-url" value={baseURL} inputMode="url" placeholder={COPY.placeholders["openai-compatible"].baseURL} autoComplete="off" spellCheck={false} onChange={event => setBaseURL(event.target.value)} /></div>
            </>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="models-quick-family">{COPY.family}</Label>
              <select id="models-quick-family" className={select} value={preset.id} onChange={event => setPresetId(event.target.value)}>
                {provider.presets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>
          )}
        </div>
        {!single && <p className="break-words text-xs text-muted-foreground">{KEYS.map(key => `${COPY.tiers[key][0]}: ${preset.models[key]}`).join(" · ")}</p>}
        <p className="text-xs text-muted-foreground">{COPY.hints[provider.id]}</p>
        <EnvList provider={provider} options={single && baseURL ? { baseURL } : {}} />
        <div><Button type="button" size="sm" variant="secondary" disabled={single && !model.trim()} onClick={apply}><Wand2 data-icon="inline-start" aria-hidden="true" />{COPY.fill}</Button></div>
      </CardContent>
    </Card>
  );
}

export default function ModelsTab({ demo = false }) {
  const [overview, setOverview] = React.useState(null);
  const [draft, setDraft] = React.useState(null);
  const [baseline, setBaseline] = React.useState("");
  const [state, setState] = React.useState({ busy: false, message: "", tone: "muted" });
  const [results, setResults] = React.useState({});
  const [confirmReset, setConfirmReset] = React.useState(false);
  const adopt = React.useCallback(data => {
    const next = toDraft(data);
    setOverview(data); setDraft(next); setBaseline(JSON.stringify(toSettings(data.providers, next)));
  }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    api("/api/admin/models", { signal: controller.signal })
      .then(adopt)
      .catch(error => { if (!controller.signal.aborted) setState({ busy: false, message: fill(COPY.failed, { reason: reasonFor(error) }), tone: "error" }); });
    return () => controller.abort();
  }, [adopt]);
  if (!overview || !draft) return state.message ? <p role="alert" className="text-sm text-destructive">{state.message}</p> : <Spinner />;

  const settings = toSettings(overview.providers, draft);
  const dirty = JSON.stringify(settings) !== baseline;
  const blocked = () => { if (demo) setState({ busy: false, message: COPY.demo, tone: "muted" }); return demo; };
  const setTier = (key, entry) => setDraft(current => (key === "utility" ? { ...current, utility: entry } : { ...current, tiers: { ...current.tiers, [key]: entry } }));
  const toggleEnabled = key => setDraft(current => ({ ...current, enabledSaved: true, enabled: current.enabled.includes(key) ? current.enabled.filter(item => item !== key) : [...current.enabled, key] }));
  const fillAll = (provider, models, options) => setDraft(current => ({ ...current, tiers: Object.fromEntries(KEYS.map(key => [key, { inherit: false, provider, model: models[key], options: { ...options } }])) }));
  const save = async () => {
    if (blocked()) return;
    setState({ busy: true, message: "", tone: "muted" });
    try { adopt(await api("/api/admin/models", { method: "PUT", body: JSON.stringify({ settings }) })); setResults({}); setState({ busy: false, message: COPY.saved, tone: "muted" }); }
    catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: reasonFor(error) }), tone: "error" }); }
  };
  const reset = async () => {
    if (blocked()) return;
    if (!confirmReset) { setConfirmReset(true); return; }
    setConfirmReset(false);
    setState({ busy: true, message: "", tone: "muted" });
    try { adopt(await api("/api/admin/models", { method: "DELETE" })); setResults({}); setState({ busy: false, message: COPY.resetDone, tone: "muted" }); }
    catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: reasonFor(error) }), tone: "error" }); }
  };
  const test = async key => {
    if (blocked()) return;
    const entry = key === "utility" ? draft.utility : draft.tiers[key];
    setResults(current => ({ ...current, [key]: { pending: true } }));
    try {
      const result = await api("/api/admin/models", { method: "POST", body: JSON.stringify({ tier: key, ...(entry.inherit ? {} : { config: clean(overview.providers, entry) }) }) });
      setResults(current => ({ ...current, [key]: result }));
    } catch (error) { setResults(current => ({ ...current, [key]: { ok: false, error: reasonFor(error) } })); }
  };
  const when = overview.updatedAt ? new Date(overview.updatedAt).toLocaleString() : "";
  return (
    <div className="grid min-w-0 gap-6">
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>{COPY.title}</CardTitle>
          <CardDescription className="grid max-w-3xl gap-1.5"><span>{COPY.body}</span><span>{COPY.docs}</span></CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm text-muted-foreground">
          <p>{overview.settings ? fill(COPY.savedBy, { who: overview.updatedBy || "—", when }) : COPY.usingEnv}</p>
        </CardContent>
      </Card>
      <QuickSetup providers={overview.providers} onFill={fillAll} />
      {[...KEYS, "utility"].map(key => (
        <TierEditor key={key} id={key} overview={overview} demo={demo}
          entry={key === "utility" ? draft.utility : draft.tiers[key]} onChange={entry => setTier(key, entry)}
          enabled={draft.enabled.includes(key)} onEnabled={() => toggleEnabled(key)}
          onTest={() => test(key)} result={results[key]} />
      ))}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="button" aria-disabled={demo || undefined} title={demo ? COPY.demo : undefined} disabled={state.busy || (!dirty && !demo)} onClick={save}><Save data-icon="inline-start" aria-hidden="true" />{state.busy ? COPY.saving : COPY.save}</Button>
        <Button type="button" variant={confirmReset ? "destructive" : "outline"} aria-disabled={demo || undefined} title={demo ? COPY.demo : undefined} disabled={state.busy || (!overview.settings && !demo)} onClick={reset} onBlur={() => setConfirmReset(false)}><RotateCcw data-icon="inline-start" aria-hidden="true" />{confirmReset ? COPY.confirmReset : COPY.reset}</Button>
        <p role={state.tone === "error" ? "alert" : "status"} className={`min-w-0 basis-full text-sm sm:basis-auto ${state.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>{state.message || (dirty ? COPY.unsaved : "")}</p>
      </div>
    </div>
  );
}
