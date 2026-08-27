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
import compression from 'compression';
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
import savedSearchRoutes from './routes/savedSearches.js';
import priceWatchRoutes from './routes/priceWatches.js';
import wishlistRoutes from './routes/wishlist.js';
import deviceCatalogRoutes from './routes/deviceCatalog.js';
import ordersRoutes from './routes/orders.js';
import shopAdminRoutes from './routes/shopAdmin.js';
import storefrontRoutes from './routes/storefront.js';
import adminRoutes from './routes/admin/index.js';
import brandsRoutes from './routes/brands.js';
import webListingRoutes from './routes/webListing.js';
import webShopRoutes from './routes/webShop.js';
import webHomeRoutes from './routes/webHome.js';
import appConfigRoutes from './routes/appConfig.js';
import { activityTracker } from './activity.js';
import getAppRoutes from './routes/getApp.js';
import bannersRoutes from './routes/banners.js';
import featuresRoutes from './routes/features.js';
import shopsRoutes from './routes/shops.js';
import { startExpirer } from './expirer.js';
import { startShopJobs } from './shopJobs.js';
import path from 'node:path';
import fs from 'node:fs';

// Hard-fail on missing JWT_SECRET in production. The fallback in
// auth.js is the literal string 'dev-secret' — anyone who reads our
// open-source code could forge a token. Earlier this was a warning
// (so an unset env var wouldn't crash an already-deployed prod box)
// but the droplet's .env now has JWT_SECRET set, so we can refuse to
// start without it and prevent silent regression on future deploys.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET env var is required when NODE_ENV=production. Set it in server/.env (openssl rand -hex 32) and restart.');
  process.exit(1);
}

const app = express();

// Trust the single nginx hop in front of us so express-rate-limit (and
// Sentry IP attribution) keys on the real client IP via X-Forwarded-For.
// Without this every request looks like it came from 127.0.0.1 and a
// single bad actor would block every legit user behind the same NAT.
app.set('trust proxy', 1);

// CORS: native mobile clients send no Origin header so they're always
// allowed (the function below resolves with `false`, which still lets
// the request through but omits Access-Control-Allow-Origin — fine for
// native fetch). Browser-origin requests must match the explicit
// allowlist; anything else gets no Allow-Origin header back, which the
// browser then blocks at the preflight without us needing to return
// a 4xx — and crucially WITHOUT throwing into the 500 handler.
//
// Localhost is always allowed: a victim's browser will never send
// `Origin: http://localhost:*` for a malicious site, so allowing it is
// safe even in production and makes dev painless.
const CORS_ORIGINS = new Set([
  'https://iqmobile.org',
  'https://www.iqmobile.org',
  'http://localhost:4000',
  'http://localhost:8081',
  'http://localhost:19006',
  // Used by the Import-Queue image scraper: an admin opens a Facebook
  // photo URL in their already-logged-in Chrome (via the Claude-in-
  // Chrome extension), and the injected script POSTs the rendered
  // image bytes directly to /admin/import/:id/images. Safe to allow
  // because dashboard auth is Bearer-token-only — the browser does
  // NOT auto-attach Authorization headers on cross-origin requests,
  // so a malicious FB page can't replay the admin token even with
  // CORS open. Only a script that explicitly carries the token (i.e.
  // our injected one) can authenticate.
  // Used when releasing: Play Console's page fetches our release .aab from
  // /static so it can be attached to the upload form in-browser (Chrome's
  // Private Network Access blocks fetching it from localhost). Same safety
  // argument as the Facebook entries below: auth here is Bearer-only, and
  // browsers never auto-attach Authorization cross-origin, so an allowlisted
  // origin gains nothing beyond what anonymous requests already get.
  'https://play.google.com',
  'https://web.facebook.com',
  'https://www.facebook.com',
]);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (CORS_ORIGINS.has(origin)) return cb(null, true);
    // Resolve with `false`, NOT new Error(...). Throwing here bubbles
    // into our global 500 handler and leaks the failure reason in the
    // response body. `false` makes cors() omit the Allow-Origin header
    // and let the request through unchanged — the browser will block
    // its own preflight on the missing header, which is the correct
    // outcome with zero info-leak.
    return cb(null, false);
  },
}));

// Compress every response before it leaves the process.
//
// Nothing in the chain was doing this. nginx has `gzip on` but the stock
// Ubuntu config leaves BOTH `gzip_types` and `gzip_proxied` commented out —
// the first means it only ever compresses text/html, the second means it
// skips proxied responses entirely, and every route here is proxied. So the
// dashboard's 714 KB JS bundle went over the wire raw on every cold load,
// against 208 KB gzipped. On an Iraqi mobile connection that is the whole
// difference between "fine" and "slow".
//
// Done here rather than in nginx so it ships with the app and survives a
// server rebuild or a certbot-rewritten config.
app.use(compression());

app.use(express.json({ limit: '256kb' }));
app.use('/uploads', express.static('./uploads', {
  maxAge: '7d',
  // Uploaded files are served from our origin; stop the browser sniffing a
  // different content-type than we set. The extension allowlist already
  // blocks SVG/HTML, so this is defense in depth.
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));

// Public static pages (privacy policy, etc.). Nginx fronts both
// api.iqmobile.org and iqmobile.org with the same upstream, so this
// URL works at both — Play Store wants iqmobile.org/privacy.
app.use(express.static('./static', { maxAge: '1h' }));
app.get('/privacy', (_req, res) => res.sendFile('privacy.html', { root: './static' }));
app.get('/terms', (_req, res) => res.sendFile('terms.html', { root: './static' }));

// Moderator console — a phone-shaped client for the same /admin API the
// dashboard uses. It ships no secrets and does nothing at all until an admin
// logs in, but there is no reason for it to be crawled or linked, so it is
// noindex and deliberately absent from every public footer.
// no-store on the shell, not just noindex: once the console is added to a
// home screen it IS the app, and a heuristically-cached copy would leave a
// moderator running a build from days ago with no visible way to refresh it.
// The page is a few KB, so revalidating every launch costs nothing.
app.get('/mod', (_req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.sendFile('mod.html', { root: './static' });
});
app.get('/mod/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json');
  res.set('Cache-Control', 'no-store');
  res.sendFile('mod-manifest.webmanifest', { root: './static' });
});

