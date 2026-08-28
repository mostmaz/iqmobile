#!/usr/bin/env python3
"""Match our listing model names against the GSMArena index.

Seller-typed models are free text (Arabic, noise words, inconsistent
spacing), so matching is staged: exact on a normalised key, then on shaved
variants, then an unambiguous prefix pass. Anything that survives all three
is reported as unmatched rather than guessed — a wrong spec sheet under a
listing is worse than no spec sheet.

Where GSMArena carries the same name in several model years
("iPad Air 11 (2024|2025|2026)") the newest wins: that is what a shop
selling today means by "iPad Air 11".
"""
import io, json, os, re, unicodedata
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")

# Capacity is a variant, not a model: "iPhone 15 Pro Max 256GB" is an
# iPhone 15 Pro Max.
CAPACITY = re.compile(r"\b\d+\s*(gb|tb|جيجا|تيرا)\b", re.I)
NOISE = re.compile(
    r"\b(new|used|جديد|مستعمل|للبيع|بيع|جهاز|موبايل|هاتف|تليفون|اصلي|"
    r"وارد|شرق|اوسط|امريكي|ياباني|كوري|نسخة|نسخه|كفالة|كفاله|ram|rom|"
    r"dual|sim|global|version|edition|بحالة|ممتازة|نظيف|"
    r"international|middle ?east|usa|uk|europe|esim|e-sim|"
    r"activated|non ?active|فعال|غير ?مفعل)\b", re.I)
BRANDS = ("apple|samsung|xiaomi|redmi|poco|honor|huawei|infinix|tecno|realme|"
          "oppo|vivo|nubia|motorola|oneplus|google|itel|oukitel|blackview|"
          "lenovo|sony|zte|nokia|tcl|ulefone|doogee|alcatel|asus|meizu|sharp")

# Our brand -> the maker whose GSMArena page carries the device. Redmi and
# POCO are Xiaomi sub-brands there; nubia sits under ZTE.
ALIAS = {"poco": "xiaomi", "redmi": "xiaomi", "nubia": "zte"}


