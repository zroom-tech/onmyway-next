// 신호 기록 제출 (F-04). 탭 시각은 앱이 서버 시각으로 보정한 epoch 초 (FR-04-A-04).
// 50m 현장 확인은 앱에서 한다 — 사용자 위치는 서버에 보내지 않는다 (OD-004 법무 회신 대기).
import { requireUser } from "@/lib/auth";
import { submitRecord } from "@/lib/signal/service";
import { SupabaseRepo } from "@/lib/signal/supabase-repo";
import { bad, errorStatus, jsonBody, taps as parseTaps } from "@/lib/http";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = await jsonBody(request);
  const taps = parseTaps(body?.taps);
  if (typeof body?.crosswalkId !== "string" || !taps) return bad("invalid_body");

  const result = await submitRecord(new SupabaseRepo(), { userId: auth.userId, crosswalkId: body.crosswalkId, taps });
  if (!result.ok) return bad(result.error, errorStatus(result.error));
  return Response.json(result, { status: 201 });
}
