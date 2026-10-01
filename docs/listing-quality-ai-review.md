# AI quality check: good listings publish, bad ones wait for a human

`server/src/listingInspect.js` reads a new listing's photos and description
and sorts the device into **good** or **bad**. Good is published. Bad is held
back, the seller is told the crew will look at it, and an operator decides
from the dashboard (الفحص page).

## What counts as bad

The model is told, in Arabic, exactly this:

| Verdict | Device |
|---|---|
| **bad** (`defective`) | screen broken / cracked; touch not working (dead zone, ghost touch); a smudge, spot, line or burn-in on the screen; back shattered, cracked or clearly damaged; the description says broken, faulty, not working |
| **good** (`clean`) | new, like new, or used with ordinary scratches on the frame or back |
| **unclear** (`suspect`) | a possible sign but the photo is not conclusive or the text is ambiguous |

A screen protector with bubbles, a reflection, a case, a switched-off screen
or an unclear photo are explicitly *not* defects. When unsure the model must
answer `suspect`, never `defective`.

## What happens to each verdict

Every check is recorded, good ones included, and listed in the dashboard's
الفحص tab with the verdict, confidence, evidence, photos and what was done.

With **دع الذكاء الاصطناعي يقرر** (`listing_inspection_decide`) **off**, that
is all: the listing is left alone (`action = logged`). suspect/defective rows
sit in the pending list so an operator can still act by hand.

With it **on**:

```
photos uploaded ──20 s quiet──▶ one model call (≤3 photos + text)
                                   │
   clean, medium/high ─────────────┤  published (action = published)
   defective, high ────────────────┤  NOT published: status='removed', seller
                                   │  told «لم يُنشر» + reason, operator can
                                   │  overturn from the tab (action = rejected)
   everything else ────────────────┘  HELD: hidden from buyers, seller told the
     (suspect; defective low/med;      crew will look, pending list (orange
      any low-confidence answer)       "محجوب عن النشر") (action = held)
```

Held means `status='removed'` + `review_hold=1` on `phone_listings`, the
same trick drafts use: every public query already excludes it, only the
seller's own list (as `under_review`) and the queue go looking.

Operator decision (`POST /admin/inspection/:id/approve|remove`):

- **approve** → `status='active'`, `review_hold=0`, expiry restarts now, seller
  gets «نُشر إعلانك ✅».
