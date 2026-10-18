// traffic-signal PRD 부록 A-2~A-4 / F-04·F-05 인수 조건 기준 테스트
import { describe, expect, it } from "vitest";
import { deriveRecord } from "../record";
import { circDiff, consensus } from "../consensus";
import { applyRecord, applyReport, emptyState, infoLevel, verification } from "../state";
import { slotOf } from "../slot";
import type { SignalRecord } from "../types";

const rec = (user: string, C: number, G: number, phase: number, at = 0): SignalRecord => ({
  user,
  C,
  G,
  Graw: G,
  phase,
  at,
});

describe("deriveRecord (A-2, FR-04-A·B)", () => {
  it("AC-04-A-03-1 녹→적→녹", () => {
    const r = deriveRecord([
      { kind: "green", at: 1000.0 },
      { kind: "red", at: 1030.4 },
      { kind: "green", at: 1120.3 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.C).toBe(120);
    expect(r.G).toBe(30);
    expect(r.T0).toBe(1000.0);
  });

  it("AC-04-A-03-2 적→녹→적", () => {
    const r = deriveRecord([
      { kind: "red", at: 1000.0 },
      { kind: "green", at: 1090.2 },
      { kind: "red", at: 1120.1 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.C).toBe(120);
    expect(r.G).toBe(30);
    expect(r.T0).toBe(1090.2);
  });

  it("교대가 아니면 거부 (FR-04-A-02)", () => {
    const r = deriveRecord([
      { kind: "green", at: 0 },
      { kind: "green", at: 30 },
      { kind: "red", at: 120 },
    ]);
    expect(r).toEqual({ ok: false, reason: "not_alternating" });
  });

  it("AC-04-B-02-1 주기 상한 초과", () => {
    const r = deriveRecord([
      { kind: "green", at: 0 },
      { kind: "red", at: 40 },
      { kind: "green", at: 330 },
    ]);
    expect(r).toEqual({ ok: false, reason: "cycle_out_of_range" });
  });

  it("녹색 5초 미만 거부 (FR-04-B-03)", () => {
    const r = deriveRecord([
      { kind: "green", at: 0 },
      { kind: "red", at: 4 },
      { kind: "green", at: 100 },
    ]);
    expect(r).toEqual({ ok: false, reason: "green_out_of_range" });
  });

  it("탭 간격 300초 초과는 중단 (FR-04-C-04)", () => {
    const r = deriveRecord([
      { kind: "green", at: 0 },
      { kind: "red", at: 301 },
      { kind: "green", at: 330 },
    ]);
    expect(r).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("consensus (A-3)", () => {
  it("AC-05-A-03-1 집계값", () => {
    const rs = [
      rec("a", 120, 30, 4.2, 1),
      rec("b", 120, 31, 4.8, 2),
      rec("c", 120, 30, 5.1, 3),
      rec("d", 121, 30, 4.5, 4),
      rec("e", 120, 29, 4.9, 5),
      rec("f", 120, 30, 4.6, 6),
    ];
    const agg = consensus(rs);
    expect(agg).not.toBeNull();
    expect(agg!.C).toBe(120);
    expect(agg!.G).toBe(30);
    expect(agg!.phase).toBeCloseTo(4.8, 5);
    expect(agg!.window.map((r) => r.user).sort()).toEqual(["a", "b", "c", "e", "f"]);
  });

  it("E-01 최빈 주기 동률이면 최근 기록의 주기", () => {
    const agg = consensus([rec("a", 120, 30, 1, 1), rec("b", 120, 30, 1, 2), rec("c", 121, 30, 1, 3), rec("d", 121, 30, 1, 4)]);
    expect(agg!.C).toBe(121);
  });

  it("E-02 위상 경계는 원형 차이", () => {
    expect(circDiff(119.8, 0.3, 120)).toBeCloseTo(0.5, 5);
  });

  it("집계 창은 최근 10건", () => {
    const rs = Array.from({ length: 12 }, (_, i) => rec("u" + i, 120, 30, 5, i));
    expect(consensus(rs)!.window).toHaveLength(10);
  });
});

describe("state transitions (A-4, FR-05-B·C)", () => {
  it("AC-05-B-02-1 서로 다른 사용자 2명 일치 → 확인됨", () => {
    let s = applyRecord(emptyState(), rec("A", 120, 30, 4.0, 1));
    expect(verification(s)).toBe("unverified");
    s = applyRecord(s, rec("B", 120, 31, 5.5, 2));
    expect(verification(s)).toBe("confirmed");
    expect(s.agg!.window).toHaveLength(2);
  });

  it("AC-05-A-02-1 같은 사용자 2건은 1명", () => {
    let s = applyRecord(emptyState(), rec("A", 120, 30, 4.0, 1));
    s = applyRecord(s, rec("A", 120, 30, 4.2, 2));
    expect(verification(s)).toBe("unverified");
    expect(s.agg!.window).toHaveLength(1);
  });

  it("AC-05-C-01-1 검증 전 + 다른 사용자 불일치 → 교체", () => {
    let s = applyRecord(emptyState(), rec("A", 120, 30, 4, 1));
    s = applyRecord(s, rec("B", 100, 30, 4, 2));
    expect(s.agg!.C).toBe(100);
    expect(verification(s)).toBe("unverified");
    expect(s.agg!.window.map((r) => r.user)).toEqual(["B"]);
  });

  const confirmed = () => {
    let s = applyRecord(emptyState(), rec("A", 120, 30, 4.8, 1));
    s = applyRecord(s, rec("B", 120, 30, 4.8, 2));
    return s;
  };

  it("AC-05-C-03-1 확인됨 + 불일치 1 + 신고 1 → 오래됨, 집계 유지", () => {
    let s = confirmed();
    s = applyRecord(s, rec("C", 100, 30, 4, 3));
    s = applyReport(s, "D");
    expect(infoLevel(s)).toBe("stale");
    expect(s.agg!.C).toBe(120);
  });

  it("확인됨 + 의심 수 3 → 만료", () => {
    let s = confirmed();
    s = applyReport(s, "C");
    s = applyReport(s, "D");
    s = applyReport(s, "E");
    expect(infoLevel(s)).toBe("expired");
  });

  it("E-03 같은 사용자의 신고 + 불일치는 1로 센다", () => {
    let s = confirmed();
    s = applyReport(s, "C");
    s = applyRecord(s, rec("C", 100, 30, 4, 3));
    expect(infoLevel(s)).toBe("fresh");
  });

  it("AC-05-C-04-1 서로 일치하는 불일치 2건 → 새 집계", () => {
    let s = confirmed();
    s = applyRecord(s, rec("C", 100, 30, 4, 3));
    s = applyRecord(s, rec("D", 100, 30, 4.5, 4));
    expect(s.agg!.C).toBe(100);
    expect(verification(s)).toBe("confirmed");
    expect(infoLevel(s)).toBe("fresh");
    expect(s.replaced).toBe(true);
  });

  it("E-05 불일치 2건이 서로 다르면 교체 없이 오래됨", () => {
    let s = confirmed();
    s = applyRecord(s, rec("C", 100, 30, 4, 3));
    s = applyRecord(s, rec("D", 90, 30, 4, 4));
    expect(s.agg!.C).toBe(120);
    expect(infoLevel(s)).toBe("stale");
  });

  it("FR-05-C-05 오래됨 + 일치 기록 → 최신", () => {
    let s = confirmed();
    s = applyReport(s, "C");
    s = applyReport(s, "D");
    expect(infoLevel(s)).toBe("stale");
    s = applyRecord(s, rec("E", 120, 30, 5.0, 5));
    expect(infoLevel(s)).toBe("fresh");
  });

  it("FR-05-C-06 만료 + 불일치 기록 → 새 기록으로 검증 전부터", () => {
    let s = confirmed();
    ["C", "D", "E"].forEach((u) => (s = applyReport(s, u)));
    expect(infoLevel(s)).toBe("expired");
    s = applyRecord(s, rec("F", 90, 25, 10, 6));
    expect(s.agg!.C).toBe(90);
    expect(verification(s)).toBe("unverified");
    expect(infoLevel(s)).toBe("fresh");
  });

  it("검증 전: 신고 1 → 오래됨, 2 → 만료", () => {
    let s = applyRecord(emptyState(), rec("A", 120, 30, 4, 1));
    s = applyReport(s, "B");
    expect(infoLevel(s)).toBe("stale");
    s = applyReport(s, "C");
    expect(infoLevel(s)).toBe("expired");
  });

  it("E-09 집계 창의 사용자가 불일치 기록 → 이전 기록 빠지고 검증 전", () => {
    let s = confirmed();
    s = applyRecord(s, rec("B", 100, 30, 4, 3));
    expect(verification(s)).toBe("unverified");
    expect(s.agg!.window.map((r) => r.user)).toEqual(["A"]);
  });

  it("AC-05-C-07-1 시간이 지나도 하향하지 않는다 (D-021)", () => {
    const s = confirmed();
    expect(infoLevel(s)).toBe("fresh");
  });

  it("집계 없으면 정보 없음", () => {
    expect(infoLevel(emptyState())).toBe("nodata");
  });

  it("FR-05-C-09 그룹 합류 첫 기록 불일치는 기존 그룹에 반영하지 않음", () => {
    const s = confirmed();
    const after = applyRecord(s, rec("Z", 100, 30, 4, 3), { joinFirst: true });
    expect(after.rejectedJoin).toBe(true);
    expect(after.agg).toEqual(s.agg);
    expect(infoLevel(after)).toBe("fresh");
  });
});

describe("slotOf (D-031)", () => {
  // 2026-10-15 목요일 08:20 KST = 2026-10-14T23:20:00Z
  const thu0820 = Date.UTC(2026, 9, 14, 23, 20) / 1000;
  it("평일 1시간 구간", () => {
    expect(slotOf(thu0820, new Set())).toEqual({ dayType: "weekday", hour: 8 });
  });
  it("공휴일은 주말", () => {
    expect(slotOf(thu0820, new Set(["2026-10-15"]))).toEqual({ dayType: "weekend", hour: 8 });
  });
  it("토요일은 주말", () => {
    const sat = Date.UTC(2026, 9, 17, 1, 0) / 1000; // 10-17 10:00 KST
    expect(slotOf(sat, new Set())).toEqual({ dayType: "weekend", hour: 10 });
  });
});
