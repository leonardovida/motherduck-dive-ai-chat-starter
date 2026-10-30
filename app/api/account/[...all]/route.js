import { toNextJsHandler } from 'better-auth/next-js';
import { AUTH_BASE_PATH, getAuth } from '../../../../lib/auth.mjs';
import { DEMO_READ_ONLY, demoAllowsAuthRoute, publicDemo } from '../../../../lib/public-demo.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Better Auth's endpoints (sign-in, SSO callbacks, admin user management) in accounts mode only.
const refuse = (error, status) => Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
const handle = method => request => {
  const auth = getAuth();
  if (!auth) return refuse('accounts_not_configured', 404);
  if (publicDemo() && !demoAllowsAuthRoute(method, new URL(request.url).pathname.slice(AUTH_BASE_PATH.length))) return refuse(DEMO_READ_ONLY, 403);
  return toNextJsHandler(auth)[method](request);
};

export const GET = handle('GET');
export const POST = handle('POST');
