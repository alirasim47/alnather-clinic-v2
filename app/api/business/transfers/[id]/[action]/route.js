import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { resolveBranchTransfer } from "@/lib/server/business";
import { jsonError, logApiError, rejectCrossOriginMutation } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, context) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const { id, action } = await context.params;
  try {
    const user = await getSessionUser(request);
    if (!user) return jsonError("يلزم تسجيل الدخول.", 401);
    const result = await resolveBranchTransfer(user, id, action);
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) logApiError("business.transfers.resolve", error);
    return jsonError(status >= 500 ? "تعذر تحديث طلب النقل." : error.message, status);
  }
}
