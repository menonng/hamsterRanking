#!/usr/bin/env python3
"""Build the day/night parallax background layers in assets/bg/.

Source art: Luis Zuno (@ansimuz), CC0 (see assets/bg/LICENSE.txt).
  day   = "Country side platformer" (country-platform-files/layers)
  night = "Mountain Dusk" version A (Mountain Dusk/version A/Layers)

Both packs are read from a local checkout of the "Legacy Collection" copy in
https://github.com/Zedrinth/ProgDenGroup6Game (commit edba235), e.g.:

  git init src && cd src
  git remote add origin https://github.com/Zedrinth/ProgDenGroup6Game.git
  git sparse-checkout set --no-cone \
    '/Assets/Legacy Collection/Environments/country-platform-files/layers/' \
    '/Assets/Legacy Collection/Environments/Mountain Dusk/'
  git fetch --depth 1 --filter=blob:none origin edba235 && git checkout FETCH_HEAD

Usage:  python3 scripts/bg_assets.py <checkout-root> [out-dir=assets/bg] [preview-dir]
Needs Pillow + numpy. Pixel sizes are kept 1:1 (no scaling, no smoothing);
PNGs are written losslessly (exact RGBA palette when <=256 colours, verified
by a round-trip compare, else RGBA), with optimize=True.
"""
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ENV = Path("Assets/Legacy Collection/Environments")
DAY_DIR = ENV / "country-platform-files/layers"
NIGHT_DIR = ENV / "Mountain Dusk/version A/Layers"
NIGHT_PREVIEW = ENV / "Mountain Dusk/version A/Previews/Mountain-Dusk.png"


def load(p):
    a = np.array(Image.open(p).convert("RGBA"))
    a[a[..., 3] == 0] = 0  # normalise fully transparent pixels
    return a


