// ضمان iQ Mobile — the operator side of the guarantee pipeline.
//
// Every stage of a guarantee order is one real-world action: a phone call,
// a pickup, an inspection. This file turns those into PATCHes, mirrors the
// COD order console's shape (status tabs + counts + LIKE search), and fires
// the buyer's notification for each step. The status machine itself lives
// in src/guarantee.js — the route only enforces it.

import { Router } from 'express';
import { db, now } from '../../db.js';
import { notify } from '../../notify.js';
import { GUARANTEE_STATUSES, GUARANTEE_NEXT } from '../../guarantee.js';

// Buyer-facing Arabic per transition. Server text on purpose: pushes render
// on any app build, and the in-app inbox falls back to these titles too.
function buyerNotice(row, next) {
  const code = row.code;
  switch (next) {
    case 'buyer_confirmed':
      return { title: 'تم تأكيد طلب الضمان ✅', body: `${code} · ${row.brand} ${row.model}` };
    case 'seller_confirmed':
      return { title: 'تم الاتفاق مع البائع', body: `${code} · جارٍ استلام الجهاز للفحص` };
    case 'picked_up':
      return { title: 'استلمنا الجهاز للفحص 🔍', body: `${code} · سنرسل لك تقرير الفحص قريباً` };
    case 'inspected':
      return {
        title: 'تقرير الفحص جاهز 📋',
        body: `${code} · العربون المطلوب: ${Number(row.front_payment).toLocaleString('en-US')} د.ع`,
      };
    case 'front_paid':
      return { title: 'تم استلام العربون', body: `${code} · ${Number(row.front_payment).toLocaleString('en-US')} د.ع` };
    case 'shipped':
      return {
        title: 'جهازك في الطريق 🚚',
        body: `${code} · المتبقي ${Number(row.total - (row.front_payment || 0)).toLocaleString('en-US')} د.ع يُدفع عند الاستلام`,
      };
    case 'delivered':
      return { title: 'تم تسليم جهازك 🎉', body: `${code} · شكراً لثقتك بضمان iQ Mobile` };
    case 'cancelled':
      return { title: 'أُلغي طلب الضمان', body: code };
    default:
      return null;
  }
}

