// Runs the starter's container image on ECS Fargate behind CloudFront. See docs/deploy.md.
//
//   viewer --https--> CloudFront --VPC origin--> internal ALB --> Fargate task (port 3000)
//
// CloudFront gives the app an https address without a domain of your own. A CloudFront Function
// writes the viewer's IP address into x-client-ip on every request, overwriting anything the
// client sent, and the load balancer sits in subnets with no route from the internet, so
// CloudFront is the only way in. That makes x-client-ip safe for AUTH_TRUSTED_IP_HEADER.
//
// Secrets come from AWS Secrets Manager, as <NamePrefix>/<SETTING>. The stack creates each one with
// a random value, so no value ever appears in the template and the task can reference the secret's
// full ARN, as ECS requires. SESSION_SECRET and CRON_SECRET keep their random values; the person
// deploying replaces the others with the real values in the console, then restarts the service.
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export const DEFAULT_IMAGE = 'ghcr.io/leonardovida/motherduck-dive-ai-chat-starter:latest';
export const CLIENT_IP_HEADER = 'x-client-ip';
const PORT = 3000;

export interface DiveChatOptions {
  // 'password' (DEMO_PASSWORD) or 'accounts' (MOTHERDUCK_APP_TOKEN). docs/configuration.md#sign-in
  signIn: 'password' | 'accounts';
  // Settings kept in Secrets Manager as <NamePrefix>/<NAME>, besides SESSION_SECRET, CRON_SECRET
  // and the sign-in secret. The defaults match the Vercel button: embed and chat tokens, OpenAI key.
  secretNames: string[];
  // Plain, non-secret settings, for example { CHAT_PROVIDER: 'anthropic' }.
  environment: Record<string, string>;
  // Optional: your own domain, with an ACM certificate for it in us-east-1.
  domainName?: string;
  certificateArn?: string;
  // Optional: the Availability Zones to use, for Regions where some zones lack CloudFront VPC origins.
  availabilityZones?: string[];
  desiredCount: number;
  cpu: number;
  memoryMiB: number;
}

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,99}$/;
// Set by the stack itself; the options cannot override them.
const MANAGED = new Set(['SESSION_SECRET', 'CRON_SECRET', 'APP_URL', 'AUTH_TRUSTED_IP_HEADER', 'NODE_ENV', 'PORT', 'HOSTNAME']);

export function validateOptions(options: DiveChatOptions): void {
  if (!['password', 'accounts'].includes(options.signIn)) throw new Error('signIn must be "password" or "accounts".');
  for (const name of [...options.secretNames, ...Object.keys(options.environment)]) {
    if (!ENV_NAME.test(name)) throw new Error(`${name} is not a valid environment variable name.`);
    if (MANAGED.has(name)) throw new Error(`${name} is set by the stack and cannot be overridden.`);
  }
  const both = options.secretNames.filter(name => name in options.environment);
  if (both.length) throw new Error(`${both.join(', ')} cannot be both a secret and a plain setting.`);
  if (Boolean(options.domainName) !== Boolean(options.certificateArn)) throw new Error('Set domainName and certificateArn together.');
}

