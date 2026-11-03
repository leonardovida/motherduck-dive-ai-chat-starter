# Models, providers and automatic routing

The chat works with **OpenAI**, **Anthropic** or both. With **Auto** routing, simple questions go to a small, fast and cheap model, and harder questions go to a larger one.

## Providers and tiers

There are three tiers. Each tier maps to one provider and model:

| Tier | OpenAI default | Anthropic default | Reasoning | Steps | Typical questions |
| --- | --- | --- | --- | --- | --- |
| **Luna** | `gpt-6-luna` | `claude-haiku-5-5` | low | 6 | "What does this Dive show?", "Which tables are there?" |
| **Sol** | `gpt-6.1-sol` | `claude-sonnet-5-5` | medium | 8 | Comparisons, trends, rankings, one or two aggregations |
| **Astra** | `gpt-6-astra` | `claude-opus-5-5` | high | 10 | "Why did churn rise?", multi-part analysis, statistics |

| Setting | Effect |
| --- | --- |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Enables that provider. Set one or both. |
| `CHAT_PROVIDER=anthropic` | The provider for tiers without an override. Without it, OpenAI is used when its key is set, otherwise Anthropic. |
| `CHAT_MODEL_LUNA=anthropic:claude-haiku-5-5` | Overrides one tier. Use `provider:model`, or a bare model ID for the default provider. Providers can be mixed: a cheap Anthropic Luna with an OpenAI Astra works. |
| `CHAT_MODELS=luna,sol` | Limits the tiers people can pick, for example to cap spend. (`OPENAI_CHAT_MODELS` still works.) |
| `CHAT_DEFAULT_MODEL=auto` | The default choice in the picker: `auto`, a tier, or a model ID. (`OPENAI_MODEL` still works.) |
| `CHAT_ROUTER=off` | Removes Auto. With two or more tiers, Auto is on and is the default. |
| `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` | Sends requests to a compatible gateway or router instead (see [external routers](#use-an-external-router)). |

Tiers whose provider has no key are hidden. The browser only ever sends a tier name or `auto`. Model IDs, providers and limits stay on the server, in [`lib/chat-models.mjs`](../lib/chat-models.mjs).

## How Auto decides

Auto runs in three stages ([`lib/model-router.mjs`](../lib/model-router.mjs)):

1. **Rules (free, instant).** Clear cases are decided by patterns in the question:
   - Lookups about the Dive or the schema go to Luna.
   - Two or more aggregation or comparison signals ("compare", "trend", "top 5", "per month", "vs") go to Sol.
   - "Why" questions, drivers, forecasts, cohorts, anomalies, multi-part questions and very long questions go to Astra.
   - A short follow-up such as "and for March?" keeps the tier of the previous answer.
2. **Classifier (one tiny call).** When the signals are mixed, the cheapest tier labels the question `simple`, `moderate` or `complex` through a constrained choice of at most 16 output tokens with a 2.5-second timeout. If the call fails, Sol answers.
3. **Escalation (while answering).** Before each step, a struggling cheaper model hands over to the next tier:
   - Luna escalates after one failed tool call or four steps.
   - Sol escalates after two failures or six steps.

   A cheap model that needs three retries is rarely cheaper overall.

Every answer records its tier and a reason, such as `rules: lookup about the Dive or schema`, `classifier: complex` or `escalated: 1 failed tool call`. People see the tier on Auto answers (hover for the reason). Administrators see the reason, model, provider, tokens and time for every saved answer in the [admin portal](accounts.md#the-admin-portal), which makes it practical to tune the rules from real questions.

### Tuning

- To route more to the cheap tier, add patterns to `SIMPLE` in `lib/model-router.mjs`. For more analytical routing, add to `ANALYTICAL` or `DEEP`.
- To change when escalation happens, edit the limits in `escalation()`.
- `test/model-router.test.mjs` holds example questions. Add the real questions that were misrouted, so a change cannot silently undo a fix.

## Use an external router

The built-in router needs no extra service. If you already run a gateway or a trained router, point the provider at it:

| Router | How | Notes |
| --- | --- | --- |
| [LiteLLM proxy](https://docs.litellm.ai/docs/proxy/auto_routing) | `OPENAI_BASE_URL=https://litellm.example.com/v1` and a tier override such as `CHAT_MODEL_SOL=openai:auto-router` | Self-hosted. Its complexity router scores questions without a model call. |
| [vLLM Semantic Router](https://github.com/vllm-project/semantic-router) | `OPENAI_BASE_URL` pointing at the proxy | Self-hosted. Policy-driven, with open routing models. |
| [Katanemo Plano / Arch-Router](https://github.com/katanemo/plano) | `OPENAI_BASE_URL` pointing at the proxy | Self-hosted. Small routing models; check their weight license. |
| [OpenRouter Auto Router](https://openrouter.ai/docs/guides/routing/routers/auto-router) | `OPENAI_BASE_URL=https://openrouter.ai/api/v1` with `CHAT_MODEL_SOL=openai:openrouter/auto` | Hosted, no router fee. It routes by task type and popularity rather than difficulty. |
| [Not Diamond](https://docs.notdiamond.ai) | Call its model-select API in `routeQuestion()` | Hosted. Can be trained on your own evaluations. Paid beyond a free tier. |

Set `CHAT_ROUTER=off` when an external router picks the model, so the two do not compete.

## Why it is built this way

The design follows a survey of routing options in October 2026:

- The **AI SDK** can change the model between steps (`prepareStep`) and constrain a classifier to a fixed set of labels (`Output.choice`). That makes in-process routing simple and free of extra dependencies. Its experimental `experimental_decide` helper was not used, so an SDK patch release cannot break routing.
- **Rules before a classifier** mirrors LiteLLM's complexity router and Vercel's [cost-aware routing guide](https://vercel.com/kb/guide/cost-aware-model-routing-with-ai-gateway). Most questions cost nothing to route.
- **Escalation during the answer** follows NVIDIA's [Switchyard](https://github.com/NVIDIA-NeMo/Switchyard) observation that a cheaper call does not guarantee a cheaper finished task, which matters for agents that use tools.
- **Not used:**
  - [RouteLLM](https://github.com/lm-sys/RouteLLM): not updated since 2024.
  - Martian: no documented router any more.
  - NVIDIA's LLM Router blueprint: deprecated in favor of Switchyard, which is still alpha.

## Possible next steps

- **Measure.** Export saved conversations and compare cost and answer quality by tier, to tune the thresholds.
- **Learn from feedback.** Add thumbs up and down to answers and store them next to the routing reason.
- **Train a router.** With enough labelled questions, swap the classifier for an embedding or trained router, such as Not Diamond or a small local model, behind the same `routeQuestion()` interface.
