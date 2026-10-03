"""픽셀 아트 트로피 생성기 (개발용, 결과물만 커밋한다).

현재 트로피(primitive 도형 그림)를 Pyxelate(https://github.com/sedthh/pyxelate, MIT,
© 2021 Richard Nagyfi)로 21×24 픽셀·소수 색 팔레트의 픽셀 아트로 줄인 뒤,
픽셀 아트답게 다듬는다(외톨이 점 정리, 별 색 보정, 1픽셀 진한 외곽선).

    # 1) 원본 트로피를 416×480으로 렌더링한 PNG 준비: pix/src_{gold,silver,bronze}.png
    # 2) PYTHONPATH=<pyxelate 소스 경로> python3 scripts/pixel_trophy.py <src 디렉터리>
    #    → assets/trophy/pixel/{gold,silver,bronze}.svg       (화면 표시용, 칸마다 rect)
    #    → assets/trophy/pixel/{gold,silver,bronze}-neon.svg  (다크 모드용: 외곽선 네온색)
    #    → assets/trophy/pixel/pixels.json               (파괴 연출용 픽셀 격자)

필요: pyxelate 소스, scikit-learn, scikit-image, numba
"""
import colorsys
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from pyxelate import Pyx
from skimage import io

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "trophy" / "pixel"
NAMES = ["gold", "silver", "bronze"]
GRID_W, GRID_H = 21, 24  # 416×480 → 21×24 칸(한 칸이 예전 32×36 칸의 가로세로 1.5배)
# 트로피별 (대비 배율, 밝기 이동, 팔레트 색 수). 은은 원본이 밝은 회색 위주라 대비를 키워야 음영이 남는다.
SETTINGS = {"gold": (1.0, 0, 7), "silver": (1.6, -20, 6), "bronze": (1.0, 0, 7)}
# 다크 모드용 네온 외곽선 색(지정 팔레트: 노랑·하늘·주황)
NEON = {"gold": "#FFCC11", "silver": "#39C5BB", "bronze": "#FF7E00"}
STAR_TINT = {"gold": None, "silver": (255, 255, 255), "bronze": None}


def neighbors_majority(grid, y, x):
    h, w = grid.shape
    votes = Counter()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if (dy or dx) and 0 <= y + dy < h and 0 <= x + dx < w and grid[y + dy, x + dx] >= 0:
                votes[grid[y + dy, x + dx]] += 1
    return votes.most_common(1)[0][0] if votes else -1


def clean(grid, colors, min_count=4):
    """몇 칸 안 되는 색(가장자리 흰 테두리 등에서 생긴 얼룩)과 외톨이 칸을 주변 다수 색으로 바꾼다."""
    for _ in range(3):
        counts = Counter(grid[grid >= 0].tolist())
        h, w = grid.shape
        changed = False
        for y in range(h):
            for x in range(w):
                c = grid[y, x]
                if c < 0:
                    continue
                same = sum(
                    1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1))
                    if 0 <= y + dy < h and 0 <= x + dx < w and grid[y + dy, x + dx] == c
                )
                if counts[c] < min_count or same == 0:
                    m = neighbors_majority(grid, y, x)
                    if m >= 0 and m != c:
                        grid[y, x] = m
                        changed = True
        if not changed:
            break
    return grid


