// 내 신호등 한 건: PATCH { alias?, showAggregate? } (D-058·D-053) / DELETE 빼기 (FR-01-D-04)
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { bad, errorStatus, jsonBody } from "@/lib/http";
import { removeSignal, updateSignal } from "@/lib/signal/my-signals";
import { SupabaseRepo } from "@/lib/signal/supabase-repo";

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/my-signals/[id]">) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const b = await jsonBody(request);
  const alias = b?.alias === null || typeof b?.alias === "string" ? (b.alias as string | null) : undefined;
  const showAggregate = typeof b?.showAggregate === "boolean" ? b.showAggregate : undefined;
  if (!b || (alias === undefined && showAggregate === undefined)) return bad("invalid_body");
  const r = await updateSignal(new SupabaseRepo(), { userId: auth.userId, crosswalkId: id, alias, showAggregate });
  return r.ok ? Response.json(r) : bad(r.error, errorStatus(r.error));
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/my-signals/[id]">) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  return Response.json(await removeSignal(new SupabaseRepo(), { userId: auth.userId, crosswalkId: id }));
}
