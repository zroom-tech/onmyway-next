// 로그인 직후 기기 기록 업로드 (FR-08-D). 사용자가 공유에 동의한 뒤에만 앱이 부른다.
import { requireUser } from "@/lib/auth";
import { bad, errorStatus, jsonBody, lngLat, taps } from "@/lib/http";
import { NominatimGeocoder } from "@/lib/signal/geocoder";
import { SupabaseRepo } from "@/lib/signal/supabase-repo";
import { uploadDeviceRecords, type UploadItem } from "@/lib/signal/upload";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const b = await jsonBody(request);
  if (!Array.isArray(b?.items) || b.items.length > 200) return bad("invalid_body");
  const items: UploadItem[] = [];
  for (const raw of b.items as Record<string, unknown>[]) {
    // 위치가 없으면 나만 보기 — 이름 필수 (D-074)
    const located = raw?.endA !== undefined || raw?.endB !== undefined;
    const endA = located ? lngLat(raw?.endA) : undefined;
    const endB = located ? lngLat(raw?.endB) : undefined;
    const records = Array.isArray(raw?.records) ? raw.records.map(taps) : null;
    if (endA === null || endB === null || !records || records.some((r) => !r)) return bad("invalid_body");
    if (!located && (typeof raw.name !== "string" || !raw.name.trim())) return bad("invalid_body");
    if (raw.group !== undefined && (typeof raw.group !== "string" || raw.group.length > 100)) return bad("invalid_body");
    items.push({
      endA,
      endB,
      name: typeof raw.name === "string" ? raw.name : undefined,
      records: records as NonNullable<(typeof records)[number]>[],
      group: raw.group as string | undefined,
      scramble: raw.scramble === true,
      buttonType: raw.buttonType === true,
    });
  }
  const r = await uploadDeviceRecords(new SupabaseRepo(), { userId: auth.userId, geocoder: new NominatimGeocoder(), items });
  return r.ok ? Response.json(r) : bad(r.error, errorStatus(r.error));
}
