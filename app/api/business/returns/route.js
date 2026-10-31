import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { createReturn } from "@/lib/server/business";
import { jsonError, logApiError, readJson, rejectCrossOriginMutation } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  try {
    const user = await getSessionUser(request);
    if (!user) return jsonError("يلزم تسجيل الدخول.", 401);
    const result = await createReturn(user, await readJson(request));
    return NextResponse.json({ data: result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) logApiError("business.returns", error);
    return jsonError(status >= 500 ? "تعذر اعتماد العائد. لم يُفترض حفظه." : error.message, status);
  }
}
