const MAX_AMOUNT = 1_000_000_000;
const MAX_QUANTITY = 100_000;
const PAYMENT_METHODS = new Set(["cash", "card", "transfer", "installments"]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasValue = (value) => value !== undefined && value !== null && value !== "";
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const sameMoney = (left, right) => Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
const parseAmount = (value) => {
  if (!hasValue(value) || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > MAX_AMOUNT || Math.abs(number * 100 - Math.round(number * 100)) > 0.000001) return null;
  return Math.round(number * 100) / 100;
};
const parseQuantity = (value) => {
  if (!hasValue(value) || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > MAX_QUANTITY) return null;
  return Math.abs(number * 100 - Math.round(number * 100)) <= 0.000001 ? Math.round(number * 100) / 100 : null;
};
const validDate = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === text ? text : null;
};
const validTimestamp = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(text) || Number.isNaN(Date.parse(text))) return null;
  if (!validDate(text.slice(0, 10))) return null;
  return new Date(text).toISOString();
};
const text = (value, max = 180) => typeof value === "string" || typeof value === "number"
  ? String(value).trim().slice(0, max)
  : "";
const statusFor = (paid, balance) => paid >= balance ? "paid" : paid > 0 ? "partial" : "unpaid";

export function mapLegacyBranchContext(existingBranches, sourceBranches, foreignBranchIds = new Set()) {
  const ids = new Set(existingBranches.map((row) => String(row.id)));
  const byCode = new Map(existingBranches.map((row) => [String(row.code).toUpperCase(), String(row.id)]));
  const names = new Map(existingBranches.map((row) => [String(row.id), String(row.name || "")]));
  const map = new Map(existingBranches.map((row) => [String(row.id), String(row.id)]));

  for (const raw of sourceBranches) {
    if (!isObject(raw)) continue;
    const id = String(raw.id ?? "").trim();
    const code = String(raw.code ?? "").trim().toUpperCase();
    const name = String(raw.name ?? "").trim();
    if (!id || id.length > 180 || !name || !/^[A-Z0-9_-]{2,30}$/.test(code) || map.has(id)) continue;
    const codeTarget = byCode.get(code);
    if (codeTarget) {
      map.set(id, codeTarget);
      continue;
    }
    if (foreignBranchIds.has(id)) continue;
    map.set(id, id);
    names.set(id, name.slice(0, 100));
    ids.add(id);
    byCode.set(code, id);
  }
  return { map, ids, names };
}

function invalid(errors) {
  return { valid: false, invoice: null, payments: [], errors: [...new Set(errors)].slice(0, 12) };
}

