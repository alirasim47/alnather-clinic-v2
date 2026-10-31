import "server-only";
import { randomUUID } from "node:crypto";
import { withTransaction, getPool } from "./db";
import { authorize } from "./access";
import { addAuditEvent } from "./collections";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/storage";

const RECORDS = ["patients", "exams", "examiners", "followups", "products", "invoices", "lensInventory", "expenses", "returns"];
const ENTITY_TYPES = [...RECORDS, "branches", "stockBatches", "stockMovements"];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const rowsOf = (data, key) => Array.isArray(data[key]) ? data[key] : [];
const isNonStockService = (product) => product?.cat === "services" || product?.type === "service" || product?.trackStock === false;
const normalizePayload = (payload) => {
  const data = object(payload?.data) ? payload.data : object(payload) ? payload : null;
  if (!data) throw fail("ملف النسخة لا يحتوي على كائن بيانات صالح.", 400);
  return data;
};
const canImport = (user) => {
  const denied = authorize(user, "users.manage");
  if (denied) throw fail(denied.status === 401 ? "يلزم تسجيل الدخول." : "استيراد البيانات متاح لمدير العيادة فقط.", denied.status);
};

async function chooseBranch(client, user, proposedId, branchMap = new Map()) {
  if (user.role !== "admin" && user.branchId) {
    const branch = await client.query("SELECT id FROM branches WHERE id=$1 AND clinic_id=$2 AND active=TRUE", [user.branchId, user.clinicId]);
    if (branch.rowCount) return branch.rows[0].id;
  }
  const mapped = proposedId ? (branchMap.get(String(proposedId)) || String(proposedId)) : null;
  if (mapped) {
    const branch = await client.query("SELECT id FROM branches WHERE id=$1 AND clinic_id=$2 AND active=TRUE", [mapped, user.clinicId]);
    if (branch.rowCount) return branch.rows[0].id;
  }
  const branch = await client.query("SELECT id FROM branches WHERE clinic_id=$1 AND active=TRUE ORDER BY (code='MAIN') DESC,created_at ASC LIMIT 1", [user.clinicId]);
  if (!branch.rowCount) throw fail("أنشئ فرعًا فعالًا قبل استيراد سجلات المخزون.", 409);
  return branch.rows[0].id;
}

function inspect(data) {
  const result = {};
  for (const name of ENTITY_TYPES) {
    const source = data[name];
    const rows = Array.isArray(source) ? source.filter(object) : [];
    const ids = rows.map((row) => String(row.id ?? "").trim()).filter(Boolean);
    result[name] = { sourceCount: Array.isArray(source) ? source.length : 0, validCount: ids.length, missingIdCount: rows.length - ids.length, invalidCount: (Array.isArray(source) ? source.length : 0) - rows.length };
  }
  result.settings = { present: object(data.settings), alreadyPresent: false, toImport: false };
  result.skippedUsers = Array.isArray(data.users) ? data.users.length : 0;
  result.skippedTransfers = Array.isArray(data.transfers) ? data.transfers.length : 0;
  return result;
}

async function existingEntityIds(client, clinicId, name, ids) {
  if (!ids.length) return new Set();
  let query;
  let values;
  if (RECORDS.includes(name)) {
    query = "SELECT record_id AS id FROM clinic_records WHERE clinic_id=$1 AND collection=$2 AND record_id=ANY($3::text[])";
    values = [clinicId, name, ids];
  } else if (name === "branches") {
    query = "SELECT id FROM branches WHERE clinic_id=$1 AND id=ANY($2::text[])";
    values = [clinicId, ids];
  } else {
    const table = name === "stockBatches" ? "inventory_batches" : "stock_movements";
    query = `SELECT id FROM ${table} WHERE clinic_id=$1 AND id=ANY($2::text[])`;
    values = [clinicId, ids];
  }
  const result = await client.query(query, values);
  return new Set(result.rows.map(row => String(row.id)));
}

