const args = process.argv.slice(2);
const json = args.includes('--json');
const fail = (message, detail) => {
  console.error(json ? JSON.stringify({ ok: false, error: message, ...(detail ? { detail } : {}) }) : [message, detail].filter(Boolean).join(': '));
  process.exit(1);
};
if (args.includes('--help')) {
  console.log('Usage: npm run setup -- [--json] [--live] [--production] [--dive=overview]\nChecks configuration without modifying files. --live checks external connections.\nsetup requires AI chat; check:setup allows embed-only configuration unless --require-chat is supplied.');
  process.exit(0);
}
if (args.some(arg => !['--json', '--live', '--production', '--require-chat'].includes(arg) && !arg.startsWith('--dive='))) fail('Unknown setup option. Use --help.');
try {
  let checkSetup, setupPlan;
  try {
    ({ checkSetup } = await import('../lib/setup-check.mjs'));
    ({ setupPlan } = await import('../lib/setup-plan.mjs'));
  } catch (error) {
    const location = /^dives\.config\[\d+\]/.exec(String(error.message))?.[0];
    fail('invalid_config', location ? `${location}: check this entry's fields and resource mappings.` : undefined);
  }
  try { process.loadEnvFile('.env.local'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot load .env.local. Check file access and dotenv syntax.');
  }
  const env = args.includes('--production') ? { ...process.env, NODE_ENV: 'production' } : process.env;
  const requireChat = args.includes('--require-chat');
  const plan = setupPlan({ env, requireChat, production: env.NODE_ENV === 'production', diveKey: args.find(arg => arg.startsWith('--dive='))?.slice(7) });
  const live = args.includes('--live');
  const result = await checkSetup({ env, live, requireChat, diveKey: plan.dive });
  const output = { ...plan, ok: plan.configurationReady && result.ok, liveRequested: live, checks: result.lines };
  // Online checks prove API connections only. Browser verification remains separate.
  output.connectionsVerified = live && output.ok;
  console.log(json ? JSON.stringify(output, null, 2) : result.lines.join('\n'));
  process.exitCode = output.ok ? 0 : 1;
} catch (error) {
  // Never print arbitrary config, provider errors or runtime values.
  fail(error.message === 'Unknown Dive key. Choose a key from dives.config.mjs.' ? error.message : 'Setup could not finish. Check config structure and local environment-file access.');
}
