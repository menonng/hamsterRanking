# 🐹 햄스터봇 레이싱 랭킹 시스템

축제 부스(인공지능 vs 사람 햄스터봇 레이싱)에서 쓰는 실시간 랭킹 보드입니다.
GitHub Pages로 열면 누구나 랭킹을 볼 수 있습니다. **이 저장소는 공개(public)이며 랭킹 화면과 데이터만 담고 있습니다.**

기록 입력/삭제 도구(admin.html)는 [menonng/hamsteradmin](https://github.com/menonng/hamsteradmin) **private** 저장소에 따로 있습니다.
공개 저장소 안에 입력 화면을 두면 저장소를 볼 수 있는 누구나 그 존재를 알 수 있기 때문에, 부스 운영 기기 전용 도구는
아예 비공개 저장소로 분리했습니다.

## 구성

| 경로 | 설명 |
|---|---|
| `index.html` | 공개 랭킹 화면. GitHub Pages로 배포해 누구나 열람 |
| `src/*.ts` | TypeScript 소스 (common / ranking) |
| `assets/*.js` | `npm run build`(tsc)로 컴파일된 결과물. Pages는 빌드 단계가 없으므로 반드시 커밋되어 있어야 함 |
| `data/records.json` | 랭킹 원본 데이터 (배열) |
| `data/records.txt` | 사람이 읽기 좋은 기록 로그 |
| `.github/workflows/deploy-pages.yml` | push될 때마다 GitHub Pages에 자동 배포 |

기록 입력 형식(`학교,이름,기록(초),태그`)과 사용법은 [hamsteradmin 저장소](https://github.com/menonng/hamsteradmin)의 README를 참고하세요.

## 랭킹 화면 규칙

- 1~3위: 화려한 시상대 박스(메달 아이콘), 등장 애니메이션
- 4~10위: 지정 팔레트 색(빨강→보라)으로 구분된 카드 안 리스트
- 동점: 같은 순위로 표시(1, 2, 2, 4 …). 시상대에는 "공동 N위" 표시, 선두와 같으면 "선두와 동률"
- 11위 이하: 별도 박스, 스크롤해야 보임 (첫 화면에는 10위까지만 노출)
- 인공지능(태그=1) 기록은 이름 옆에 🤖 AI 배지 표시
- 모바일에서는 시상대가 세로로 쌓이고 리스트도 반응형으로 재배치됨

## 실시간 동기화 원리

1. **부스 운영 기기(hamsteradmin)**: 기록을 추가/삭제하면 이 저장소의 `data/records.json`, `data/records.txt`에
   GitHub API로 직접 커밋합니다. 쓰기 권한이 있는 fine-grained PAT을 가진 기기만 이 커밋을 만들 수 있습니다.
2. **공개 랭킹 화면(이 저장소)**: `index.html`이 8초 간격으로 `data/records.json`을 폴링해 최신 데이터를 반영합니다.
   push 후 GitHub Pages가 재배포되기까지 보통 수십 초 걸립니다.

## GitHub Pages 배포

`.github/workflows/deploy-pages.yml`이 **`claude/gracious-sagan-mzkdnd` 브랜치에** push될 때마다 저장소 루트를 GitHub Pages로 자동 배포합니다.
기록 데이터(admin이 커밋)도 이 브랜치에 쌓이므로, 다른 브랜치는 배포하지 않습니다(다른 브랜치의 오래된 기록으로 사이트가 덮이는 것을 막기 위해)
(Settings → Pages → Source를 최초 1회 "GitHub Actions"로 지정해야 할 수 있습니다. 워크플로가 실행되면
Actions 탭에서 배포 URL을 확인할 수 있습니다).

## 개발

```bash
npm install
npm run build     # src/*.ts → assets/*.js 컴파일 + index.html의 ?v= 캐시 무효화 값 자동 갱신
npm run watch     # 변경 감지 자동 빌드
```

정적 파일만 제공하면 되므로 아무 정적 서버로 로컬 확인이 가능합니다.

```bash
python3 -m http.server 8000
```

## 트로피 단상 (프로토타입)

1~3위 카드의 메달 이모지를 [fogleman/primitive](https://github.com/fogleman/primitive)(MIT, © 2016 Michael Fogleman)로 만든
도형 조합 트로피(`assets/trophy/*.svg`)로 바꿨다. primitive는 저장소에 포함하거나 포크하지 않고, 별도로 실행해 생성한 결과 이미지만 사용한다.
**부서지는 연출**: 트로피 파편은 트로피를 그린 primitive 도형을 기반으로 만든다. 각 도형이 최종 그림에서 실제로 보이는 영역
(트로피 윤곽 ∩ 그 도형 − 나중에 덮어 그린 도형들)을 계산해, 서로 맞닿은 2~3개씩 묶은 것이 파편 하나다. 파편에는 완성된 트로피 그림을
그 모양대로 잘라 입히므로, 모든 파편을 합치면 정확히 원래 트로피가 된다. 이름·기록 박스는 박스 자체(실제 카드 복제본)가 금 간 조각으로 깨진다.
트로피 그림을 바꿨다면 파편 데이터도 다시 만든다:

```bash
pip install shapely
python3 scripts/trophy_fragments.py        # → assets/trophy/fragments.json
python3 -m http.server 8123 &              # 다른 터미널에서
node scripts/rasterize_trophy.cjs          # → assets/trophy/*-frag.png (playwright 필요)
```
그 뒤 `src/ranking.ts`의 `TROPHY_FRAG_VERSION`을 올려 캐시를 무효화한다.

**픽셀 아트 버전**: 주소에 `?trophy=pixel`을 붙이면 트로피가 픽셀 아트로 바뀐다(`?trophy=primitive`는 원래 도형 트로피).
기본값은 `src/ranking.ts`의 `DEFAULT_TROPHY_STYLE`로 정한다. 픽셀 트로피(`assets/trophy/pixel/`)는 지금의 도형 트로피를
[Pyxelate](https://github.com/sedthh/pyxelate)(MIT, © 2021 Richard Nagyfi)로 32×36칸·5~7색으로 줄인 뒤, 외톨이 점 정리·별 색 보정·1픽셀 외곽선을 더한 것이다
(Pyxelate는 저장소에 포함하지 않고 생성할 때만 사용). 부서질 때는 그림을 이루는 픽셀 칸을 맞닿은 2~3칸씩 묶은 조각으로 흩어진다(캔버스로 그려 가볍다).
다시 만들려면:

```bash
git clone https://github.com/sedthh/pyxelate.git /tmp/pyxelate && pip install scikit-learn scikit-image numba
python3 -m http.server 8123 &
node scripts/rasterize_trophy.cjs pixsrc /tmp/pix
PYTHONPATH=/tmp/pyxelate python3 scripts/pixel_trophy.py /tmp/pix   # → assets/trophy/pixel/*.svg, pixels.json
```

이전 모습으로 되돌리려면 `src/ranking.ts`의 `TROPHY_PODIUM`을 `false`로 바꾸고 다시 빌드하거나, 이 기능 커밋 하나를 `git revert` 하면 된다.

**연출 확인용 단축키**: 주소 끝에 `?preview`를 붙여 연 경우에만, `q` / `w` / `e`로 1 / 2 / 3위 카드의 교체 연출을 재생한다
(실제 순위·데이터는 그대로, 한글 입력 상태에서도 동작). 일반 방문자 화면에서는 꺼져 있다.

## 저사양 모드

내장 GPU 구형 노트북이나 몇 년 전 폰에서도 끊기지 않도록, 코어 4개 이하·메모리 4GB 이하·데이터 절약 모드인 기기이거나
파괴 연출이 실제로 25fps 아래로 떨어졌던 기기는 자동으로 저사양 모드(`html.lite`)로 돈다.
저사양 모드에서는 계속 도는 점멸 효과·착지 번쩍임·트로피 그림자를 끈다(트로피 파편은 원래 도형 그대로 유지).
확인용으로 `?lite`(강제 저사양), `?full`(강제 일반)을 주소에 붙일 수 있다.

모든 기기 공통으로: 상단바 배경 흐림 효과 제거, 타이틀을 사각형 1,220개 → 경로 1개로 합침, 트로피 SVG는 미리 한 번만 해석,
화면 밖으로 나간 파편은 즉시 제거, 데이터가 그대로면 다시 그리지 않음, 11위 이하 박스는 화면 밖에서 그리기 생략.
구형 브라우저(Safari 15 등)를 위해 색은 hex로 정의하고, `color-mix` 미지원 브라우저용 대체 색을 둔다.
