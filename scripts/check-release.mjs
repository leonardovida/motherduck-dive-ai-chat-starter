// Checks that a release tag matches package.json, has release notes and a CHANGELOG entry.
// Usage: npm run release:check -- v1.2.3   (defaults to v<package.json version>)
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);

export async function checkRelease(tag, base = root) {
  const problems = [];
  const { version } = JSON.parse(await readFile(new URL('package.json', base), 'utf8'));
  tag ||= `v${version}`;
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) problems.push(`Tag ${tag} is not a semantic version such as v1.2.3.`);
  if (tag !== `v${version}`) problems.push(`Tag ${tag} does not match package.json version ${version}.`);
  const notes = await readFile(new URL(`release-notes/${tag}.md`, base), 'utf8').catch(() => '');
  if (!notes.trim()) problems.push(`release-notes/${tag}.md is missing or empty.`);
  const changelog = await readFile(new URL('CHANGELOG.md', base), 'utf8').catch(() => '');
  if (!new RegExp(`^## \\[?${tag.replaceAll('.', '\\.')}\\]?`, 'm').test(changelog)) problems.push(`CHANGELOG.md has no "## ${tag}" entry.`);
  return { tag, notesPath: `release-notes/${tag}.md`, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { tag, notesPath, problems } = await checkRelease(process.argv[2]);
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else {
    console.log(`${tag} is ready to release with ${notesPath}.`);
  }
}
