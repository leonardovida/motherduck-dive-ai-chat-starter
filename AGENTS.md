# Set up this starter

When the user asks you to set up or adapt this repository, own the setup through a verified browser flow. Read [docs/agent-setup.md](docs/agent-setup.md) first. The user should supply credentials through their secret manager and choose an account or deployment target only when you cannot determine it safely.

## Start here

1. Inspect the checkout and preserve existing changes. Use Node 24–26. Run `npm ci`.
2. Run `npm run --silent setup -- --json`. It describes the first configured Dive by default. Use `--dive=<key>` for another entry and `--production` to include production sign-in requirements. Exit 1 means setup is incomplete; read `blockers` and `requirements`, or the `error` field when the config could not load.
3. Discover the intended saved Dive, its `REQUIRED_DATABASES`, service-account username, read-only chat database alias and region using the user's authorized MotherDuck connection. These are setup work for you. Do not ask the user to edit React code, config files or SQL manually.
4. Configure `dives.config.mjs` and runtime settings. Keep one working Dive for the initial setup. The included `dives/starter.tsx` is the fallback when there is no existing Dive. Read the connected MotherDuck tool's `get_dive_guide` before saving it, or use the [official Dive documentation](https://motherduck.com/docs/key-tasks/dives/). A populated database is needed for data questions.
5. Request only the missing credentials, by environment-variable name and destination. Prefer an existing managed environment. Never ask for secrets in chat. See the credential table in the setup guide.
6. Run `npm run --silent setup -- --live --json`, `npm test` and `npm run build`. Fix failures and repeat the affected check. Then start `npm run dev` and complete the browser acceptance checks below.

## Boundaries

- Reuse existing authorized resources and read-only identities. The embed token creates sessions; the chat token queries data. They serve different purposes. Never substitute an admin token for the read-only chat token.
- A setup request does not waive account, credential or access prompts required by your tools. If provisioning is needed, use current supported MotherDuck tools/docs and the intended organization. Obtain any required approval before creating accounts, tokens, shares or grants. If tools cannot provision a resource, provide the exact manual step and continue independent work.
- Store values in runtime secret management or an explicitly requested ignored local environment file. Never log tokens, embed-session URLs, database errors containing credentials or secret-manager contents. JSON diagnostics contain names and presence flags only. Share URLs also stay out of source control.
- Keep provider keys server-side. Preserve the SQL guard, read-only grants, origin checks and production password requirements.
- GitHub Actions secrets configure workflows only. Do not instruct users to put app runtime secrets there. Do not add a deployment service or another API proxy just for setup.
- Do not commit, push, publish, deploy, make the repository public or contact anyone unless the user explicitly requests that action. A request to run locally is enough to install dependencies, edit the local app and test it.

## Accounts mode, admin portal and SSO

Turn it on only when the user asks for per-person logins, an admin portal, SSO or saved conversations. Follow [docs/accounts.md](docs/accounts.md):

1. Ask which MotherDuck organization and database name should hold the app data, then get approval before creating the database or a service account. The app token (`MOTHERDUCK_APP_TOKEN`) is read-write for that one database only. Never use it as the chat token, and never use the chat token here.
2. Run `npm run db:migrate`, then `npm run admin:create -- --username=<name>`. Inject `ADMIN_PASSWORD` from the user's secret manager, or let the user type it at the prompt. Never choose, print or store an administrator password yourself.
3. For SSO, ask which identity provider the user wants. Give them the exact redirect URI (`<APP_URL>/api/account/callback/<provider id>`) to register, and the env names to add. Keep `AUTH_ALLOWED_EMAIL_DOMAINS` unset unless the user wants SSO to create accounts on first sign-in.
4. Saved conversations are on by default and announced in the chat panel. Tell the user, and ask whether they want `CHAT_HISTORY=off` or a `CHAT_RETENTION_DAYS` value.

## Models and routing

Chat works with `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or both. Ask which provider the user has. Do not ask them to choose model IDs: the defaults and Auto routing in [docs/model-routing.md](docs/model-routing.md) are the starting point. Change routing rules only with a test case in `test/model-router.test.mjs`.

## Settings reference

[docs/configuration.md](docs/configuration.md) explains every setting in plain language and says where each value comes from. Quote it, or link to it, when you tell a user which values to add.

## Upgrade a copy to a newer template version

When a user asks you to upgrade to a template version such as `v0.2.0`:

1. Read `CHANGELOG.md` and every `release-notes/v*.md` between the copy's version (`version` in `package.json`) and the target version. Pay most attention to the **Upgrading** and **Compatibility** sections.
2. Fetch the tag from `https://github.com/leonardovida/motherduck-dive-ai-chat-starter.git` and merge it, or cherry-pick from it, on a new branch. Keep the user's Dives, `dives.config.mjs` entries, branding and settings.
3. Apply any renamed or new settings in the user's secret manager or host, by name only.
4. Run the checks and the browser acceptance checks below, then report what changed.

Maintainers who cut releases follow [docs/releasing.md](docs/releasing.md).

## Acceptance checks

Use a browser, rather than treating a build or `configurationReady` as success:

- Sign in and render the real embedded Dive without setup/error cards.
- Open chat and ask a data question. Compare the answer with independent SQL using the same read-only identity. Expand the SQL receipt.
- Change a `useDiveState` selection and verify a follow-up reads it correctly.
- Stop a response, clear chat, and sign out. Check a phone-sized viewport and restore it afterward.
- In accounts mode, also sign in as the administrator and add a test person through the admin portal. Limit their Dives and chat, and confirm the restriction from their session. Find your test conversation under **Conversations**, then remove the test person.
- Report local setup, live API verification, browser verification and deployment as separate states. If a boundary is blocked, identify it and give the smallest remaining action.

Keep the result generic: no customer branding, datasets, identifiers or credentials in this template. See [docs/architecture.md](docs/architecture.md) for the existing design before adding infrastructure.
