// 공통 타입 및 유틸리티 — 랭킹 화면(ranking.ts)과 입력 화면(admin.ts)이 함께 사용한다.

export interface RankRecord {
  id: string;
  school: string;
  name: string;
  time: number; // 기록 (초), 낮을수록 상위 랭크
  tag: string; // "1" = 인공지능, "2" = 가명(사람이지만 마스킹하지 않음), 그 외("0", "") = 사람(마스킹함)
  grade: string; // 학년 (선택, 빈 문자열 허용). 공개 여부는 랭킹 사이트 쪽 설정(SHOW_GRADE)으로 결정
  age: string; // 나이 (선택, 빈 문자열 허용). 공개 여부는 랭킹 사이트 쪽 설정(SHOW_AGE)으로 결정
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

/** 학교,이름,기록(초),태그[,학년,나이] 형식의 한 줄을 파싱한다. 학년·나이는 선택(뒤에 덧붙임, 생략 가능). */
export function parseRecordLine(line: string): Omit<RankRecord, "id" | "createdAt"> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(",").map((s) => s.trim());
  const school = parts[0] ?? "";
  const name = parts[1] ?? "";
  const timeRaw = parts[2] ?? "";
  const tag = parts[3] ?? "";
  const grade = parts[4] ?? "";
  const age = parts[5] ?? "";

  const time = Number(timeRaw);
  if (!name || !Number.isFinite(time) || time <= 0) {
    return null;
  }

  return { school, name, time, tag, grade, age };
}

export function isAIRecord(record: Pick<RankRecord, "tag">): boolean {
  return String(record.tag ?? "").trim() === "1";
}

/** 태그 "2" = 가명(관리자가 미리 실명이 아닌 이름으로 입력했다는 표시). 이 경우 마스킹하지 않는다. */
export function isPseudonymRecord(record: Pick<RankRecord, "tag">): boolean {
  return String(record.tag ?? "").trim() === "2";
}

/** 사람(비-AI, 비-가명) 기록은 이름 2번째 글자(인덱스 1)를 *로 가린다. 이미 가려진 이름에 다시 적용해도 결과가 같다. */
export function maskHumanName(record: Pick<RankRecord, "name" | "tag">): string {
  if (isAIRecord(record) || isPseudonymRecord(record) || record.name.length < 2) return record.name;
  return record.name.slice(0, 1) + "*" + record.name.slice(2);
}

/**
 * 저장된(또는 손으로 고친) 기록을 현재 스키마로 정리한다: 필드 타입 보정, 이름 마스킹,
 * 더 이상 쓰지 않는 필드(학년/나이 등) 제거. 필수 값이 없거나 기록이 숫자가 아니면 null.
 */
export function normalizeRecord(raw: unknown): RankRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const name = String(r.name ?? "").trim();
  const time = Number(r.time);
  if (!id || !name || !Number.isFinite(time) || time <= 0) return null;
  const record: RankRecord = {
    id,
    school: String(r.school ?? "").trim(),
    name,
    time,
    tag: String(r.tag ?? "").trim(),
    grade: String(r.grade ?? "").trim(),
    age: String(r.age ?? "").trim(),
    createdAt: String(r.createdAt ?? ""),
  };
  return { ...record, name: maskHumanName(record) };
}

/** 배열이 아니면 빈 목록, 잘못된 항목은 조용히 버린다. */
export function normalizeRecords(list: unknown): RankRecord[] {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeRecord).filter((r): r is RankRecord => r !== null);
}

function trimTrailingZeros(fixed: string): string {
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/** 초 단위(밀리초까지) 입력을 "M분 S.SS초"(1분 미만이면 "S.SS초") 형태로 표시한다. */
export function formatTime(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds * 1000) / 1000;
  const minutes = Math.floor(rounded / 60);
  const secs = rounded - minutes * 60;
  const secsStr = trimTrailingZeros(secs.toFixed(3));
  return minutes > 0 ? `${minutes}분 ${secsStr}초` : `${secsStr}초`;
}

/** 선두와의 기록 차이를 "+M분 S.SS초" 형태로 표시한다. */
export function formatGap(gapSeconds: number): string {
  return `+${formatTime(gapSeconds)}`;
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
  for (const r of normalizeRecords([...a, ...b])) {
    const existing = map.get(r.id);
    if (!existing || r.createdAt >= existing.createdAt) map.set(r.id, r);
  }
  return sortRecords([...map.values()]);
}

export function loadLocalRecords(): RankRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.records);
    if (!raw) return [];
    return normalizeRecords(JSON.parse(raw));
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
  const tagLabel = isAIRecord(r) ? "AI" : isPseudonymRecord(r) ? "가명" : "사람";
  return `${r.createdAt} | ${r.school} | ${r.grade} | ${r.age} | ${r.name} | ${formatTime(r.time)} | ${tagLabel}`;
}

export function recordsToTxt(records: RankRecord[]): string {
  const header = "# 시각 | 학교 | 학년 | 나이 | 이름 | 기록 | 구분";
  const lines = [...records]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toTxtLine);
  return [header, ...lines].join("\n") + "\n";
}
