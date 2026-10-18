// 횡단보도 등록 (F-03): 끝점 2개 → 중복 제안 → 교차로 묶음 → 신호 그룹 → 첫 기록 → 공유 이름
import { isMatch } from "./consensus";
import { direction8, directionLabel, distanceM, lineBearingDiff, midpoint, type LngLat } from "./geo";
import type { Geocoder } from "./geocoder";
import { deriveRecord } from "./record";
import { markButton } from "./button";
import type { Crosswalk, SignalRepo } from "./repo";
import { submitRecord, type RecordOutcome } from "./service";
import { kstDate, slotOf } from "./slot";
import type { Tap } from "./types";

// 운영 설정값 초기값 (PRD §운영 설정값)
const LENGTH_MIN = 3;
const LENGTH_MAX = 80;
const DUP_RADIUS = 15;
const DUP_ANGLE = 20;
const INTERSECTION_RADIUS = 40;
const DAILY_LIMIT = 20;
/** 교차로 중심에서 이 거리 안을 지나는 횡단보도는 대각선으로 본다 [가정 — D-058 세부] */
const DIAGONAL_RADIUS = 8;

export type RegisterInput = {
  userId: string;
  geocoder: Geocoder;
  now?: number;
  endA: LngLat;
  endB: LngLat;
  /** 첫 기록 탭 3회. buttonType이면 없음 */
  taps?: Tap[];
  /** 첫 단계에서 버튼식 표시 (D-042) */
  buttonType?: boolean;
  /** 같이 켜지는 기존 횡단보도 (FR-03-C-04) */
  joinCrosswalkId?: string;
  /** 전방향 동시 보행 (FR-03-C-03) */
  scramble?: boolean;
  /** "이 횡단보도인가요?" 제안을 거절하고 새로 등록 (FR-03-B-03) */
  skipSuggestion?: boolean;
  /** 나만 보기 → 위치 지정은 이미 등록 수에 들어갔다 (D-074) */
  skipDailyLimit?: boolean;
};

export type RegisterResult =
  | { ok: true; status: "suggest_existing"; suggestions: Crosswalk[] }
  | { ok: true; status: "created"; crosswalk: Crosswalk; joinRejected: boolean; outcome: RecordOutcome | "button_marked" }
  | { ok: false; error: string };

export async function registerCrosswalk(repo: SignalRepo, input: RegisterInput): Promise<RegisterResult> {
  const now = input.now ?? Date.now() / 1000;
  if (await repo.isSanctioned(input.userId, "register", now)) return { ok: false, error: "sanctioned" };
  if (!input.skipDailyLimit && (await repo.countRegistrationsOn(input.userId, kstDate(now))) >= DAILY_LIMIT) return { ok: false, error: "daily_limit" };

  const length = distanceM(input.endA, input.endB);
  if (length < LENGTH_MIN || length > LENGTH_MAX) return { ok: false, error: "length_out_of_range" };

  const mid = midpoint(input.endA, input.endB);
  if (!input.skipSuggestion) {
    const similar = (await repo.findCrosswalksNear(mid, DUP_RADIUS)).filter(
      (c) => lineBearingDiff([c.endA, c.endB], [input.endA, input.endB]) <= DUP_ANGLE,
    );
    if (similar.length) return { ok: true, status: "suggest_existing", suggestions: similar };
  }

  // 첫 기록이 저장 불가면 횡단보도도 저장하지 않는다 (FR-03-D-04)
  let derived: ReturnType<typeof deriveRecord> | null = null;
  if (!input.buttonType) {
    if (!input.taps) return { ok: false, error: "taps_required" };
    derived = deriveRecord(input.taps);
    if (!derived.ok) return { ok: false, error: derived.reason };
  }

  const nearby = await repo.findCrosswalksNear(mid, INTERSECTION_RADIUS);
  const intersectionId = nearby[0]?.intersectionId ?? (await repo.createIntersection());

  let groupId: string;
  let joinRejected = false;
  if (input.scramble) {
    groupId = await repo.createGroup(intersectionId, true);
    const all = await repo.listIntersectionCrosswalks(intersectionId);
    await repo.setCrosswalkGroup(all.map((c) => c.id), groupId);
  } else if (input.joinCrosswalkId) {
    const target = await repo.getCrosswalk(input.joinCrosswalkId);
    if (!target || target.isPrivate) return { ok: false, error: "join_target_not_found" }; // 나만 보기와는 묶지 않는다 (D-074)
    groupId = target.groupId;
    // 합류 시 첫 기록이 그룹의 그 시간대 집계와 다르면 단독 그룹 (FR-03-C-05, D-040). 집계 없으면 합류 (C-06)
    if (derived?.ok && input.taps) {
      const state = await repo.getState(groupId, slotOf(input.taps[0].at, await repo.holidays()));
      const rec = { user: input.userId, C: derived.C, G: derived.G, Graw: derived.Graw, phase: derived.phase, at: input.taps[0].at };
      if (state?.agg && !isMatch(rec, state.agg)) {
        joinRejected = true;
        groupId = await repo.createGroup(intersectionId, false);
      }
    }
  } else {
    groupId = await repo.createGroup(intersectionId, false);
  }

  const sharedName = await makeSharedName(repo, input.geocoder, intersectionId, input.endA, input.endB);
  const crosswalk = await repo.createCrosswalk({ intersectionId, groupId, sharedName, endA: input.endA, endB: input.endB, createdBy: input.userId });

  if (input.buttonType) {
    await repo.addButtonMark(groupId, input.userId);
    await repo.upsertUserSignal(input.userId, crosswalk.id);
    return { ok: true, status: "created", crosswalk: (await repo.getCrosswalk(crosswalk.id))!, joinRejected, outcome: "button_marked" };
  }

  const rec = await submitRecord(repo, { userId: input.userId, crosswalkId: crosswalk.id, taps: input.taps!, now });
  if (!rec.ok) return { ok: false, error: rec.error };
  return { ok: true, status: "created", crosswalk, joinRejected, outcome: joinRejected ? "joined_separately" : rec.outcome };
}

