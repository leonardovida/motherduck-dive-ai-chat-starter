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

@description('Other plain settings as a JSON object, for example {"CHAT_PROVIDER": "azure", "AZURE_RESOURCE_NAME": "my-resource"}.')
param settings object = {}

@secure()
@description('Other secret settings as a JSON object, for example {"SSO_CLIENT_SECRET": "..."}. Stored in Key Vault.')
param extraSecrets object = {}

@description('Leave empty unless a proxy you control sits in front of the app, overwrites this header with the client IP and is the only way in. Password sign-in needs it. See docs/deploy.md.')
param trustedIpHeader string = ''

@secure()
@description('SESSION_SECRET. Leave the generated value.')
param sessionSecret string = '${newGuid()}${newGuid()}'

@secure()
@description('CRON_SECRET for the scheduled jobs. Leave the generated value.')
param cronSecret string = newGuid()

@description('Replicas kept running. 0 scales to zero when idle; the first request then takes a few seconds.')
@minValue(0)
param minReplicas int = 0

@description('The most replicas. Sign-in limits are kept per replica.')
@minValue(1)
param maxReplicas int = 2

var suffix = uniqueString(resourceGroup().id, appName)
var signInSetting = signInMode == 'accounts' ? 'MOTHERDUCK_APP_TOKEN' : 'DEMO_PASSWORD'
var baseSecrets = concat(
  [
    { setting: 'SESSION_SECRET', value: sessionSecret }
    { setting: 'CRON_SECRET', value: cronSecret }
    { setting: signInSetting, value: signInSecret }
    { setting: 'MOTHERDUCK_EMBED_TOKEN', value: motherduckEmbedToken }
  ],
  empty(motherduckChatToken) ? [] : [{ setting: 'MOTHERDUCK_CHAT_TOKEN', value: motherduckChatToken }],
  empty(modelApiKey) ? [] : [{ setting: modelApiKeySetting, value: modelApiKey }]
)
// Key Vault secret names allow letters, digits and hyphens: SESSION_SECRET is stored as session-secret.
var allSecrets = [for item in concat(baseSecrets, map(items(extraSecrets), entry => { setting: entry.key, value: entry.value })): {
  setting: item.setting
  value: item.value
  name: toLower(replace(item.setting, '_', '-'))
}]
var plainSettings = union(settings, {
  MOTHERDUCK_EMBED_USERNAME: motherduckEmbedUsername
  DIVE_OVERVIEW_ID: diveOverviewId
  DIVE_OVERVIEW_CHAT_DATABASE: diveOverviewChatDatabase
  APP_TITLE: appTitle
}, empty(trustedIpHeader) ? {} : { AUTH_TRUSTED_IP_HEADER: trustedIpHeader })
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

resource vaultSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [for item in allSecrets: {
  parent: vault
  name: item.name
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
}

var appUrl = 'https://${appName}.${environment.properties.defaultDomain}'
var vaultUri = 'https://${vault.name}${az.environment().suffixes.keyvaultDns}'
var secretRefs = [for item in allSecrets: {
  name: item.name
  keyVaultUrl: '${vaultUri}/secrets/${item.name}'
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
            map(items(plainSettings), entry => { name: entry.key, value: string(entry.value) }),
            [{ name: 'APP_URL', value: appUrl }],
            map(allSecrets, item => { name: item.setting, secretRef: item.name })
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
      replicaTimeout: 600
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

@description('The app address. APP_URL is already set to it.')
output appUrl string = appUrl

@description('The Key Vault that holds the secrets.')
output keyVaultName string = vault.name