export class DiveChatStack extends cdk.Stack {
  constructor(scope: Construct, id: string, options: DiveChatOptions, props?: cdk.StackProps) {
    super(scope, id, props);
    validateOptions(options);

    const image = new cdk.CfnParameter(this, 'ImageUri', {
      type: 'String',
      default: DEFAULT_IMAGE,
      description: 'Container image to run. Use a release tag, such as ghcr.io/<owner>/<repo>:0.6.0, to control upgrades.',
    });
    const prefix = new cdk.CfnParameter(this, 'NamePrefix', {
      type: 'String',
      default: 'motherduck-dive-chat',
      allowedPattern: '^[A-Za-z0-9_+=.@-]+$',
      description: 'Secrets Manager names start with this, for example motherduck-dive-chat/MOTHERDUCK_EMBED_TOKEN.',
    });
    const plain = {
      MOTHERDUCK_EMBED_USERNAME: new cdk.CfnParameter(this, 'MotherDuckEmbedUsername', { type: 'String', default: '', description: 'MOTHERDUCK_EMBED_USERNAME: the read-only service account the embedded Dive runs as.' }),
      DIVE_OVERVIEW_ID: new cdk.CfnParameter(this, 'DiveOverviewId', { type: 'String', default: '', description: 'DIVE_OVERVIEW_ID: the saved Dive to show.' }),
      DIVE_OVERVIEW_CHAT_DATABASE: new cdk.CfnParameter(this, 'DiveOverviewChatDatabase', { type: 'String', default: '', description: 'DIVE_OVERVIEW_CHAT_DATABASE: the database chat may query.' }),
      APP_TITLE: new cdk.CfnParameter(this, 'AppTitle', { type: 'String', default: '', description: 'APP_TITLE: the name in the header. Optional.' }),
    };

    const secretName = (name: string) => cdk.Fn.join('/', [prefix.valueAsString, name]);
    const generated = (id: string, name: string, description: string) => new secretsmanager.Secret(this, id, {
      secretName: secretName(name),
      description,
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });
    const sessionSecret = generated('GeneratedSESSION_SECRET', 'SESSION_SECRET', 'Signs sign-in cookies. Generated by the stack; keep it.');
    const cronSecret = generated('GeneratedCRON_SECRET', 'CRON_SECRET', 'Lets the scheduled jobs call /api/cron/*. Generated by the stack; keep it.');
    const userSecrets = [options.signIn === 'accounts' ? 'MOTHERDUCK_APP_TOKEN' : 'DEMO_PASSWORD', ...options.secretNames];
    const placeholders = userSecrets.map(name => [name, generated(`Secret${name}`, name, `${name}. Replace the random placeholder with the real value (plaintext), then restart the service. See docs/deploy.md.`)] as const);

    // Public subnets for the tasks (they reach MotherDuck and the model provider directly, with no
    // NAT gateway to pay for) and isolated subnets, with no internet route, for the load balancer.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      ...(options.availabilityZones?.length ? { availabilityZones: options.availabilityZones } : { maxAzs: 2 }),
      natGateways: 0,
      subnetConfiguration: [
        { name: 'tasks', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'origin', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });
    const logGroup = new logs.LogGroup(this, 'Logs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY });
    const containerImage = ecs.ContainerImage.fromRegistry(image.valueAsString);

    const alb = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      idleTimeout: cdk.Duration.seconds(300),
    });
    // CloudFront's VPC origin reaches the load balancer from CloudFront's origin-facing addresses.
    // The load balancer is internal and in subnets without an internet route, so this rule admits
    // only CloudFront (through this distribution's VPC origin) and resources inside this VPC.
    alb.connections.allowFromAnyIpv4(ec2.Port.tcp(80), 'CloudFront VPC origin');
    const listener = alb.addListener('Http', { port: 80, open: false });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'MotherDuck Dive + AI Chat',
      ...(options.domainName && options.certificateArn
        ? { domainNames: [options.domainName], certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', options.certificateArn) }
        : {}),
      defaultBehavior: {
        origin: origins.VpcOrigin.withApplicationLoadBalancer(alb, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          // Streamed chat answers keep sending data; this bounds a silent gap, not a whole answer.
          readTimeout: cdk.Duration.seconds(120),
          keepaliveTimeout: cdk.Duration.seconds(60),
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Forwards the viewer's Host, Origin and cookies, which the app's origin checks rely on.
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        functionAssociations: [{
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: new cloudfront.Function(this, 'ClientIp', {
            runtime: cloudfront.FunctionRuntime.JS_2_0,
            comment: `Overwrites ${CLIENT_IP_HEADER} with the viewer IP address`,
            code: cloudfront.FunctionCode.fromInline([
              'function handler(event) {',
              '  var request = event.request;',
              '  var ip = { value: event.viewer.ip };',
              `  request.headers['${CLIENT_IP_HEADER}'] = { value: ip.value, multiValue: [ip] };`,
              '  return request;',
              '}',
            ].join('\n')),
          }),
        }],
      },
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });
    const appUrl = options.domainName ? `https://${options.domainName}` : cdk.Fn.join('', ['https://', distribution.distributionDomainName]);

