// 횡단보도 등록 (F-03). 첫 기록 탭 또는 버튼식 표시와 함께 확정된다 (D-030, D-042).
// endA·endB가 없으면 위치 없는 나만 보기 등록 — name 필수 (D-074).
// 50m 현장 확인은 앱에서 한다 — 사용자 위치는 받지 않는다 (OD-004).
import { requireUser } from "@/lib/auth";
import { bad, errorStatus, jsonBody, lngLat, taps } from "@/lib/http";
import { NominatimGeocoder } from "@/lib/signal/geocoder";
import { registerCrosswalk, registerPrivate } from "@/lib/signal/register";
import { SupabaseRepo } from "@/lib/signal/supabase-repo";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const b = await jsonBody(request);
  if (b && b.endA === undefined && b.endB === undefined) {
    const buttonType = b.buttonType === true;
    const t = b.taps === undefined ? undefined : taps(b.taps);
    if (typeof b.name !== "string" || t === null || (!buttonType && !t)) return bad("invalid_body");
    const result = await registerPrivate(new SupabaseRepo(), { userId: auth.userId, name: b.name, taps: t, buttonType });
    if (!result.ok) return bad(result.error, errorStatus(result.error));
    return Response.json(result, { status: 201 });
  }
  const endA = lngLat(b?.endA);
  const endB = lngLat(b?.endB);
  const buttonType = b?.buttonType === true;
  const t = b?.taps === undefined ? undefined : taps(b.taps);
  if (!b || !endA || !endB || t === null || (!buttonType && !t)) return bad("invalid_body");

  const result = await registerCrosswalk(new SupabaseRepo(), {
    userId: auth.userId,
    geocoder: new NominatimGeocoder(),
    endA,
    endB,
    taps: t,
    buttonType,
    joinCrosswalkId: typeof b.joinCrosswalkId === "string" ? b.joinCrosswalkId : undefined,
    scramble: b.scramble === true,
    skipSuggestion: b.skipSuggestion === true,
  });
  if (!result.ok) return bad(result.error, errorStatus(result.error));
  return Response.json(result, { status: result.status === "created" ? 201 : 200 });
}
