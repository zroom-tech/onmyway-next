// 부록 A-4: 상태 전이 (D-021, D-022, D-032, D-034, D-040)
import { consensus, isMatch } from "./consensus";
import { SIGNAL_SETTINGS, type SignalSettings } from "./settings";
import type { GroupSlotState, InfoLevel, SignalRecord, Verification } from "./types";

export function emptyState(): GroupSlotState {
  return { agg: null, mismatched: [], suspects: [], reporters: [], lastMatchAt: null, replaced: false, rejectedJoin: false };
}

export function verification(state: GroupSlotState): Verification {
  const users = new Set(state.agg?.window.map((r) => r.user) ?? []);
  return users.size >= 2 ? "confirmed" : "unverified";
}

export function infoLevel(state: GroupSlotState, s: SignalSettings = SIGNAL_SETTINGS): InfoLevel {
  if (!state.agg) return "nodata";
  const [stale, expired] =
    verification(state) === "confirmed" ? s.confirmedThresholds : s.unverifiedThresholds;
  const n = verification(state) === "confirmed" ? state.suspects.length : state.reporters.length;
  if (n >= expired) return "expired";
  if (n >= stale) return "stale";
  return "fresh";
}

function fresh(records: SignalRecord[], at: number, s: SignalSettings): GroupSlotState {
  return { ...emptyState(), agg: consensus(records, s), lastMatchAt: at };
}

const addUnique = (xs: string[], x: string) => (xs.includes(x) ? xs : [...xs, x]);

export function applyRecord(
  prev: GroupSlotState,
  r: SignalRecord,
  opts: { joinFirst?: boolean } = {},
  s: SignalSettings = SIGNAL_SETTINGS,
): GroupSlotState {
  const base = { ...prev, replaced: false, rejectedJoin: false };

  // FR-03-C-05·FR-05-C-09: 그룹 합류 첫 기록이 집계와 다르면 기존 그룹에 반영하지 않는다
  if (opts.joinFirst && base.agg && !isMatch(r, base.agg, s)) {
    return { ...base, rejectedJoin: true };
  }

  // D-034: 같은 사용자의 이전 기록은 빠진다
  const window = (base.agg?.window ?? []).filter((x) => x.user !== r.user);
  const mismatched = base.mismatched.filter((x) => x.user !== r.user);
  const agg = window.length ? consensus(window, s) : null;
  const state: GroupSlotState = { ...base, agg, mismatched };

  if (!state.agg) return fresh([r], r.at, s);

  if (isMatch(r, state.agg, s)) {
    return { ...fresh([...state.agg.window, r], r.at, s) };
  }

  if (infoLevel(base, s) === "expired") return fresh([r], r.at, s);

  // 검증 상태는 이 기록이 들어오기 전 기준 (PRD F-05 E-09: 확인됨 창의 사용자가 불일치 기록 → 보관 + 의심 수)
  if (verification(base) === "unverified") {
    // 검증 전 + 불일치 → 교체 (FR-05-C-01). 신호 변경으로 보지 않는다
    return fresh([r], r.at, s);
  }

  // 확인됨 + 불일치: 보관, 의심 수 +1
  const kept = [...mismatched, r];
  const pair = findAgreeingPair(kept, s);
  if (pair) return { ...fresh(pair, r.at, s), replaced: true }; // FR-05-C-04

  return { ...state, mismatched: kept, suspects: addUnique(state.suspects, r.user) };
}

export function applyReport(prev: GroupSlotState, user: string): GroupSlotState {
  return {
    ...prev,
    replaced: false,
    rejectedJoin: false,
    reporters: addUnique(prev.reporters, user),
    suspects: addUnique(prev.suspects, user),
  };
}

function findAgreeingPair(records: SignalRecord[], s: SignalSettings): SignalRecord[] | null {
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];
      if (a.user !== b.user && isMatch(b, { C: a.C, G: a.G, phase: a.phase }, s)) return [a, b];
    }
  }
  return null;
}
