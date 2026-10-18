// 위치 없는 나만 보기 신호등 (traffic-signal D-074, FR-03-A-07·A-08)
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepo } from "../memory-repo";
import { importSignal } from "../my-signals";
import { registerCrosswalk, registerPrivate, setCrosswalkLocation } from "../register";
import { submitReport } from "../report";
import { getSignals, submitRecord } from "../service";
import { uploadDeviceRecords } from "../upload";
import type { Geocoder } from "../geocoder";
import type { Tap } from "../types";

const T = Date.UTC(2026, 9, 14, 23, 0) / 1000; // 2026-10-15(목) 08:00 KST
const taps = (start: number, C = 120, G = 30): Tap[] => [
  { kind: "green", at: start },
  { kind: "red", at: start + G },
  { kind: "green", at: start + C },
];
const O: [number, number] = [127.0365, 37.5006];
const off = (dLng: number, dLat: number): [number, number] => [O[0] + dLng, O[1] + dLat];
const geocoder: Geocoder = { reverse: async () => ({ place: "역삼역 3번 출구", road: "테헤란로" }) };

let repo: MemoryRepo;
beforeEach(() => (repo = new MemoryRepo()));

async function privateOf(userId: string, name = "회사 앞 사거리") {
  const r = await registerPrivate(repo, { userId, name, taps: taps(T + 4.8), now: T + 200 });
  if (!r.ok || r.status !== "created") throw new Error(JSON.stringify(r));
  return r.crosswalk.id;
}

describe("registerPrivate (FR-03-A-07)", () => {
  it("위치 없이 이름만으로 등록 — 이름은 내 별칭, 나만 보기로 표시", async () => {
    const id = await privateOf("u1");
    const [v] = await getSignals(repo, { ids: [id], userId: "u1", now: T + 300 });
    expect(v).toMatchObject({ isPrivate: true, alias: "회사 앞 사거리", sharedName: null, endA: null });
    expect(v.mine).not.toBeNull();
  });

  it("이름이 비었거나 20자 넘으면 등록하지 않는다 (F-03 E-09)", async () => {
    expect(await registerPrivate(repo, { userId: "u1", name: "  ", taps: taps(T) })).toEqual({ ok: false, error: "invalid_name" });
    expect(await registerPrivate(repo, { userId: "u1", name: "가".repeat(21), taps: taps(T) })).toEqual({ ok: false, error: "invalid_name" });
  });

  it("첫 기록이 저장 불가면 신호등도 남기지 않는다", async () => {
    const r = await registerPrivate(repo, { userId: "u1", name: "집 앞", taps: taps(T, 10, 5) }); // 주기 10초 → 범위 밖
    expect(r.ok).toBe(false);
    expect(repo.crosswalks.size).toBe(0);
  });
});

describe("나만 보기는 등록자에게만 (D-074)", () => {
  it("다른 사용자는 조회·가져오기·기록·신고를 할 수 없다", async () => {
    const id = await privateOf("u1");
    expect(await getSignals(repo, { ids: [id], userId: "u2", now: T })).toEqual([]);
    expect(await importSignal(repo, { userId: "u2", crosswalkId: id })).toEqual({ ok: false, error: "crosswalk_not_found" });
    expect(await submitRecord(repo, { userId: "u2", crosswalkId: id, taps: taps(T + 1000) })).toEqual({ ok: false, error: "crosswalk_not_found" });
    expect(await submitReport(repo, { userId: "u2", crosswalkId: id, kind: "time_mismatch" })).toEqual({ ok: false, error: "crosswalk_not_found" });
  });

  it("지도·주변 조회에 나오지 않고, 본인도 신고 대상이 아니다", async () => {
    const id = await privateOf("u1");
    expect(await getSignals(repo, { bbox: [126, 37, 128, 38], userId: "u1", now: T })).toEqual([]);
    expect(await repo.findCrosswalksNear(O, 1e6)).toEqual([]);
    expect(await submitReport(repo, { userId: "u1", crosswalkId: id, kind: "location_wrong" })).toEqual({ ok: false, error: "private_signal" });
  });
});

