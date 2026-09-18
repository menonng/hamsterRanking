// 입력 전용 화면 — 부스 운영 기기에서만 사용한다. (URL을 공유하지 말 것)
import {
  RankRecord,
  BROADCAST_CHANNEL_NAME,
  STORAGE_KEYS,
  isAIRecord,
  loadLocalRecords,
  parseRecordLine,
  recordsToTxt,
  saveLocalRecords,
  sortRecords,
  uid,
} from "./common.js";

interface GhConfig {
  owner: string;
  repo: string;
  branch: string;
  jsonPath: string;
  txtPath: string;
}

const DEFAULT_GH_CONFIG: GhConfig = {
  owner: "menonng",
  repo: "hamsterranking",
  branch: "main",
  jsonPath: "data/records.json",
  txtPath: "data/records.txt",
};

const bc = "BroadcastChannel" in window ? new BroadcastChannel(BROADCAST_CHANNEL_NAME) : null;

const els = {
  pinGate: document.getElementById("pinGate") as HTMLDivElement,
  pinInput: document.getElementById("pinInput") as HTMLInputElement,
  pinSubmit: document.getElementById("pinSubmit") as HTMLButtonElement,
  pinHint: document.getElementById("pinHint") as HTMLParagraphElement,
  appRoot: document.getElementById("appRoot") as HTMLDivElement,

  inputArea: document.getElementById("inputArea") as HTMLTextAreaElement,
  addBtn: document.getElementById("addBtn") as HTMLButtonElement,
  formError: document.getElementById("formError") as HTMLDivElement,

  recentList: document.getElementById("recentList") as HTMLDivElement,
  totalCount: document.getElementById("totalCount") as HTMLSpanElement,
  undoBtn: document.getElementById("undoBtn") as HTMLButtonElement,

  ghOwner: document.getElementById("ghOwner") as HTMLInputElement,
  ghRepo: document.getElementById("ghRepo") as HTMLInputElement,
  ghBranch: document.getElementById("ghBranch") as HTMLInputElement,
  ghToken: document.getElementById("ghToken") as HTMLInputElement,
  saveSettingsBtn: document.getElementById("saveSettingsBtn") as HTMLButtonElement,
  clearTokenBtn: document.getElementById("clearTokenBtn") as HTMLButtonElement,
  syncStatus: document.getElementById("syncStatus") as HTMLSpanElement,

  fsLinkBtn: document.getElementById("fsLinkBtn") as HTMLButtonElement,
  fsStatus: document.getElementById("fsStatus") as HTMLSpanElement,
  downloadTxtBtn: document.getElementById("downloadTxtBtn") as HTMLButtonElement,
};

let records: RankRecord[] = loadLocalRecords();
let lastAddedIds: string[] = [];
let fileHandle: FileSystemFileHandle | null = null;

// ---------- PIN 게이트 (기기 단속용 1차 방어선) ----------

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getStoredPinHash(): string | null {
  return localStorage.getItem("hamsterRanking_pin_hash");
}

async function handlePinSubmit(): Promise<void> {
  const value = els.pinInput.value.trim();
  if (value.length < 4) {
    els.pinHint.textContent = "PIN은 4자리 이상 입력해주세요.";
    return;
  }
  const stored = getStoredPinHash();
  const hash = await sha256Hex(value);

  if (!stored) {
    localStorage.setItem("hamsterRanking_pin_hash", hash);
    unlock();
    return;
  }
  if (stored === hash) {
    unlock();
  } else {
    els.pinHint.textContent = "PIN이 일치하지 않습니다.";
    els.pinInput.value = "";
  }
}

function unlock(): void {
  sessionStorage.setItem("hamsterRanking_unlocked", "1");
  els.pinGate.style.display = "none";
  els.appRoot.style.display = "block";
}

