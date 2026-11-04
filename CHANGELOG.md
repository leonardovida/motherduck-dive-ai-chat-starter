# Changelog

Every release of this template is listed here, newest first. The full notes for each version are in [`release-notes/`](release-notes/) and on the [GitHub Releases page](https://github.com/leonardovida/motherduck-dive-ai-chat-starter/releases). Version numbers follow the policy in [docs/releasing.md](docs/releasing.md#version-numbers).

## v0.5.0 - 2026-11-04

This release lets chat run on OpenAI, Anthropic, OpenRouter, Azure, Bedrock, Vertex AI or a self-hosted model, chosen in a new **Models** tab, adds past conversations, rating reasons, topics, a weekly digest and group allowances, and adds browser tests. Deployments pinned to `v0.4.x` do not receive it, `npm run db:migrate` is required, and renamed settings and a new cron path must be applied. See the [release notes](release-notes/v0.5.0.md).

## v0.4.0 - 2026-11-03

This release tracks every chat question with its outcome, the asker's groups and the Dive state, lets people rate answers, and adds a **Questions** tab to the admin portal and a `chat_questions` view for MotherDuck. Deployments pinned to `v0.3.x` do not receive it, and `npm run db:migrate` is required. See the [release notes](release-notes/v0.4.0.md).

## v0.3.0 - 2026-11-03

This release isolates groups with their own MotherDuck service account, narrows what group managers may do, requires verified emails for single sign-on and makes the MotherDuck access sync safe across server instances. It also adds an activity log, invitation and sign-in status, self-service password changes and single sign-on domain groups. Deployments pinned to `v0.2.x` do not receive it, and `npm run db:migrate` is required. See the [release notes](release-notes/v0.3.0.md).

## v0.2.0 - 2026-11-03

This release adds an optional accounts mode with an admin portal, groups, setup links, single sign-on, saved conversations and an optional sync of access onto MotherDuck share grants, as well as Anthropic model support and automatic model routing. Auto becomes the default model choice, and `OPENAI_MODEL` and `OPENAI_CHAT_MODELS` are renamed with the previous names still accepted. See the [release notes](release-notes/v0.2.0.md).

## v0.1.0 - 2026-10-30

This is the first versioned release of the template. It includes the embedded Dive and AI chat starter, a README written for business users and coding agents, a Vercel Deploy Button and a tagged release process. See the [release notes](release-notes/v0.1.0.md).
