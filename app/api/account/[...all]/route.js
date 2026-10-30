import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '../../../../lib/auth.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Better Auth's endpoints (sign-in, SSO callbacks, admin user management) in accounts mode only.
const unavailable = () => Response.json({ error: 'accounts_not_configured' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
const handle = method => request => {
  const auth = getAuth();
  return auth ? toNextJsHandler(auth)[method](request) : unavailable();
};

export const GET = handle('GET');
export const POST = handle('POST');
