# Releasing a new version

Each version of this template is a Git tag such as `v0.2.0` with a matching GitHub Release. Teams can start from a known version, read what changed, and upgrade when they are ready.

## Version numbers

Versions follow [Semantic Versioning](https://semver.org/). For a template, the parts mean:

| Bump | When | Examples |
| --- | --- | --- |
| **Major** (`1.0.0` → `2.0.0`) | A copy of the template needs changes to keep working after the upgrade. | A setting is renamed or removed, the shape of `dives.config.mjs` changes, or the supported Node.js range narrows. |
| **Minor** (`0.1.0` → `0.2.0`) | New features that keep existing configuration working. | A new optional setting, chat tool or UI capability. |
| **Patch** (`0.1.0` → `0.1.1`) | Fixes, dependency updates and documentation. | A bug fix or a security update. |

Before `1.0.0`, a minor bump may include breaking changes. Its release notes then include an **Upgrading** section that says what to change.

## Cut a release

1. Start a branch from the default branch.
2. Update the version without creating a tag yet:

   ```sh
   npm version 0.2.0 --no-git-tag-version
   ```

3. Write `release-notes/v0.2.0.md`. Use the sections and tone of the earlier notes: Highlights, Upgrading (when behavior changes), Features, Bug Fixes, Compatibility and Maintenance. Write for the people who use the template, and link every item to its change.
4. Add a short entry to the top of [CHANGELOG.md](../CHANGELOG.md) headed `## v0.2.0 - YYYY-MM-DD` that links to the notes.
5. Check everything locally:

   ```sh
   npm run release:check
   npm test
   npm run build
   ```

6. Open a pull request, wait for **Checks** to pass and merge it.
7. Tag the merge commit on the default branch and push the tag:

   ```sh
   git switch <default-branch> && git pull
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

The **Release** workflow then tests and builds the tagged commit. It publishes a GitHub Release with `release-notes/v0.2.0.md` as the body. A tag with a suffix, such as `v0.2.0-rc.1`, is published as a pre-release.

If the workflow fails before it publishes, fix the problem in a new pull request, delete the tag (`git push origin :refs/tags/v0.2.0` and `git tag -d v0.2.0`), and tag the fixed commit again.

## Use a specific version

- **New project:** download the source archive from the [Releases page](https://github.com/leonardovida/motherduck-dive-ai-chat-starter/releases), or clone a tag:

  ```sh
  git clone --branch v0.1.0 https://github.com/leonardovida/motherduck-dive-ai-chat-starter.git
  ```

  GitHub's **Use this template** button copies the latest default branch, not a tag.

- **Existing copy:** read the release notes between your version and the target version, especially the Upgrading and Compatibility sections. Then bring the changes in:

  ```sh
  git remote add upstream https://github.com/leonardovida/motherduck-dive-ai-chat-starter.git
  git fetch upstream --tags
  git merge v0.2.0   # or cherry-pick specific commits
  ```

  A coding agent can do this for you. Ask it to "upgrade this project to template version v0.2.0 following AGENTS.md".
