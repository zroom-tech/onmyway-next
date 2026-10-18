// 부록 A-3: 집계와 일치 판정 (D-020, D-022)
import { mod } from "./record";
import { SIGNAL_SETTINGS, type SignalSettings } from "./settings";
import type { Aggregate, SignalRecord } from "./types";

export function circDiff(a: number, b: number, C: number): number {
  const d = mod(Math.abs(a - b), C);
  return Math.min(d, C - d);
}

/** circDiff 합이 가장 작은 표본. 여러 개면 그 표본들의 원형 평균 */
export function circularMedian(phases: number[], C: number): number {
  let best = Infinity;
  let winners: number[] = [];
  for (const p of phases) {
    const sum = phases.reduce((acc, q) => acc + circDiff(p, q, C), 0);
    if (sum < best - 1e-9) {
      best = sum;
      winners = [p];
    } else if (Math.abs(sum - best) <= 1e-9) {
      winners.push(p);
    }
  }
  if (winners.length === 1) return winners[0];
  const angle = (p: number) => (p / C) * 2 * Math.PI;
  const x = winners.reduce((a, p) => a + Math.cos(angle(p)), 0);
  const y = winners.reduce((a, p) => a + Math.sin(angle(p)), 0);
  return mod((Math.atan2(y, x) / (2 * Math.PI)) * C, C);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 사용자별 최신 1건 (D-034) */
export function latestPerUser(records: SignalRecord[]): SignalRecord[] {
  const byUser = new Map<string, SignalRecord>();
  for (const r of records) {
    const prev = byUser.get(r.user);
    if (!prev || r.at >= prev.at) byUser.set(r.user, r);
  }
  return [...byUser.values()];
}

function modeCycle(records: SignalRecord[]): number {
  const counts = new Map<number, { n: number; latest: number }>();
  for (const r of records) {
    const c = counts.get(r.C) ?? { n: 0, latest: -Infinity };
    counts.set(r.C, { n: c.n + 1, latest: Math.max(c.latest, r.at) });
  }
  let bestC = records[0].C;
  let best = { n: -1, latest: -Infinity };
  for (const [C, v] of counts) {
    if (v.n > best.n || (v.n === best.n && v.latest > best.latest)) {
      bestC = C;
      best = v;
    }
  }
  return bestC;
}

function summarize(records: SignalRecord[], C: number) {
  return { phase: circularMedian(records.map((r) => r.phase), C), G: Math.round(median(records.map((r) => r.Graw))) };
}

export function consensus(records: SignalRecord[], s: SignalSettings = SIGNAL_SETTINGS): Aggregate | null {
  const R = latestPerUser(records);
  if (!R.length) return null;
  const C = modeCycle(R);
  const S = R.filter((r) => r.C === C);
  const first = summarize(S, C);
  const inliers = S.filter((r) => isMatch(r, { C, ...first }, s));
  const window = inliers.sort((a, b) => b.at - a.at).slice(0, s.windowSize);
  if (!window.length) return null;
  return { C, ...summarize(window, C), window };
}

export function isMatch(
  r: SignalRecord,
  agg: { C: number; G: number; phase: number },
  s: SignalSettings = SIGNAL_SETTINGS,
): boolean {
  return (
    r.C === agg.C &&
    Math.abs(r.G - agg.G) <= s.matchGreenTolerance &&
    circDiff(r.phase, agg.phase, agg.C) <= s.matchPhaseTolerance
  );
}
