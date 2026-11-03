// App store maintenance. Never prints tokens or passwords.
//   npm run db:migrate                                  create or update the tables
//   npm run admin:create -- --username=alice [--name="Alice Smith"] [--email=alice@example.com]
// admin:create reads the password from ADMIN_PASSWORD, or asks for it without echoing.
import { createInterface } from 'node:readline';
import pg from 'pg';

const [command, ...args] = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3).trim();
const fail = message => { console.error(message); process.exit(1); };

try { process.loadEnvFile('.env.local'); }
catch (error) { if (error.code !== 'ENOENT') fail('Cannot load .env.local. Check file access and dotenv syntax.'); }

const { appConnection, appDatabase, appPool, appStoreConfigured } = await import('../lib/app-db.mjs');
const { authOptions, getAuth } = await import('../lib/auth.mjs');
const { migrateAppDatabase } = await import('../lib/app-db-schema.mjs');

if (!['migrate', 'create-admin'].includes(command)) fail('Usage: node scripts/app-db.mjs migrate | create-admin --username=<name>');
if (!appStoreConfigured()) fail('Set MOTHERDUCK_APP_TOKEN (a read-write token for the app database) first. See docs/accounts.md.');

async function ensureDatabase() {
  const name = appDatabase();
  const client = new pg.Client(appConnection(process.env));
  try { await client.connect(); await client.end(); return; }
  catch (error) { await client.end().catch(() => {}); if (error.code !== '3D000') throw error; }
  // The database does not exist yet. Create it from the token owner's default database.
  const bootstrap = new pg.Client(appConnection(process.env, 'my_db'));
  try { await bootstrap.connect(); await bootstrap.query(`CREATE DATABASE IF NOT EXISTS ${name}`); console.log(`Created MotherDuck database ${name}.`); }
  catch { fail(`Database ${name} does not exist and could not be created with this token. Run CREATE DATABASE ${name}; in MotherDuck, then try again.`); }
  finally { await bootstrap.end().catch(() => {}); }
}

async function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!process.stdin.isTTY) fail('Set ADMIN_PASSWORD or run this command in an interactive terminal.');
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = text => { if (text.includes('Password')) process.stdout.write(text); };
  const answer = await new Promise(resolve => rl.question('Password (12+ characters): ', resolve));
  rl.close(); process.stdout.write('\n');
  return answer;
}

try {
  await ensureDatabase();
  if (command === 'migrate') {
    const pool = appPool();
    const count = await migrateAppDatabase(text => pool.query(text), authOptions(process.env));
    console.log(`App database ${appDatabase()} is up to date (${count} idempotent statements).`);
  } else {
    const username = option('username')?.toLowerCase();
    if (!username || !/^[a-z0-9_.]{2,40}$/.test(username)) fail('Pass --username=<2-40 letters, digits, dots or underscores>.');
    const password = await readPassword();
    if (password.length < 12) fail('The password must have at least 12 characters.');
    const auth = getAuth();
    const [existing] = (await appPool().query('SELECT id FROM "user" WHERE username = $1', [username])).rows;
    if (existing) {
      // The admin endpoints need a signed-in admin; this offline path uses Better Auth's own hasher.
      const ctx = await auth.$context;
      const hash = await ctx.password.hash(password);
      const accounts = await ctx.internalAdapter.findAccounts(existing.id);
      if (accounts.some(account => account.providerId === 'credential')) await ctx.internalAdapter.updatePassword(existing.id, hash);
      else await ctx.internalAdapter.linkAccount({ providerId: 'credential', accountId: existing.id, password: hash, userId: existing.id });
      await ctx.internalAdapter.updateUser(existing.id, { role: 'admin', banned: false });
      console.log(`Updated ${username}: role admin, new password set.`);
    } else {
      const email = option('email') || `${username}@accounts.invalid`;
      await auth.api.createUser({ body: { email, password, name: option('name') || username, role: 'admin', data: { username, displayUsername: username } } });
      console.log(`Created admin ${username}. Sign in at /, then open /admin.`);
    }
  }
} catch (error) {
  fail(`App database command failed: ${String(error?.body?.code || error?.message || error?.status || 'unknown error').replace(/eyJ[\w.-]+/g, '<redacted>').slice(0, 300)}`);
} finally {
  await globalThis.__diveChatAppPool?.end().catch(() => {});
}
