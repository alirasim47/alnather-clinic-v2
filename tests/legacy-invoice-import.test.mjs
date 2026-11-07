import test from "node:test";
import assert from "node:assert/strict";
import { mapLegacyBranchContext, validateLegacyInvoice } from "../lib/server/legacy-invoice-import.mjs";

function fixture(overrides = {}) {
  return {
    id: "invoice-1",
    no: "INV-MAIN-2025-00001",
    date: "2025-04-02",
    branchId: "branch-1",
    patientId: "patient-1",
    subtotal: 20,
    discount: 0,
    total: 20,
    paid: 10,
    method: "cash",
    status: "partial",
    payment_status: "partial",
    cogs: 4,
    items: [{ id: "line-1", productId: "product-1", name: "عدسة", price: 10, qty: 2, unitCost: 2, costTotal: 4, discountShare: 0, netAmount: 20, unitNetPrice: 10 }],
    paymentHistory: [{ id: "pay-1", amount: 10, method: "cash", paidAt: "2025-04-02T09:30:00.000Z" }],
    ...overrides,
  };
}

test("accepts a consistent legacy invoice and marks every line as non-stock-managed", () => {
  const result = validateLegacyInvoice(fixture());
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.invoice.total, 20);
  assert.equal(result.invoice.status, "partial");
  assert.equal(result.invoice.items[0].stockManaged, false);
  assert.equal(result.invoice.items[0].sourceCollection, "legacy");
  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].amount, 10);
});

test("rebuilds one clearly labelled historical payment only when paymentHistory is absent", () => {
  const oldInvoice = fixture();
  delete oldInvoice.paymentHistory;
  const result = validateLegacyInvoice(oldInvoice);
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].amount, 10);
  assert.equal(result.payments[0].method, "cash");
  assert.equal(result.payments[0].synthetic, true);
  assert.match(result.payments[0].notes, /وقت الدفع الدقيق غير متوفر/);
});

test("rejects disagreement between item subtotal, discount, and invoice total", () => {
  const result = validateLegacyInvoice(fixture({ total: 19 }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("الإجمالي النهائي")));
});

test("rejects one-cent invoice-total and payment-history reconciliation gaps", () => {
  const totalGap = validateLegacyInvoice(fixture({ total: 19.99 }));
  assert.equal(totalGap.valid, false);
  assert.ok(totalGap.errors.some((error) => error.includes("الإجمالي النهائي")));
  const paymentGap = validateLegacyInvoice(fixture({ paymentHistory: [{ amount: 9.99, method: "cash", paidAt: "2025-04-02T09:30:00.000Z" }] }));
  assert.equal(paymentGap.valid, false);
  assert.ok(paymentGap.errors.some((error) => error.includes("مجموع سجلات الدفعات")));
});

