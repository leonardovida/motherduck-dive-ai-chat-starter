# Configuration reference

This page lists every setting the starter reads, explains where each value comes from, and shows how to add dashboards or change the AI models. To get started, see the [README](../README.md). If a coding agent is setting things up for you, point it at [AGENTS.md](../AGENTS.md).

Settings are environment variables. For local use, put them in your secret manager or in an ignored `.env.local` file. For a deployment, put them in your host's **server-side** environment settings, such as Vercel → Project → Settings → Environment Variables. None of them belong in Git, and GitHub Actions secrets do not configure the running app.

To see which settings are missing, without printing any values, run:

```sh
npm run --silent setup -- --json              # local
npm run --silent setup -- --json --production # also checks sign-in settings
```

## Settings

### Sign-in

| Setting | Required | What it is | Where it comes from |
| --- | --- | --- | --- |
| `DEMO_PASSWORD` | In production, without accounts | The shared password viewers type to open the app. Locally, `duckdemo` works until you set it. Not used in [accounts mode](accounts.md). | You choose it. Use a long random value and store it in your secret manager. |
| `SESSION_SECRET` | In production | Signs the sign-in cookies. Must be at least 32 characters. | Generate it with `openssl rand -hex 32`. Nobody needs to remember it. |
| `AUTH_TRUSTED_IP_HEADER` | Only on non-Vercel hosts | A request header that your proxy overwrites with the visitor's IP address, used to limit failed sign-in attempts. | Your hosting provider's documentation, for example `x-real-ip`. Vercel is detected automatically. |
| `APP_TITLE` | No | The name shown in the header and browser tab. | You choose it. |

### Dashboard (embedded Dive)

| Setting | Required | What it is | Where it comes from |
| --- | --- | --- | --- |
| `MOTHERDUCK_EMBED_TOKEN` | Yes | Lets the server open short-lived embed sessions for your MotherDuck organization. It never reaches the browser. | A MotherDuck token allowed to create embed sessions. Embedding requires a MotherDuck plan that supports embedded Dives. |
| `MOTHERDUCK_EMBED_USERNAME` | Yes | The **read-only service account** the embedded Dive runs as. Viewers see only what this account can read. | The exact username of a service account in the same organization. |
| `DIVE_OVERVIEW_ID` | Yes | The ID of the saved Dive to show. | The Dive's URL in MotherDuck, or `list_dives` in the MotherDuck MCP server. The included `dives/starter.tsx` can be saved as a first Dive. |
| `DIVE_OVERVIEW_VERSION` | No | Pins a specific saved version of the Dive, so later edits do not appear until you update the pin. | The Dive's version history. |
| `DIVE_OVERVIEW_SHARE_URL` | Only if your Dive needs it | A share the Dive reads, listed in its `REQUIRED_DATABASES`. | The share's `md:_share/...` URL. Keep it out of Git. |

### Accounts, admin portal and SSO

Optional. Setting `MOTHERDUCK_APP_TOKEN` switches from the shared password to per-person accounts. [docs/accounts.md](accounts.md) has the full guide.

