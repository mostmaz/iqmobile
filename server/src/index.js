import 'dotenv/config';

// Sentry must be initialised before any module that might throw. DSN
// comes from the .env file; empty/missing DSN = SDK is a noop. We do
// this before importing Express so the global error handlers are
// active for module-load failures too.
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    // 10% of requests sampled for performance traces — keeps Sentry
    // quota usage low while still surfacing perf regressions.
    tracesSampleRate: 0.1,
    // Don't auto-capture every console.log — just unhandled errors +
    // explicit captureException() calls.
    integrations: [],
  });
  console.log('[iqmobile] sentry initialised');
}

import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import authRoutes from './routes/auth.js';
import listingsRoutes from './routes/listings.js';
import chatsRoutes from './routes/chats.js';
import dealsRoutes from './routes/deals.js';
import ratingsRoutes from './routes/ratings.js';
import reportsRoutes from './routes/reports.js';
import notificationsRoutes from './routes/notifications.js';
import eventsRoutes from './routes/events.js';
import adminRoutes from './routes/admin/index.js';
import { startExpirer } from './expirer.js';

// Loud-warning on missing JWT_SECRET in production. The default
// fallback in auth.js is the literal string 'dev-secret' — anyone who
// reads our open-source code could forge a token. We DO NOT exit the
// process here because the deploy pipeline doesn't currently set the
// env var, and crashing on startup would take prod down on every
// deploy. Once JWT_SECRET is set on the droplet (server/.env), upgrade
// this to `process.exit(1)`.
//
// Setting JWT_SECRET will invalidate every existing token (all users
// will be silently logged out and need to re-enter their phone), so
// it's a one-time blip we want to do deliberately, not by accident.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('[iqmobile] WARNING: JWT_SECRET is unset — tokens are signed with the literal string "dev-secret". Anyone reading the source can forge a login. Set JWT_SECRET in server/.env ASAP.');
}

const app = express();

// Trust the single nginx hop in front of us so express-rate-limit (and
// Sentry IP attribution) keys on the real client IP via X-Forwarded-For.
// Without this every request looks like it came from 127.0.0.1 and a
// single bad actor would block every legit user behind the same NAT.
app.set('trust proxy', 1);

// CORS: native mobile clients send no Origin header so they're always
// allowed (the function below returns no error and no
// Access-Control-Allow-Origin, which is fine for fetch from RN). Web
// origins must match the explicit allowlist — locks out third-party
// sites from credential-stuffing /auth/login via the browser.
const CORS_ORIGINS = new Set([
  'https://iqmobile.org',
  'https://www.iqmobile.org',
  // Allow localhost during dev (matches mobile/src/api/client.ts dev URLs).
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:4000', 'http://localhost:8081', 'http://localhost:19006'] : []),
]);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // native fetch / curl / server-to-server
    if (CORS_ORIGINS.has(origin)) return cb(null, true);
    return cb(new Error('not_allowed_by_cors'));
  },
}));

app.use(express.json({ limit: '256kb' }));
app.use('/uploads', express.static('./uploads', { maxAge: '7d' }));

// Public static pages (privacy policy, etc.). Nginx fronts both
// api.iqmobile.org and iqmobile.org with the same upstream, so this
// URL works at both — Play Store wants iqmobile.org/privacy.
app.use(express.static('./static', { maxAge: '1h' }));
app.get('/privacy', (_req, res) => res.sendFile('privacy.html', { root: './static' }));

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/auth', authRoutes);
app.use('/listings', listingsRoutes);
// chats + messages + deals are split across these routers but share URL space
app.use('/', chatsRoutes);   // mounts /listings/:id/chat, /chats, /chats/:id/messages, /messages/inbox, /quick-messages
app.use('/', dealsRoutes);   // mounts /chats/:id/propose-price, /deals/:id/...
app.use('/', ratingsRoutes); // mounts /deals/:id/rating, /users/:id/ratings
app.use('/reports', reportsRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/events', eventsRoutes);
app.use('/admin', adminRoutes);

// Sentry's Express handler must come AFTER all routes + BEFORE our
// catch-all. It captures any error that the app threw before bubbling
// it on to our own 500 responder. Safe to call when Sentry isn't
// initialised — it just no-ops.
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

app.use((err, _req, res, _next) => {
  console.error(err);
  // In production, never surface raw error messages to clients — they
  // can leak SQLite constraint names, stack frames, secret-rotation
  // hints, etc. Sentry has the full detail server-side; the client only
  // needs to know "something broke, try again". The Arabic UI maps
  // 'internal' to a generic apology via ar.errors.
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    res.status(500).json({ error: 'internal' });
  } else {
    res.status(500).json({ error: 'internal', detail: String(err.message || err) });
  }
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`[iqmobile] server on :${PORT}, db path = ${process.env.DB_PATH || './data/iqmobile.db'}`);
  console.log(`[iqmobile] users in db: ${db.prepare('SELECT COUNT(*) AS n FROM users').get().n}`);
});

startExpirer();
