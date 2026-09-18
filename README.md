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

기록 입력 형식(`학교,학년,나이,이름,기록(초),태그`)과 사용법은 [hamsteradmin 저장소](https://github.com/menonng/hamsteradmin)의 README를 참고하세요.

## 랭킹 화면 규칙

- 1~3위: 화려한 시상대 박스(메달 아이콘), 등장 애니메이션
- 4~10위: 색상이 구분된 카드 안 리스트
- 11위 이하: 별도 박스, 스크롤해야 보임 (첫 화면에는 10위까지만 노출)
- 인공지능(태그=1) 기록은 이름 옆에 🤖 AI 배지 표시
- 모바일에서는 시상대가 세로로 쌓이고 리스트도 반응형으로 재배치됨

## 실시간 동기화 원리

1. **부스 운영 기기(hamsteradmin)**: 기록을 추가/삭제하면 이 저장소의 `data/records.json`, `data/records.txt`에
   GitHub API로 직접 커밋합니다. 쓰기 권한이 있는 fine-grained PAT을 가진 기기만 이 커밋을 만들 수 있습니다.
2. **공개 랭킹 화면(이 저장소)**: `index.html`이 8초 간격으로 `data/records.json`을 폴링해 최신 데이터를 반영합니다.
   push 후 GitHub Pages가 재배포되기까지 보통 수십 초 걸립니다.

## GitHub Pages 배포

`.github/workflows/deploy-pages.yml`이 push마다 저장소 루트를 GitHub Pages로 자동 배포합니다
(Settings → Pages → Source를 최초 1회 "GitHub Actions"로 지정해야 할 수 있습니다. 워크플로가 실행되면
Actions 탭에서 배포 URL을 확인할 수 있습니다).

## 개발

```bash
npm install
npm run build     # src/*.ts → assets/*.js 컴파일
npm run watch     # 변경 감지 자동 빌드
```

정적 파일만 제공하면 되므로 아무 정적 서버로 로컬 확인이 가능합니다.

```bash
python3 -m http.server 8000
```