test("rejects discount shares that make a line net amount negative", () => {
  const result = validateLegacyInvoice(fixture({
    subtotal: 10,
    discount: 6,
    total: 4,
    paid: 0,
    status: "unpaid",
    payment_status: "unpaid",
    cogs: 2,
    paymentHistory: [],
    items: [
      { id: "line-1", productId: "p1", name: "الأول", price: 5, qty: 1, unitCost: 1, costTotal: 1, discountShare: 6, netAmount: -1, unitNetPrice: -1 },
      { id: "line-2", productId: "p2", name: "الثاني", price: 5, qty: 1, unitCost: 1, costTotal: 1, discountShare: 0, netAmount: 5, unitNetPrice: 5 },
    ],
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("حصة الخصم تتجاوز إجمالي البند")));
});

test("uses the same maximum invoice amount as normal business operations", () => {
  const result = validateLegacyInvoice(fixture({ total: 1_000_000_000.01 }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("الإجمالي النهائي غير صالح")));
});

test("rejects partial payment history whose sum differs from paid", () => {
  const result = validateLegacyInvoice(fixture({ paymentHistory: [{ amount: 9, method: "cash", paidAt: "2025-04-02T09:30:00.000Z" }] }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("مجموع سجلات الدفعات")));
});

test("rejects an empty explicit history for an invoice with paid money", () => {
  const result = validateLegacyInvoice(fixture({ paymentHistory: [] }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("مجموع سجلات الدفعات")));
});

test("rejects missing branch, product snapshot, or reliable COGS instead of guessing", () => {
  const missingBranch = validateLegacyInvoice(fixture({ branchId: "" }));
  assert.equal(missingBranch.valid, false);
  assert.ok(missingBranch.errors.some((error) => error.includes("فرع الفاتورة")));
  const missingCost = validateLegacyInvoice(fixture({ cogs: undefined, items: [{ id: "line-1", productId: "product-1", name: "عدسة", price: 10, qty: 2 }] }));
  assert.equal(missingCost.valid, false);
  assert.ok(missingCost.errors.some((error) => error.includes("تكلفة البضاعة")));
  assert.ok(missingCost.errors.some((error) => error.includes("البند 1")));
});

test("rejects invalid return totals and quantities", () => {
  const result = validateLegacyInvoice(fixture({
    returnedTotal: 5,
    returnedCost: 2,
    returnedQuantities: { "line-1": 1 },
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("إجمالي العوائد")));
});

test("derives returned cost from returned quantities when the source omits it", () => {
  const result = validateLegacyInvoice(fixture({
    paid: 20,
    status: "paid",
    payment_status: "paid",
    paymentHistory: [{ amount: 20, method: "cash", paidAt: "2025-04-02T09:30:00.000Z" }],
    returnedTotal: 10,
    returnedQuantities: { "line-1": 1 },
  }));
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.invoice.returnedCost, 2);
});

test("rounds a costTotal-derived unit cost before deriving historical return cost", () => {
  const result = validateLegacyInvoice(fixture({
    subtotal: 30,
    total: 30,
    paid: 0,
    status: "unpaid",
    payment_status: "unpaid",
    cogs: 1,
    paymentHistory: [],
    returnedTotal: 20,
    returnedQuantities: { "line-1": 2 },
    items: [{ id: "line-1", productId: "product-1", name: "عدسة", price: 10, qty: 3, costTotal: 1 }],
  }));
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.invoice.items[0].unitCost, 0.33);
  assert.equal(result.invoice.returnedCost, 0.66);
});

test("rejects a present but malformed createdAt instead of silently replacing it", () => {
  const result = validateLegacyInvoice(fixture({ createdAt: "not-a-timestamp" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("تاريخ إنشاء الفاتورة الموجود")));
});

test("rejects a positive historical return cost without returned quantities", () => {
  const result = validateLegacyInvoice(fixture({ returnedCost: 3 }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("دون تفاصيل كميات مرتجعة")));
});

test("never treats a globally-colliding foreign branch id as local", () => {
  const local = [{ id: "local-main", code: "MAIN", name: "الرئيسي" }];
  const foreignSource = [{ id: "foreign-branch", code: "NORTH", name: "فرع أجنبي" }];
  const blocked = mapLegacyBranchContext(local, foreignSource, new Set(["foreign-branch"]));
  assert.equal(blocked.map.has("foreign-branch"), false);
  assert.equal(blocked.ids.has("foreign-branch"), false);

  const remapped = mapLegacyBranchContext(local, [{ id: "foreign-branch", code: "MAIN", name: "رئيسي المصدر" }], new Set(["foreign-branch"]));
  assert.equal(remapped.map.get("foreign-branch"), "local-main");
  assert.equal(remapped.ids.has("foreign-branch"), false);
  assert.equal(remapped.ids.has("local-main"), true);
});

test("rejects a void invoice that still contains unreconciled payments", () => {
  const result = validateLegacyInvoice(fixture({ status: "void", payment_status: "void" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("الفاتورة الملغاة")));
});

test("rejects amounts with more than two decimal places rather than silently rounding", () => {
  const result = validateLegacyInvoice(fixture({ paid: 1.005, paymentHistory: [{ amount: 1.005, method: "cash", paidAt: "2025-04-02T09:30:00.000Z" }] }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("المبلغ المدفوع")));
});
