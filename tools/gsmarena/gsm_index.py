#!/usr/bin/env python3
"""Build a GSMArena device index (name -> spec page URL) for the brands we sell.

Politeness: one request at a time with a delay, a real UA, and every page
cached to disk so a re-run costs nothing. GSMArena is the same source the
device catalogue was originally built from.
"""
import io, json, os, re, sys, time, urllib.request, html

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
BASE = "https://www.gsmarena.com/"
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gsm_cache")
os.makedirs(CACHE, exist_ok=True)
DELAY = float(os.environ.get("GSM_DELAY", "1.6"))


def get(url_path, cache_only=False):
    """Fetch a page, cached. Returns HTML text or None on a hard failure."""
    key = re.sub(r"[^a-z0-9._-]", "_", url_path.lower())
    path = os.path.join(CACHE, key + ".html")
    if os.path.exists(path) and os.path.getsize(path) > 2000:
        return io.open(path, encoding="utf-8", errors="ignore").read()
    if cache_only:
        return None
    req = urllib.request.Request(BASE + url_path, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8", "ignore")
            io.open(path, "w", encoding="utf-8").write(body)
            time.sleep(DELAY)
            return body
        except Exception as e:                       # noqa: BLE001
            sys.stderr.write(f"  ! {url_path}: {e}\n")
            time.sleep(4 * (attempt + 1))
    return None


def brand_urls():
    s = get("makers.php3")
    out = {}
    for m in re.finditer(r'<a href=([a-z0-9_.\'-]+-phones-(\d+)\.php)>([^<]+)<br>', s):
        out[html.unescape(m.group(3)).strip().lower()] = (m.group(1), m.group(2))
    return out


def devices_for(slug, bid):
    """Every device of one brand, walking the paginated listing."""
    found, page, seen_pages = {}, 1, set()
    url = f"{slug}-phones-{bid}.php"
    while url and url not in seen_pages and page <= 40:
        seen_pages.add(url)
        s = get(url)
        if not s:
            break
        block = s
        # Loose on the markup (tablet and watch rows nest differently from
        # phones, and a strict pattern silently dropped every iPad) but
        # strict on the href: a device page ends in -<id>.php and never
        # carries "-phones-", which is the paginated listing. Without that
        # guard the greedy .*? pairs a device name with the "next page"
        # link and the spec fetch lands on a listing page.
        for m in re.finditer(r'<a href="([^"]+?-\d+\.php)">((?:(?!</a>).)*?)<strong><span>(.*?)</span>', block, re.S):
            if "-phones-" in m.group(1):
                continue
            name = html.unescape(re.sub(r"<[^>]+>", " ", m.group(3)))
            found[re.sub(r"\s+", " ", name).strip()] = m.group(1)
        nxt = re.search(rf'<a href="({slug}-phones-f-{bid}-0-p{page + 1}\.php)"', s)
        url = nxt.group(1) if nxt else None
        page += 1
    return found


# Our brand names -> the name GSMArena uses. Redmi and POCO are Xiaomi
# sub-brands there; Nubia is its own maker page.
ALIAS = {
    "poco": "xiaomi", "redmi": "xiaomi", "itel": "itel", "nubia": "nubia",
    "oukitel": "oukitel", "blackview": "blackview", "vivo": "vivo",
    "oppo": "oppo", "honor": "honor", "tecno": "tecno", "infinix": "infinix",
    "realme": "realme", "motorola": "motorola", "oneplus": "oneplus",
    "google": "google", "huawei": "huawei", "samsung": "samsung",
    "xiaomi": "xiaomi", "apple": "apple",
}
# Brands that only show up inside the free-text "Other" bucket, indexed so
# those listings have something to match against.
EXTRA = ["lenovo", "sony", "zte", "nokia", "tcl", "ulefone", "doogee",
         "alcatel", "asus", "lg", "htc", "meizu", "sharp", "energizer"]
# nubia has a device page but no row on makers.php3, so it is named directly.
MISSING = {"nubia": ("nubia-phones-111.php", "111")}

if __name__ == "__main__":
    brands = brand_urls()
    print(f"gsmarena brands: {len(brands)}")
    targets = json.load(io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "targets.json")))
    ours = sorted({r["brand"].lower() for r in targets} | set(EXTRA))
    index = {}
    for b in ours:
        g = ALIAS.get(b, b)
        entry = brands.get(g) or MISSING.get(g)
        if not entry:
            print(f"  skip {b} (no maker page)")
            continue
        slug, bid = entry
        slug = slug.rsplit("-phones-", 1)[0]
        devs = devices_for(slug, bid)
        print(f"  {b:10} -> {g:9} {len(devs)} devices")
        index.setdefault(g, {}).update(devs)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gsm_index.json")
    json.dump(index, io.open(out, "w", encoding="utf-8"), ensure_ascii=False)
    print("total indexed:", sum(len(v) for v in index.values()))