/** 나만 보기 신호등 이름 길이 (운영 설정값 초기값, D-074) */
const NAME_MAX = 20;

/**
 * 위치 없이 등록 = 나만 보기 (D-074, FR-03-A-07). 이름은 등록자의 별칭으로 둔다.
 * 첫 기록(또는 버튼식 표시)이 저장돼야 확정 (FR-03-D-04와 같은 규칙)
 */
export async function registerPrivate(
  repo: SignalRepo,
  input: { userId: string; name: string; taps?: Tap[]; buttonType?: boolean; now?: number; skipDailyLimit?: boolean },
): Promise<RegisterResult> {
  const now = input.now ?? Date.now() / 1000;
  if (await repo.isSanctioned(input.userId, "register", now)) return { ok: false, error: "sanctioned" };
  if (!input.skipDailyLimit && (await repo.countRegistrationsOn(input.userId, kstDate(now))) >= DAILY_LIMIT) return { ok: false, error: "daily_limit" };
  const name = input.name.trim();
  if (!name || [...name].length > NAME_MAX) return { ok: false, error: "invalid_name" };
  if (!input.buttonType) {
    if (!input.taps) return { ok: false, error: "taps_required" };
    const d = deriveRecord(input.taps);
    if (!d.ok) return { ok: false, error: d.reason };
  }

  const groupId = await repo.createGroup(null, false);
  const crosswalk = await repo.createPrivateCrosswalk(groupId, input.userId);
  await repo.upsertUserSignal(input.userId, crosswalk.id);
  await repo.updateUserSignal(input.userId, crosswalk.id, { alias: name });

  if (input.buttonType) {
    await repo.addButtonMark(groupId, input.userId);
    return { ok: true, status: "created", crosswalk: (await repo.getCrosswalk(crosswalk.id))!, joinRejected: false, outcome: "button_marked" };
  }
  const rec = await submitRecord(repo, { userId: input.userId, crosswalkId: crosswalk.id, taps: input.taps!, now });
  if (!rec.ok) {
    await repo.deletePrivateCrosswalk(crosswalk.id);
    return { ok: false, error: rec.error };
  }
  return { ok: true, status: "created", crosswalk, joinRejected: false, outcome: rec.outcome };
}

export type LocationResult = RegisterResult | { ok: true; status: "merged"; crosswalk: Crosswalk };

