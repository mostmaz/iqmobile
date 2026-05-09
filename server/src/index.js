import 'dotenv/config';
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

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use('/uploads', express.static('./uploads', { maxAge: '7d' }));

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

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal', detail: String(err.message || err) });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`[iqmobile] server on :${PORT}, db path = ${process.env.DB_PATH || './data/iqmobile.db'}`);
  console.log(`[iqmobile] users in db: ${db.prepare('SELECT COUNT(*) AS n FROM users').get().n}`);
});

startExpirer();
