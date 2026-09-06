# Listing draft recovery

The posting wizard keeps a draft on the device. Every field, the current step and
the selected photos are written to AsyncStorage under `iq_listing_draft_v1` after
each change, once the stored draft has finished loading — the load gate matters,
because without it the first render's empty state overwrites the draft it is
meant to recover.

The draft is never applied silently. On entering the wizard with a stored draft,
the seller is asked whether to continue or start over. Starting over is the only
action that deletes it; leaving the wizard, switching tabs and closing the app all
keep it.

Photos are copied out of the cache directory into `documentDirectory/listing-draft/`
when they are picked, because the compressor writes to a cache the operating system
may clear between launches. On restore each file is checked and missing ones are
dropped, with the count stated up front rather than restoring a gallery that
silently lost pictures.

Switching to another tab no longer discards a half-filled form. The Sell tab still
resets to a blank wizard when nothing has been entered.

Publishing uploads photos one request at a time. A photo that fails no longer costs
the listing: the listing is published, the seller is told how many pictures did not
upload, and the remaining ones can be added from the edit screen, which also accepts
a video. Previously any upload failure deleted the listing that had just been
created.

Each draft carries a `client_key` sent with `POST /listings`. If a create reaches
the server but the reply is lost, retrying with the same key returns the listing
that was already made instead of posting the phone twice. Keys are unique per
seller, so two devices generating the same key cannot block each other, and listings
created before this feature carry no key and are unaffected.

The key is checked before the one-listing-per-hour cap, not after. A replay creates
nothing, so the cap has nothing to protect against; checking it first meant the exact
case the mechanism exists for — resending a stored draft after a dropped response —
was answered with "you can only post once an hour" for a listing the seller had
already posted. A request carrying a new key is still capped normally.

Validation: 37 server tests and 12 mobile tests pass, and mobile TypeScript is clean.
Deploy the server before releasing the mobile update — an app sending `client_key` to
a server without the column would create duplicates on retry.