export async function previewClinicImport(user, payload) {
  canImport(user);
  const data = normalizePayload(payload);
  const counts = inspect(data);
  const client = getPool();
  for (const name of ENTITY_TYPES) {
    const source = rowsOf(data, name);
    const ids = [...new Set(source.map(row => String(row?.id ?? "").trim()).filter(Boolean))];
    const existing = await existingEntityIds(client, user.clinicId, name, ids);
    const seen = new Set();
    let sourceDuplicates = 0;
    let duplicates = 0;
    let duplicateCodes = 0;
    const codes = name === "branches" ? [...new Set(source.map(row => String(row?.code || "").trim().toUpperCase()).filter(Boolean))] : [];
    let existingCodes = new Set();
    if (codes.length) {
      const result = await client.query("SELECT code FROM branches WHERE clinic_id=$1 AND code=ANY($2::text[])", [user.clinicId, codes]);
      existingCodes = new Set(result.rows.map(row => String(row.code).toUpperCase()));
    }
    for (const row of source) {
      const id = String(row?.id ?? "").trim();
      if (!id) continue;
      if (seen.has(id)) { sourceDuplicates += 1; continue; }
      seen.add(id);
      if (existing.has(id)) duplicates += 1;
      else if (name === "branches" && existingCodes.has(String(row.code || "").trim().toUpperCase())) duplicateCodes += 1;
    }
    counts[name] = { ...counts[name], duplicateInFile: sourceDuplicates, alreadyPresent: duplicates + duplicateCodes, toImport: Math.max(0, seen.size - duplicates - duplicateCodes) };
  }
  const settings = await client.query("SELECT 1 FROM clinic_records WHERE clinic_id=$1 AND collection='settings' AND record_id='clinic-settings' AND deleted_at IS NULL", [user.clinicId]);
  counts.settings = { present: object(data.settings), alreadyPresent: Boolean(settings.rowCount), toImport: Boolean(object(data.settings) && !settings.rowCount) };
  const totalToImport = ENTITY_TYPES.reduce((sum, name) => sum + Number(counts[name].toImport), 0) + Number(counts.settings.toImport);
  return { counts, totalToImport, skippedUsers: counts.skippedUsers, skippedTransfers: counts.skippedTransfers, replacesExisting: false };
}

