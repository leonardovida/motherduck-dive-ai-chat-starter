import { timingSafeEqual } from 'node:crypto';

// Scheduled routes (vercel.json "crons") answer only to the scheduler. Vercel sends CRON_SECRET as
// a bearer token; without a CRON_SECRET of at least 16 characters they answer to no one.
export function cronAuthorized(request, env = process.env) {
  const secret = String(env.CRON_SECRET ?? '');
  const given = Buffer.from(String(request.headers.get('authorization') ?? ''));
  const expected = Buffer.from(`Bearer ${secret}`);
  return secret.length >= 16 && given.length === expected.length && timingSafeEqual(given, expected);
}
