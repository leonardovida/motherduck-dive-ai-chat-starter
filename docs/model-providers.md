# Model providers

The AI chat can run on any of these providers:

| Provider | Choose it when | Credentials (environment only) |
| --- | --- | --- |
| [OpenAI](#openai) | You have an OpenAI API key. This is the default. | `OPENAI_API_KEY` |
| [Anthropic](#anthropic) | You have an Anthropic API key. | `ANTHROPIC_API_KEY` |
| [OpenRouter](#openrouter) | You want one key for models from many vendors. | `OPENROUTER_API_KEY` |
| [Azure OpenAI / Microsoft Foundry](#azure-openai-and-microsoft-foundry) | Your organization runs models in Azure. | `AZURE_API_KEY` |
| [Amazon Bedrock](#amazon-bedrock) | Your organization runs models in AWS. | `AWS_BEARER_TOKEN_BEDROCK`, or `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` |
| [Google Vertex AI](#google-vertex-ai) | Your organization runs models in Google Cloud (Gemini, or Claude on Vertex AI). | A service-account key, or the runtime's own Google identity |
| [Self-hosted or other OpenAI-compatible](#self-hosted-and-other-openai-compatible-endpoints) | You run vLLM, Ollama, LM Studio, TGI, LiteLLM or a similar server. | `OPENAI_COMPATIBLE_API_KEY`, if the server needs one |

Each of the three chat tiers (**Luna**, fast; **Sol**, balanced; **Astra**, deep analysis) and the **utility model** (Auto routing and suggested questions) uses one provider and one model. Tiers can use different providers. [model-routing.md](model-routing.md) explains the tiers and how Auto picks one.

## Where settings come from

Credentials are always environment variables, set in your host's environment or secret manager. They are never stored in the app database, never typed into the admin portal and never returned by any API.

The non-secret choices (provider, model id, base URL, region, resource name, project, location, which tiers appear in the picker, and the utility model) are read in this order:

1. **The admin Models tab**, when [accounts mode](accounts.md) is on. Saved choices apply within about 15 seconds, without a restart. A tier left on "Use the environment" skips this step.
2. **Environment variables**: `CHAT_PROVIDER`, `CHAT_MODEL_LUNA`, `CHAT_MODEL_SOL`, `CHAT_MODEL_ASTRA`, `CHAT_MODEL_UTILITY`, `CHAT_MODELS` and the provider variables on this page.
3. **Built-in defaults**, listed below.

Without accounts mode, only environment variables and defaults apply.

When `CHAT_PROVIDER` is not set, the first provider whose variables are present is used, in this order: OpenAI, Anthropic, OpenRouter, Azure, Bedrock (only when `AWS_BEARER_TOKEN_BEDROCK` and `AWS_REGION` are set), Vertex AI, self-hosted. A deployment that already has `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` keeps working exactly as before. AWS runtimes often carry access keys for other purposes, so those keys alone never switch the chat to Bedrock: set `CHAT_PROVIDER=bedrock`.

`CHAT_MODEL_<TIER>` takes `provider:model-id` (for example `bedrock:global.anthropic.claude-sonnet-5-5`) or a bare model id for the default provider. Model ids may contain colons, such as `llama3.1:8b`. `CHAT_PROVIDER` also accepts `amazon-bedrock`, `azure-openai`, `google-vertex` and `self-hosted`.

## Default models

| Tier | OpenAI | Anthropic | OpenRouter | Azure (deployment names) | Bedrock | Vertex AI |
| --- | --- | --- | --- | --- | --- | --- |
| Luna | `gpt-6-luna` | `claude-haiku-5-5` | `openai/gpt-6-luna` | `gpt-6-luna` | `global.anthropic.claude-haiku-5-5` | `gemini-3.5-flash-lite` |
| Sol | `gpt-6.1-sol` | `claude-sonnet-5-5` | `openai/gpt-6.1-sol` | `gpt-6.1-sol` | `global.anthropic.claude-sonnet-5-5` | `gemini-3.8-flash` |
| Astra | `gpt-6-astra` | `claude-opus-5-5` | `openai/gpt-6-astra` | `gpt-6-astra` | `global.anthropic.claude-opus-5-5` | `gemini-4-argon` |

Self-hosted endpoints have no default: name the model with `OPENAI_COMPATIBLE_MODEL` (used for every tier), a `CHAT_MODEL_<TIER>` value or the Models tab. The utility model defaults to the fastest enabled tier.

The ids come from each provider's published model list as of November 2026: [OpenAI models](https://platform.openai.com/docs/models), [Claude models overview](https://platform.claude.com/docs/en/models/overview), [OpenRouter models](https://openrouter.ai/models), [Bedrock model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html) and [Vertex AI models](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models). Check that your account has access to the models you use.

## Tool calling is required

The assistant answers by calling tools (read the Dive state, list and describe tables, run read-only SQL). Every model you choose must support tool calling, also called function calling. The **Test** button in the Models tab reports whether a model called a tool.

Reasoning effort (low for Luna, medium for Sol, high for Astra) is sent to providers that support it and ignored by models that do not. Self-hosted endpoints never receive a reasoning setting, because many servers reject fields they do not know.

## OpenAI

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes | [platform.openai.com](https://platform.openai.com) > your project > API keys. |
| `OPENAI_BASE_URL` | No | A compatible gateway that implements the OpenAI Responses API, including `/v1`. For servers that only implement Chat Completions, use the [self-hosted provider](#self-hosted-and-other-openai-compatible-endpoints). |

```bash
OPENAI_API_KEY=
```

## Anthropic

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | [platform.claude.com](https://platform.claude.com) > Settings > API keys. |
| `ANTHROPIC_BASE_URL` | No | A compatible gateway, including `/v1`. |

```bash
ANTHROPIC_API_KEY=
CHAT_PROVIDER=anthropic   # only needed when OPENAI_API_KEY is also set
```

## OpenRouter

OpenRouter gives one key for models from OpenAI, Anthropic, Google and others. The app talks to it through its OpenAI-compatible Chat Completions API.

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Yes | [openrouter.ai/keys](https://openrouter.ai/keys). Add credit to the account first. |
| `OPENROUTER_BASE_URL` | No | Only for a proxy in front of OpenRouter. The default is `https://openrouter.ai/api/v1`. |

Steps:

1. Create a key at openrouter.ai/keys and store it as `OPENROUTER_API_KEY`.
2. Optionally pick models at [openrouter.ai/models](https://openrouter.ai/models). Use models whose page lists tool support. Ids look like `anthropic/claude-sonnet-5.5`.

```bash
OPENROUTER_API_KEY=
# Optional: other models than the GPT-6 defaults
# CHAT_MODEL_LUNA=openrouter:anthropic/claude-haiku-5.5
# CHAT_MODEL_SOL=openrouter:anthropic/claude-sonnet-5.5
# CHAT_MODEL_ASTRA=openrouter:anthropic/claude-opus-5.5
```

The key is sent only to `openrouter.ai` or to `OPENROUTER_BASE_URL`. A different base URL typed into the Models tab receives no key.

## Azure OpenAI and Microsoft Foundry

In Azure, you call a **deployment** by the name you gave it, so the model id for each tier is a deployment name.

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `AZURE_API_KEY` | Yes | Azure portal > your Azure OpenAI or Foundry resource > Keys and Endpoint > KEY 1. |
| `AZURE_RESOURCE_NAME` | One of these two | The first part of the resource's endpoint: for `https://my-resource.openai.azure.com`, it is `my-resource`. |
| `AZURE_BASE_URL` | One of these two | The full endpoint instead of the name, for example `https://my-resource.services.ai.azure.com/openai/v1` or a Foundry project URL ending in `/openai/v1`. |
| `AZURE_API_VERSION` | No | Defaults to `v1`. Set it only if your resource needs a dated version. |

Steps:

1. In the [Foundry portal](https://ai.azure.com), deploy the models you want, for example `gpt-6-luna`, `gpt-6.1-sol` and `gpt-6-astra`. Giving each deployment the same name as the model lets the defaults work without overrides.
2. Copy the key and the resource name (or endpoint) from the Azure portal into your secret manager.
3. If your deployment names differ, set them per tier.

```bash
AZURE_API_KEY=
AZURE_RESOURCE_NAME=my-resource
CHAT_PROVIDER=azure
# Deployment names, when they differ from the defaults
# CHAT_MODEL_LUNA=azure:my-fast-deployment
```

Requests use the Responses API. For a deployment that only supports Chat Completions, choose **Chat Completions** under API for that tier in the Models tab. The key is sent only to Azure hosts (`*.openai.azure.com`, `*.services.ai.azure.com`, `*.cognitiveservices.azure.com`) or to `AZURE_BASE_URL`.

## Amazon Bedrock

The app uses the Bedrock Converse API. Current Claude models on Bedrock are called through a cross-Region inference profile: `global.` routes worldwide, and geographic profiles such as `us.` or `eu.` keep requests in one geography. Each model card in the [Bedrock documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html) lists the profile ids it supports.

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `AWS_BEARER_TOKEN_BEDROCK` | This, or the two keys below | Amazon Bedrock console > API keys > Generate long-term API key. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Instead of the API key | An IAM user or role allowed to call `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the models and inference profiles. |
| `AWS_SESSION_TOKEN` | With temporary keys | Set automatically by most AWS runtimes. |
| `AWS_REGION` | Yes | The region you call Bedrock in, for example `us-east-1` or `eu-central-1`. It can also be set per tier in the Models tab. |

Steps:

1. In the Bedrock console, open **Model access** and request access to the models you need.
2. Create a Bedrock API key, or use IAM keys with the permissions above.
3. Set `CHAT_PROVIDER=bedrock` and the variables above.

```bash
CHAT_PROVIDER=bedrock
AWS_REGION=us-east-1
AWS_BEARER_TOKEN_BEDROCK=
# For data residency, use a geographic profile, for example:
# CHAT_MODEL_SOL=bedrock:eu.anthropic.claude-sonnet-5-5
```

## Google Vertex AI

Gemini models are the default. Claude models on Vertex AI work too: use a model id that starts with `claude-`, such as `claude-sonnet-5-5`, after enabling the model in Model Garden.

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `GOOGLE_VERTEX_PROJECT` | Yes | Your Google Cloud project ID (not its name or number). It can also be set per tier in the Models tab. |
| `GOOGLE_VERTEX_LOCATION` | No | Defaults to `global`. The default Gemini models also accept the `us` and `eu` multi-regions. Other models may need a region such as `us-central1`; each model's page lists its locations. |
| `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` | One credential option | The `client_email` and `private_key` fields of a service-account JSON key. Use this on hosts without files, such as Vercel. The key may keep its `\n` escapes. |
| `GOOGLE_APPLICATION_CREDENTIALS` | One credential option | The path to the service-account JSON key file, where the host supports files. |
| `GOOGLE_VERTEX_ADC` | One credential option | `true` on Google Cloud runtimes (Cloud Run, GKE, Compute Engine) that run as a service account. No key is needed. |
| `GOOGLE_VERTEX_API_KEY` | One credential option, Gemini only | A Vertex AI express-mode API key. |

Steps:

1. In the Google Cloud console, enable the **Vertex AI API** for the project.
2. Create a service account with the **Vertex AI User** role (`roles/aiplatform.user`), then create a JSON key for it. On Google Cloud runtimes, attach the service account to the service instead and set `GOOGLE_VERTEX_ADC=true`.
3. For Claude models, enable each one in Model Garden.
4. Store the values in your secret manager.

```bash
CHAT_PROVIDER=vertex
GOOGLE_VERTEX_PROJECT=my-project
GOOGLE_CLIENT_EMAIL=chat-assistant@my-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=
# Claude on Vertex AI instead of Gemini:
# CHAT_MODEL_LUNA=vertex:claude-haiku-5-5
# CHAT_MODEL_SOL=vertex:claude-sonnet-5-5
# CHAT_MODEL_ASTRA=vertex:claude-opus-5-5
```

## Self-hosted and other OpenAI-compatible endpoints

Any server that implements the OpenAI Chat Completions API with streaming and tool calls works: vLLM, Ollama, LM Studio, Hugging Face TGI, a LiteLLM proxy, or a hosted service with an OpenAI-compatible API. One base URL and one model can serve every tier.

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `OPENAI_COMPATIBLE_BASE_URL` | Yes | The server's address, including `/v1`. It can also be set in the Models tab. |
| `OPENAI_COMPATIBLE_MODEL` | Yes, unless set per tier | The model name the server expects. Used for every tier without its own model. |
| `OPENAI_COMPATIBLE_API_KEY` | If the server needs one | The token your server checks, sent as `Authorization: Bearer`. |

Typical base URLs:

| Server | Base URL | Notes |
| --- | --- | --- |
| vLLM | `http://<host>:8000/v1` | Start it with `--enable-auto-tool-choice` and the `--tool-call-parser` for your model ([vLLM tool calling](https://docs.vllm.ai/en/stable/features/tool_calling/)). `--api-key` sets the token. |
| Ollama | `http://<host>:11434/v1` | Use a model with tool support, for example `qwen3:8b`. No key. |
| LM Studio | `http://<host>:1234/v1` | Start the local server in LM Studio. No key. |
| Hugging Face TGI | `http://<host>:8080/v1` | The model must support tools. |
| LiteLLM proxy | `http://<host>:4000/v1` | Use a model name from your proxy configuration and a LiteLLM key. |

```bash
CHAT_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=http://vllm.internal:8000/v1
OPENAI_COMPATIBLE_MODEL=Qwen/Qwen3-32B
OPENAI_COMPATIBLE_API_KEY=
```

The server must be reachable from where the app runs. A hosted app (for example on Vercel) cannot reach `localhost` on your laptop or a private network without a tunnel or a private connection.

`OPENAI_COMPATIBLE_API_KEY` is sent only to `OPENAI_COMPATIBLE_BASE_URL`. A base URL typed into the Models tab gets no key, which suits keyless servers such as Ollama. For a server that needs a key, put its URL in `OPENAI_COMPATIBLE_BASE_URL`.

The app does not ask a self-hosted server for token counts while it streams, because some servers refuse fields they do not know. Answers from a server that does not report usage on its own are saved without token counts, so they do not count toward a group's monthly allowance or the estimated cost.

## The admin Models tab

In accounts mode, administrators open **Admin > Models** (`/admin#models`). Group managers do not see it.

1. **Check what runs now.** Each tier card shows its provider and model and where they come from: saved here, environment variables, or built-in default. Missing environment variables are listed by name.
2. **Quick setup.** Pick a provider and a model family, or for a self-hosted server enter one base URL and one model, then press **Fill all tiers**. This fills the form only.
3. **Adjust a tier.** Untick **Use the environment for this tier** to choose its provider, model and fields: base URL (self-hosted, OpenRouter, Azure), Azure resource name, API version and API, AWS region, Google Cloud project and location. Model suggestions appear as you type. Below the fields, each environment variable the provider reads is shown as set or missing, never with its value.
4. **Choose the picker tiers.** **Show in the chat picker** limits the tiers people can choose, like `CHAT_MODELS`. A tier that cannot answer yet stays hidden until it is configured.
5. **Test.** Sends one short prompt with one tool from the server and reports whether the model answered and called the tool, how long it took, or the provider's error with any credential removed. Test works on unsaved changes, spends a few tokens and is limited to 10 tests a minute.
6. **Save.** Saved choices apply to new chat requests within about 15 seconds on every server instance.
7. **Reset to environment defaults** removes every saved choice, so environment variables and defaults apply again.

Saving and resetting require an administrator and a request from the app's own origin, are refused in a [public demo](accounts.md#run-a-public-demo), and appear under **Activity** with the providers and model ids chosen. The settings are stored in the `app_setting` table that `npm run db:migrate` creates. Values that look like keys or passwords, URLs with a user name, password or query string, and URLs that are not `http` or `https` are refused.

## Troubleshooting

| Test result | What to check |
| --- | --- |
| Missing environment variables | Add the names listed to your host's environment or secret manager, then redeploy or restart if your host requires it. |
| HTTP 401 | The key is wrong, expired or for another account. |
| HTTP 403 | The key or identity lacks access to this model, deployment or region. On Bedrock, request model access. On Vertex AI, check the service account's role. |
| HTTP 404 | The model id, Azure deployment name, Bedrock inference profile, region or location is wrong. |
| Answered but did not call a tool | The model does not support tool calling, or a self-hosted server needs tool calling turned on. Choose another model. |
| Timeout or connection error | The base URL is unreachable from where the app runs. |

`npm run --silent setup -- --json` lists the variables the default provider needs. Its live check (`--live`) verifies OpenAI and Anthropic keys; use **Test** for the other providers.