/**
 * 나만 보기 신호등에 위치 지정 → 공유 (D-074, FR-03-A-08).
 * 위치 있는 등록과 같은 규칙(길이·중복 제안·교차로·같이 켜지는 횡단보도·공유 이름)으로 공유 횡단보도를 새로 만들고,
 * 그동안의 내 기록을 시간 순서대로 다시 제출한 뒤 나만 보기 신호등은 지운다. 이름은 내 별칭으로 남는다.
 * [mergeInto]: 중복 제안에서 고른 기존 횡단보도 — 기록을 그쪽으로 옮긴다 (F-03 E-11)
 */
export async function setCrosswalkLocation(
  repo: SignalRepo,
  input: Omit<RegisterInput, "taps" | "buttonType" | "skipDailyLimit"> & { crosswalkId: string; mergeInto?: string },
): Promise<LocationResult> {
  const now = input.now ?? Date.now() / 1000;
  const cw = await repo.getCrosswalk(input.crosswalkId);
  if (!cw || !cw.isPrivate || cw.createdBy !== input.userId) return { ok: false, error: "crosswalk_not_found" };
  const records = (await repo.listCrosswalkRecords(cw.id)).filter((r) => r.user === input.userId);
  const alias = (await repo.listUserSignals(input.userId)).find((s) => s.crosswalkId === cw.id)?.alias ?? null;
  const buttonMarked = cw.buttonMarks.includes(input.userId);

  let target: Crosswalk;
  let rest = records;
  let created: Extract<RegisterResult, { status: "created" }> | null = null;
  if (input.mergeInto) {
    const t = await repo.getCrosswalk(input.mergeInto);
    if (!t || t.isPrivate) return { ok: false, error: "merge_target_not_found" };
    target = t;
  } else {
    const [first, ...others] = records;
    const reg = await registerCrosswalk(repo, { ...input, now, taps: first?.taps, buttonType: !first, skipDailyLimit: true });
    if (!reg.ok || reg.status === "suggest_existing") return reg;
    target = reg.crosswalk;
    rest = others;
    created = reg;
  }

  for (const r of rest) await submitRecord(repo, { userId: input.userId, crosswalkId: target.id, taps: r.taps, now });
  if (buttonMarked && (input.mergeInto || records.length)) await markButton(repo, { userId: input.userId, crosswalkId: target.id });
  await repo.upsertUserSignal(input.userId, target.id);
  const mine = (await repo.listUserSignals(input.userId)).find((s) => s.crosswalkId === target.id);
  if (alias && !mine?.alias) await repo.updateUserSignal(input.userId, target.id, { alias });
  await repo.deletePrivateCrosswalk(cw.id);
  const done = (await repo.getCrosswalk(target.id))!;
  return created ? { ...created, crosswalk: done } : { ok: true, status: "merged", crosswalk: done };
}

/** "{주변 장소} 앞 · {방향} 횡단보도" (D-058, FR-03-D-06) */
async function makeSharedName(repo: SignalRepo, geocoder: Geocoder, intersectionId: string, a: LngLat, b: LngLat): Promise<string> {
  const mid = midpoint(a, b);
  const { place, road } = await geocoder.reverse(mid[0], mid[1]);
  const base = place ? `${place} 앞` : road ?? "이름 없는 곳";

  const others = await repo.listIntersectionCrosswalks(intersectionId);
  if (!others.length) return `${base} 횡단보도`;

  const mids = [...others.map((c) => midpoint(c.endA, c.endB)), mid];
  const center: LngLat = [mids.reduce((s, m) => s + m[0], 0) / mids.length, mids.reduce((s, m) => s + m[1], 0) / mids.length];

  let dir: string;
  if (distanceM(center, mid) <= DIAGONAL_RADIUS) {
    const [p, q] = [direction8(center, a), direction8(center, b)].sort((x, y) => (x < y ? -1 : 1));
    dir = `대각선 (${p}↔${q})`;
  } else {
    dir = directionLabel(center, mid);
  }
  const name = `${base} · ${dir} 횡단보도`;
  const same = others.filter((c) => c.sharedName.startsWith(`${base} · ${dir}`)).length;
  return same ? `${base} · ${dir} ${same + 1} 횡단보도` : name; // 같은 방향이 겹치면 순번 [가정]
}