def component(mask, seed):
    """8-connected component of boolean `mask` containing `seed` (y, x)."""
    comp = np.zeros_like(mask)
    stack = [seed]
    h, w = mask.shape
    while stack:
        y, x = stack.pop()
        if not (0 <= y < h and 0 <= x < w) or comp[y, x] or not mask[y, x]:
            continue
        comp[y, x] = True
        stack.extend((y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    return comp


def pad_to_height(a, h):
    """Bottom-align a layer inside a transparent canvas of height h."""
    if a.shape[0] == h:
        return a
    out = np.zeros((h, a.shape[1], 4), np.uint8)
    out[h - a.shape[0]:] = a
    return out


def seam_score(a):
    """Colour step across the wrap seam vs the median step between neighbouring columns.
    Fraction of rows whose wrap step is larger than any interior step in that row is also given."""
    x = a.astype(int)
    steps = np.abs(np.diff(x, axis=1)).sum(-1)              # (h, w-1)
    wrap = np.abs(x[:, 0] - x[:, -1]).sum(-1)               # (h,)
    return {
        "wrap_mean": float(wrap.mean()),
        "interior_mean": float(steps.mean()),
        "rows_worse_than_any_interior": float((wrap > steps.max(1)).mean()),
    }


def save_png(a, path):
    """Lossless save: exact RGBA palette if <=256 colours (verified), else RGBA."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rgba = Image.fromarray(a, "RGBA")
    flat = a.reshape(-1, 4)
    cols, inv = np.unique(flat, axis=0, return_inverse=True)
    candidates = []
    if len(cols) <= 256:
        p = Image.fromarray(inv.reshape(a.shape[:2]).astype(np.uint8), "P")
        p.putpalette(cols.astype(np.uint8).tobytes(), rawmode="RGBA")
        candidates.append(p)
    candidates.append(rgba)
    best = None
    for im in candidates:
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        back = np.array(Image.open(io.BytesIO(buf.getvalue())).convert("RGBA"))
        back[back[..., 3] == 0] = 0
        if np.array_equal(back, a) and (best is None or buf.tell() < len(best)):
            best = buf.getvalue()
    path.write_bytes(best)
    return len(best)


# ---------------------------------------------------------------- day
def build_day(src):
    d = src / DAY_DIR
    back = load(d / "country-platform-back.png")          # 384x224 opaque sky/clouds/mountains
    forest = load(d / "country-platform-forest.png")      # 160x224 pine forest, tiles
    example = load(d / "country-platform-tiles-example.png")  # 384x224 grass strip + big tree
    H = back.shape[0]

    # Grass strip: the example's grass repeats every 128 px; take the first period
    # (x 0..127 holds no tree) as the tile. Verified: rows >=0 of x 128..172 equal
    # x 0..44, so the 127 -> 0 wrap is the artist's own continuity.
    P = 128
    grass = example[:, :P].copy()
    rec = np.concatenate([grass] * (example.shape[1] // P), axis=1)
    assert np.array_equal(rec[:, P:173], example[:, P:173]), "grass period check failed"

    # Big tree: pixels that differ from the tiled grass, restricted to the connected
    # component that contains the canopy (drops two extra grass tufts at x>=255).
    diff = (rec != example).any(-1) & (example[..., 3] > 0)
    comp = component(diff, tuple(np.argwhere(diff)[0]))  # top-most diff px = canopy top
    ys, xs = np.where(comp)
    x0, x1 = xs.min(), xs.max() + 1
    tree = np.zeros((H, x1 - x0, 4), np.uint8)
    tree[comp[:, x0:x1]] = example[:, x0:x1][comp[:, x0:x1]]
    tree_center_frac = round(((x0 + x1) / 2) / example.shape[1], 3)

    layers = [
        ("d0", "sky, clouds, mountains", pad_to_height(back, H), True, 0.05, None),
        ("d1", "pine forest", pad_to_height(forest, H), True, 0.15, None),
        ("d2", "big tree (sprite)", tree, False, 0.30, tree_center_frac),
        ("d3", "grass strip", grass, True, 0.50, None),
    ]
    return H, layers


# ---------------------------------------------------------------- night
def build_night(src):
    d = src / NIGHT_DIR
    # Order verified against the pack's own preview (Previews/Mountain-Dusk.png):
    # this order reproduces it to 99.99 % of pixels.
    names = ["sky", "far-clouds", "near-clouds", "far-mountains", "mountains", "trees"]
    L = {n: load(d / f"{n}.png") for n in names}
    H = max(a.shape[0] for a in L.values())

    # The 320 px sky holds the moon; tiled at 3x it would show two moons on a wide
    # screen, so split it: moon -> its own non-tiling sprite, sky -> moonless tile.
    sky = L["sky"].copy()
    upper, lower = np.array([62, 46, 83, 255]), np.array([70, 52, 94, 255])
    is_bg = (sky == upper).all(-1) | (sky == lower).all(-1)
    # moon = big blob of non-background pixels; stars are 1-5 px. Find it by the
    # column/row with most non-bg pixels and grow a bbox.
    nb = ~is_bg
    cx = int(np.argmax(nb.sum(0)))
    cy = int(np.median(np.where(nb[:, cx])[0]))  # mid-moon, robust to a star in the column
    moon_mask = component(nb, (cy, cx))  # stars are separate, tiny components
    ys, xs = np.where(moon_mask)
    my0, my1, mx0, mx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    m = moon_mask[:, mx0:mx1]
    moon = np.zeros((H, mx1 - mx0, 4), np.uint8)
    moon[m] = sky[:, mx0:mx1][m]
    moon_center_frac = round(((mx0 + mx1) / 2) / sky.shape[1], 3)

    # Fill the hole: per column, the upper/lower colour boundary (a smile-shaped arc)
    # is fitted with a parabola from the columns outside the moon, then painted.
    w = sky.shape[1]
    bound = np.full(w, np.nan)
    for x in range(w):
        if mx0 - 2 <= x < mx1 + 2:
            continue
        col_upper = (sky[:, x] == upper).all(-1)
        bound[x] = col_upper[:100].sum()  # number of upper-colour px in the top band
    xs_ok = np.where(~np.isnan(bound))[0]
    coef = np.polyfit(xs_ok, bound[xs_ok], 2)
    for x in range(mx0, mx1):
        b = int(round(np.polyval(coef, x)))
        for y in range(my0, my1):
            if moon_mask[y, x]:
                sky[y, x] = upper if y < b else lower

    layers = [
        ("n0", "sky + stars (moon removed)", pad_to_height(sky, H), True, 0.02, None),
        ("n1", "moon (sprite)", moon, False, 0.03, moon_center_frac),
        ("n2", "far clouds", pad_to_height(L["far-clouds"], H), True, 0.06, None),
        ("n3", "near clouds", pad_to_height(L["near-clouds"], H), True, 0.10, None),
        ("n4", "far mountains", pad_to_height(L["far-mountains"], H), True, 0.18, None),
        ("n5", "red cliffs", pad_to_height(L["mountains"], H), True, 0.30, None),
        ("n6", "conifers", pad_to_height(L["trees"], H), True, 0.50, None),
    ]
    return H, layers


# ---------------------------------------------------------------- preview
def preview(H, layers, out, view_w=1200, scale=3, offset=0):
    """Composite at `scale`x nearest-neighbour into a view_w-wide viewport.
    Tiling layers repeat from x=offset*speed; sprites are centred at their x fraction."""
    W = view_w // scale
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    for _, _, a, tile, speed, xfrac in layers:
        im = Image.fromarray(a, "RGBA")
        t = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        if tile:
            x = -int(offset * speed) % a.shape[1] - a.shape[1]
            while x < W:
                t.paste(im, (x, 0))
                x += a.shape[1]
        else:
            t.paste(im, (int(xfrac * W - a.shape[1] / 2), 0))
        canvas = Image.alpha_composite(canvas, t)
    canvas.resize((W * scale, H * scale), Image.NEAREST).save(out)


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("assets/bg")
    prev_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    manifest = {}
    for mode, builder in (("day", build_day), ("night", build_night)):
        H, layers = builder(src)
        entries = []
        for name, desc, a, tile, speed, xfrac in layers:
            assert a.shape[0] == H
            rel = f"{mode}/{name}.png"
            nbytes = save_png(a, out / rel)
            e = {"file": rel, "name": desc, "w": int(a.shape[1]), "h": int(a.shape[0]),
                 "tile": tile, "speed": speed}
            if not tile:
                e["x"] = xfrac
                e["anchor"] = "center-bottom"
            entries.append(e)
            seam = seam_score(a) if tile else None
            print(f"{rel:16s} {a.shape[1]:4d}x{a.shape[0]:<4d} {nbytes:7d} B  {desc}"
                  + (f"  seam={seam}" if seam else ""))
        manifest[mode] = {"height": H, "layers": entries}
        if prev_dir:
            preview(H, layers, prev_dir / f"prep_{mode}.png")
    (out / "layers.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
