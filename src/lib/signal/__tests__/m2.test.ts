// M2 서버: 등록(F-03)·신고(F-06)·내 신호등(D-050·D-053·D-058)·업로드(FR-08-D)·버튼식(D-025)
import { beforeEach, describe, expect, it } from "vitest";
import { directionLabel, distanceM, lineBearingDiff } from "../geo";
import { MemoryRepo } from "../memory-repo";
import { markButton } from "../button";
import { registerCrosswalk } from "../register";
import { submitReport } from "../report";
import { importSignal, removeSignal, updateSignal } from "../my-signals";
import { uploadDeviceRecords } from "../upload";
import { getSignals } from "../service";
import type { Geocoder } from "../geocoder";
import type { Tap } from "../types";

// 2026-10-15(목) 08:00 KST
const T = Date.UTC(2026, 9, 14, 23, 0) / 1000;
const taps = (start: number, C = 120, G = 30): Tap[] => [
  { kind: "green", at: start },
  { kind: "red", at: start + G },
  { kind: "green", at: start + C },
];
// 역삼역 부근. 위도 1e-4 ≈ 11.1m, 경도 1e-4 ≈ 8.8m
const O: [number, number] = [127.0365, 37.5006];
const off = (dLng: number, dLat: number): [number, number] => [O[0] + dLng, O[1] + dLat];
const geocoder: Geocoder = { reverse: async () => ({ place: "역삼역 3번 출구", road: "테헤란로" }) };

let repo: MemoryRepo;
beforeEach(() => (repo = new MemoryRepo()));

describe("geo", () => {
  it("거리·방향 차이", () => {
    expect(distanceM(off(0, 0), off(0, 1e-4))).toBeCloseTo(11.1, 0);
    expect(lineBearingDiff([off(0, 0), off(2e-4, 0)], [off(2e-4, 0), off(0, 0)])).toBeLessThan(0.01); // 방향 없는 선 (대원 계산 오차만)
  });
  it("교차로 중심 기준 4방위", () => {
    expect(directionLabel(off(0, 0), off(0, 2e-4))).toBe("북쪽");
    expect(directionLabel(off(0, 0), off(3e-4, 0))).toBe("동쪽");
  });
});

