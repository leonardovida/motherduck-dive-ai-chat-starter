// cdk synth / cdk deploy entry point. Options come from "context" in cdk.json, or from -c on the
// command line, for example: npx cdk deploy -c signIn=accounts
import * as cdk from 'aws-cdk-lib';
import { DiveChatStack, type DiveChatOptions } from '../lib/stack.ts';

export function optionsFrom(node: { tryGetContext(key: string): unknown }): DiveChatOptions {
  const read = (key: string) => node.tryGetContext(key);
  // -c values arrive as strings; cdk.json values keep their JSON type.
  const list = (value: unknown) => (Array.isArray(value) ? value : String(value ?? '').split(',')).map(String).map(s => s.trim()).filter(Boolean);
  const object = (value: unknown) => (typeof value === 'string' ? JSON.parse(value || '{}') : value ?? {}) as Record<string, string>;
  const text = (value: unknown) => (value === undefined || value === null ? '' : String(value).trim());
  return {
    signIn: (text(read('signIn')) || 'password') as DiveChatOptions['signIn'],
    secretNames: list(read('secretNames')),
    environment: Object.fromEntries(Object.entries(object(read('environment'))).map(([key, value]) => [key, String(value)])),
    domainName: text(read('domainName')) || undefined,
    certificateArn: text(read('certificateArn')) || undefined,
    availabilityZones: list(read('availabilityZones')),
    desiredCount: Number(read('desiredCount') ?? 1),
    cpu: Number(read('cpu') ?? 512),
    memoryMiB: Number(read('memoryMiB') ?? 1024),
  };
}

export function buildApp(app: cdk.App, synthesizer?: cdk.IStackSynthesizer): DiveChatStack {
  const stackName = String(app.node.tryGetContext('stackName') ?? 'MotherDuckDiveChat');
  return new DiveChatStack(app, stackName, optionsFrom(app.node), {
    description: 'MotherDuck Dive + AI Chat starter: ECS Fargate behind CloudFront (docs/deploy.md)',
    ...(synthesizer ? { synthesizer } : {}),
    // No account or Region: the stack is environment-agnostic, so `cdk synth` makes no AWS lookups
    // and `cdk deploy` uses the Region of your AWS CLI profile.
  });
}

if (import.meta.main) {
  const app = new cdk.App();
  buildApp(app);
  app.synth();
}
