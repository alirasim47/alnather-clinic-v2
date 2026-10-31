import { NextResponse } from "next/server";
import { SESSION_COOKIE, cookieOptions, revokeSession } from "@/lib/server/session";
import { logApiError, jsonError, rejectCrossOriginMutation } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  try {
    await revokeSession(request);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    return response;
  } catch (error) {
    logApiError("auth.logout", error);
    return jsonError("تعذر إنهاء الجلسة.", 503);
  }
}
