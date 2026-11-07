import "server-only";
import { randomUUID } from "node:crypto";
import { withTransaction, getPool } from "./db";
import { authorize } from "./access";
import { addAuditEvent } from "./collections";
import { auditSnapshot } from "./audit-diff.mjs";
import { DEFAULT_CLINIC_SETTINGS } from "@/lib/storage";
import { mapLegacyBranchContext, validateLegacyInvoice } from "./legacy-invoice-import.mjs";

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

async function buildImportBranchContext(client, clinicId, sourceBranches) {
  const result = await client.query("SELECT id,code,name FROM branches WHERE clinic_id=$1", [clinicId]);
  const sourceIds = [...new Set(sourceBranches.filter(object).map((row) => String(row.id ?? "").trim()).filter((id) => id && id.length <= 180))];
  let foreignBranchIds = new Set();
  if (sourceIds.length) {
    const conflicts = await client.query(
      "SELECT id FROM branches WHERE clinic_id<>$1 AND id=ANY($2::text[])",
      [clinicId, sourceIds],
    );
    foreignBranchIds = new Set(conflicts.rows.map((row) => String(row.id)));
  }
  return mapLegacyBranchContext(result.rows, sourceBranches, foreignBranchIds);
}

async function clinicPatientIds(client, clinicId, sourcePatients) {
  const result = await client.query("SELECT record_id, deleted_at IS NOT NULL AS deleted FROM clinic_records WHERE clinic_id=$1 AND collection='patients'", [clinicId]);
  const ids = new Set(result.rows.filter((row) => !row.deleted).map((row) => String(row.record_id)));
  const deletedIds = new Set(result.rows.filter((row) => row.deleted).map((row) => String(row.record_id)));
  for (const row of sourcePatients) {
    if (!object(row)) continue;
    const id = String(row.id ?? "").trim();
    if (id && id.length <= 180 && !deletedIds.has(id)) ids.add(id);
  }
  return ids;
}

async function validateInvoiceBatch(client, user, data, branchContext) {
  const source = rowsOf(data, "invoices");
  const ids = [...new Set(source.map((row) => String(row?.id ?? "").trim()).filter(Boolean))];
  const existingIds = await existingEntityIds(client, user.clinicId, "invoices", ids);
  const existingNumbersResult = await client.query(
    "SELECT lower(data->>'no') AS no FROM clinic_records WHERE clinic_id=$1 AND collection='invoices' AND deleted_at IS NULL AND coalesce(data->>'no','')<>''",
    [user.clinicId],
  );
  const existingNumbers = new Set(existingNumbersResult.rows.map((row) => String(row.no).toLowerCase()));
  const patientIds = await clinicPatientIds(client, user.clinicId, rowsOf(data, "patients"));
  const plans = new Map();
  const seenIds = new Set();
  const seenNumbers = new Set();
  const rejected = [];
  let alreadyPresent = 0;
  let duplicateInFile = 0;
  let rejectedCount = 0;
  let paymentCount = 0;

  const reject = (raw, index, reasons) => {
    rejectedCount += 1;
    if (rejected.length < 100) rejected.push({ invoice: String(raw?.no || raw?.invoiceNo || raw?.id || `سجل ${index + 1}`).slice(0, 100), reason: [...new Set(reasons)].slice(0, 8).join("؛ ") });
  };

  for (let index = 0; index < source.length; index += 1) {
    const raw = source[index];
    const id = String(raw?.id ?? "").trim();
    if (id && seenIds.has(id)) { duplicateInFile += 1; continue; }
    if (id) seenIds.add(id);
    if (id && existingIds.has(id)) { alreadyPresent += 1; continue; }

    const result = validateLegacyInvoice(raw);
    const reasons = [...result.errors];
    let targetBranchId = "";
    if (result.invoice) {
      targetBranchId = branchContext.map.get(result.invoice.branchId) || (branchContext.ids.has(result.invoice.branchId) ? result.invoice.branchId : "");
      if (!targetBranchId || !branchContext.ids.has(targetBranchId)) reasons.push("الفرع المرتبط بالفاتورة غير موجود أو غير صالح ضمن هذه العيادة.");
      else if (user.role !== "admin" && user.branchId && String(user.branchId) !== targetBranchId) reasons.push("الفرع لا يطابق نطاق المستخدم.");
      if (result.invoice.patientId && !patientIds.has(result.invoice.patientId)) reasons.push("المريض المرتبط بالفاتورة غير موجود ضمن سجلات هذه العيادة أو الملف.");
      const numberKey = result.invoice.no.toLowerCase();
      if (existingNumbers.has(numberKey) || seenNumbers.has(numberKey)) reasons.push("رقم الفاتورة مستخدم مسبقًا أو مكرر في الملف.");
      if (!reasons.length) {
        seenNumbers.add(numberKey);
        const invoice = { ...result.invoice, branchId: targetBranchId, branchName: branchContext.names.get(targetBranchId) || "" };
        plans.set(invoice.id, { invoice, payments: result.payments });
        paymentCount += result.payments.length;
      }
    }
    if (reasons.length) reject(raw, index, reasons);
  }

  return {
    plans,
    summary: {
      sourceCount: source.length,
      validCount: plans.size,
      alreadyPresent,
      duplicateInFile,
      rejectedCount,
      paymentCount,
      rejected,
      rejectionListTruncated: rejectedCount > rejected.length,
    },
  };
}