def norm(s, brand=None):
    s = unicodedata.normalize("NFKC", str(s or "")).translate(AR_DIGITS).lower()
    s = s.replace("+", " plus ").replace("&", " and ")
    s = re.sub(r"\((\d{4})\)", " ", s)              # model year, handled separately
    s = CAPACITY.sub(" ", s)
    s = NOISE.sub(" ", s)
    s = re.sub(rf"\b({BRANDS})\b", " ", s)
    if brand:
        s = re.sub(rf"\b{re.escape(brand.lower())}\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def suffix_variants(key):
    """Ours minus a trailing network/region tag: "Camon 40 Pro 5G" is the
    same phone GSMArena lists as "Camon 40 Pro"."""
    out = [key]
    for suf in ("5g", "4g", "lte", "nfc", "wifi", "china", "global", "india"):
        if key.endswith(suf) and len(key) > len(suf):
            out.append(key[: -len(suf)])
    return out


# Family words. A query that names one must not match a device from
# another: "iPad 11" matching "iPhone 11" is the exact mistake that puts a
# phone's spec sheet under a tablet.
FAMILY = ("ipad", "iphone", "watch", "pad", "tab", "book", "note")


def index_variants(key, brand=None):
    """The maker's own name, plus the shorter forms sellers actually type.

    Shaving happens on the INDEX side, never the query side. Sellers drop
    the family word ("16 Pro Max" for iPhone 16 Pro Max, "G15" for Moto
    G15), so the index registers both; doing it the other way round lets
    "iPad 11" shave down to "11" and collide with a phone.
    """
    out = [key]
    for suf in ("5g", "4g", "lte", "wifi"):
        if key.endswith(suf) and len(key) > len(suf) + 2:
            out.append(key[: -len(suf)])
    for pre in ("galaxy", "iphone", "ipad", "redmi", "poco", "moto", "nubia"):
        if key.startswith(pre) and len(key) > len(pre) + 2:
            out.append(key[len(pre):])
    seen, ordered = set(), []
    for k in out:
        if len(k) >= 2 and k not in seen:
            seen.add(k)
            ordered.append(k)
    return ordered


def family_of(name):
    n = re.sub(r"[^a-z0-9 ]", " ", str(name).lower())
    for f in FAMILY:
        if re.search(rf"\b{f}\b", n):
            return f
    return None


ACCESSORY = re.compile(
    r"(pencil|earbud|freebud|freeclip|buds|airpod|headphone|سماعة|"
    r"keyboard|كيبورد|case|cover|غطاء|charger|شاحن|cable|كيبل|"
    r"power ?bank|hair dryer|cleaner|photography kit|kit pro|"
    r"smart ?pen|focus pen|stylus|قلم|adapter|محول|stand|حامل)", re.I)


def is_accessory(model):
    return bool(ACCESSORY.search(model))


def edits1(a, b):
    """True when a and b differ by at most one substitution/insert/delete."""
    if abs(len(a) - len(b)) > 1:
        return False
    if a == b:
        return True
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long = (a, b) if len(a) < len(b) else (b, a)
    for i in range(len(long)):
        if long[:i] + long[i + 1:] == short:
            return True
    return False


def year_of(name):
    m = re.search(r"\((\d{4})\)", name)
    return int(m.group(1)) if m else 0


def build_lut(index):
    """brand -> {key: (display name, url, year)} keeping the newest per key."""
    lut = {}
    for gbrand, devs in index.items():
        table = {}
        for name, url in devs.items():
            y = year_of(name)
            base = norm(name, gbrand)
            if not base:
                continue
            for k in index_variants(base, gbrand):
                cur = table.get(k)
                # Prefer the newest model year; failing that, keep the first
                # (GSMArena lists newest first, so that is also the newest).
                if cur is None or y > cur[2]:
                    table[k] = (name, url, y)
        lut[gbrand] = table
    return lut


def find(table, key, brand=None, model=None, gbrand=None):
    """First hit wins, exact before shaved. Returns (entry, confidence)."""
    fam = family_of(model or "")
    for k in suffix_variants(key):
        hit = table.get(k)
        if not hit:
            continue
        # A tablet name must land on a tablet. Where our side names a family
        # and the maker's name names a different one, that is a collision,
        # not a match.
        hf = family_of(hit[0])
        if fam and hf and fam != hf:
            continue
        if fam and not hf and fam in ("ipad", "watch", "tab", "pad", "book"):
            continue
        return hit, ("exact" if k == key else "loose")
    return None, None


if __name__ == "__main__":
    index = json.load(io.open(os.path.join(HERE, "gsm_index.json"), encoding="utf-8"))
    targets = json.load(io.open(os.path.join(HERE, "targets.json"), encoding="utf-8"))
    lut = build_lut(index)

    # Hand-written mappings for names no matcher can derive (Apple sells
    # generations, GSMArena indexes model years). Looked up before anything
    # else and tagged "manual" so the importer never overwrites them.
    aliases = json.load(io.open(os.path.join(HERE, "aliases.json"), encoding="utf-8"))
    by_name = {gb: {n: u for n, u in devs.items()} for gb, devs in index.items()}

    matched, unmatched = [], []
    for t in targets:
        b = t["brand"].lower()
        key = norm(t["model"], b)
        hit = conf = None
        want = aliases.get(t["brand"], {}).get(str(t["model"]).strip().lower())
        if want:
            gb = ALIAS.get(b, b)
            url = by_name.get(gb, {}).get(want)
            if url is None:
                raise SystemExit(f'alias target not in index: {t["brand"]} "{want}"')
            hit, conf = (want, url, 0), "manual"
            t = {**t, "gsm_brand": gb}
        if not hit and key:
            if b == "other":
                # No brand to go on: accept only a single unambiguous hit
                # across every maker, so "Smart 20" can't become a coin toss.
                seen = {}
                for gb, table in lut.items():
                    h, c = find(table, key, gb, t["model"])
                    if h:
                        seen[h[1]] = (h, c, gb)
                if len(seen) == 1:
                    hit, conf, gb = next(iter(seen.values()))
                    t = {**t, "gsm_brand": gb}
            else:
                gb = ALIAS.get(b, b)
                if gb in lut:
                    hit, conf = find(lut[gb], key, gb, t["model"])
                    if hit:
                        t = {**t, "gsm_brand": gb}
        if hit:
            matched.append({**t, "gsm_name": hit[0], "gsm_url": hit[1], "match": conf})
        else:
            unmatched.append({**t, "accessory": is_accessory(t["model"])})

    tot_l = sum(t["n"] for t in targets)
    print(f"targets {len(targets)}  matched {len(matched)}  unmatched {len(unmatched)}")
    print(f"listings covered: {sum(m['n'] for m in matched)} of {tot_l} "
          f"({100 * sum(m['n'] for m in matched) // tot_l}%)")
    print("iq-shop models:", sum(1 for m in matched if m["iq"] > 0), "of",
          sum(1 for t in targets if t["iq"] > 0))
    print("price-shop models:", sum(1 for m in matched if m["price"] > 0), "of",
          sum(1 for t in targets if t["price"] > 0))
    print("confidence:", Counter(m["match"] for m in matched))
    acc = sum(1 for u in unmatched if u["accessory"])
    print(f"unmatched: {len(unmatched)} ({acc} accessories with no spec sheet, "
          f"{len(unmatched) - acc} real devices)")
    print("unmatched by brand:", Counter(u["brand"] for u in unmatched if not u["accessory"]).most_common(8))
    print("\ntop unmatched:")
    for u in sorted([x for x in unmatched if not x["accessory"]], key=lambda x: -x["n"])[:20]:
        print(f'  {u["n"]:3}  {u["brand"]:9} {u["model"][:50]}')

    json.dump(matched, io.open(os.path.join(HERE, "matched.json"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(unmatched, io.open(os.path.join(HERE, "unmatched.json"), "w", encoding="utf-8"), ensure_ascii=False)
