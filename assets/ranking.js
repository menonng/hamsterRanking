// 공개 랭킹 화면 — GitHub Pages로 열람하는 모든 사람이 보는 읽기 전용 화면.
import { formatGap, formatTime, isAIRecord, normalizeRecords, sortRecords } from "./common.js?v=495fa8ccd8";
// GitHub Pages 자체 배포(빌드+CDN 전파)는 최악의 경우 1분 이상 걸릴 수 있어, 배포를
// 기다리지 않고 커밋 직후 거의 바로 갱신되는 raw.githubusercontent.com을 우선 사용한다.
const GH_OWNER = "menonng";
const GH_REPO = "hamsterranking";
const GH_BRANCH = "claude/gracious-sagan-mzkdnd";
const RAW_DATA_URL = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/data/records.json`;
const FALLBACK_DATA_URL = "./data/records.json";
const POLL_INTERVAL_MS = 4000;
// 4~10위 색: 지정 팔레트를 빨강→보라 무지개 순으로. ink는 배지 위 숫자 색(배경 명도에 맞춤).
const ROW_COLORS = [
    { bg: "#FF0045", ink: "#fff" },
    { bg: "#FF7E00", ink: "#241100" },
    { bg: "#FFCC11", ink: "#2a2000" },
    { bg: "#55BB44", ink: "#0c1f08" },
    { bg: "#39C5BB", ink: "#062421" },
    { bg: "#3355BB", ink: "#fff" },
    { bg: "#660099", ink: "#fff" },
];
const MEDAL_COLORS = ["var(--medal-gold)", "var(--medal-silver)", "var(--medal-bronze)"];
const MEDALS = ["🥇", "🥈", "🥉"];
// 프로토타입: 1~3위 "단" 자체를 도형 조합(primitive) 트로피로 그린다. false로 바꾸면 이전 모습으로 돌아간다.
const TROPHY_PODIUM = true;
const TROPHY_FILES = ["gold.svg", "silver.svg", "bronze.svg"];
// 트로피 그림 스타일: "primitive"(도형 조합) | "pixel"(Pyxelate로 만든 픽셀 아트). 주소에 ?trophy=pixel 로 바꿔 볼 수 있다.
const DEFAULT_TROPHY_STYLE = "pixel";
const TROPHY_STYLE = (() => {
    const q = new URLSearchParams(location.search).get("trophy");
    return q === "pixel" || q === "primitive" ? q : DEFAULT_TROPHY_STYLE;
})();
const TROPHY_DIR = TROPHY_STYLE === "pixel" ? "./assets/trophy/pixel" : "./assets/trophy";
const REST_GROUP_SIZE = 10; // 11위 이하는 10명씩 박스를 나눈다
const ROW_FLIP_MS = 500;
const PODIUM_DROP_MS = 600 + 160; // 애니메이션 길이 + 3위 stagger 지연
const IMPACT_MS = 320;
const STEP_INTERVAL_MS = 5000; // 여러 건이 한번에 들어왔을 때 각 항목 연출 "시작" 사이의 간격
const THEME_KEY = "hamsterRanking_theme";
const LOW_PERF_KEY = "hamsterRanking_lowperf";
// ---- 저사양 모드: 내장 GPU 구형 노트북·몇 년 전 폰에서도 끊기지 않도록 연출 비용을 줄인다 ----
/** 코어 수·메모리가 적거나 데이터 절약 모드이거나, 이전 파괴 연출이 실제로 느렸던 기기. */
function detectLowPerf() {
    const params = new URLSearchParams(location.search);
    if (params.has("lite"))
        return true; // 확인용 강제 전환: ?lite = 저사양, ?full = 일반
    if (params.has("full"))
        return false;
    try {
        if (localStorage.getItem(LOW_PERF_KEY) === "1")
            return true;
    }
    catch {
        // 저장소 접근 불가 시 하드웨어 정보로만 판단
    }
    const nav = navigator;
    return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || nav.connection?.saveData === true;
}
let lowPerf = detectLowPerf();
function applyLowPerfClass() {
    document.documentElement.classList.toggle("lite", lowPerf);
}
/** 실제로 연출이 버벅였던 기기는 다음부터 저사양 모드로 돈다. */
function markLowPerf() {
    if (lowPerf || new URLSearchParams(location.search).has("full"))
        return;
    lowPerf = true;
    applyLowPerfClass();
    try {
        localStorage.setItem(LOW_PERF_KEY, "1");
    }
    catch {
        // 이번 방문에만 적용
    }
}
// 깨지는 조각 모양(크랙 패턴으로 카드를 쪼갠 폴리곤들)과 각 조각이 튕겨나갈 대략적 방향.
const SHARD_CLIP_PATHS = [
    "polygon(0% 0%, 45% 0%, 30% 40%, 0% 55%)",
    "polygon(45% 0%, 100% 0%, 100% 30%, 55% 35%)",
    "polygon(0% 55%, 30% 40%, 55% 60%, 20% 100%, 0% 100%)",
    "polygon(30% 40%, 45% 0%, 55% 35%, 55% 60%)",
    "polygon(55% 35%, 100% 30%, 100% 70%, 60% 65%)",
    "polygon(55% 60%, 60% 65%, 70% 100%, 20% 100%)",
    "polygon(60% 65%, 100% 70%, 100% 100%, 70% 100%)",
];
let previousIds = new Set();
let previousTop3Ids = [];
let podiumAnimating = false;
let rendering = false;
let remoteRecords = [];
const els = {
    podium: document.getElementById("podium"),
    midList: document.getElementById("midList"),
    restGroups: document.getElementById("restGroups"),
    emptyState: document.getElementById("emptyState"),
    totalCount: document.getElementById("totalCount"),
    lastSync: document.getElementById("lastSync"),
    liveDot: document.getElementById("liveDot"),
    themeToggle: document.getElementById("themeToggle"),
    themeThumb: document.querySelector("#themeToggle .toggle-thumb"),
};
function aiBadge(r) {
    return isAIRecord(r)
        ? `<span class="ai-badge" title="인공지능 기록">🤖 AI</span>`
        : "";
}
/** 학교가 비어 있으면(AI 등) 빈 줄이나 "-" 대신 아예 표시하지 않는다. */
function metaLine(r) {
    return r.school.trim();
}
/** 동점자는 같은 순위(1, 2, 2, 4 …)로 매긴다. 정렬 순서(먼저 등록한 사람이 위)는 그대로. */
function placeAll(sorted) {
    const out = [];
    sorted.forEach((r, i) => {
        const prev = out[i - 1];
        const place = prev && prev.r.time === r.time ? prev.place : i + 1;
        const tied = sorted[i - 1]?.time === r.time || sorted[i + 1]?.time === r.time;
        out.push({ r, place, tied });
    });
    return out;
}
/**
 * "1분 2.214초" → 소수부+"초"를 고정 폭 칸(왼쪽 정렬)에 넣어, 오른쪽 정렬된 목록에서 소수점 위치가 줄마다 맞게 한다.
 * (소수부가 없거나 두 자리여도 같은 폭을 차지한다.) 기록 형식이 아니면 그대로 둔다.
 */
function alignedTime(text) {
    const m = /^(.*?\d)(\.\d+)?초$/.exec(text);
    if (!m)
        return escapeHtml(text);
    return `${escapeHtml(m[1] ?? "")}<span class="frac">${m[2] ?? ""}초</span>`;
}
function gapText(time, leaderTime) {
    return time - leaderTime <= 0 ? "선두와 동률" : formatGap(time - leaderTime);
}
/** 이 카드의 내용이 바뀌었는지 비교하는 키(사람·순위표기·선두와의 차가 같으면 그대로 둔다). */
function podiumKey(p, leaderTime) {
    return `${p.r.id}|${p.place}|${p.tied}|${gapText(p.r.time, leaderTime)}`;
}
/** 트로피 그림. 픽셀 트로피는 다크 모드용 네온 외곽선 그림을 하나 더 두고 테마에 따라 CSS로 골라 보인다. */
function trophyImgs(rank) {
    const file = TROPHY_FILES[rank - 1] ?? "";
    if (TROPHY_STYLE !== "pixel")
        return `<img class="trophy-step" src="${TROPHY_DIR}/${file}" alt="" />`;
    const neon = file.replace(/\.svg$/, "-neon.svg");
    return `<img class="trophy-step trophy-day" src="${TROPHY_DIR}/${file}" alt="" /><img class="trophy-step trophy-neon" src="${TROPHY_DIR}/${neon}" alt="" />`;
}
/** 지금 화면에 보이는 트로피 그림(테마에 따라 숨겨진 쪽은 건너뛴다). */
function visibleTrophyImg(card) {
    const imgs = Array.from(card.querySelectorAll(".trophy-step"));
    return imgs.find((i) => i.getClientRects().length > 0) ?? imgs[0] ?? null;
}
function podiumCard(p, rank, dropDelayClass, leaderTime) {
    const r = p.r;
    const color = MEDAL_COLORS[rank - 1];
    const cls = `podium-card rank-${rank}${TROPHY_PODIUM ? ` trophy trophy-${TROPHY_STYLE}` : ""}${dropDelayClass ? " drop" : ""}`;
    const gap = rank > 1 ? `<div class="podium-gap">${gapText(r.time, leaderTime)}</div>` : "";
    const tie = p.tied ? `<div class="podium-tie">공동 ${p.place}위</div>` : "";
    return `
    <div class="${cls}" style="--accent:${color}" data-id="${r.id}" data-rank="${rank}">
      <div class="podium-top">
        ${TROPHY_PODIUM ? "" : `<div class="medal">${MEDALS[p.place - 1] ?? MEDALS[rank - 1]}</div>`}${tie}
        <div class="podium-name">${escapeHtml(r.name)}${aiBadge(r)}</div>
        ${metaLine(r) ? `<div class="podium-meta">${escapeHtml(metaLine(r))}</div>` : ""}
        <div class="podium-time">${formatTime(r.time)}</div>
        ${gap}
      </div>
      <div class="podium-step">${TROPHY_PODIUM
        ? `${trophyImgs(rank)}<span class="podium-num">${rank}</span>`
        : rank}</div>
    </div>`;
}
function listRow(p, slot, isNew, colored, leaderTime) {
    const r = p.r;
    const c = colored ? ROW_COLORS[(slot - 4) % ROW_COLORS.length] : undefined;
    const style = c ? `--accent:${c.bg};--accent-ink:${c.ink}` : "--accent:var(--neutral-badge)";
    const cls = `row${isNew ? " enter" : ""}`;
    const title = p.tied ? ` title="공동 ${p.place}위"` : "";
    return `
    <div class="${cls}" style="${style}" data-id="${r.id}">
      <span class="row-rank"${title}>${p.place}</span>
      <span class="row-name">${escapeHtml(r.name)}${aiBadge(r)}</span>
      <span class="row-meta${metaLine(r) ? "" : " empty"}">${escapeHtml(metaLine(r))}</span>
      <span class="row-time-wrap">
        <span class="row-time">${alignedTime(formatTime(r.time))}</span>
        <span class="row-gap">${alignedTime(gapText(r.time, leaderTime))}</span>
      </span>
    </div>`;
}
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[c]);
}
function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size)
        out.push(items.slice(i, i + size));
    return out;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ---- 파괴 연출: 중심에서 에너지가 발산해 파편이 튀어나가고, 중력으로 창 아래로 떨어진다 ----
const GRAVITY = 2600; // px/s²
const BLAST_DRAG = 0.8; // 1/s — 공기 저항(튀어나가는 속도를 서서히 줄인다)
const BLAST_RESOLVE_MS = 650; // 이 시간 뒤 새 카드가 떨어지기 시작(파편은 계속 떨어진다)
const BLAST_MAX_MS = 6000;
const pixelSprites = new Map();
const TROPHY_FRAG_VERSION = "5"; // fragments.json·*-frag.png를 다시 생성하면 올린다(캐시 무효화)
const trophyFragData = new Map();
const trophyFragImages = new Map();
/** 파편 데이터와 트로피 그림을 미리 받아둔다(첫 화면 로딩을 방해하지 않게 한가할 때). */
function prefetchTrophies() {
    if (!TROPHY_PODIUM)
        return;
    if (TROPHY_STYLE === "pixel") {
        fetch(`${TROPHY_DIR}/pixels.json?v=${TROPHY_FRAG_VERSION}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((data) => {
            for (const file of TROPHY_FILES) {
                const sprite = data[file];
                if (sprite && Array.isArray(sprite.rows) && Array.isArray(sprite.palette))
                    pixelSprites.set(file, sprite);
            }
        })
            .catch(() => undefined);
        return;
    }
    const load = () => {
        fetch(`./assets/trophy/fragments.json?v=${TROPHY_FRAG_VERSION}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((data) => {
            for (const file of TROPHY_FILES) {
                const entry = data[file];
                if (!entry || !Array.isArray(entry.frags) || entry.frags.length === 0)
                    continue;
                trophyFragData.set(file, entry);
                const image = new Image();
                image.decoding = "async";
                image.src = `./assets/trophy/${entry.png}?v=${TROPHY_FRAG_VERSION}`;
                trophyFragImages.set(file, image);
            }
        })
            .catch(() => undefined);
    };
    if ("requestIdleCallback" in window)
        window.requestIdleCallback(load, { timeout: 4000 });
    else
        setTimeout(load, 1500);
}
/** 폭발 중심에서 파편까지의 방향으로 튀어나가는 초기 속도. 중심에 가까운 파편일수록 더 세게 맞는다. */
function blastVelocity(px, py, ox, oy) {
    const dx = px - ox;
    const dy = py - oy;
    const dist = Math.hypot(dx, dy) || 1;
    const theta = Math.atan2(dy, dx) + (Math.random() * 2 - 1) * 0.35;
    const speed = (650 + 1500 * Math.exp(-dist / 180)) * (0.7 + Math.random() * 0.6);
    return [Math.cos(theta) * speed, Math.sin(theta) * speed - 250];
}
/** `heft`가 클수록 무거운(큰) 파편이라 덜 멀리, 덜 빨리 돈다. */
function makePiece(cx, cy, ox, oy, el, apply, heft = 1) {
    const [vx, vy] = blastVelocity(cx, cy, ox, oy);
    return { x: 0, y: 0, vx: vx / heft, vy: vy / heft, angle: 0, spin: ((Math.random() * 2 - 1) * 9) / heft, baseX: cx, baseY: cy, done: false, apply, el };
}
function runBlast(pieces, layer) {
    const canvas = layer.querySelector("canvas");
    const ctx = canvas?.getContext("2d") ?? null;
    const start = performance.now();
    let last = start;
    let frames = 0;
    const tick = (now) => {
        // 느린 기기(20fps 등)에서도 파편이 슬로모션이 되지 않게 한 프레임을 최대 50ms까지 반영한다.
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        frames++;
        // 처음 12프레임 평균이 40ms(25fps 미만)면 이 기기는 다음부터 저사양 모드로 돈다.
        if (frames === 12 && (now - start) / 12 > 40 && document.visibilityState === "visible")
            markLowPerf();
        const k = Math.exp(-BLAST_DRAG * dt);
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (ctx && canvas) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        let alive = 0;
        for (const p of pieces) {
            if (p.done)
                continue;
            p.vy += GRAVITY * dt;
            p.vx *= k;
            p.vy *= k;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.angle += p.spin * dt;
            p.apply(p);
            if (ctx && p.draw)
                p.draw(ctx, p);
            const sx = p.baseX + p.x;
            const sy = p.baseY + p.y;
            if ((sy > h + 160 && p.vy > 0) || sx < -400 || sx > w + 400) {
                p.done = true;
                p.el?.remove();
            }
            else
                alive++;
        }
        if (alive > 0 && now - start < BLAST_MAX_MS)
            requestAnimationFrame(tick);
        else
            layer.remove();
    };
    requestAnimationFrame(tick);
}
function polygonCentroid(clipPath) {
    const pts = [...clipPath.matchAll(/(-?[\d.]+)%\s+(-?[\d.]+)%/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const n = pts.length || 1;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
/**
 * 픽셀 트로피를 부순다. 이 그림을 이루는 도형은 픽셀 칸이므로, 맞닿은 칸 2~3개를 묶은 덩어리가 파편 하나다
 * (매번 묶는 방식이 달라 부서지는 모양도 매번 다르다). 데이터가 아직 없으면 false.
 */
function spawnPixelFragments(card, rank, layer, pieces, ox, oy) {
    const img = visibleTrophyImg(card);
    const sprite = pixelSprites.get(TROPHY_FILES[rank - 1] ?? "");
    if (!img || !sprite)
        return false;
    const rect = img.getBoundingClientRect();
    const scale = Math.min(rect.width / sprite.w, rect.height / sprite.h); // 한 칸의 화면 크기(px)
    // 다크 모드에서는 화면의 트로피처럼 고대비 네온 팔레트로 칠한다.
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const palette = dark && sprite.hc?.length === sprite.palette.length ? sprite.hc : sprite.palette;
    const left = rect.left + (rect.width - sprite.w * scale) / 2;
    const top = rect.top + (rect.height - sprite.h * scale) / 2;
    // 채워진 칸 목록과 칸 → 색 번호
    const color = new Map();
    sprite.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            const ch = row[x] ?? ".";
            if (ch !== ".")
                color.set(y * sprite.w + x, parseInt(ch, 16));
        }
    });
    const cells = [...color.keys()].sort(() => Math.random() - 0.5);
    const taken = new Set();
    const neighborsOf = (k) => {
        const x = k % sprite.w;
        const out = [];
        if (x > 0)
            out.push(k - 1);
        if (x < sprite.w - 1)
            out.push(k + 1);
        out.push(k - sprite.w, k + sprite.w);
        return out.filter((n) => color.has(n) && !taken.has(n));
    };
    // 픽셀 조각은 단색 사각형뿐이라, 수백 개를 SVG로 다시 그리는 대신 캔버스 한 장에 직접 칠한다(구형 기기용).
    // 픽셀 그림이라 고해상도가 필요 없으므로 캔버스는 화면 픽셀 1배로 둔다.
    let canvas = layer.querySelector("canvas");
    if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.className = "pixel-frags";
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        layer.appendChild(canvas);
    }
    const cellSize = scale * 1.04; // 회전해도 칸 사이에 틈이 보이지 않게 아주 살짝 크게
    for (const seed of cells) {
        if (taken.has(seed))
            continue;
        taken.add(seed);
        const group = [seed];
        const want = Math.random() < 0.5 ? 2 : 3;
        while (group.length < want) {
            const next = group.flatMap(neighborsOf)[0];
            if (next === undefined)
                break;
            taken.add(next);
            group.push(next);
        }
        let cx = 0;
        let cy = 0;
        for (const k of group) {
            cx += (k % sprite.w) + 0.5;
            cy += Math.floor(k / sprite.w) + 0.5;
        }
        cx /= group.length;
        cy /= group.length;
        // 무게중심 기준 각 칸의 위치(px)와 색을 미리 계산해 둔다.
        const blocks = group.map((k) => ({
            x: ((k % sprite.w) - cx) * scale,
            y: (Math.floor(k / sprite.w) - cy) * scale,
            fill: palette[color.get(k) ?? 0] ?? "#000",
        }));
        const baseX = left + cx * scale;
        const baseY = top + cy * scale;
        const piece = makePiece(baseX, baseY, ox, oy, null, () => undefined);
        piece.draw = (ctx, p) => {
            const cos = Math.cos(p.angle);
            const sin = Math.sin(p.angle);
            ctx.setTransform(cos, sin, -sin, cos, baseX + p.x, baseY + p.y);
            for (const bl of blocks) {
                ctx.fillStyle = bl.fill;
                ctx.fillRect(bl.x, bl.y, cellSize, cellSize);
            }
        };
        pieces.push(piece);
    }
    card.classList.add("trophy-shattering");
    return true;
}
/** 트로피를 그린 도형 기반의 파편들로 트로피(단)를 부순다. 데이터·그림이 아직 없으면 false. */
function spawnTrophyFragments(card, rank, layer, pieces, ox, oy) {
    const img = visibleTrophyImg(card);
    const file = TROPHY_FILES[rank - 1] ?? "";
    const data = trophyFragData.get(file);
    const art = trophyFragImages.get(file);
    if (!img || !data || !art || !art.complete || art.naturalWidth === 0)
        return false;
    // <img>는 SVG를 비율 유지(가운데 정렬)로 그리므로 같은 방식으로 화면 좌표를 맞춘다.
    const [vx, vy, vw, vh] = data.vb;
    const rect = img.getBoundingClientRect();
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const left = rect.left + (rect.width - vw * scale) / 2;
    const top = rect.top + (rect.height - vh * scale) / 2;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "trophy-frags");
    svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
    svg.setAttribute("width", String(vw * scale));
    svg.setAttribute("height", String(vh * scale));
    svg.style.left = `${left}px`;
    svg.style.top = `${top}px`;
    const defs = document.createElementNS(SVG_NS, "defs");
    svg.appendChild(defs);
    const uid = `tf${rank}-${Math.random().toString(36).slice(2, 8)}`;
    data.frags.forEach((frag, i) => {
        const clip = document.createElementNS(SVG_NS, "clipPath");
        clip.setAttribute("id", `${uid}-${i}`);
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", frag.d);
        clip.appendChild(path);
        defs.appendChild(clip);
        // 파편 = 완성된 트로피 그림을 이 파편 모양으로 자른 것. transform이 클립까지 함께 옮긴다.
        const piece = document.createElementNS(SVG_NS, "image");
        piece.setAttribute("href", art.src);
        piece.setAttributeNS(XLINK_NS, "xlink:href", art.src); // 구형 Safari용
        piece.setAttribute("x", String(vx));
        piece.setAttribute("y", String(vy));
        piece.setAttribute("width", String(vw));
        piece.setAttribute("height", String(vh));
        piece.setAttribute("preserveAspectRatio", "none");
        piece.setAttribute("clip-path", `url(#${uid}-${i})`);
        svg.appendChild(piece);
        const [cx, cy] = frag.c;
        pieces.push(makePiece(left + (cx - vx) * scale, top + (cy - vy) * scale, ox, oy, piece, (p) => {
            const deg = (p.angle * 180) / Math.PI;
            piece.setAttribute("transform", `translate(${p.x / scale} ${p.y / scale}) rotate(${deg} ${cx} ${cy})`);
        }));
    });
    layer.appendChild(svg);
    card.classList.add("trophy-shattering");
    return true;
}
/** 카드의 정중앙에서 에너지가 사방으로 발산하듯 파편이 튀어나간 뒤, 중력으로 창 아래까지 떨어진다. */
function spawnShatter(card) {
    return new Promise((resolve) => {
        const layer = document.createElement("div");
        layer.className = "blast-layer";
        layer.style.setProperty("--accent", getComputedStyle(card).getPropertyValue("--accent"));
        document.body.appendChild(layer);
        const cardRect = card.getBoundingClientRect();
        const ox = cardRect.left + cardRect.width / 2;
        const oy = cardRect.top + cardRect.height / 2;
        const pieces = [];
        // 트로피(단)는 트로피를 그린 도형 기반 파편으로, 정보 박스(podium-top)는 박스 그대로의 금 간 조각으로 부순다.
        // (트로피 파편을 못 만들면 트로피까지 포함한 카드 전체를 금 간 조각으로 부순다.)
        const spawnFrags = TROPHY_STYLE === "pixel" ? spawnPixelFragments : spawnTrophyFragments;
        const trophyDone = card.classList.contains("trophy") && spawnFrags(card, Number(card.dataset.rank), layer, pieces, ox, oy);
        const top = card.querySelector(".podium-top");
        const shardRect = trophyDone && top ? top.getBoundingClientRect() : cardRect;
        // 조각마다 실제 카드의 복제본을 넣고 조각 모양으로 잘라, 단색 도형이 아니라 박스 자체가 깨지게 한다.
        const ghost = card.cloneNode(true);
        ghost.classList.remove("drop", "shatter", "trophy-shattering");
        ghost.removeAttribute("data-id");
        ghost.classList.add("shard-ghost");
        ghost.style.width = `${cardRect.width}px`;
        ghost.style.height = `${cardRect.height}px`;
        if (trophyDone)
            ghost.querySelector(".podium-step")?.style.setProperty("visibility", "hidden");
        const offX = shardRect.left - cardRect.left;
        const offY = shardRect.top - cardRect.top;
        SHARD_CLIP_PATHS.forEach((clipPath) => {
            const [px, py] = polygonCentroid(clipPath);
            const pts = [...clipPath.matchAll(/(-?[\d.]+)%\s+(-?[\d.]+)%/g)].map((m) => `${offX + (shardRect.width * Number(m[1])) / 100}px ${offY + (shardRect.height * Number(m[2])) / 100}px`);
            const cx = shardRect.left + (shardRect.width * px) / 100;
            const cy = shardRect.top + (shardRect.height * py) / 100;
            const shard = document.createElement("div");
            shard.className = "shard";
            shard.style.left = `${cardRect.left}px`;
            shard.style.top = `${cardRect.top}px`;
            shard.style.width = `${cardRect.width}px`;
            shard.style.height = `${cardRect.height}px`;
            shard.style.clipPath = `polygon(${pts.join(", ")})`;
            shard.style.transformOrigin = `${cx - cardRect.left}px ${cy - cardRect.top}px`;
            shard.appendChild(ghost.cloneNode(true));
            layer.appendChild(shard);
            pieces.push(makePiece(cx, cy, ox, oy, shard, (p) => {
                shard.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.angle}rad)`;
            }, 1.8));
        });
        card.classList.add("shatter");
        runBlast(pieces, layer);
        setTimeout(resolve, BLAST_RESOLVE_MS);
    });
}
/** 착지 순간 흩날리는 잔해 파티클. */
function spawnDebris(container) {
    for (let i = 0; i < 12; i++) {
        const d = document.createElement("div");
        d.className = "debris";
        const angle = Math.random() * Math.PI - Math.PI / 2;
        const dist = 30 + Math.random() * 55;
        d.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
        d.style.setProperty("--dy", `${-Math.abs(Math.sin(angle)) * dist - 10}px`);
        d.style.left = `${30 + Math.random() * 40}%`;
        d.style.animationDelay = `${Math.random() * 40}ms`;
        container.appendChild(d);
        setTimeout(() => d.remove(), 550);
    }
}
function captureRects(container) {
    const rects = new Map();
    container.querySelectorAll("[data-id]").forEach((el) => {
        rects.set(el.dataset.id, el.getBoundingClientRect());
    });
    return rects;
}
/** FLIP 기법: 이전 위치와 새 위치의 차이만큼 역방향으로 즉시 이동시킨 뒤, 트랜지션으로 제자리로 슬라이드시킨다. */
function playFlip(container, previousRects) {
    if (prefersReducedMotion())
        return;
    container.querySelectorAll("[data-id]").forEach((el) => {
        const id = el.dataset.id;
        const prev = previousRects.get(id);
        if (!prev)
            return;
        const next = el.getBoundingClientRect();
        const deltaY = prev.top - next.top;
        if (Math.abs(deltaY) < 1)
            return;
        el.style.transition = "none";
        el.style.transform = `translateY(${deltaY}px)`;
        requestAnimationFrame(() => {
            el.style.transition = `transform ${ROW_FLIP_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`;
            el.style.transform = "";
        });
    });
}
function renderRowLists(sorted) {
    const rowContainers = [els.midList, els.restGroups];
    const previousRects = new Map();
    for (const c of rowContainers)
        captureRects(c).forEach((rect, id) => previousRects.set(id, rect));
    const leaderTime = sorted[0]?.time ?? 0;
    const placed = placeAll(sorted);
    const mid = placed.slice(3, 10);
    const rest = placed.slice(10);
    els.midList.innerHTML = mid.map((p, i) => listRow(p, i + 4, !previousIds.has(p.r.id), true, leaderTime)).join("");
    els.restGroups.innerHTML = chunk(rest, REST_GROUP_SIZE)
        .map((group, g) => {
        const first = 11 + g * REST_GROUP_SIZE;
        const last = first + group.length - 1;
        const title = first === last ? `${first}위` : `${first}위 ~ ${last}위`;
        const rows = group.map((p, i) => listRow(p, first + i, !previousIds.has(p.r.id), false, leaderTime)).join("");
        return `<section class="card" aria-label="${title}"><h2><span class="h2-icon icon-rest">📋</span>${title}</h2><div>${rows}</div></section>`;
    })
        .join("");
    for (const c of rowContainers)
        playFlip(c, previousRects);
}
function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
async function renderPodium(top3) {
    const leaderTime = top3[0]?.r.time ?? 0;
    const newTop3Ids = top3.map((p) => podiumKey(p, leaderTime));
    const unchanged = newTop3Ids.length === previousTop3Ids.length && newTop3Ids.every((id, i) => id === previousTop3Ids[i]);
    if (unchanged) {
        previousTop3Ids = newTop3Ids;
        return;
    }
    const priorTop3Ids = previousTop3Ids;
    previousTop3Ids = newTop3Ids;
    if (podiumAnimating || prefersReducedMotion()) {
        // 이미 애니메이션 중이거나 모션 감소 선호 시엔 겹쳐서 재생하지 않고 최신 상태로 스냅.
        els.podium.classList.remove("impact");
        els.podium.innerHTML = top3.map((p, i) => podiumCard(p, i + 1, false, leaderTime)).join("");
        return;
    }
    // 자리별로(1/2/3위) 실제로 사람이 바뀐 곳만 골라낸다 — 그대로인 자리는 손대지 않는다.
    const changedRanks = [];
    for (let i = 0; i < Math.max(top3.length, priorTop3Ids.length); i++) {
        if (newTop3Ids[i] !== priorTop3Ids[i])
            changedRanks.push(i + 1);
    }
    if (changedRanks.length === 0)
        return;
    await playPodiumReplace(changedRanks, top3, leaderTime);
}
/** 지정한 자리의 카드를 부순 뒤 top3의 해당 자리 기록으로 새 카드를 떨어뜨린다. */
async function playPodiumReplace(changedRanks, top3, leaderTime, leadMs = ROW_FLIP_MS) {
    const existingCardsByRank = new Map();
    els.podium.querySelectorAll(".podium-card").forEach((c) => {
        const rank = Number(c.dataset.rank);
        if (rank)
            existingCardsByRank.set(rank, c);
    });
    podiumAnimating = true;
    try {
        const cardsToShatter = changedRanks
            .map((rank) => existingCardsByRank.get(rank))
            .filter((c) => !!c);
        if (cardsToShatter.length > 0) {
            if (leadMs > 0)
                await delay(leadMs);
            // 여러 장이 한꺼번에 부서질 때는 80ms씩 어긋나게 시작해, 파편 생성 부담을 한 프레임에 몰지 않는다.
            await Promise.all(cardsToShatter.map((c, i) => delay(i * 80).then(() => spawnShatter(c))));
        }
        cardsToShatter.forEach((c) => c.remove());
        // 바뀐 자리만 새 카드로 교체해 붙인다 (그대로인 자리는 기존 DOM을 그대로 유지).
        for (const rank of changedRanks) {
            const record = top3[rank - 1];
            if (!record)
                continue; // 인원이 줄어 그 자리가 아예 없어진 경우
            const wrapper = document.createElement("div");
            wrapper.innerHTML = podiumCard(record, rank, true, leaderTime).trim();
            const newCard = wrapper.firstElementChild;
            els.podium.appendChild(newCard);
        }
        await delay(PODIUM_DROP_MS);
        spawnDebris(els.podium);
        els.podium.classList.add("impact");
        await delay(IMPACT_MS);
        els.podium.classList.remove("impact");
    }
    finally {
        podiumAnimating = false;
    }
}
/**
 * 확인용: 주소 끝에 ?preview를 붙여 열었을 때만 q/w/e 키로 1/2/3위 교체 연출을 재생한다.
 * 실제 순위·데이터는 바뀌지 않는다. 한글 입력 상태에서도 동작하도록 글자가 아닌 키 위치로 판단한다.
 */
function initPodiumPreviewKeys() {
    if (!new URLSearchParams(location.search).has("preview"))
        return;
    const codeToRank = { KeyQ: 1, KeyW: 2, KeyE: 3 };
    window.addEventListener("keydown", (ev) => {
        const rank = codeToRank[ev.code];
        if (!rank || ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat)
            return;
        const target = ev.target;
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
            return;
        // 실제 갱신 연출과 같은 잠금을 써서 둘이 겹치지 않게 한다(겹치면 카드가 중복될 수 있다).
        if (rendering || podiumAnimating || prefersReducedMotion())
            return;
        const sorted = sortRecords(remoteRecords);
        const top3 = placeAll(sorted).slice(0, 3);
        if (!top3[rank - 1])
            return;
        rendering = true;
        void playPodiumReplace([rank], top3, sorted[0]?.time ?? 0, 0).finally(() => {
            rendering = false;
            void drainPendingRender();
        });
    });
}
async function applyState(sorted) {
    const currentIds = new Set(sorted.map((r) => r.id));
    els.totalCount.textContent = String(sorted.length);
    els.emptyState.style.display = sorted.length === 0 ? "flex" : "none";
    const top3 = placeAll(sorted).slice(0, 3);
    renderRowLists(sorted);
    await renderPodium(top3);
    previousIds = currentIds;
}
let pendingRenderData = null;
async function render(all) {
    if (rendering) {
        // 진행 중인 시퀀스가 있으면 최신 데이터만 기억해뒀다가, 끝나는 즉시 이어서 반영한다
        // (건너뛰고 잊어버리면 그 갱신이 영영 반영되지 않을 수 있다).
        pendingRenderData = all;
        return;
    }
    const sorted = sortRecords(all);
    const newRecords = sorted.filter((r) => !previousIds.has(r.id));
    // 아직 아무것도 표시된 적 없는 최초 페인트는 previousIds가 비어있어 전체가 "신규"로
    // 잡히지만, 그건 여러 건이 동시에 "들어온" 게 아니라 그냥 초기 상태이므로 순차 연출
    // 없이 한 번에 그린다. (네트워크 응답이 늦어 빈 상태로 한 번 그려졌다가 실제 데이터가
    // 뒤늦게 도착하는 경우도 previousIds가 여전히 비어있으므로 똑같이 처리된다.)
    const isFirstPaint = previousIds.size === 0;
    rendering = true;
    try {
        if (isFirstPaint || newRecords.length <= 1) {
            await applyState(sorted);
        }
        else {
            // 여러 건이 한번에 들어오면, 맨 위(1위)에 가까운 순서대로 하나씩 차례로 반영한다.
            const rankOf = new Map(sorted.map((r, i) => [r.id, i]));
            const orderedNew = [...newRecords].sort((a, b) => rankOf.get(a.id) - rankOf.get(b.id));
            // 각 항목의 연출이 "시작"된 시점부터 STEP_INTERVAL_MS가 지나야 다음 항목을
            // 시작한다 — 연출 자체는 이보다 짧게 끝나지만(줄 스왑/시상대 파괴+낙하),
            // 남는 시간만큼 그대로 두어 한꺼번에 몰아치는 느낌 없이 또렷하게 하나씩 보이게 한다.
            let working = sorted.filter((r) => previousIds.has(r.id));
            for (const record of orderedNew) {
                working = sortRecords([...working, record]);
                const startedAt = Date.now();
                await applyState(working);
                const elapsed = Date.now() - startedAt;
                await delay(Math.max(0, STEP_INTERVAL_MS - elapsed));
            }
        }
    }
    finally {
        rendering = false;
    }
    await drainPendingRender();
}
async function drainPendingRender() {
    if (pendingRenderData === null)
        return;
    const next = pendingRenderData;
    pendingRenderData = null;
    await render(next);
}
async function fetchJson(url) {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data))
        throw new Error("records.json 형식 오류");
    return data;
}
let lastSignature = null;
async function fetchRemote() {
    // raw.githubusercontent.com은 CDN 캐시가 쿼리스트링을 무시하고 최대 5분간 그대로
    // 응답해버려서(no-cache 요청 헤더도 무시됨) "실시간"에는 못 쓴다. 이 저장소의 GitHub
    // Pages 배포본(우리가 직접 트리거하는 배포 시점만큼만 뒤처짐)을 1차로 쓰고,
    // 그마저 안 될 때만 raw를 예비로 시도한다.
    let data = null;
    try {
        data = await fetchJson(FALLBACK_DATA_URL);
    }
    catch {
        try {
            data = await fetchJson(RAW_DATA_URL);
        }
        catch {
            data = null;
        }
    }
    setLive(data !== null);
    // 실패했을 땐 "업데이트" 시각을 갱신하지 않는다 — 마지막으로 실제 받아온 시각이 남아 있어야 끊김을 알아챈다.
    if (data === null)
        return;
    els.lastSync.textContent = new Date().toLocaleTimeString("ko-KR");
    const records = normalizeRecords(data);
    const signature = JSON.stringify(sortRecords(records).map((r) => [r.id, r.name, r.school, r.time, r.tag]));
    if (signature === lastSignature)
        return; // 바뀐 게 없으면 다시 그리지 않는다
    lastSignature = signature;
    remoteRecords = records;
    void render(remoteRecords);
}
function setLive(ok) {
    els.liveDot.classList.toggle("live-ok", ok);
    els.liveDot.classList.toggle("live-fail", !ok);
}
function startPolling() {
    fetchRemote();
    setInterval(fetchRemote, POLL_INTERVAL_MS);
    // 브라우저는 백그라운드 탭/창의 타이머를 강제로 느리게 만든다(배터리 절약 정책).
    // 이 화면이 다시 보이거나 포커스를 받는 순간만큼은 그 지연과 무관하게 즉시 최신화한다.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible")
            fetchRemote();
    });
    window.addEventListener("focus", () => fetchRemote());
}
/**
 * 타이틀+1~3위 페이드인이 끝나고 0.75초 뒤, 사용자의 스크롤 위치를 실제로(그냥
 * 높이만 바뀌는 흉내가 아니라 진짜 window.scrollTo로) 강제로 이동시켜 기본 화면
 * (1~3위+4~10위)을 드러낸다.
 */
function initLanding() {
    const spacer = document.getElementById("landingSpacer");
    const podiumSection = document.querySelector(".podium-section");
    const podiumEl = document.getElementById("podium");
    if (!spacer || !podiumSection || !podiumEl || prefersReducedMotion())
        return;
    const runLandingSequence = () => {
        const FADE_MS = 700; // .landing-fade 애니메이션 길이와 동일하게 맞춘다
        const HOLD_MS = 750; // 요청된 "페이드인 종료 0.75초 뒤" 대기 시간
        // 시상대 아래 남는 뷰포트 공간만큼 스페이서를 채워, 접속 직후엔 타이틀+1~3위까지만
        // 보이도록 자른다.
        const remaining = Math.max(0, window.innerHeight - podiumSection.getBoundingClientRect().bottom);
        if (remaining <= 0)
            return; // 이미 다 보이면 스크롤할 필요 없음
        spacer.style.height = `${remaining}px`;
        window.setTimeout(() => {
            const finishReveal = () => {
                // 스페이서를 걷어내는 동시에 스크롤 위치를 0으로 되돌린다 — 방금 스크롤해서
                // 내려온 만큼을 스페이서 제거로 다시 끌어올리는 셈이라 화면은 그대로 유지되고,
                // 이후 사용자가 위로 스크롤해도 빈 여백이 남지 않는다.
                spacer.style.height = "0px";
                window.scrollTo(0, 0);
            };
            // 스크롤이 실제로 목표 지점(remaining)에 도달했는지 매 프레임 직접 확인한다.
            // 타이머나 scrollend 이벤트에만 의존하면, 기기에 따라 smooth 스크롤이 채
            // 끝나기 전에 먼저 발동해 화면이 원래대로 튕겨 돌아가 버리는 문제가 있었다.
            const scrollStartedAt = Date.now();
            const MAX_WAIT_MS = 2500; // 스크롤이 끝내 목표에 못 미쳐도 무한정 기다리지 않는다
            const waitForScrollEnd = () => {
                const reachedTarget = window.scrollY >= remaining - 2;
                const timedOut = Date.now() - scrollStartedAt > MAX_WAIT_MS;
                if (reachedTarget || timedOut) {
                    finishReveal();
                }
                else {
                    requestAnimationFrame(waitForScrollEnd);
                }
            };
            window.scrollTo({ top: remaining, behavior: "smooth" });
            requestAnimationFrame(waitForScrollEnd);
        }, FADE_MS + HOLD_MS);
    };
    // 시상대는 데이터를 비동기로 불러온 뒤에야 채워지므로, 그 전에 높이를 재면
    // 실제보다 훨씬 크게(또는 작게) 계산될 수 있다. 실제로 카드가 그려질 때까지
    // 기다렸다가 그 시점의 실측 높이로 스페이서를 계산한다.
    if (podiumEl.children.length > 0) {
        runLandingSequence();
        return;
    }
    const observer = new MutationObserver(() => {
        if (podiumEl.children.length > 0) {
            observer.disconnect();
            // 삽입 직후 한 프레임 안에는 레이아웃이 아직 완전히 반영되지 않았을 수 있어
            // rAF를 두 번 걸쳐 확실히 자리 잡은 뒤에 잰다(카드의 낙하 애니메이션은
            // transform이라 레이아웃 크기 자체에는 영향을 주지 않는다).
            requestAnimationFrame(() => requestAnimationFrame(runLandingSequence));
        }
    });
    observer.observe(podiumEl, { childList: true });
}
// 3·6번은 기존(1/7)의 1.5배(3/14)로 높이고, 나머지 다섯 장은 남은 확률을 균등하게 나눈다(4/35씩).
const OUTRO_IMAGES = [
    { file: "1.jpg", weight: 8 },
    { file: "2.png", weight: 8 },
    { file: "3.jpg", weight: 15 },
    { file: "4.jpg", weight: 8 },
    { file: "5.jpg", weight: 8 },
    { file: "6.jpg", weight: 15 },
    { file: "7.jpg", weight: 8 },
];
/** 맨 아래 사진은 새로고침할 때마다 가중치에 따라 무작위로 하나를 보여준다. */
function initOutro() {
    const img = document.getElementById("outroImg");
    if (!img)
        return;
    const total = OUTRO_IMAGES.reduce((sum, i) => sum + i.weight, 0);
    let roll = Math.random() * total;
    const pick = OUTRO_IMAGES.find((i) => (roll -= i.weight) < 0) ?? OUTRO_IMAGES[0];
    img.src = `./assets/hamsters/${pick?.file}`;
}
function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    els.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    els.themeThumb.textContent = theme === "dark" ? "🌙" : "☀️";
}
function initTheme() {
    let saved = null;
    try {
        saved = localStorage.getItem(THEME_KEY);
    }
    catch {
        saved = null;
    }
    // 직접 고른 적이 없으면 기기의 다크 모드 설정을 따른다.
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(saved === "dark" || saved === "light" ? saved : systemDark ? "dark" : "light");
    els.themeToggle.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        try {
            localStorage.setItem(THEME_KEY, next);
        }
        catch {
            // 저장 불가(프라이빗 모드 등) 시 이번 방문에만 적용
        }
        applyTheme(next);
    });
}
applyLowPerfClass();
initTheme();
prefetchTrophies();
initPodiumPreviewKeys();
initOutro();
initLanding();
startPolling();
//# sourceMappingURL=ranking.js.map