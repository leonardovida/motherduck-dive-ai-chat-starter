# Verification record

The browser and production API checks below ran locally on 27 October 2026 with Node 26, a fresh clone and a separate synthetic MotherDuck fixture. The baseline was commit `6f5c163`, with in-progress local changes; these were working-tree checks rather than an immutable release certification. Fixture identifiers and credentials are excluded from this repository. Credentials were injected at runtime from a managed environment.

On 28 October, Claude Opus 5.5 at high effort reviewed the source and the fixes. The final credential-free suite passed **68 tests**. The agent-oriented JSON setup flow was separately verified against the live embed, database and model-access APIs with a pinned Dive version. This later check did not repeat the earlier browser session or generate an AI answer. The publication's CI run identifies the final tested commit.

## Checks completed

| Boundary | Result |
| --- | --- |
| Fresh install | `npm ci` succeeded. |
| Automated regression suite | 68 tests passed on 28 October, including login limits, invalid config/version pins, endpoint overrides and setup JSON. |
| Production compilation | `npm run build` succeeded in the working checkout and clean test clone. |
| Package freshness | `npm outdated --json` returned `{}`. |
| Runtime dependency audit | Zero reported advisories. |
| Unconfigured first run | Development sign-in and placeholders worked without credentials. |
| Real embed | A saved synthetic Dive rendered and queried its data. |
| Real AI + SQL | Table discovery, schema inspection and `COUNT(*)` returned **86,283**, matching an independent database query. The UI displayed the SQL receipt. |
| Follow-up and filter state | After changing a `useDiveState` selection, a follow-up using `getDiveState` correctly identified the selected value. |
| Cancellation | Stop response returned the composer to idle. |
| Clear and navigation | Clear removed history. Switching to an unconfigured Dive showed its setup requirements; switching back loaded the configured Dive. |
| Mobile | At 390×844, chat accepted a question, returned the same verified count and expanded the SQL receipt. The viewport was restored afterward. |
| Sign-out | Browser returned to sign-in. Production API sign-out expired its cookie. |
| Browser errors | No console errors recorded in the updated test tab. |
| Production API smoke | Built server rejected unauthenticated access, signed in, created a real embed session, streamed a SQL-backed count and signed out. The harness supplied an HTTPS Origin header. |
| Setup diagnostics | Live checks passed with valid runtime values. An intentionally misspelled fixture service-account username produced HTTP 404 and actionable guidance without printing credentials. |

## Limits

This verifies a local starter and synthetic data. It does not verify a hosted deployment, TLS termination, production browser cookies, every model tier, token expiry after 24 hours, Safari compatibility, or load under concurrent users. The browser tests used `next dev`; the separate API smoke used `next start` after a production build. Production requires HTTPS and a trusted client-IP source.

## Repeat the connected smoke check

Configure your own saved Dive and optional chat values as described in the README, then run:

```sh
npm run --silent setup -- --live --json
npm run dev
```

Sign in, open the Dive and ask for a count whose result you have checked independently. Expand the SQL receipt. Change a `useDiveState` filter and ask which value is selected. Stop a response, clear chat, switch Dives and sign out. Test the narrow-screen layout as well.

`setup -- --live` validates session creation, database connectivity and default-model access. It does not generate an AI answer or replace the browser flow above. Credential-free tests mock the provider boundary.
