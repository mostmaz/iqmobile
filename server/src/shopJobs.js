// Scheduled maintenance for the store dashboards (spec §14: nothing here
// may run on a dashboard load). Same shape as src/expirer.js — a plain
// interval tick with its own guard — so there is one scheduling idiom in
// the codebase, not two.
//
//   daily   — qualification signals + per-device diagnostics
//   weekly  — unmet-demand aggregate, then the demand push to each shop
//   hourly  — chat retention sweep (90 days) + bulk-undo cleanup
//
// Everything is wrapped: a failing aggregate must never take the server
// down, and a slow week must never stack two runs on top of each other.
import { db, now, getSetting, setSettingValue } from './db.js';
import { refreshAllShopSignals } from './shopSignals.js';
import { refreshAllDiagnostics, refreshDemandQueries, demandForShop } from './shopDiagnostics.js';
import { notify } from './notify.js';

const MINUTE = 60000;
const DAY_MS = 86400000;
const CHAT_RETENTION_MS = 90 * DAY_MS;

let running = false;

/** Has this named job gone longer than `everyMs` since its last success? */
function due(key, everyMs) {
  const last = Number(getSetting(`job_${key}_at`)) || 0;
  return now() - last >= everyMs;
}
function stamp(key) {
  setSettingValue(`job_${key}_at`, String(now()));
}

function dailyJobs() {
  if (!due('shop_signals', 20 * 3600000)) return;
  const t0 = Date.now();
  const shops = refreshAllShopSignals();
  const listings = refreshAllDiagnostics();
  stamp('shop_signals');
  console.log(`[shopJobs] daily: ${shops} shops, ${listings} listings diagnosed in ${Date.now() - t0}ms`);
}

function weeklyJobs() {
  if (!due('demand', 7 * DAY_MS)) return;
  const rows = refreshDemandQueries();
  stamp('demand');
  console.log(`[shopJobs] demand: ${rows} query aggregates`);

  // Tell each advanced shop the top three things people searched for in
  // its governorate and did not find in its stock. Only advanced shops —
  // this is one of the things the tier is for.
  const shops = db.prepare(
    "SELECT id FROM users WHERE seller_type='shop' AND shop_tier='advanced'",
  ).all();
  for (const s of shops) {
    try {
      const missing = demandForShop(s.id, 12).filter((d) => !d.has_it).slice(0, 3);
      if (missing.length < 1) continue;
      const list = missing.map((d) => d.query).join(' · ');
      notify(s.id, 'demand.weekly', { queries: missing }, {
        title: 'ناس تدور على هاي الأجهزة',
        body: `${list} — ما عندك بالمتجر`,
      });
    } catch (err) {
      console.warn('[shopJobs] demand push failed for', s.id, err?.message);
    }
  }
}

function hourlyJobs() {
  const t = now();
  // Chat retention (spec §9): 90 days, then the messages go. The thread row
  // itself stays so the conversation history count and response-time stats
  // remain honest.
  if (due('chat_retention', 6 * 3600000)) {
    const cut = t - CHAT_RETENTION_MS;
    const del = db.prepare('DELETE FROM chat_messages WHERE created_at < ?').run(cut);
    stamp('chat_retention');
    if (del.changes) console.log(`[shopJobs] chat retention: ${del.changes} messages archived out`);
  }
  // Undo windows are 30 seconds; keep an hour of history for support, then
  // drop it. The table would otherwise grow with every bulk edit forever.
  db.prepare('DELETE FROM bulk_undo WHERE created_at < ?').run(t - 3600000);
}

function tick() {
  if (running) return;
  running = true;
  try {
    dailyJobs();
    weeklyJobs();
    hourlyJobs();
  } catch (err) {
    console.error('[shopJobs] tick failed:', err?.message);
  } finally {
    running = false;
  }
}

export function startShopJobs() {
  // First run 30s after boot so a deploy doesn't pay for the aggregate
  // while it is still warming up, then every 15 minutes; each job decides
  // for itself whether it is actually due.
  setTimeout(tick, 30 * 1000);
  setInterval(tick, 15 * MINUTE);
}

// Exposed for the admin "recompute now" button and for tests.
export function runShopJobsNow() {
  setSettingValue('job_shop_signals_at', '0');
  setSettingValue('job_demand_at', '0');
  tick();
}
