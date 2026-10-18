// 기록 제출·신호 조회 서비스 (F-01·F-02·F-04·F-05, D-051·D-054)
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepo } from "../memory-repo";
import { getSignals, submitRecord } from "../service";
import type { Tap } from "../types";

// 2026-10-15(목) 08:00:00 KST
const T = Date.UTC(2026, 9, 14, 23, 0) / 1000;
const taps = (start: number, C = 120, G = 30): Tap[] => [
  { kind: "green", at: start },
  { kind: "red", at: start + G },
  { kind: "green", at: start + C },
];

let repo: MemoryRepo;
beforeEach(() => {
  repo = new MemoryRepo();
  repo.crosswalks.set("A", {
    id: "A",
    groupId: "G1",
    intersectionId: "I1",
    sharedName: "역삼역 3번 출구 앞 · 북쪽 횡단보도",
    endA: [127.036, 37.5],
    endB: [127.0362, 37.5],
    buttonMarks: [],
    createdBy: "u0",
    isPrivate: false,
  });
});

describe("submitRecord", () => {
  it("첫 기록 → 검증 전으로 공개, 내 신호등에 추가 (FR-04-E-01, D-054)", async () => {
    const r = await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(T + 4.8) });
    expect(r).toMatchObject({ ok: true, outcome: "first", verification: "unverified", infoLevel: "fresh" });
    expect(await repo.listUserSignals("u1")).toEqual([{ crosswalkId: "A", alias: null, showAggregate: false, autoSwitched: false }]);
  });

  it("두 번째 사용자 일치 → 확인됨", async () => {
    await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(T + 4.8) });
    const r = await submitRecord(repo, { userId: "u2", crosswalkId: "A", taps: taps(T + 1200 + 5.2) });
    expect(r).toMatchObject({ ok: true, outcome: "match", verification: "confirmed" });
  });

  it("확인됨 + 불일치 → 따로 보관", async () => {
    await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(T + 4.8) });
    await submitRecord(repo, { userId: "u2", crosswalkId: "A", taps: taps(T + 1200 + 4.8) });
    const r = await submitRecord(repo, { userId: "u3", crosswalkId: "A", taps: taps(T + 2400 + 40) });
    expect(r).toMatchObject({ ok: true, outcome: "mismatch" });
  });

  it("기록 시작 시각의 시간대 구간에 저장 (FR-04-E-02)", async () => {
    const start = T + 3600 - 60; // 08:59
    await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(start) });
    expect(repo.records[0].slot).toEqual({ dayType: "weekday", hour: 8 });
  });

  it("측정값이 범위 밖이면 저장 안 함", async () => {
    const r = await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(T, 330, 40) });
    expect(r).toEqual({ ok: false, error: "cycle_out_of_range" });
    expect(repo.records).toHaveLength(0);
  });

  it("기록 제재 중이면 거부 (FR-08-C-01)", async () => {
    repo.sanctions.push({ userId: "u1", scope: "record", until: T + 99999 });
    const r = await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(T), now: T });
    expect(r).toEqual({ ok: false, error: "sanctioned" });
  });

  it("버튼식 확정 신호는 기록을 받지 않는다 (FR-04-D-03)", async () => {
    repo.crosswalks.get("A")!.buttonMarks = ["x", "y"];
    const r = await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(T) });
    expect(r).toEqual({ ok: false, error: "button_signal" });
  });
});

