# Device spec sheets

Specs (display size, chipset, RAM, battery, charge speed, cameras) for the
devices actually being sold on iQ Mobile, sourced from GSMArena — the same
place `device_catalog` came from.

Specs belong to the **device**, not the listing: forty sellers of the same
iPhone 13 Pro Max share one sheet, and a listing posted tomorrow inherits it
without anyone typing anything.

## Pipeline

Run from this directory, in order. Every page is cached under `gsm_cache/`
(gitignored), so a re-run costs nothing and a crash resumes where it stopped.
Requests are sequential with a delay — `GSM_DELAY` (seconds, default 1.6).

```
python3 gsm_index.py     # brand pages  -> gsm_index.json   (name -> spec page)
python3 gsm_match.py     # our models   -> matched.json / unmatched.json
python3 gsm_specs.py     # spec pages   -> device_specs.json
python3 gsm_export.py    # review sheet -> device-specs-review.xlsx
```

`targets.json` is the input: every distinct `(brand, model)` on active
listings with its listing count. Regenerate it from the droplet with

```
ssh iqmobile@<host> "cd ~/iqmobile/server && node -e \"...\"" > targets.json
```

(the query lives in the git history of this file's commit message).

Then load it into the database:

```
cd ../../server && node scripts/importDeviceSpecs.js ../tools/gsmarena
```

## Matching

Seller-typed model names are free text — Arabic, noise words ("للبيع"),
`+` vs `Plus`, missing brand prefixes. Matching is staged: exact on a
normalised key, then on shaved variants (5G/4G suffix, `Galaxy`/`iPhone`
prefix), then an unambiguous prefix pass. Where GSMArena carries the same
name across model years (`iPad Air 11 (2024|2025|2026)`) the newest wins.

**Anything that survives all three passes is left unmatched on purpose.**
A wrong spec sheet under a listing is worse than no spec sheet, so the
matcher never guesses — `unmatched.json` is the honest list of gaps, sorted
by listing count so the expensive ones are obvious.

The `(brand, model)` -> sheet decision is stored in `device_spec_map` and the
server only ever does an equality lookup against it. That is deliberate: the
matching logic exists once, here, instead of being reimplemented in JS where
the two copies would drift.
