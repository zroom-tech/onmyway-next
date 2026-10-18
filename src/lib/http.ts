// Route Handler 공통: 입력 검증·응답
import type { LngLat } from "./signal/geo";
import type { Tap } from "./signal/types";

export const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const b = await request.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

export function lngLat(v: unknown): LngLat | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lng, lat] = v;
  return typeof lng === "number" && typeof lat === "number" && Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? [lng, lat] : null;
}

export function taps(v: unknown): Tap[] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const ok = v.every((t) => t && (t.kind === "green" || t.kind === "red") && typeof t.at === "number" && Number.isFinite(t.at));
  return ok ? (v as Tap[]) : null;
}

/** 서비스 오류 코드 → HTTP 상태 */
export function errorStatus(error: string): number {
  if (error === "sanctioned") return 403;
  if (error.endsWith("not_found") || error === "not_in_my_signals") return 404;
  if (error === "already_reported_today" || error === "daily_limit") return 409;
  return 422;
}
