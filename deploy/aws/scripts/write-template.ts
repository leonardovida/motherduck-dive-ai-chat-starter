// Writes cloudformation.template.json: the stack with the defaults in cdk.json, as a plain
// CloudFormation template that deploys without `cdk bootstrap` (console upload or a
// quick-create link). `--check` fails when the committed file is out of date, for CI.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { buildApp } from '../bin/app.ts';

const root = join(import.meta.dirname, '..');
const target = join(root, 'cloudformation.template.json');
const { context } = JSON.parse(readFileSync(join(root, 'cdk.json'), 'utf8'));

const outdir = mkdtempSync(join(tmpdir(), 'dive-chat-cdk-'));
try {
  const app = new cdk.App({
    outdir,
    analyticsReporting: false,
    context: { ...context, 'aws:cdk:enable-path-metadata': false },
  });
  const stack = buildApp(app, new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }));
  const template = app.synth().getStackByName(stack.stackName).template;
  const text = `${JSON.stringify(template, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(target, 'utf8'); } catch {}
    if (current !== text) {
      console.error('cloudformation.template.json is out of date. Run: npm run template (in deploy/aws)');
      process.exitCode = 1;
    } else console.log('cloudformation.template.json is up to date.');
  } else {
    writeFileSync(target, text);
    console.log(`Wrote ${target}`);
  }
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
