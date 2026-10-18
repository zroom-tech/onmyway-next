// 앱이 보낸 Supabase 액세스 토큰(Authorization: Bearer)을 검증한다 (D-065)
import { serviceClient } from "./signal/supabase-repo";

export async function requireUser(request: Request): Promise<{ userId: string } | Response> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await serviceClient().auth.getUser(token);
  if (error || !data.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return { userId: data.user.id };
}
