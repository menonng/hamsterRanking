// 공통 타입 및 유틸리티 — 랭킹 화면(ranking.ts)과 입력 화면(admin.ts)이 함께 사용한다.

export interface RankRecord {
  id: string;
  school: string;
  grade: string;
  age: string;
  name: string;
  time: number; // 기록 (초), 낮을수록 상위 랭크
  tag: string; // "1" = 인공지능, 그 외("0", "") = 사람
  createdAt: string; // ISO timestamp, 동시간 기록의 동점 처리 기준
}

export const STORAGE_KEYS = {
  records: "hamsterRanking_records_v1",
  ghToken: "hamsterRanking_gh_token",
  ghConfig: "hamsterRanking_gh_config",
  txtLog: "hamsterRanking_txt_log",
  fileHandleFlag: "hamsterRanking_fs_linked",
} as const;

export const BROADCAST_CHANNEL_NAME = "hamster-ranking-sync";

export type SyncMessage =
  | { type: "records"; records: RankRecord[] }
  | { type: "ping" };

/** 학교,학년,나이,이름,기록(초),태그 형식의 한 줄을 파싱한다. */
export function parseRecordLine(line: string): Omit<RankRecord, "id" | "createdAt"> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(",").map((s) => s.trim());
  const school = parts[0] ?? "";
  const grade = parts[1] ?? "";
  const age = parts[2] ?? "";
  const name = parts[3] ?? "";
  const timeRaw = parts[4] ?? "";
  const tag = parts[5] ?? "";

  const time = Number(timeRaw);
  if (!name || !Number.isFinite(time) || time <= 0) {
    return null;
  }

  return { school, grade, age, name, time, tag };
}

export function isAIRecord(record: Pick<RankRecord, "tag">): boolean {
  return record.tag.trim() === "1";
}

export function formatTime(time: number): string {
  return Number.isInteger(time) ? `${time}` : time.toFixed(2);
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 기록순(오름차순) 정렬. 동시간이면 먼저 등록된 기록이 상위. */
export function sortRecords(records: RankRecord[]): RankRecord[] {
  return [...records].sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** id 기준으로 두 기록 목록을 병합한다. 동일 id는 최신(createdAt) 쪽을 채택. */
export function mergeRecords(a: RankRecord[], b: RankRecord[]): RankRecord[] {
  const map = new Map<string, RankRecord>();
  for (const r of [...a, ...b]) {
    const existing = map.get(r.id);
    if (!existing || r.createdAt >= existing.createdAt) {
      map.set(r.id, r);
    }
  }
  return sortRecords([...map.values()]);
}

export function loadLocalRecords(): RankRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.records);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RankRecord[];
  } catch {
    return [];
  }
}

export function saveLocalRecords(records: RankRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.records, JSON.stringify(records));
  } catch {
    // localStorage 사용 불가(사파리 프라이빗 모드 등) 시 조용히 무시
  }
}

export function toTxtLine(r: RankRecord): string {
  const tagLabel = isAIRecord(r) ? "AI" : "사람";
  return `${r.createdAt} | ${r.school} | ${r.grade} | ${r.age} | ${r.name} | ${formatTime(r.time)}초 | ${tagLabel}`;
}

export function recordsToTxt(records: RankRecord[]): string {
  const header = "# 시각 | 학교 | 학년 | 나이 | 이름 | 기록 | 구분";
  const lines = [...records]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toTxtLine);
  return [header, ...lines].join("\n") + "\n";
}
