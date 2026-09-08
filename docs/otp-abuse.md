# OTP abuse: spend guard and the code-sharing scam

Two different attacks share the name "OTP scamming". They need different
answers and only one of them is a code problem.

## A. Draining the credit

Every send is money: ARQAM charges $0.02 for a WhatsApp OTP and **$0.08–$0.18**
when it falls back to SMS. **The attacker picks the number**, so they pick the
price — targeting Zain (078/079) forces the dear path and empties the account
roughly 9× faster. When the balance hits zero the provider returns
`INSUFFICIENT_CREDITS`, which we map to `otp_unavailable`, and **nobody can
sign in at all**. The outage is the payload, not a side effect.

### What guards it

| Rule | Value | File |
|---|---|---|
| Must be a real Iraqi mobile | `^07[3-9]\d{8}$` | `iraqiPhone.js` |
| Cooldown per number | 60s | `otpRate.js` |
| Sends per number / hour | **2** | `otpRate.js` |
| Sends per number / day | 8 | `otpRate.js` |

All four are checked **before** the network call. That is the whole point — an
error the user sees is worthless if the message was already paid for. The
tests assert the stub's `calls.length` does not grow, not merely that an error
came back.

Everything is keyed on the **canonical** phone, resolved inside `sendCode`
rather than trusting the caller. `07701234567`, `+9647701234567` and
`00964 770 123 4567` are one number and share one budget; keying on the raw
string would have handed the same number three separate allowances.

Before this, `normalizePhone` checked only `length >= 10 && length <= 12` —
never the leading `7` its own comment promised — and `toE164` checked only for
a leading zero. Landlines, short codes and arbitrary digit strings were all
billable.

### What is deliberately **not** guarded

**There is no global daily spend ceiling.** This is the owner's decision and it
is a real trade: a budget breaker that misfires during genuine growth locks out
every new user, which is a worse outage than the one it prevents.

The consequence, stated plainly: **a distributed flood across many distinct
numbers from many IPs is still possible.** Each number stays under its own cap
while the total climbs. The per-phone rules cannot see that shape. What covers
it is visibility, not enforcement:

- every send and every refusal writes to `otp_send_log`
- `console.error('[otp][ALERT] …')` past 60 sends/hour — `console.error` and not
  Sentry, because a 400 response is not a thrown exception and Sentry only
  captures throws
- `GET /admin/otp-activity` — hourly sends, top numbers, top IPs, refusals, and
  an indicative 24h spend

If that alert ever fires for real, the lever is `OTP_REQUIRED=false` plus a
restart, which drops sign-in back to passwordless-without-code rather than
leaving people locked out.

## B. "Read me the code"

The commonest marketplace con: a "buyer" says they will send a code to check
the seller is genuine, then asks them to read it out, and takes the account.

`OtpVerifyScreen` now carries a permanent, non-dismissible warning that no
employee, buyer or seller will ever ask for the code.

**It cannot go in the message itself.** `otp.js` sends only
`{ phoneNumber, templateName }` — the body is a Meta-approved WhatsApp template
registered on ARQAM's side, and nothing in this repo can change its text.
**Open owner action:** ask ARQAM whether the `otp` template carries WhatsApp's
standard security disclaimer and, if not, to enable it. That line arrives at
the exact moment of the scam, which no screen in this app can reach.

## What this deliberately does **not** do

- **No chat detection of code requests.** Owner's decision. `phoneMask.js` is
  fully implemented and imported by nothing, and `bypass_attempts` has a table
  and an admin page with zero writers — either connect them or delete them, but
  as a separate decision, not folded into a security change.
- **No account lockout on repeated failures.** `MAX_ATTEMPTS = 5` still burns
  the code, not the account. Locking an account on failed guesses hands an
  attacker a denial-of-service against any user whose number they know.
- **No CAPTCHA.** It would cost every Iraqi user on a slow connection real
  friction to stop an attacker who can already rotate IPs.
- **Refusals do not consume the user's budget.** Only `outcome='sent'` counts,
  so a provider outage cannot turn into an hour-long lockout on top of itself.
