import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { logApiError, jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return jsonError("انتهت الجلسة أو يلزم تسجيل الدخول.", 401);
    return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    logApiError("auth.session", error);
    return jsonError("تعذر الاتصال بقاعدة البيانات.", 503);
  }
}
