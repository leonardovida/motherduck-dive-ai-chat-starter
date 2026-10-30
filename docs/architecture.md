# Architecture and boundaries

## Request paths

The browser asks `/api/dives` for a sanitized list of configured Dives. It names a Dive key when asking `/api/embed` for a short-lived session. The server resolves that key to a saved Dive, service account and required resources. Only the resulting session reaches the iframe, in the URL fragment.

The host accepts `dive-state-update` only from the current iframe at `https://embed-motherduck.com`. State is small JSON context for chat, not a trusted access policy. Navigation requests require an explicit `linkHosts` allowlist and a user click. Export bytes are checked for source, format, filename and size before download.

Chat uses the OpenAI Responses API through AI SDK. Four tools expose the current state, table discovery, table descriptions and SQL execution. A lazy reader belongs to one response only; it is reused across tools and closed in `finally` or on cancellation. There is no cross-user database connection pool.

## Credentials and data access

Keep the embed token, chat token and OpenAI key in a server-side runtime secret store. GitHub Actions secrets configure workflows only. `.env.local` is ignored for local development.

The read-only MotherDuck identity and its data grants are the authoritative access boundary. The SQL scanner refuses common write, external-reader and dynamic-SQL forms, but is not a full SQL parser or a substitute for database permissions and platform controls. Results and transcript/request sizes are bounded. Query and connection deadlines prevent an indefinitely stalled tool call.

Without accounts mode, authentication is one shared demo password with signed eight-hour cookies. Production refuses the development fallback. Neither mode is a tenant isolation system on its own. A production application must derive all tenant-specific Dives, resources and data credentials from its authenticated server-side identity. Multiple Dives in the demo are available to every signed-in viewer.

The login limiter counts failed passwords, retains at most 1,000 active client buckets, and rejects new buckets when full until one expires. Forwarded headers are ignored unless the app is on Vercel (`VERCEL=1`, which selects its platform-overwritten `x-forwarded-for`) or `AUTH_TRUSTED_IP_HEADER` names a header a trusted proxy overwrites with one client IP on every request. Next.js route handlers expose no socket. Local development can use one shared failure bucket; successful local sign-ins do not reset its count. Production refuses sign-in when no trusted source or client identity is available. For a multi-user production app, use its authentication and shared rate-limit service.

## UI and lifecycle

The dashboard retains `useDiveState` values when its embed session renews. Changing the theme creates a new embed session so `app_theme` reaches the Dive. Stale requests are aborted and renewal/retry timers are cleared when a frame unmounts. A load deadline surfaces failed frames instead of leaving a permanent skeleton.

The chat panel loads lazily. Tool outputs remain available as SQL receipts in the UI; only bounded narrative history is sent back to the model. Suggested follow-up questions are optional because they require another model call. Closing a chat panel cancels the active answer and retains bounded in-memory history for the signed-in session.

The framework-independent handlers in `api/` are adapted by `app/api/_legacy-adapter.mjs`. The adapter caps request bytes before parsing, so the unit tests can exercise the same handlers without booting Next.js.

## Accounts and saved conversations

When `MOTHERDUCK_APP_TOKEN` is set, Better Auth (mounted at `/api/account`) replaces the shared password. Accounts, sessions and conversations live in one MotherDuck database reached through the Postgres endpoint with a read-write token scoped to that database. The read-only chat identity is unchanged and never writes.

`lib/viewer.mjs` resolves every request to a viewer with a role, a Dive allowlist and a chat flag. `/api/dives` filters the list. `/api/embed`, `/api/chat` and the admin routes re-check the session against the database on every request, so bans and access changes apply at once. Admin changes also require a same-origin request. The schema is generated from Better Auth's own field definitions by `lib/app-db-schema.mjs`, because MotherDuck has no Postgres catalog functions for Better Auth's migrator. References are indexed but not constrained, since DuckDB cannot cascade deletes.

Saved conversations hold the question, the answer, the model and the routing reason, token counts and compact tool receipts (SQL, row counts, errors), but never result rows. A viewer can only append to their own conversation. Saving failures are logged and never interrupt an answer.

## Models and routing

`lib/chat-models.mjs` maps three tiers to provider and model pairs. `lib/model-providers.mjs` builds the AI SDK model for OpenAI (Responses API) or Anthropic. In Auto mode, `lib/model-router.mjs` picks a tier with rules, falls back to a short constrained classification on the cheapest tier, and escalates mid-answer through `prepareStep` when tool calls fail or the step count grows. See [model-routing.md](model-routing.md).

## Configuration reference

`.env.example` lists the supported settings. `dives.config.mjs` defines env-variable names rather than storing account values. The Overview entry matches the included data-free Dive; Explorer illustrates an entry with an optional data share. Model IDs and request budgets are owned by `lib/chat-models.mjs`, never accepted from arbitrary client input.
