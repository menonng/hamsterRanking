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

const DATA_URL = "./data/records.json";
const POLL_INTERVAL_MS = 8000;
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
const PODIUM_VANISH_MS = 220;
const PODIUM_DROP_MS = 600 + 160; // 애니메이션 길이 + 3위 stagger 지연
const IMPACT_MS = 300;
const THEME_KEY = "hamsterRanking_theme";

let previousIds = new Set<string>();
let previousTop3Ids: string[] = [];
let podiumAnimating = false;
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

  const hadExistingPodium = els.podium.children.length > 0;
  previousTop3Ids = newTop3Ids;

  if (podiumAnimating) {
    // 이미 애니메이션 중이면 굳이 겹쳐서 재생하지 않고 최신 상태로 스냅.
    els.podium.classList.remove("vanish", "impact");
    els.podium.innerHTML = top3.map((r, i) => podiumCard(r, i + 1, false)).join("");
    return;
  }

  podiumAnimating = true;
  try {
    if (hadExistingPodium) {
      await delay(ROW_FLIP_MS);
      els.podium.classList.add("vanish");
      await delay(PODIUM_VANISH_MS);
      els.podium.classList.remove("vanish");
    }

    els.podium.innerHTML = top3.map((r, i) => podiumCard(r, i + 1, true)).join("");
    await delay(PODIUM_DROP_MS);
    els.podium.classList.add("impact");
    await delay(IMPACT_MS);
    els.podium.classList.remove("impact");
  } finally {
    podiumAnimating = false;
  }
}

function render(all: RankRecord[]): void {
  const sorted = sortRecords(all);
  const currentIds = new Set(sorted.map((r) => r.id));

  els.totalCount.textContent = String(sorted.length);
  els.emptyState.style.display = sorted.length === 0 ? "flex" : "none";

  const top3 = sorted.slice(0, 3);
  renderRowLists(sorted);
  void renderPodium(top3);

  previousIds = currentIds;
}

function getCombined(): RankRecord[] {
  const local = loadLocalRecords();
  return mergeRecords(remoteRecords, local);
}

async function fetchRemote(): Promise<void> {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) {
      remoteRecords = data as RankRecord[];
      setLive(true);
    }
  } catch {
    setLive(false);
  }
  render(getCombined());
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
    if (e.key === "hamsterRanking_records_v1") render(getCombined());
  });

  if ("BroadcastChannel" in window) {
    const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    bc.onmessage = (ev: MessageEvent<SyncMessage>) => {
      if (ev.data?.type === "records") render(getCombined());
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
render(getCombined());
listenLocalUpdates();
startPolling();