describe("getSignals", () => {
  it("현재 구간 대표값 + 내 기록 + 서버 시각 (FR-02-D-01, FR-02-F)", async () => {
    await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(T + 4.8) });
    await submitRecord(repo, { userId: "u2", crosswalkId: "A", taps: taps(T + 1200 + 4.8) });
    await submitRecord(repo, { userId: "u3", crosswalkId: "A", taps: taps(T + 2400 + 8.0) }); // 위상 차 3.2 → 불일치

    const now = T + 1800; // 08:30
    const [s] = await getSignals(repo, { ids: ["A"], userId: "u3", now });
    expect(s.serverTime).toBe(now);
    expect(s.aggregate).toMatchObject({ C: 120, G: 30 });
    expect(s.verification).toBe("confirmed");
    expect(s.recordCount).toBe(2);
    expect(s.mine).toMatchObject({ C: 120, matchesAggregate: false });
    expect(s.displaySource).toBe("mine");
  });

  it("다른 구간이면 정보 없음, 빌려 쓰지 않음 (FR-02-C-05)", async () => {
    await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(T + 4.8) });
    const [s] = await getSignals(repo, { ids: ["A"], userId: "u1", now: T + 3600 + 600 }); // 09:10
    expect(s.infoLevel).toBe("nodata");
    expect(s.aggregate).toBeNull();
    expect(s.mine).toBeNull();
    expect(s.displaySource).toBe("aggregate");
  });

  it("버튼식 표시 2명 이상이면 buttonType 확정 (D-025)", async () => {
    repo.crosswalks.get("A")!.buttonMarks = ["x", "y"];
    const [s] = await getSignals(repo, { ids: ["A"], now: T });
    expect(s.buttonType).toBe("confirmed");
  });
});

describe("신호 변경 자동 전환 (FR-02-F-04·F-05, D-062)", () => {
  it("교체되면 예전 기록을 보던 사용자는 대표값으로 전환, 끄거나 다시 기록하면 내 기록", async () => {
    const { updateSignal } = await import("../my-signals");
    await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(T + 4.8) });
    await submitRecord(repo, { userId: "u2", crosswalkId: "A", taps: taps(T + 1200 + 4.8) });
    await submitRecord(repo, { userId: "u3", crosswalkId: "A", taps: taps(T + 2400, 100, 30) });
    const r = await submitRecord(repo, { userId: "u4", crosswalkId: "A", taps: taps(T + 2600, 100, 30) });
    expect(r).toMatchObject({ ok: true, outcome: "replaced" });

    const now = T + 3000;
    let [s] = await getSignals(repo, { ids: ["A"], userId: "u1", now });
    expect(s.displaySource).toBe("aggregate");
    expect(s.replacedBySignalChange).toBe(true);
    // 다음 조회에도 유지된다
    [s] = await getSignals(repo, { ids: ["A"], userId: "u1", now: now + 60 });
    expect(s.replacedBySignalChange).toBe(true);

    // 스위치를 끄면 내 기록 + 불일치 (D-062)
    await updateSignal(repo, { userId: "u1", crosswalkId: "A", showAggregate: false });
    [s] = await getSignals(repo, { ids: ["A"], userId: "u1", now });
    expect(s.displaySource).toBe("mine");
    expect(s.replacedBySignalChange).toBe(false);
    expect(s.mine!.matchesAggregate).toBe(false);

    // 새 집계를 만든 사용자는 내 기록 그대로
    [s] = await getSignals(repo, { ids: ["A"], userId: "u3", now });
    expect(s.displaySource).toBe("mine");
  });

  it("자동 전환된 사용자가 다시 기록하면 내 기록으로 (FR-02-F-05)", async () => {
    await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(T + 4.8) });
    await submitRecord(repo, { userId: "u2", crosswalkId: "A", taps: taps(T + 1200 + 4.8) });
    await submitRecord(repo, { userId: "u3", crosswalkId: "A", taps: taps(T + 2400, 100, 30) });
    await submitRecord(repo, { userId: "u4", crosswalkId: "A", taps: taps(T + 2600, 100, 30) });
    await submitRecord(repo, { userId: "u1", crosswalkId: "A", taps: taps(T + 2800, 100, 30) });
    const [s] = await getSignals(repo, { ids: ["A"], userId: "u1", now: T + 3000 });
    expect(s.displaySource).toBe("mine");
    expect(s.replacedBySignalChange).toBe(false);
  });
});
