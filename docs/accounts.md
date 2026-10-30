# Accounts, admin portal and single sign-on

By default the starter has one shared password. **Accounts mode** replaces it with per-person sign-in:

- **People and passwords.** Administrators add people with a username and password, reset passwords, disable or delete accounts, and promote other administrators.
- **Access per person.** Each person can open all Dives or a chosen list, with or without AI chat.
- **Single sign-on (optional).** Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak or any OpenID Connect provider, plus Google or GitHub login.
- **Saved conversations.** Administrators can read every chat: the question, the answer, the SQL that ran, which model answered and why.

Accounts, sessions and conversations are stored in a **MotherDuck database** that the app owns, so there is no extra database service to run. Authentication uses [Better Auth](https://www.better-auth.com/), an open-source library.

## Turn it on

1. **Create a database for the app** in MotherDuck, for example `dive_chat_app`. The migration in step 3 creates it when the token's account can.
2. **Create a token that can write to that database only.** The cleanest setup is a dedicated service account that owns `dive_chat_app` and has no access to your analytics data. This token is **not** the read-only chat token, and must never be reused as one.
3. **Add the settings and create the tables:**

   ```dotenv
   MOTHERDUCK_APP_TOKEN=your-app-database-token
   APP_DATABASE=dive_chat_app
   SESSION_SECRET=output-of-openssl-rand-hex-32
   ```

   ```sh
   npm run db:migrate
   ```

   The migration is safe to run again. Run it after every upgrade of the template.
4. **Create the first administrator.** The command asks for the password without showing it. In automation, set `ADMIN_PASSWORD` from your secret manager instead.

   ```sh
   npm run admin:create -- --username=alice --name="Alice Smith"
   ```

   Running it again for an existing username sets a new password and makes that person an administrator. Use this if you are ever locked out.
5. **Restart the app and sign in.** Administrators see **Admin** in the sidebar, or can open `/admin` directly.

When `MOTHERDUCK_APP_TOKEN` is set, the shared `DEMO_PASSWORD` is no longer accepted.

## The admin portal

**People**

- **Add a person:** username (letters, digits, dots and underscores), display name, an optional email, a password (use **Generate** for a strong one), a role, and their access.
- **Set password** replaces a person's password. Share new passwords through a secure channel.
- **Edit access** picks the Dives a person can open and whether they can use AI chat. Chat and new dashboard sessions check access on every request, so changes apply immediately. The Dive list in the sidebar updates within a minute.
- **Disable** blocks sign-in and ends the person's sessions. **Delete** removes the account. Their saved conversations stay until deleted or expired.
- The portal does not let you demote, disable or delete yourself, so there is always at least one administrator.

**Conversations**

- Filter by person or Dive, or search by the first question.
- Open a conversation to see each question and answer. Each answer shows the model and provider, the routing reason (see [model routing](model-routing.md)), token counts, time taken and every tool step with its SQL.
- **Export JSON** downloads a conversation. **Delete** removes it.

## Saved conversations and privacy

In accounts mode conversations are saved by default, and the chat panel tells people: "Conversations are saved and can be reviewed by administrators."

| Setting | Effect |
| --- | --- |
| `CHAT_HISTORY=off` | Nothing is saved, and the notice disappears. |
| `CHAT_RETENTION_DAYS=90` | Messages older than 90 days are deleted automatically. |

Saved answers keep the SQL and row counts, but **never the result rows**, so the app database does not become a copy of your data. Tell your users how long you keep conversations and who can read them.

## Single sign-on

Every provider needs a **redirect URI** registered in its admin console:

```
<APP_URL>/api/account/callback/<provider id>
```

For example `https://dives.example.com/api/account/callback/sso`. Set `APP_URL` to the public address of the app. On Vercel the production domain is detected automatically.

### Any OpenID Connect provider (Okta, Entra ID, Google Workspace, Auth0, Keycloak and others)

```dotenv
SSO_ISSUER=https://your-tenant.okta.com      # or set SSO_DISCOVERY_URL to the full .well-known URL
SSO_CLIENT_ID=...
SSO_CLIENT_SECRET=...
SSO_LABEL=Acme SSO                           # the button text; optional
SSO_PROVIDER_ID=sso                          # part of the redirect URI; optional
```

Shortcuts for common providers:

| Provider | Settings | Redirect URI ends with |
| --- | --- | --- |
| Okta | `OKTA_ISSUER`, `OKTA_CLIENT_ID`, `OKTA_CLIENT_SECRET` | `/callback/okta` |
| Microsoft Entra ID | `MICROSOFT_TENANT_ID` (the tenant GUID), `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | `/callback/microsoft-entra-id` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `/callback/google` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `/callback/github` |

### Who single sign-on lets in

- **Without `AUTH_ALLOWED_EMAIL_DOMAINS` (the default):** only people who already have an account can sign in with SSO. Add the person in the admin portal with the **same email** their identity provider uses. Their SSO login then links to that account.
- **With `AUTH_ALLOWED_EMAIL_DOMAINS=acme.com,acme.io`:** anyone from those domains who passes your identity provider gets an account on first sign-in, with all Dives and chat. Administrators can narrow it afterwards.

Grant access to the app in your identity provider too, for example by assigning the Okta app to a group. That is your first gate, and the domain allowlist is the second.

### Adding another provider

`lib/auth.mjs` builds the list in `ssoProviders()`. Better Auth includes helpers for Auth0, Keycloak, Slack and others (`better-auth/plugins/generic-oauth`), and SAML through its SSO plugin. Add an entry there, and the sign-in page shows its button automatically.

## Run a public demo

`PUBLIC_DEMO=true` turns a deployment into a demo that anyone with the sign-in can explore, without being able to break it for the next visitor:

- Visitors share one administrator account, so they can open every screen, including **People** and **Conversations**.
- Every change is switched off and says "This is not available in a public demo.": adding people, passwords, access, roles, disabling, deleting, and changing the shared account itself. The server refuses these requests too, not just the interface.
- Model tiers left out of `CHAT_MODELS` stay in the picker, greyed out with the same message.
- The chat panel tells visitors that their conversations are visible to every other visitor.
- The chat limit of 20 questions a minute applies to each visitor's session rather than to the shared account.

To set one up:

1. Set up accounts mode as above, and create the shared account with `npm run admin:create -- --username=demo`.
2. While `PUBLIC_DEMO` is still off, add a few example people in the admin portal, so visitors have something to look at. Use made-up names and no real email addresses, because every visitor can see them.
3. Set `PUBLIC_DEMO=true`, `CHAT_MODELS=luna` (or the tiers you want to pay for) and a short `CHAT_RETENTION_DAYS`, such as `7`.
4. Publish the username and password where you want visitors to find them. Set a monthly spending limit with your model provider, because anyone with the sign-in can ask questions.

## How it is built

- `lib/auth.mjs` configures Better Auth: username and password with self-sign-up off, the admin plugin, generic OIDC, sessions that last seven days, a one-minute signed cookie cache, and sign-in rate limits.
- `lib/viewer.mjs` resolves who is asking and what they may open, for both the shared password and accounts. `/api/dives`, `/api/embed`, `/api/chat` and the admin routes all use it.
- `lib/app-db-schema.mjs` generates DuckDB tables from Better Auth's own schema. Better Auth's migrator expects Postgres catalog functions that MotherDuck does not have, so `npm run db:migrate` owns the schema and Better Auth's start-up schema check is switched off.
- `lib/conversations.mjs` stores conversations with parameterized SQL. A person can only continue their own conversations.
- Admin routes require an administrator session, a fresh session lookup and a same-origin request for changes.
- `lib/public-demo.mjs` holds the public demo switch and the short list of account endpoints a demo visitor may reach.

## Limits

- Rate limits and the chat request budget are kept in memory for each server instance. For heavy public use, put a shared limiter in front of the app or add a [Better Auth secondary storage](https://www.better-auth.com/docs/concepts/database#secondary-storage).
- The app database sees one small write per sign-in and two per chat answer. That suits teams and customer pilots. For thousands of concurrent users, move accounts to a dedicated transactional database.
- Better Auth's built-in email flows (verification, password reset by email) are not wired up, because they need an email provider. Administrators reset passwords in the portal instead.