    const task = new ecs.FargateTaskDefinition(this, 'AppTask', {
      cpu: options.cpu,
      memoryLimitMiB: options.memoryMiB,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    task.addContainer('app', {
      image: containerImage,
      portMappings: [{ containerPort: PORT }],
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'app' }),
      environment: {
        ...options.environment,
        ...Object.fromEntries(Object.entries(plain).map(([name, parameter]) => [name, parameter.valueAsString])),
        APP_URL: appUrl,
        AUTH_TRUSTED_IP_HEADER: CLIENT_IP_HEADER,
      },
      secrets: {
        SESSION_SECRET: ecs.Secret.fromSecretsManager(sessionSecret),
        CRON_SECRET: ecs.Secret.fromSecretsManager(cronSecret),
        ...Object.fromEntries(placeholders.map(([name, secret]) => [name, ecs.Secret.fromSecretsManager(secret)])),
      },
    });
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: task,
      desiredCount: options.desiredCount,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      minHealthyPercent: 100,
      circuitBreaker: { enable: true, rollback: true },
    });
    listener.addTargets('App', {
      port: PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: { path: '/api/auth', healthyHttpCodes: '200', interval: cdk.Duration.seconds(30) },
    });

    // The two vercel.json crons. Each run starts the app image once, calls the route with
    // CRON_SECRET (deploy/cron.mjs) and stops.
    const cronSecurityGroup = new ec2.SecurityGroup(this, 'CronTasks', { vpc, description: 'Scheduled calls to the app', allowAllOutbound: true });
    const cronJob = (id: string, route: string, expression: scheduler.ScheduleExpression, description: string) => {
      const definition = new ecs.FargateTaskDefinition(this, `${id}Task`, {
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      });
      definition.addContainer('cron', {
        image: containerImage,
        command: ['node', 'deploy/cron.mjs', route],
        logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: id.toLowerCase() }),
        environment: { APP_URL: appUrl },
        secrets: { CRON_SECRET: ecs.Secret.fromSecretsManager(cronSecret) },
      });
      new scheduler.Schedule(this, `${id}Schedule`, {
        description,
        schedule: expression,
        target: new targets.EcsRunFargateTask(cluster, {
          taskDefinition: definition,
          assignPublicIp: true,
          vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
          securityGroups: [cronSecurityGroup],
          retryAttempts: 2,
        }),
      });
    };
    cronJob('Daily', '/api/cron/daily', scheduler.ScheduleExpression.cron({ minute: '17', hour: '4', timeZone: cdk.TimeZone.ETC_UTC }),
      'Daily upkeep: retention and MotherDuck grants (vercel.json "17 4 * * *")');
    cronJob('Digest', '/api/cron/digest', scheduler.ScheduleExpression.cron({ minute: '0', hour: '8', weekDay: 'MON', timeZone: cdk.TimeZone.ETC_UTC }),
      'Weekly digest, Mondays 08:00 UTC (vercel.json "0 8 * * 1")');

    new cdk.CfnOutput(this, 'AppUrl', { value: appUrl, description: 'The app address. APP_URL is already set to it.' });
    new cdk.CfnOutput(this, 'SecretsToFill', {
      value: cdk.Fn.join(', ', userSecrets.map(secretName)),
      description: 'Replace these placeholders with your values in Secrets Manager, then restart the service.',
    });
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'ServiceName', { value: service.serviceName });
  }
}
