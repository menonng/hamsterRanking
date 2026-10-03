"""픽셀 아트 트로피 생성기 (개발용, 결과물만 커밋한다).

21×24칸 실루엣을 부위별로 직접 그리고(테두리·입구·컵·손잡이·기둥·매듭·받침대), 빛이 왼쪽 위에서 온다고 보고
부위마다 픽셀 아트식 명암 규칙으로 금속 6단계 색을 칠한다.
  - 컵·기둥·받침대: 원통 음영(왼쪽 반사띠 → 중간 → 오른쪽 그림자, 맨 오른쪽 가장자리는 반사광)
  - 테두리: 앞쪽 립은 밝게, 입구 안쪽은 어둡게(빛을 받는 오른쪽 안벽만 조금 밝게)
  - 손잡이: 관처럼 위·왼쪽 면은 밝게, 아래·오른쪽 면은 어둡게
  - 겹치는 곳(테두리 아래, 컵 바닥 아래, 받침대 단 사이)은 접촉 그림자
  - 외곽선: 빛 쪽(위·왼쪽)은 한 단계 밝은 진한 색, 그림자 쪽은 가장 진한 색(selective outline)

    python3 scripts/pixel_trophy.py
    → assets/trophy/pixel/{gold,silver,bronze}.svg       (화면 표시용)
    → assets/trophy/pixel/{gold,silver,bronze}-neon.svg  (다크 모드용: 검정·네온·흰색 고대비)
    → assets/trophy/pixel/pixels.json                    (파괴 연출용 픽셀 격자)
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "trophy" / "pixel"

# 부위 지도(21×24). R 테두리, I 입구 안쪽, C 컵, H 손잡이, S 기둥, K 매듭, T 받침대 윗면, F 받침대 앞면
SHAPE = [
    "....RRRRRRRRRRRRR....",
    "...RIIIIIIIIIIIIIR...",
    "...RRRRRRRRRRRRRRR...",
    "HHHCCCCCCCCCCCCCCCHHH",
    "H..CCCCCCCCCCCCCCC..H",
    "H..CCCCCCCCCCCCCCC..H",
    "HH.CCCCCCCCCCCCCCC.HH",
    ".HHHCCCCCCCCCCCCCHHH.",
    "....CCCCCCCCCCCCC....",
    ".....CCCCCCCCCCC.....",
    "......CCCCCCCCC......",
    ".......CCCCCCC.......",
    "........CCCCC........",
    ".........SSS.........",
    ".........SSS.........",
    "........KKKKK........",
    ".........SSS.........",
    ".........SSS.........",
    "........SSSSS........",
    ".......TTTTTTT.......",
    ".......FFFFFFF.......",
    ".....TTTTTTTTTTT.....",
    ".....FFFFFFFFFFF.....",
    ".....FFFFFFFFFFF.....",
]

# 금속별 6단계 색(0 가장 어두움 … 5 가장 밝은 반사)과 외곽선, 다크 모드 네온색
METALS = {
    "gold": {
        "ramp": ["#5C3A00", "#9A6300", "#CC8C10", "#EDB52A", "#FFD95C", "#FFF6CF"],
        "edge": "#3A2400",
        "neon": "#FFCC11",
    },
    "silver": {
        "ramp": ["#2E3440", "#5F6B7C", "#8E9AAB", "#BAC4D1", "#DDE4EC", "#FFFFFF"],
        "edge": "#1C2028",
        "neon": "#39C5BB",
    },
    "bronze": {
        "ramp": ["#4A2410", "#7E4220", "#A8602F", "#CB8150", "#E9A97B", "#FFE1C8"],
        "edge": "#2E1608",
        "neon": "#FF7E00",
    },
}

W, H = len(SHAPE[0]), len(SHAPE)
assert all(len(r) == W for r in SHAPE), "모든 줄의 길이가 같아야 한다"


def at(x, y):
    return SHAPE[y][x] if 0 <= x < W and 0 <= y < H else "."


def run_extent(x, y):
    """같은 줄에서 (x, y)가 속한 부위가 이어진 좌우 끝."""
    part = at(x, y)
    group = "RI" if part in "RI" else part
    a = x
    while at(a - 1, y) in group:
        a -= 1
    b = x
    while at(b + 1, y) in group:
        b += 1
    return a, b


def cylinder_tone(x, y):
    """원통 음영: 왼쪽 반사띠가 가장 밝고 오른쪽으로 갈수록 어두워지며, 맨 오른쪽 끝은 반사광으로 조금 밝다."""
    a, b = run_extent(x, y)
    center = (a + b) / 2
    half = (b - a) / 2 + 0.5
    u = (x - center) / half
    if u < -0.78:
        return 2
    if u < -0.5:
        return 4
    if u < -0.22:
        return 5
    if u < 0.18:
        return 3
    if u < 0.62:
        return 2
    if u < 0.86:
        return 1
    return 2


def tone(x, y):
    part = at(x, y)
    if part == "C":
        t = cylinder_tone(x, y)
        if y == 3 and t < 5:  # 테두리 바로 아래: 립이 드리운 그림자
            t -= 1
        if y >= 10:  # 컵 바닥으로 말려 들어가는 곳은 한 단계 어둡게
            t -= 1
        return t
    if part == "R":
        t = cylinder_tone(x, y)
        return min(5, t + 1) if y == 2 else max(2, t)  # 앞쪽 립은 빛을 더 받는다
    if part == "I":  # 입구 안쪽: 어둡고, 빛을 받는 오른쪽 안벽만 조금 밝다
        a, b = run_extent(x, y)
        u = (x - (a + b) / 2) / ((b - a) / 2 + 0.5)
        return 0 if u < -0.2 else (1 if u < 0.35 else 2)
    if part == "H":  # 관: 위·왼쪽 면은 밝게, 아래·오른쪽 면은 어둡게
        up, left = at(x, y - 1) != "H", at(x - 1, y) != "H"
        down, right = at(x, y + 1) != "H", at(x + 1, y) != "H"
        if up and not down:
            return 4
        if left and not right and x < W // 2:
            return 4
        if down and not up:
            return 1
        if right and not left and x > W // 2:
            return 1
        return 3
    if part in "SK":
        t = cylinder_tone(x, y)
        if part == "K":
            t = min(5, t + 1)  # 매듭은 볼록해서 빛을 더 받는다
        if at(x, y - 1) == "C":  # 컵 바로 아래 접촉 그림자
            t -= 1
        return t
    if part == "T":
        t = min(5, cylinder_tone(x, y) + 1)  # 윗면은 위에서 빛을 받아 밝다
        if at(x, y - 1) == "F":  # 위 단 바로 아래(앞면이 놓인 자리)는 접촉 그림자
            t = 1
        return t
    if part == "F":
        t = cylinder_tone(x, y)
        if y == H - 1:
            t -= 1  # 맨 아랫줄은 바닥 쪽이라 어둡게
        return t
    raise ValueError(part)


def build(metal):
    ramp, edge = metal["ramp"], metal["edge"]
    # 팔레트: 0~5 금속 단계, 6 빛 쪽 외곽선, 7 그림자 쪽 외곽선, 8 손잡이 구멍(항상 어둡게, 네온 아님)
    palette = ramp + [ramp[0], edge, edge]
    pw, ph = W + 2, H + 2
    grid = [[-1] * pw for _ in range(ph)]
    for y in range(H):
        for x in range(W):
            if at(x, y) != ".":
                grid[y + 1][x + 1] = max(0, min(5, tone(x, y)))

    def filled(x, y):
        return 0 <= x < pw and 0 <= y < ph and 0 <= grid[y][x] <= 5

    # 바깥과 이어진 빈칸(손잡이 구멍처럼 갇힌 빈칸은 제외)
    outside = set()
    stack = [(0, 0)]
    while stack:
        x, y = stack.pop()
        if (x, y) in outside or not (0 <= x < pw and 0 <= y < ph) or grid[y][x] != -1:
            continue
        outside.add((x, y))
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]

    # 외곽선: 그림에 맞닿은 바깥 빈칸. 그림이 아래·오른쪽에만 있으면(=빛 쪽 외곽) 6, 아니면 7.
    # 손잡이 구멍은 통째로 어두운 8(다크 모드에서도 네온으로 칠하지 않는다).
    edges = []
    for y in range(ph):
        for x in range(pw):
            if grid[y][x] != -1:
                continue
            if (x, y) not in outside:
                edges.append((x, y, 8))
            elif any(filled(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                lit = (filled(x, y + 1) or filled(x + 1, y)) and not (filled(x, y - 1) or filled(x - 1, y))
                edges.append((x, y, 6 if lit else 7))
    for x, y, c in edges:
        grid[y][x] = c
    rows = ["".join("." if v < 0 else "0123456789abcdef"[v] for v in row) for row in grid]
    return {"w": pw, "h": ph, "palette": palette, "hc": high_contrast(metal["neon"]), "rows": rows, "outline": [6, 7], "neon": metal["neon"]}


def mix(hex_color, amount):
    """hex_color를 검정과 섞는다(amount = 원래 색 비율)."""
    r, g, b = (int(hex_color[i : i + 2], 16) for i in (1, 3, 5))
    return "#%02X%02X%02X" % (round(r * amount), round(g * amount), round(b * amount))


def high_contrast(neon):
    """다크 모드용 고대비 팔레트: 검정 바탕 위에 네온과 흰색만으로 명암을 표현한다(번짐 없이 또렷하게).
    0~1 그림자 → 검정, 2~3 중간 → 어두운 네온, 4 빛 받는 면 → 네온, 5 반사띠 → 흰색, 외곽선 → 네온, 구멍 → 검정."""
    return ["#000000", "#000000", mix(neon, 0.28), mix(neon, 0.5), neon, "#FFFFFF", neon, neon, "#000000"]


def to_svg(sprite, neon=False):
    """색마다 가로로 이어진 칸을 하나의 경로로 합친 픽셀 SVG. neon=True면 고대비 네온 팔레트로(다크 모드용)."""
    paths = []
    for ci, color in enumerate(sprite["hc"] if neon else sprite["palette"]):
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
        + "\n".join(paths)
        + "\n</svg>\n"
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    data = {}
    for name, metal in METALS.items():
        sprite = build(metal)
        data[f"{name}.svg"] = sprite
        (OUT / f"{name}.svg").write_text(to_svg(sprite), encoding="utf-8")
        (OUT / f"{name}-neon.svg").write_text(to_svg(sprite, neon=True), encoding="utf-8")
        print(f"{name}: {sprite['w']}×{sprite['h']} 칸")
    (OUT / "pixels.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
