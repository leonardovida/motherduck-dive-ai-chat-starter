// Checks properties of the synthesized stack that a template diff does not make obvious.
// Run with: npm test (in deploy/aws). No AWS credentials or calls are needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { buildApp } from '../bin/app.ts';
import { ALB_IDLE_TIMEOUT_SECONDS, CLIENT_IP_HEADER } from '../lib/stack.ts';

const { context } = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'cdk.json'), 'utf8'));

function synth(overrides: Record<string, unknown> = {}) {
  const app = new cdk.App({ analyticsReporting: false, context: { ...context, ...overrides } });
  return Template.fromStack(buildApp(app, new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false })));
}

const appContainer = (template: Template) => {
  const definitions = Object.values(template.findResources('AWS::ECS::TaskDefinition'));
  const container = definitions.map(resource => resource.Properties.ContainerDefinitions[0]).find(c => c.Name === 'app');
  assert.ok(container, 'the app task definition exists');
  return container;
};
const envValue = (container: { Environment: { Name: string, Value: unknown }[] }, name: string) =>
  container.Environment.find(entry => entry.Name === name)?.Value;

test('the app keeps idle connections longer than the load balancer does', () => {
  const template = synth();
  template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
    LoadBalancerAttributes: [
      { Key: 'deletion_protection.enabled', Value: 'false' },
      { Key: 'idle_timeout.timeout_seconds', Value: String(ALB_IDLE_TIMEOUT_SECONDS) },
    ],
  });
  const keepAlive = Number(envValue(appContainer(template), 'KEEP_ALIVE_TIMEOUT'));
  assert.ok(keepAlive > ALB_IDLE_TIMEOUT_SECONDS * 1000, `KEEP_ALIVE_TIMEOUT ${keepAlive} ms must exceed the load balancer idle timeout`);
});

test('only CloudFront reaches the app, and it overwrites the client IP header', () => {
  const template = synth();
  template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal' });
  assert.equal(envValue(appContainer(template), 'AUTH_TRUSTED_IP_HEADER'), CLIENT_IP_HEADER);
  const [fn] = Object.values(template.findResources('AWS::CloudFront::Function'));
  assert.match(fn.Properties.FunctionCode, new RegExp(`request\\.headers\\['${CLIENT_IP_HEADER}'\\] = \\{ value: ip\\.value, multiValue: \\[ip\\] \\}`));
  // The app's port is open only to the load balancer.
  const ingress = Object.values(template.findResources('AWS::EC2::SecurityGroupIngress'));
  assert.deepEqual(ingress.map(rule => [rule.Properties.FromPort, Boolean(rule.Properties.SourceSecurityGroupId)]), [[3000, true]]);
  for (const group of Object.values(template.findResources('AWS::EC2::SecurityGroup'))) {
    for (const rule of group.Properties.SecurityGroupIngress ?? []) assert.notEqual(rule.FromPort, 3000);
  }
});

test('a console deployment can choose the Availability Zones', () => {
  const template = synth();
  template.hasParameter('AvailabilityZone1', { Default: '' });
  template.hasParameter('AvailabilityZone2', { Default: '' });
  template.hasCondition('RegionDefaultZones', { 'Fn::Equals': [{ Ref: 'AvailabilityZone1' }, ''] });
  const zones = Object.values(template.findResources('AWS::EC2::Subnet')).map(subnet => JSON.stringify(subnet.Properties.AvailabilityZone));
  assert.equal(zones.length, 4);
  for (const zone of zones) assert.match(zone, /"Fn::If":\["RegionDefaultZones".*"Ref":"AvailabilityZone[12]"/);
});

test('the availabilityZones option replaces the zone parameters', () => {
  const template = synth({ availabilityZones: ['us-east-1b', 'us-east-1c'] });
  assert.deepEqual(Object.keys(template.findParameters('*')).filter(name => name.startsWith('AvailabilityZone')), []);
  const zones = Object.values(template.findResources('AWS::EC2::Subnet')).map(subnet => subnet.Properties.AvailabilityZone);
  assert.deepEqual([...new Set(zones)].sort(), ['us-east-1b', 'us-east-1c']);
  assert.throws(() => synth({ availabilityZones: ['us-east-1b'] }), /at least two zones/);
});
