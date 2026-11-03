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

// Where visitors find the published sign-in, shown on the sign-in page. Only https links are used.
export function demoSignInUrl(env = process.env) {
  try {
    const url = new URL(String(env.PUBLIC_DEMO_SIGN_IN_URL ?? '').trim());
    return url.protocol === 'https:' ? url.toString() : '';
  } catch { return ''; }
}

// A visitor cannot act on setup instructions, so a demo hides Dives that are not connected,
// unless none are, in which case the setup cards stay as the operator's only clue.
export const demoDives = dives => (dives.some(dive => dive.connected) ? dives.filter(dive => dive.connected) : dives);