describe("setCrosswalkLocation (FR-03-A-08)", () => {
  it("위치를 지정하면 공유 횡단보도가 되고, 기록·별칭이 옮겨지고, 나만 보기는 지워진다", async () => {
    const id = await privateOf("u1");
    await submitRecord(repo, { userId: "u1", crosswalkId: id, taps: taps(T + 1200 + 4.8) });
    const r = await setCrosswalkLocation(repo, { userId: "u1", geocoder, crosswalkId: id, endA: off(0, 0), endB: off(2e-4, 0), now: T + 3600 });
    if (!r.ok || r.status !== "created") throw new Error(JSON.stringify(r));
    expect(repo.crosswalks.has(id)).toBe(false);
    const [v] = await getSignals(repo, { ids: [r.crosswalk.id], userId: "u1", now: T + 1800 });
    expect(v).toMatchObject({ isPrivate: false, alias: "회사 앞 사거리", sharedName: "역삼역 3번 출구 앞 횡단보도" });
    expect(repo.records.filter((x) => x.crosswalkId === r.crosswalk.id)).toHaveLength(2);
    expect(await getSignals(repo, { ids: [r.crosswalk.id], userId: "u2", now: T + 1800 })).toHaveLength(1); // 이제 공유
  });

  it("근처에 비슷한 횡단보도가 있으면 먼저 제안하고, 고르면 그쪽으로 기록을 옮긴다 (F-03 E-11)", async () => {
    const existing = await registerCrosswalk(repo, { userId: "u9", geocoder, now: T, endA: off(0, 0), endB: off(2e-4, 0), taps: taps(T + 4.8) });
    if (!existing.ok || existing.status !== "created") throw new Error();
    const id = await privateOf("u1");
    const s = await setCrosswalkLocation(repo, { userId: "u1", geocoder, crosswalkId: id, endA: off(0, 0.3e-4), endB: off(2e-4, 0.3e-4) });
    expect(s).toMatchObject({ ok: true, status: "suggest_existing" });
    expect(repo.crosswalks.has(id)).toBe(true); // 제안만 — 아직 그대로

    const m = await setCrosswalkLocation(repo, { userId: "u1", geocoder, crosswalkId: id, endA: off(0, 0.3e-4), endB: off(2e-4, 0.3e-4), mergeInto: existing.crosswalk.id });
    expect(m).toMatchObject({ ok: true, status: "merged" });
    expect(repo.crosswalks.has(id)).toBe(false);
    const [v] = await getSignals(repo, { ids: [existing.crosswalk.id], userId: "u1", now: T + 300 });
    expect(v.verification).toBe("confirmed"); // u9 + u1 두 명
    expect(v.alias).toBe("회사 앞 사거리");
  });

  it("남의 나만 보기에는 위치를 지정할 수 없다", async () => {
    const id = await privateOf("u1");
    expect(await setCrosswalkLocation(repo, { userId: "u2", geocoder, crosswalkId: id, endA: off(0, 0), endB: off(2e-4, 0) })).toEqual({
      ok: false,
      error: "crosswalk_not_found",
    });
  });
});

describe("업로드 (FR-08-D-04)", () => {
  it("위치 없는 기기 신호등은 중복 판정 없이 나만 보기로 올린다", async () => {
    const res = await uploadDeviceRecords(repo, { userId: "u1", geocoder, now: T + 3600, items: [{ name: "집 앞", records: [taps(T + 4.8), taps(T + 1200 + 4.8)] }] });
    expect(res).toMatchObject({ ok: true, created: 1, skipped: 0 });
    const [cw] = [...repo.crosswalks.values()];
    expect(cw.isPrivate).toBe(true);
    expect(repo.records).toHaveLength(2);
  });
});