def build(name, src_dir, star_mask):
    src = io.imread(src_dir / f"src_{name}.png").astype(float)
    contrast, shift, palette_size = SETTINGS[name]
    rgb, alpha = src[..., :3], src[..., 3:]
    mean = rgb[alpha[..., 0] > 127].mean(axis=0)
    rgb = np.clip((rgb - mean) * contrast + mean + shift, 0, 255)
    img = np.concatenate([rgb, alpha], axis=-1).astype(np.uint8)
    out = Pyx(width=GRID_W, height=GRID_H, palette=palette_size, dither="none", alpha=0.6).fit_transform(img)
    h, w = out.shape[:2]
    opaque = out[..., 3] > 127
    colors = sorted({tuple(int(v) for v in out[y, x, :3]) for y in range(h) for x in range(w) if opaque[y, x]})
    index = {c: i for i, c in enumerate(colors)}
    grid = np.full((h, w), -1, dtype=int)
    for y in range(h):
        for x in range(w):
            if opaque[y, x]:
                grid[y, x] = index[tuple(int(v) for v in out[y, x, :3])]

    # 별: 채도 낮은 밝은 회색으로 뭉개진 별을 그 금속의 크림색으로 되돌린다. 세 트로피는 모양이 같으므로
    # 금에서 찾은 별 위치(star_mask)를 은·동에도 똑같이 찍는다(은은 몸통과 별이 같은 흰색이라 저절로는 안 보인다).
    lightest = max(colors, key=lambda c: sum(c) if colorsys.rgb_to_hsv(*(v / 255 for v in c))[1] > 0.25 else sum(c) / 10)
    star = STAR_TINT[name] or tuple(round(v + (255 - v) * 0.55) for v in lightest)
    star_cells = set()
    if star_mask is None:
        for y in range(h):
            for x in range(w):
                if grid[y, x] >= 0:
                    _, s, v = colorsys.rgb_to_hsv(*(t / 255 for t in colors[grid[y, x]]))
                    if s < 0.15 and v > 0.75:
                        star_cells.add((y, x))
    else:
        star_cells = {(y, x) for y, x in star_mask if grid[y, x] >= 0}
    colors.append(star)
    si = len(colors) - 1
    grid = clean(grid, colors)
    for y, x in star_cells:
        grid[y, x] = si

    # 1픽셀 진한 외곽선(가장 어두운 색을 더 어둡게) — 사방에 1칸 여백을 두고 그린다.
    used = sorted(set(grid[grid >= 0].tolist()) - {si})
    darkest = min((colors[i] for i in used), key=sum)
    outline = tuple(round(v * 0.5) for v in darkest)
    colors.append(outline)
    oi = len(colors) - 1
    padded = np.full((h + 2, w + 2), -1, dtype=int)
    padded[1:-1, 1:-1] = grid
    ph, pw = padded.shape
    edge = [
        (y, x)
        for y in range(ph)
        for x in range(pw)
        if padded[y, x] < 0
        and any(0 <= y + dy < ph and 0 <= x + dx < pw and 0 <= padded[y + dy, x + dx] != oi
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    ]
    for y, x in edge:
        padded[y, x] = oi

    # 실제로 쓰인 색만 남겨 번호를 다시 매긴다.
    used = sorted(set(padded[padded >= 0].tolist()))
    remap = {old: new for new, old in enumerate(used)}
    palette = ["#%02X%02X%02X" % colors[i] for i in used]
    rows = ["".join("." if v < 0 else "0123456789abcdef"[remap[v]] for v in row) for row in padded.tolist()]
    return {"w": pw, "h": ph, "palette": palette, "rows": rows, "outline": remap[oi], "neon": NEON[name]}, star_cells


def to_svg(sprite, neon=False):
    """색마다 가로로 이어진 칸을 하나의 rect 경로로 합친 픽셀 SVG. neon=True면 외곽선을 네온색으로(다크 모드용)."""
    paths = []
    for ci, color in enumerate(sprite["palette"]):
        if neon and ci == sprite["outline"]:
            color = sprite["neon"]
        key = "0123456789abcdef"[ci]
        d = []
        for y, row in enumerate(sprite["rows"]):
            x = 0
            while x < len(row):
                if row[x] == key:
                    s = x
                    while x < len(row) and row[x] == key:
                        x += 1
                    d.append(f"M{s} {y}h{x - s}v1h-{x - s}z")
                else:
                    x += 1
        if d:
            paths.append(f'<path fill="{color}" d="{"".join(d)}"/>')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {sprite["w"]} {sprite["h"]}" '
        f'width="{sprite["w"] * 8}" height="{sprite["h"] * 8}" shape-rendering="crispEdges">\n'
        "<!-- Pyxelate(MIT)로 픽셀화한 트로피 -->\n" + "\n".join(paths) + "\n</svg>\n"
    )


def main():
    src_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("pix")
    OUT.mkdir(parents=True, exist_ok=True)
    data = {}
    star_mask = None
    for name in NAMES:  # 금을 먼저 만들어 별 위치를 얻는다
        sprite, cells = build(name, src_dir, star_mask)
        star_mask = star_mask or cells
        data[f"{name}.svg"] = sprite
        (OUT / f"{name}.svg").write_text(to_svg(sprite), encoding="utf-8")
        (OUT / f"{name}-neon.svg").write_text(to_svg(sprite, neon=True), encoding="utf-8")
        filled = sum(ch != "." for row in sprite["rows"] for ch in row)
        print(f"{name}: {sprite['w']}×{sprite['h']} 칸, {len(sprite['palette'])}색, 채운 칸 {filled}개")
    (OUT / "pixels.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
