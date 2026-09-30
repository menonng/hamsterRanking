"""트로피 파편 데이터 생성기 (개발용, 결과물만 커밋한다).

primitive로 만든 트로피 SVG는 반투명 삼각형을 순서대로 겹쳐 그린 그림이다. 부서질 때 파편이
"그 트로피를 그린 도형" 그대로 보이도록, 각 도형이 최종 그림에서 실제로 보이는 영역
(= 트로피 윤곽 안쪽 ∩ 그 도형 − 나중에 덮어 그린 도형들)을 계산하고, 서로 맞닿은 영역을
2~3개씩 묶어 파편 하나로 만든다. 모든 파편을 합치면 정확히 원래 트로피가 된다.

    python3 scripts/trophy_fragments.py   →  assets/trophy/fragments.json

필요: shapely (pip install shapely)
"""
import json
import random
import re
from pathlib import Path

from shapely import affinity
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
TROPHY_DIR = ROOT / "assets" / "trophy"
FILES = ["gold.svg", "silver.svg", "bronze.svg"]
SEED = 20260930


def flatten_path(d: str, steps: int = 24) -> Polygon:
    """M/L/H/V/C/Z(절대 좌표)만 쓰는 윤곽 경로를 다각형으로 펼친다."""
    tokens = re.findall(r"[MLHVCZmlhvcz]|-?\d*\.?\d+", d)
    pts, i, cmd = [], 0, None
    x = y = 0.0
    while i < len(tokens):
        t = tokens[i]
        if re.match(r"[A-Za-z]", t):
            cmd = t
            i += 1
            if cmd in "Zz":
                continue
        if cmd == "M" or cmd == "L":
            x, y = float(tokens[i]), float(tokens[i + 1])
            i += 2
            pts.append((x, y))
        elif cmd == "H":
            x = float(tokens[i])
            i += 1
            pts.append((x, y))
        elif cmd == "V":
            y = float(tokens[i])
            i += 1
            pts.append((x, y))
        elif cmd == "C":
            x1, y1, x2, y2, x3, y3 = map(float, tokens[i : i + 6])
            i += 6
            for s in range(1, steps + 1):
                u = s / steps
                a = (1 - u) ** 3
                b = 3 * (1 - u) ** 2 * u
                c = 3 * (1 - u) * u**2
                e = u**3
                pts.append((a * x + b * x1 + c * x2 + e * x3, a * y + b * y1 + c * y2 + e * y3))
            x, y = x3, y3
        else:
            raise ValueError(f"지원하지 않는 경로 명령: {cmd}")
    return Polygon(pts).buffer(0)


def rounded_rect(x: float, y: float, w: float, h: float, rx: float) -> Polygon:
    r = min(rx, w / 2, h / 2)
    return box(x + r, y + r, x + w - r, y + h - r).buffer(r, quad_segs=6) if r > 0 else box(x, y, x + w, y + h)


def parse(svg: str):
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
    clip = re.search(r"<clipPath[^>]*>(.*?)</clipPath>", svg, re.S).group(1)
    shapes = []
    for m in re.finditer(r"<(path|rect)([^>]*)/>", clip):
        tag, attrs = m.group(1), dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(2)))
        if tag == "path":
            g = flatten_path(attrs["d"])
        else:
            g = rounded_rect(*(float(attrs.get(k, 0)) for k in ("x", "y", "width", "height", "rx")))
        tf = attrs.get("transform", "")
        tm = re.search(r"translate\(([-\d.]+)[ ,]+([-\d.]+)\)", tf)
        sm = re.search(r"scale\(([-\d.]+)[ ,]+([-\d.]+)\)", tf)
        if sm:
            g = affinity.scale(g, float(sm.group(1)), float(sm.group(2)), origin=(0, 0))
        if tm:
            g = affinity.translate(g, float(tm.group(1)), float(tm.group(2)))
        shapes.append(g)
    silhouette = unary_union(shapes)
    gm = re.search(r'<g clip-path="url\(#t\)"(?: transform="translate\(([-\d.]+) ([-\d.]+)\)")?>', svg)
    ox, oy = float(gm.group(1) or 0), float(gm.group(2) or 0)
    tris = []
    for m in re.finditer(r'<polygon[^>]*points="([^"]+)"', svg):
        pts = [tuple(float(v) for v in p.split(",")) for p in m.group(1).split()]
        tris.append(Polygon([(px + ox, py + oy) for px, py in pts]))
    return vb, silhouette, tris