function initPinGate(): void {
  const stored = getStoredPinHash();
  els.pinHint.textContent = stored
    ? "이 기기의 운영자 PIN을 입력하세요."
    : "처음 사용하시는군요! 이 기기에서 사용할 PIN을 새로 설정하세요 (4자리 이상).";

  if (sessionStorage.getItem("hamsterRanking_unlocked") === "1") {
    unlock();
    return;
  }
  els.pinSubmit.addEventListener("click", () => void handlePinSubmit());
  els.pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void handlePinSubmit();
  });
}

// ---------- 기록 입력 ----------

function renderRecent(): void {
  els.totalCount.textContent = String(records.length);
  const recent = [...records]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);

  els.recentList.innerHTML = recent
    .map((r) => {
      const aiTag = isAIRecord(r) ? `<span class="ai-badge">🤖 AI</span>` : "";
      const time = new Date(r.createdAt).toLocaleTimeString("ko-KR");
      return `<div class="recent-row">
        <span class="recent-time">${time}</span>
        <span class="recent-name">${escapeHtml(r.name)}${aiTag}</span>
        <span class="recent-meta">${escapeHtml(r.school)} ${escapeHtml(r.grade)} · ${r.time}초</span>
      </div>`;
    })
    .join("");

  els.undoBtn.disabled = lastAddedIds.length === 0;
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

function persistAndBroadcast(): void {
  saveLocalRecords(sortRecords(records));
  bc?.postMessage({ type: "records", records });
  void syncToGitHub();
  void writeLocalFile();
}

function handleAdd(): void {
  const lines = els.inputArea.value.split("\n");
  const errors: string[] = [];
  const added: RankRecord[] = [];

  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const parsed = parseRecordLine(line);
    if (!parsed) {
      errors.push(`${i + 1}번째 줄: 형식 오류 (학교,학년,나이,이름,기록,태그) → "${line}"`);
      return;
    }
    const record: RankRecord = { ...parsed, id: uid(), createdAt: new Date().toISOString() };
    added.push(record);
  });

  if (errors.length > 0) {
    els.formError.textContent = errors.join("\n");
    els.formError.style.display = "block";
    if (added.length === 0) return;
  } else {
    els.formError.style.display = "none";
  }

  records = [...records, ...added];
  lastAddedIds = added.map((r) => r.id);
  els.inputArea.value = "";
  renderRecent();
  persistAndBroadcast();
}

function handleUndo(): void {
  if (lastAddedIds.length === 0) return;
  const idsToRemove = new Set(lastAddedIds);
  records = records.filter((r) => !idsToRemove.has(r.id));
  lastAddedIds = [];
  renderRecent();
  persistAndBroadcast();
}

// ---------- GitHub 동기화 (이 기기가 유일한 쓰기 경로) ----------

function loadGhConfig(): GhConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ghConfig);
    if (!raw) return DEFAULT_GH_CONFIG;
    return { ...DEFAULT_GH_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_GH_CONFIG;
  }
}

function saveGhConfig(cfg: GhConfig): void {
  localStorage.setItem(STORAGE_KEYS.ghConfig, JSON.stringify(cfg));
}

function loadToken(): string {
  return localStorage.getItem(STORAGE_KEYS.ghToken) ?? "";
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

async function getFileSha(cfg: GhConfig, token: string, path: string): Promise<string | undefined> {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${cfg.branch}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`sha 조회 실패 (${res.status})`);
  const data = await res.json();
  return data.sha as string;
}