// ── Deep-link domain association (free Universal Links / App Links) ──
// These tell iOS/Android that this domain is owned by the app, so tapping
// https://api.iqmobile.org/l/:id opens the app straight to the listing when
// it's installed (and falls back to the /l/:id web page otherwise). Android
// verifies against the Play app-signing key; iOS needs the Apple Team ID
// (set APPLE_TEAM_ID in .env to enable the iOS side — Android works without).
app.get('/.well-known/assetlinks.json', (_req, res) => {
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'org.iqmobile.app',
      sha256_cert_fingerprints: [
        '9B:1F:3F:7A:FE:66:48:32:6E:D9:FF:12:84:AE:B8:C6:60:74:B5:7A:BE:A6:EA:33:52:22:36:3C:55:43:4E:4E',
      ],
    },
  }]);
});
app.get('/.well-known/apple-app-site-association', (_req, res) => {
  const team = process.env.APPLE_TEAM_ID;
  if (!team) return res.status(404).end();
  res.type('application/json').send(JSON.stringify({
    applinks: { apps: [], details: [{ appID: `${team}.org.iqmobile.app`, paths: ['/l/*'] }] },
  }));
});

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Daily-active tracking. Mounted before the routes so it sees every API call,
// and decodes the token itself since auth here is per-route. No-op for
// anonymous and admin traffic.
app.use(activityTracker());

app.use('/auth', authRoutes);
app.use('/listings', listingsRoutes);
app.use('/brands', brandsRoutes);
app.use('/l', webListingRoutes);  // public shareable listing pages: /l/:id
// Public shop page at /shop/:id — the browser fallback for the shop banner
// deep-link on app builds older than 0.1.6, which have no in-app intercept.
// Singular /shop, so it does not collide with the /shops JSON API below.
app.use('/', appConfigRoutes);  // mounts /app-config — update floor + home overlay
app.use('/', webHomeRoutes);   // iqmobile.org root: store redirect on phones, marketplace on desktop
app.use('/', webShopRoutes);
app.use('/', getAppRoutes);       // mounts /get — the store smart link for bios
app.use('/banners', bannersRoutes);
app.use('/', shopsRoutes);     // mounts /shops, /shops/:id, /shops/register
app.use('/', featuresRoutes);  // mounts /features/tiers, /listings/:id/feature-request, /features/mine
// chats + messages + deals are split across these routers but share URL space
app.use('/', chatsRoutes);   // mounts /listings/:id/chat, /chats, /chats/:id/messages, /messages/inbox, /quick-messages
app.use('/', dealsRoutes);   // mounts /chats/:id/propose-price, /deals/:id/...
app.use('/', ratingsRoutes); // mounts /deals/:id/rating, /users/:id/ratings
app.use('/reports', reportsRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/events', eventsRoutes);
app.use('/', savedSearchRoutes); // mounts /saved-searches
app.use('/', priceWatchRoutes);  // mounts /listings/:id/price-watch
app.use('/', wishlistRoutes);    // mounts /wishlist
app.use('/', deviceCatalogRoutes); // mounts /device-catalog/*, /device-suggestions
app.use('/', ordersRoutes);        // mounts /orders, /orders/mine, /orders/:id
app.use('/', shopAdminRoutes);     // merchant panel: /shop-admin/*
app.use('/', storefrontRoutes);    // mounts /storefront/:id, /products, /product
app.use('/admin', adminRoutes);

// Admin dashboard SPA — served from the same Express process at
// /dashboard/*. The Vite build outputs to admin-web/dist relative to
// the repo root; resolve that path from this file's CWD (server/) so
// gradle/pm2 cwd quirks don't break it.
//
// NOTE: the deploy action only triggers on server/** changes, so a
// dashboard-only commit (new admin-web/dist) won't ship until a server
// change rides along. To deploy a dashboard-only update, either touch a
// server file or run the workflow manually from the Actions tab.
const ADMIN_WEB_DIST = path.resolve('./../admin-web/dist');
if (fs.existsSync(ADMIN_WEB_DIST)) {
  // Vite fingerprints every asset (index-__-5vRPf.js), so an asset URL can
  // never change contents — cache it for a year. index.html is the opposite:
  // it names the current hashes, so it must never be cached or a deploy stays
  // invisible until the browser's copy lapses. The old blanket `maxAge: 1h`
  // got both wrong, and had the operator re-downloading the whole bundle
  // every hour.
  app.use('/dashboard', express.static(ADMIN_WEB_DIST, {
    maxAge: '1y',
    immutable: true,
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  // SPA fallback: every /dashboard/* path serves index.html so deep
  // links / browser refresh on a sub-route both work.
  app.get('/dashboard/*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(ADMIN_WEB_DIST, 'index.html'));
  });
  console.log('[iqmobile] admin dashboard mounted at /dashboard');
} else {
  console.log('[iqmobile] admin dashboard not built (admin-web/dist missing) — /dashboard 404s until built');
}

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
startShopJobs();
