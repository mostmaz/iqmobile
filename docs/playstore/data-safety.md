# Play Store — Data Safety form answers

Copy-paste these into Google Play Console → App content → Data safety.
The wording matches Google's form exactly so it lines up with their UI.

---

## Section 1: Does your app collect or share any of the required user data types?

**Answer: Yes**

---

## Section 2: Is all of the user data collected by your app encrypted in transit?

**Answer: Yes** — all client→server traffic is HTTPS via `api.iqmobile.org` with Let's Encrypt TLS.

## Section 3: Do you provide a way for users to request that their data be deleted?

**Answer: Yes**

- **Deletion URL or in-app**: in-app
- **Deletion mechanism**: Profile tab → "حذف الحساب" → two confirmation dialogs → server cascade-deletes user row + all listings + chats + ratings + uploaded files in a single transaction. Irreversible.

---

## Section 4: Data types collected (check each box that applies)

### Personal info

| Type | Collected? | Shared? | Optional? | Purpose |
|---|---|---|---|---|
| Name | **Yes** | No | No | Account management, App functionality |
| Email address | No | – | – | – |
| User IDs | **Yes** | No | No | Account management, App functionality |
| Address | No | – | – | – |
| Phone number | **Yes** | **Yes** (publicly on listings the user posts) | No | Account management, App functionality |
| Race and ethnicity | No | – | – | – |
| Political or religious beliefs | No | – | – | – |
| Sexual orientation | No | – | – | – |
| Other info | No | – | – | – |

> **Important for the phone-number row**: when you click "shared", Google asks
> who you share it with. Choose **"Service providers"** is incorrect here —
> instead, note in the explanation box that the phone number appears on
> listings the user themselves posts, visible to other app users (buyers).
> This is **user-initiated sharing**, not third-party sharing. If the form
> doesn't allow this nuance, mark as "Shared: No" and explain in the
> additional notes that public visibility is a user-controlled feature.

### Financial info — **No** (not collected)

### Health and fitness — **No**

### Messages — **No** (chat feature is currently disabled)

### Photos and videos

| Type | Collected? | Shared? | Optional? | Purpose |
|---|---|---|---|---|
| Photos | **Yes** | **Yes** (listing photos are publicly visible to all app users) | **Yes** (optional for profile/shop sign) | App functionality |
| Videos | No | – | – | – |

### Audio files — **No**

### Files and docs — **No**

### Calendar — **No**

### Contacts — **No**

### App activity

| Type | Collected? | Shared? | Optional? | Purpose |
|---|---|---|---|---|
| App interactions | **Yes** | **Yes** (PostHog for analytics) | No | Analytics |
| In-app search history | **Yes** | **Yes** (PostHog) | No | Analytics |
| Installed apps | No | – | – | – |
| Other user-generated content | **Yes** | **Yes** (listings are public) | No | App functionality |
| Other actions | No | – | – | – |

### Web browsing — **No**

### App info and performance

| Type | Collected? | Shared? | Optional? | Purpose |
|---|---|---|---|---|
| Crash logs | **Yes** | **Yes** (Sentry) | No | Analytics |
| Diagnostics | **Yes** | **Yes** (Sentry) | No | Analytics |
| Other app performance data | No | – | – | – |

### Device or other IDs

| Type | Collected? | Shared? | Optional? | Purpose |
|---|---|---|---|---|
| Device or other IDs | **Yes** (push token, anonymous PostHog ID) | **Yes** (Firebase Cloud Messaging, PostHog) | No | App functionality, Analytics |

### Location

| Type | Collected? | Shared? | Optional? | Purpose |
|---|---|---|---|---|
| Approximate location | **No** | – | – | – |
| Precise location | **Yes** | **Yes** (publicly on the shop's listing when seller_type='shop') | **Yes** (only shops need it) | App functionality |

> Location is **only** collected from shop accounts when they finish the
> CompleteProfile flow. Individual accounts never have location collected.

---

## Section 5: Data security practices

| Question | Answer |
|---|---|
| Is all of the user data collected by your app encrypted in transit? | **Yes** |
| Do you provide a way for users to request that their data be deleted? | **Yes** |
| Is your app committed to following the Play Families Policy? | **No** (the app is not targeted at children) |
| Has your app been independently validated against a global security standard? | **No** (not yet — answer No, this is fine for a new app) |

---

## Section 6: Privacy policy URL

`https://iqmobile.org/privacy`

---

## Notes for the submitter

1. Google reviews this for consistency with your actual code. If you say
   you don't collect something but the SDK clearly does, they reject.
   This document is honest about Sentry + PostHog + FCM — don't downplay
   either or you'll get rejected.
2. The "phone number is shared" question is a sticking point. The Play
   Console UI doesn't have a great answer for "shared with other users
   of the app at the user's own initiative". Choose the closest option
   and add a clarifying note in any free-text field offered.
3. If you decide to disable PostHog or Sentry for the launch, update
   this document and the privacy policy at `server/static/privacy.html`
   to match before submitting.
