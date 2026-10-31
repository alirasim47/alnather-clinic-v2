import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { applyClinicImport } from "@/lib/server/import";
import { jsonError, logApiError, readJson, rejectCrossOriginMutation } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  try {
    const user = await getSessionUser(request);
    if (!user) return jsonError("يلزم تسجيل الدخول.", 401);
    const data = await applyClinicImport(user, await readJson(request));
    return NextResponse.json({ data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) logApiError("admin.import", error);
    return jsonError(status >= 500 ? "تعذر استيراد البيانات. لم يُفترض استبدال أي سجل." : error.message, status);
  }
}
