// 시간대 구간 = 1시간 × 평일/주말, 공휴일은 주말 (D-031). 기준 시간대는 KST.
const KST_OFFSET = 9 * 3600;

export type Slot = { dayType: "weekday" | "weekend"; hour: number };

/** @param holidays "YYYY-MM-DD" (KST) — 운영자 관리 공휴일 목록 */
export function slotOf(epochSec: number, holidays: Set<string>): Slot {
  const d = new Date((epochSec + KST_OFFSET) * 1000);
  const ymd = d.toISOString().slice(0, 10);
  const dow = d.getUTCDay();
  const weekend = dow === 0 || dow === 6 || holidays.has(ymd);
  return { dayType: weekend ? "weekend" : "weekday", hour: d.getUTCHours() };
}

/** KST 날짜 "YYYY-MM-DD" — 신고 하루 1회·등록 하루 상한의 "하루" (D-043) */
export function kstDate(epochSec: number): string {
  return new Date((epochSec + KST_OFFSET) * 1000).toISOString().slice(0, 10);
}
