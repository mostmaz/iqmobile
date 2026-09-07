# Shared listing links (#23)

## The headline bug: shared links never opened the app

The share button emits `https://iqmobile.org/l/:id`. All three deep-link
registrations named **`api.iqmobile.org`**:

| Layer | Was | Now |
|---|---|---|
| `navigation/index.tsx` `linking.prefixes` | `api.iqmobile.org` | `iqmobile.org` + `api.` |
| `app.json` android `intentFilters` | `api.iqmobile.org` | `iqmobile.org` + `api.` |
| `app.json` `ios.associatedDomains` | `applinks:api.iqmobile.org` | both |

So a shared listing tapped **with the app installed** opened the browser. All
three have to agree — fixing one fixes nothing — and the `app.json` half needs
a **native rebuild**.

`api.iqmobile.org` is kept because shares already in circulation carry it.

**No `www.`**: `www.iqmobile.org` is NXDOMAIN. An `applinks:` entry for a host
that cannot serve its association file is a fetch failure Apple caches, so
adding it would be a risk with no upside.

## Server prerequisites — verified, not assumed

`server/src/index.js` serves the AASA only when `APPLE_TEAM_ID` is set, and
Apple's CDN caches a 404. Checked against production:

```
iqmobile.org      AASA 200   assetlinks 200   /l/:id 200
api.iqmobile.org  AASA 200   assetlinks 200   /l/:id 200
   {"applinks":{"details":[{"appID":"YUN9S77U9W.org.iqmobile.app","paths":["/l/*"]}]}}
```

Both are live, so the app build is the only thing missing.

## Preview accuracy

- **A listing with no images emitted `og:image="…/uploads/"` — a directory.**
  Crawlers fail the fetch and render a bare link. Falls back to the app icon,
  which is served at `/app-icon.png` (express.static mounts `./static` at the
  root, *not* under `/static`).
- **A sold phone previewed as available at full price.** The «تم البيع» /
  «محجوز» badge was in the `<h1>` only — invisible in a chat preview. It is now
  in `og:title` and `og:description`, so every forward of that link tells the
  truth.
- **`price_on_request` printed its sentinel** as a real price, the same bug #9
  fixed in the app.
- **Dimensions are measured, not assumed.** WhatsApp is picky without
  `og:image:width/height`, but wrong values are worse than none because
  crawlers lay out from them — a sampled upload is 1280×960, not the square
  you would guess. `sharp` reads the header (metadata only, not pixels) and
  the tags are omitted entirely if that fails.
- Added `og:image:alt`, `og:locale=ar_IQ` and the `twitter:title/description/image`
  trio.
- **`iqmobile.org` itself previewed with no image and no `twitter:card`** — the
  page most likely to be posted into a group rendered as a bare link.

## Measurement

`track('listing.share')` — sharing was previously unmeasurable, so "is the
share button worth its place on the image?" had no answer. Fired on **intent**,
before the sheet opens: iOS reports the chosen activity and Android does not,
so counting completions would silently undercount the larger platform.

## What this deliberately does **not** do

- **No per-share attribution.** `/get?ref=listing_698` already works for
  Android deferred deep links (`getApp.js`'s sanitizer keeps `_`, and
  `installReferrer.ts`'s `/listing_(\d+)/` matches it unchanged). iOS drops the
  ref — an Apple limitation, not something to work around.
- **No short links or a redirector.** Another hop is another thing to break,
  and `iqmobile.org/l/:id` is already short.
- **No dynamic OG images.** A rendered price card would go stale the moment
  the price changed, and crawlers cache aggressively.
