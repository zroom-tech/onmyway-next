// 로그인 직후 기기 기록 업로드 (FR-08-D). 사용자가 공유에 동의한 뒤에만 앱이 부른다.
import { lineBearingDiff, midpoint, type LngLat } from "./geo";
import type { Geocoder } from "./geocoder";
import { markButton } from "./button";
import { registerCrosswalk, registerPrivate } from "./register";
import type { SignalRepo } from "./repo";
import { submitRecord } from "./service";
import type { Tap } from "./types";

/**
 * 기기 횡단보도 1개.
 * group: 기기 안 신호 그룹 키 — 같은 키끼리 서버에서도 같이 켜지는 횡단보도로 묶는다 (FR-03-D-05)
 * buttonType: 기기에서 버튼식으로 표시함 (FR-04-D-02). 이때 records는 비어 있을 수 있다
 * endA·endB가 없으면 나만 보기 신호등 — name으로 나만 보기로 올린다, 중복 판정 없음 (D-074, FR-08-D-04)
 */
export type UploadItem = { endA?: LngLat; endB?: LngLat; name?: string; records: Tap[][]; group?: string; scramble?: boolean; buttonType?: boolean };

export async function uploadDeviceRecords(
  repo: SignalRepo,
  input: { userId: string; geocoder: Geocoder; items: UploadItem[]; now?: number },
): Promise<{ ok: true; merged: number; created: number; skipped: number } | { ok: false; error: string }> {
  const now = input.now ?? Date.now() / 1000;
  // 제재 중이면 업로드하지 않는다 (FR-08 E-06)
  if (await repo.isSanctioned(input.userId, "record", now)) return { ok: false, error: "sanctioned" };

  let merged = 0;
  let created = 0;
  let skipped = 0;
  /** 기기 그룹 키 → 그 그룹에서 먼저 서버에 들어간 횡단보도 */
  const groupAnchor = new Map<string, string>();
  for (const item of input.items) {
    if (!item.records.length && !item.buttonType) continue;
    if (!item.endA || !item.endB) {
      const [first, ...rest] = item.records;
      const reg = await registerPrivate(repo, { userId: input.userId, name: item.name ?? "", taps: first, buttonType: !first, now, skipDailyLimit: true });
      if (!reg.ok || reg.status !== "created") {
        skipped += Math.max(item.records.length, 1);
        continue;
      }
      for (const taps of rest) if (!(await submitRecord(repo, { userId: input.userId, crosswalkId: reg.crosswalk.id, taps, now })).ok) skipped++;
      if (item.buttonType && first) await markButton(repo, { userId: input.userId, crosswalkId: reg.crosswalk.id });
      created++;
      continue;
    }
    const endA = item.endA;
    const endB = item.endB;
    // 중복 기준이면 묻지 않고 기존 횡단보도로 합친다 (FR-08-D-04). 기존 횡단보도의 그룹은 바꾸지 않는다
    const existing = (await repo.findCrosswalksNear(midpoint(endA, endB), 15)).find((c) => lineBearingDiff([c.endA, c.endB], [endA, endB]) <= 20);
    if (existing) {
      for (const taps of item.records) {
        const r = await submitRecord(repo, { userId: input.userId, crosswalkId: existing.id, taps, now });
        if (!r.ok) skipped++;
      }
      if (item.buttonType) await markButton(repo, { userId: input.userId, crosswalkId: existing.id });
      await repo.upsertUserSignal(input.userId, existing.id);
      if (item.group && !groupAnchor.has(item.group)) groupAnchor.set(item.group, existing.id);
      merged++;
      continue;
    }
    const anchor = item.group ? groupAnchor.get(item.group) : undefined;
    const [first, ...rest] = item.records;
    const reg = await registerCrosswalk(repo, {
      userId: input.userId,
      geocoder: input.geocoder,
      now,
      endA,
      endB,
      taps: first,
      buttonType: !first,
      skipSuggestion: true,
      // 같은 기기 그룹이 이미 올라갔으면 거기에 합류, 아니면 그룹의 첫 횡단보도 — 전방향이면 전방향으로 (FR-03-C)
      joinCrosswalkId: anchor,
      scramble: !anchor && item.scramble,
    });
    if (!reg.ok || reg.status !== "created") {
      skipped += Math.max(item.records.length, 1);
      continue;
    }
    for (const taps of rest) {
      const r = await submitRecord(repo, { userId: input.userId, crosswalkId: reg.crosswalk.id, taps, now });
      if (!r.ok) skipped++;
    }
    if (item.buttonType && first) await markButton(repo, { userId: input.userId, crosswalkId: reg.crosswalk.id });
    if (item.group && !groupAnchor.has(item.group)) groupAnchor.set(item.group, reg.crosswalk.id);
    created++;
  }
  return { ok: true, merged, created, skipped };
}
