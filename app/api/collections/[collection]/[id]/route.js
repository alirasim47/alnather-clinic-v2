import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { saveCollectionRecord, removeCollectionRecord } from "@/lib/server/collections";
import { jsonError, logApiError, readJson, rejectCrossOriginMutation } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error, scope) {
  const status = Number(error?.status) || 500;
  if (status >= 500) logApiError(scope, error);
  return jsonError(status >= 500 ? "تعذر إكمال العملية حاليًا." : error.message, status);
}

export async function PUT(request, context) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const { collection, id } = await context.params;
  try {
    const user = await getSessionUser(request);
    if (!user) return jsonError("يلزم تسجيل الدخول.", 401);
    const payload = await readJson(request);
    const data = await saveCollectionRecord(user, collection, payload, id);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, `collections.${collection}.put-item`);
  }
}

export async function DELETE(request, context) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const { collection, id } = await context.params;
  try {
    const user = await getSessionUser(request);
    if (!user) return jsonError("يلزم تسجيل الدخول.", 401);
    const removed = await removeCollectionRecord(user, collection, id);
    return NextResponse.json({ data: removed });
  } catch (error) {
    return errorResponse(error, `collections.${collection}.delete`);
  }
}
