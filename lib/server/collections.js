import "server-only";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { getPool, withTransaction } from "./db";
import { COLLECTION_RULES, authorize, branchScope } from "./access";
import { clearUserSessions, safeUser } from "./session";
import { assertSingleCreate, newRecordIdentity } from "./record-id.mjs";
import { auditSnapshot } from "./audit-diff.mjs";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/storage";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const asText = (value, max = 180) => String(value ?? "").trim().slice(0, max);
const asNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const asObject = (value) => value && typeof value === "object" && !Array.isArray(value);

export function assertCollection(collection) {
  if (!COLLECTION_RULES[collection]) throw fail("القسم المطلوب غير معروف.", 404);
}

export function requireCollectionPermission(user, collection, operation) {
  assertCollection(collection);
  const permission = COLLECTION_RULES[collection][operation];
  const response = authorize(user, permission);
  if (response) throw fail(response.status === 401 ? "يلزم تسجيل الدخول." : "لا تملك صلاحية تنفيذ هذا الإجراء.", response.status);
}

async function audit(client, user, action, collection, recordId, summary, metadata = {}) {
  await client.query(
    `INSERT INTO audit_events(id, clinic_id, actor_id, action, collection, record_id, branch_id, summary, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [randomUUID(), user.clinicId, user.id, action, collection, recordId ? String(recordId) : null,
      user.branchId || null, String(summary || "").slice(0, 240), JSON.stringify(metadata)],
  );
}

async function branchExists(client, clinicId, branchId) {
  if (!branchId) return false;
  const result = await client.query("SELECT 1 FROM branches WHERE id=$1 AND clinic_id=$2 AND active=TRUE", [branchId, clinicId]);
  return result.rowCount > 0;
}

async function resolveBranch(client, user, requested) {
  if (user.role !== "admin" && !user.branchId) throw fail("يجب ربط حساب الموظف بفرع قبل إدارة السجلات.", 403);
  const branchId = user.role === "admin" ? (requested || null) : (user.branchId || null);
  if (requested && user.branchId && String(requested) !== String(user.branchId)) throw fail("لا تملك صلاحية هذا الفرع.", 403);
  if (branchId && !(await branchExists(client, user.clinicId, branchId))) throw fail("الفرع المحدد غير موجود أو موقوف.", 400);
  return branchId;
}

function publicUserRow(row) {
  return safeUser(row);
}

async function getUsers(client, user) {
  const result = await client.query(
    `SELECT u.id,u.clinic_id,u.branch_id,u.name,u.username,u.phone,u.role,u.permissions,u.active,u.must_change_password,
            c.name AS clinic_name,c.slug AS clinic_slug,b.name AS branch_name
       FROM app_users u JOIN clinics c ON c.id=u.clinic_id
       LEFT JOIN branches b ON b.id=u.branch_id AND b.clinic_id=u.clinic_id
      WHERE u.clinic_id=$1 ORDER BY u.created_at ASC`,
    [user.clinicId],
  );
  return result.rows.map(publicUserRow);
}

async function getBranches(client, user) {
  const result = await client.query(
    "SELECT id,clinic_id,name,code,phone,address,active,created_at,updated_at FROM branches WHERE clinic_id=$1 ORDER BY active DESC,name ASC",
    [user.clinicId],
  );
  return result.rows.map((row) => ({
    id: row.id, clinicId: row.clinic_id, name: row.name, code: row.code,
    phone: row.phone || "", address: row.address || "", active: row.active,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

async function getSettings(client, user) {
  const result = await client.query(
    "SELECT data FROM clinic_records WHERE clinic_id=$1 AND collection='settings' AND record_id='clinic-settings' AND deleted_at IS NULL LIMIT 1",
    [user.clinicId],
  );
  return { ...DEFAULT_CLINIC_SETTINGS, ...(result.rows[0]?.data || {}) };
}

async function getStockBatches(client, user) {
  const values = [user.clinicId];
  let scope = "";
  if (branchScope(user)) {
    values.push(user.branchId);
    scope = " AND b.branch_id=$2";
  }
  const result = await client.query(
    `SELECT b.id,b.branch_id,b.product_id,b.received_qty,b.remaining_qty,b.reserved_qty,b.unit_cost,b.received_at,b.source_type,b.source_id,
            br.name AS branch_name
       FROM inventory_batches b JOIN branches br ON br.id=b.branch_id
      WHERE b.clinic_id=$1${scope} ORDER BY b.received_at DESC,b.id DESC`,
    values,
  );
  return result.rows.map((row) => ({
    id: row.id, branchId: row.branch_id, branchName: row.branch_name, productId: row.product_id,
    receivedQty: Number(row.received_qty), remainingQty: Number(row.remaining_qty), reservedQty: Number(row.reserved_qty),
    unitCost: Number(row.unit_cost), receivedAt: row.received_at, sourceType: row.source_type, sourceId: row.source_id,
  }));
}

async function getStockMovements(client, user) {
  const values = [user.clinicId];
  let scope = "";
  if (branchScope(user)) {
    values.push(user.branchId);
    scope = " AND m.branch_id=$2";
  }
  const result = await client.query(
    `SELECT m.id,m.branch_id,m.product_id,m.batch_id,m.movement_type,m.quantity_delta,m.unit_cost,
            m.reference_type,m.reference_id,m.notes,m.created_at,b.name AS branch_name
       FROM stock_movements m JOIN branches b ON b.id=m.branch_id
      WHERE m.clinic_id=$1${scope} ORDER BY m.created_at DESC LIMIT 500`,
    values,
  );
  return result.rows.map((row) => ({
    id: row.id, branchId: row.branch_id, branchName: row.branch_name, productId: row.product_id,
    batchId: row.batch_id, type: row.movement_type, quantityDelta: Number(row.quantity_delta),
    unitCost: Number(row.unit_cost), referenceType: row.reference_type, referenceId: row.reference_id,
    notes: row.notes || "", createdAt: row.created_at,
  }));
}

async function getTransfers(client, user) {
  const values = [user.clinicId];
  let scope = "";
  if (branchScope(user)) {
    values.push(user.branchId);
    scope = " AND (t.from_branch_id=$2 OR t.to_branch_id=$2)";
  }
  const result = await client.query(
    `SELECT t.*,f.name AS from_name,to_b.name AS to_name
       FROM branch_transfers t
       JOIN branches f ON f.id=t.from_branch_id
       JOIN branches to_b ON to_b.id=t.to_branch_id
      WHERE t.clinic_id=$1${scope} ORDER BY t.created_at DESC`,
    values,
  );
  return result.rows.map((row) => ({
    id: row.id, fromBranchId: row.from_branch_id, fromBranchName: row.from_name,
    toBranchId: row.to_branch_id, toBranchName: row.to_name, status: row.status,
    items: row.items || [], notes: row.notes || "", createdAt: row.created_at, resolvedAt: row.resolved_at,
  }));
}

export async function listCollection(user, collection) {
  assertCollection(collection);
  const denied = authorize(user, COLLECTION_RULES[collection].view);
  if (denied) throw fail(denied.status === 401 ? "يلزم تسجيل الدخول." : "لا تملك صلاحية عرض هذا القسم.", denied.status);
  const client = getPool();
  if (collection === "users") return getUsers(client, user);
  if (collection === "branches") return getBranches(client, user);
  if (collection === "settings") return getSettings(client, user);
  if (collection === "stockBatches") return getStockBatches(client, user);
  if (collection === "stockMovements") return getStockMovements(client, user);
  if (collection === "transfers") return getTransfers(client, user);

  const values = [user.clinicId, collection];
  let scope = "";
  if (branchScope(user) && !["products", "examiners"].includes(collection)) {
    values.push(user.branchId || "__unassigned__");
    scope = " AND branch_id=$3";
  }
  const records = await client.query(
    `SELECT record_id,branch_id,data FROM clinic_records
      WHERE clinic_id=$1 AND collection=$2 AND deleted_at IS NULL${scope}
      ORDER BY updated_at DESC`,
    values,
  );
  const rows = records.rows.map((row) => ({ ...row.data, id: row.record_id, branchId: row.branch_id || row.data?.branchId || null }));
  if (collection !== "products") return rows;

  const quantities = await client.query(
    `SELECT product_id,branch_id,COALESCE(SUM(remaining_qty-reserved_qty),0) AS qty
       FROM inventory_batches WHERE clinic_id=$1
      GROUP BY product_id,branch_id`,
    [user.clinicId],
  );
  const byProduct = new Map();
  for (const row of quantities.rows) {
    const item = byProduct.get(row.product_id) || { total: 0, branches: {} };
    item.total += Number(row.qty);
    item.branches[row.branch_id] = Number(row.qty);
    byProduct.set(row.product_id, item);
  }
  return rows.map((row) => {
    const stock = byProduct.get(String(row.id)) || { total: 0, branches: {} };
    const total = branchScope(user) ? Number(stock.branches[user.branchId] || 0) : stock.total;
    return { ...row, qty: total, quantity: total, branchQuantities: branchScope(user) ? undefined : stock.branches };
  });
}

async function upsertUser(client, currentUser, input, existingId) {
  if (currentUser.role !== "admin") throw fail("إدارة الموظفين للمدير فقط.", 403);
  const id = asText(existingId || input.id || randomUUID());
  const current = await client.query("SELECT * FROM app_users WHERE id=$1 AND clinic_id=$2 FOR UPDATE", [id, currentUser.clinicId]);
  const existing = current.rows[0];
  const name = asText(input.name, 100);
  const username = asText(input.username, 60).toLowerCase();
  const role = existing?.role === "admin" ? "admin" : asText(input.role || "receptionist", 30);
  const allowedRoles = new Set(["admin", "accountant", "receptionist", "examiner", "storekeeper"]);
  if (!name || !username || !/^[\p{L}\p{N}_.@+-]{2,60}$/u.test(username)) throw fail("أدخل اسمًا واسم مستخدم صالحًا.", 400);
  if (!allowedRoles.has(role)) throw fail("الدور الوظيفي غير صالح.", 400);
  if (!existing && role === "admin") throw fail("لا يمكن إنشاء حساب مدير إضافي من شاشة الموظفين.", 403);
  if (existing?.role === "admin" && String(existing.id) !== String(currentUser.id)) throw fail("لا يمكن تعديل حساب مدير آخر.", 403);
  if (existing?.role === "admin" && input.role && input.role !== "admin") throw fail("لا يمكن تغيير دور المدير.", 403);

  const password = String(input.password || "");
  if (!existing && password.length < 12) throw fail("كلمة المرور يجب ألا تقل عن 12 حرفًا.", 400);
  if (password && password.length < 12) throw fail("كلمة المرور الجديدة يجب ألا تقل عن 12 حرفًا.", 400);
  const branchId = await resolveBranch(client, currentUser, input.branchId || null);
  const permissions = role === "admin" ? {} : (input.permissions && typeof input.permissions === "object" ? input.permissions : {});
  const phone = asText(input.phone, 30) || null;

  if (existing) {
    const hash = password ? await bcrypt.hash(password, 12) : existing.password_hash;
    const active = existing.role === "admin" || String(existing.id) === String(currentUser.id) ? true : input.active !== false;
    await client.query(
      `UPDATE app_users SET name=$3, username=$4, username_normalized=$5, phone=$6,
        branch_id=$7, role=$8, permissions=$9::jsonb, active=$10, password_hash=$11,
        failed_login_count=0, locked_until=NULL, updated_at=now()
       WHERE id=$1 AND clinic_id=$2`,
      [id, currentUser.clinicId, name, username, username, phone, branchId, role, JSON.stringify(permissions), active, hash],
    );
    if (password) await clearUserSessions(client, id);
    if (!active) await client.query("DELETE FROM app_sessions WHERE user_id=$1", [id]);
  } else {
    const hash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO app_users(id,clinic_id,branch_id,name,username,username_normalized,phone,password_hash,role,permissions,active,must_change_password)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,FALSE)`,
      [id, currentUser.clinicId, branchId, name, username, username, phone, hash, role, JSON.stringify(permissions), input.active !== false],
    );
  }
  const safeUserBefore = existing ? {
    name: existing.name, username: existing.username, phone: existing.phone, branchId: existing.branch_id,
    role: existing.role, permissions: existing.permissions, active: existing.active,
  } : null;
  const safeUserAfter = { name, username, phone, branchId, role, permissions, active: existing?.role === "admin" || String(existing?.id || "") === String(currentUser.id) ? true : input.active !== false };
  await audit(client, currentUser, existing ? "users.update" : "users.create", "users", id, existing ? "تحديث حساب موظف" : "إنشاء حساب موظف", {
    ...auditSnapshot(safeUserBefore, safeUserAfter), passwordChanged: Boolean(password),
  });
  const result = await client.query(
    `SELECT u.id,u.clinic_id,u.branch_id,u.name,u.username,u.phone,u.role,u.permissions,u.active,u.must_change_password,
            c.name AS clinic_name,c.slug AS clinic_slug,b.name AS branch_name
       FROM app_users u JOIN clinics c ON c.id=u.clinic_id
       LEFT JOIN branches b ON b.id=u.branch_id AND b.clinic_id=u.clinic_id
      WHERE u.id=$1 AND u.clinic_id=$2`,
    [id, currentUser.clinicId],
  );
  return publicUserRow(result.rows[0]);
}