- **remove** → stays removed, seller gets «لم يُنشر إعلانك» with the reason
  (the model's sentence, or one the operator typed).

Seller-facing surfaces:

- push + inbox notification `listing.review.pending|approved|rejected`
  (inbox row only on app ≥ 0.5.3, which carries the labels; the push always
  goes and carries the whole message).
- «إعلاناتي» shows the listing under a «قيد المراجعة» tab with a notice and
  the model's notes; `PATCH status` is refused (409 `under_review`) while
  held, everything else stays editable; a re-upload re-runs the check but
  never releases the hold on its own.
- The post-publish screen mentions the check only when `/app-config`
  reports `quality_check: true`.

## Switches

| Where | Key | Default | Effect |
|---|---|---|---|
| `.env` | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | unset | the key for the chosen model; nothing runs without it |
| settings | `listing_inspection_model` | empty | **the model picker in dashboard → Settings**; `gpt-*` → OpenAI, `claude-*` → Anthropic |
| `.env` | `LISTING_INSPECT_MODEL` | `gpt-6-luna` | fallback when the dashboard picker is on "default" |
| `.env` | `LISTING_INSPECT_DEBOUNCE_MS` | 20000 | wait for photo uploads to go quiet |
| `.env` | `LISTING_INSPECT_IMAGE_MAX` | `1280x720` | photos are resized server-side to fit this (aspect kept, no crop, never enlarged) before the call |
| settings | `listing_inspection_enabled` | 0 | master switch (dashboard → Settings) |
| settings | `listing_inspection_decide` | 0 | **off = check only**: every result recorded and shown, every listing stays live. **on = the AI decides** (table below) |

Word-level gate (`listingQuality.js`) is unchanged and still runs first: a
description with «لا يعمل» / «مسروق» / «مقفول» is refused at creation, and
disclosed damage («مكسور») still goes to the queue. The AI adds meaning and
the photos.

## Cost: 1,000 listings, photos + description

What one check sends. Photos are resized on the server to fit 1280×720
before the call (a 4:3 phone photo lands at 960×720), 3 photos inspected:

| Part | Tokens (OpenAI, 32-px patches × 1.2) | Tokens (Claude, 28-px patches) |
|---|---|---|
| 3 photos at ≤ 1280×720 | ≈ 2,500–3,300 | ≈ 2,100–2,800 |
| system prompt | ≈ 700 (Claude: cached after the first call) | ≈ 700 |
| device line + description | ≈ 150 | ≈ 150 |
| JSON answer (+ low-effort reasoning on OpenAI) | ≈ 500 output | ≈ 120 output |

So ≈ 3.5–4k input and ≈ 0.5k output per listing on GPT-6 Luna: **about
$0.06 per 100 listings, $0.6 per 1,000**. The per-1,000 figures in the
tables below were computed at the earlier 1280-long-edge size and are
therefore slightly high (by about a quarter on the photo share); the
ranking between models is unchanged. Image tokens dominate; the description
is noise in the bill.

### Verified (official pricing pages fetched 1 Oct 2026)

Anthropic: platform.claude.com/docs/en/about-claude/pricing. Google:
cloud.google.com/vertex-ai/generative-ai/pricing (same as the Gemini API).

| Model | $/1M in / out | ≈ $ per 1,000 listings | Notes |
|---|---|---|---|
| Claude Haiku 4.5 | 1.00 / 5.00 | **5.6** | cheapest Claude; weakest judgement |
| Claude Sonnet 5.5 | 2.00 / 10.00 | **11** | hi-res image tier; strong vision |
| Claude Opus 5.5 | 4.00 / 20.00 | **22** | best judgement, lowest false holds |
| Claude Opus 5 (previous default) | 5.00 / 25.00 | 28 | superseded; switch off it |
| Gemini 2.5 Flash-Lite | 0.10 / 0.40 | **0.5** | ≈1,290 tokens per 1024² image |
| Gemini 3.1 Flash-Lite | 0.25 / 1.50 | 1.4 | |
| Gemini 2.5 Flash | 0.30 / 2.50 | 1.7 | |
| Gemini 3.6 / 3.7 / 3.8 Flash | 0.75 / 3.75 | 4.0 | intro price to 31 Dec 2026, then 1.50 / 7.50 (≈ 8) |
| Gemini 3.5 Flash | 1.50 / 9.00 | 8.2 | |
| Gemini 3.1 Pro | 2.00 / 12.00 | 11 | |

### Not verified (vendor sites blocked by this session's network policy)

Figures from search-engine snippets of openai.com/api/pricing and the
vendors' pages; confirm before budgeting on them.

| Model | $/1M in / out | ≈ $ per 1,000 listings | Image rule (snippet) |
|---|---|---|---|
| OpenAI GPT-6 Luna (22 Sep 2026) — **default** | 0.10 / 0.50, cached 0.01 | **0.6** | 32-px patches × 1.2, cap 2,500 → ≈1,440 / photo |
| OpenAI GPT-5.6 Luna (Jul 2026, cut 30 Jul) | 0.20 / 1.20 | 1.2 | same rule |
| OpenAI GPT-6 Sol / Astra | not found | — | larger tiers above Luna; prices unconfirmed |
| OpenAI gpt-5-mini / gpt-5-nano | 0.25 / 2.00 · 0.05 / 0.40 | 1.5 · 0.4 | previous generation |
| Mistral Small 4 | 0.15 / 0.60 | ≈ 0.8 | image rule not found |
| Qwen3-VL-Flash (Alibaba) | 0.05 / 0.40 | ≈ 0.4 | image rule not found |
| Amazon Nova Lite | 0.06 / 0.24 | ≈ 0.4 | snippet dated 2025 |

On Luna specifically: it is OpenAI's cheapest current vision model and the
snippets agree on its price (requesty.ai, openrouter.ai, pricepertoken.com,
developersdigest.tech). Two cautions before betting on it. The quoted
per-1,000 figure is at the price every third-party tracker reports, not a
page from openai.com. And several reports (alphasignal.ai, OpenAI developer
community) describe a silent image-understanding bug in GPT-6 Sol and Luna
that OpenAI patched server-side around 25 Sep 2026; for a job that is
entirely about reading photos, run a labelled sample before trusting it.

Batch APIs (50 % off at every vendor above) do not fit this job: results
arrive within hours, and the seller has already been told the listing is
live. Prompt caching is already on for the system prompt.

### Reading the table

Every option is cheap in absolute terms: even Opus 5.5 is about 2 cents a
listing, Haiku about half a cent, Luna a sixteenth of a cent. The expensive
event is a **wrong hold**: a seller with a clean phone told their ad "may
not be published" and made to wait. That is why the hold needs medium or
high confidence, and why the operators' approve/remove decisions should be
kept as labels from day one.

The default is GPT-6 Luna, chosen on price. Watch the queue for the first
few hundred listings: if the crew is approving most of what Luna holds, the
model is over-holding, and the same listings can be re-run through Claude
Sonnet 5.5 or Opus 5.5 by picking them in dashboard → Settings (with
`ANTHROPIC_API_KEY` in `.env`) to compare against those labels. Both
vendors' clients ship with the server; Gemini would need a third.