async function putFile(cfg: GhConfig, token: string, path: string, content: string, message: string): Promise<void> {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  const sha = await getFileSha(cfg, token, path);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: utf8ToBase64(content),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub 저장 실패 (${res.status}): ${body}`);
  }
}

let syncing = false;
let pendingResync = false;

async function syncToGitHub(): Promise<void> {
  const token = loadToken();
  if (!token) {
    els.syncStatus.textContent = "GitHub 미연동 (로컬에만 저장됨)";
    els.syncStatus.className = "status-warn";
    return;
  }
  if (syncing) {
    pendingResync = true;
    return;
  }
  syncing = true;
  els.syncStatus.textContent = "동기화 중...";
  els.syncStatus.className = "status-busy";
  try {
    const cfg = loadGhConfig();
    const sorted = sortRecords(records);
    await putFile(cfg, token, cfg.jsonPath, JSON.stringify(sorted, null, 2), "랭킹 갱신");
    await putFile(cfg, token, cfg.txtPath, recordsToTxt(sorted), "랭킹 로그 갱신");
    els.syncStatus.textContent = `GitHub 동기화 완료 (${new Date().toLocaleTimeString("ko-KR")})`;
    els.syncStatus.className = "status-ok";
  } catch (e) {
    els.syncStatus.textContent = `동기화 실패: ${(e as Error).message}`;
    els.syncStatus.className = "status-fail";
  } finally {
    syncing = false;
    if (pendingResync) {
      pendingResync = false;
      void syncToGitHub();
    }
  }
}

function initSettingsPanel(): void {
  const cfg = loadGhConfig();
  els.ghOwner.value = cfg.owner;
  els.ghRepo.value = cfg.repo;
  els.ghBranch.value = cfg.branch;
  els.ghToken.value = loadToken() ? "••••••••••••" : "";

  els.saveSettingsBtn.addEventListener("click", () => {
    saveGhConfig({
      owner: els.ghOwner.value.trim() || DEFAULT_GH_CONFIG.owner,
      repo: els.ghRepo.value.trim() || DEFAULT_GH_CONFIG.repo,
      branch: els.ghBranch.value.trim() || DEFAULT_GH_CONFIG.branch,
      jsonPath: DEFAULT_GH_CONFIG.jsonPath,
      txtPath: DEFAULT_GH_CONFIG.txtPath,
    });
    const tokenInput = els.ghToken.value.trim();
    if (tokenInput && !tokenInput.startsWith("••")) {
      localStorage.setItem(STORAGE_KEYS.ghToken, tokenInput);
      els.ghToken.value = "••••••••••••";
    }
    els.syncStatus.textContent = "설정이 저장되었습니다.";
    els.syncStatus.className = "status-ok";
  });

  els.clearTokenBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEYS.ghToken);
    els.ghToken.value = "";
    els.syncStatus.textContent = "토큰이 삭제되었습니다 (이 기기는 더 이상 GitHub에 쓰지 않습니다).";
    els.syncStatus.className = "status-warn";
  });
}

// ---------- 로컬 txt 파일 실시간 기록 (File System Access API, 지원 브라우저 한정) ----------

async function writeLocalFile(): Promise<void> {
  localStorage.setItem(STORAGE_KEYS.txtLog, recordsToTxt(sortRecords(records)));
  if (!fileHandle) return;
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(recordsToTxt(sortRecords(records)));
    await writable.close();
    els.fsStatus.textContent = "로컬 파일에 실시간 저장 중";
  } catch (e) {
    els.fsStatus.textContent = `로컬 파일 쓰기 실패: ${(e as Error).message}`;
  }
}

function initFileSystemLink(): void {
  if (!("showSaveFilePicker" in window)) {
    els.fsLinkBtn.disabled = true;
    els.fsStatus.textContent = "이 브라우저는 로컬 파일 실시간 저장을 지원하지 않습니다 (Chrome/Edge 권장). 다운로드 버튼을 이용하세요.";
    return;
  }
  els.fsLinkBtn.addEventListener("click", async () => {
    try {
      fileHandle = await (window as unknown as {
        showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker({
        suggestedName: "hamster_ranking_log.txt",
        types: [{ description: "Text", accept: { "text/plain": [".txt"] } }],
      });
      await writeLocalFile();
    } catch {
      // 사용자가 선택을 취소한 경우 등은 무시
    }
  });

  els.downloadTxtBtn.addEventListener("click", () => {
    const blob = new Blob([recordsToTxt(sortRecords(records))], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hamster_ranking_log.txt";
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ---------- 초기화 ----------

initPinGate();
initSettingsPanel();
initFileSystemLink();
renderRecent();

els.addBtn.addEventListener("click", handleAdd);
els.undoBtn.addEventListener("click", handleUndo);
els.inputArea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleAdd();
});
