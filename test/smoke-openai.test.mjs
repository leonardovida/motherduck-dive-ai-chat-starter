import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('OpenAI smoke uses the configured endpoint and never echoes its credential', async () => {
  let observed;
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    observed = { path: request.url, authorization: request.headers.authorization, body: JSON.parse(body) };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'OK' }] }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/smoke-openai.mjs', import.meta.url))], {
      env: { PATH: process.env.PATH, OPENAI_API_KEY: 'fake-smoke-credential', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/custom/v1/` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 0, output);
    assert.equal(observed.path, '/custom/v1/responses');
    assert.equal(observed.authorization, 'Bearer fake-smoke-credential');
    assert.equal(observed.body.store, false);
    assert.equal(output.includes('fake-smoke-credential'), false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
