# Architecture and boundaries

## Request paths

The browser asks `/api/dives` for a sanitized list of configured Dives. It names a Dive key when asking `/api/embed` for a short-lived session. The server resolves that key to a saved Dive, service account and required resources. Only the resulting session reaches the iframe, in the URL fragment.

The host accepts `dive-state-update` only from the current iframe at `https://embed-motherduck.com`. State is small JSON context for chat, not a trusted access policy. Navigation requests require an explicit `linkHosts` allowlist and a user click. Export bytes are checked for source, format, filename and size before download.

Chat uses the OpenAI Responses API through AI SDK. Four tools expose the current state, table discovery, table descriptions and SQL execution. A lazy reader belongs to one response only; it is reused across tools and closed in `finally` or on cancellation. There is no cross-user database connection pool.

## Credentials and data access

Keep the embed token, chat token and OpenAI key in a server-side runtime secret store. GitHub Actions secrets configure workflows only. `.env.local` is ignored for local development.

The read-only MotherDuck identity and its data grants are the authoritative access boundary. The SQL scanner refuses common write, external-reader and dynamic-SQL forms, but is not a full SQL parser or a substitute for database permissions and platform controls. Results and transcript/request sizes are bounded. Query and connection deadlines prevent an indefinitely stalled tool call.

Without accounts mode, authentication is one shared demo password with signed eight-hour cookies, and every Dive is available to every signed-in viewer. Production refuses the development fallback. In accounts mode each person has their own Dives and chat access, and a group with its own MotherDuck service account derives its members' Dive sessions, databases and chat token from that account on the server, so MotherDuck keeps one customer's data from another ([Serve your customers](accounts.md#serve-your-customers)). The app never puts a customer's data identity in the browser.

The login limiter counts failed passwords, retains at most 1,000 active client buckets, and rejects new buckets when full until one expires. Forwarded headers are ignored unless the app is on Vercel (`VERCEL=1`, which selects its platform-overwritten `x-forwarded-for`) or `AUTH_TRUSTED_IP_HEADER` names a header a trusted proxy overwrites with one client IP on every request. Route handlers see no client socket, so without a trusted header every caller shares one failure bucket. Local development can use that shared bucket; successful local sign-ins do not reset its count. Production refuses sign-in when no trusted source or client identity is available. For a multi-user production app, use its authentication and shared rate-limit service.

## UI and lifecycle

The dashboard retains `useDiveState` values when its embed session renews. Changing the theme creates a new embed session so `app_theme` reaches the Dive. Stale requests are aborted and renewal/retry timers are cleared when a frame unmounts. A load deadline surfaces failed frames instead of leaving a permanent skeleton.

The chat panel loads lazily. Tool outputs remain available as SQL receipts in the UI; only bounded narrative history is sent back to the model. Suggested follow-up questions are optional because they require another model call. Closing a chat panel cancels the active answer and retains bounded in-memory history for the signed-in session.

Every server route is a Next.js route handler under `app/api/` that takes a web `Request` and returns a private, no-store `Response`. Routes read bodies through `lib/request-body.mjs`, which caps the bytes before parsing, and use the checks in `lib/security.mjs` and `lib/admin-api.mjs` directly. The unit tests import the route modules and call them with `Request` objects, without booting Next.js. The browser tests in `e2e/` boot the app with `next dev` (production mode accepts only HTTPS origins), set `MOTHERDUCK_API_URL` and `OPENAI_BASE_URL` to local stand-ins, and serve a stand-in Dive page in place of the MotherDuck embed.

## Accounts and saved conversations

When `MOTHERDUCK_APP_TOKEN` is set, Better Auth (mounted at `/api/account`) replaces the shared password. Accounts, sessions and conversations live in one MotherDuck database reached through the Postgres endpoint with a read-write token scoped to that database. The read-only chat identity is unchanged and never writes.

`lib/viewer.mjs` resolves every request to a viewer with a role, a Dive allowlist and a chat flag. `/api/dives` filters the list. `/api/embed`, `/api/chat` and the admin routes re-check the session against the database on every request, so bans and access changes apply at once. Admin changes also require a same-origin request. The schema is generated from Better Auth's own field definitions by `lib/app-db-schema.mjs`, because MotherDuck has no Postgres catalog functions for Better Auth's migrator. References are indexed but not constrained, since DuckDB cannot cascade deletes.

Saved conversations hold the question, the answer, the model and the routing reason, token counts and compact tool receipts (SQL, row counts, errors), but never result rows. Each question also keeps the asker's group names and the Dive state. Each answer keeps its outcome (`answered`, `failed` or `stopped`), a link to its question and the asker's rating. The `chat_questions` view pairs them for the admin **Questions** tab and for SQL in MotherDuck. A viewer can only read, append to, rate and delete their own conversations; in a public demo the visitor's session is part of that ownership. A stopped answer keeps the text streamed before the stop. Saving failures are logged and never interrupt an answer.

Group allowances are checked before each question from the tokens of this month's saved answers, attributed to every group the asker was in. A failed check is logged and lets the question through. Topic grouping runs only when an administrator asks for it, and the weekly digest posts to a Slack webhook from a scheduled route that claims each week once.

## Models and routing

`lib/chat-models.mjs` maps three tiers to provider and model pairs. `lib/model-providers.mjs` builds the AI SDK model for OpenAI (Responses API) or Anthropic. In Auto mode, `lib/model-router.mjs` picks a tier with rules, falls back to a short constrained classification on the cheapest tier, and escalates mid-answer through `prepareStep` when tool calls fail or the step count grows. See [model-routing.md](model-routing.md).

## Configuration reference

`.env.example` lists the supported settings. `dives.config.mjs` defines env-variable names rather than storing account values. The Overview entry matches the included data-free Dive; Explorer illustrates an entry with an optional data share. Model IDs and request budgets are owned by `lib/chat-models.mjs`, never accepted from arbitrary client input.
