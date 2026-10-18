// 부록 A-2: 탭 3회 → C·G·기준 시점 (D-018, D-023, D-026)
import { SIGNAL_SETTINGS, type SignalSettings } from "./settings";
import type { Tap } from "./types";

export type DerivedRecord =
  | { ok: true; C: number; G: number; Graw: number; T0: number; phase: number }
  | { ok: false; reason: "not_three_taps" | "not_alternating" | "timeout" | "cycle_out_of_range" | "green_out_of_range" };

export function deriveRecord(taps: Tap[], s: SignalSettings = SIGNAL_SETTINGS): DerivedRecord {
  if (taps.length !== 3) return { ok: false, reason: "not_three_taps" };
  const [t1, t2, t3] = taps;
  if (t1.kind === t2.kind || t2.kind === t3.kind || t1.kind !== t3.kind) {
    return { ok: false, reason: "not_alternating" };
  }
  if (t2.at - t1.at > s.tapTimeout || t3.at - t2.at > s.tapTimeout) {
    return { ok: false, reason: "timeout" };
  }

  const startsGreen = t1.kind === "green";
  const T0 = startsGreen ? t1.at : t2.at;
  const Graw = startsGreen ? t2.at - t1.at : t3.at - t2.at;
  const C = Math.round(t3.at - t1.at);
  const G = Math.round(Graw);

  if (C < s.cycleMin || C > s.cycleMax) return { ok: false, reason: "cycle_out_of_range" };
  if (G < s.greenMin || G >= C) return { ok: false, reason: "green_out_of_range" };

  return { ok: true, C, G, Graw, T0, phase: mod(T0, C) };
}

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
