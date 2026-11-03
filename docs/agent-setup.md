# Set up the starter with an agent

Give an agent access to this checkout and your authorized MotherDuck connection. Put credentials in your runtime secret manager. The agent handles resource discovery, configuration, code changes and verification.

## Give the agent this task

> Set up this repository for my MotherDuck Dive and AI chat. Follow AGENTS.md. Use my existing authorized MotherDuck connection and runtime secret manager. Discover the Dive, required resources, read-only identity, database alias and region. Configure the app, run the live setup checks and verify it in a browser against independent SQL. Ask me only for missing credentials, an ambiguous account choice or a required access approval. Keep it local and private until I request deployment or publication.

If you already know the intended Dive, name it in the prompt. Otherwise the agent should list the available Dives and resolve the choice with you.

## Add credentials in one place for local use

Use your managed runtime environment, such as a 1Password Environment. Inject its variables into commands launched from the repository root. The agent should check variable **names and presence**, rather than displaying their values. No secrets need to be pasted into a message or committed to GitHub.

| Variable | Purpose | Who supplies it |
| --- | --- | --- |
| `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` | Calls accessible OpenAI or Anthropic models from the server. One is enough. | You, through your secret manager. |
| `MOTHERDUCK_EMBED_TOKEN` | Creates embed sessions in the intended MotherDuck organization. | You or your authorized administrator, through your secret manager. |
| `MOTHERDUCK_CHAT_TOKEN` | Queries the chosen data with a read-only identity. | Reuse an existing scoped token, or have the agent provision one through an approved workflow. |

These are three credentials in **one runtime destination**. Per-person accounts add a fourth, optional credential, `MOTHERDUCK_APP_TOKEN`, a read-write token for the app's own database (see [accounts](accounts.md)). An existing MotherDuck connector helps the agent discover resources, but does not automatically supply tokens to this application's server. Embedding also requires the appropriate MotherDuck plan and service-account access.

The agent configures these settings for you:

| Setting | How the agent obtains it |
| --- | --- |
| `MOTHERDUCK_EMBED_USERNAME` | Exact existing read-only service-account username. |
| `DIVE_OVERVIEW_ID` | ID of the intended saved Dive, or the starter after saving it. |
| `DIVE_OVERVIEW_CHAT_DATABASE` | Database or attached-share alias visible to the chat identity. |
| `MOTHERDUCK_PG_HOST` | Postgres endpoint for the data's region; US East is the default. |
| Required resources | Read `REQUIRED_DATABASES` in the Dive and map matching aliases in `dives.config.mjs`. Supply private share URLs through runtime variables. The included data-free starter has no resources. |

Do not make the user copy these settings between files manually when the agent has authorized tools to discover and configure them. If `.env.local` is explicitly preferred, it is ignored by Git and read by Next.js and the setup command. Preserve existing values. Do not create or overwrite it without that preference.

## Let the agent finish local setup

The agent starts with:

```sh
npm ci
npm run --silent setup -- --json
```

The second command makes no network requests and changes no files. On an empty setup it exits **1** and returns the missing variable names. Its `requirements` entries distinguish `secret`, `private_setting` and ordinary `setting` values, with a source for the agent to use. Values never appear in the output.

The default target is the first entry in `dives.config.mjs`, currently Overview. `npm run setup` requires both embedding and AI chat. `npm run check:setup` also permits embed-only use. Select another entry with `--dive=explorer`; remove unused placeholders from the sidebar for the final app.

Once the values are injected and the config is ready:

```sh
npm run --silent setup -- --live --json
npm test
npm run build
npm run dev
```

The live check creates a test embed session, runs `SELECT 1` with the chat identity and checks access to the default OpenAI model. It makes no model generation request. `configurationReady` describes the local values; `connectionsVerified` describes these live API checks. Neither proves that the browser or an AI answer works.

Open http://localhost:3000, sign in with `duckdemo` in development unless a password was configured, and complete the acceptance checks in AGENTS.md. A real chat question calls OpenAI and can incur usage. The agent should report the SQL result and matching answer, plus any remaining blocker.

## Add a second destination only when deploying

When you request deployment, configure the same runtime values in the hosting platform's **server-side environment settings**. The agent also generates a strong `DEMO_PASSWORD` and a random `SESSION_SECRET` of at least 32 characters directly into that secret manager through its supported secret-generation mechanism. The agent should not print generated values or put them into shell arguments. Use your secret manager to retrieve the sign-in password.

```sh
npm run --silent setup -- --production --live --json
```

Run that check with the deployed runtime values injected. A local check does not configure the host. Production needs HTTPS and must pass browser checks at its real URL. If the agent has no supported secret-generation or deployment access, it should identify the exact destination and names for you to add, then continue verification when available.

The agent also configures the host's trusted client-IP source. On Vercel, `VERCEL=1` selects the platform-overwritten `x-forwarded-for` header automatically ([contract](https://vercel.com/docs/headers/request-headers#x-forwarded-for)). On other hosts, set `AUTH_TRUSTED_IP_HEADER` only to a single-IP header the trusted proxy overwrites on every request. This is a non-secret deployment setting. The production setup check reports it missing when needed; sign-in refuses to use a shared fallback.

**GitHub Actions secrets are optional and separate.** The application does not read them. CI tests and builds need no credentials. Add `OPENAI_API_KEY` there only if you choose to use the optional workflow smoke test. There is no required third copy of every app secret in GitHub.

## What completion looks like

The agent leaves a configured app, passing tests/build, successful live connection checks, and a verified browser flow with one SQL-backed answer and a state-aware follow-up. It reports which secrets still need supplying if access is blocked. It does not promise that arbitrary data, an unprovisioned account or a hosted deployment works just because the interface starts.
