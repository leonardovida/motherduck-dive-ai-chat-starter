import { betterAuth } from 'better-auth';
import { admin, genericOAuth, username } from 'better-auth/plugins';
import { microsoftEntraId, okta } from 'better-auth/plugins/generic-oauth';
import { appPool, appQuery, appStoreConfigured } from './app-db.mjs';
import { createGroupStore } from './groups.mjs';
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

// Providers whose email claim the deployer controls, so an email they send counts as verified
// even without an email_verified claim: an Okta org, one Entra ID tenant (Better Auth's helper
// accepts only a tenant GUID, never "common"), and the generic provider when SSO_TRUSTED=true
// says it is the company's own. Any other provider must say the email is verified, or the app
// neither links it to an existing account nor creates one.
export function trustedSsoProviders(env = process.env) {
  return ssoProviders(env).filter(provider => ['okta', 'microsoft-entra-id'].includes(provider.id)
    || (provider.kind === 'oidc' && value(env, 'SSO_TRUSTED').toLowerCase() === 'true')).map(provider => provider.id);
}
const emailVerifiedBy = (user, providerId, env) => Boolean(user?.emailVerified) || trustedSsoProviders(env).includes(providerId);

// SSO may create accounts only for allowed email domains. Without an allowlist, a person must
// already have an account (created by an admin with the same email) before SSO signs them in.
// AUTH_DOMAIN_GROUPS="acme.com=Acme, globex.com=Globex" puts people whose verified email is at a
// domain into that group when single sign-on creates their account. Those domains may create
// accounts too. Everyone else that SSO creates starts with AUTH_NEW_ACCOUNT_ACCESS: "all" (the
// default, every Dive and chat) or "none" (nothing until an administrator grants it).
const emailDomain = email => String(email ?? '').toLowerCase().split('@')[1] ?? '';
export function domainGroups(env = process.env) {
  return new Map(value(env, 'AUTH_DOMAIN_GROUPS').split(',').map(pair => pair.split('=').map(part => part.trim())).filter(([domain, group]) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain ?? '') && group).map(([domain, group]) => [domain.toLowerCase(), group.slice(0, 80)]));
}
export const domainGroupFor = (email, env = process.env) => domainGroups(env).get(emailDomain(email)) ?? null;
export const newAccountAccess = (env = process.env) => (value(env, 'AUTH_NEW_ACCOUNT_ACCESS').toLowerCase() === 'none' ? 'none' : 'all');
export const allowedEmailDomains = (env = process.env) => [...new Set([...list(value(env, 'AUTH_ALLOWED_EMAIL_DOMAINS')), ...domainGroups(env).keys()])];
export function emailDomainAllowed(email, env = process.env) {
  const domain = emailDomain(email);
  return Boolean(domain) && allowedEmailDomains(env).includes(domain);
}

// What an account created by single sign-on starts with. Only a verified email creates one,
// because the domain decides whether the person gets in, and which customer's data they read.
export function newAccountDefaults(user, env = process.env, providerId = '') {
  if (!emailVerifiedBy(user, providerId, env) || !emailDomainAllowed(user?.email, env)) return null;
  const group = domainGroupFor(user.email, env);
  const open = !group && newAccountAccess(env) === 'all';
  return { group, data: { diveAccess: open ? '*' : '', chatAccess: open } };
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
    // Linking to an account an administrator created needs a verified email on both sides:
    // Better Auth checks the provider's claim, and only emails an administrator typed are
    // verified locally. Trusted providers skip the provider check (see trustedSsoProviders).
    account: { accountLinking: { enabled: true, trustedProviders: trustedSsoProviders(env) } },
    session: { expiresIn: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60, cookieCache: { enabled: true, maxAge: 60 } },
    user: {
      additionalFields: {
        // '*' or a comma-separated list of Dive keys from dives.config.mjs.
        diveAccess: { type: 'string', required: false, defaultValue: '*', input: false },
        chatAccess: { type: 'boolean', required: false, defaultValue: true, input: false },
        // The person's own MotherDuck username, for teams whose people also use MotherDuck.
        // When set, the access sync grants them the shares behind the Dives they can open.
        motherduckUser: { type: 'string', required: false, input: false },
        // Shown in the admin portal. Sessions end on sign-out, so they cannot answer this.
        lastSignInAt: { type: 'date', required: false, input: false },
      },
    },
    databaseHooks: {
      user: { create: {
        before: async (user, ctx) => {
          // Only admins (createUser) or allowed SSO domains create accounts.
          const viaAdmin = ctx?.path === '/admin/create-user' || !ctx;
          if (viaAdmin) return { data: user };
          const defaults = newAccountDefaults(user, env, ctx?.params?.id);
          if (!defaults) return false;
          return { data: { ...user, ...defaults.data } };
        },
        after: async (user, ctx) => {
          if (ctx?.path === '/admin/create-user' || !ctx) return;
          const name = newAccountDefaults(user, env, ctx?.params?.id)?.group;
          if (!name) return;
          try {
            const groups = createGroupStore();
            const group = await groups.byName(name);
            if (!group) { console.error('domain_group_missing'); return; }
            await groups.addMember(group.id, user.id);
            const { scheduleSync } = await import('./access-sync.mjs');
            await scheduleSync();
          } catch (error) { console.error('domain_group_join_failed', error?.code ?? error?.name); }
        },
      } },
      session: { create: { after: async session => {
        await appQuery('UPDATE "user" SET "lastSignInAt" = $1 WHERE id = $2', [new Date(), session.userId]).catch(() => {});
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
