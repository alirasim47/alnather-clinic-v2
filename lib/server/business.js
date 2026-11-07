import "server-only";
import { randomUUID } from "node:crypto";
import { withTransaction } from "./db";
import { authorize } from "./access";
import { addAuditEvent, getRecordForBusiness, putRecordForBusiness } from "./collections";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const money = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) throw fail("قيمة مالية غير صالحة.", 400);
  return roundMoney(number);
};
const quantity = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 100_000) throw fail("الكمية يجب أن تكون أكبر من صفر.", 400);
  const rounded = Math.round(number * 100) / 100;
  if (rounded <= 0) throw fail("الكمية أقل من أصغر وحدة مسموحة (0.01).", 400);
  return rounded;
};
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

function requirePermission(user, permission) {
  const response = authorize(user, permission);
  if (response) throw fail(response.status === 401 ? "يلزم تسجيل الدخول." : "لا تملك صلاحية تنفيذ هذا الإجراء.", response.status);
}

async function insertInvoicePayment(client, user, branchId, invoiceId, payment) {
  await client.query(
    `INSERT INTO invoice_payments(id,clinic_id,branch_id,invoice_id,amount,method,reference,notes,paid_at,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [payment.id || randomUUID(), user.clinicId, branchId, invoiceId, payment.amount, payment.method,
      text(payment.reference, 100) || null, text(payment.notes, 300) || null, payment.paidAt || new Date().toISOString(), user.id],
  );
}

async function ensureBranch(client, user, requestedId) {
  let branchId = requestedId || user.branchId || null;
  if (user.role !== "admin") {
    if (!user.branchId) throw fail("يجب ربط حساب الموظف بفرع قبل تنفيذ هذه العملية.", 403);
    if (requestedId && String(requestedId) !== String(user.branchId)) throw fail("لا تملك صلاحية هذا الفرع.", 403);
    branchId = user.branchId;
  }
  if (!branchId && user.role === "admin") {
    const main = await client.query("SELECT id FROM branches WHERE clinic_id=$1 AND active=TRUE ORDER BY (code='MAIN') DESC,created_at ASC LIMIT 1", [user.clinicId]);
    branchId = main.rows[0]?.id || null;
  }
  if (!branchId) throw fail("أنشئ فرعًا فعالًا قبل تنفيذ العملية.", 400);
  const result = await client.query("SELECT id,code,name FROM branches WHERE id=$1 AND clinic_id=$2 AND active=TRUE", [branchId, user.clinicId]);
  if (!result.rowCount) throw fail("الفرع غير موجود أو موقوف.", 400);
  return result.rows[0];
}

async function ensureDestinationBranch(client, user, requestedId) {
  if (!requestedId) throw fail("حدد الفرع المستلم.", 400);
  const result = await client.query("SELECT id,code,name FROM branches WHERE id=$1 AND clinic_id=$2 AND active=TRUE", [String(requestedId), user.clinicId]);
  if (!result.rowCount) throw fail("الفرع المستلم غير موجود أو موقوف.", 400);
  return result.rows[0];
}

async function findProduct(client, user, productId) {
  const result = await client.query(
    "SELECT data FROM clinic_records WHERE clinic_id=$1 AND collection='products' AND record_id=$2 AND deleted_at IS NULL FOR UPDATE",
    [user.clinicId, String(productId)],
  );
  if (!result.rowCount) throw fail("أحد المنتجات لم يعد موجودًا.", 404);
  const product = result.rows[0].data;
  if (product.active === false) throw fail(`المنتج «${product.name || ""}» موقوف.`, 409);
  return { ...product, id: String(productId) };
}

async function allocateProductBatches(client, user, branchId, productId, requestedQty, invoiceId) {
  const batches = await client.query(
    `SELECT id,remaining_qty,reserved_qty,unit_cost FROM inventory_batches
      WHERE clinic_id=$1 AND branch_id=$2 AND product_id=$3 AND remaining_qty-reserved_qty > 0
      ORDER BY received_at ASC,id ASC FOR UPDATE`,
    [user.clinicId, branchId, String(productId)],
  );
  let remaining = requestedQty;
  let totalCost = 0;
  const allocations = [];
  for (const batch of batches.rows) {
    if (remaining <= 0) break;
    const available = Number(batch.remaining_qty) - Number(batch.reserved_qty);
    const used = Math.min(remaining, available);
    if (used <= 0) continue;
    await client.query(
      "UPDATE inventory_batches SET remaining_qty=remaining_qty-$3 WHERE id=$1 AND clinic_id=$2 AND remaining_qty-reserved_qty >= $3",
      [batch.id, user.clinicId, used],
    );
    const cost = Number(batch.unit_cost);
    totalCost += used * cost;
    remaining -= used;
    allocations.push({ batchId: batch.id, qty: used, unitCost: cost });
    await client.query(
      `INSERT INTO stock_movements(id,clinic_id,branch_id,product_id,batch_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,actor_id)
       VALUES($1,$2,$3,$4,$5,'sale',$6,$7,'invoice',$8,$9)`,
      [randomUUID(), user.clinicId, branchId, String(productId), batch.id, -used, cost, invoiceId, user.id],
    );
  }
  if (remaining > 0) throw fail(`المخزون المتاح غير كافٍ. المتبقي المطلوب: ${remaining}.`, 409);
  return { allocations, cost: roundMoney(totalCost), unitCost: roundMoney(totalCost / requestedQty) };
}

async function processLensInventorySale(client, user, branchId, lensId, qty, invoiceId) {
  const result = await client.query(
    `SELECT branch_id,data FROM clinic_records
      WHERE clinic_id=$1 AND collection='lensInventory' AND record_id=$2 AND deleted_at IS NULL FOR UPDATE`,
    [user.clinicId, String(lensId)],
  );
  if (!result.rowCount) throw fail("قياس العدسة المحدد غير موجود.", 404);
  const row = result.rows[0];
  if (!row.branch_id || String(row.branch_id) !== String(branchId)) throw fail("قياس العدسة غير مسند إلى هذا الفرع.", 409);
  const data = row.data;
  if (data.active === false) throw fail("قياس العدسة موقوف.", 409);
  const available = Number(data.quantity ?? data.qty ?? 0);
  if (!Number.isFinite(available) || available < qty) throw fail(`رصيد قياس العدسة غير كافٍ. المتوفر ${Math.max(0, available)}.`, 409);
  const next = { ...data, quantity: roundMoney(available - qty), qty: roundMoney(available - qty), updatedAt: new Date().toISOString() };
  await client.query(
    "UPDATE clinic_records SET data=$4::jsonb,updated_at=now() WHERE clinic_id=$1 AND collection='lensInventory' AND record_id=$2 AND branch_id IS NOT DISTINCT FROM $3",
    [user.clinicId, String(lensId), row.branch_id, JSON.stringify(next)],
  );
  const unitCost = money(data.unitCost ?? data.buy ?? 0);
  const price = money(data.sell ?? data.price ?? 0);
  await client.query(
    `INSERT INTO stock_movements(id,clinic_id,branch_id,product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,actor_id,notes)
     VALUES($1,$2,$3,$4,'sale',$5,$6,'invoice',$7,$8,'مخزون عدسات بالقياس')`,
    [randomUUID(), user.clinicId, branchId, String(lensId), -qty, unitCost, invoiceId, user.id],
  );
  const typeLabels = { spherical: "كروية", toric: "استجماتزم", multifocal: "متعددة البؤر", contact: "لاصقة", other: "أخرى" };
  const details = Object.fromEntries(Object.entries({
    sku: data.sku, type: data.type, side: data.side, sph: data.sph, cyl: data.cyl, axis: data.axis,
    add: data.add, material: data.material, coating: data.coating, diameter: data.diameter,
    refractiveIndex: data.refractiveIndex,
  }).filter(([, value]) => value !== null && value !== undefined && value !== ""));
  const powers = [
    data.sph != null && `SPH ${data.sph}`,
    data.cyl != null && `CYL ${data.cyl}`,
    data.axis != null && `AXIS ${data.axis}`,
    data.add != null && `ADD ${data.add}`,
  ].filter(Boolean).join(" / ");
  const descriptors = [data.sku, typeLabels[data.type] || data.type, data.side === "right" ? "يمين" : data.side === "left" ? "يسار" : null, powers, data.material, data.coating].filter(Boolean);
  const baseName = data.name || data.brand || "عدسة";
  const suffix = descriptors.filter((part) => !String(baseName).includes(String(part))).join(" · ");
  const name = text(`${baseName}${suffix ? ` · ${suffix}` : ""}`, 200);
  return { name, price, unitCost, allocations: [], sourceCollection: "lensInventory", lensInventoryId: String(lensId), lensDetails: details };
}

function validDate(value) {
  const date = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw fail("تاريخ الفاتورة غير صالح.", 400);
  return date;
}

async function invoiceNumber(client, clinicId, branch, date) {
  const year = Number(date.slice(0, 4));
  const result = await client.query(
    `INSERT INTO invoice_counters(clinic_id,branch_id,year,current_value)
     VALUES($1,$2,$3,1)
     ON CONFLICT(clinic_id,branch_id,year)
     DO UPDATE SET current_value=invoice_counters.current_value+1
     RETURNING current_value`,
    [clinicId, branch.id, year],
  );
  const code = String(branch.code || "MAIN").replace(/[^A-Z0-9]/gi, "").slice(0, 8).toUpperCase() || "MAIN";
  return `INV-${code}-${year}-${String(result.rows[0].current_value).padStart(5, "0")}`;
}

export async function createSale(user, input) {
  requirePermission(user, "invoices.create");
  if (!input || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) throw fail("أضف صنفًا واحدًا على الأقل إلى الفاتورة.", 400);

  return withTransaction(async (client) => {
    const branch = await ensureBranch(client, user, input.branchId);
    const invoiceId = randomUUID();
    const date = validDate(input.date || new Date().toISOString().slice(0, 10));
    const patientId = input.patientId ? String(input.patientId) : null;
    if (patientId) {
      const patient = await getRecordForBusiness(client, user, "patients", patientId, true);
      if (!patient) throw fail("المريض المحدد غير موجود في هذه العيادة.", 404);
    }

    const lines = [];
    for (const raw of input.items) {
      const qty = quantity(raw?.qty);
      const sourceCollection = raw?.sourceCollection === "lensInventory" ? "lensInventory" : "products";
      if (sourceCollection === "lensInventory") {
        requirePermission(user, "lensInventory.view");
        const lensId = raw.lensInventoryId || raw.productId;
        const lens = await processLensInventorySale(client, user, branch.id, lensId, qty, invoiceId);
        lines.push({ id: randomUUID(), productId: String(lensId), sourceCollection, lensInventoryId: String(lensId),
          name: lens.name, price: lens.price, qty, unitCost: lens.unitCost, batchAllocations: lens.allocations, stockManaged: true,
          lensDetails: lens.lensDetails });
        continue;
      }

      const product = await findProduct(client, user, raw?.productId);
      const price = money(product.sell ?? product.price ?? 0);
      const tracked = product.cat !== "services" && product.type !== "service" && product.trackStock !== false;
      const allocation = tracked
        ? await allocateProductBatches(client, user, branch.id, product.id, qty, invoiceId)
        : { allocations: [], cost: 0, unitCost: 0 };
      lines.push({ id: randomUUID(), productId: product.id, sourceCollection: "products", name: text(product.name, 140),
        price, qty, unitCost: allocation.unitCost, costTotal: allocation.cost, batchAllocations: allocation.allocations, stockManaged: tracked });
    }

    const subtotal = roundMoney(lines.reduce((sum, item) => sum + item.price * item.qty, 0));
    const discount = money(input.discount || 0);
    if (discount > subtotal) throw fail("الخصم لا يمكن أن يتجاوز إجمالي الأصناف.", 400);
    const total = roundMoney(subtotal - discount);
    const paid = money(input.paid || 0);
    if (paid > total) throw fail("المبلغ المدفوع أكبر من إجمالي الفاتورة.", 400);
    const method = ["cash", "card", "installments", "transfer"].includes(input.method) ? input.method : "cash";
    const cogs = roundMoney(lines.reduce((sum, item) => sum + Number(item.costTotal || (Number(item.unitCost || 0) * item.qty)), 0));
    let remainingDiscount = discount;
    for (let index = 0; index < lines.length; index += 1) {
      const item = lines[index];
      const share = index === lines.length - 1
        ? remainingDiscount
        : (subtotal > 0 ? roundMoney(discount * (item.price * item.qty / subtotal)) : 0);
      remainingDiscount = roundMoney(Math.max(0, remainingDiscount - share));
      item.discountShare = share;
      item.netAmount = roundMoney(item.price * item.qty - share);
      item.unitNetPrice = item.qty > 0 ? roundMoney(item.netAmount / item.qty) : item.price;
    }

    const status = paid >= total ? "paid" : paid > 0 ? "partial" : "unpaid";
    const no = await invoiceNumber(client, user.clinicId, branch, date);
    const invoice = {
      id: invoiceId, no, date, branchId: branch.id, branchName: branch.name,
      patientId, total, subtotal, discount, paid, method, status, payment_status: status,
      items: lines, cogs, returnedTotal: 0, returnedCost: 0, returnedQuantities: {}, returnedAllocations: {},
      legacyImported: false, createdAt: new Date().toISOString(), createdBy: user.id,
      paymentHistory: paid > 0 ? [{ id: randomUUID(), amount: paid, method, paidAt: new Date().toISOString(), createdBy: user.id }] : [],
    };
    await putRecordForBusiness(client, user, "invoices", invoice, branch.id);
    if (paid > 0) await insertInvoicePayment(client, user, branch.id, invoice.id, invoice.paymentHistory[0]);
    await addAuditEvent(client, user, "sales.create", "invoices", invoice.id, "إنشاء فاتورة بيع", {
      before: null,
      after: { no, date, branchId: branch.id, patientId, subtotal, discount, total, paid, status, itemCount: lines.length },
    });
    return invoice;
  });
}

export async function recordInvoicePayment(user, input) {
  requirePermission(user, "invoices.update");
  const invoiceId = text(input?.invoiceId, 180);
  const amount = money(input?.amount);
  if (!invoiceId || amount <= 0) throw fail("اختر فاتورة وأدخل دفعة أكبر من صفر.", 400);
  const method = ["cash", "card", "transfer", "installments"].includes(input?.method) ? input.method : "cash";

  return withTransaction(async (client) => {
    const invoice = await getRecordForBusiness(client, user, "invoices", invoiceId, true);
    if (!invoice) throw fail("الفاتورة غير موجودة في هذه العيادة.", 404);
    if (invoice.status === "void") throw fail("لا يمكن التحصيل على فاتورة ملغاة.", 409);
    const branch = await ensureBranch(client, user, invoice.branchId);
    const paidBefore = money(invoice.paid || 0);
    const total = money(invoice.total || 0);
    const returned = money(invoice.returnedTotal || 0);
    const statusBefore = invoice.status || (paidBefore >= Math.max(0, total - returned) ? "paid" : paidBefore > 0 ? "partial" : "unpaid");
    const balance = roundMoney(Math.max(0, total - paidBefore - returned));
    if (amount > balance) throw fail(`قيمة الدفعة تتجاوز الرصيد المستحق ${balance}.`, 409);

    const payment = { id: randomUUID(), amount, method, reference: text(input.reference, 100), notes: text(input.notes, 300), paidAt: new Date().toISOString(), createdBy: user.id };
    await insertInvoicePayment(client, user, branch.id, invoice.id, payment);
    invoice.paid = roundMoney(paidBefore + amount);
    invoice.status = invoice.paid >= Math.max(0, total - returned) ? "paid" : invoice.paid > 0 ? "partial" : "unpaid";
    invoice.payment_status = invoice.status;
    invoice.paymentHistory = [...(Array.isArray(invoice.paymentHistory) ? invoice.paymentHistory : []), payment];
    await putRecordForBusiness(client, user, "invoices", invoice, branch.id);
    await addAuditEvent(client, user, "invoices.payment", "invoices", invoice.id, "تسجيل دفعة لاحقة على فاتورة", {
      before: { paid: paidBefore, status: statusBefore },
      after: { paid: invoice.paid, status: invoice.status },
      payment: { amount, method, reference: payment.reference || null },
      balance: roundMoney(Math.max(0, total - returned - invoice.paid)),
    });
    return { invoice, payment };
  });
}

async function returnLensQuantity(client, user, branchId, item, qty, returnId) {
  const lensId = String(item.lensInventoryId || item.productId);
  const result = await client.query(
    `SELECT branch_id,data FROM clinic_records
      WHERE clinic_id=$1 AND collection='lensInventory' AND record_id=$2 AND deleted_at IS NULL FOR UPDATE`,
    [user.clinicId, lensId],
  );
  if (!result.rowCount) throw fail("لا يمكن إعادة قياس العدسة لأن سجل المخزون لم يعد موجودًا.", 409);
  const row = result.rows[0];
  if (row.branch_id && String(row.branch_id) !== String(branchId)) throw fail("قياس العدسة مرتبط بفرع مختلف.", 409);
  const data = row.data;
  const nextQty = roundMoney(Number(data.quantity ?? data.qty ?? 0) + qty);
  const next = { ...data, quantity: nextQty, qty: nextQty, updatedAt: new Date().toISOString() };
  await client.query("UPDATE clinic_records SET data=$3::jsonb,updated_at=now() WHERE clinic_id=$1 AND collection='lensInventory' AND record_id=$2", [user.clinicId, lensId, JSON.stringify(next)]);
  await client.query(
    `INSERT INTO stock_movements(id,clinic_id,branch_id,product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,actor_id,notes)
     VALUES($1,$2,$3,$4,'return',$5,$6,'return',$7,$8,'إرجاع عدسة بالقياس')`,
    [randomUUID(), user.clinicId, branchId, lensId, qty, Number(item.unitCost || 0), returnId, user.id],
  );
}

export async function createReturn(user, input) {
  requirePermission(user, "returns.create");
  if (!input?.invoiceId || !Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw fail("اختر الفاتورة والأصناف المطلوب إرجاعها.", 400);

  return withTransaction(async (client) => {
    const invoice = await getRecordForBusiness(client, user, "invoices", input.invoiceId, true);
    if (!invoice) throw fail("الفاتورة غير موجودة في هذه العيادة.", 404);
    if (invoice.legacyImported) throw fail("هذه فاتورة مرحّلة من النسخة القديمة ولا تحتوي دفعات تكلفة موثقة؛ لا يمكن تعديل مخزونها تلقائيًا.", 409);
    const branch = await ensureBranch(client, user, invoice.branchId);
    const refundMethod = ["credit", "cash", "card"].includes(input.refundMethod) ? input.refundMethod : "credit";
    const returnId = randomUUID();
    const returnedQuantities = { ...(invoice.returnedQuantities || {}) };
    const returnedAllocations = { ...(invoice.returnedAllocations || {}) };
    const items = [];
    let amount = 0;
    let costAmount = 0;

    for (const raw of input.items) {
      const item = (invoice.items || []).find((entry) => String(entry.id) === String(raw.invoiceItemId));
      if (!item) throw fail("أحد أصناف الإرجاع غير موجود على الفاتورة.", 404);
      const qty = quantity(raw.qty);
      const already = Number(returnedQuantities[item.id] || 0);
      const remainingSold = Number(item.qty || 0) - already;
      if (qty > remainingSold) throw fail(`الكمية المطلوب إرجاعها تتجاوز المتبقي للصنف «${item.name}».`, 409);

      if (item.stockManaged && item.sourceCollection === "lensInventory") {
        await returnLensQuantity(client, user, branch.id, item, qty, returnId);
      } else if (item.stockManaged) {
        let remaining = qty;
        const previously = { ...(returnedAllocations[item.id] || {}) };
        for (const allocation of item.batchAllocations || []) {
          if (remaining <= 0) break;
          const canReturn = Number(allocation.qty) - Number(previously[allocation.batchId] || 0);
          const restore = Math.min(remaining, canReturn);
          if (restore <= 0) continue;
          const batchResult = await client.query(
            "UPDATE inventory_batches SET remaining_qty=remaining_qty+$4 WHERE id=$1 AND clinic_id=$2 AND branch_id=$3 AND remaining_qty+$4 <= received_qty RETURNING id",
            [allocation.batchId, user.clinicId, branch.id, restore],
          );
          if (!batchResult.rowCount) throw fail("تعذر استعادة رصيد دفعة المخزون؛ راجع سجل الحركات.", 409);
          previously[allocation.batchId] = Number(previously[allocation.batchId] || 0) + restore;
          remaining -= restore;
          await client.query(
            `INSERT INTO stock_movements(id,clinic_id,branch_id,product_id,batch_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,actor_id)
             VALUES($1,$2,$3,$4,$5,'return',$6,$7,'return',$8,$9)`,
            [randomUUID(), user.clinicId, branch.id, String(item.productId), allocation.batchId, restore, Number(allocation.unitCost || 0), returnId, user.id],
          );
        }
        if (remaining > 0.0001) throw fail("تعذر مطابقة كمية الإرجاع مع دفعات البيع الأصلية.", 409);
        returnedAllocations[item.id] = previously;
      }

      returnedQuantities[item.id] = already + qty;
      const unitNet = Number(item.unitNetPrice ?? item.price ?? 0);
      const lineAmount = roundMoney(unitNet * qty);
      const lineCost = roundMoney(Number(item.unitCost || 0) * qty);
      amount = roundMoney(amount + lineAmount);
      costAmount = roundMoney(costAmount + lineCost);
      items.push({ invoiceItemId: item.id, productId: item.productId, name: item.name, qty, unitNetPrice: unitNet, unitCost: Number(item.unitCost || 0), amount: lineAmount, costAmount: lineCost });
    }

    const invoiceBefore = {
      returnedTotal: Number(invoice.returnedTotal || 0),
      returnedCost: Number(invoice.returnedCost || 0),
      returnedQuantities: invoice.returnedQuantities || {},
    };
    const record = {
      id: returnId, no: `RET-${returnId.slice(0, 8).toUpperCase()}`, invoiceId: invoice.id, invoiceNo: invoice.no,
      date: validDate(input.date || new Date().toISOString().slice(0, 10)), branchId: branch.id, branchName: branch.name,
      items, amount, costAmount, reason: text(input.reason, 500), refundMethod,
      status: "posted", createdAt: new Date().toISOString(), createdBy: user.id,
    };
    invoice.returnedTotal = roundMoney(Number(invoice.returnedTotal || 0) + amount);
    invoice.returnedCost = roundMoney(Number(invoice.returnedCost || 0) + costAmount);
    invoice.returnedQuantities = returnedQuantities;
    invoice.returnedAllocations = returnedAllocations;
    await putRecordForBusiness(client, user, "invoices", invoice, branch.id);
    await putRecordForBusiness(client, user, "returns", record, branch.id);
    await addAuditEvent(client, user, "returns.create", "returns", returnId, "تسجيل عائد مرتبط بفاتورة", {
      before: null,
      after: { invoiceId: invoice.id, invoiceNo: invoice.no, amount, costAmount, refundMethod, itemCount: items.length, status: record.status },
      invoiceBefore,
      invoiceAfter: { returnedTotal: invoice.returnedTotal, returnedCost: invoice.returnedCost, returnedQuantities: invoice.returnedQuantities },
    });
    return record;
  });
}

export async function createStockBatch(user, input) {
  requirePermission(user, "products.update");
  const qty = quantity(input?.quantity ?? input?.qty);
  const unitCost = money(input?.unitCost ?? input?.buy ?? 0);
  return withTransaction(async (client) => {
    const branch = await ensureBranch(client, user, input.branchId);
    const product = await findProduct(client, user, input.productId);
    if (product.cat === "services" || product.type === "service" || product.trackStock === false) throw fail("لا يمكن إضافة رصيد مخزون إلى خدمة غير مخزنية.", 400);
    const batchId = randomUUID();
    await client.query(
      `INSERT INTO inventory_batches(id,clinic_id,branch_id,product_id,received_qty,remaining_qty,unit_cost,received_at,source_type,source_id,created_by)
       VALUES($1,$2,$3,$4,$5,$5,$6,COALESCE($7::timestamptz,now()),'purchase',$8,$9)`,
      [batchId, user.clinicId, branch.id, product.id, qty, unitCost, input.receivedAt || null, text(input.reference || "", 80) || null, user.id],
    );
    await client.query(
      `INSERT INTO stock_movements(id,clinic_id,branch_id,product_id,batch_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,notes,actor_id)
       VALUES($1,$2,$3,$4,$5,'purchase',$6,$7,'purchase',$8,$9,$10)`,
      [randomUUID(), user.clinicId, branch.id, product.id, batchId, qty, unitCost, text(input.reference || batchId, 100), text(input.notes, 300), user.id],
    );
    const batch = { id: batchId, branchId: branch.id, branchName: branch.name, productId: product.id, productName: product.name, receivedQty: qty, remainingQty: qty, reservedQty: 0, unitCost, receivedAt: input.receivedAt || new Date().toISOString(), sourceType: "purchase" };
    await addAuditEvent(client, user, "stock.purchase", "stockBatches", batchId, "إضافة دفعة مخزون", {
      before: null, after: { productId: product.id, quantity: qty, unitCost, branchId: branch.id, remainingQty: qty },
    });
    return batch;
  });
}

async function reserveForTransfer(client, user, branchId, productId, qty) {
  const batches = await client.query(
    `SELECT id,remaining_qty,reserved_qty,unit_cost FROM inventory_batches
      WHERE clinic_id=$1 AND branch_id=$2 AND product_id=$3 AND remaining_qty-reserved_qty > 0
      ORDER BY received_at ASC,id ASC FOR UPDATE`,
    [user.clinicId, branchId, String(productId)],
  );
  let remaining = qty;
  const allocations = [];
  for (const batch of batches.rows) {
    if (remaining <= 0) break;
    const available = Number(batch.remaining_qty) - Number(batch.reserved_qty);
    const reserve = Math.min(remaining, available);
    if (reserve <= 0) continue;
    await client.query("UPDATE inventory_batches SET reserved_qty=reserved_qty+$3 WHERE id=$1 AND clinic_id=$2 AND remaining_qty-reserved_qty >= $3", [batch.id, user.clinicId, reserve]);
    allocations.push({ batchId: batch.id, qty: reserve, unitCost: Number(batch.unit_cost) });
    remaining -= reserve;
  }
  if (remaining > 0) throw fail(`الكمية المتاحة للنقل غير كافية للصنف ${productId}.`, 409);
  return allocations;
}

export async function createBranchTransfer(user, input) {
  requirePermission(user, "transfers.create");
  if (!Array.isArray(input?.items) || !input.items.length || input.items.length > 100) throw fail("أضف منتجًا واحدًا على الأقل للنقل.", 400);
  return withTransaction(async (client) => {
    const from = await ensureBranch(client, user, input.fromBranchId);
    const to = await ensureDestinationBranch(client, user, input.toBranchId);
    if (from.id === to.id) throw fail("اختر فرعين مختلفين.", 400);
    const transferId = randomUUID();
    const transferItems = [];
    for (const raw of input.items) {
      const qty = quantity(raw.qty);
      const product = await findProduct(client, user, raw.productId);
      const allocations = await reserveForTransfer(client, user, from.id, product.id, qty);
      transferItems.push({ productId: product.id, name: text(product.name, 140), qty, allocations });
    }
    const result = await client.query(
      `INSERT INTO branch_transfers(id,clinic_id,from_branch_id,to_branch_id,status,items,notes,created_by)
       VALUES($1,$2,$3,$4,'pending',$5::jsonb,$6,$7) RETURNING created_at`,
      [transferId, user.clinicId, from.id, to.id, JSON.stringify(transferItems), text(input.notes, 500), user.id],
    );
    await addAuditEvent(client, user, "transfers.create", "transfers", transferId, "إنشاء طلب نقل مخزون", {
      before: null, after: { fromBranchId: from.id, toBranchId: to.id, status: "pending", items: transferItems },
    });
    return { id: transferId, fromBranchId: from.id, fromBranchName: from.name, toBranchId: to.id, toBranchName: to.name, status: "pending", items: transferItems, notes: text(input.notes, 500), createdAt: result.rows[0].created_at };
  });
}

export async function resolveBranchTransfer(user, id, action) {
  const permission = action === "cancel" ? "transfers.delete" : "transfers.update";
  requirePermission(user, permission);
  if (!["accept", "reject", "cancel"].includes(action)) throw fail("إجراء النقل غير صالح.", 400);
  return withTransaction(async (client) => {
    const result = await client.query("SELECT * FROM branch_transfers WHERE id=$1 AND clinic_id=$2 FOR UPDATE", [String(id), user.clinicId]);
    if (!result.rowCount) throw fail("طلب النقل غير موجود.", 404);
    const transfer = result.rows[0];
    if (transfer.status !== "pending") throw fail("تم حسم طلب النقل مسبقًا.", 409);
    if (user.role !== "admin") {
      const expectedBranch = action === "cancel" ? transfer.from_branch_id : transfer.to_branch_id;
      if (!user.branchId || String(user.branchId) !== String(expectedBranch)) throw fail("الإجراء متاح فقط للفرع المعني بطلب النقل.", 403);
    }

    for (const item of transfer.items || []) {
      for (const allocation of item.allocations || []) {
        if (action === "accept") {
          const updated = await client.query(
            "UPDATE inventory_batches SET remaining_qty=remaining_qty-$4,reserved_qty=reserved_qty-$4 WHERE id=$1 AND clinic_id=$2 AND branch_id=$3 AND reserved_qty >= $4 AND remaining_qty >= $4 RETURNING id",
            [allocation.batchId, user.clinicId, transfer.from_branch_id, Number(allocation.qty)],
          );
          if (!updated.rowCount) throw fail("تغير رصيد الدفعة قبل تأكيد النقل؛ لم تُحفظ العملية.", 409);
          const newBatchId = randomUUID();
          await client.query(
            `INSERT INTO inventory_batches(id,clinic_id,branch_id,product_id,received_qty,remaining_qty,reserved_qty,unit_cost,source_type,source_id,created_by)
             VALUES($1,$2,$3,$4,$5,$5,0,$6,'transfer',$7,$8)`,
            [newBatchId, user.clinicId, transfer.to_branch_id, String(item.productId), Number(allocation.qty), Number(allocation.unitCost), String(id), user.id],
          );
          await client.query(
            `INSERT INTO stock_movements(id,clinic_id,branch_id,product_id,batch_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,actor_id)
             VALUES($1,$2,$3,$4,$5,'transfer_out',$6,$7,'transfer',$8,$9),
                   ($10,$2,$11,$4,$12,'transfer_in',$13,$7,'transfer',$8,$9)`,
            [randomUUID(), user.clinicId, transfer.from_branch_id, String(item.productId), allocation.batchId, -Number(allocation.qty), Number(allocation.unitCost), String(id), user.id, randomUUID(), transfer.to_branch_id, newBatchId, Number(allocation.qty)],
          );
        } else {
          const released = await client.query(
            "UPDATE inventory_batches SET reserved_qty=reserved_qty-$4 WHERE id=$1 AND clinic_id=$2 AND branch_id=$3 AND reserved_qty >= $4 RETURNING id",
            [allocation.batchId, user.clinicId, transfer.from_branch_id, Number(allocation.qty)],
          );
          if (!released.rowCount) throw fail("تعذر تحرير الكمية المحجوزة لهذا الطلب.", 409);
        }
      }
    }

    const status = action === "accept" ? "accepted" : action === "reject" ? "rejected" : "cancelled";
    await client.query("UPDATE branch_transfers SET status=$3,resolved_by=$4,resolved_at=now() WHERE id=$1 AND clinic_id=$2", [String(id), user.clinicId, status, user.id]);
    await addAuditEvent(client, user, `transfers.${action}`, "transfers", id, `حسم طلب نقل: ${status}`, {
      before: { status: transfer.status }, after: { status }, fromBranchId: transfer.from_branch_id, toBranchId: transfer.to_branch_id,
    });
    return { id: String(id), status };
  });
}