export async function applyClinicImport(user, payload) {
  canImport(user);
  const data = normalizePayload(payload);
  const sourceStats = inspect(data);
  return withTransaction(async (client) => {
    const imported = Object.fromEntries([...ENTITY_TYPES, "settings"].map(name => [name, 0]));
    const branchMap = new Map();

    for (const raw of rowsOf(data, "branches")) {
      if (!object(raw)) continue;
      const id = String(raw.id ?? "").trim();
      const code = String(raw.code ?? "").trim().toUpperCase();
      const name = String(raw.name ?? "").trim();
      if (!id || id.length > 180 || !name || !/^[A-Z0-9_-]{2,30}$/.test(code)) continue;
      const existingId = await client.query("SELECT id FROM branches WHERE clinic_id=$1 AND id=$2", [user.clinicId, id]);
      if (existingId.rowCount) { branchMap.set(id, existingId.rows[0].id); continue; }
      const existingCode = await client.query("SELECT id FROM branches WHERE clinic_id=$1 AND code=$2", [user.clinicId, code]);
      if (existingCode.rowCount) { branchMap.set(id, existingCode.rows[0].id); continue; }
      const inserted = await client.query(
        `INSERT INTO branches(id,clinic_id,name,code,phone,address,active)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
        [id, user.clinicId, name.slice(0,100), code, String(raw.phone || "").slice(0,30) || null, String(raw.address || "").slice(0,240) || null, raw.active !== false],
      );
      if (inserted.rowCount) { imported.branches += 1; branchMap.set(id, inserted.rows[0].id); }
    }

    const sourceBatchRows = rowsOf(data, "stockBatches");
    const sourceMovementRows = rowsOf(data, "stockMovements");
    const batchProducts = new Set(sourceBatchRows.map(row => String(row?.productId ?? "")).filter(Boolean));

    for (const collection of RECORDS) {
      const seen = new Set();
      for (const raw of rowsOf(data, collection)) {
        if (!object(raw)) continue;
        const id = String(raw.id ?? "").trim();
        if (!id || id.length > 180 || seen.has(id)) continue;
        seen.add(id);
        const scopedBranch = await chooseBranch(client, user, raw.branchId, branchMap);
        let record = { ...raw, id, branchId: scopedBranch, importedAt: new Date().toISOString() };
        if (collection === "products") {
          const openingQty = Number(raw.qty ?? raw.quantity ?? raw.initialQty ?? 0);
          const unitCost = Number(raw.buy ?? raw.unitCost ?? 0);
          if (!Number.isFinite(openingQty) || openingQty < 0 || openingQty > 1_000_000 || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1_000_000_000) throw fail(`بيانات الكمية أو الكلفة غير صالحة للمنتج ${raw.name || id}.`, 400);
          delete record.qty; delete record.quantity; delete record.initialQty;
          record.active = raw.active !== false;
        }
        if (collection === "invoices") {
          record = { ...record, legacyImported: true, returnedTotal: Number(raw.returnedTotal || 0), returnedQuantities: raw.returnedQuantities || {},
            items: Array.isArray(raw.items) ? raw.items.map((item, index) => ({ ...item, id: String(item.id ?? `${id}-item-${index + 1}`), stockManaged: false, sourceCollection: "legacy" })) : [] };
        }
        if (collection === "returns") record = { ...record, importedLegacy: true, status: raw.status || "posted" };
        const inserted = await client.query(
          `INSERT INTO clinic_records(clinic_id,collection,record_id,branch_id,data)
           VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(clinic_id,collection,record_id) DO NOTHING RETURNING record_id`,
          [user.clinicId, collection, id, scopedBranch, JSON.stringify(record)],
        );
        if (!inserted.rowCount) continue;
        imported[collection] += 1;

        if (collection === "products" && !batchProducts.has(id) && !isNonStockService(raw)) {
          const openingQty = Number(raw.qty ?? raw.quantity ?? raw.initialQty ?? 0);
          if (openingQty > 0) {
            const cost = Number(raw.buy ?? raw.unitCost ?? 0);
            const batchId = randomUUID();
            await client.query(
              `INSERT INTO inventory_batches(id,clinic_id,branch_id,product_id,received_qty,remaining_qty,unit_cost,source_type,source_id,created_by)
               VALUES($1,$2,$3,$4,$5,$5,$6,'opening','legacy-import',$7)`,
              [batchId, user.clinicId, scopedBranch, id, openingQty, cost, user.id],
            );
            await client.query(
              `INSERT INTO stock_movements(id,clinic_id,branch_id,product_id,batch_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,notes,actor_id)
               VALUES($1,$2,$3,$4,$5,'opening',$6,$7,'import',$8,'رصيد افتتاحي مرحّل من نسخة احتياطية',$9)`,
              [randomUUID(), user.clinicId, scopedBranch, id, batchId, openingQty, cost, id, user.id],
            );
          }
        }
        if (collection === "lensInventory") {
          const quantity = Number(raw.quantity ?? raw.qty ?? 0);
          if (!Number.isFinite(quantity) || quantity < 0 || quantity > 100000) throw fail(`كمية العدسة غير صالحة (${id}).`, 400);
          const cost = Number(raw.unitCost ?? raw.buy ?? 0);
          const hasSourceOpeningMovement = sourceMovementRows.some((movement) =>
            String(movement.productId ?? movement.product_id ?? "") === id
            && String(movement.type ?? movement.movementType ?? movement.movement_type ?? "") === "opening",
          );
          if (quantity > 0 && !hasSourceOpeningMovement) await client.query(
            `INSERT INTO stock_movements(id,clinic_id,branch_id,product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,notes,actor_id)
             VALUES($1,$2,$3,$4,'opening',$5,$6,'import',$4,'رصيد عدسات مرحّل من نسخة احتياطية',$7)`,
            [randomUUID(), user.clinicId, scopedBranch, id, quantity, cost, user.id],
          );
        }
      }
    }

    for (const raw of sourceBatchRows) {
      if (!object(raw)) continue;
      const id = String(raw.id ?? "").trim();
      const productId = String(raw.productId ?? "").trim();
      const receivedQty = Number(raw.receivedQty ?? raw.received_qty ?? 0);
      const remainingQty = Number(raw.remainingQty ?? raw.remaining_qty ?? 0);
      const unitCost = Number(raw.unitCost ?? raw.unit_cost ?? 0);
      if (!id || !productId || !Number.isFinite(receivedQty) || !Number.isFinite(remainingQty) || receivedQty < 0 || remainingQty < 0 || remainingQty > receivedQty || !Number.isFinite(unitCost) || unitCost < 0) continue;
      const productRow = await client.query("SELECT data FROM clinic_records WHERE clinic_id=$1 AND collection='products' AND record_id=$2 AND deleted_at IS NULL", [user.clinicId, productId]);
      if (!productRow.rowCount || isNonStockService(productRow.rows[0].data)) continue;
      const branchId = await chooseBranch(client, user, raw.branchId, branchMap);
      const result = await client.query(
        `INSERT INTO inventory_batches(id,clinic_id,branch_id,product_id,received_qty,remaining_qty,reserved_qty,unit_cost,received_at,source_type,source_id,created_by)
         VALUES($1,$2,$3,$4,$5,$6,0,$7,COALESCE($8::timestamptz,now()),$9,$10,$11)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [id, user.clinicId, branchId, productId, receivedQty, remainingQty, unitCost, raw.receivedAt ?? raw.received_at ?? null, String(raw.sourceType ?? raw.source_type ?? "purchase"), String(raw.sourceId ?? raw.source_id ?? "") || null, user.id],
      );
      imported.stockBatches += result.rowCount;
    }

    const allowedMovements = new Set(["opening", "purchase", "sale", "return", "adjustment", "transfer_out", "transfer_in"]);
    for (const raw of sourceMovementRows) {
      if (!object(raw)) continue;
      const id = String(raw.id ?? "").trim();
      const productId = String(raw.productId ?? "").trim();
      const type = String(raw.type ?? raw.movementType ?? raw.movement_type ?? "");
      const quantityDelta = Number(raw.quantityDelta ?? raw.quantity_delta);
      const unitCost = Number(raw.unitCost ?? raw.unit_cost ?? 0);
      if (!id || !productId || !allowedMovements.has(type) || !Number.isFinite(quantityDelta) || !Number.isFinite(unitCost) || unitCost < 0) continue;
      const branchId = await chooseBranch(client, user, raw.branchId ?? raw.branch_id, branchMap);
      const batchId = raw.batchId ?? raw.batch_id ?? null;
      const validBatch = batchId ? await client.query("SELECT 1 FROM inventory_batches WHERE clinic_id=$1 AND id=$2", [user.clinicId, String(batchId)]) : null;
      const result = await client.query(
        `INSERT INTO stock_movements(id,clinic_id,branch_id,product_id,batch_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,notes,created_at,actor_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,now()),$13)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
        [id, user.clinicId, branchId, productId, validBatch?.rowCount ? String(batchId) : null, type, quantityDelta, unitCost, String(raw.referenceType ?? raw.reference_type ?? "import"), String(raw.referenceId ?? raw.reference_id ?? "") || null, String(raw.notes || "").slice(0,300), raw.createdAt ?? raw.created_at ?? null, user.id],
      );
      imported.stockMovements += result.rowCount;
    }

    if (object(data.settings)) {
      const settingData = { ...DEFAULT_CLINIC_SETTINGS, ...data.settings };
      const result = await client.query(
        `INSERT INTO clinic_records(clinic_id,collection,record_id,branch_id,data)
         VALUES($1,'settings','clinic-settings',NULL,$2::jsonb) ON CONFLICT(clinic_id,collection,record_id) DO NOTHING RETURNING record_id`,
        [user.clinicId, JSON.stringify(settingData)],
      );
      imported.settings = result.rowCount;
    }

    await addAuditEvent(client, user, "clinic.import", "clinic_records", null, "استيراد آمن دون استبدال السجلات الموجودة", { imported, sourceStats, skippedUsers: Array.isArray(data.users) ? data.users.length : 0, skippedTransfers: Array.isArray(data.transfers) ? data.transfers.length : 0 });
    return { imported, skippedUsers: Array.isArray(data.users) ? data.users.length : 0, skippedTransfers: Array.isArray(data.transfers) ? data.transfers.length : 0, replaced: 0 };
  });
}
