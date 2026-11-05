"use client";
import React, { useState, useMemo, useEffect } from "react";
import { Card, Badge, Input, Select, Field, Modal, EmptyRow } from "@/components/ui";
import { payAr } from "@/lib/data";
import { createSale, fetchCollection, recordInvoicePayment } from "@/lib/api";
import { fmtMoney, fmtDate, todayISO } from "@/lib/utils";
import { buildInvoiceHtml } from "@/lib/print-html.mjs";

const LENS_TYPE_LABELS = { spherical: "كروية", toric: "استجماتزم", multifocal: "متعددة البؤر", contact: "لاصقة", other: "أخرى" };
function describeLens(lens) {
  const powers = [lens.sph != null && `SPH ${lens.sph}`, lens.cyl != null && `CYL ${lens.cyl}`, lens.axis != null && `AXIS ${lens.axis}`, lens.add != null && `ADD ${lens.add}`].filter(Boolean).join(" / ");
  return [lens.brand || "عدسة", lens.sku, LENS_TYPE_LABELS[lens.type] || lens.type, lens.side === "right" ? "يمين" : lens.side === "left" ? "يسار" : "زوج", powers, lens.material, lens.coating].filter(Boolean).join(" · ");
}

export default function Invoices({ can, currentUser }) {
  const allowed = (permission) => typeof can !== "function" || can(permission);
  const [rows, setRows] = useState([]);
  const [patients, setPatients] = useState([]);
  const [settings, setSettings] = useState({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pos, setPos] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "cash", reference: "" });
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      const [loadedInvoices, loadedPatients, loadedSettings] = await Promise.all([
        fetchCollection("invoices"),
        fetchCollection("patients"),
        fetchCollection("settings", {}),
      ]);
      if (!ignore) {
        setRows(Array.isArray(loadedInvoices) ? loadedInvoices : []);
        setPatients(Array.isArray(loadedPatients) ? loadedPatients : []);
        setSettings(loadedSettings && typeof loadedSettings === "object" ? loadedSettings : {});
      }
    };
    load();
    return () => { ignore = true; };
  }, []);

  const pNameOf = (id) => (id ? patients.find((p) => String(p.id) === String(id))?.name || "عميل نقدي" : "عميل نقدي");
  const clinicName = settings.clinicName || "عيادة الناظر";

  const saveInvoice = async (invoice) => {
    if (!allowed("invoices.create")) return;
    const saved = await createSale(invoice);
    if (!saved?.id) throw new Error("لم يؤكد الخادم اعتماد الفاتورة.");
    setRows((current) => [saved, ...current]);
    return saved;
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    if (!viewing || paymentSaving || !allowed("invoices.update")) return;
    setPaymentSaving(true); setPaymentMessage("");
    try {
      const result = await recordInvoicePayment({ invoiceId: viewing.id, amount: Number(paymentForm.amount), method: paymentForm.method, reference: paymentForm.reference });
      if (!result?.invoice?.id) throw new Error("لم يؤكد الخادم تسجيل الدفعة.");
      setViewing(result.invoice);
      setRows((current) => current.map((invoice) => String(invoice.id) === String(result.invoice.id) ? result.invoice : invoice));
      setPaymentForm({ amount: "", method: "cash", reference: "" });
      setPaymentMessage("تم تسجيل الدفعة وتحديث الرصيد.");
    } catch (error) {
      setPaymentMessage(error.message || "تعذر تسجيل الدفعة.");
    } finally { setPaymentSaving(false); }
  };

  const filtered = useMemo(() => rows.filter((i) => {
    if (status !== "all" && i.status !== status) return false;
    if (from && i.date < from) return false;
    if (to && i.date > to) return false;
    if (query && !pNameOf(i.patientId).includes(query) && !String(i.no || "").includes(query)) return false;
    return true;
  }), [rows, query, status, from, to, patients]);

  const stBadge = (s) => s === "paid" ? <Badge color="green">مدفوعة</Badge>
    : s === "partial" ? <Badge color="orange">جزئي</Badge> : <Badge color="red">غير مدفوعة</Badge>;

  return (
    <div className="space-y-5">
      <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="من تاريخ"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="إلى تاريخ"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="بحث"><Input placeholder="رقم الفاتورة أو اسم المريض" value={query} onChange={(e) => setQuery(e.target.value)} /></Field>
        <Field label="حالة الدفع">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">الكل</option><option value="paid">نقدي / مدفوع</option>
            <option value="partial">أقساط / جزئي</option><option value="unpaid">غير مدفوع</option>
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-2 lg:col-span-4 lg:justify-end">
          {allowed("invoices.create") && <button onClick={() => setPos(true)} className="btn-accent"><i className="fa-solid fa-plus" /> فاتورة جديدة (POS)</button>}
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr><th className="th">رقم الفاتورة</th><th className="th">التاريخ</th><th className="th">المريض</th>
                <th className="th">الإجمالي</th><th className="th">المدفوع</th><th className="th">المتبقي</th>
                <th className="th">طريقة الدفع</th><th className="th">إجراءات</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 && <EmptyRow span={8} />}
              {filtered.map((i) => {
                const rem = Math.max(0, (i.total || 0) - (i.paid || 0) - (i.returnedTotal || 0));
                return (
                  <tr key={i.id} className="hover:bg-accent-soft/40">
                    <td className="td font-bold"><Badge color="yellow">{i.no}</Badge></td>
                    <td className="td text-gray-500">{fmtDate(i.date)}</td>
                    <td className="td font-bold text-gray-800">{pNameOf(i.patientId)}</td>
                    <td className="td">{fmtMoney(i.total)}</td>
                    <td className="td font-bold text-success">{fmtMoney(i.paid)}</td>
                    <td className={`td font-bold ${rem > 0 ? "text-danger" : "text-gray-400"}`}>{fmtMoney(rem)}</td>
                    <td className="td">{payAr[i.method]}</td>
                    <td className="td">
                      <div className="flex gap-1">
                        {allowed("invoices.print") && <button title="طباعة" className="icon-btn text-primary hover:bg-primary hover:text-white"
                          onClick={() => printInvoice({ invoice: i, patientName: pNameOf(i.patientId), clinicName })}>
                          <i className="fa-solid fa-print" />
                        </button>}
                        <button title="عرض" className="icon-btn text-info hover:bg-info hover:text-white" onClick={() => setViewing(i)}>
                          <i className="fa-solid fa-eye" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {pos && allowed("invoices.create") && <PosModal currentUser={currentUser} onClose={() => setPos(false)} onSave={saveInvoice} />}

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={`تفاصيل الفاتورة ${viewing.no}`}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg bg-gray-50 p-3"><b>المريض:</b> {pNameOf(viewing.patientId)}</div>
              <div className="rounded-lg bg-gray-50 p-3"><b>التاريخ:</b> {fmtDate(viewing.date)}</div>
              <div className="rounded-lg bg-gray-50 p-3"><b>طريقة الدفع:</b> {payAr[viewing.method] || viewing.method}</div>
              <div className="rounded-lg bg-gray-50 p-3">{stBadge(viewing.status)}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr><th className="th">الصنف</th><th className="th">الكمية</th><th className="th">السعر</th><th className="th">الإجمالي</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(viewing.items || []).length === 0 && <EmptyRow span={4} text="لا توجد أصناف محفوظة لهذه الفاتورة" />}
                  {(viewing.items || []).map((it, idx) => (
                    <tr key={it.id || idx}>
                      <td className="td font-bold">{it.name}</td>
                      <td className="td">{it.qty}</td>
                      <td className="td">{fmtMoney(it.price)}</td>
                      <td className="td font-bold">{fmtMoney(Number(it.price || 0) * Number(it.qty || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap justify-end gap-3 sm:gap-6 rounded-xl2 bg-primary p-4 text-sm text-white">
              <span>الإجمالي: <b className="text-accent">{fmtMoney(viewing.total)}</b></span>
              <span>المدفوع: <b className="text-emerald-300">{fmtMoney(viewing.paid)}</b></span>
              <span>المتبقي بعد العوائد: <b className="text-red-300">{fmtMoney(Math.max(0, (viewing.total || 0) - (viewing.paid || 0) - (viewing.returnedTotal || 0)))}</b></span>
            </div>
            {Array.isArray(viewing.paymentHistory) && viewing.paymentHistory.length > 0 && <Card className="p-4"><h3 className="mb-2 font-extrabold text-primary">سجل الدفعات</h3><div className="space-y-2 text-sm">{viewing.paymentHistory.map((payment) => <div key={payment.id} className="flex justify-between gap-3 border-b border-gray-100 pb-2"><span>{fmtDate(String(payment.paidAt || "").slice(0, 10))} — {payAr[payment.method] || payment.method}</span><b>{fmtMoney(payment.amount)}</b></div>)}</div></Card>}
            {allowed("invoices.update") && viewing.status !== "void" && (viewing.total || 0) - (viewing.paid || 0) - (viewing.returnedTotal || 0) > 0 && <form onSubmit={submitPayment} className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-4"><h3 className="font-extrabold text-primary">تسجيل دفعة لاحقة</h3><div className="grid gap-3 sm:grid-cols-3"><Field label="مبلغ الدفعة" required><Input required type="number" min="0.01" step="0.01" max={Math.max(0, (viewing.total || 0) - (viewing.paid || 0) - (viewing.returnedTotal || 0))} value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></Field><Field label="طريقة الدفع"><Select value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}><option value="cash">نقدي</option><option value="card">شبكة</option><option value="transfer">تحويل</option><option value="installments">قسط</option></Select></Field><Field label="مرجع الدفع (اختياري)"><Input maxLength={100} value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} /></Field></div>{paymentMessage && <p role="status" className="text-sm font-bold text-blue-900">{paymentMessage}</p>}<div className="flex justify-end"><button className="btn-blue" disabled={paymentSaving}>{paymentSaving ? "جارٍ تسجيل الدفعة…" : "تأكيد الدفعة"}</button></div></form>}
            <div className="flex flex-wrap justify-end gap-3">
              {allowed("invoices.print") && <button className="btn-ghost" onClick={() => printInvoice({ invoice: viewing, patientName: pNameOf(viewing.patientId), clinicName })}>
                <i className="fa-solid fa-print" /> طباعة
              </button>}
              <button className="btn-accent" onClick={() => setViewing(null)}>إغلاق</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function printInvoice({ invoice, patientName, clinicName }) {
  const html = buildInvoiceHtml({ invoice, patientName, clinicName, formatMoney: fmtMoney });
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) { window.alert("اسمح بفتح نافذة الطباعة ثم حاول مجددًا."); return; }
  w.opener = null;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    if (!w.closed) w.print();
  }, 300);
}

function PosModal({ onClose, onSave, currentUser }) {
  const [items, setItems] = useState([]);
  const [catalogKey, setCatalogKey] = useState("");
  const [qty, setQty] = useState(1);
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState(0);
  const [patientId, setPatientId] = useState("");
  const [method, setMethod] = useState("cash");
  const [products, setProducts] = useState([]);
  const [lensRows, setLensRows] = useState([]);
  const [patients, setPatients] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(currentUser?.branchId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    const refresh = async () => {
      const [nextProducts, nextPatients, nextBranches, nextLensRows] = await Promise.all([
        fetchCollection("products"),
        fetchCollection("patients"),
        fetchCollection("branches", []),
        fetchCollection("lensInventory", []),
      ]);
      if (!ignore) {
        setProducts(Array.isArray(nextProducts) ? nextProducts : []);
        setLensRows(Array.isArray(nextLensRows) ? nextLensRows : []);
        setPatients(Array.isArray(nextPatients) ? nextPatients : []);
        const activeBranches = Array.isArray(nextBranches) ? nextBranches.filter((branch) => branch.active !== false) : [];
        setBranches(activeBranches);
        if (!currentUser?.branchId && activeBranches.length) setBranchId(activeBranches[0].id);
      }
    };

    refresh();
    return () => { ignore = true; };
  }, [currentUser?.branchId]);

  const productOptions = Array.isArray(products) ? products : [];
  const patientOptions = Array.isArray(patients) ? patients : [];
  const lensOptions = (Array.isArray(lensRows) ? lensRows : []).filter((lens) => lens.active !== false && String(lens.branchId || "") === String(branchId || ""));
  const activeProducts = productOptions.filter((product) => product.active !== false);
  const hasProducts = activeProducts.length > 0;
  const hasCatalog = hasProducts || lensOptions.length > 0;
  const hasPatients = patientOptions.length > 0;

  const addItem = () => {
    if (!catalogKey) return;
    const separator = catalogKey.indexOf(":");
    const sourceCollection = catalogKey.slice(0, separator);
    const id = catalogKey.slice(separator + 1);
    const isLens = sourceCollection === "lensInventory";
    const prod = (isLens ? lensOptions : activeProducts).find((p) => String(p.id) === String(id));
    const enteredQty = Number(qty);
    const safeQty = Math.round(enteredQty * 100) / 100;
    if (!prod) return;
    if (!Number.isFinite(enteredQty) || enteredQty <= 0 || enteredQty > 100000 || safeQty <= 0 || Math.abs(enteredQty * 100 - Math.round(enteredQty * 100)) > 0.0001) {
      window.alert("أدخل كمية أكبر من صفر وبحد أقصى منزلتين عشريتين.");
      return;
    }
    if (prod.active === false) return;
    const tracked = isLens || (prod.cat !== "services" && prod.type !== "service" && prod.trackStock !== false);
    const available = isLens ? Number(prod.quantity ?? prod.qty ?? 0) : !tracked ? Number.POSITIVE_INFINITY : currentUser?.role === "admin"
      ? Number(prod.branchQuantities?.[branchId] ?? 0)
      : Number(prod.qty ?? prod.quantity ?? 0);
    const alreadyInCart = items
      .filter((item) => item.sourceCollection === sourceCollection && String(item.productId) === String(prod.id))
      .reduce((sum, item) => sum + Number(item.qty || 0), 0);
    if (tracked && available >= 0 && alreadyInCart + safeQty > available) {
      window.alert(`الكمية المتوفرة من ${isLens ? describeLens(prod) : prod.name} في هذا الفرع هي ${available} فقط`);
      return;
    }

    const price = Number(isLens ? (prod.sell ?? prod.price) : prod.sell) || 0;
    const nextItem = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId: prod.id,
      sourceCollection,
      ...(isLens ? { lensInventoryId: prod.id, lensDetails: { sku: prod.sku, sph: prod.sph, cyl: prod.cyl, axis: prod.axis, add: prod.add, side: prod.side } } : {}),
      name: isLens ? describeLens(prod) : prod.name,
      price,
      qty: safeQty,
    };

    setItems((current) => [...current, nextItem]);
    setCatalogKey("");
    setQty(1);
  };

  const changeBranch = (nextBranchId) => {
    if (nextBranchId === branchId) return;
    if (items.length && !window.confirm("تغيير الفرع سيزيل الأصناف الحالية من السلة حتى لا يُخصم مخزون فرع آخر. هل تريد المتابعة؟")) return;
    setItems([]);
    setCatalogKey("");
    setBranchId(nextBranchId);
  };

  const subtotal = items.reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 0), 0);
  const total = Math.max(0, subtotal - Number(discount || 0));
  const remaining = Math.max(0, total - Number(paid || 0));
  const canSaveInvoice = Boolean(branchId) && items.length > 0 && items.every((item) => Number(item.qty || 0) > 0);

  const save = async () => {
    if (!canSaveInvoice || saving) return;
    const invoice = {
      date: todayISO(),
      branchId,
      patientId: patientId || null,
      total,
      discount: Number(discount || 0),
      paid: Number(paid || 0),
      method,
      status: Number(paid || 0) >= total ? "paid" : Number(paid || 0) > 0 ? "partial" : "unpaid",
      items: items.map((item) => ({ ...item })),
    };
    setSaving(true); setError("");
    try { await onSave(invoice); onClose(); }
    catch (e) { setError(e?.message || "تعذر اعتماد الفاتورة."); }
    finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} wide title="إنشاء فاتورة جديدة — نقطة البيع">
      <div className="space-y-5">
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">{error}</div>}
        <section className="rounded-xl2 border border-gray-100 bg-gray-50/70 p-4">
          <div className="mb-3 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-black text-white">1</span><h3 className="font-extrabold text-primary">الفرع والمراجع</h3></div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="الفرع الذي تُسجّل عليه الفاتورة" required><Select required value={branchId} disabled={Boolean(currentUser?.branchId)} onChange={(event) => changeBranch(event.target.value)}><option value="">اختر الفرع</option>{branches.map((branch) => <option key={branch.id} value={String(branch.id)}>{branch.name}</option>)}</Select></Field>
            <Field label="المراجع / المريض (اختياري)"><Select value={patientId} onChange={(event) => setPatientId(event.target.value)} disabled={!hasPatients}><option value="">{hasPatients ? "— بيع نقدي بدون ملف مراجع —" : "لا توجد ملفات مرضى"}</option>{patientOptions.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</Select>{!hasPatients && <p className="mt-1 text-xs text-gray-500">تقدر تسجل البيع كعميل نقدي، أو أضف المراجع من شاشة المرضى أولًا.</p>}</Field>
          </div>
        </section>

        <section className="space-y-3 rounded-xl2 border border-gray-100 p-4">
          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-black text-primary">2</span><div><h3 className="font-extrabold text-primary">الأصناف والعدسات بالقياس</h3><p className="text-xs text-gray-500">تظهر درجات العدسات المتاحة للفرع المحدد ويخصم النظام الرصيد عند اعتماد الفاتورة.</p></div></div>
          <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-0">
            <Field label="المنتج / الخدمة">
              <Select value={catalogKey} onChange={(event) => setCatalogKey(event.target.value)} disabled={!hasCatalog}>
                <option value="">{hasCatalog ? "— اختر منتجًا أو درجة عدسة —" : "لا توجد أصناف متاحة للبيع"}</option>
                {hasProducts && <optgroup label="المنتجات والخدمات">{activeProducts.map((p) => {
                  const stock = currentUser?.role === "admin" ? Number(p.branchQuantities?.[branchId] || 0) : Number(p.qty ?? 0);
                  const service = p.cat === "services" || p.type === "service" || p.trackStock === false;
                  return <option key={`product:${p.id}`} value={`products:${p.id}`}>{p.name} — {service ? "خدمة" : `متاح ${stock}`} — {fmtMoney(p.sell)}</option>;
                })}</optgroup>}
                {lensOptions.length > 0 && <optgroup label="مخزون العدسات بالقياس">{lensOptions.map((lens) => <option key={`lensInventory:${lens.id}`} value={`lensInventory:${lens.id}`}>{describeLens(lens)} — رصيد {Number(lens.quantity ?? lens.qty ?? 0)} — {fmtMoney(lens.sell ?? lens.price)}</option>)}</optgroup>}
              </Select>
            </Field>
            {!hasCatalog && (
              <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] font-bold text-orange-700">
                لا توجد منتجات أو درجات عدسات متاحة لهذا الفرع. أضفها من شاشات المخزون أولًا.
              </div>
            )}
          </div>
          <Field label="الكمية">
            <Input type="number" min="0.01" step="0.01" className="w-28" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <button type="button" onClick={addItem} disabled={!hasCatalog || !catalogKey} className="btn-accent mb-0.5 disabled:cursor-not-allowed disabled:opacity-50">
            <i className="fa-solid fa-plus" /> إضافة
          </button>
          </div>

          <div className="overflow-x-auto">
          <table className="w-full overflow-hidden rounded-xl2 border border-gray-100">
            <thead className="bg-gray-50"><tr><th className="th">الصنف / الدرجة</th><th className="th">المصدر</th><th className="th">السعر</th><th className="th">الكمية</th><th className="th">الإجمالي</th><th className="th"></th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {items.length === 0 && <EmptyRow span={6} text="لم تتم إضافة أصناف بعد" />}
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="td font-bold">{i.name}</td><td className="td"><Badge color={i.sourceCollection === "lensInventory" ? "blue" : "gray"}>{i.sourceCollection === "lensInventory" ? "عدسة بالقياس" : "منتج / خدمة"}</Badge></td><td className="td">{fmtMoney(i.price)}</td>
                  <td className="td">{i.qty}</td><td className="td font-bold">{fmtMoney(i.price * i.qty)}</td>
                  <td className="td"><button className="icon-btn text-danger hover:bg-danger hover:text-white" onClick={() => setItems(items.filter((x) => x.id !== i.id))}><i className="fa-solid fa-trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>

        <section className="space-y-4 rounded-xl2 border border-gray-100 p-4">
          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-black text-white">3</span><h3 className="font-extrabold text-primary">مراجعة الفاتورة والدفع</h3></div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="طريقة الدفع">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">نقدي</option>
              <option value="card">شبكة</option>
              <option value="installments">أقساط</option>
              <option value="transfer">تحويل</option>
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="الخصم"><Input dir="ltr" type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
          <Field label="المبلغ المدفوع"><Input dir="ltr" type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
          </div>
          </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2 rounded-xl2 bg-primary p-4 text-white">
            <div className="flex justify-between text-sm"><span>الإجمالي الفرعي</span><b>{fmtMoney(subtotal)}</b></div>
            <div className="flex justify-between text-sm"><span>الإجمالي النهائي</span><b className="text-accent">{fmtMoney(total)}</b></div>
            <div className="flex justify-between text-sm"><span>المتبقي</span><b className={remaining > 0 ? "text-red-300" : "text-emerald-300"}>{fmtMoney(remaining)}</b></div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-4">
          <button type="button" onClick={onClose} disabled={saving} className="btn-outline-danger">إلغاء</button>
          <button type="button" onClick={save} disabled={!canSaveInvoice||saving} className="btn-accent disabled:cursor-not-allowed disabled:opacity-50">
            <i className="fa-solid fa-floppy-disk" /> {saving?"جارٍ اعتماد الفاتورة…":"حفظ الفاتورة"}
          </button>
        </div>
        </section>
      </div>
    </Modal>
  );
}