describe("registerCrosswalk (F-03)", () => {
  const base = { userId: "u1", geocoder, now: T };

  it("새 교차로·단독 그룹, 첫 기록과 함께 확정, 공유 이름 방향 없음 (FR-03-D-06)", async () => {
    const r = await registerCrosswalk(repo, { ...base, endA: off(0, 0), endB: off(2e-4, 0), taps: taps(T + 4.8) });
    expect(r.ok).toBe(true);
    if (!r.ok || r.status !== "created") throw new Error();
    expect(r.crosswalk.sharedName).toBe("역삼역 3번 출구 앞 횡단보도");
    expect(await repo.listUserSignals("u1")).toHaveLength(1); // FR-03-D-02 내 신호등
  });

  it("길이 3~80m 밖이면 거부 (FR-03-A-03)", async () => {
    const r = await registerCrosswalk(repo, { ...base, endA: off(0, 0), endB: off(1e-5, 0), taps: taps(T) });
    expect(r).toEqual({ ok: false, error: "length_out_of_range" });
  });

  it("15m·20° 안 기존 횡단보도 → 먼저 제안 (FR-03-B-01)", async () => {
    await registerCrosswalk(repo, { ...base, endA: off(0, 0), endB: off(2e-4, 0), taps: taps(T + 4.8) });
    const r = await registerCrosswalk(repo, { ...base, userId: "u2", endA: off(0, 0.5e-4), endB: off(2e-4, 0.5e-4), taps: taps(T + 4.8) });
    expect(r.ok && r.status === "suggest_existing").toBe(true);
  });

  it("제안을 거절하면 새로 등록, 40m 안이면 같은 교차로 + 방향 붙은 이름 (FR-03-B-03·B-04)", async () => {
    const first = await registerCrosswalk(repo, { ...base, endA: off(-1e-4, 1.5e-4), endB: off(1e-4, 1.5e-4), taps: taps(T + 4.8) });
    const r = await registerCrosswalk(repo, {
      ...base,
      endA: off(1.5e-4, -1e-4),
      endB: off(1.5e-4, 1e-4),
      taps: taps(T + 64.8),
      skipSuggestion: true,
    });
    if (!first.ok || first.status !== "created" || !r.ok || r.status !== "created") throw new Error();
    expect(r.crosswalk.intersectionId).toBe(first.crosswalk.intersectionId);
    expect(r.crosswalk.groupId).not.toBe(first.crosswalk.groupId);
    expect(r.crosswalk.sharedName).toMatch(/^역삼역 3번 출구 앞 · .+쪽 횡단보도$/);
  });

  it("같이 켜짐 합류 + 첫 기록 일치 → 같은 그룹 (FR-03-C-04·C-06)", async () => {
    const a = await registerCrosswalk(repo, { ...base, endA: off(-1e-4, 1.5e-4), endB: off(1e-4, 1.5e-4), taps: taps(T + 4.8) });
    if (!a.ok || a.status !== "created") throw new Error();
    const b = await registerCrosswalk(repo, {
      ...base,
      userId: "u2",
      endA: off(-1e-4, -1.5e-4),
      endB: off(1e-4, -1.5e-4),
      taps: taps(T + 600 + 4.8),
      joinCrosswalkId: a.crosswalk.id,
      skipSuggestion: true,
    });
    if (!b.ok || b.status !== "created") throw new Error();
    expect(b.crosswalk.groupId).toBe(a.crosswalk.groupId);
    expect(b.joinRejected).toBe(false);
  });

  it("AC-03-C-05-1 합류 + 첫 기록 불일치 → 단독 그룹, 기존 그룹 의심 수 그대로", async () => {
    const a = await registerCrosswalk(repo, { ...base, endA: off(-1e-4, 1.5e-4), endB: off(1e-4, 1.5e-4), taps: taps(T + 4.8) });
    if (!a.ok || a.status !== "created") throw new Error();
    const b = await registerCrosswalk(repo, {
      ...base,
      userId: "u2",
      endA: off(-1e-4, -1.5e-4),
      endB: off(1e-4, -1.5e-4),
      taps: taps(T + 600 + 4.8, 100, 30),
      joinCrosswalkId: a.crosswalk.id,
      skipSuggestion: true,
    });
    if (!b.ok || b.status !== "created") throw new Error();
    expect(b.joinRejected).toBe(true);
    expect(b.crosswalk.groupId).not.toBe(a.crosswalk.groupId);
    const [s] = await getSignals(repo, { ids: [a.crosswalk.id], now: T + 1800 });
    expect(s.infoLevel).toBe("fresh");
  });

  it("전방향 동시 보행 → 교차로 전체 한 그룹 (FR-03-C-03)", async () => {
    const a = await registerCrosswalk(repo, { ...base, endA: off(-1e-4, 1.5e-4), endB: off(1e-4, 1.5e-4), taps: taps(T + 4.8) });
    if (!a.ok || a.status !== "created") throw new Error();
    const d = await registerCrosswalk(repo, {
      ...base,
      endA: off(-1e-4, -1e-4),
      endB: off(1e-4, 1e-4),
      taps: taps(T + 4.8 + 120),
      scramble: true,
      skipSuggestion: true,
    });
    if (!d.ok || d.status !== "created") throw new Error();
    expect((await repo.getCrosswalk(a.crosswalk.id))!.groupId).toBe(d.crosswalk.groupId);
  });

  it("첫 단계 버튼식 표시로 등록 확정 (D-042)", async () => {
    const r = await registerCrosswalk(repo, { ...base, endA: off(0, 0), endB: off(2e-4, 0), buttonType: true });
    if (!r.ok || r.status !== "created") throw new Error();
    const [s] = await getSignals(repo, { ids: [r.crosswalk.id], now: T });
    expect(s.buttonType).toBe("unverified");
  });

  it("하루 20건 상한 (FR-03-A-05)", async () => {
    repo.registrationsToday.set("u1", 20);
    const r = await registerCrosswalk(repo, { ...base, endA: off(0, 0), endB: off(2e-4, 0), taps: taps(T) });
    expect(r).toEqual({ ok: false, error: "daily_limit" });
  });

  it("장소를 못 찾으면 도로명으로 (D-058)", async () => {
    const r = await registerCrosswalk(repo, {
      ...base,
      geocoder: { reverse: async () => ({ place: null, road: "테헤란로" }) },
      endA: off(0, 0),
      endB: off(2e-4, 0),
      taps: taps(T),
    });
    if (!r.ok || r.status !== "created") throw new Error();
    expect(r.crosswalk.sharedName).toBe("테헤란로 횡단보도");
  });
});

