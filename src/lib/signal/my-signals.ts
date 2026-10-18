// 내 신호등 — 가져오기·빼기 (D-050), 별칭 (D-058), 대표값 보기 스위치 (D-053)
import { visibleTo, type SignalRepo } from "./repo";

const ALIAS_MAX = 20; // 운영 설정값 초기값

type Result = { ok: true } | { ok: false; error: string };

export async function importSignal(repo: SignalRepo, input: { userId: string; crosswalkId: string }): Promise<Result> {
  const cw = await repo.getCrosswalk(input.crosswalkId);
  if (!cw || !visibleTo(cw, input.userId)) return { ok: false, error: "crosswalk_not_found" }; // 남의 나만 보기는 가져올 수 없다 (D-074)
  await repo.upsertUserSignal(input.userId, input.crosswalkId); // 값을 복사하지 않고 연결만 (FR-01-D-02)
  return { ok: true };
}

/** 내 목록에서만 뺀다. 공유 횡단보도·기록·집계는 그대로 (FR-01-D-04) */
export async function removeSignal(repo: SignalRepo, input: { userId: string; crosswalkId: string }): Promise<Result> {
  await repo.removeUserSignal(input.userId, input.crosswalkId);
  return { ok: true };
}

export async function updateSignal(
  repo: SignalRepo,
  input: { userId: string; crosswalkId: string; alias?: string | null; showAggregate?: boolean },
): Promise<Result> {
  let alias = input.alias;
  if (typeof alias === "string") {
    alias = alias.trim() || null;
    if (alias && [...alias].length > ALIAS_MAX) return { ok: false, error: "alias_too_long" };
  }
  const ok = await repo.updateUserSignal(input.userId, input.crosswalkId, { alias, showAggregate: input.showAggregate });
  return ok ? { ok: true } : { ok: false, error: "not_in_my_signals" };
}
