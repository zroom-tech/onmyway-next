// 신호 조회 (F-01·F-02). 공유 신호는 로그인 사용자만 본다 (D-047).
//   GET /api/signals?mine=1              신호등 탭 — 내 신호등 전체
//   GET /api/signals?ids=a,b             지정한 횡단보도
//   GET /api/signals?bbox=minLng,minLat,maxLng,maxLat   동네 탭 — 화면 범위
import { requireUser } from "@/lib/auth";
import { getSignals } from "@/lib/signal/service";
import { SupabaseRepo } from "@/lib/signal/supabase-repo";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const params = new URL(request.url).searchParams;
  const repo = new SupabaseRepo();
  const ids =
    params.get("mine") === "1"
      ? (await repo.listUserSignals(auth.userId)).map((s) => s.crosswalkId)
      : params.get("ids")?.split(",").filter(Boolean);
  const bbox = params.get("bbox")?.split(",").map(Number);
  if (!ids && !bbox) return Response.json({ error: "ids_or_bbox_required" }, { status: 400 });
  if (bbox && (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n)))) {
    return Response.json({ error: "invalid_bbox" }, { status: 400 });
  }

  const signals = await getSignals(repo, {
    ids,
    bbox: bbox as [number, number, number, number] | undefined,
    userId: auth.userId,
  });
  return Response.json({ serverTime: Date.now() / 1000, signals });
}
