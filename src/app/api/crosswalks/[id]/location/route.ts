// 나만 보기 신호등에 위치 지정 → 공유 (D-074, FR-03-A-08). 50m 현장 확인은 앱에서 한다 — 사용자 위치는 받지 않는다 (OD-004).
// 응답: suggest_existing(중복 제안) → 앱이 고르면 mergeInto로, 거절하면 skipSuggestion으로 다시 부른다
import { requireUser } from "@/lib/auth";
import { bad, errorStatus, jsonBody, lngLat } from "@/lib/http";
import { NominatimGeocoder } from "@/lib/signal/geocoder";
import { setCrosswalkLocation } from "@/lib/signal/register";
import { SupabaseRepo } from "@/lib/signal/supabase-repo";

export async function POST(request: Request, ctx: RouteContext<"/api/crosswalks/[id]/location">) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const b = await jsonBody(request);
  const endA = lngLat(b?.endA);
  const endB = lngLat(b?.endB);
  if (!b || !endA || !endB) return bad("invalid_body");

  const result = await setCrosswalkLocation(new SupabaseRepo(), {
    userId: auth.userId,
    geocoder: new NominatimGeocoder(),
    crosswalkId: id,
    endA,
    endB,
    joinCrosswalkId: typeof b.joinCrosswalkId === "string" ? b.joinCrosswalkId : undefined,
    scramble: b.scramble === true,
    skipSuggestion: b.skipSuggestion === true,
    mergeInto: typeof b.mergeInto === "string" ? b.mergeInto : undefined,
  });
  if (!result.ok) return bad(result.error, errorStatus(result.error));
  return Response.json(result);
}
