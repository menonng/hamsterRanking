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

const MEDALS = ["🥇", "🥈", "🥉"];

let previousIds = new Set<string>();
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

function podiumCard(r: RankRecord, rank: number, isNew: boolean): string {
  const color = PALETTE[(rank - 1) % PALETTE.length];
  const cls = `podium-card rank-${rank}${isNew ? " enter" : ""}`;
  return `
    <div class="${cls}" style="--accent:${color}" data-id="${r.id}">
      <div class="medal">${MEDALS[rank - 1]}</div>
      <div class="podium-rank">${rank}위</div>
      <div class="podium-name">${escapeHtml(r.name)}${aiBadge(r)}</div>
      <div class="podium-meta">${escapeHtml(metaLine(r))}</div>
      <div class="podium-time">${formatTime(r.time)}</div>
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

function render(all: RankRecord[]): void {
  const sorted = sortRecords(all);
  const currentIds = new Set(sorted.map((r) => r.id));

  els.totalCount.textContent = String(sorted.length);
  els.emptyState.style.display = sorted.length === 0 ? "flex" : "none";

  const top3 = sorted.slice(0, 3);
  const mid = sorted.slice(3, 10);
  const rest = sorted.slice(10);

  els.podium.innerHTML = top3
    .map((r, i) => podiumCard(r, i + 1, !previousIds.has(r.id)))
    .join("");

  els.midList.innerHTML = mid
    .map((r, i) => listRow(r, i + 4, !previousIds.has(r.id), true))
    .join("");

  els.restSection.style.display = rest.length > 0 ? "block" : "none";
  els.restList.innerHTML = rest
    .map((r, i) => listRow(r, i + 11, !previousIds.has(r.id), false))
    .join("");

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

render(getCombined());
listenLocalUpdates();
startPolling();
