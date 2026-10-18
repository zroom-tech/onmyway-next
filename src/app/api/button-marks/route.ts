// 버튼식 신호 표시 (D-025): POST { crosswalkId }
import { requireUser } from "@/lib/auth";
import { bad, errorStatus, jsonBody } from "@/lib/http";
import { markButton } from "@/lib/signal/button";
import { SupabaseRepo } from "@/lib/signal/supabase-repo";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const b = await jsonBody(request);
  if (typeof b?.crosswalkId !== "string") return bad("invalid_body");
  const r = await markButton(new SupabaseRepo(), { userId: auth.userId, crosswalkId: b.crosswalkId });
  return r.ok ? Response.json(r, { status: 201 }) : bad(r.error, errorStatus(r.error));
}