async function upsertBranch(client, user, input, existingId) {
  const id = asText(existingId || input.id || randomUUID());
  const existing = await client.query("SELECT * FROM branches WHERE id=$1 AND clinic_id=$2 FOR UPDATE", [id, user.clinicId]);
  const name = asText(input.name, 100);
  const code = asText(input.code || (existing.rows[0]?.code) || `BR-${id.slice(0, 6)}`, 30).toUpperCase();
  if (!name || !/^[A-Z0-9_-]{2,30}$/.test(code)) throw fail("أدخل اسم الفرع ورمزًا صالحًا.", 400);
  if (existing.rows[0]) {
    if (existing.rows[0].active && input.active === false) {
      const inventory = await client.query("SELECT 1 FROM inventory_batches WHERE clinic_id=$1 AND branch_id=$2 AND remaining_qty>0 LIMIT 1", [user.clinicId, id]);
      const pending = await client.query("SELECT 1 FROM branch_transfers WHERE clinic_id=$1 AND status='pending' AND (from_branch_id=$2 OR to_branch_id=$2) LIMIT 1", [user.clinicId, id]);
      if (inventory.rowCount || pending.rowCount) throw fail("لا يمكن تعطيل فرع لديه مخزون متبقٍ أو نقل معلّق.", 409);
    }
    await client.query(
      "UPDATE branches SET name=$3,code=$4,phone=$5,address=$6,active=$7,updated_at=now() WHERE id=$1 AND clinic_id=$2",
      [id, user.clinicId, name, code, asText(input.phone, 30) || null, asText(input.address, 240) || null, input.active !== false],
    );
  } else {
    await client.query(
      "INSERT INTO branches(id,clinic_id,name,code,phone,address,active) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, user.clinicId, name, code, asText(input.phone, 30) || null, asText(input.address, 240) || null, input.active !== false],
    );
  }
  const branchBefore = existing.rows[0] ? {
    name: existing.rows[0].name, code: existing.rows[0].code, phone: existing.rows[0].phone,
    address: existing.rows[0].address, active: existing.rows[0].active,
  } : null;
  const branchAfter = { name, code, phone: asText(input.phone, 30) || null, address: asText(input.address, 240) || null, active: input.active !== false };
  await audit(client, user, existing.rows[0] ? "branches.update" : "branches.create", "branches", id, existing.rows[0] ? "تحديث بيانات فرع" : "إضافة فرع", auditSnapshot(branchBefore, branchAfter));
  const result = await client.query("SELECT id,clinic_id,name,code,phone,address,active,created_at,updated_at FROM branches WHERE id=$1 AND clinic_id=$2", [id, user.clinicId]);
  const row = result.rows[0];
  return { id: row.id, clinicId: row.clinic_id, name: row.name, code: row.code, phone: row.phone || "", address: row.address || "", active: row.active, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function upsertProduct(client, user, input, id, existing) {
  const branchId = await resolveBranch(client, user, input.branchId || null);
  const productData = { ...input, id, branchId: null, qty: undefined, quantity: undefined, initialQty: undefined };
  delete productData.qty;
  delete productData.quantity;
  delete productData.initialQty;
  const inserted = await client.query(
    `INSERT INTO clinic_records(clinic_id,collection,record_id,branch_id,data)
     VALUES($1,'products',$2,NULL,$3::jsonb)
     ON CONFLICT(clinic_id,collection,record_id) DO UPDATE
       SET data=EXCLUDED.data,updated_at=now(),deleted_at=NULL
     RETURNING record_id`,
    [user.clinicId, id, JSON.stringify(productData)],
  );
  if (!existing) {
    const initialQty = Math.max(0, asNumber(input.initialQty ?? input.qty ?? input.quantity, 0));
    const unitCost = Math.max(0, asNumber(input.buy ?? input.unitCost, 0));
    if (initialQty > 0) {
      if (user.role !== "admin" && !user.branchId) throw fail("يجب ربط حساب الموظف بفرع قبل إضافة رصيد مخزون.", 403);
      let targetBranch = branchId;
      if (!targetBranch) {
        const main = await client.query("SELECT id FROM branches WHERE clinic_id=$1 AND active=TRUE ORDER BY (code='MAIN') DESC, created_at ASC LIMIT 1", [user.clinicId]);
        targetBranch = main.rows[0]?.id;
      }
      if (!targetBranch) throw fail("أنشئ فرعًا فعالًا قبل إدخال كمية افتتاحية.", 400);
      const batchId = randomUUID();
      await client.query(
        `INSERT INTO inventory_batches(id,clinic_id,branch_id,product_id,received_qty,remaining_qty,unit_cost,source_type,created_by)
         VALUES($1,$2,$3,$4,$5,$5,$6,'opening',$7)`,
        [batchId, user.clinicId, targetBranch, id, initialQty, unitCost, user.id],
      );
      await client.query(
        `INSERT INTO stock_movements(id,clinic_id,branch_id,product_id,batch_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,actor_id)
         VALUES($1,$2,$3,$4,$5,'opening',$6,$7,'product',$4,$8)`,
        [randomUUID(), user.clinicId, targetBranch, id, batchId, initialQty, unitCost, user.id],
      );
    }
  }
  await audit(client, user, existing ? "products.update" : "products.create", "products", id, existing ? "تعديل بيانات منتج" : "إضافة منتج", {
    ...auditSnapshot(existing?.data || null, productData), name: asText(input.name, 100),
  });
  return { ...productData, id: inserted.rows[0].record_id };
}

export async function saveCollectionRecord(user, collection, input, forcedId = null, createOnly = false) {
  requireCollectionPermission(user, collection, forcedId ? "update" : "create");
  if (!asObject(input)) throw fail("صيغة السجل غير صالحة.", 400);
  if (createOnly && !["patients", "examiners"].includes(collection)) throw fail("مسار الإنشاء غير متاح لهذا القسم.", 404);
  const id = asText(forcedId || input.id || randomUUID());
  if (!id || id.length > 180) throw fail("معرّف السجل غير صالح.", 400);

  return withTransaction(async (client) => {
    if (collection === "users") return upsertUser(client, user, input, forcedId || input.id || null);
    if (collection === "branches") return upsertBranch(client, user, input, forcedId || input.id || null);
    if (collection === "settings") {
      const previousResult = await client.query(
        "SELECT data FROM clinic_records WHERE clinic_id=$1 AND collection='settings' AND record_id='clinic-settings' AND deleted_at IS NULL FOR UPDATE",
        [user.clinicId],
      );
      const previousSettings = previousResult.rows[0]?.data || null;
      const nextSettings = { ...DEFAULT_CLINIC_SETTINGS, ...input };
      await client.query(
        `INSERT INTO clinic_records(clinic_id,collection,record_id,data)
         VALUES($1,'settings','clinic-settings',$2::jsonb)
         ON CONFLICT(clinic_id,collection,record_id) DO UPDATE SET data=EXCLUDED.data,updated_at=now(),deleted_at=NULL`,
        [user.clinicId, JSON.stringify(nextSettings)],
      );
      await audit(client, user, "settings.update", "settings", "clinic-settings", "تحديث إعدادات العيادة", auditSnapshot(previousSettings, nextSettings));
      return nextSettings;
    }

    if (["invoices", "returns", "transfers", "stockBatches", "stockMovements"].includes(collection)) {
      throw fail("هذه العملية المالية أو المخزنية تستخدم مسار اعتماد خاصًا لحفظ اتساق الرصيد.", 409);
    }

    const existing = await client.query(
      "SELECT data,branch_id FROM clinic_records WHERE clinic_id=$1 AND collection=$2 AND record_id=$3 AND deleted_at IS NULL FOR UPDATE",
      [user.clinicId, collection, id],
    );
    if (createOnly && existing.rowCount) throw fail("معرّف السجل مستخدم بالفعل. حاول إنشاء السجل مرة أخرى.", 409);
    if (["patients", "examiners"].includes(collection) && forcedId && !existing.rowCount) throw fail("السجل المطلوب تحديثه غير موجود.", 404);
    const operation = existing.rowCount ? "update" : "create";
    if (existing.rowCount && branchScope(user) && !["products", "examiners"].includes(collection) && String(existing.rows[0].branch_id || "") !== String(user.branchId || "")) throw fail("لا تملك صلاحية هذا الفرع أو السجل غير مسند إلى فرع.", 403);
    requireCollectionPermission(user, collection, operation);
    const branchId = await resolveBranch(client, user, input.branchId || existing.rows[0]?.branch_id || null);
    const normalized = { ...input, id, branchId };
    if (collection === "products") return upsertProduct(client, user, normalized, id, existing.rows[0]);

    if (collection === "lensInventory") {
      if (!branchId) throw fail("يجب تحديد فرع لمخزون العدسات.", 400);
      const allowedTypes = new Set(["spherical", "toric", "multifocal", "contact", "other"]);
      const quantity = asNumber(input.quantity ?? input.qty, NaN);
      const unitCost = asNumber(input.unitCost ?? input.buy, NaN);
      const sell = asNumber(input.sell ?? input.price, NaN);
      if (!asText(input.brand, 100)) throw fail("أدخل العلامة التجارية للعدسة.", 400);
      if (!allowedTypes.has(input.type || "other")) throw fail("نوع العدسة غير صالح.", 400);
      if (!Number.isFinite(quantity) || quantity < 0 || quantity > 100000) throw fail("رصيد العدسة غير صالح.", 400);
      if (!existing.rowCount && quantity <= 0) throw fail("أدخل رصيدًا افتتاحيًا أكبر من صفر.", 400);
      if (!Number.isFinite(unitCost) || unitCost < 0 || !Number.isFinite(sell) || sell < 0) throw fail("سعر الكلفة والبيع غير صالح.", 400);
      const optionalPower = (field, label, min, max) => {
        const value = input[field];
        if (value === null || value === undefined || value === "") { normalized[field] = null; return null; }
        const parsed = asNumber(value, NaN);
        if (!Number.isFinite(parsed) || parsed < min || parsed > max || Math.abs(parsed * 4 - Math.round(parsed * 4)) > 0.0001) throw fail(`${label} يجب أن يكون من مضاعفات 0.25 ضمن المجال ${min} إلى ${max}.`, 400);
        normalized[field] = parsed;
        return parsed;
      };
      optionalPower("sph", "SPH", -30, 30);
      const cyl = optionalPower("cyl", "CYL", -20, 20);
      const add = optionalPower("add", "ADD", 0, 15);
      const axis = input.axis === null || input.axis === undefined || input.axis === "" ? null : asNumber(input.axis, NaN);
      if (axis !== null && (!Number.isInteger(axis) || axis < 0 || axis > 180)) throw fail("محور العدسة يجب أن يكون عددًا صحيحًا بين 0 و180.", 400);
      if (cyl !== null && cyl !== 0 && axis === null) throw fail("أدخل محور AXIS عند تسجيل CYL غير صفري.", 400);
      normalized.axis = axis;
      const side = input.side || "pair";
      if (!["pair", "right", "left"].includes(side)) throw fail("حدد توافق العدسة: زوج أو يمين أو يسار.", 400);
      normalized.side = side;
      const diameter = input.diameter === null || input.diameter === undefined || input.diameter === "" ? null : asNumber(input.diameter, NaN);
      if (diameter !== null && (!Number.isFinite(diameter) || diameter < 10 || diameter > 30 || Math.abs(diameter * 10 - Math.round(diameter * 10)) > 0.0001)) throw fail("قطر العدسة يجب أن يكون بين 10 و30 مم بخطوة 0.1.", 400);
      normalized.diameter = diameter;
      const minQuantity = asNumber(input.minimumQuantity ?? 0, NaN);
      if (!Number.isFinite(minQuantity) || minQuantity < 0 || minQuantity > 100000) throw fail("حد تنبيه المخزون غير صالح.", 400);
      normalized.minimumQuantity = minQuantity;
      normalized.sku = asText(input.sku, 80);
      normalized.material = asText(input.material, 80);
      normalized.coating = asText(input.coating, 100);
      const refractiveIndex = input.refractiveIndex === null || input.refractiveIndex === undefined || input.refractiveIndex === "" ? null : asNumber(input.refractiveIndex, NaN);
      if (refractiveIndex !== null && (!Number.isFinite(refractiveIndex) || refractiveIndex < 1.4 || refractiveIndex > 2.0)) throw fail("معامل الانكسار يجب أن يكون بين 1.40 و2.00.", 400);
      normalized.refractiveIndex = refractiveIndex;
      if (existing.rowCount && String(existing.rows[0].branch_id || "") !== String(branchId || "")) throw fail("لا يمكن نقل سجل العدسة بين الفروع من شاشة التعديل.", 409);
      normalized.quantity = quantity;
      normalized.unitCost = unitCost;
      normalized.sell = sell;
      normalized.active = input.active !== false;
      await client.query(
        `INSERT INTO clinic_records(clinic_id,collection,record_id,branch_id,data)
         VALUES($1,'lensInventory',$2,$3,$4::jsonb)
         ON CONFLICT(clinic_id,collection,record_id) DO UPDATE
           SET branch_id=EXCLUDED.branch_id,data=EXCLUDED.data,updated_at=now(),deleted_at=NULL`,
        [user.clinicId, id, branchId, JSON.stringify(normalized)],
      );
      const delta = quantity - Number(existing.rows[0]?.data?.quantity ?? existing.rows[0]?.data?.qty ?? 0);
      if (delta !== 0) {
        await client.query(
          `INSERT INTO stock_movements(id,clinic_id,branch_id,product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,actor_id,notes)
           VALUES($1,$2,$3,$4,$5,$6,$7,'lens_inventory',$4,$8,$9)`,
          [randomUUID(), user.clinicId, branchId, id, existing.rowCount ? "adjustment" : "opening", delta, unitCost, user.id, existing.rowCount ? "تعديل رصيد مخزون العدسات" : "رصيد افتتاحي لمخزون العدسات"],
        );
      }
      await audit(client, user, `lensInventory.${operation}`, collection, id, operation === "create" ? "إضافة قياس ورصيد عدسة" : "تعديل سجل العدسة", {
        ...auditSnapshot(existing.rows[0]?.data || null, normalized), branchId, quantityDelta: delta,
      });
      return normalized;
    }

    if (createOnly) {
      const inserted = await client.query(
        `INSERT INTO clinic_records(clinic_id,collection,record_id,branch_id,data)
         VALUES($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT(clinic_id,collection,record_id) DO NOTHING
         RETURNING record_id`,
        [user.clinicId, collection, id, branchId, JSON.stringify(normalized)],
      );
      assertSingleCreate(inserted.rowCount);
    } else {
      await client.query(
        `INSERT INTO clinic_records(clinic_id,collection,record_id,branch_id,data)
         VALUES($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT(clinic_id,collection,record_id) DO UPDATE
           SET branch_id=EXCLUDED.branch_id,data=EXCLUDED.data,updated_at=now(),deleted_at=NULL`,
        [user.clinicId, collection, id, branchId, JSON.stringify(normalized)],
      );
    }
    await audit(client, user, `${collection}.${operation}`, collection, id, operation === "create" ? "إضافة سجل" : "تعديل سجل", {
      ...auditSnapshot(existing.rows[0]?.data || null, normalized), branchId,
    });
    return normalized;
  });
}

export async function createPersonRecord(user, collection, input) {
  assertCollection(collection);
  if (!["patients", "examiners"].includes(collection)) throw fail("مسار الإنشاء غير متاح لهذا القسم.", 404);
  if (!asObject(input)) throw fail("صيغة السجل غير صالحة.", 400);
  const identity = newRecordIdentity(collection);
  return saveCollectionRecord(user, collection, { ...input, ...identity }, null, true);
}

export async function saveCollectionBulk(user, collection, input) {
  if (collection === "settings") return saveCollectionRecord(user, collection, asObject(input) ? input : (Array.isArray(input) ? input[0] || {} : {}));
  if (!Array.isArray(input)) throw fail("المطلوب قائمة سجلات.", 400);
  if (user.role !== "admin") throw fail("استيراد أو استعادة البيانات متاح لمدير العيادة فقط.", 403);
  if (input.length > 5000) throw fail("عدد السجلات يتجاوز الحد المسموح في الدفعة الواحدة.", 413);
  const saved = [];
  for (const row of input) saved.push(await saveCollectionRecord(user, collection, row));
  return saved;
}

export async function removeCollectionRecord(user, collection, id) {
  requireCollectionPermission(user, collection, "delete");
  const recordId = asText(id, 180);
  if (!recordId) throw fail("معرّف السجل غير صالح.", 400);

  return withTransaction(async (client) => {
    if (collection === "users") {
      if (String(recordId) === String(user.id)) throw fail("لا يمكن حذف الحساب المستخدم حاليًا.", 403);
      const target = await client.query("SELECT name,username,phone,branch_id,role,permissions,active FROM app_users WHERE id=$1 AND clinic_id=$2 FOR UPDATE", [recordId, user.clinicId]);
      if (!target.rowCount) return false;
      if (target.rows[0].role === "admin") throw fail("لا يمكن حذف حساب مدير.", 403);
      await client.query("DELETE FROM app_users WHERE id=$1 AND clinic_id=$2", [recordId, user.clinicId]);
      await audit(client, user, "users.delete", "users", recordId, "حذف حساب موظف", {
        before: target.rows[0], after: null,
      });
      return true;
    }
    if (collection === "branches") {
      if (branchScope(user)) throw fail("إدارة الفروع للمدير المخول فقط.", 403);
      const branchResult = await client.query("SELECT id,name,code,phone,address,active FROM branches WHERE id=$1 AND clinic_id=$2 FOR UPDATE", [recordId, user.clinicId]);
      if (!branchResult.rowCount) return false;
      const inventory = await client.query("SELECT 1 FROM inventory_batches WHERE clinic_id=$1 AND branch_id=$2 AND remaining_qty>0 LIMIT 1", [user.clinicId, recordId]);
      const pending = await client.query("SELECT 1 FROM branch_transfers WHERE clinic_id=$1 AND status='pending' AND (from_branch_id=$2 OR to_branch_id=$2) LIMIT 1", [user.clinicId, recordId]);
      if (inventory.rowCount || pending.rowCount) throw fail("لا يمكن تعطيل فرع لديه مخزون متبقٍ أو نقل معلّق.", 409);
      await client.query("UPDATE branches SET active=FALSE,updated_at=now() WHERE id=$1 AND clinic_id=$2", [recordId, user.clinicId]);
      await audit(client, user, "branches.disable", collection, recordId, "تعطيل فرع", {
        before: branchResult.rows[0], after: { ...branchResult.rows[0], active: false },
      });
      return true;
    }
    if (collection === "invoices") throw fail("لا يمكن حذف فاتورة معتمدة؛ سجّل عائدًا أو إلغاءً موثقًا بدلًا من حذفها.", 409);
    if (collection === "returns") throw fail("لا يمكن إلغاء عائد معتمد بعد تطبيقه على المخزون. سجّل حركة تصحيح مستقلة بعد مراجعة المدير.", 409);

    const found = await client.query(
      "SELECT data,branch_id FROM clinic_records WHERE clinic_id=$1 AND collection=$2 AND record_id=$3 AND deleted_at IS NULL FOR UPDATE",
      [user.clinicId, collection, recordId],
    );
    if (!found.rowCount) return false;
    if (branchScope(user) && !["products", "examiners"].includes(collection) && String(found.rows[0].branch_id || "") !== String(user.branchId || "")) throw fail("لا تملك صلاحية هذا الفرع أو السجل غير مسند إلى فرع.", 403);
    const beforeData = found.rows[0].data || {};
    let afterData = null;

    if (collection === "products") {
      const stock = await client.query("SELECT COALESCE(SUM(remaining_qty),0) AS qty FROM inventory_batches WHERE clinic_id=$1 AND product_id=$2", [user.clinicId, recordId]);
      if (Number(stock.rows[0]?.qty || 0) > 0) throw fail("لا يمكن تعطيل منتج له رصيد. انقل الرصيد أو سجّل تسوية أولًا.", 409);
      await client.query("UPDATE clinic_records SET data=jsonb_set(data,'{active}','false'::jsonb),updated_at=now() WHERE clinic_id=$1 AND collection='products' AND record_id=$2", [user.clinicId, recordId]);
      afterData = { ...beforeData, active: false };
    } else if (collection === "expenses") {
      await client.query("UPDATE clinic_records SET data=jsonb_set(data,'{status}','\"void\"'::jsonb),updated_at=now() WHERE clinic_id=$1 AND collection=$2 AND record_id=$3", [user.clinicId, collection, recordId]);
      afterData = { ...beforeData, status: "void" };
    } else if (collection === "lensInventory") {
      const lensQty = Number(found.rows[0]?.data?.quantity ?? found.rows[0]?.data?.qty ?? 0);
      if (lensQty > 0) throw fail("لا يمكن تعطيل قياس عدسة له رصيد. بع الكمية أو سوّها أولًا.", 409);
      await client.query("UPDATE clinic_records SET data=jsonb_set(data,'{active}','false'::jsonb),updated_at=now() WHERE clinic_id=$1 AND collection='lensInventory' AND record_id=$2", [user.clinicId, recordId]);
      afterData = { ...beforeData, active: false };
    } else if (collection === "patients") {
      await client.query("UPDATE clinic_records SET deleted_at=now(),updated_at=now() WHERE clinic_id=$1 AND collection='patients' AND record_id=$2", [user.clinicId, recordId]);
    } else {
      await client.query("DELETE FROM clinic_records WHERE clinic_id=$1 AND collection=$2 AND record_id=$3", [user.clinicId, collection, recordId]);
    }
    await audit(client, user, `${collection}.delete`, collection, recordId, "حذف أو تعطيل سجل", {
      ...auditSnapshot(beforeData, afterData), branchId: found.rows[0].branch_id || null,
    });
    return true;
  });
}

export async function getRecordForBusiness(client, user, collection, id, lock = false) {
  const result = await client.query(
    `SELECT record_id,branch_id,data FROM clinic_records
      WHERE clinic_id=$1 AND collection=$2 AND record_id=$3 AND deleted_at IS NULL${lock ? " FOR UPDATE" : ""}`,
    [user.clinicId, collection, String(id)],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  if (branchScope(user) && String(row.branch_id || "") !== String(user.branchId || "")) throw fail("لا تملك صلاحية هذا الفرع أو السجل غير مسند إلى فرع.", 403);
  return { ...row.data, id: row.record_id, branchId: row.branch_id || row.data?.branchId || null };
}

export async function putRecordForBusiness(client, user, collection, record, branchId = null) {
  const id = String(record.id || randomUUID());
  await client.query(
    `INSERT INTO clinic_records(clinic_id,collection,record_id,branch_id,data)
     VALUES($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT(clinic_id,collection,record_id) DO UPDATE
       SET branch_id=EXCLUDED.branch_id,data=EXCLUDED.data,updated_at=now(),deleted_at=NULL`,
    [user.clinicId, collection, id, branchId, JSON.stringify({ ...record, id, branchId })],
  );
  return { ...record, id, branchId };
}

export async function addAuditEvent(client, user, action, collection, recordId, summary, metadata = {}) {
  return audit(client, user, action, collection, recordId, summary, metadata);
}
