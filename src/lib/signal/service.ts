// 기록 제출·신호 조회 (F-02·F-04·F-05). Route Handler는 인증·입력 검증 후 이 함수만 부른다.
import { isMatch } from "./consensus";
import { deriveRecord } from "./record";
import { visibleTo, type SignalRepo } from "./repo";
import { slotOf } from "./slot";
import { applyRecord, emptyState, infoLevel, verification } from "./state";
import type { InfoLevel, Tap, Verification } from "./types";

export type RecordOutcome = "first" | "match" | "mismatch" | "replaced" | "joined_separately";

export type SubmitResult =
  | { ok: true; outcome: RecordOutcome; verification: Verification; infoLevel: InfoLevel }
  | { ok: false; error: string };

export async function submitRecord(
  repo: SignalRepo,
  input: { userId: string; crosswalkId: string; taps: Tap[]; now?: number },
): Promise<SubmitResult> {
  const now = input.now ?? Date.now() / 1000;
  if (await repo.isSanctioned(input.userId, "record", now)) return { ok: false, error: "sanctioned" };

  const cw = await repo.getCrosswalk(input.crosswalkId);
  if (!cw || !visibleTo(cw, input.userId)) return { ok: false, error: "crosswalk_not_found" }; // 남의 나만 보기 (D-074)
  if (cw.buttonMarks.length >= 2) return { ok: false, error: "button_signal" };

  const d = deriveRecord(input.taps);
  if (!d.ok) return { ok: false, error: d.reason };

  const slot = slotOf(input.taps[0].at, await repo.holidays()); // FR-04-E-02: 기록 시작 시각 기준
  const before = (await repo.getState(cw.groupId, slot)) ?? emptyState();
  const record = { user: input.userId, C: d.C, G: d.G, Graw: d.Graw, phase: d.phase, at: input.taps[0].at };
  const after = applyRecord(before, record);

  await repo.insertRecord({ ...record, crosswalkId: cw.id, groupId: cw.groupId, slot, taps: input.taps });
  await repo.saveState(cw.groupId, slot, after);
  await repo.upsertUserSignal(input.userId, cw.id); // D-054
  // 다시 기록하면 내 기록 우선으로 (FR-02-F-05)
  await repo.setAutoSwitch([input.userId], [cw.id], false);

  // 신호 변경으로 집계가 교체되면, 예전 집계를 보던 사용자를 대표값으로 자동 전환 (FR-02-F-04)
  if (after.replaced && before.agg) {
    const newUsers = new Set(after.agg?.window.map((x) => x.user));
    const oldUsers = before.agg.window.map((x) => x.user).filter((u) => !newUsers.has(u));
    const groupCrosswalks = (await repo.listGroupCrosswalks(cw.groupId)).map((c) => c.id);
    if (oldUsers.length) await repo.setAutoSwitch(oldUsers, groupCrosswalks, true);
  }

  let outcome: RecordOutcome;
  if (after.replaced) outcome = "replaced";
  else if (after.agg && after.agg.window.some((r) => r.user === input.userId && r.at === record.at)) {
    outcome = after.agg.window.length === 1 ? "first" : "match";
  } else outcome = "mismatch";

  return { ok: true, outcome, verification: verification(after), infoLevel: infoLevel(after) };
}

export type SignalView = {
  crosswalkId: string;
  groupId: string;
  /** 나만 보기면 null — 이름은 alias (D-074) */
  sharedName: string | null;
  alias: string | null;
  /** 나만 보기면 null */
  endA: [number, number] | null;
  endB: [number, number] | null;
  isPrivate: boolean;
  serverTime: number;
  slot: { dayType: "weekday" | "weekend"; hour: number };
  buttonType: "none" | "unverified" | "confirmed";
  infoLevel: InfoLevel;
  verification: Verification;
  recordCount: number;
  lastMatchAt: number | null;
  aggregate: { C: number; G: number; phase: number } | null;
  mine: { C: number; G: number; phase: number; at: number; matchesAggregate: boolean } | null;
  /** FR-02-F: 내 기록 우선, 스위치·현재 구간 내 기록 유무로 결정 */
  displaySource: "mine" | "aggregate";
  /** FR-02-F-04: 신호 변경으로 대표값이 교체됨 */
  replacedBySignalChange: boolean;
};

export async function getSignals(
  repo: SignalRepo,
  q: { ids?: string[]; bbox?: [number, number, number, number]; userId?: string; now?: number },
): Promise<SignalView[]> {
  const now = q.now ?? Date.now() / 1000;
  const holidays = await repo.holidays();
  const slot = slotOf(now, holidays);
  const crosswalks = (await repo.listCrosswalks({ ids: q.ids, bbox: q.bbox })).filter((c) => visibleTo(c, q.userId));
  const userSignals = q.userId ? await repo.listUserSignals(q.userId) : [];

  return Promise.all(
    crosswalks.map(async (cw): Promise<SignalView> => {
      const state = (await repo.getState(cw.groupId, slot)) ?? emptyState();
      const us = userSignals.find((s) => s.crosswalkId === cw.id);
      const mineRec = q.userId ? await repo.latestRecordOf(q.userId, cw.groupId, slot) : null;
      const agg = state.agg ? { C: state.agg.C, G: state.agg.G, phase: state.agg.phase } : null;
      const mine = mineRec
        ? { C: mineRec.C, G: mineRec.G, phase: mineRec.phase, at: mineRec.at, matchesAggregate: agg ? isMatch(mineRec, agg) : true }
        : null;
      return {
        crosswalkId: cw.id,
        groupId: cw.groupId,
        sharedName: cw.sharedName,
        alias: us?.alias ?? null,
        endA: cw.endA,
        endB: cw.endB,
        isPrivate: cw.isPrivate,
        serverTime: now,
        slot,
        buttonType: cw.buttonMarks.length >= 2 ? "confirmed" : cw.buttonMarks.length === 1 ? "unverified" : "none",
        infoLevel: infoLevel(state),
        verification: verification(state),
        recordCount: new Set(state.agg?.window.map((r) => r.user) ?? []).size,
        lastMatchAt: state.lastMatchAt,
        aggregate: agg,
        mine,
        displaySource: mine && !us?.showAggregate ? "mine" : "aggregate",
        replacedBySignalChange: us?.autoSwitched ?? false,
      };
    }),
  );
}
