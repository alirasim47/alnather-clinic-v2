import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool, withTransaction } from "@/lib/server/db";
import { cookieOptions, createSession, safeUser } from "@/lib/server/session";
import { jsonError, logApiError, readJson, rejectCrossOriginMutation } from "@/lib/server/http";
import { authenticateLogin, getLoginClientIp, parseLoginInput } from "@/lib/server/login-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const body = await readJson(request);
  const parsed = parseLoginInput(body);
  if (parsed.error) return jsonError(parsed.error.message, parsed.error.status);

  try {
    const result = await withTransaction((client) => authenticateLogin({
      client,
      input: parsed.input,
      ipAddress: getLoginClientIp(request),
      createSession,
    }));

    if (result.status !== 200) return jsonError(result.message, result.status);
    const response = NextResponse.json({ ok: true, user: safeUser(result.user) }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("clinic_session", result.token, cookieOptions());
    return response;
  } catch (error) {
    logApiError("auth.login", error);
    return jsonError("تعذر التحقق من بيانات الدخول. تحقق من إعداد قاعدة البيانات وحاول مجددًا.", 503);
  }
}
