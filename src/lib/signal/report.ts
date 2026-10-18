// 신고 (F-06, D-033). 50m 현장 확인은 앱에서 한다 (위치를 서버에 보내지 않음)
import type { ReportKind, SignalRepo } from "./repo";
import { kstDate, slotOf } from "./slot";
import { applyReport, emptyState } from "./state";

export async function submitReport(
  repo: SignalRepo,
  input: { userId: string; crosswalkId: string; kind: ReportKind; now?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = input.now ?? Date.now() / 1000;
  if (await repo.isSanctioned(input.userId, "report", now)) return { ok: false, error: "sanctioned" };
  const cw = await repo.getCrosswalk(input.crosswalkId);
  if (!cw || (cw.isPrivate && cw.createdBy !== input.userId)) return { ok: false, error: "crosswalk_not_found" };
  if (cw.isPrivate) return { ok: false, error: "private_signal" }; // 나만 보기는 신고 대상이 아니다 (D-074)

  const slot = slotOf(now, await repo.holidays());
  const state = (await repo.getState(cw.groupId, slot)) ?? emptyState();
  // 정보 없음·만료면 "시간이 안 맞아요"는 없다 (F-06 E-01)
  if (input.kind === "time_mismatch" && !state.agg) return { ok: false, error: "nothing_to_report" };

  const inserted = await repo.insertReport({
    crosswalkId: cw.id,
    groupId: cw.groupId,
    userId: input.userId,
    kind: input.kind,
    reportDate: kstDate(now),
    status: input.kind === "time_mismatch" ? "auto" : "open", // 운영자 처리 대기열 (FR-06-A-05)
  });
  if (!inserted) return { ok: false, error: "already_reported_today" };

  if (input.kind === "time_mismatch") await repo.saveState(cw.groupId, slot, applyReport(state, input.userId)); // FR-06-A-04
  return { ok: true };
}
