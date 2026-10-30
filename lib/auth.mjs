import { betterAuth } from 'better-auth';
import { admin, genericOAuth, username } from 'better-auth/plugins';
import { microsoftEntraId, okta } from 'better-auth/plugins/generic-oauth';
import { appPool, appStoreConfigured } from './app-db.mjs';
import { sessionSecret } from './security.mjs';
import { trustedIPHeader } from './login-limit.mjs';

// Accounts mode: per-person sign-in, an admin portal, SSO and saved conversations.
// It turns on when MOTHERDUCK_APP_TOKEN is set; otherwise the shared password still works.
export const AUTH_BASE_PATH = '/api/account';
export const accountsEnabled = (env = process.env) => appStoreConfigured(env);

const value = (env, name) => String(env[name] ?? '').trim();
const list = raw => raw.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);

// Sign-in buttons, from env only. Generic OIDC covers Okta, Entra ID, Google Workspace, Auth0,
// Keycloak and any provider with a discovery URL. Secrets never leave the server.
export function ssoProviders(env = process.env) {
  const providers = [];
  if (value(env, 'SSO_CLIENT_ID') && value(env, 'SSO_CLIENT_SECRET') && (value(env, 'SSO_ISSUER') || value(env, 'SSO_DISCOVERY_URL'))) {
    const issuer = value(env, 'SSO_ISSUER').replace(/\/$/, '');
    providers.push({
      id: value(env, 'SSO_PROVIDER_ID').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'sso', label: value(env, 'SSO_LABEL') || 'Single sign-on', kind: 'oidc',
      config: { discoveryUrl: value(env, 'SSO_DISCOVERY_URL') || `${issuer}/.well-known/openid-configuration`, clientId: value(env, 'SSO_CLIENT_ID'), clientSecret: value(env, 'SSO_CLIENT_SECRET'), scopes: ['openid', 'profile', 'email'], pkce: true },
    });
  }
  if (value(env, 'OKTA_CLIENT_ID') && value(env, 'OKTA_CLIENT_SECRET') && value(env, 'OKTA_ISSUER')) {
    providers.push({ id: 'okta', label: 'Okta', kind: 'oidc', config: okta({ clientId: value(env, 'OKTA_CLIENT_ID'), clientSecret: value(env, 'OKTA_CLIENT_SECRET'), issuer: value(env, 'OKTA_ISSUER') }) });
  }
  if (value(env, 'MICROSOFT_CLIENT_ID') && value(env, 'MICROSOFT_CLIENT_SECRET') && value(env, 'MICROSOFT_TENANT_ID')) {
    providers.push({ id: 'microsoft-entra-id', label: 'Microsoft', kind: 'oidc', config: microsoftEntraId({ clientId: value(env, 'MICROSOFT_CLIENT_ID'), clientSecret: value(env, 'MICROSOFT_CLIENT_SECRET'), tenantId: value(env, 'MICROSOFT_TENANT_ID') }) });
  }
  if (value(env, 'GOOGLE_CLIENT_ID') && value(env, 'GOOGLE_CLIENT_SECRET')) providers.push({ id: 'google', label: 'Google', kind: 'social', config: { clientId: value(env, 'GOOGLE_CLIENT_ID'), clientSecret: value(env, 'GOOGLE_CLIENT_SECRET') } });
  if (value(env, 'GITHUB_CLIENT_ID') && value(env, 'GITHUB_CLIENT_SECRET')) providers.push({ id: 'github', label: 'GitHub', kind: 'social', config: { clientId: value(env, 'GITHUB_CLIENT_ID'), clientSecret: value(env, 'GITHUB_CLIENT_SECRET') } });
  return providers;
}

export const publicSsoProviders = (env = process.env) => ssoProviders(env).map(({ id, label }) => ({ id, label }));

// SSO may create accounts only for allowed email domains. Without an allowlist, a person must
// already have an account (created by an admin with the same email) before SSO signs them in.
export const allowedEmailDomains = (env = process.env) => list(value(env, 'AUTH_ALLOWED_EMAIL_DOMAINS'));
export function emailDomainAllowed(email, env = process.env) {
  const domains = allowedEmailDomains(env);
  const domain = String(email ?? '').toLowerCase().split('@')[1];
  return Boolean(domain) && domains.includes(domain);
}

export function appBaseURL(env = process.env) {
  if (value(env, 'APP_URL')) return value(env, 'APP_URL').replace(/\/$/, '');
  if (value(env, 'VERCEL_PROJECT_PRODUCTION_URL')) return `https://${value(env, 'VERCEL_PROJECT_PRODUCTION_URL')}`;
  return env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000';
}

// Pure options, shared by the running app and the migration script.
export function authOptions(env = process.env, database = undefined) {
  const providers = ssoProviders(env);
  const oidc = providers.filter(provider => provider.kind === 'oidc');
  const social = Object.fromEntries(providers.filter(provider => provider.kind === 'social').map(provider => [provider.id, { ...provider.config, disableImplicitSignUp: !allowedEmailDomains(env).length }]));
  const ipHeader = trustedIPHeader(env);
  const baseURL = appBaseURL(env);
  return {
    appName: value(env, 'APP_TITLE') || 'Dive workspace',
    basePath: AUTH_BASE_PATH,
    ...(baseURL ? { baseURL } : {}),
    ...(database ? { database } : {}),
    secret: sessionSecret(env) ?? undefined,
    trustedOrigins: baseURL ? [baseURL] : [],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 256 },
    socialProviders: social,
    account: { accountLinking: { enabled: true, trustedProviders: providers.map(provider => provider.id) } },
    session: { expiresIn: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60, cookieCache: { enabled: true, maxAge: 60 } },
    user: {
      additionalFields: {
        // '*' or a comma-separated list of Dive keys from dives.config.mjs.
        diveAccess: { type: 'string', required: false, defaultValue: '*', input: false },
        chatAccess: { type: 'boolean', required: false, defaultValue: true, input: false },
      },
    },
    databaseHooks: {
      user: { create: { before: async (user, ctx) => {
        // Only admins (createUser) or allowed SSO domains create accounts.
        const viaAdmin = ctx?.path === '/admin/create-user' || !ctx;
        if (!viaAdmin && !emailDomainAllowed(user.email, env)) return false;
        return { data: user };
      } } },
    },
    rateLimit: { enabled: true, window: 60, max: 60, customRules: { '/sign-in/username': { window: 600, max: 10 }, '/sign-in/email': { window: 600, max: 10 } } },
    advanced: {
      cookiePrefix: 'dive_chat',
      // MotherDuck has no Postgres catalog functions; `npm run db:migrate` owns the schema instead.
      database: { validateSchema: false },
      ipAddress: ipHeader ? { ipAddressHeaders: [ipHeader] } : { disableIpTracking: true },
    },
    plugins: [
      username({ minUsernameLength: 2, maxUsernameLength: 40 }),
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
      ...(oidc.length ? [genericOAuth({ config: oidc.map(provider => ({ ...provider.config, providerId: provider.id, disableImplicitSignUp: !allowedEmailDomains(env).length })) })] : []),
    ],
  };
}

export function getAuth(env = process.env) {
  if (!accountsEnabled(env)) return null;
  globalThis.__diveChatAuth ??= betterAuth(authOptions(env, appPool(env)));
  return globalThis.__diveChatAuth;
}