export async function previewClinicImport(user, payload) {
  canImport(user);
  const data = normalizePayload(payload);
  const counts = inspect(data);
  const client = getPool();
  const branchContext = await buildImportBranchContext(client, user.clinicId, rowsOf(data, "branches"));
  let invoiceValidation = null;
  for (const name of ENTITY_TYPES) {
    if (name === "invoices") {
      const batch = await validateInvoiceBatch(client, user, data, branchContext);
      invoiceValidation = batch.summary;
      counts.invoices = { ...counts.invoices, validCount: batch.summary.validCount, alreadyPresent: batch.summary.alreadyPresent, duplicateInFile: batch.summary.duplicateInFile, rejectedCount: batch.summary.rejectedCount, toImport: batch.summary.validCount };
      continue;
    }
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
  return { counts, totalToImport, invoiceValidation, skippedUsers: counts.skippedUsers, skippedTransfers: counts.skippedTransfers, replacesExisting: false };
}

export async function applyClinicImport(user, payload) {
  canImport(user);
  const data = normalizePayload(payload);
  const sourceStats = inspect(data);
  return withTransaction(async (client) => {
    const imported = Object.fromEntries([...ENTITY_TYPES, "settings"].map(name => [name, 0]));
    const branchMap = new Map();
    let invoicePaymentRows = 0;
    let invoiceValidation = { sourceCount: 0, validCount: 0, alreadyPresent: 0, duplicateInFile: 0, rejectedCount: 0, paymentCount: 0, rejected: [], rejectionListTruncated: false };

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

    const branchContext = await buildImportBranchContext(client, user.clinicId, rowsOf(data, "branches"));
    for (const [sourceId, targetId] of branchMap) {
      branchContext.map.set(sourceId, targetId);
      branchContext.ids.add(targetId);
    }
    const sourceBatchRows = rowsOf(data, "stockBatches");
    const sourceMovementRows = rowsOf(data, "stockMovements");
    const batchProducts = new Set(sourceBatchRows.map(row => String(row?.productId ?? "")).filter(Boolean));

    for (const collection of RECORDS) {
      const seen = new Set();
      let invoicePlans = new Map();
      if (collection === "invoices") {
        const batch = await validateInvoiceBatch(client, user, data, branchContext);
        invoiceValidation = batch.summary;
        invoicePlans = batch.plans;
      }
      for (const raw of rowsOf(data, collection)) {
        if (!object(raw)) continue;
        const id = String(raw.id ?? "").trim();
        if (!id || id.length > 180 || seen.has(id)) continue;
        seen.add(id);
        let scopedBranch;
        let record;
        let paymentRows = [];
        if (collection === "invoices") {
          const plan = invoicePlans.get(id);
          if (!plan) continue;
          scopedBranch = plan.invoice.branchId;
          paymentRows = plan.payments.map((payment) => ({
            ...payment,
            id: randomUUID(),
            importedBy: user.id,
            legacyImported: true,
          }));
          record = {
            ...plan.invoice,
            branchId: scopedBranch,
            branchName: plan.invoice.branchName,
            paymentHistory: paymentRows.map((payment) => ({ ...payment, createdBy: null })),
            legacyImported: true,
            legacyImportedBy: user.id,
            importedAt: new Date().toISOString(),
          };
        } else {
          scopedBranch = await chooseBranch(client, user, raw.branchId, branchMap);
          record = { ...raw, id, branchId: scopedBranch, importedAt: new Date().toISOString() };
        }
        if (collection === "products") {
          const openingQty = Number(raw.qty ?? raw.quantity ?? raw.initialQty ?? 0);
          const unitCost = Number(raw.buy ?? raw.unitCost ?? 0);
          if (!Number.isFinite(openingQty) || openingQty < 0 || openingQty > 1_000_000 || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1_000_000_000) throw fail(`بيانات الكمية أو الكلفة غير صالحة للمنتج ${raw.name || id}.`, 400);
          delete record.qty; delete record.quantity; delete record.initialQty;
          record.active = raw.active !== false;
        }
        if (collection === "returns") record = { ...record, importedLegacy: true, status: raw.status || "posted" };
        let inserted;
        try {
          inserted = await client.query(
            `INSERT INTO clinic_records(clinic_id,collection,record_id,branch_id,data)
             VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(clinic_id,collection,record_id) DO NOTHING RETURNING record_id`,
            [user.clinicId, collection, id, scopedBranch, JSON.stringify(record)],
          );
        } catch (error) {
          if (collection === "invoices" && error?.code === "23505") throw fail("تعارض رقم فاتورة أثناء التطبيق؛ أُلغيت المعاملة ولم يُستبدل أي سجل.", 409);
          throw error;
        }
        if (!inserted.rowCount) continue;
        imported[collection] += 1;
        await addAuditEvent(client, user, `import.${collection}`, collection, id, "استيراد سجل مرحّل", {
          ...auditSnapshot(null, record),
          branchId: scopedBranch,
          legacyImported: collection === "invoices" || collection === "returns",
          paymentRowsInserted: collection === "invoices" ? paymentRows.length : undefined,
        });

        if (collection === "invoices") {
          for (const payment of paymentRows) {
            await client.query(
              `INSERT INTO invoice_payments(id,clinic_id,branch_id,invoice_id,amount,method,reference,notes,paid_at,created_by)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [payment.id, user.clinicId, scopedBranch, id, payment.amount, payment.method, payment.reference || null, payment.notes || null, payment.paidAt, user.id],
            );
            invoicePaymentRows += 1;
          }
        }

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
            await addAuditEvent(client, user, "import.stockOpening", "stockBatches", batchId, "استيراد رصيد افتتاحي لمنتج", {
              before: null, after: { productId: id, branchId: scopedBranch, quantity: openingQty, unitCost: cost, sourceType: "opening" },
            });
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
      if (result.rowCount) await addAuditEvent(client, user, "import.stockBatch", "stockBatches", id, "استيراد دفعة مخزون", {
        before: null,
        after: { branchId, productId, receivedQty, remainingQty, unitCost, receivedAt: raw.receivedAt ?? raw.received_at ?? null, sourceType: raw.sourceType ?? raw.source_type ?? "purchase" },
      });
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
      if (result.rowCount) await addAuditEvent(client, user, "import.stockMovement", "stockMovements", id, "استيراد حركة مخزون", {
        before: null,
        after: { branchId, productId, movementType: type, quantityDelta, unitCost, referenceType: raw.referenceType ?? raw.reference_type ?? "import", referenceId: raw.referenceId ?? raw.reference_id ?? null },
      });
    }

    if (object(data.settings)) {
      const settingData = { ...DEFAULT_CLINIC_SETTINGS, ...data.settings };
      const result = await client.query(
        `INSERT INTO clinic_records(clinic_id,collection,record_id,branch_id,data)
         VALUES($1,'settings','clinic-settings',NULL,$2::jsonb) ON CONFLICT(clinic_id,collection,record_id) DO NOTHING RETURNING record_id`,
        [user.clinicId, JSON.stringify(settingData)],
      );
      imported.settings = result.rowCount;
      if (result.rowCount) await addAuditEvent(client, user, "import.settings", "settings", "clinic-settings", "استيراد إعدادات العيادة", auditSnapshot(null, settingData));
    }

    const invoiceImport = { ...invoiceValidation, imported: imported.invoices, paymentRowsInserted: invoicePaymentRows };
    await addAuditEvent(client, user, "clinic.import", "clinic_records", null, "استيراد سجلات صالحة دون استبدال الموجود؛ فواتير legacy بلا خصم مخزون", { imported, invoiceImport, sourceStats, skippedUsers: Array.isArray(data.users) ? data.users.length : 0, skippedTransfers: Array.isArray(data.transfers) ? data.transfers.length : 0 });
    return { imported, invoiceImport, skippedUsers: Array.isArray(data.users) ? data.users.length : 0, skippedTransfers: Array.isArray(data.transfers) ? data.transfers.length : 0, replaced: 0 };
  });
}
