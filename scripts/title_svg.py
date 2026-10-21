"""HAMSTER 타이틀 SVG 생성기 (pyfiglet ANSI Shadow 글꼴 기반, 결과는 index.html에 직접 들어간다).

글자 면(█)은 칸 그대로, 그림자는 원래 선 문자(╔═╗║…)가 그리던 윤곽 안쪽을 꽉 채운 모양
= 글자 면을 오른쪽 아래로 반 칸 민 영역에서 글자 면을 뺀 부분으로 그린다.

    python3 scripts/title_svg.py   → index.html의 <svg class="brand-ascii"> 내용 교체
"""
import re
from pathlib import Path

import pyfiglet

CW, CH = 4, 12  # 한 글자 칸(가로:세로 = 1:3)
HX, HY = CW // 2, CH // 2  # 그림자 이동량(반 칸)

lines = pyfiglet.Figlet(font="ansi_shadow").renderText("HAMSTER").split("\n")
while lines and not lines[-1].strip():
    lines.pop()
W = max(map(len, lines))
lines = [l.ljust(W) for l in lines]

# 반 칸 단위 격자에서 글자 면과 그림자 칸을 구한다.
GW, GH = W * 2 + 1, len(lines) * 2 + 1
face = {(c * 2 + dx, r * 2 + dy) for r, l in enumerate(lines) for c, ch in enumerate(l) if ch == "█" for dx in (0, 1) for dy in (0, 1)}
shadow = {(x + 1, y + 1) for x, y in face} - face


def to_path(cells):
    rects = []
    for y in range(GH):
        x = 0
        while x < GW:
            if (x, y) in cells:
                s = x
                while (x, y) in cells:
                    x += 1
                rects.append([s, y, x - s, 1])
            else:
                x += 1
    rects.sort(key=lambda t: (t[0], t[2], t[1]))
    out = []
    for x, y, w, h in rects:
        if out and out[-1][0] == x and out[-1][2] == w and out[-1][1] + out[-1][3] == y:
            out[-1][3] += h
        else:
            out.append([x, y, w, h])
    return "".join(f"M{x * HX} {y * HY}h{w * HX}v{h * HY}h-{w * HX}z" for x, y, w, h in out)


vw, vh = GW * HX, GH * HY
page = Path(__file__).resolve().parent.parent / "index.html"
html = page.read_text(encoding="utf-8")
a = html.index('<svg class="brand-ascii"')
b = html.index("</svg>", a) + len("</svg>")
head = re.sub(r'viewBox="[^"]*"', f'viewBox="-0.1 -0.1 {vw + 0.2:.1f} {vh + 0.2:.1f}"', html[a : html.index(">", a) + 1])
svg = f'{head}\n  <path class="t-shadow" d="{to_path(shadow)}"/>\n  <path class="t-face" d="{to_path(face)}"/>\n</svg>'
page.write_text(html[:a] + svg + html[b:], encoding="utf-8")
print(f"title {vw}×{vh}")
