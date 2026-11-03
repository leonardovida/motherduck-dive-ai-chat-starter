# Accounts, admin portal and single sign-on

By default the starter has one shared password. **Accounts mode** replaces it with per-person sign-in:

- **People and passwords.** Administrators add people one at a time or as a pasted list. Each person gets a one-time setup link to choose their own password, so no password is passed around. Administrators can also reset passwords, disable or delete accounts, and promote other administrators.
- **Access per person and per group.** Each person can open all Dives or a chosen list, with or without AI chat. **Groups** give a team, or one of your customers, the same access at once, and **group managers** look after their own group's people.
- **Your customers' data kept apart by MotherDuck.** Give a group its own MotherDuck service account, and optionally its own databases, and its members see every Dive and ask every question as that account.
- **Access mirrored onto MotherDuck (optional).** When someone gets a Dive in the app, the app grants the shares behind it in MotherDuck, to the person's MotherDuck user or the group's service account, and attaches them for service accounts. It removes only what it added.
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

- **Add people** one at a time, or paste a list with one person per line: `username, display name, email` (name and email are optional). Usernames use letters, digits, dots and underscores. Pick a group, a role and any extra access.
- **Setup links (recommended).** Each new person gets a one-time link to choose their own password. Copy the links, or download them as a CSV, and send them through a channel you trust. A link works once, expires after 7 days, and is never stored, only its hash. **Setup link** on a person creates a new one and cancels the previous one, which also works as a password reset. You can still choose **Password I share myself** instead.
- **Set password** replaces a person's password.
- **Edit access** picks the Dives a person can open, whether they can use AI chat, and their **MotherDuck username** (see [Mirror access onto MotherDuck](#mirror-access-onto-motherduck)). Unticking every Dive means no Dives of their own; they keep what their groups give them. Chat and new dashboard sessions check access on every request, so changes apply immediately. The Dive list in the sidebar updates within a minute.
- **Disable** blocks sign-in and ends the person's sessions. **Delete** removes the account. Their saved conversations stay until deleted or expired.
- The portal does not let you demote, disable or delete yourself, so there is always at least one administrator.

**Groups**

- A group has a name, the Dives it can open and whether it has AI chat. Access adds up: a person sees their own Dives plus those of every group they belong to, except in a group with a service account, which alone decides (below).
- Tick **Manager** next to a member to let them look after the group's people (see [Group managers](#group-managers)).
- **MotherDuck service account (optional).** Members of a group with a service account open Dives and ask questions as that account instead of the shared one. This is how one deployment serves several customers, each seeing only their own data. See [Serve your customers](#serve-your-customers).
- **Databases for this group** replace a Dive's database, by its alias, for that group only. For example, the Explorer Dive reads alias `demo`; Acme's group points `demo` at `md:_share/acme_data/...` and Globex's at `md:_share/globex_data/...`.
- A person can belong to only one group with a service account, so their MotherDuck identity is never ambiguous.
- **A group with a service account decides on its own.** Every member reads data as the same service account, so a member sees exactly that group's Dives and chat. Their own access and their other groups add nothing, and the service account is granted only the group's Dives. Joining such a group clears the person's own access, so leaving it later does not fall back to the shared identity's Dives. Giving an existing group a service account does the same for its members.

**MotherDuck access** shows every grant the app has made or is waiting to make, and the SQL to run when the app is not allowed to make them itself.

**Conversations**

- Filter by person or Dive, or search by the first question.
- Open a conversation to see each question and answer. Each answer shows the model and provider, the routing reason (see [model routing](model-routing.md)), token counts, time taken and every tool step with its SQL.
- **Export JSON** downloads a conversation. **Delete** removes it.

## Serve your customers

To put the same Dives in front of several customers, each seeing only their own data:

1. **In MotherDuck**, keep each customer's data in its own database, and share it with `ACCESS RESTRICTED` so only the people or service accounts you grant can read it. Create one service account per customer, or let the app create it (with `MOTHERDUCK_ADMIN_TOKEN`). Share the Dive itself with your organization, or with each service account, so they can open it.
2. **In the admin portal**, create a group per customer. Give it the Dives, AI chat, the customer's service account and, under **Databases for this group**, the customer's share for each Dive alias.
3. **Add the customer's people** to their group, by pasting a list, and send them their setup links. People added to a group start with only the group's access.
4. Optionally tick **Manager** for someone on the customer's side, so they can add and remove their own colleagues.

The app then creates each Dive session for that customer's service account with that customer's databases, and chat queries the customer's databases with a short-lived, read-only token for the same service account. MotherDuck enforces the separation, so a mistake in the app cannot show one customer another's data. If the app cannot get that token, chat is switched off for the group rather than falling back to the shared identity.

## Group managers

A manager of a group can open **Admin** and see only the people in the groups they manage. They can:

- add people to their group (by list or one at a time), who get the group's access and nothing more;
- create setup links, and disable, re-enable or remove people from their group.

They cannot grant Dives, change roles, see administrators, edit groups or read conversations. Managers suit customer administrators and team leads.

A manager acts only on people who belong to nothing but the groups that manager runs. People who are also in another group, who manage a group themselves, or who are administrators are listed but stay with the administrators. In addition:

- A manager cannot create a setup link for someone who signs in with single sign-on, because it would add a password beside their identity provider.
- A manager cannot re-enable someone an administrator disabled.
- A setup link a manager created stops working if, before it is used, the person joins another group, becomes a manager or administrator, starts using single sign-on, or the manager loses the role or is disabled. Disabling a person cancels their unused links.

## Mirror access onto MotherDuck

For organizations whose people also use MotherDuck directly, and for customer groups with their own service accounts, the app can keep MotherDuck share grants in step with access in the app.

| Who | When they get a Dive in the app, MotherDuck gets |
| --- | --- |
| A person with a **MotherDuck username** | `GRANT READ ON SHARE <share> TO USER <username>` for every share the Dive reads. The person can then attach the share in MotherDuck. |
| A group with a **service account** | The same grant to the service account, then `ATTACH` of each share under the Dive's alias, so chat can query it. |

When access is removed, or a person is disabled or deleted, the app revokes the grants and detaches the shares **it added**. A grant that already existed, or a share open to the whole organization, is recorded and left alone. Before revoking, the app checks that the grant is still there.

**Automatic mode.** Set `MOTHERDUCK_ADMIN_TOKEN` to an **Admin**'s token whose account owns the shares (only a share's owner can grant it). Every change in the portal then triggers a sync in the background, and **MotherDuck access → Sync now** runs one on demand, for example after fixing a failed grant. The app attaches shares for a service account through a five-minute token for that account, which it deletes afterwards. One sync runs at a time across every server instance; a change made during a sync is picked up by one more run straight after it. Removals run before grants, so a Dive alias that moves to another share is detached first and then attached to the new share.

**A daily check.** On Vercel, `vercel.json` schedules `/api/cron/access-sync` once a day, so grants changed outside the app, or a sync that failed, are put right. Set `CRON_SECRET` (any random string of 16 or more characters) for the route to run; Vercel sends it automatically. On other hosts, call the route with `Authorization: Bearer <CRON_SECRET>` from your own scheduler.

**Manual mode.** Without the token nothing changes in MotherDuck by itself. **MotherDuck access** lists what is waiting, and the exact SQL for the share owner to run, including the `REVOKE` and `DETACH` statements when access is taken away. After running it, press **Mark as done**: waiting grants become synced, and finished removals leave the list. Organizations that keep administrative tokens out of web apps can use this mode, and groups with a service account then have no chat.

Notes:

- Chat for a group with a service account reads the Dive's chat database (its `databaseEnv` value in `dives.config.mjs`) under the same name, so that name must be one of the Dive's aliases, from the Dive or from **Databases for this group**.
- Only shares (`md:_share/...`) can be granted. A database a service account owns itself (`md:<name>`) needs no grant.
- The Dive itself must be readable by the service account, for example shared with the organization. MotherDuck does not offer a public API for granting a Dive, so this is a one-time step in MotherDuck.
- MotherDuck does not allow an administrator to attach a share for another person's own account, so people with a MotherDuck username receive the grant and attach it themselves.
- Restricted shares and `GRANT READ ON SHARE` are described in the [MotherDuck documentation](https://motherduck.com/docs/sql-reference/motherduck-sql-reference/grant-access/).

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

- **Without `AUTH_ALLOWED_EMAIL_DOMAINS` (the default):** only people who already have an account can sign in with SSO. An administrator adds the person in the admin portal with the **same email** their identity provider uses. Their SSO login then links to that account. Only emails an administrator typed count; an email a group manager typed never links to SSO, so a manager cannot claim someone else's sign-in.
- **With `AUTH_ALLOWED_EMAIL_DOMAINS=acme.com,acme.io`:** anyone from those domains who passes your identity provider gets an account on first sign-in, with all Dives and chat. Set `AUTH_NEW_ACCOUNT_ACCESS=none` to start them with nothing until an administrator grants access.
- **With `AUTH_DOMAIN_GROUPS=acme.com=Acme, globex.com=Globex`:** people whose **verified** email is at one of those domains join that group (by its name in the admin portal) when SSO creates their account, with no access of their own. Those domains may create accounts without being listed in `AUTH_ALLOWED_EMAIL_DOMAINS`. An unverified email from a mapped domain gets an account with no access. This suits a company whose departments, or whose customers, sign in with their own email domains.

Grant access to the app in your identity provider too, for example by assigning the Okta app to a group. That is your first gate, and the domain allowlist is the second.

### Adding another provider

`lib/auth.mjs` builds the list in `ssoProviders()`. Better Auth includes helpers for Auth0, Keycloak, Slack and others (`better-auth/plugins/generic-oauth`), and SAML through its SSO plugin. Add an entry there, and the sign-in page shows its button automatically.

## Run a public demo

`PUBLIC_DEMO=true` turns a deployment into a demo that anyone with the sign-in can explore, without being able to break it for the next visitor:

- Visitors share one administrator account, so they can open every screen, including **People** and **Conversations**.
- Every change is switched off and says "This is not available in a public demo." when pressed, by mouse, keyboard or touch: adding people, passwords, access, roles, disabling, deleting, and changing the shared account itself. The server refuses these requests too, not just the interface.
- Dives that are not connected are hidden, because visitors cannot act on setup instructions.
- The chat opens beside the Dive on wide screens, and the top bar shows a **Public demo** badge.
- Model tiers left out of `CHAT_MODELS` stay in the picker, greyed out with the same message.
- The chat panel tells visitors that their conversations are visible to every other visitor.
- The chat limit of 20 questions a minute applies to each visitor's session rather than to the shared account.

To set one up:

1. Set up accounts mode as above, and create the shared account with `npm run admin:create -- --username=demo`.
2. While `PUBLIC_DEMO` is still off, add a few example people in the admin portal, so visitors have something to look at. Use made-up names and no real email addresses, because every visitor can see them.
3. Set `PUBLIC_DEMO=true`, `CHAT_MODELS=luna` (or the tiers you want to pay for) and a short `CHAT_RETENTION_DAYS`, such as `7`.
4. Publish the username and password where you want visitors to find them, and set `PUBLIC_DEMO_SIGN_IN_URL` to that page so the sign-in page links to it. Set a monthly spending limit with your model provider, because anyone with the sign-in can ask questions.

## How it is built

- `lib/auth.mjs` configures Better Auth: username and password with self-sign-up off, the admin plugin, generic OIDC, sessions that last seven days, a one-minute signed cookie cache, and sign-in rate limits.
- `lib/viewer.mjs` resolves who is asking and what they may open, for both the shared password and accounts. `/api/dives`, `/api/embed`, `/api/chat` and the admin routes all use it.
- `lib/app-db-schema.mjs` generates DuckDB tables from Better Auth's own schema. Better Auth's migrator expects Postgres catalog functions that MotherDuck does not have, so `npm run db:migrate` owns the schema and Better Auth's start-up schema check is switched off.
- `lib/conversations.mjs` stores conversations with parameterized SQL. A person can only continue their own conversations.
- Admin routes require an administrator session, a fresh session lookup and a same-origin request for changes.
- `lib/public-demo.mjs` holds the public demo switch and the short list of account endpoints a demo visitor may reach.
- `lib/groups.mjs` folds group access into each viewer and picks the MotherDuck identity for each Dive (`diveIdentity`). If groups cannot be read, the person gets no Dives rather than the wrong data.
- `lib/access-sync.mjs` computes the wanted share grants from the app database, plans the changes against what it recorded in `md_access_grant`, and applies them through `lib/motherduck-admin.mjs`. The `app_lock` table keeps one sync running at a time. `lib/account-setup.mjs` handles setup links.
- `lib/audit.mjs` records who changed what in `audit_event`: people, access, groups, MotherDuck grants and deleted conversations. Entries hold usernames and settings, never passwords, setup links or tokens.

## Limits

- Sign-in allows ten failed attempts per username every ten minutes on any host, on top of Better Auth's per-address limit. Where no trusted client address is known (see `AUTH_TRUSTED_IP_HEADER`), a shared ceiling of 300 failed sign-ins every ten minutes also applies.
- Rate limits and the chat request budget are kept in memory for each server instance. For heavy public use, put a shared limiter in front of the app or add a [Better Auth secondary storage](https://www.better-auth.com/docs/concepts/database#secondary-storage).
- The app database sees one small write per sign-in and two per chat answer. That suits teams and customer pilots. For thousands of concurrent users, move accounts to a dedicated transactional database.
- The access sync reconciles every person and group on each run, which suits hundreds of people. Organizations with many thousands would need a sync by group, which the template does not include yet.
- Better Auth's built-in email flows (verification, password reset by email) are not wired up, because they need an email provider. Administrators and group managers send setup links instead.
