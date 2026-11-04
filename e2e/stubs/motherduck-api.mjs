// Stand-in for MotherDuck's REST API: creates embed sessions and records each request, so tests
// can check what the app asked for (GET /__requests). POST /__fail {"count": n} makes the next
// n session requests fail, so tests can see how the app recovers.
import http from 'node:http';

export function startMotherDuckApi({ port, token }) {
  const requests = [];
  let failures = 0;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/__requests') return json(200, requests);
    if (req.method === 'DELETE' && req.url === '/__requests') { requests.length = 0; failures = 0; return json(200, {}); }
    if (req.method === 'POST' && req.url === '/__fail') { failures = Number(JSON.parse(raw || '{}').count) || 0; return json(200, {}); }
    const match = req.method === 'POST' && req.url.match(/^\/v1\/dives\/([0-9a-f-]{36})\/embed-session$/);
    if (!match) return json(404, { error: 'not_found' });
    if (req.headers.authorization !== `Bearer ${token}`) return json(401, { error: 'unauthorized' });
    if (failures > 0) { failures -= 1; return json(503, { error: 'unavailable' }); }
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ dive: match[1], body });
    return json(200, { session: `e2e-session-${requests.length}` });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
