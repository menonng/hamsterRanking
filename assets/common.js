// 공통 타입 및 유틸리티 — 랭킹 화면(ranking.ts)과 입력 화면(admin.ts)이 함께 사용한다.
export const STORAGE_KEYS = {
    records: "hamsterRanking_records_v1",
    ghToken: "hamsterRanking_gh_token",
    ghConfig: "hamsterRanking_gh_config",
    txtLog: "hamsterRanking_txt_log",
    fileHandleFlag: "hamsterRanking_fs_linked",
};
export const BROADCAST_CHANNEL_NAME = "hamster-ranking-sync";
/** 학교,이름,기록(초),태그 형식의 한 줄을 파싱한다. */
export function parseRecordLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    const parts = trimmed.split(",").map((s) => s.trim());
    const school = parts[0] ?? "";
    const name = parts[1] ?? "";
    const timeRaw = parts[2] ?? "";
    const tag = parts[3] ?? "";
    const time = Number(timeRaw);
    if (!name || !Number.isFinite(time) || time <= 0) {
        return null;
    }
    return { school, name, time, tag };
}
export function isAIRecord(record) {
    return String(record.tag ?? "").trim() === "1";
}
/** 사람(비-AI) 기록은 이름 2번째 글자(인덱스 1)를 *로 가린다. 이미 가려진 이름에 다시 적용해도 결과가 같다. */
export function maskHumanName(record) {
    if (isAIRecord(record) || record.name.length < 2)
        return record.name;
    return record.name.slice(0, 1) + "*" + record.name.slice(2);
}
/**
 * 저장된(또는 손으로 고친) 기록을 현재 스키마로 정리한다: 필드 타입 보정, 이름 마스킹,
 * 더 이상 쓰지 않는 필드(학년/나이 등) 제거. 필수 값이 없거나 기록이 숫자가 아니면 null.
 */
export function normalizeRecord(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const r = raw;
    const id = String(r.id ?? "").trim();
    const name = String(r.name ?? "").trim();
    const time = Number(r.time);
    if (!id || !name || !Number.isFinite(time) || time <= 0)
        return null;
    const record = {
        id,
        school: String(r.school ?? "").trim(),
        name,
        time,
        tag: String(r.tag ?? "").trim(),
        createdAt: String(r.createdAt ?? ""),
    };
    return { ...record, name: maskHumanName(record) };
}
/** 배열이 아니면 빈 목록, 잘못된 항목은 조용히 버린다. */
export function normalizeRecords(list) {
    if (!Array.isArray(list))
        return [];
    return list.map(normalizeRecord).filter((r) => r !== null);
}
function trimTrailingZeros(fixed) {
    return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}
/** 초 단위(밀리초까지) 입력을 "M분 S.SS초"(1분 미만이면 "S.SS초") 형태로 표시한다. */
export function formatTime(totalSeconds) {
    const rounded = Math.round(totalSeconds * 1000) / 1000;
    const minutes = Math.floor(rounded / 60);
    const secs = rounded - minutes * 60;
    const secsStr = trimTrailingZeros(secs.toFixed(3));
    return minutes > 0 ? `${minutes}분 ${secsStr}초` : `${secsStr}초`;
}
/** 선두와의 기록 차이를 "+M분 S.SS초" 형태로 표시한다. */
export function formatGap(gapSeconds) {
    return `+${formatTime(gapSeconds)}`;
}
export function uid() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
/** 기록순(오름차순) 정렬. 동시간이면 먼저 등록된 기록이 상위. */
export function sortRecords(records) {
    return [...records].sort((a, b) => {
        if (a.time !== b.time)
            return a.time - b.time;
        return a.createdAt.localeCompare(b.createdAt);
    });
}
/** id 기준으로 두 기록 목록을 병합한다. 동일 id는 최신(createdAt) 쪽을 채택. */
export function mergeRecords(a, b) {
    const map = new Map();
    for (const r of normalizeRecords([...a, ...b])) {
        const existing = map.get(r.id);
        if (!existing || r.createdAt >= existing.createdAt)
            map.set(r.id, r);
    }
    return sortRecords([...map.values()]);
}
export function loadLocalRecords() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.records);
        if (!raw)
            return [];
        return normalizeRecords(JSON.parse(raw));
    }
    catch {
        return [];
    }
}
export function saveLocalRecords(records) {
    try {
        localStorage.setItem(STORAGE_KEYS.records, JSON.stringify(records));
    }
    catch {
        // localStorage 사용 불가(사파리 프라이빗 모드 등) 시 조용히 무시
    }
}
export function toTxtLine(r) {
    const tagLabel = isAIRecord(r) ? "AI" : "사람";
    return `${r.createdAt} | ${r.school} | ${r.name} | ${formatTime(r.time)} | ${tagLabel}`;
}
export function recordsToTxt(records) {
    const header = "# 시각 | 학교 | 이름 | 기록 | 구분";
    const lines = [...records]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(toTxtLine);
    return [header, ...lines].join("\n") + "\n";
}
//# sourceMappingURL=common.js.map