# IQ Mobile (instance 2)

Mobile-first marketplace for buying and selling phones in Iraq. **Sellers post
listings, buyers browse and chat in-app, both sides confirm a final price, and
only then is the seller's phone number unlocked.**

Three packages:

| Path        | Stack                                       | Run                       |
|-------------|---------------------------------------------|---------------------------|
| `server/`   | Node.js + Express + SQLite + SSE            | `cd server && npm run dev`|
| `mobile/`   | React Native + Expo SDK 54 (Android, RTL)   | `cd mobile && npx expo start` |
| `admin-web/`| Vite + React                                | `cd admin-web && npm run dev` |

## Concept

1. Seller posts a phone listing (brand, model, specs, ≥3 photos, price).
2. Buyers browse listings, save favourites, and start an in-app chat.
3. Inside the chat, the seller "Proposes Final Price".
4. Buyer accepts (or counter-offers / rejects).
5. Seller confirms the deal.
6. **Only after seller-confirm, the seller's phone number becomes visible to
   the buyer**, and the listing flips to `reserved` (default) or `sold`.
7. Buyer can rate the seller (or vice-versa) once the deal is confirmed.

The product rule is enforced everywhere: listings hide the seller phone,
chat scrubs raw phone numbers from messages until a confirmed deal exists,
and admins can review every blocked attempt.

## First-time setup

```bash
# 1. Server
cd server
npm install
npm run seed:admin       # creates admin / admin
npm run dev              # http://localhost:4000

# 2. Admin web
cd ../admin-web
npm install
npm run dev              # http://localhost:5173 (proxies /admin → :4000)

# 3. Mobile
cd ../mobile
npm install
# Edit mobile/app.json `extra.apiBaseUrl` if running on a real device.
npx expo start --android
```

## Tests

```bash
cd server && npm test
```

Covers:
- Phone-number detection / masking (Iraqi mobile, +964/00964, spaces/dashes,
  Arabic-Indic digits, look-alike letters).
- End-to-end deal flow: register → list → browse → chat → propose → accept →
  confirm → phone unlock → rate, including the negative cases (early confirm,
  early rate, masked vs allowed).

## Database (SQLite, `server/data/iqmobile.db`)

| Table              | Purpose                                                 |
|--------------------|---------------------------------------------------------|
| `users`            | unified buyer/seller account                            |
| `phone_listings`   | active marketplace listings                             |
| `listing_images`   | per-listing photos (≥3 enforced at the post wizard)     |
| `chats`            | one chat per (listing, buyer)                           |
| `chat_messages`    | text + image messages, with `masked` flag               |
| `deals`            | deal lifecycle (proposed → buyer_accepted → seller_confirmed) |
| `ratings`          | tied to confirmed deals only                            |
| `saved_listings`   | favourites                                              |
| `notifications`    | persisted notifications, also emitted via SSE/push      |
| `reports`          | user reports against listings/users/chats               |
| `bypass_attempts`  | logs every blocked phone-number attempt for review      |
| `app_settings`     | listing TTL, reserve-vs-sold-on-confirm                 |
| `admins`           | admin web logins                                        |

## Key API surface

```
POST   /auth/register           POST /auth/login           GET /auth/me
POST   /listings                GET  /listings             GET /listings/:id
PATCH  /listings/:id            DEL  /listings/:id         POST /listings/:id/renew
POST   /listings/:id/images     POST /listings/:id/save    DEL  /listings/:id/save
GET    /listings/saved/mine     GET  /listings/mine

POST   /listings/:id/chat       GET  /chats                GET /chats/:id
GET    /chats/:id/messages      POST /chats/:id/messages

POST   /chats/:id/propose-price
POST   /deals/:id/buyer-accept    POST /deals/:id/buyer-reject
POST   /deals/:id/counter-offer   POST /deals/:id/seller-confirm
POST   /deals/:id/cancel          GET  /deals/mine

POST   /deals/:id/rating        GET  /users/:id/ratings
POST   /reports

GET    /notifications           POST /notifications/read-all

GET    /events                  (SSE — chat.message, deal.*, phone.unlocked, …)
```

Admin endpoints live under `/admin/*` and back the admin web app — listings,
users, deals, reports, bypass attempts, settings.

## RTL

`mobile/app.json` sets `extra.forceRTL = true`. On first launch
`I18nManager.forceRTL(true)` is called; a manual reload of the bundle is
needed once on a fresh install for the OS to pick it up.
