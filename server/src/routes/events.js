import { Router } from 'express';
import { verifyToken } from '../auth.js';
import { addClient, addAdminClient } from '../sse.js';

const r = Router();

function openSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(': connected\n\n');
  const hb = setInterval(() => res.write(': hb\n\n'), 25000);
  res.on('close', () => clearInterval(hb));
}

r.get('/', (req, res) => {
  const token = req.query.token;
  const payload = token && verifyToken(token);
  if (!payload || !payload.id || payload.kind === 'admin') return res.status(401).end();
  openSSE(res);
  addClient(payload.id, res);
});

r.get('/admin', (req, res) => {
  const token = req.query.token;
  const payload = token && verifyToken(token);
  if (!payload || payload.kind !== 'admin') return res.status(401).end();
  openSSE(res);
  addAdminClient(res);
});

export default r;