def polys_of(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, (MultiPolygon, GeometryCollection)):
        return [p for sub in g.geoms for p in polys_of(sub)]
    return []


def to_path(g) -> str:
    out = []
    for p in polys_of(g):
        for ring in [p.exterior, *p.interiors]:
            coords = list(ring.coords)[:-1]
            if len(coords) < 3:
                continue
            # "M x y x y …Z" (M 뒤 좌표는 자동으로 직선) — 파일 크기를 줄이려고 L을 생략한다.
            out.append("M" + " ".join(f"{x:.1f} {y:.1f}" for x, y in coords) + "Z")
    return "".join(out)


def build(file: str, rng: random.Random):
    vb, silhouette, tris = parse((TROPHY_DIR / file).read_text(encoding="utf-8"))

    # 위(나중에 그린 도형)부터 내려오며, 아직 덮이지 않은 부분만 그 도형의 "보이는 영역"으로 가진다.
    covered = Polygon()
    regions = []
    for tri in reversed(tris):
        visible = tri.intersection(silhouette).difference(covered)
        covered = covered.union(tri)
        if visible.area > 0.01:
            regions.append(visible.buffer(0))
    regions.reverse()

    # 맞닿은(경계를 공유하는) 영역끼리 이웃으로 본다.
    n = len(regions)
    grown = [r.buffer(0.15) for r in regions]
    neighbors = [dict() for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            if grown[i].intersects(regions[j]):
                shared = grown[i].intersection(regions[j]).area
                if shared > 0.02:
                    neighbors[i][j] = shared
                    neighbors[j][i] = shared

    # 인접 영역을 2~3개씩 묶는다. 이웃이 모두 이미 묶였으면 가장 작은 이웃 묶음에 합류시킨다.
    # 인접 영역을 2~3개씩 묶는다. 남은 이웃이 적은 영역부터 먼저 묶어야 외톨이가 덜 생긴다.
    group_of = [-1] * n
    groups = []
    jitter = [rng.random() for _ in range(n)]

    def free_neighbors(i):
        return [j for j in neighbors[i] if group_of[j] == -1]

    while True:
        pending = [i for i in range(n) if group_of[i] == -1]
        if not pending:
            break
        seed = min(pending, key=lambda i: (len(free_neighbors(i)) or 99, jitter[i]))
        free = free_neighbors(seed)
        if free:
            want = rng.choice([2, 3])
            # 두 번째·세 번째 멤버도 "남은 이웃이 적은" 쪽을 우선해 뒤에 외톨이가 생기지 않게 한다.
            free.sort(key=lambda j: (len(free_neighbors(j)), -neighbors[seed][j]))
            members = [seed] + free[: want - 1]
            gid = len(groups)
            groups.append(members)
            for m in members:
                group_of[m] = gid
            continue
        # 이웃이 모두 이미 묶였으면 아직 2개짜리인 이웃 묶음에 합류(→ 3개). 그마저 없으면 홀로 남는다.
        joinable = [group_of[j] for j in neighbors[seed] if len(groups[group_of[j]]) < 3]
        if joinable:
            best = max(joinable, key=lambda g: sum(neighbors[seed].get(m, 0) for m in groups[g]))
            groups[best].append(seed)
            group_of[seed] = best
        else:
            group_of[seed] = len(groups)
            groups.append([seed])

    frags = []
    for members in groups:
        geom = unary_union([regions[m] for m in members]).simplify(0.12)
        if geom.area < 0.05:
            continue
        c = geom.centroid
        frags.append({"d": to_path(geom), "c": [round(c.x, 1), round(c.y, 1)]})

    total = unary_union([regions[i] for i in range(n)]).area
    sizes = {k: sum(1 for g in groups if len(g) == k) for k in (1, 2, 3)}
    print(f"{file}: 도형 {len(tris)}개 → 보이는 영역 {n}개 → 파편 {len(frags)}개 "
          f"(묶음 크기별 개수 {sizes}), 덮은 넓이 {total / silhouette.area:.4f}")
    return {"vb": vb, "png": file.replace(".svg", "-frag.png"), "frags": frags}


def main():
    rng = random.Random(SEED)
    data = {f: build(f, rng) for f in FILES}
    out = TROPHY_DIR / "fragments.json"
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"→ {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
