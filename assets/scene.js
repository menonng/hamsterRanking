// 프로토타입 스킨 "nature": 인디 게임풍 픽셀 자연 배경(패럴랙스)을 화면 뒤에 깐다. 주소에 ?skin=nature 를 붙였을 때만 켜진다.
// 배경 그림: Luis Zuno(@ansimuz) CC0 팩 — assets/bg/LICENSE.txt. 라이트 모드 = 낮(Countryside), 다크 모드 = 밤(Mountain Dusk).
const SKIN_PARAM = new URLSearchParams(location.search).get("skin");
export const NATURE_SKIN = SKIN_PARAM === "nature";
let data = null;
let root = null;
let layerEls = [];
let builtFor = "";
function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function lowPerf() {
    return document.documentElement.classList.contains("lite");
}
/** 첫 레이어의 맨 윗줄 색 = 하늘 색. 화면이 그림보다 높으면 위쪽 빈 곳을 이 색으로 채운다. */
function sampleTopColor(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const c = document.createElement("canvas");
                c.width = 1;
                c.height = 1;
                const ctx = c.getContext("2d");
                ctx?.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
                const d = ctx?.getImageData(0, 0, 1, 1).data;
                resolve(d ? `rgb(${d[0]}, ${d[1]}, ${d[2]})` : "#000");
            }
            catch {
                resolve("#000");
            }
        };
        img.onerror = () => resolve("#000");
        img.src = src;
    });
}
async function build() {
    if (!data || !root)
        return;
    const mode = document.documentElement.getAttribute("data-theme") === "dark" ? "night" : "day";
    const set = data[mode];
    const key = `${mode}|${window.innerWidth}x${window.innerHeight}`;
    if (!set || key === builtFor)
        return;
    builtFor = key;
    // 화면 높이에 맞는 정수 배율(픽셀이 뭉개지지 않게 정수로만 키운다)
    const scale = Math.max(2, Math.round(window.innerHeight / set.height));
    const base = "./assets/bg/";
    root.style.background = await sampleTopColor(base + (set.layers[0]?.file ?? ""));
    root.replaceChildren();
    layerEls = [];
    const animate = !reducedMotion() && !lowPerf();
    for (const layer of set.layers) {
        const w = layer.w * scale;
        const h = layer.h * scale;
        const el = document.createElement("div");
        el.className = "scene-layer";
        el.style.height = `${h}px`;
        if (layer.tile) {
            // 한 장 너비만큼 더 넓게 깔고 transform으로 흘려 보내면, 다시 그리지 않고 합성만으로 움직인다.
            el.style.width = `calc(100vw + ${w}px)`;
            el.style.backgroundImage = `url("${base}${layer.file}")`;
            el.style.backgroundSize = `${w}px ${h}px`;
            if (animate && layer.drift) {
                const inner = el;
                inner.style.setProperty("--tile", `${-w}px`);
                inner.style.animation = `sceneDrift ${(layer.w / layer.drift).toFixed(1)}s linear infinite`;
            }
        }
        else {
            el.style.width = `${w}px`;
            el.style.left = `calc(${((layer.x ?? 0.5) * 100).toFixed(1)}vw - ${w / 2}px)`;
            el.style.backgroundImage = `url("${base}${layer.file}")`;
            el.style.backgroundSize = `${w}px ${h}px`;
        }
        const wrap = document.createElement("div");
        wrap.className = "scene-wrap";
        wrap.appendChild(el);
        root.appendChild(wrap);
        layerEls.push({ el: wrap, speed: layer.speed });
    }
    onScroll();
}
let ticking = false;
function onScroll() {
    if (ticking || reducedMotion() || lowPerf())
        return;
    ticking = true;
    requestAnimationFrame(() => {
        ticking = false;
        // 페이지를 내리면 앞쪽 레이어일수록 더 위로 밀려 깊이감이 생긴다(최대 화면 높이의 1/4까지).
        const y = Math.min(window.scrollY, window.innerHeight * 2);
        for (const { el, speed } of layerEls)
            el.style.transform = `translate3d(0, ${(-y * speed * 0.25).toFixed(1)}px, 0)`;
    });
}
/** ?skin=nature 일 때 배경 장면을 만든다. 테마(낮/밤)나 창 크기가 바뀌면 다시 깐다. */
export function initNatureScene() {
    if (!NATURE_SKIN)
        return;
    document.documentElement.classList.add("skin-nature");
    root = document.createElement("div");
    root.className = "scene";
    root.setAttribute("aria-hidden", "true");
    document.body.prepend(root);
    const build_ = () => void build();
    fetch(`./assets/bg/layers.json?v=${document.querySelector('meta[name="build-id"]')?.content ?? ""}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => {
        data = d;
        build_();
    })
        .catch(() => undefined);
    new MutationObserver(build_).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(build_, 200);
    });
    window.addEventListener("scroll", onScroll, { passive: true });
}
//# sourceMappingURL=scene.js.map