// Runs the starter's container image on Azure Container Apps, with every secret in Azure Key Vault
// and the two vercel.json crons as scheduled Container Apps jobs. See docs/deploy.md.
//
// The "Deploy to Azure" button deploys azuredeploy.json, which is compiled from this file:
//   az bicep build --file deploy/azure/main.bicep --outfile deploy/azure/azuredeploy.json
// CI fails when the two differ.

@description('Name for the container app; the jobs and other resources are named after it. Lowercase letters, digits and hyphens.')
@minLength(2)
@maxLength(24)
param appName string = 'dive-chat'

@description('Region for every resource. Defaults to the resource group\'s region.')
param location string = resourceGroup().location

@description('Container image. Use a release tag, such as ghcr.io/<owner>/<repo>:0.6.0, to control upgrades.')
param image string = 'ghcr.io/leonardovida/motherduck-dive-ai-chat-starter:latest'

@description('accounts: per-person sign-in (MOTHERDUCK_APP_TOKEN). password: one shared password (DEMO_PASSWORD), which also needs trustedIpHeader. See docs/deploy.md.')
@allowed(['accounts', 'password'])
param signInMode string = 'accounts'

@secure()
@description('MOTHERDUCK_APP_TOKEN in accounts mode, or DEMO_PASSWORD in password mode. Stored in Key Vault.')
param signInSecret string

@secure()
@description('MOTHERDUCK_EMBED_TOKEN: a MotherDuck token allowed to create embed sessions. Stored in Key Vault.')
param motherduckEmbedToken string

@secure()
@description('MOTHERDUCK_CHAT_TOKEN: a read-only MotherDuck token for chat. Leave empty to show the Dive without chat. Stored in Key Vault.')
param motherduckChatToken string = ''

@description('The setting name of your model provider key.')
@allowed(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'AZURE_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK', 'GOOGLE_VERTEX_API_KEY', 'OPENAI_COMPATIBLE_API_KEY'])
param modelApiKeySetting string = 'OPENAI_API_KEY'

@secure()
@description('The model provider key. Leave empty to show the Dive without chat. Stored in Key Vault.')
param modelApiKey string = ''

@description('MOTHERDUCK_EMBED_USERNAME: the read-only service account the embedded Dive runs as.')
param motherduckEmbedUsername string

@description('DIVE_OVERVIEW_ID: the ID of the saved Dive to show.')
param diveOverviewId string

@description('DIVE_OVERVIEW_CHAT_DATABASE: the database chat may query.')
param diveOverviewChatDatabase string = ''

@description('APP_TITLE: the name shown in the header. Optional.')
param appTitle string = ''

@description('Other plain settings as a JSON object, for example {"CHAT_PROVIDER": "azure", "AZURE_RESOURCE_NAME": "my-resource"}. Add "APP_URL" here when the app has its own domain.')
param settings object = {}

@secure()
@description('Other secret settings as a JSON object, for example {"SSO_CLIENT_SECRET": "..."}. Names use letters, digits and underscores. Stored in Key Vault.')
param extraSecrets object = {}

@description('Leave empty. Set it only when a proxy you control overwrites this header with the visitor\'s IP address on every request, and Allowed Ip Ranges admits only that proxy. Password sign-in needs it. See docs/deploy.md.')
param trustedIpHeader string = ''

@description('Leave empty to accept requests from anywhere. Otherwise only these IPv4 ranges in CIDR notation, for example ["203.0.113.10/32"], can reach the app\'s own address. See docs/deploy.md.')
param allowedIpRanges array = []

@secure()
@minLength(32)
@description('SESSION_SECRET, which signs sign-in sessions. Leave the generated value. Stored in Key Vault.')
param sessionSecret string = '${newGuid()}${newGuid()}'

@secure()
@minLength(16)
@description('CRON_SECRET for the scheduled jobs. Leave the generated value. Stored in Key Vault.')
param cronSecret string = newGuid()

@description('false on the first deployment. Set it to true when deploying again: Key Vault then keeps its SESSION_SECRET and CRON_SECRET, the two fields above are ignored, and nobody is signed out.')
param keepGeneratedSecrets bool = false

@description('Replicas kept running. 0 scales to zero when idle; the first request then takes a few seconds.')
@minValue(0)
param minReplicas int = 0

@description('The most replicas. Sign-in limits are kept per replica.')
@minValue(1)
param maxReplicas int = 2

