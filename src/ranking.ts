// 공개 랭킹 화면 — GitHub Pages로 열람하는 모든 사람이 보는 읽기 전용 화면.
import {
  RankRecord,
  BROADCAST_CHANNEL_NAME,
  SyncMessage,
  formatTime,
  isAIRecord,
  loadLocalRecords,
  mergeRecords,
  sortRecords,
} from "./common.js";

// GitHub Pages 자체 배포(빌드+CDN 전파)는 최악의 경우 1분 이상 걸릴 수 있어, 배포를
// 기다리지 않고 커밋 직후 거의 바로 갱신되는 raw.githubusercontent.com을 우선 사용한다.
const GH_OWNER = "menonng";
const GH_REPO = "hamsterranking";
const GH_BRANCH = "claude/gracious-sagan-mzkdnd";
const RAW_DATA_URL = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/data/records.json`;
const FALLBACK_DATA_URL = "./data/records.json";
const POLL_INTERVAL_MS = 4000;
const PALETTE = [
  "#FF0045",
  "#FF7E00",
  "#FFCC11",
  "#55BB44",
  "#39C5BB",
  "#3355BB",
  "#660099",
  "#FFB4CC",
];
const MEDAL_COLORS = ["var(--medal-gold)", "var(--medal-silver)", "var(--medal-bronze)"];
const MEDALS = ["🥇", "🥈", "🥉"];

const ROW_FLIP_MS = 500;
const SHATTER_MS = 560;
const PODIUM_DROP_MS = 600 + 160; // 애니메이션 길이 + 3위 stagger 지연
const IMPACT_MS = 320;
const STEP_GAP_MS = 200; // 여러 건이 한번에 들어왔을 때 각 항목 반영 사이의 여백
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
const SHARD_DIRECTIONS: Array<[number, number]> = [
  [-1, -0.5],
  [0.2, -1],
  [-1, 0.4],
  [-0.3, -0.6],
  [1, -0.2],
  [-0.2, 1],
  [1, 0.8],
];

let previousIds = new Set<string>();
let previousTop3Ids: string[] = [];
let podiumAnimating = false;
let rendering = false;
let remoteRecords: RankRecord[] = [];

const els = {
  podium: document.getElementById("podium") as HTMLDivElement,
  midList: document.getElementById("midList") as HTMLDivElement,
  restList: document.getElementById("restList") as HTMLDivElement,
  restSection: document.getElementById("restSection") as HTMLDivElement,
  emptyState: document.getElementById("emptyState") as HTMLDivElement,
  totalCount: document.getElementById("totalCount") as HTMLSpanElement,
  lastSync: document.getElementById("lastSync") as HTMLSpanElement,
  liveDot: document.getElementById("liveDot") as HTMLSpanElement,
  themeToggle: document.getElementById("themeToggle") as HTMLButtonElement,
  themeThumb: document.querySelector("#themeToggle .toggle-thumb") as HTMLSpanElement,
};

function aiBadge(r: RankRecord): string {
  return isAIRecord(r)
    ? `<span class="ai-badge" title="인공지능 기록">🤖 AI</span>`
    : "";
}

function metaLine(r: RankRecord): string {
  const bits = [r.school, r.grade ? `${r.grade}학년` : "", r.age ? `${r.age}세` : ""].filter(Boolean);
  return bits.join(" · ") || "-";
}

function podiumCard(r: RankRecord, rank: number, dropDelayClass: boolean): string {
  const color = MEDAL_COLORS[rank - 1];
  const cls = `podium-card rank-${rank}${dropDelayClass ? " drop" : ""}`;
  return `
    <div class="${cls}" style="--accent:${color}" data-id="${r.id}">
      <div class="podium-top">
        <div class="medal">${MEDALS[rank - 1]}</div>
        <div class="podium-name">${escapeHtml(r.name)}${aiBadge(r)}</div>
        <div class="podium-meta">${escapeHtml(metaLine(r))}</div>
        <div class="podium-time">${formatTime(r.time)}</div>
      </div>
      <div class="podium-step">${rank}</div>
    </div>`;
}

function listRow(r: RankRecord, rank: number, isNew: boolean, colored: boolean): string {
  const color = colored ? PALETTE[(rank - 1) % PALETTE.length] : "var(--neutral-badge)";
  const cls = `row${isNew ? " enter" : ""}`;
  return `
    <div class="${cls}" style="--accent:${color}" data-id="${r.id}">
      <span class="row-rank">${rank}</span>
      <span class="row-name">${escapeHtml(r.name)}${aiBadge(r)}</span>
      <span class="row-meta">${escapeHtml(metaLine(r))}</span>
      <span class="row-time">${formatTime(r.time)}</span>
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c] as string);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 카드를 크랙 조각들로 쪼개 사방으로 날아가며 사라지게 한다 (진짜 깨지는 것처럼 보이도록). */
function spawnShatter(card: HTMLElement): Promise<void> {
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
function spawnDebris(container: HTMLElement): void {
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

function captureRects(container: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  container.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
    rects.set(el.dataset.id as string, el.getBoundingClientRect());
  });
  return rects;
}

