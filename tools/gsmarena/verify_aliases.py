#!/usr/bin/env python3
"""Check the hand-written aliases against what the target page actually says.

An alias is a claim about which device a shop means ("iPad mini 7" is the
2024 mini). The claim is checkable: the 2024 mini runs an A17 Pro, the 2021
one an A15. Each rule below asserts the chipset (or another unmistakable
field) so a wrong year fails loudly here instead of quietly shipping the
wrong spec sheet to a listing.
"""
import io, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# alias target name -> a regex the page's chipset must satisfy
EXPECT = {
    "iPad 10.2 (2021)":     r"A13",
    "iPad (2022)":          r"A14",
    "iPad (2025)":          r"A16",
    "iPad Pro 11 (2025)":   r"\bM5\b",
    "iPad mini (2019)":     r"A12",
    "iPad mini (2021)":     r"A15",
    "iPad mini (2024)":     r"A17",
    "iPad Air (2020)":      r"A14",
    "iPad Air (2022)":      r"\bM1\b",
    "iPad Air 11 (2024)":   r"\bM2\b",
    "iPad Air 11 (2025)":   r"\bM3\b",
    "iPad Air 11 (2026)":   r"\bM4\b",
    "iPad Air 13 (2026)":   r"\bM4\b",
    "iPhone SE (2022)":     r"A15",
    "Watch Series 10":      r"S10|Apple",
    "Watch Series 11":      r"S11|Apple",
    "Watch Ultra":          r"S8|Apple",
    "Pad 10":               r"Snapdragon|Dimensity|MediaTek|Kirin",
    "Pad X8b":              r"Snapdragon|Dimensity|MediaTek|Kirin",
    # Huawei publishes no chipset for this one, so the check hangs on the
    # screen size instead — still enough to catch a wrong model year.
    "MatePad 11.5 S (2025)": ("display", r"11\.5"),
    "Pura 80 Ultra":        r"Kirin",
    "Mix Flip":             r"Snapdragon",
}

if __name__ == "__main__":
    aliases = json.load(io.open(os.path.join(HERE, "aliases.json"), encoding="utf-8"))
    specs = {s["gsm_name"]: s for s in json.load(io.open(os.path.join(HERE, "device_specs.json"), encoding="utf-8"))}

    wanted = {v for brand, m in aliases.items() if brand != "_comment" for v in m.values()}
    bad, missing, ok = [], [], []
    for name in sorted(wanted):
        s = specs.get(name)
        if not s:
            missing.append(name)
            continue
        pat = EXPECT.get(name)
        field = "chipset"
        if isinstance(pat, tuple):
            field, pat = pat
        chip = s.get(field) or ""
        if not pat:
            bad.append((name, "no expectation written", chip))
        elif not re.search(pat, chip, re.I):
            bad.append((name, f"expected /{pat}/", chip))
        else:
            ok.append((name, chip))

    for n, c in ok:
        print(f"  ok    {n:24} {c[:44]}")
    for n in missing:
        print(f"  ---   {n:24} (not fetched yet)")
    for n, why, chip in bad:
        print(f"  WRONG {n:24} {why}; page says: {chip[:44]}")
    print(f"\n{len(ok)} verified, {len(missing)} pending, {len(bad)} wrong")
    sys.exit(1 if bad else 0)