describe("submitReport (F-06)", () => {
  const setup = async () => {
    const r = await registerCrosswalk(repo, { userId: "u1", geocoder, now: T, endA: off(0, 0), endB: off(2e-4, 0), taps: taps(T + 4.8) });
    if (!r.ok || r.status !== "created") throw new Error();
    return r.crosswalk.id;
  };

  it("시간이 안 맞아요 → 의심 수 반영 (FR-06-A-04)", async () => {
    const id = await setup();
    expect(await submitReport(repo, { userId: "u2", crosswalkId: id, kind: "time_mismatch", now: T + 1800 })).toEqual({ ok: true });
    const [s] = await getSignals(repo, { ids: [id], now: T + 1800 });
    expect(s.infoLevel).toBe("stale");
  });

  it("AC-06-A-03-1 같은 그룹 하루 1회", async () => {
    const id = await setup();
    await submitReport(repo, { userId: "u2", crosswalkId: id, kind: "time_mismatch", now: T + 600 });
    expect(await submitReport(repo, { userId: "u2", crosswalkId: id, kind: "time_mismatch", now: T + 2400 })).toEqual({
      ok: false,
      error: "already_reported_today",
    });
  });

  it("AC-06-A-05-1 운영자 처리 유형은 의심 수 미반영", async () => {
    const id = await setup();
    await submitReport(repo, { userId: "u2", crosswalkId: id, kind: "not_together", now: T + 1800 });
    const [s] = await getSignals(repo, { ids: [id], now: T + 1800 });
    expect(s.infoLevel).toBe("fresh");
    expect(repo.reports.at(-1)?.status).toBe("open");
  });

  it("신고 제재 중이면 거부", async () => {
    const id = await setup();
    repo.sanctions.push({ userId: "u2", scope: "report", until: T + 99999 });
    expect(await submitReport(repo, { userId: "u2", crosswalkId: id, kind: "time_mismatch", now: T })).toEqual({ ok: false, error: "sanctioned" });
  });
});

describe("내 신호등 (D-050·D-053·D-058)", () => {
  it("가져오기·별칭·스위치·빼기", async () => {
    const r = await registerCrosswalk(repo, { userId: "u1", geocoder, now: T, endA: off(0, 0), endB: off(2e-4, 0), taps: taps(T + 4.8) });
    if (!r.ok || r.status !== "created") throw new Error();
    const id = r.crosswalk.id;
    expect(await importSignal(repo, { userId: "u2", crosswalkId: id })).toEqual({ ok: true });
    expect(await updateSignal(repo, { userId: "u2", crosswalkId: id, alias: "회사 앞", showAggregate: true })).toEqual({ ok: true });
    expect(await updateSignal(repo, { userId: "u2", crosswalkId: id, alias: "x".repeat(21) })).toEqual({ ok: false, error: "alias_too_long" });
    const [s] = await getSignals(repo, { ids: [id], userId: "u2", now: T + 1800 });
    expect(s.alias).toBe("회사 앞");
    await removeSignal(repo, { userId: "u2", crosswalkId: id });
    expect(await repo.listUserSignals("u2")).toEqual([]);
    expect(await repo.getCrosswalk(id)).not.toBeNull(); // 공유 횡단보도는 그대로 (FR-01-D-04)
  });
});

