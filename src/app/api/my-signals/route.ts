// 내 신호등 가져오기 (D-050): POST { crosswalkId }
import { requireUser } from "@/lib/auth";
import { bad, errorStatus, jsonBody } from "@/lib/http";
import { importSignal } from "@/lib/signal/my-signals";
import { SupabaseRepo } from "@/lib/signal/supabase-repo";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const b = await jsonBody(request);
  if (typeof b?.crosswalkId !== "string") return bad("invalid_body");
  const r = await importSignal(new SupabaseRepo(), { userId: auth.userId, crosswalkId: b.crosswalkId });
  return r.ok ? Response.json(r, { status: 201 }) : bad(r.error, errorStatus(r.error));
}
