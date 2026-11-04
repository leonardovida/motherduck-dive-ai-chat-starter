# Deploy to AWS, Google Cloud or Azure

This page explains how to run the starter in your own AWS, Google Cloud or Azure account. Vercel is still the quickest path; see the [README](../README.md#option-3-deploy-to-vercel). The settings are the same everywhere and are explained in the [settings reference](configuration.md#settings). If a coding agent is doing this for you, point it at this page and [AGENTS.md](../AGENTS.md).

## At a glance

| | AWS | Google Cloud | Azure |
| --- | --- | --- | --- |
| **Runs on** | ECS Fargate behind CloudFront | Cloud Run | Container Apps |
| **One click** | Upload a CloudFormation template in the console | **Run on Google Cloud** button | **Deploy to Azure** button |
| **Repeatable deploys** | AWS CDK (`cdk deploy`) | Terraform | Bicep (`az deployment group create`) |
| **Secrets** | Secrets Manager | Secret Manager | Key Vault |
| **Scheduled calls** | EventBridge Scheduler | Cloud Scheduler | Container Apps jobs |
| **Sign-in** | Shared password or accounts | Accounts; shared password with your own domain | Accounts; shared password with your own proxy |
| **Rough cost at light use** | About $40 a month | A few dollars a month | A few dollars a month |

Every option runs the same prebuilt container image, sets `APP_URL` for you and schedules the two calls that `vercel.json` makes on Vercel. None of them needs a database or a disk: the app keeps no state of its own, and the optional accounts data lives in MotherDuck.

## Before you start

You need the same [things as for Vercel](../README.md#what-you-need): a saved Dive, a read-only service account, an embed token, a read-only chat token and a model provider key. Have the values ready in your password manager. You type each secret once, into your cloud's secret manager or a hidden prompt, and never into a file.

### Choose how people sign in

The app has two [sign-in modes](configuration.md#sign-in):

- **Shared password** (`DEMO_PASSWORD`). Everyone types the same password. To slow down password guessing, the app counts failed attempts per visitor IP address. In production it only accepts an IP address from a header that a proxy in front of the app **overwrites** on every request, named by `AUTH_TRUSTED_IP_HEADER`. Without one, it refuses every password sign-in.
- **Accounts** (`MOTHERDUCK_APP_TOKEN`). Each person has their own login, and the app limits failed attempts per account, so it works without that header. See [docs/accounts.md](accounts.md).

The default address on each cloud behaves differently:

| Cloud | Trusted client-IP header | What that means |
| --- | --- | --- |
| AWS | **Yes.** A CloudFront Function overwrites `x-client-ip` with the visitor's address, and CloudFront is the only way in. | Both modes work. |
| Google Cloud | **Only with your own domain.** Cloud Run's own address appends to `X-Forwarded-For` rather than overwriting it. With a domain, the Terraform configuration adds a load balancer that overwrites `X-Client-IP`. | Use accounts, or Terraform with a domain for the shared password. |
| Azure | **No.** Container Apps appends to `X-Forwarded-For`, and only its last entry comes from Azure. | Use accounts. The shared password needs a proxy you control in front of the app; see [Azure](#password-sign-in-on-azure). |

### Prepare accounts mode

If you use accounts, do this once on your computer before deploying. It only talks to MotherDuck:

```sh
npm ci
# With MOTHERDUCK_APP_TOKEN in your environment, from your secret manager:
npm run db:migrate
npm run admin:create -- --username=<you>
```

`admin:create` asks for the administrator's password, or reads `ADMIN_PASSWORD`. Then use the same `MOTHERDUCK_APP_TOKEN` in the deployment.

## The container image

Each release publishes `ghcr.io/leonardovida/motherduck-dive-ai-chat-starter:<version>` (for example `:0.6.0`) and `:latest`. The templates default to `:latest`. To control when upgrades happen, use a version tag instead.

A fork publishes its own image, `ghcr.io/<owner>/<repo>`, when it pushes a release tag (`.github/workflows/container.yml`). GitHub may create the package as private: open the package's settings on GitHub and set its visibility to **Public** once, so the clouds can pull it without credentials. To build the image yourself, run `docker build -t dive-chat .` at the repository root.

The image runs `node server.js`, Next.js's production server, as a non-root user on port 3000. `GET /api/auth` returns 200 when the app is up, so the deployments use it as their health check.

## AWS

The stack runs one Fargate task behind an internal Application Load Balancer, with a CloudFront distribution in front of it. CloudFront provides the `https://<id>.cloudfront.net` address, so you do not need a domain. AWS App Runner is [closed to new customers](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html) since April 30, 2026, which is why the stack uses Fargate.

**Prerequisites:** an AWS account, permission to create IAM roles, and a Region that supports [CloudFront VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html#vpc-origins-supported-regions), such as `us-east-1`, `us-west-2` or `eu-west-1`. For the CDK path, also Node.js 24.2 or later and the AWS CLI signed in to the account.

The stack uses two Availability Zones, by default the first two in the Region. A few zones lack VPC origins: `use1-az3` in `us-east-1`, `usw1-az2` in `us-west-1`, `apne1-az3` in `ap-northeast-1` and `cac1-az3` in `ca-central-1`. These are zone IDs, and each account maps zone names such as `us-east-1a` to IDs differently. In those Regions, list your mapping in AWS CloudShell or with the AWS CLI, `aws ec2 describe-availability-zones --query "AvailabilityZones[].[ZoneName,ZoneId]" --output text`, and if the first two names map to an excluded ID, choose two other zones: the `AvailabilityZone1` and `AvailabilityZone2` parameters in the console, or the `availabilityZones` [CDK option](#cdk-options).

Deploying on AWS takes three steps: deploy the stack, put your values into the secrets it created, and restart the app.

### 1a. One click: the CloudFormation console

1. Download [`deploy/aws/cloudformation.template.json`](../deploy/aws/cloudformation.template.json).
2. Open [CloudFormation > Create stack](https://console.aws.amazon.com/cloudformation/home#/stacks/create), choose **Upload a template file** and select it.
3. Name the stack, for example `MotherDuckDiveChat`, and fill in `MotherDuckEmbedUsername`, `DiveOverviewId` and `DiveOverviewChatDatabase`. Set `ImageUri` to a version tag if you want one. Leave `AvailabilityZone1` and `AvailabilityZone2` empty unless the [zone note above](#aws) applies to you.
4. Acknowledge that the stack creates IAM roles and choose **Submit**. It takes 10 to 15 minutes, mostly for CloudFront.
5. Open the **Outputs** tab. `AppUrl` is the app's address. Continue with [step 2](#2-fill-in-the-secrets).

The template deploys the defaults in [`deploy/aws/cdk.json`](../deploy/aws/cdk.json): shared password and OpenAI. For accounts mode or another model provider, use the CDK path.

A maintainer can turn this into a true one-click link by hosting the template in a public S3 bucket, because [quick-create links](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stacks-quick-create-links.html) only accept templates in S3:

```
https://console.aws.amazon.com/cloudformation/home#/stacks/quickcreate?templateURL=<https URL of the template in S3>&stackName=MotherDuckDiveChat
```

### 1b. Repeatable: AWS CDK

```sh
cd deploy/aws
npm ci
npx cdk bootstrap        # once per account and Region
npx cdk deploy \
  --parameters MotherDuckEmbedUsername=<service account> \
  --parameters DiveOverviewId=<dive id> \
  --parameters DiveOverviewChatDatabase=<database> \
  --parameters ImageUri=ghcr.io/leonardovida/motherduck-dive-ai-chat-starter:<version>
```

The infrastructure packages live in `deploy/aws/package.json`, separate from the app. `npx cdk diff` shows what a change would do before you deploy it.

#### CDK options

Set these under `context` in [`deploy/aws/cdk.json`](../deploy/aws/cdk.json), or pass `-c name=value`:

| Option | Default | What it does |
| --- | --- | --- |
| `signIn` | `password` | `accounts` reads `<prefix>/MOTHERDUCK_APP_TOKEN` instead of `<prefix>/DEMO_PASSWORD`. |
| `secretNames` | embed token, chat token, `OPENAI_API_KEY` | The other settings read from Secrets Manager. Replace `OPENAI_API_KEY` with your provider's key, and add SSO client secrets or `MOTHERDUCK_ADMIN_TOKEN` here. |
| `environment` | `{}` | Plain settings, for example `{"CHAT_PROVIDER": "anthropic", "CHAT_RETENTION_DAYS": "90"}`. |
| `domainName`, `certificateArn` | none | Your own domain, with an ACM certificate for it in `us-east-1`. Point a CNAME at the CloudFront address afterwards. |
| `availabilityZones` | none | Two or more zones, for example `us-east-1b,us-east-1c`, if one of the Region's first two zones lacks CloudFront VPC origins (see [AWS](#aws)). Without it, the stack uses the `AvailabilityZone1` and `AvailabilityZone2` parameters, or the first two zones when those are empty. |
| `desiredCount`, `cpu`, `memoryMiB` | `1`, `512`, `1024` | The size of the app. Sign-in limits are kept per task. |

After changing `cdk.json`, run `npm run template` to refresh `cloudformation.template.json`. CI checks that the two agree.

### 2. Fill in the secrets

The stack creates each secret in Secrets Manager with a random value, so that no value ever passes through a template or a command line. Replace the placeholders with your values: in the Secrets Manager console, open each secret, choose **Retrieve secret value**, then **Edit**, and paste the value as **Plaintext**, with nothing around it.

| Secret | Holds |
| --- | --- |
| `motherduck-dive-chat/DEMO_PASSWORD` | The shared password. Keep the random value if you like, and share it with your viewers. Accounts mode has `motherduck-dive-chat/MOTHERDUCK_APP_TOKEN` instead. |
| `motherduck-dive-chat/MOTHERDUCK_EMBED_TOKEN` | The embed token |
| `motherduck-dive-chat/MOTHERDUCK_CHAT_TOKEN` | The read-only chat token |
| `motherduck-dive-chat/OPENAI_API_KEY` | Your OpenAI key, or the provider key you chose in [CDK options](#cdk-options) |
| `motherduck-dive-chat/SESSION_SECRET`, `motherduck-dive-chat/CRON_SECRET` | Generated. Leave them as they are. |

The `SecretsToFill` output lists the names. The `NamePrefix` parameter changes the `motherduck-dive-chat` part.

### 3. Restart the app

The app reads secrets when it starts. Start a new deployment, using the `ClusterName` and `ServiceName` outputs:

```sh
aws ecs update-service --cluster <ClusterName> --service <ServiceName> --force-new-deployment
```

Or, in the ECS console, open the service, choose **Update service**, tick **Force new deployment** and choose **Update**. Do the same after changing a secret later. The scheduled tasks read `CRON_SECRET` each time they run.

### APP_URL on AWS

The stack sets `APP_URL` to the CloudFront address, or to your domain, before the app starts, so there is nothing to do after the first deploy. For SSO, register `<AppUrl>/api/account/callback/<provider id>` with your identity provider.

### Scheduled calls on AWS

Two EventBridge Scheduler schedules run the `vercel.json` crons: the daily upkeep at 04:17 UTC and the weekly digest on Mondays at 08:00 UTC. Each starts a small Fargate task from the same image, which calls the route with `CRON_SECRET` and stops. To run one now, open the stack's cluster in the ECS console, choose **Tasks** and then **Run task**, choose the **Launch type** `FARGATE`, and pick the task definition whose name contains `DailyTask`. Under **Networking**, choose the stack's VPC, its two public subnets (their names contain `tasks`), the security group described as "Scheduled calls to the app", and turn on **Public IP**: the task pulls the image and calls the app over the internet. The output is in the stack's CloudWatch log group.

### Upgrade on AWS

- **CDK:** `npx cdk deploy --parameters ImageUri=ghcr.io/leonardovida/motherduck-dive-ai-chat-starter:<new version>`. CDK keeps the other parameter values.
- **Console:** **Update stack**, keep the current template, and change `ImageUri`.
- **On `:latest`:** start a new deployment so ECS pulls the newest image: `aws ecs update-service --cluster <ClusterName> --service <ServiceName> --force-new-deployment`. The names are in the stack outputs. Scheduled tasks pull the image each time they run.

ECS replaces the task only when the new one passes its health check, and rolls back if it does not.

### Cost on AWS

At light use, in `us-east-1`, expect about $40 a month: the load balancer (about $17), a 0.5 vCPU / 1 GB Fargate task running all month (about $18), its public IPv4 address (about $4) and the secrets ($0.40 each). CloudFront and the scheduled tasks add cents at this scale. There is no NAT gateway. Check the [AWS Pricing Calculator](https://calculator.aws/) for your Region.

### Tear down on AWS

Run `npx cdk destroy`, or delete the stack in the CloudFormation console. This removes everything, including the secrets. Secrets Manager keeps deleted secrets, and their names, for a recovery window, so a new stack with the same `NamePrefix` fails until the window ends. Use another `NamePrefix`, or delete the old secrets for good with `aws secretsmanager delete-secret --secret-id <name> --force-delete-without-recovery`.

## Google Cloud

The app runs on Cloud Run with secrets from Secret Manager. Cloud Scheduler starts two Cloud Run jobs for the scheduled calls.

**Prerequisites:** a Google Cloud project with billing, and the Owner role, or roles that can enable APIs and manage Cloud Run, Secret Manager, service accounts and Cloud Scheduler.

### One click: Run on Google Cloud

[![Run on Google Cloud](https://deploy.cloud.run/button.svg)](https://deploy.cloud.run/?git_repo=https://github.com/leonardovida/motherduck-dive-ai-chat-starter&dir=deploy/gcp)

The [Run on Google Cloud button](https://github.com/GoogleCloudPlatform/cloud-run-button) opens Cloud Shell and runs [`deploy/gcp/app.json`](../deploy/gcp/app.json). Google labels it "not an officially supported Google product". It deploys accounts mode, so [prepare accounts mode](#prepare-accounts-mode) first. Then it:

1. Asks for the project and Region, then `MOTHERDUCK_EMBED_USERNAME`, `DIVE_OVERVIEW_ID`, `DIVE_OVERVIEW_CHAT_DATABASE` and `APP_TITLE`.
2. Copies the published image into Artifact Registry. A fork with its own published image uses that one.
3. Asks for your model provider's setting name (default `OPENAI_API_KEY`), then for each missing secret with hidden input: `MOTHERDUCK_APP_TOKEN`, `MOTHERDUCK_EMBED_TOKEN`, `MOTHERDUCK_CHAT_TOKEN` and the model key. It generates `SESSION_SECRET` and `CRON_SECRET`. Each goes straight to Secret Manager as `motherduck-dive-chat-<SETTING>`. Existing secrets are kept.
4. Creates the Cloud Run service and a service account that can read only those secrets.
5. Connects the secrets, sets `APP_URL`, and creates the scheduled jobs.

It prints the app's address at the end.

### Repeatable: Terraform

```sh
# 1. Create the secrets (hidden prompts; existing secrets are kept)
deploy/gcp/scripts/create-secrets.sh --project <project id> --sign-in accounts \
  --secrets MOTHERDUCK_EMBED_TOKEN,MOTHERDUCK_CHAT_TOKEN,OPENAI_API_KEY

# 2. Describe the deployment
cd deploy/gcp/terraform
cp terraform.tfvars.example terraform.tfvars   # then fill in names and plain settings only

# 3. Deploy
terraform init
terraform apply
```

Terraform reads only the secrets' names, so no secret value reaches the Terraform state. It fails before creating anything if a secret is missing. The variables are described in [`variables.tf`](../deploy/gcp/terraform/variables.tf): `secret_names` lists the secrets besides the sign-in secret, `settings` holds plain settings, and `domain` adds your own domain. Keep the state somewhere safe and shared, such as a [Cloud Storage backend](https://developer.hashicorp.com/terraform/language/backend/gcs), if more than one person deploys.

### Password sign-in on Google Cloud

Set `domain = "dives.example.com"` and `sign_in_mode = "password"`, and create `<prefix>-DEMO_PASSWORD` with `create-secrets.sh --sign-in password`. Terraform then adds a global external Application Load Balancer with a Google-managed certificate. The load balancer overwrites `X-Client-IP` with the visitor's address ([custom headers](https://cloud.google.com/load-balancing/docs/https/custom-headers)), and Cloud Run accepts traffic only from load balancers in your project. Point an A record for the domain at the `load_balancer_ip` output. The certificate becomes active once DNS resolves, which often takes 15 to 60 minutes.

### APP_URL on Google Cloud

`APP_URL` is set for you to Cloud Run's predictable address, `https://<service>-<project number>.<region>.run.app`, or to `https://<domain>`. Cloud Run also lists an older address for the same service. Use the `APP_URL` address for sign-in and SSO.

### Scheduled calls on Google Cloud

Cloud Scheduler starts two Cloud Run jobs, `<service>-cron-daily` (04:17 UTC) and `<service>-cron-digest` (Mondays 08:00 UTC). Each runs the app image once to call the route with `CRON_SECRET`. To run one now: `gcloud run jobs execute <service>-cron-daily --region <region>`.

### Upgrade on Google Cloud

- **Terraform:** change `image` to the new version and run `terraform apply`.
- **Button:** deploy the new version to the service and both jobs:

  ```sh
  image=ghcr.io/leonardovida/motherduck-dive-ai-chat-starter:<version>
  gcloud run deploy motherduck-dive-chat --image "$image" --region <region>
  gcloud run jobs update motherduck-dive-chat-cron-daily --image "$image" --region <region>
  gcloud run jobs update motherduck-dive-chat-cron-digest --image "$image" --region <region>
  ```

Cloud Run moves traffic to the new revision only after it starts and passes its startup check.

### Cost on Google Cloud

The service scales to zero when idle and keeps its CPU between requests while an instance is up, because the app finishes some work after answering. At light use that is a few dollars a month. Secret Manager costs a few cents per secret, and Cloud Scheduler includes three free jobs per billing account. With a domain, the load balancer adds about $18 a month. Set `min_instances = 1` to avoid the few-second first request after an idle period, at the cost of an instance running all month. See the [Google Cloud pricing calculator](https://cloud.google.com/products/calculator).

### Tear down on Google Cloud

- **Terraform:** `terraform destroy`, then delete the secrets: `gcloud secrets delete <name>`.
- **Button:** delete the Cloud Run service, both Cloud Run jobs and both Cloud Scheduler jobs, the `<service>-app` and `<service>-sched` service accounts, the secrets, and the image in the `cloud-run-source-deploy` Artifact Registry repository.

## Azure

The app runs on Azure Container Apps. The template creates a Key Vault, stores the secrets you type in it, and gives the app a managed identity that can only read them. Two scheduled Container Apps jobs make the scheduled calls.

**Prerequisites:** an Azure subscription and a resource group, with the Owner role on the group, or Contributor plus User Access Administrator, because the template assigns the identity a Key Vault role.

### One click: Deploy to Azure

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fleonardovida%2Fmotherduck-dive-ai-chat-starter%2FHEAD%2Fdeploy%2Fazure%2Fazuredeploy.json)

The button opens the Azure portal with [`deploy/azure/azuredeploy.json`](../deploy/azure/azuredeploy.json), the ARM template compiled from [`main.bicep`](../deploy/azure/main.bicep). [Prepare accounts mode](#prepare-accounts-mode) first, then fill in:

| Field | Value |
| --- | --- |
| **Sign In Mode** | `accounts` |
| **Sign In Secret** | `MOTHERDUCK_APP_TOKEN` |
| **Motherduck Embed Token**, **Motherduck Chat Token** | The embed token and the read-only chat token |
| **Model Api Key Setting**, **Model Api Key** | Your provider's setting name and key |
| **Motherduck Embed Username**, **Dive Overview Id**, **Dive Overview Chat Database** | As in the [settings reference](configuration.md#dashboard-embedded-dive) |
| **Settings**, **Extra Secrets** | Optional JSON objects for other settings, for example `{"CHAT_PROVIDER": "azure", "AZURE_RESOURCE_NAME": "my-resource"}` |
| **Session Secret**, **Cron Secret** | Leave them as they are. They are generated. |

Secret fields are hidden, are not stored in the deployment history, and go only into Key Vault. Deployment takes about five minutes. The **Outputs** of the deployment show `appUrl`.

### Repeatable: Bicep

```sh
az group create --name dive-chat --location westeurope
az deployment group create --resource-group dive-chat --template-file deploy/azure/main.bicep \
  --parameters motherduckEmbedUsername=<service account> diveOverviewId=<dive id> diveOverviewChatDatabase=<database>
```

The Azure CLI asks for each secret parameter with hidden input. After editing `main.bicep`, rebuild the ARM template with the same Bicep version as CI (see `.github/workflows/deploy-templates.yml`): `az bicep build --file deploy/azure/main.bicep --outfile deploy/azure/azuredeploy.json`. CI fails when the two differ.

### Password sign-in on Azure

Container Apps does not provide a header that it overwrites with the visitor's address. For the shared password, put a proxy you control in front of the app that overwrites a header such as `X-Client-IP` with the client address, and make it the only way in, for example Application Gateway with an internal Container Apps environment. Then set **Sign In Mode** to `password`, **Sign In Secret** to the password and **Trusted Ip Header** to that header. Otherwise use accounts.

### APP_URL on Azure

`APP_URL` is set for you to `https://<appName>.<environment domain>`, the app's address in Container Apps. If you add a custom domain later, add `"APP_URL": "https://your.domain"` to **Settings** and deploy again.

### Scheduled calls on Azure

Two Container Apps jobs, `<appName>-daily` (04:17 UTC) and `<appName>-digest` (Mondays 08:00 UTC), run the app image once to call the route with `CRON_SECRET` from Key Vault. To run one now: `az containerapp job start --name dive-chat-daily --resource-group <group>`. **Execution history** on the job shows each run.

### Upgrade on Azure

```sh
image=ghcr.io/leonardovida/motherduck-dive-ai-chat-starter:<version>
az containerapp update --name dive-chat --resource-group <group> --image "$image"
az containerapp job update --name dive-chat-daily --resource-group <group> --image "$image"
az containerapp job update --name dive-chat-digest --resource-group <group> --image "$image"
```

Avoid redeploying the whole template only to upgrade: it generates a new `SESSION_SECRET`, which signs everyone out, unless you pass the current value.

### Cost on Azure

With the default of zero replicas when idle, a light workload usually stays within the Container Apps monthly free grant, so expect a few dollars a month, mostly Log Analytics. Key Vault charges per operation. Setting `minReplicas` to 1 keeps one 0.5 vCPU replica running, at roughly $30 to $40 a month. See the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/).

### Tear down on Azure

Delete the resource group: `az group delete --name <group>`. Key Vault keeps a deleted vault for seven days. To redeploy into a group with the same name within that time, purge it first: `az keyvault purge --name <keyVaultName>` (the name is in the deployment outputs).

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Password sign-in says it **isn't configured** | `AUTH_TRUSTED_IP_HEADER` is not set, or no trusted proxy sets it. Use accounts, or see [Choose how people sign in](#choose-how-people-sign-in). |
| The AWS app shows connection or sign-in errors after the first deploy | The secrets still hold their random placeholders, or the service has not restarted since you changed them. See [Fill in the secrets](#2-fill-in-the-secrets). |
| The AWS stack fails at the VPC origin | One of the stack's zones lacks CloudFront VPC origins. Delete the failed stack, then deploy again with two other zones: `AvailabilityZone1` and `AvailabilityZone2` in the console, or `availabilityZones` with CDK. See [AWS](#aws). |
| Terraform says a secret was not found | Run `create-secrets.sh` with the same `--prefix` and `--secrets`. |
| The Azure app shows a secret error on first deploy | The new identity's Key Vault access can take a few minutes to apply. Run the deployment again. |
| SSO says it **did not complete** | Register `<APP_URL>/api/account/callback/<provider id>`, using the `APP_URL` address. |
| A scheduled call fails with 404 | `CRON_SECRET` is missing or shorter than 16 characters in the app, or the job reads a different secret. |

To see what the app is missing, open its logs, or run `npm run --silent setup -- --json --production` locally with the same settings.