describe("uploadDeviceRecords (FR-08-D)", () => {
  it("기기 기록을 올리고, 중복 기준이면 기존 횡단보도로 합친다 (FR-08-D-04)", async () => {
    const existing = await registerCrosswalk(repo, { userId: "u1", geocoder, now: T, endA: off(0, 0), endB: off(2e-4, 0), taps: taps(T + 4.8) });
    if (!existing.ok || existing.status !== "created") throw new Error();
    const res = await uploadDeviceRecords(repo, {
      userId: "u2",
      geocoder,
      now: T + 3600,
      items: [
        { endA: off(0, 0.3e-4), endB: off(2e-4, 0.3e-4), records: [taps(T + 1200 + 5.0)] }, // 기존과 합쳐짐
        { endA: off(0, 5e-3), endB: off(2e-4, 5e-3), records: [taps(T + 4.8)] }, // 새로 등록
      ],
    });
    expect(res).toMatchObject({ ok: true, merged: 1, created: 1 });
    const mine = await repo.listUserSignals("u2");
    expect(mine.map((m) => m.crosswalkId)).toContain(existing.crosswalk.id);
    expect(mine).toHaveLength(2);
    const [s] = await getSignals(repo, { ids: [existing.crosswalk.id], now: T + 1800 });
    expect(s.verification).toBe("confirmed");
  });

  it("기기에서 같은 그룹이던 횡단보도는 서버에서도 같은 그룹 (FR-03-D-05)", async () => {
    const res = await uploadDeviceRecords(repo, {
      userId: "u2",
      geocoder,
      now: T + 3600,
      items: [
        { endA: off(0, 0), endB: off(2e-4, 0), records: [taps(T + 4.8)], group: "g1" },
        { endA: off(2.5e-4, -1e-4), endB: off(2.5e-4, 1e-4), records: [taps(T + 4.8)], group: "g1" }, // 남북 방향, 약 20m
        { endA: off(-1e-4, -1e-4), endB: off(-1e-4, 1e-4), records: [taps(T + 64.8)], group: "g2" }, // 다른 그룹
      ],
    });
    expect(res).toMatchObject({ ok: true, created: 3 });
    const mine = await Promise.all((await repo.listUserSignals("u2")).map((m) => repo.getCrosswalk(m.crosswalkId)));
    const [a, b, c] = mine.map((x) => x!.groupId);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("버튼식 표시만 있는 기기 횡단보도도 올린다 (FR-04-D-02)", async () => {
    const res = await uploadDeviceRecords(repo, {
      userId: "u2",
      geocoder,
      now: T,
      items: [{ endA: off(0, 0), endB: off(2e-4, 0), records: [], group: "g1", buttonType: true }],
    });
    expect(res).toMatchObject({ ok: true, created: 1 });
    const [m] = await repo.listUserSignals("u2");
    const [s] = await getSignals(repo, { ids: [m.crosswalkId], now: T });
    expect(s.buttonType).toBe("unverified");
  });

  it("제재 중이면 업로드하지 않는다 (FR-08 E-06)", async () => {
    repo.sanctions.push({ userId: "u2", scope: "record", until: T + 99999 });
    const res = await uploadDeviceRecords(repo, { userId: "u2", geocoder, now: T, items: [{ endA: off(0, 0), endB: off(2e-4, 0), records: [taps(T)] }] });
    expect(res).toEqual({ ok: false, error: "sanctioned" });
  });
});

describe("markButton (D-025)", () => {
  it("서로 다른 2명 → 확정, 이후 기록 거부", async () => {
    const r = await registerCrosswalk(repo, { userId: "u1", geocoder, now: T, endA: off(0, 0), endB: off(2e-4, 0), buttonType: true });
    if (!r.ok || r.status !== "created") throw new Error();
    await markButton(repo, { userId: "u1", crosswalkId: r.crosswalk.id });
    let [s] = await getSignals(repo, { ids: [r.crosswalk.id], now: T });
    expect(s.buttonType).toBe("unverified");
    await markButton(repo, { userId: "u2", crosswalkId: r.crosswalk.id });
    [s] = await getSignals(repo, { ids: [r.crosswalk.id], now: T });
    expect(s.buttonType).toBe("confirmed");
  });
});
