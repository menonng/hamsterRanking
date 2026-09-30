// 빌드 후 실행: 파일 내용 해시로 ?v= 캐시 무효화 값을 자동으로 붙인다.
// (ES 모듈이 import하는 common.js도 따로 캐시되므로 import 경로에도 해시를 붙인다.)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

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
writeFileSync(html, page);
console.log(`stamped ${html}`);
