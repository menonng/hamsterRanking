// 빌드 후 실행: 파일 내용 해시로 ?v= 캐시 무효화 값을 자동으로 붙인다.
// (ES 모듈이 import하는 common.js도 따로 캐시되므로 import 경로에도 해시를 붙인다.)
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const [html, entry] = process.argv.slice(2);
const hash = (file) => createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 10);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const entryPath = `assets/${entry}.js`;
const js = readFileSync(entryPath, "utf8").replace(
  /(from\s+["']\.\/common\.js)(\?v=\w+)?(["'])/g,
  `$1?v=${hash("assets/common.js")}$3`,
);
writeFileSync(entryPath, js);

let page = readFileSync(html, "utf8");
for (const file of ["assets/style.css", entryPath]) {
  page = page.replace(new RegExp(`(\\./${escape(file)})(\\?v=\\w+)?`, "g"), `$1?v=${hash(file)}`);
}
// 배포 식별값(build id): 화면 코드·스타일·트로피 그림이 바뀌면 달라진다. HTML의 <meta name="build-id">와
// assets/build.json에 같이 써 두면, 열려 있는 화면이 build.json을 주기적으로 확인해 새 배포를 알아채고 새로고침한다.
const trophyFiles = ["assets/trophy", "assets/trophy/pixel"]
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => readdirSync(dir).filter((f) => /\.(svg|png|json)$/.test(f)).map((f) => `${dir}/${f}`))
  .sort();
const build = createHash("sha1");
for (const file of ["assets/style.css", entryPath, "assets/common.js", ...trophyFiles]) {
  if (existsSync(file)) build.update(readFileSync(file));
}
const buildId = build.digest("hex").slice(0, 10);
const meta = `<meta name="build-id" content="${buildId}" />`;
page = /<meta name="build-id"[^>]*>/.test(page)
  ? page.replace(/<meta name="build-id"[^>]*>/, meta)
  : page.replace(/(<meta charset="[^"]*" \/>)/, `$1\n${meta}`);
writeFileSync(html, page);
writeFileSync("assets/build.json", JSON.stringify({ build: buildId }) + "\n");
console.log(`stamped ${html} (build ${buildId})`);
