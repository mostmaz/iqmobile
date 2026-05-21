import { Router } from 'express';
import { verifyToken } from '../auth.js';
import { addClient, addAdminClient } from '../sse.js';

const r = Router();

// Extract the bearer token from EITHER the Authorization header (mobile
// react-native-sse supports custom headers, which keeps the JWT out of
// nginx access logs and proxy caches) OR the `?token=` query param
// (browser-side EventSource has no header support — only used by the
// admin web panel and only while we don't have a better mechanism). The
// header path is preferred whenever it's present.
function bearerToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.query.token || null;
}

function openSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  // Wire the close handler BEFORE starting the heartbeat. If the client
  // disconnects between flushHeaders and setInterval (real race when
  // the network is flaky), the close listener wouldn't have registered
  // and the heartbeat interval would leak — one timer per such conn,
  // forever. Order matters: close first, heartbeat second, write last.
  let hb;
  res.on('close', () => { if (hb) clearInterval(hb); });
  hb = setInterval(() => res.write(': hb\n\n'), 25000);
  res.write(': connected\n\n');
}

r.get('/', (req, res) => {
  const token = bearerToken(req);
  const payload = token && verifyToken(token);
  if (!payload || !payload.id || payload.kind === 'admin') return res.status(401).end();
  openSSE(res);
  addClient(payload.id, res);
});

r.get('/admin', (req, res) => {
  const token = bearerToken(req);
  const payload = token && verifyToken(token);
  if (!payload || payload.kind !== 'admin') return res.status(401).end();
  openSSE(res);
  addAdminClient(res);
});

export default r;
