# Reporting (#18)

## Acknowledge receipt, and nothing more

`POST /reports` returns the report's real **id**, and the app acknowledges from
that response rather than optimistically. The route used to answer a bare
`{ok:true}`, so `ListingDetailScreen` fired «تم إرسال البلاغ» after any 200 —
including one it could not distinguish from a no-op — and left the user with
no reference to quote.

**No resolution notification, deliberately.** There is nothing to report an
outcome *from*: `reports` has no `resolved_at`, no `resolution` and no
`handled_by`, and `PATCH /admin/reports/:id` does nothing but write `status`.
Promising a resolution the system cannot produce is worse than an honest
acknowledgement.

## A second tap is one report

Two identical open reports from the same person are collapsed and the existing
id is returned with `duplicate: true`. People tapped إبلاغ twice precisely
because the first tap gave no visible answer; a second row only makes the
queue look busier than it is.

## Discoverability was the bigger half

Before this, the entire app had **one** report entry point: a button on the
listing page. `ChatScreen` had no report button and no overflow menu at all —
so the place where abuse actually happens was the one place you could not
report it. `inappropriate_chat` and `target_kind='chat'` were both valid
server-side and unreachable from the app; `IconFlag` was defined and never
imported.

## What this deliberately does **not** do

- **Buyer→seller blocking is out of scope, and is called out rather than
  half-added.** `chat_blocks` is shop-scoped and directional: a shop blocks a
  buyer, from the merchant panel. A buyer cannot block a seller and an
  individual seller cannot block anyone. Making that work is a schema change,
  not a button, and a one-sided block would be worse than none.
- **No report status screen.** There is no `GET /reports/mine`, and adding one
  would only ever show `open`.
- **Three of six reasons and one of three target kinds remain unreachable**
  from the app (`bypass_attempt`, `other`, and `target_kind='user'`). They are
  operator- and server-side concepts; surfacing them without a place for the
  answer would be UI for its own sake.
