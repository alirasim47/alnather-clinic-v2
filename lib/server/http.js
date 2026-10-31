import "server-only";
import { NextResponse } from "next/server";

export function jsonError(message, status = 400, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";

  try {
    const expected = process.env.APP_ORIGIN
      ? new URL(process.env.APP_ORIGIN).origin
      : new URL(request.url).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

export function rejectCrossOriginMutation(request) {
  if (isSameOrigin(request)) return null;
  return jsonError("مصدر الطلب غير مسموح.", 403);
}

export async function readJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 5 * 1024 * 1024) throw Object.assign(new Error("حجم الطلب أكبر من الحد المسموح (5 ميغابايت)."), { status: 413 });
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 5 * 1024 * 1024) throw Object.assign(new Error("حجم الطلب أكبر من الحد المسموح (5 ميغابايت)."), { status: 413 });
    return JSON.parse(text);
  } catch (error) {
    if (error?.status) throw error;
    throw Object.assign(new Error("صيغة JSON غير صالحة."), { status: 400 });
  }
}

export function logApiError(scope, error) {
  console.error(`[${scope}]`, error?.code || error?.name || "unknown_error");
}
