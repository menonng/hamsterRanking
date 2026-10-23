// 스킨 "nature": 인디 게임풍 픽셀 자연 배경(패럴랙스)과 게임 UI 창 스타일. 상단바 🌲 스위치로 켜고 끈다(이 기기에 기억).
// 주소의 ?skin=nature / ?skin=off 는 저장값보다 우선한다(확인·시연용).
// 배경 그림: Luis Zuno(@ansimuz) CC0 팩 — assets/bg/LICENSE.txt. 라이트 모드 = 낮(Countryside), 다크 모드 = 밤(Mountain Dusk).
const SKIN_KEY = "hamsterRanking_skin";
let enabled = false;
let data = null;
let dataLoading = null;
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
function loadData() {
    dataLoading ?? (dataLoading = fetch(`./assets/bg/layers.json?v=${document.querySelector('meta[name="build-id"]')?.content ?? ""}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => {
        data = d;
    })
        .catch(() => {
        dataLoading = null; // 다음에 다시 시도
    }));
    return dataLoading;
}
async function build() {
    if (!enabled || !data || !root)
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
    const sky = await sampleTopColor(base + (set.layers[0]?.file ?? ""));
    if (!enabled || !root)
        return;
    root.style.background = sky;
    root.replaceChildren();
    layerEls = [];
    const animate = !reducedMotion() && !lowPerf();
    for (const layer of set.layers) {
        const w = layer.w * scale;
        const h = layer.h * scale;
        const el = document.createElement("div");
        el.className = "scene-layer";
        el.style.height = `${h}px`;
        el.style.backgroundImage = `url("${base}${layer.file}")`;
        el.style.backgroundSize = `${w}px ${h}px`;
        if (layer.tile) {
            // 한 장 너비만큼 더 넓게 깔고 transform으로 흘려 보내면, 다시 그리지 않고 합성만으로 움직인다.
            el.style.width = `calc(100vw + ${w}px)`;
            if (animate && layer.drift) {
                el.style.setProperty("--tile", `${-w}px`);
                el.style.animation = `sceneDrift ${(layer.w / layer.drift).toFixed(1)}s linear infinite`;
            }
        }
        else {
            el.style.width = `${w}px`;
            el.style.left = `calc(${((layer.x ?? 0.5) * 100).toFixed(1)}vw - ${w / 2}px)`;
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
    if (!enabled || ticking || reducedMotion() || lowPerf())
        return;
    ticking = true;
    requestAnimationFrame(() => {
        ticking = false;
        // 페이지를 내리면 앞쪽 레이어일수록 더 위로 밀려 깊이감이 생긴다.
        const y = Math.min(window.scrollY, window.innerHeight * 2);
        for (const { el, speed } of layerEls)
            el.style.transform = `translate3d(0, ${(-y * speed * 0.25).toFixed(1)}px, 0)`;
    });
}
function setSkin(on, toggle) {
    enabled = on;
    document.documentElement.classList.toggle("skin-nature", on);
    toggle?.setAttribute("aria-pressed", String(on));
    if (on) {
        if (!root) {
            root = document.createElement("div");
            root.className = "scene";
            root.setAttribute("aria-hidden", "true");
            document.body.prepend(root);
        }
        builtFor = "";
        void loadData().then(() => build());
    }
    else {
        root?.remove();
        root = null;
        layerEls = [];
        builtFor = "";
    }
}
function savedSkin() {
    const q = new URLSearchParams(location.search).get("skin");
    if (q === "nature")
        return true;
    if (q === "off" || q === "none")
        return false;
    try {
        return localStorage.getItem(SKIN_KEY) === "nature";
    }
    catch {
        return false;
    }
}
/** 스킨 스위치를 연결하고, 저장된(또는 주소로 지정한) 상태로 시작한다. 테마(낮/밤)·창 크기가 바뀌면 배경을 다시 깐다. */
export function initNatureScene() {
    const toggle = document.getElementById("skinToggle");
    setSkin(savedSkin(), toggle);
    toggle?.addEventListener("click", () => {
        const next = !enabled;
        try {
            localStorage.setItem(SKIN_KEY, next ? "nature" : "off");
        }
        catch {
            // 저장 불가 시 이번 방문에만 적용
        }
        setSkin(next, toggle);
    });
    new MutationObserver(() => void build()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => void build(), 200);
    });
    window.addEventListener("scroll", onScroll, { passive: true });
}
//# sourceMappingURL=scene.js.map