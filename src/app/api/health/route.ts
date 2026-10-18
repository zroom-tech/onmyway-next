import { connection } from "next/server";

// 배포·모니터링용 헬스체크. 요청 시점에 응답하도록 프리렌더링에서 제외한다.
export async function GET() {
  await connection();
  return Response.json({ status: "ok", time: new Date().toISOString() });
}
