#!/usr/bin/env python3
"""Fetch and parse the spec sheet for every matched device.

Output is one row per GSMArena device (not per listing) — specs belong to
the device, so a model shared by forty sellers is fetched once and every
listing of it resolves to the same sheet.

Only the six fields the shop asked for are treated as first-class
(display inches, CPU, RAM, battery, charge speed, cameras); the rest of the
sheet is kept raw so nothing has to be re-fetched to add a field later.
"""
import io, json, os, re, sys, time, html, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gsm_index import get  # cached, polite fetcher  # noqa: E402


def rows(page):
    """Every label/value pair in the spec table, plus the data-spec keys."""
    out, ds = [], {}
    for m in re.finditer(r'data-spec="([a-z0-9_-]+)"[^>]*>(.*?)</td>', page, re.S):
        v = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
        if v:
            ds[m.group(1)] = v
    # Rows without a data-spec (Charging is one) come from the ttl/nfo pair.
    for m in re.finditer(r'<td class="ttl"[^>]*>(.*?)</td>\s*<td class="nfo"[^>]*>(.*?)</td>', page, re.S):
        k = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(1)))).strip()
        v = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
        if k and v:
            out.append((k, v))
    return ds, out


def pick(pairs, *labels):
    for k, v in pairs:
        if k.lower() in labels:
            return v
    return None


# The battery highlight at the top of the page, e.g.
#   <div data-spec="battype-hl"><i class="icon-wired-charging"></i>66W</div>
# Some sheets carry the wired figure only here and have no "Charging" row.
HL_CHARGE = re.compile(
    r'data-spec="battype-hl"[^>]*>(.*?)</div>', re.S)


def highlight_watts(page):
    """Wired/wireless watts from the battery highlight block.

    The block is a sequence of icon-then-value pairs:
      <i class="icon-wired-charging"></i>PD2.0<i class="icon-wireless-charging"></i>15W
    so the number has to be read from the segment belonging to its own icon.
    Reading the whole block would hand an iPhone's 15W MagSafe figure back
    as its wired speed.
    """
    m = HL_CHARGE.search(page)
    if not m:
        return None, None
    parts = re.split(r'<i class="[^"]*icon-(wired|wireless)-charging[^"]*"></i>', m.group(1))
    wired = wireless = None
    # parts = [prefix, kind, value, kind, value, ...]
    for kind, value in zip(parts[1::2], parts[2::2]):
        w = re.search(r"(\d+(?:\.\d+)?)\s*W\b", re.sub(r"<[^>]+>", " ", value))
        if not w:
            continue
        if kind == "wired":
            wired = wired or float(w.group(1))
        else:
            wireless = wireless or float(w.group(1))
    return wired, wireless


def parse(page):
    ds, pairs = rows(page)
    size = ds.get("displaysize") or ""
    inches = None
    m = re.search(r"([\d.]+)\s*inches", size)
    if m:
        inches = float(m.group(1))

    mem = ds.get("internalmemory") or ""
    rams = sorted({int(x) for x in re.findall(r"(\d+)\s*GB RAM", mem)})
    # Some sheets only carry the highlight value.
    if not rams and ds.get("ramsize-hl"):
        rams = [int(x) for x in re.findall(r"\d+", ds["ramsize-hl"])][:1]
    storages = []
    for x in re.findall(r"(\d+)\s*(GB|TB)(?!\s*RAM)", mem):
        storages.append(f"{x[0]}{x[1]}")
    storages = sorted(set(storages), key=lambda s: (s.endswith("TB"), int(re.sub(r"\D", "", s))))

    bat = ds.get("batdescription1") or pick(pairs, "type") or ""
    mah = None
    m = re.search(r"([\d,]{3,6})\s*mAh", bat)
    if m:
        mah = int(m.group(1).replace(",", ""))

    charging = pick(pairs, "charging") or ""
    # Wired wattage is what a shopper means by "charge speed", and these
    # strings put several numbers in one line:
    #   "Wired, PD2.0, 50% in 30 min 25W wireless MagSafe/Qi2 (15W - China) 4.5W reverse wired"
    # Everything from the first "wireless" onwards belongs to the pad (the
    # regional "(15W - China)" note included), and reverse charging is the
    # phone's output, not its input. Reading left to right and taking the
    # first number would report an iPhone as a 15W charger.
    low = charging.lower()
    wl_at = low.find("wireless")
    watts = watts_wireless = None
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*W\b", charging):
        near = low[max(0, m.start() - 12): m.end() + 12]
        if "reverse" in near:
            continue
        val = float(m.group(1))
        if wl_at != -1 and m.start() >= wl_at - 6:
            watts_wireless = watts_wireless or val
        else:
            watts = watts or val

    if watts is None or watts_wireless is None:
        hw, hwl = highlight_watts(page)
        watts = watts or hw
        watts_wireless = watts_wireless or hwl

    return {
        "display_inches": inches,
        "display": size or None,
        "display_resolution": ds.get("displayresolution"),
        "display_type": ds.get("displaytype"),
        "chipset": ds.get("chipset"),
        "cpu": ds.get("cpu"),
        "gpu": ds.get("gpu"),
        "ram_gb": rams or None,
        "storage_options": storages or None,
        "battery_mah": mah,
        "battery": bat or None,
        "charging": charging or None,
        "charge_w": watts,
        "charge_w_wireless": watts_wireless,
        "camera_main": ds.get("cam1modules"),
        "camera_main_video": ds.get("cam1video"),
        "camera_selfie": ds.get("cam2modules"),
        "camera_selfie_video": ds.get("cam2video"),
        "os": ds.get("os"),
        "network": ds.get("nettech"),
        "announced": ds.get("year"),
        "body": ds.get("body-hl") or ds.get("dimensions"),
        "sim": ds.get("sim"),
    }


if __name__ == "__main__":
    matched = json.load(io.open(os.path.join(HERE, "matched.json"), encoding="utf-8"))
    out_path = os.path.join(HERE, "device_specs.json")
    # --reparse rebuilds every sheet from the page cache without touching the
    # network, which is what a parser fix needs: the HTML is already on disk.
    reparse = "--reparse" in sys.argv
    done = {}
    if os.path.exists(out_path) and not reparse:
        done = {d["gsm_url"]: d for d in json.load(io.open(out_path, encoding="utf-8"))}

    # One fetch per distinct device page, regardless of how many models map to it.
    urls = {}
    for m in matched:
        urls.setdefault(m["gsm_url"], m)

    print(f"{len(urls)} device pages ({len(done)} already cached)", flush=True)
    results = list(done.values())
    for i, (url, m) in enumerate(sorted(urls.items()), 1):
        if url in done:
            continue
        page = get(url, cache_only=reparse)
        if not page:
            if not reparse:
                print(f"  [{i}/{len(urls)}] FAILED {url}", flush=True)
            continue
        try:
            spec = parse(page)
        except Exception as e:                       # noqa: BLE001
            print(f"  [{i}/{len(urls)}] parse error {url}: {e}", flush=True)
            continue
        results.append({"gsm_url": url, "gsm_name": m["gsm_name"],
                        "gsm_brand": m.get("gsm_brand"), **spec})
        if i % 25 == 0:
            json.dump(results, io.open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
            print(f"  [{i}/{len(urls)}] {m['gsm_name']}", flush=True)
    json.dump(results, io.open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
    have = sum(1 for r in results if r["display_inches"] and r["battery_mah"])
    print(f"done: {len(results)} devices, {have} with both display and battery", flush=True)
