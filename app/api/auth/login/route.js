import { randomUUID, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { getPool, withTransaction } from "@/lib/server/db";
import { cookieOptions, createSession, safeUser } from "@/lib/server/session";
import { jsonError, logApiError, readJson, rejectCrossOriginMutation } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clean = (value, max = 120) => String(value || "").trim().slice(0, max);
const normalizePhone = (value) => String(value || "").replace(/[^0-9+]/g, "");

export async function POST(request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  const body = await readJson(request);
  const identifier = clean(body?.identifier, 120).toLowerCase();
  const phone = normalizePhone(body?.identifier);
  const password = String(body?.password || "");
  const clinicSlug = clean(body?.clinicSlug, 50).toLowerCase();
  if (!identifier || password.length < 1) return jsonError("أدخل اسم المستخدم وكلمة المرور.", 400);

  const bucketHash = createHash("sha256").update(`${clinicSlug || "*"}|${identifier}`).digest("hex");
  try {
    const result = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO login_attempts(bucket_hash, attempts, window_started_at)
         VALUES ($1, 0, now()) ON CONFLICT (bucket_hash) DO NOTHING`,
        [bucketHash],
      );
      let limit = (await client.query("SELECT * FROM login_attempts WHERE bucket_hash = $1 FOR UPDATE", [bucketHash])).rows[0];
      if (limit.blocked_until && new Date(limit.blocked_until).getTime() > Date.now()) {
        return { status: 429, message: "محاولات كثيرة. انتظر قليلًا ثم حاول من جديد." };
      }
      if (Date.now() - new Date(limit.window_started_at).getTime() > 15 * 60 * 1000) {
        await client.query(
          "UPDATE login_attempts SET attempts = 0, blocked_until = NULL, window_started_at = now(), updated_at = now() WHERE bucket_hash = $1",
          [bucketHash],
        );
        limit = { ...limit, attempts: 0, blocked_until: null };
      }

      const userRows = await client.query(
        `SELECT u.*, c.name AS clinic_name, c.slug AS clinic_slug, b.name AS branch_name
           FROM app_users u
           JOIN clinics c ON c.id = u.clinic_id
           LEFT JOIN branches b ON b.id = u.branch_id AND b.clinic_id = u.clinic_id
          WHERE ($1 = '' OR c.slug = $1)
            AND (u.username_normalized = $2 OR regexp_replace(coalesce(u.phone, ''), '[^0-9+]', '', 'g') = $3)
          ORDER BY u.created_at ASC LIMIT 3 FOR UPDATE OF u`,
        [clinicSlug, identifier, phone],
      );
      if (userRows.rowCount > 1) {
        return { status: 409, message: "اسم المستخدم موجود في أكثر من عيادة. أدخل رمز العيادة للمتابعة." };
      }

      const user = userRows.rows[0];
      const failed = async () => {
        const attempts = Number(limit.attempts || 0) + 1;
        const blockedUntil = attempts >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        await client.query(
          `UPDATE login_attempts SET attempts = $2, blocked_until = $3, updated_at = now() WHERE bucket_hash = $1`,
          [bucketHash, attempts, blockedUntil],
        );
        return { status: blockedUntil ? 429 : 401, message: blockedUntil ? "محاولات كثيرة. تم إيقاف الدخول مؤقتًا لمدة 15 دقيقة." : "اسم المستخدم أو كلمة المرور غير صحيحة." };
      };

      if (!user || !user.active) return failed();
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        await client.query(
          "UPDATE app_users SET failed_login_count = failed_login_count + 1, locked_until = CASE WHEN failed_login_count >= 7 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = $1",
          [user.id],
        );
        return failed();
      }
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        return { status: 429, message: "الحساب موقوف مؤقتًا بعد محاولات غير ناجحة. حاول لاحقًا." };
      }

      await client.query("UPDATE app_users SET failed_login_count = 0, locked_until = NULL WHERE id = $1", [user.id]);
      await client.query("UPDATE login_attempts SET attempts = 0, blocked_until = NULL, window_started_at = now(), updated_at = now() WHERE bucket_hash = $1", [bucketHash]);
      const token = await createSession(client, user);
      await client.query(
        `INSERT INTO audit_events(id, clinic_id, actor_id, action, summary, metadata)
         VALUES ($1, $2, $3, 'auth.login', 'تسجيل دخول ناجح', '{}'::jsonb)`,
        [randomUUID(), user.clinic_id, user.id],
      );
      return { status: 200, token, user: safeUser(user) };
    });

    if (result.status !== 200) return jsonError(result.message, result.status);
    const response = NextResponse.json({ ok: true, user: result.user }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("clinic_session", result.token, cookieOptions());
    return response;
  } catch (error) {
    logApiError("auth.login", error);
    return jsonError("تعذر التحقق من بيانات الدخول. تحقق من إعداد قاعدة البيانات وحاول مجددًا.", 503);
  }
}
