# Promotion payment completion

The seller creates an unpaid request and then completes payment from its saved instructions. Returning to the screen resumes the same request. Opening the dialer is never payment confirmation.

Requests retain pending/approved/rejected for compatibility. Separate payment_state values describe awaiting_payment, reported, verified, or legacy_unconfirmed. Existing rows default to legacy_unconfirmed: no inference that they paid or did not pay.

Seller reports are authenticated, scoped to request owner, idempotent, and accept an optional transaction reference (120 characters). Reporting cannot activate promotion or mark payment verified. Reported requests cannot be deleted through the cancel endpoint and do not receive unpaid reminders. Legacy unknown payments also do not receive unpaid reminders.

Admin approval now requires payment_verified:true, records the verifier and time, and atomically activates promotion plus any bonus. Both admin interfaces explicitly ask the reviewer to confirm actual receipt. An admin may verify receipt even if a seller never reported it. Verification and activation happen together, without a separate waiting period between them. Wallet purchases verify and activate within the existing debit transaction.

The paid duration and cadence come from the request snapshot. Transfer destinations are also snapshotted for new requests. Legacy requests without a destination direct the seller to support before a new transfer. Unavailable listings cannot start or activate a promotion; the mobile screen hides the pay action when the listing is no longer available but still permits reporting a previous payment.

Deployment: release the updated admin interfaces before or alongside the server (old approve clients will receive payment_verification_required), then release the seller app. No live payment-provider integration or automatic transfer verification was added. Staff must still reconcile actual incoming transfers.

Validation: 37 server tests passed. Coverage includes HTTP lifecycle/authorization/idempotency tests, injected transaction failure rollback, wallet and insufficient-funds cases, stale reminder exclusions, unavailable listings and purchased-duration preservation, plus mobile/admin TypeScript checks and the admin-web production build.
