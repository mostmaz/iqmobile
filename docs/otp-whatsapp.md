# Phone verification over WhatsApp (ARQAM)

Sign-in codes are sent over WhatsApp through ARQAM (otp.arqam.tech), replacing the
Twilio Verify wrapper.

## Configuration

    ARQAM_API_KEY    project key (otplive_…) — secret, never logged
    ARQAM_BASE_URL   optional override; defaults to https://otp.arqam.tech/api
    ARQAM_TEMPLATE   Meta-approved template key; defaults to 'otp'
    OTP_REQUIRED     'true' to switch verification on

A key on its own changes nothing. Verification only begins when `OTP_REQUIRED` is
`true`, so the key can be deployed and checked before it affects any sign-in.

## One channel

The app no longer offers a channel. The old screen had a "send by SMS instead" button
and the server retried over SMS when WhatsApp failed; that made sense against Twilio,
where the two are separate channels we drive. ARQAM is WhatsApp-first and substitutes an
SMS of its own accord for a number with no WhatsApp — that is their fallback, not a knob
we turn, and it is why nobody is locked out. Offering a switch would have promised
control we do not have; the button re-sent an identical WhatsApp message under a
different label.

## Why the server remembers a message id

Twilio Verify is keyed by phone: send to a number, later check that number and a code.
ARQAM is keyed by message: sending returns a `messageId`, and verifying takes that id
plus the code. Nothing on their side maps a phone back to its pending code.

Our two-step flow only ever carries the phone, and the app should not have to echo an
opaque id back — that adds a way to get it wrong and nothing else. So the link is held
server-side in `otp_pending` for the few minutes between the two calls. That row is
replaced on resend (the newest code is the one that works, with a fresh attempt budget),
consumed on success, and swept on expiry.

Consuming it matters: without that, a correct code stays valid for its whole window and
can be replayed to mint a second session.

Codes expire after five minutes on their side. Attempts are capped at five here, before
their per-phone limit is the only thing between an attacker and a six-digit space.

## Where the gate stands

Verification happens exactly where a real phone number is claimed, and nowhere else:

- **Browsing** needs no account. Anonymous requests are untouched.
- **A guest session** carries a synthetic phone, claims no real number, and stays open —
  this is what lets someone look around without signing in.
- **Signing in** is the one place a real number is claimed, and it is what selling,
  chatting and saving all route through.

Closed as part of this: `POST /auth/register` and `POST /auth/login` answer 403 while
OTP is required. No screen has called them since the app went passwordless, but they
remained live and unauthenticated, and each one minted a session for whatever phone you
named — an unverified way to exactly the session the gate exists to protect.

Status codes distinguish a user problem from a provider one. An expired or spent code is
401 and a spent attempt budget is 429; only a genuine provider failure is 502. Returning
502 for an expired code told the client our server was broken when someone simply needed
a new code.

Validation: 77 server tests, including a stubbed provider covering send, verify, resend,
expiry, replay and the error mapping. Exercised end to end against a local stand-in for
ARQAM: anonymous browsing and guest sessions unaffected, `/auth/register` refused,
sign-in delivering over WhatsApp, a wrong code 401, a correct one issuing a token, and
the same code refused afterwards.

Before switching `OTP_REQUIRED` on, confirm the account has credits — `GET /sms/account`
reports the balance — since a send that fails for `INSUFFICIENT_CREDITS` blocks sign-in.