| Setting | Required | What it is | Where it comes from |
| --- | --- | --- | --- |
| `MOTHERDUCK_APP_TOKEN` | For accounts | A **read-write** MotherDuck token for the app's own database (accounts, sessions, saved conversations). Never the chat token. | A service account that owns only the app database. |
| `APP_DATABASE` | No | The app database's name. The default is `dive_chat_app`. | You choose it. `npm run db:migrate` creates the tables. |
| `APP_URL` | In production off Vercel | The public address, used for SSO redirects and request-origin checks. | Your domain, for example `https://dives.example.com`. |
| `CHAT_HISTORY` | No | `off` stops saving conversations. They are saved by default in accounts mode. | You choose it. |
| `CHAT_RETENTION_DAYS` | No | Deletes saved messages older than this many days. | Your data-retention policy. |
| `SSO_ISSUER` or `SSO_DISCOVERY_URL`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET` | For SSO | Any OpenID Connect provider. `SSO_LABEL` sets the button text. | Your identity provider's app registration. |
| `OKTA_*`, `MICROSOFT_*`, `GOOGLE_*`, `GITHUB_*` | No | Ready-made providers. See [Single sign-on](accounts.md#single-sign-on). | The provider's console. |
| `AUTH_ALLOWED_EMAIL_DOMAINS` | No | Lets SSO create accounts for these domains, separated by commas. Without it, only existing accounts can use SSO. | Your company domains. |

### AI chat

| Setting | Required | What it is | Where it comes from |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` | For chat | Calls the AI models from the server. Set one or both. | Your OpenAI project's or Anthropic Console's API keys page. |
| `MOTHERDUCK_CHAT_TOKEN` | For chat | A **read-only** MotherDuck token the assistant uses to run SQL. Its grants decide what chat can see. | A token for a read-only service account that can read only the chat database. Never use an admin token here. |
| `DIVE_OVERVIEW_CHAT_DATABASE` | For chat | The database or attached share the assistant may query. | The database alias as the chat identity sees it, for example `sample_data`. |
| `MOTHERDUCK_PG_HOST` | No | The MotherDuck Postgres endpoint for your data's region. | The default is `pg.us-east-1-aws.motherduck.com`. Change it if your organization is in another region. |
| `CHAT_PROVIDER`, `CHAT_MODEL_LUNA`, `CHAT_MODEL_SOL`, `CHAT_MODEL_ASTRA` | No | Which provider and model each tier uses, for example `anthropic:claude-haiku-5-5`. | See [Models](#models). |
| `CHAT_DEFAULT_MODEL` | No | The default picker choice: `auto`, `luna`, `sol` or `astra`. `OPENAI_MODEL` is the earlier name. | Auto is the default when two or more tiers are enabled. |
| `CHAT_MODELS` | No | The tiers shown in the model picker, separated by commas, for example `luna,sol`. `OPENAI_CHAT_MODELS` is the earlier name. | All three are shown when this is unset. |
| `CHAT_ROUTER` | No | `off` removes the Auto choice. | See [Models](#models). |
| `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` | No | A compatible endpoint or router, including `/v1`. | Your gateway. |
| `CHAT_FOLLOW_UPS` | No | Set it to `true` to suggest follow-up questions. This makes one extra model request per answer. | Off by default. |

The Explorer entry uses the same pattern with `DIVE_EXPLORER_*` names. Remove it from `dives.config.mjs` if you only need one dashboard.

## Models

Chat has three tiers: **Luna** (fast), **Sol** (balanced) and **Astra** (deep analysis). There is also **Auto**, which picks a tier for each question. Each tier can use OpenAI or Anthropic. [docs/model-routing.md](model-routing.md) covers the defaults, mixing providers, how Auto decides, and how to plug in an external router.

Check that your provider account can use the models you enable. `npm run --silent setup -- --live --json` checks access to the default model without generating an answer.

## Add another dashboard

Each entry in [`dives.config.mjs`](../dives.config.mjs) adds a dashboard to the sidebar. Copy an entry, give it a unique `key`, and point its settings at your Dive and chat database:

```js
{
  key: 'sales',
  title: 'Sales',
  description: 'Revenue by month and region.',
  icon: 'chart-line',
  diveIdEnv: 'DIVE_SALES_ID',
  resources: [{ urlEnv: 'DIVE_SALES_SHARE_URL', alias: 'sales' }],
  chat: {
    tokenEnv: 'MOTHERDUCK_CHAT_TOKEN',
    databaseEnv: 'DIVE_SALES_CHAT_DATABASE',
  },
  starters: ['Which region grew fastest?'],
}
```

- `resources` must match the Dive's `REQUIRED_DATABASES`. Each `alias` must match the catalog name the Dive's SQL uses.
- `chat` is optional. Leave it out to show the Dive without the assistant. To scope a dashboard to different data, give it its own read-only token by naming another `tokenEnv`.
- `starters` are the suggested questions in an empty chat.
- `linkHosts` lists the hostnames a Dive may open in a new tab.

Account identifiers, tokens and share URLs never go in this file. It stores only the **names** of the settings that hold them.

## Make chat aware of what viewers select

The assistant can read any value the Dive stores with `useDiveState`, such as a selected region or date range. Store your filters that way and chat will answer follow-ups like "what about this region?" correctly. The included starter Dive shows the pattern with `example_choice`.

## Security model in plain terms

- **Data access** is decided by the read-only MotherDuck identities and their grants, not by prompts or browser filters.
- **Keys and tokens** stay on the server. The browser receives only a short-lived embed session.
- **SQL from chat** is limited to one read-only statement. Writes, file readers, external locations and dynamic SQL are refused.
- **Sign-in** is either one shared password (demos) or per-person [accounts](accounts.md) with roles, per-Dive access and optional SSO. For a multi-tenant product, also map each signed-in customer to their own data identities on the server.

[docs/architecture.md](architecture.md) has the full design.