/** FLIP 기법: 이전 위치와 새 위치의 차이만큼 역방향으로 즉시 이동시킨 뒤, 트랜지션으로 제자리로 슬라이드시킨다. */
function playFlip(container: HTMLElement, previousRects: Map<string, DOMRect>): void {
  container.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
    const id = el.dataset.id as string;
    const prev = previousRects.get(id);
    if (!prev) return;
    const next = el.getBoundingClientRect();
    const deltaY = prev.top - next.top;
    if (Math.abs(deltaY) < 1) return;

    el.style.transition = "none";
    el.style.transform = `translateY(${deltaY}px)`;
    requestAnimationFrame(() => {
      el.style.transition = `transform ${ROW_FLIP_MS}ms cubic-bezier(.2,.7,.3,1)`;
      el.style.transform = "";
    });
  });
}

function renderRowLists(sorted: RankRecord[]): void {
  const rowContainers = [els.midList, els.restList];
  const previousRects = new Map<string, DOMRect>();
  for (const c of rowContainers) captureRects(c).forEach((rect, id) => previousRects.set(id, rect));

  const mid = sorted.slice(3, 10);
  const rest = sorted.slice(10);

  els.midList.innerHTML = mid.map((r, i) => listRow(r, i + 4, !previousIds.has(r.id), true)).join("");
  els.restSection.style.display = rest.length > 0 ? "block" : "none";
  els.restList.innerHTML = rest.map((r, i) => listRow(r, i + 11, !previousIds.has(r.id), false)).join("");

  for (const c of rowContainers) playFlip(c, previousRects);
}

async function renderPodium(top3: RankRecord[]): Promise<void> {
  const newTop3Ids = top3.map((r) => r.id);
  const unchanged =
    newTop3Ids.length === previousTop3Ids.length && newTop3Ids.every((id, i) => id === previousTop3Ids[i]);

  if (unchanged) {
    previousTop3Ids = newTop3Ids;
    return;
  }

  const existingCards = Array.from(els.podium.querySelectorAll<HTMLElement>(".podium-card"));
  previousTop3Ids = newTop3Ids;

  if (podiumAnimating) {
    // 이미 애니메이션 중이면 굳이 겹쳐서 재생하지 않고 최신 상태로 스냅.
    els.podium.classList.remove("impact");
    els.podium.innerHTML = top3.map((r, i) => podiumCard(r, i + 1, false)).join("");
    return;
  }

  podiumAnimating = true;
  try {
    if (existingCards.length > 0) {
      await delay(ROW_FLIP_MS);
      await Promise.all(existingCards.map((c) => spawnShatter(c)));
    }

    els.podium.innerHTML = top3.map((r, i) => podiumCard(r, i + 1, true)).join("");
    await delay(PODIUM_DROP_MS);
    spawnDebris(els.podium);
    els.podium.classList.add("impact");
    await delay(IMPACT_MS);
    els.podium.classList.remove("impact");
  } finally {
    podiumAnimating = false;
  }
}

async function applyState(sorted: RankRecord[]): Promise<void> {
  const currentIds = new Set(sorted.map((r) => r.id));

  els.totalCount.textContent = String(sorted.length);
  els.emptyState.style.display = sorted.length === 0 ? "flex" : "none";

  const top3 = sorted.slice(0, 3);
  renderRowLists(sorted);
  await renderPodium(top3);

  previousIds = currentIds;
}

let pendingRenderData: RankRecord[] | null = null;

async function render(all: RankRecord[]): Promise<void> {
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
    } else {
      // 여러 건이 한번에 들어오면, 맨 위(1위)에 가까운 순서대로 하나씩 차례로 반영한다.
      const rankOf = new Map(sorted.map((r, i) => [r.id, i]));
      const orderedNew = [...newRecords].sort((a, b) => rankOf.get(a.id)! - rankOf.get(b.id)!);

      let working = sorted.filter((r) => previousIds.has(r.id));
      for (const record of orderedNew) {
        working = sortRecords([...working, record]);
        await applyState(working);
        await delay(STEP_GAP_MS);
      }
    }
  } finally {
    rendering = false;
  }
  await drainPendingRender();
}

async function drainPendingRender(): Promise<void> {
  if (pendingRenderData === null) return;
  const next = pendingRenderData;
  pendingRenderData = null;
  await render(next);
}

function getCombined(): RankRecord[] {
  const local = loadLocalRecords();
  return mergeRecords(remoteRecords, local);
}

async function fetchJson(url: string): Promise<RankRecord[] | null> {
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? (data as RankRecord[]) : null;
}

async function fetchRemote(): Promise<void> {
  try {
    const data = (await fetchJson(RAW_DATA_URL)) ?? (await fetchJson(FALLBACK_DATA_URL));
    if (data) {
      remoteRecords = data;
      setLive(true);
    }
  } catch {
    try {
      const data = await fetchJson(FALLBACK_DATA_URL);
      if (data) {
        remoteRecords = data;
        setLive(true);
      }
    } catch {
      setLive(false);
    }
  }
  void render(getCombined());
  els.lastSync.textContent = new Date().toLocaleTimeString("ko-KR");
}

function setLive(ok: boolean): void {
  els.liveDot.classList.toggle("live-ok", ok);
  els.liveDot.classList.toggle("live-fail", !ok);
}

function startPolling(): void {
  fetchRemote();
  setInterval(fetchRemote, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fetchRemote();
  });
}

function listenLocalUpdates(): void {
  window.addEventListener("storage", (e) => {
    if (e.key === "hamsterRanking_records_v1") void render(getCombined());
  });

  if ("BroadcastChannel" in window) {
    const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    bc.onmessage = (ev: MessageEvent<SyncMessage>) => {
      if (ev.data?.type === "records") void render(getCombined());
    };
  }
}

function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
  els.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  els.themeThumb.textContent = theme === "dark" ? "🌙" : "☀️";
}

function initTheme(): void {
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