export function registerGuaranteeRoutes(requireAdmin) {
  const r = Router();

  // ─── list + counts ──────────────────────────────────────────────────
  r.get('/guarantee', requireAdmin, (req, res) => {
    const status = GUARANTEE_STATUSES.includes(req.query.status) ? req.query.status : null;
    const q = String(req.query.q || '').trim().slice(0, 60);

    const conds = [];
    const params = [];
    if (status) { conds.push('status=?'); params.push(status); }
    if (q) {
      const like = `%${q}%`;
      conds.push('(code LIKE ? OR buyer_phone LIKE ? OR seller_phone LIKE ? OR brand LIKE ? OR model LIKE ?)');
      params.push(like, like, like, like, like);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const orders = db.prepare(
      `SELECT * FROM guarantee_orders${where} ORDER BY created_at DESC LIMIT 200`,
    ).all(...params);

    // Counts ignore the filter — they drive the tab badges.
    const counts = {};
    for (const s of GUARANTEE_STATUSES) counts[s] = 0;
    for (const row of db.prepare(
      'SELECT status, COUNT(*) AS n FROM guarantee_orders GROUP BY status',
    ).all()) counts[row.status] = row.n;

    res.json({ total: orders.length, counts, orders });
  });

  // ─── stage transition ───────────────────────────────────────────────
  r.patch('/guarantee/:id(\\d+)', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM guarantee_orders WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    const next = req.body?.status;
    if (!GUARANTEE_STATUSES.includes(next)) return res.status(400).json({ error: 'bad_status' });
    if (next === row.status) return res.json({ ok: true, order: row });
    if (!GUARANTEE_NEXT[row.status].includes(next)) {
      return res.status(409).json({ error: 'bad_transition', from: row.status, to: next });
    }

    const t = now();
    const sets = ['status=?', 'updated_at=?'];
    const params = [next, t];

    if (next === 'inspected') {
      // One operator action: "I finished inspecting — here is the report and
      // the deposit I want." Splitting report entry from the transition
      // invites half-done states, so both are required right here.
      const report = String(req.body?.inspection_report || '').trim().slice(0, 2000);
      if (!report) return res.status(400).json({ error: 'report_required' });
      const fp = Number(req.body?.front_payment);
      if (!Number.isInteger(fp) || fp < 0 || fp > row.total) {
        return res.status(400).json({ error: 'bad_front_payment' });
      }
      sets.push('inspection_report=?', 'front_payment=?');
      params.push(report, fp);
      row.front_payment = fp; // for the notification body below
    }

    if (next === 'delivered') { sets.push('delivered_at=?'); params.push(t); }

    if (next === 'cancelled') {
      const reason = String(req.body?.cancel_reason || '').trim().slice(0, 200) || 'cancelled_by_admin';
      sets.push('cancel_reason=?', 'cancelled_stage=?');
      params.push(reason, row.status);
    }

    db.transaction(() => {
      db.prepare(`UPDATE guarantee_orders SET ${sets.join(', ')} WHERE id=?`).run(...params, row.id);
      // Listing lifecycle rides the same transaction so the marketplace can
      // never disagree with the pipeline:
      //   seller agreed  → hold the listing (nobody else can buy it)
      //   delivered      → it is genuinely sold
      //   cancelled      → release OUR hold only (a seller-set 'sold' stays)
      if (row.listing_id) {
        if (next === 'seller_confirmed') {
          db.prepare("UPDATE phone_listings SET status='reserved', updated_at=? WHERE id=? AND status='active'")
            .run(t, row.listing_id);
        } else if (next === 'delivered') {
          db.prepare("UPDATE phone_listings SET status='sold', sold_at=?, updated_at=? WHERE id=? AND status='reserved'")
            .run(t, t, row.listing_id);
        } else if (next === 'cancelled') {
          db.prepare("UPDATE phone_listings SET status='active', updated_at=? WHERE id=? AND status='reserved'")
            .run(t, row.listing_id);
        }
      }
    })();

    // Buyer hears about every step. Outside the transaction, and skipped for
    // orders whose buyer account is gone (rows outlive accounts by design).
    if (row.buyer_id) {
      const msg = buyerNotice(row, next);
      if (msg) {
        notify(row.buyer_id, `guarantee.${next}`, {
          guarantee_id: row.id, code: row.code, status: next,
          ...(next === 'inspected' ? { front_payment: row.front_payment } : {}),
          ...(next === 'shipped' ? { remaining: row.total - (row.front_payment || 0) } : {}),
          ...(next === 'cancelled' ? { reason: req.body?.cancel_reason || 'cancelled_by_admin' } : {}),
        }, msg);
      }
    }

    res.json({ ok: true, order: db.prepare('SELECT * FROM guarantee_orders WHERE id=?').get(row.id) });
  });

  // ─── fix-ups without a transition ───────────────────────────────────
  // Typo in the report, renegotiated deposit — editable after the fact, the
  // same way COD fulfilment details are editable without moving the status.
  r.patch('/guarantee/:id(\\d+)/details', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM guarantee_orders WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    const sets = [];
    const params = [];
    if (req.body?.inspection_report !== undefined) {
      const report = String(req.body.inspection_report || '').trim().slice(0, 2000);
      if (!report) return res.status(400).json({ error: 'report_required' });
      sets.push('inspection_report=?');
      params.push(report);
    }
    if (req.body?.front_payment !== undefined) {
      const fp = Number(req.body.front_payment);
      if (!Number.isInteger(fp) || fp < 0 || fp > row.total) {
        return res.status(400).json({ error: 'bad_front_payment' });
      }
      sets.push('front_payment=?');
      params.push(fp);
    }
    if (!sets.length) return res.status(400).json({ error: 'no_fields' });

    sets.push('updated_at=?');
    params.push(now());
    db.prepare(`UPDATE guarantee_orders SET ${sets.join(', ')} WHERE id=?`).run(...params, row.id);
    res.json({ ok: true, order: db.prepare('SELECT * FROM guarantee_orders WHERE id=?').get(row.id) });
  });

  return r;
}
