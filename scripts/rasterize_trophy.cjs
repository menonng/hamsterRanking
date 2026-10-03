// 사용: 저장소 루트에서 python3 -m http.server 8123 실행 후
//   node scripts/rasterize_trophy.cjs              → assets/trophy/*-frag.png (도형 트로피 파편 그림, 표시 최대 크기의 2배)
//   node scripts/rasterize_trophy.cjs pixsrc <dir> → <dir>/src_*.png (픽셀 트로피 원본, 모두 416×480)
const { chromium } = require('playwright');
(async () => {
  const pixDir = process.argv[2] === 'pixsrc' ? process.argv[3] : null;
  const b = await chromium.launch({});
  for (const [f, h] of [['gold', 480], ['silver', 360], ['bronze', 260]]) {
    const H = pixDir ? 480 : h;
    const w = Math.round(H * 208 / 240);
    const p = await b.newPage({ viewport: { width: w, height: H } });
    await p.setContent(`<html><body style="margin:0;background:transparent"><img src="http://localhost:8123/assets/trophy/${f}.svg" style="display:block;width:${w}px;height:${H}px"></body></html>`);
    await p.waitForTimeout(500);
    await p.screenshot({ path: pixDir ? `${pixDir}/src_${f}.png` : `assets/trophy/${f}-frag.png`, omitBackground: true });
    await p.close();
  }
  await b.close();
})();