export function validateLegacyInvoice(raw) {
  const errors = [];
  const addError = (message) => { if (message && errors.length < 20) errors.push(message); };
  if (!isObject(raw)) return invalid(["سجل الفاتورة ليس كائنًا صالحًا."]);

  const id = typeof raw.id === "string" || typeof raw.id === "number" ? String(raw.id).trim() : "";
  const noValue = raw.no ?? raw.invoiceNo ?? raw.invoice_no;
  const no = typeof noValue === "string" || typeof noValue === "number" ? String(noValue).trim() : "";
  const date = validDate(raw.date);
  const branchValue = raw.branchId ?? raw.branch_id;
  const branchId = typeof branchValue === "string" || typeof branchValue === "number" ? String(branchValue).trim() : "";
  const patientValue = raw.patientId ?? raw.patient_id;
  const patientId = hasValue(patientValue) ? (typeof patientValue === "string" || typeof patientValue === "number" ? String(patientValue).trim() : "") : null;
  if (!id) addError("معرّف الفاتورة مفقود.");
  if (id.length > 180) addError("معرّف الفاتورة أطول من الحد المسموح.");
  if (no.length > 100) addError("رقم الفاتورة أطول من الحد المسموح.");
  if (branchId.length > 180) addError("معرّف فرع الفاتورة أطول من الحد المسموح.");
  if (patientId?.length > 180) addError("معرّف المريض أطول من الحد المسموح.");
  if (!no) addError("رقم الفاتورة مفقود.");
  if (!date) addError("تاريخ الفاتورة غير صالح؛ المطلوب YYYY-MM-DD.");
  if (!branchId) addError("فرع الفاتورة مفقود.");
  if (patientId === "") addError("معرّف المريض غير صالح.");

  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 100) {
    addError("يجب أن تحتوي الفاتورة من 1 إلى 100 بند صالح.");
    return invalid(errors);
  }

  const seenItemIds = new Set();
  let grossSubtotal = 0;
  let costsTotal = 0;
  let allCostsKnown = true;
  const lines = [];
  const hasDiscountShares = raw.items.map((item) => isObject(item) && Object.hasOwn(item, "discountShare"));
  if (hasDiscountShares.some(Boolean) && !hasDiscountShares.every(Boolean)) {
    addError("توزيع الخصم موجود لبعض البنود فقط؛ يجب أن يكون كاملًا أو غير موجود.");
  }

  raw.items.forEach((item, index) => {
    const lineNumber = index + 1;
    if (!isObject(item)) {
      addError(`البند ${lineNumber} ليس كائنًا صالحًا.`);
      return;
    }
    const rawItemId = item.id;
    const itemId = typeof rawItemId === "string" || typeof rawItemId === "number" ? String(rawItemId).trim() : `${id.slice(0, 160) || "legacy"}-item-${lineNumber}`;
    const productValue = item.productId ?? item.lensInventoryId;
    const productId = typeof productValue === "string" || typeof productValue === "number" ? String(productValue).trim() : "";
    const rawName = typeof item.name === "string" ? item.name.trim() : "";
    const name = rawName.slice(0, 200);
    const qty = parseQuantity(item.qty ?? item.quantity);
    const price = parseAmount(item.price ?? item.unitPrice);
    if (itemId.length > 180) addError(`البند ${lineNumber}: معرّف البند أطول من الحد المسموح.`);
    if (productId.length > 180) addError(`البند ${lineNumber}: معرّف الصنف أطول من الحد المسموح.`);
    if (rawName.length > 200) addError(`البند ${lineNumber}: اسم الصنف أطول من الحد المسموح.`);
    if (!productId) addError(`البند ${lineNumber}: معرّف الصنف مفقود.`);
    if (!name) addError(`البند ${lineNumber}: اسم الصنف مفقود.`);
    if (seenItemIds.has(itemId)) addError(`البند ${lineNumber}: معرّف البند مكرر.`);
    seenItemIds.add(itemId);
    if (qty === null) addError(`البند ${lineNumber}: الكمية غير صالحة.`);
    if (price === null || price < 0) addError(`البند ${lineNumber}: السعر غير صالح.`);

    const unitCost = hasValue(item.unitCost) ? parseAmount(item.unitCost) : null;
    const givenCostTotal = hasValue(item.costTotal) ? parseAmount(item.costTotal) : null;
    if (hasValue(item.unitCost) && (unitCost === null || unitCost < 0)) addError(`البند ${lineNumber}: تكلفة الوحدة غير صالحة.`);
    if (hasValue(item.costTotal) && (givenCostTotal === null || givenCostTotal < 0)) addError(`البند ${lineNumber}: تكلفة البند غير صالحة.`);
    if (unitCost === null && givenCostTotal === null) {
      allCostsKnown = false;
      addError(`البند ${lineNumber}: تكلفة البضاعة غير محفوظة، ولا يمكن احتساب الربحية بدقة.`);
    }
    const lineCost = givenCostTotal !== null ? givenCostTotal : unitCost !== null && qty !== null ? roundMoney(unitCost * qty) : null;
    if (lineCost !== null) costsTotal = roundMoney(costsTotal + lineCost);
    const gross = qty !== null && price !== null ? price * qty : 0;
    grossSubtotal += gross;
    lines.push({
      id: itemId,
      productId,
      name,
      price: price ?? 0,
      qty: qty ?? 0,
      unitCost: unitCost ?? (lineCost !== null && qty ? roundMoney(lineCost / qty) : 0),
      costTotal: lineCost ?? 0,
      _gross: gross,
      _providedDiscountShare: hasValue(item.discountShare) ? parseAmount(item.discountShare) : null,
      _hasDiscountShare: hasDiscountShares[index],
      _providedNetAmount: hasValue(item.netAmount) ? parseAmount(item.netAmount) : null,
      _providedUnitNetPrice: hasValue(item.unitNetPrice) ? parseAmount(item.unitNetPrice) : null,
      lensDetails: isObject(item.lensDetails) ? Object.fromEntries(["sku", "type", "side", "sph", "cyl", "axis", "add", "material", "coating", "diameter", "refractiveIndex"].filter((key) => hasValue(item.lensDetails[key])).map((key) => [key, typeof item.lensDetails[key] === "string" ? item.lensDetails[key].slice(0, 100) : item.lensDetails[key]])) : undefined,
    });
  });

  const subtotalFromItems = roundMoney(grossSubtotal);
  const subtotal = hasValue(raw.subtotal) ? parseAmount(raw.subtotal) : subtotalFromItems;
  if (subtotal === null || subtotal < 0) addError("الإجمالي الفرعي غير صالح.");
  else if (!sameMoney(subtotal, subtotalFromItems)) addError("الإجمالي الفرعي لا يطابق مجموع أسعار البنود وكمياتها.");

  const discount = hasValue(raw.discount) ? parseAmount(raw.discount) : 0;
  if (discount === null || discount < 0) addError("قيمة الخصم غير صالحة.");
  else if (subtotal !== null && discount > subtotal + 0.001) addError("الخصم يتجاوز الإجمالي الفرعي.");
  const computedTotal = subtotal !== null && discount !== null ? roundMoney(subtotal - discount) : null;
  const total = parseAmount(raw.total);
  if (total === null || total < 0) addError("الإجمالي النهائي غير صالح أو مفقود.");
  else if (computedTotal !== null && !sameMoney(total, computedTotal)) addError("الإجمالي النهائي لا يساوي الإجمالي الفرعي ناقص الخصم.");

  const paid = parseAmount(raw.paid);
  if (paid === null || paid < 0) addError("المبلغ المدفوع غير صالح أو مفقود.");
  else if (total !== null && paid > total + 0.001) addError("المبلغ المدفوع يتجاوز إجمالي الفاتورة.");

  const returnedTotal = hasValue(raw.returnedTotal) ? parseAmount(raw.returnedTotal) : 0;
  if (returnedTotal === null || returnedTotal < 0) addError("إجمالي العوائد غير صالح.");
  else if (total !== null && returnedTotal > total + 0.001) addError("إجمالي العوائد يتجاوز قيمة الفاتورة.");
  const suppliedReturnedCost = hasValue(raw.returnedCost) ? parseAmount(raw.returnedCost) : null;
  if (hasValue(raw.returnedCost) && (suppliedReturnedCost === null || suppliedReturnedCost < 0)) addError("تكلفة العوائد غير صالحة.");

  let normalizedItems = [];
  if (discount !== null && subtotal !== null && total !== null) {
    const providedShares = lines.length > 0 && lines.every((line) => line._hasDiscountShare);
    let remainingDiscount = discount;
    const sumShares = roundMoney(lines.reduce((sum, line, index) => {
      let share;
      if (providedShares) {
        share = line._providedDiscountShare;
        if (share === null || share < 0) addError(`البند ${index + 1}: حصة الخصم غير صالحة.`);
      } else {
        share = index === lines.length - 1 ? remainingDiscount : (subtotal > 0 ? roundMoney(discount * (line._gross / subtotal)) : 0);
      }
      if (share !== null && share >= 0) {
        if (share - line._gross > 0.001) addError(`البند ${index + 1}: حصة الخصم تتجاوز إجمالي البند.`);
        remainingDiscount = roundMoney(Math.max(0, remainingDiscount - share));
      }
      line.discountShare = share ?? 0;
      line.netAmount = roundMoney(line.price * line.qty - line.discountShare);
      line.unitNetPrice = line.qty > 0 ? roundMoney(line.netAmount / line.qty) : line.price;
      if (line.netAmount < 0) addError(`البند ${index + 1}: صافي البند لا يمكن أن يكون سالبًا.`);
      if (line._providedNetAmount !== null && !sameMoney(line._providedNetAmount, line.netAmount)) addError(`البند ${index + 1}: صافي البند لا يطابق السعر والخصم.`);
      if (line._providedUnitNetPrice !== null && !sameMoney(line._providedUnitNetPrice, line.unitNetPrice)) addError(`البند ${index + 1}: سعر الوحدة الصافي غير متسق.`);
      return sum + line.discountShare;
    }, 0));
    if (providedShares && !sameMoney(sumShares, discount)) addError("مجموع حصص خصم البنود لا يساوي خصم الفاتورة.");
    normalizedItems = lines.map(({ _gross, _providedDiscountShare, _hasDiscountShare, _providedNetAmount, _providedUnitNetPrice, ...line }) => ({
      ...line,
      sourceCollection: "legacy",
      stockManaged: false,
    }));
  }

  const cogs = hasValue(raw.cogs) ? parseAmount(raw.cogs) : allCostsKnown ? costsTotal : null;
  if (cogs === null || cogs < 0) addError("تكلفة البضاعة المباعة غير محفوظة ولا يمكن ترحيل ربحية الفاتورة بدقة.");
  else if (allCostsKnown && !sameMoney(cogs, costsTotal)) addError("تكلفة الفاتورة لا تطابق مجموع تكاليف بنودها.");

  let returnedQuantities = {};
  let calculatedReturnedCost = 0;
  const sourceReturnedQuantities = raw.returnedQuantities;
  if (hasValue(sourceReturnedQuantities) && !isObject(sourceReturnedQuantities)) addError("تفاصيل كميات العوائد ليست كائنًا صالحًا.");
  if (isObject(sourceReturnedQuantities)) {
    const itemById = new Map(normalizedItems.map((item) => [item.id, item]));
    let calculatedReturns = 0;
    for (const [itemId, rawQty] of Object.entries(sourceReturnedQuantities)) {
      const item = itemById.get(String(itemId));
      const qty = parseQuantity(rawQty);
      if (!item || qty === null || qty > item.qty) {
        addError("تفاصيل كمية عائد لا تطابق بندًا صالحًا في الفاتورة.");
        continue;
      }
      returnedQuantities[itemId] = qty;
      calculatedReturns = roundMoney(calculatedReturns + roundMoney(item.unitNetPrice * qty));
      calculatedReturnedCost = roundMoney(calculatedReturnedCost + roundMoney(item.unitCost * qty));
    }
    if (returnedTotal !== null && !sameMoney(calculatedReturns, returnedTotal)) addError("إجمالي العوائد لا يطابق كميات البنود المرتجعة.");
    if (suppliedReturnedCost !== null && !sameMoney(suppliedReturnedCost, calculatedReturnedCost)) addError("تكلفة العوائد لا تطابق كميات البنود المرتجعة.");
  } else if (returnedTotal > 0) {
    addError("يوجد إجمالي عوائد دون تفاصيل الكميات المرتجعة.");
  } else if (suppliedReturnedCost !== null && suppliedReturnedCost > 0) {
    addError("تكلفة عوائد موجبة دون تفاصيل كميات مرتجعة.");
  }

  const methods = Object.hasOwn(raw, "paymentHistory") ? raw.paymentHistory : undefined;
  const rawMethod = hasValue(raw.method) ? text(raw.method, 40) : "";
  if (rawMethod && !PAYMENT_METHODS.has(rawMethod)) addError("طريقة دفع الفاتورة غير مدعومة.");
  const payments = [];
  if (methods === undefined || methods === null) {
    if (paid > 0) {
      const method = PAYMENT_METHODS.has(rawMethod) ? rawMethod : "";
      if (!method) addError("طريقة الدفع مفقودة؛ لا يمكن إنشاء سجل دفع تاريخي موثوق.");
      const sourceCreatedAt = hasValue(raw.createdAt) ? validTimestamp(raw.createdAt) : null;
      if (hasValue(raw.createdAt) && !sourceCreatedAt) addError("تاريخ إنشاء الفاتورة الموجود في المصدر غير صالح.");
      const paidAt = hasValue(raw.createdAt) ? sourceCreatedAt : (date ? `${date}T12:00:00.000Z` : null);
      if (!paidAt) addError("تاريخ الدفعة التاريخية غير صالح.");
      if (method && paidAt) payments.push({ amount: paid, method, paidAt, reference: "", notes: "دفعة مرحّلة من حقل paid في الفاتورة القديمة؛ وقت الدفع الدقيق غير متوفر في المصدر.", synthetic: true });
    }
  } else if (!Array.isArray(methods)) {
    addError("سجل دفعات الفاتورة ليس قائمة صالحة.");
  } else {
    let paymentSum = 0;
    methods.forEach((payment, index) => {
      if (!isObject(payment)) {
        addError(`الدفعة ${index + 1} ليست كائنًا صالحًا.`);
        return;
      }
      const amount = parseAmount(payment.amount);
      const method = text(payment.method, 40);
      const paidAt = validTimestamp(payment.paidAt ?? payment.paid_at);
      const reference = payment.reference == null ? "" : typeof payment.reference === "string" ? payment.reference.trim().slice(0, 100) : null;
      const notes = payment.notes == null ? "" : typeof payment.notes === "string" ? payment.notes.trim().slice(0, 300) : null;
      if (amount === null || amount <= 0) addError(`الدفعة ${index + 1}: المبلغ غير صالح.`);
      if (!PAYMENT_METHODS.has(method)) addError(`الدفعة ${index + 1}: طريقة الدفع غير مدعومة.`);
      if (!paidAt) addError(`الدفعة ${index + 1}: التاريخ غير صالح.`);
      if (reference === null || notes === null || (typeof payment.reference === "string" && payment.reference.length > 100) || (typeof payment.notes === "string" && payment.notes.length > 300)) addError(`الدفعة ${index + 1}: المرجع أو الملاحظات غير صالحة أو أطول من الحد المسموح.`);
      if (amount !== null && amount > 0) paymentSum = roundMoney(paymentSum + amount);
      if (amount !== null && amount > 0 && PAYMENT_METHODS.has(method) && paidAt && reference !== null && notes !== null) {
        payments.push({ amount, method, paidAt, reference, notes, synthetic: false });
      }
    });
    if (paid !== null && !sameMoney(paymentSum, paid)) addError("مجموع سجلات الدفعات لا يساوي المبلغ المدفوع في الفاتورة.");
  }

  if (paid !== null && paid > 0 && payments.length === 0) addError("لا توجد دفعة صالحة تفسر المبلغ المدفوع.");
  const computedStatus = paid !== null && total !== null ? statusFor(paid, Math.max(0, total - (returnedTotal ?? 0))) : null;
  const originalTotalStatus = paid !== null && total !== null ? statusFor(paid, total) : null;
  const allowedStatuses = new Set([computedStatus, originalTotalStatus].filter(Boolean));
  const sourceStatus = hasValue(raw.status) ? text(raw.status, 30).toLowerCase() : "";
  const sourcePaymentStatus = hasValue(raw.payment_status ?? raw.paymentStatus) ? text(raw.payment_status ?? raw.paymentStatus, 30).toLowerCase() : "";
  const isVoid = sourceStatus === "void" || sourcePaymentStatus === "void";
  if (sourceStatus && !["paid", "partial", "unpaid", "void"].includes(sourceStatus)) addError("حالة الفاتورة غير مدعومة.");
  if (sourcePaymentStatus && !["paid", "partial", "unpaid", "void"].includes(sourcePaymentStatus)) addError("حالة الدفع غير مدعومة.");
  if (isVoid) {
    if (sourceStatus && sourceStatus !== "void") addError("حالة الفاتورة وحالة الدفع متعارضتان.");
    if (sourcePaymentStatus && sourcePaymentStatus !== "void") addError("حالة الفاتورة وحالة الدفع متعارضتان.");
    if (paid > 0 || returnedTotal > 0) addError("الفاتورة الملغاة تحتوي مدفوعات أو عوائد غير مصفاة.");
  } else {
    if (sourceStatus && !allowedStatuses.has(sourceStatus)) addError("حالة الفاتورة لا تتوافق مع الإجمالي والمدفوع والعوائد.");
    if (sourcePaymentStatus && !allowedStatuses.has(sourcePaymentStatus)) addError("حالة الدفع لا تتوافق مع الإجمالي والمدفوع والعوائد.");
    if (sourceStatus && sourcePaymentStatus && sourceStatus !== sourcePaymentStatus) addError("حالة الفاتورة وحالة الدفع غير متطابقتين.");
  }

  const sourceCreatedAt = hasValue(raw.createdAt) ? validTimestamp(raw.createdAt) : null;
  if (hasValue(raw.createdAt) && !sourceCreatedAt) addError("تاريخ إنشاء الفاتورة الموجود في المصدر غير صالح.");
  const createdAt = sourceCreatedAt || (date ? `${date}T12:00:00.000Z` : null);
  if (!createdAt) addError("تاريخ إنشاء الفاتورة غير صالح.");
  if (errors.length) return invalid(errors);

  const method = rawMethod || payments[0]?.method || "cash";
  const invoice = {
    id,
    no,
    date,
    branchId,
    branchName: "",
    patientId,
    subtotal,
    discount,
    total,
    paid,
    method,
    status: isVoid ? "void" : sourceStatus || sourcePaymentStatus || computedStatus,
    payment_status: isVoid ? "void" : sourcePaymentStatus || sourceStatus || computedStatus,
    items: normalizedItems,
    cogs,
    returnedTotal,
    returnedCost: suppliedReturnedCost ?? calculatedReturnedCost,
    returnedQuantities,
    returnedAllocations: {},
    paymentHistory: [],
    legacyImported: true,
    createdAt,
    createdBy: text(raw.createdBy, 180) || null,
  };
  return { valid: true, invoice, payments, errors: [] };
}
