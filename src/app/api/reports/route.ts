// 신고 (F-06). 50m 현장 확인은 앱에서 한다.
import { requireUser } from "@/lib/auth";
import { bad, errorStatus, jsonBody } from "@/lib/http";
import { submitReport } from "@/lib/signal/report";
import type { ReportKind } from "@/lib/signal/repo";
import { SupabaseRepo } from "@/lib/signal/supabase-repo";

const KINDS: ReportKind[] = ["time_mismatch", "not_together", "location_wrong"];

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const b = await jsonBody(request);
  if (typeof b?.crosswalkId !== "string" || !KINDS.includes(b.kind as ReportKind)) return bad("invalid_body");
  const r = await submitReport(new SupabaseRepo(), { userId: auth.userId, crosswalkId: b.crosswalkId, kind: b.kind as ReportKind });
  return r.ok ? Response.json(r, { status: 201 }) : bad(r.error, errorStatus(r.error));
}
