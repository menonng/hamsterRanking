// 사용: 저장소 루트에서 python3 -m http.server 8123 실행 후 node scripts/rasterize_trophy.cjs
// 트로피 SVG를 표시 최대 크기의 2배 해상도 PNG로 굽는다(파편 그림용).
const { chromium } = require('playwright');
(async()=>{
  const b = await chromium.launch({});
  for (const [f,h] of [['gold',480],['silver',360],['bronze',260]]) {
    const w=Math.round(h*208/240);
    const p=await b.newPage({viewport:{width:w,height:h}});
    await p.setContent(`<html><body style="margin:0;background:transparent"><img src="http://localhost:8123/assets/trophy/${f}.svg" style="display:block;width:${w}px;height:${h}px"></body></html>`);
    await p.waitForTimeout(500);
    await p.screenshot({path:`assets/trophy/${f}-frag.png`,omitBackground:true});
    await p.close();
  }
  await b.close();
})();
