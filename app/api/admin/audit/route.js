import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { getPool } from "@/lib/server/db";
import { getSessionUser } from "@/lib/server/session";
import { jsonError, logApiError } from "@/lib/server/http";
import { encodeAuditCursor, parseAuditQuery } from "@/lib/server/audit-export.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIT_PAGE_SQL = `
  SELECT e.id,e.actor_id,e.action,e.collection,e.record_id,e.branch_id,e.summary,e.metadata,e.created_at,
         u.name AS actor_name,b.name AS branch_name
    FROM audit_events e
    LEFT JOIN app_users u ON u.id=e.actor_id AND u.clinic_id=e.clinic_id
    LEFT JOIN branches b ON b.id=e.branch_id AND b.clinic_id=e.clinic_id
   WHERE e.clinic_id=$1
     AND ($2::timestamptz IS NULL OR e.created_at >= $2::timestamptz)
     AND ($3::timestamptz IS NULL OR e.created_at < $3::timestamptz)
     AND ($4::timestamptz IS NULL OR (e.created_at,e.id) < ($4::timestamptz,$5::text))
   ORDER BY e.created_at DESC,e.id DESC
   LIMIT $6`;

export async function GET(request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return jsonError("يلزم تسجيل الدخول.", 401);
    if (!hasPermission(user, "audit.view")) return jsonError("قراءة سجل التدقيق متاحة لمدير العيادة فقط.", 403);

    const filters = parseAuditQuery(new URL(request.url).searchParams);
    const result = await getPool().query(AUDIT_PAGE_SQL, [
      user.clinicId,
      filters.fromAt,
      filters.toExclusive,
      filters.cursor?.createdAt || null,
      filters.cursor?.id || null,
      filters.limit + 1,
    ]);
    const events = result.rows.slice(0, filters.limit).map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name || "حساب محذوف",
      action: row.action,
      collection: row.collection,
      recordId: row.record_id,
      branchId: row.branch_id,
      branchName: row.branch_name || "",
      summary: row.summary,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
    const hasMore = result.rows.length > filters.limit;
    const nextCursor = hasMore && events.length
      ? encodeAuditCursor({ id: events.at(-1).id, createdAt: events.at(-1).createdAt }, filters.from, filters.to)
      : null;

    return NextResponse.json(
      { data: { clinicId: user.clinicId, events, nextCursor } },
      { headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", Vary: "Cookie" } },
    );
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) logApiError("admin.audit", error);
    return jsonError(status >= 500 ? "تعذر تحميل سجل التدقيق." : error.message, status);
  }
}
