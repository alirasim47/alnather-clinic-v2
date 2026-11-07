import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { createPersonRecord, listCollection, saveCollectionBulk } from "@/lib/server/collections";
import { jsonError, logApiError, readJson, rejectCrossOriginMutation } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error, scope) {
  const status = Number(error?.status) || 500;
  if (status >= 500) logApiError(scope, error);
  return jsonError(status >= 500 ? "تعذر إكمال العملية حاليًا." : error.message, status);
}

export async function GET(request, context) {
  const { collection } = await context.params;
  try {
    const user = await getSessionUser(request);
    if (!user) return jsonError("يلزم تسجيل الدخول.", 401);
    const data = await listCollection(user, collection);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return errorResponse(error, `collections.${collection}.get`);
  }
}

export async function PUT(request, context) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const { collection } = await context.params;
  try {
    const user = await getSessionUser(request);
    if (!user) return jsonError("يلزم تسجيل الدخول.", 401);
    const payload = await readJson(request);
    const data = await saveCollectionBulk(user, collection, payload);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, `collections.${collection}.put`);
  }
}

export async function POST(request, context) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const { collection } = await context.params;
  try {
    const user = await getSessionUser(request);
    if (!user) return jsonError("يلزم تسجيل الدخول.", 401);
    const payload = await readJson(request);
    const data = await createPersonRecord(user, collection, payload);
    return NextResponse.json({ data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, `collections.${collection}.post-item`);
  }
}
