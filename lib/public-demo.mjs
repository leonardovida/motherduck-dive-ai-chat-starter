// PUBLIC_DEMO=true turns a deployment into a look-around demo: visitors share one administrator
// account that can open every screen but change nothing, and model tiers that are not enabled
// stay visible but cannot be picked.
export const publicDemo = (env = process.env) => String(env.PUBLIC_DEMO ?? '').trim().toLowerCase() === 'true';
export const DEMO_READ_ONLY = 'demo_read_only';

// Better Auth endpoints a demo visitor may reach: signing in and out, and reading. Everything
// else (changing the shared password, admin writes, impersonation, revoking sessions) is refused.
const DEMO_AUTH_ROUTES = {
  GET: /^\/(get-session|admin\/list-users|ok|error|callback\/[\w-]+|oauth2\/callback\/[\w-]+)$/,
  POST: /^\/(sign-in\/[\w-]+|sign-out)$/,
};
export const demoAllowsAuthRoute = (method, path) => Boolean(DEMO_AUTH_ROUTES[method]?.test(path));
