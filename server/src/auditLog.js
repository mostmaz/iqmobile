// Audit trail (spec §14). Every privileged act that changes what a shop can
// do, or changes many rows at once, lands here with WHO did it and WHEN:
// tier approvals and revocations, channel toggles, cart-flag changes, bulk
// operations, and chat report/block. Deliberately append-only and
// best-effort — an audit write must never fail the action it records, but
// it must also never be silently skipped, so failures are logged loudly.
import { db, now } from './db.js';

const ins = db.prepare(
  `INSERT INTO audit_log(actor_kind, actor_id, action, target_kind, target_id, detail_json, created_at)
   VALUES(@actor_kind, @actor_id, @action, @target_kind, @target_id, @detail_json, @created_at)`,
);

export function audit(actorKind, actorId, action, target = {}, detail = null) {
  try {
    ins.run({
      actor_kind: actorKind,
      actor_id: actorId ?? null,
      action,
      target_kind: target.kind ?? null,
      target_id: target.id ?? null,
      detail_json: detail ? JSON.stringify(detail) : null,
      created_at: now(),
    });
  } catch (err) {
    console.error('[audit] write failed:', action, err?.message);
  }
}
