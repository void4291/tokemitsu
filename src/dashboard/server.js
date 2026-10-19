import http from 'node:http';
import { PAGE } from './page.js';
import { computeReport } from '../analytics.js';
import { verify } from '../verify.js';
import { readEvents } from '../ledger.js';
import { parseSince } from '../util.js';

/** Local-only dashboard: binds 127.0.0.1, rejects foreign Host headers (DNS-rebinding guard), read-only, no outbound calls. */
export function createServer({ cfg, project = null }) {
  const cache = new Map();
  const cached = async (key, fn, ttl = 5000) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
    const v = await fn();
    cache.set(key, { t: Date.now(), v });
    return v;
  };
  return http.createServer(async (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { res.writeHead(403).end('forbidden'); return; }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const url = new URL(req.url, 'http://localhost');
    const json = (obj, code = 200) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(obj)); };
    try {
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" }).end(PAGE);
      } else if (url.pathname === '/api/summary') {
        const s = url.searchParams.get('since') || '30d';
        json(await cached('sum:' + s, () => computeReport({ since: parseSince(s), project, cfg })));
      } else if (url.pathname === '/api/health') {
        json({ checks: await cached('health', () => verify({ cfg }), 15000) });
      } else if (url.pathname === '/api/events') {
        const n = Math.min(100, Number(url.searchParams.get('limit')) || 15);
        json({ events: readEvents({ project }).filter((e) => e.lane === 'delegate').slice(-n).reverse() });
      } else res.writeHead(404).end('not found');
    } catch (e) { json({ error: e.message }, 500); }
  });
}

export function listen(server, port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}
