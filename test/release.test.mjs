import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkRelease } from '../scripts/check-release.mjs';

async function fixture({ version = '1.2.0', notes = '## Highlights\n- One.\n', changelog = '# Changelog\n\n## v1.2.0 - 2026-10-30\n' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'release-check-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ version }));
  await mkdir(join(dir, 'release-notes'));
  if (notes !== null) await writeFile(join(dir, 'release-notes', `v${version}.md`), notes);
  await writeFile(join(dir, 'CHANGELOG.md'), changelog);
  return { base: pathToFileURL(`${dir}/`), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('release check accepts a tag with matching version, notes and changelog entry', async () => {
  const { base, cleanup } = await fixture();
  try {
    assert.deepEqual(await checkRelease('v1.2.0', base), { tag: 'v1.2.0', notesPath: 'release-notes/v1.2.0.md', problems: [] });
    assert.equal((await checkRelease(undefined, base)).tag, 'v1.2.0');
  } finally { await cleanup(); }
});

test('release check reports a mismatched tag, missing notes and missing changelog entry', async () => {
  const { base, cleanup } = await fixture({ notes: null, changelog: '# Changelog\n\n## v1.1.0\n' });
  try {
    const { problems } = await checkRelease('v1.3.0', base);
    assert.equal(problems.length, 3);
    assert.match(problems.join('\n'), /does not match package\.json version 1\.2\.0/);
    assert.match(problems.join('\n'), /release-notes\/v1\.3\.0\.md is missing/);
    assert.match(problems.join('\n'), /CHANGELOG\.md has no "## v1\.3\.0" entry/);
  } finally { await cleanup(); }
});

test('release check rejects tags that are not semantic versions', async () => {
  const { base, cleanup } = await fixture();
  try {
    assert.match((await checkRelease('latest', base)).problems[0], /not a semantic version/);
  } finally { await cleanup(); }
});

test('the repository is ready to release its current package version', async () => {
  assert.deepEqual((await checkRelease()).problems, []);
});
