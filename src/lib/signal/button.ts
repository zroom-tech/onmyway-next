// 버튼식 신호 표시 (D-025). 서로 다른 사용자 2명이 표시하면 확정 — 확정 판단은 getSignals의 buttonType
import { visibleTo, type SignalRepo } from "./repo";

export async function markButton(
  repo: SignalRepo,
  input: { userId: string; crosswalkId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cw = await repo.getCrosswalk(input.crosswalkId);
  if (!cw || !visibleTo(cw, input.userId)) return { ok: false, error: "crosswalk_not_found" };
  await repo.addButtonMark(cw.groupId, input.userId);
  await repo.upsertUserSignal(input.userId, cw.id);
  return { ok: true };
}