var suffix = uniqueString(resourceGroup().id, appName)
var signInSetting = signInMode == 'accounts' ? 'MOTHERDUCK_APP_TOKEN' : 'DEMO_PASSWORD'
// Setting name to value. The named parameters win over the same names in extraSecrets.
var secretValues = union(
  extraSecrets,
  keepGeneratedSecrets ? {} : { SESSION_SECRET: sessionSecret, CRON_SECRET: cronSecret },
  { '${signInSetting}': signInSecret, MOTHERDUCK_EMBED_TOKEN: motherduckEmbedToken },
  empty(motherduckChatToken) ? {} : { MOTHERDUCK_CHAT_TOKEN: motherduckChatToken },
  empty(modelApiKey) ? {} : { '${modelApiKeySetting}': modelApiKey }
)
// Every secret setting the app reads from Key Vault. With keepGeneratedSecrets, the template does not
// write SESSION_SECRET and CRON_SECRET, but the app and the jobs still read the values already stored.
var secretSettings = union(['SESSION_SECRET', 'CRON_SECRET'], objectKeys(secretValues))
// Key Vault secret names allow letters, digits and hyphens: SESSION_SECRET is stored as session-secret.
func vaultSecretName(setting string) string => toLower(replace(setting, '_', '-'))
// Empty parameters do not override the same names in settings, and do not become empty variables.
var namedSettings = filter(items({
  MOTHERDUCK_EMBED_USERNAME: motherduckEmbedUsername
  DIVE_OVERVIEW_ID: diveOverviewId
  DIVE_OVERVIEW_CHAT_DATABASE: diveOverviewChatDatabase
  APP_TITLE: appTitle
  AUTH_TRUSTED_IP_HEADER: trustedIpHeader
}), entry => !empty(entry.value))
var plainSettings = union(settings, toObject(namedSettings, entry => entry.key, entry => entry.value))
// APP_URL is set once, below. A name that is also a secret setting is read from Key Vault only.
var plainEnv = map(
  filter(items(plainSettings), entry => entry.key != 'APP_URL' && !contains(secretSettings, entry.key)),
  entry => { name: entry.key, value: string(entry.value) }
)
var keyVaultSecretsUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${appName}-identity'
  location: location
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${suffix}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource vaultSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [for item in items(secretValues): {
  parent: vault
  name: vaultSecretName(item.key)
  properties: { value: item.value }
}]

resource readSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, identity.id, keyVaultSecretsUser)
  scope: vault
  properties: {
    roleDefinitionId: keyVaultSecretsUser
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${appName}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// The environment waits for the Key Vault role, so that its creation, which takes a few minutes,
// gives the role time to take effect before the app and the jobs first read their secrets.
resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${appName}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
  }
  dependsOn: [readSecrets]
}

// The app's own address in Container Apps, unless settings gives the address of its own domain.
var appUrl = settings.?APP_URL ?? 'https://${appName}.${environment.properties.defaultDomain}'
var vaultUri = 'https://${vault.name}${az.environment().suffixes.keyvaultDns}'
var secretRefs = [for setting in secretSettings: {
  name: vaultSecretName(setting)
  keyVaultUrl: '${vaultUri}/secrets/${vaultSecretName(setting)}'
  identity: identity.id
}]
var cronSecretRef = filter(secretRefs, ref => ref.name == 'cron-secret')

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        ipSecurityRestrictions: [for (range, index) in allowedIpRanges: {
          name: 'allow-${index}'
          ipAddressRange: range
          action: 'Allow'
        }]
      }
      secrets: secretRefs
    }
    template: {
      containers: [
        {
          name: 'app'
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(
            plainEnv,
            [{ name: 'APP_URL', value: appUrl }],
            map(secretSettings, setting => { name: setting, secretRef: vaultSecretName(setting) })
          )
          probes: [
            { type: 'Startup', httpGet: { path: '/api/auth', port: 3000 }, periodSeconds: 5, failureThreshold: 30 }
            { type: 'Liveness', httpGet: { path: '/api/auth', port: 3000 }, periodSeconds: 30 }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
  dependsOn: [readSecrets, vaultSecrets]
}

// The two vercel.json crons. Each run starts the app image once and calls the route with
// CRON_SECRET (deploy/cron.mjs). Container Apps evaluates cron expressions in UTC.
var cronJobs = [
  { name: 'daily', route: '/api/cron/daily', cron: '17 4 * * *' }
  { name: 'digest', route: '/api/cron/digest', cron: '0 8 * * 1' }
]

resource jobs 'Microsoft.App/jobs@2025-01-01' = [for job in cronJobs: {
  name: '${appName}-${job.name}'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: job.cron
        parallelism: 1
        replicaCompletionCount: 1
      }
      // deploy/cron.mjs waits up to 330 seconds per call. The timeout also covers the one retry.
      replicaTimeout: 900
      replicaRetryLimit: 1
      secrets: cronSecretRef
    }
    template: {
      containers: [
        {
          name: 'cron'
          image: image
          command: ['node', 'deploy/cron.mjs', job.route]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'APP_URL', value: appUrl }
            { name: 'CRON_SECRET', secretRef: 'cron-secret' }
          ]
        }
      ]
    }
  }
  dependsOn: [readSecrets, vaultSecrets]
}]

@description('The app address, which APP_URL is set to.')
output appUrl string = appUrl

@description('The Key Vault that holds the secrets.')
output keyVaultName string = vault.name
