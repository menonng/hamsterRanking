// 공개 랭킹 화면 — GitHub Pages로 열람하는 모든 사람이 보는 읽기 전용 화면.
import { BROADCAST_CHANNEL_NAME, formatGap, formatTime, isAIRecord, loadLocalRecords, mergeRecords, sortRecords, } from "./common.js";
// GitHub Pages 자체 배포(빌드+CDN 전파)는 최악의 경우 1분 이상 걸릴 수 있어, 배포를
// 기다리지 않고 커밋 직후 거의 바로 갱신되는 raw.githubusercontent.com을 우선 사용한다.
const GH_OWNER = "menonng";
const GH_REPO = "hamsterranking";
const GH_BRANCH = "claude/gracious-sagan-mzkdnd";
const RAW_DATA_URL = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/data/records.json`;
const FALLBACK_DATA_URL = "./data/records.json";
const POLL_INTERVAL_MS = 4000;
const PALETTE = [
    "oklch(62% 0.19 25)",
    "oklch(66% 0.17 55)",
    "oklch(74% 0.15 95)",
    "oklch(64% 0.14 150)",
    "oklch(62% 0.13 200)",
    "oklch(56% 0.17 250)",
    "oklch(52% 0.18 300)",
    "oklch(66% 0.16 340)",
];
const MEDAL_COLORS = ["var(--medal-gold)", "var(--medal-silver)", "var(--medal-bronze)"];
const MEDALS = ["🥇", "🥈", "🥉"];
const ROW_FLIP_MS = 500;
const SHATTER_MS = 560;
const PODIUM_DROP_MS = 600 + 160; // 애니메이션 길이 + 3위 stagger 지연
const IMPACT_MS = 320;
const STEP_INTERVAL_MS = 5000; // 여러 건이 한번에 들어왔을 때 각 항목 연출 "시작" 사이의 간격
const THEME_KEY = "hamsterRanking_theme";
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
const SHARD_DIRECTIONS = [
    [-1, -0.5],
    [0.2, -1],
    [-1, 0.4],
    [-0.3, -0.6],
    [1, -0.2],
    [-0.2, 1],
    [1, 0.8],
];
let previousIds = new Set();
let previousTop3Ids = [];
let podiumAnimating = false;
let rendering = false;
let remoteRecords = [];
const els = {
    podium: document.getElementById("podium"),
    midList: document.getElementById("midList"),
    restList: document.getElementById("restList"),
    restSection: document.getElementById("restSection"),
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
function metaLine(r) {
    const bits = [r.school, r.grade ? `${r.grade}학년` : "", r.age ? `${r.age}세` : ""].filter(Boolean);
    return bits.join(" · ") || "-";
}
function podiumCard(r, rank, dropDelayClass, leaderTime) {
    const color = MEDAL_COLORS[rank - 1];
    const cls = `podium-card rank-${rank}${dropDelayClass ? " drop" : ""}`;
    const gap = rank > 1 ? `<div class="podium-gap">${formatGap(r.time - leaderTime)}</div>` : "";
    return `
    <div class="${cls}" style="--accent:${color}" data-id="${r.id}" data-rank="${rank}">
      <div class="podium-top">
        <div class="medal">${MEDALS[rank - 1]}</div>
        <div class="podium-name">${escapeHtml(r.name)}${aiBadge(r)}</div>
        <div class="podium-meta">${escapeHtml(metaLine(r))}</div>
        <div class="podium-time">${formatTime(r.time)}</div>
        ${gap}
      </div>
      <div class="podium-step">${rank}</div>
    </div>`;
}
function listRow(r, rank, isNew, colored, leaderTime) {
    const color = colored ? PALETTE[(rank - 1) % PALETTE.length] : "var(--neutral-badge)";
    const cls = `row${isNew ? " enter" : ""}`;
    return `
    <div class="${cls}" style="--accent:${color}" data-id="${r.id}">
      <span class="row-rank">${rank}</span>
      <span class="row-name">${escapeHtml(r.name)}${aiBadge(r)}</span>
      <span class="row-meta">${escapeHtml(metaLine(r))}</span>
      <span class="row-time-wrap">
        <span class="row-time">${formatTime(r.time)}</span>
        <span class="row-gap">${formatGap(r.time - leaderTime)}</span>
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
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** 카드를 크랙 조각들로 쪼개 사방으로 날아가며 사라지게 한다 (진짜 깨지는 것처럼 보이도록). */
function spawnShatter(card) {
    return new Promise((resolve) => {
        SHARD_CLIP_PATHS.forEach((clipPath, i) => {
            const shard = document.createElement("div");
            shard.className = "shard";
            shard.style.clipPath = clipPath;
            const [dx, dy] = SHARD_DIRECTIONS[i % SHARD_DIRECTIONS.length] ?? [0, 1];
            const spread = 50 + Math.random() * 60;
            shard.style.setProperty("--dx", `${dx * spread}px`);
            shard.style.setProperty("--dy", `${dy * spread + 40 + Math.random() * 30}px`);
            shard.style.setProperty("--rot", `${(Math.random() * 2 - 1) * 70}deg`);
            shard.style.animationDelay = `${Math.random() * 50}ms`;
            card.appendChild(shard);
        });
        card.classList.add("shatter");
        setTimeout(resolve, SHATTER_MS);
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
    const rowContainers = [els.midList, els.restList];
    const previousRects = new Map();
    for (const c of rowContainers)
        captureRects(c).forEach((rect, id) => previousRects.set(id, rect));
    const leaderTime = sorted[0]?.time ?? 0;
    const mid = sorted.slice(3, 10);
    const rest = sorted.slice(10);
    els.midList.innerHTML = mid.map((r, i) => listRow(r, i + 4, !previousIds.has(r.id), true, leaderTime)).join("");
    els.restSection.style.display = rest.length > 0 ? "block" : "none";
    els.restList.innerHTML = rest.map((r, i) => listRow(r, i + 11, !previousIds.has(r.id), false, leaderTime)).join("");
    for (const c of rowContainers)
        playFlip(c, previousRects);
}
function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
async function renderPodium(top3) {
    const newTop3Ids = top3.map((r) => r.id);
    const unchanged = newTop3Ids.length === previousTop3Ids.length && newTop3Ids.every((id, i) => id === previousTop3Ids[i]);
    if (unchanged) {
        previousTop3Ids = newTop3Ids;
        return;
    }
    const priorTop3Ids = previousTop3Ids;
    previousTop3Ids = newTop3Ids;
    const leaderTime = top3[0]?.time ?? 0;
    if (podiumAnimating || prefersReducedMotion()) {
        // 이미 애니메이션 중이거나 모션 감소 선호 시엔 겹쳐서 재생하지 않고 최신 상태로 스냅.
        els.podium.classList.remove("impact");
        els.podium.innerHTML = top3.map((r, i) => podiumCard(r, i + 1, false, leaderTime)).join("");
        return;
    }
    const existingCardsByRank = new Map();
    els.podium.querySelectorAll(".podium-card").forEach((c) => {
        const rank = Number(c.dataset.rank);
        if (rank)
            existingCardsByRank.set(rank, c);
    });
    // 자리별로(1/2/3위) 실제로 사람이 바뀐 곳만 골라낸다 — 그대로인 자리는 손대지 않는다.
    const changedRanks = [];
    for (let i = 0; i < Math.max(top3.length, priorTop3Ids.length); i++) {
        if (top3[i]?.id !== priorTop3Ids[i])
            changedRanks.push(i + 1);
    }
    if (changedRanks.length === 0)
        return;
    podiumAnimating = true;
    try {
        const cardsToShatter = changedRanks
            .map((rank) => existingCardsByRank.get(rank))
            .filter((c) => !!c);
        if (cardsToShatter.length > 0) {
            await delay(ROW_FLIP_MS);
            await Promise.all(cardsToShatter.map((c) => spawnShatter(c)));
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
async function applyState(sorted) {
    const currentIds = new Set(sorted.map((r) => r.id));
    els.totalCount.textContent = String(sorted.length);
    els.emptyState.style.display = sorted.length === 0 ? "flex" : "none";
    const top3 = sorted.slice(0, 3);
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
function getCombined() {
    const local = loadLocalRecords();
    return mergeRecords(remoteRecords, local);
}
async function fetchJson(url) {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : null;
}
async function fetchRemote() {
    // raw.githubusercontent.com은 CDN 캐시가 쿼리스트링을 무시하고 최대 5분간 그대로
    // 응답해버려서(no-cache 요청 헤더도 무시됨) "실시간"에는 못 쓴다. 이 저장소의 GitHub
    // Pages 배포본(우리가 직접 트리거하는 배포 시점만큼만 뒤처짐)을 1차로 쓰고,
    // 그마저 안 될 때만 raw를 예비로 시도한다.
    try {
        const data = await fetchJson(FALLBACK_DATA_URL);
        if (data) {
            remoteRecords = data;
            setLive(true);
        }
    }
    catch {
        try {
            const data = await fetchJson(RAW_DATA_URL);
            if (data) {
                remoteRecords = data;
                setLive(true);
            }
        }
        catch {
            setLive(false);
        }
    }
    void render(getCombined());
    els.lastSync.textContent = new Date().toLocaleTimeString("ko-KR");
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
function listenLocalUpdates() {
    window.addEventListener("storage", (e) => {
        if (e.key === "hamsterRanking_records_v1")
            void render(getCombined());
    });
    if ("BroadcastChannel" in window) {
        const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        bc.onmessage = (ev) => {
            if (ev.data?.type === "records")
                void render(getCombined());
        };
    }
}
function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    els.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    els.themeThumb.textContent = theme === "dark" ? "🌙" : "☀️";
}
function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved === "dark" ? "dark" : "light");
    els.themeToggle.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
    });
}
initTheme();
void render(getCombined());
listenLocalUpdates();
startPolling();
//# sourceMappingURL=ranking.js.map