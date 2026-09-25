"use client";
import React, { useState, useMemo, useEffect } from "react";
import { Card, Badge, Input, Select, Field, Modal, EmptyRow } from "@/components/ui";
import { seedInvoices, seedPatients, seedProducts, payAr } from "@/lib/data";
import { readStorage, STORAGE_KEYS, writeStorage } from "@/lib/storage";
import { fetchCollection, saveCollection, saveSingleItem, deleteSingleItem } from "@/lib/api";
import { fmtMoney, fmtDate, todayISO } from "@/lib/utils";

export default function Invoices() {
  const [rows, setRows] = useState(() => readStorage(STORAGE_KEYS.invoices, seedInvoices));
  const [patients, setPatients] = useState(seedPatients);
  const [settings, setSettings] = useState({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pos, setPos] = useState(false);
  const [viewing, setViewing] = useState(null);

  useEffect(() => writeStorage(STORAGE_KEYS.invoices, rows), [rows]);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      const [loadedPatients, loadedSettings] = await Promise.all([
        fetchCollection("patients", seedPatients),
        fetchCollection("settings", {}),
      ]);
      if (!ignore) {
        setPatients(Array.isArray(loadedPatients) ? loadedPatients : seedPatients);
        setSettings(loadedSettings && typeof loadedSettings === "object" ? loadedSettings : {});
      }
    };
    load();
    return () => { ignore = true; };
  }, []);

  const pNameOf = (id) => (id ? patients.find((p) => p.id === id)?.name || "عميل نقدي" : "عميل نقدي");
  const clinicName = settings.clinicName || "عيادة العلي";

  const saveInvoice = async (invoice) => {
    const maxNo = rows.reduce((m, r) => Math.max(m, Number(String(r.no || "").replace(/\D/g, "")) || 0), 2000);
    const final = { ...invoice, no: `INV-${maxNo + 1}` };
    const saved = await saveSingleItem("invoices", final);
    const next = [...rows, saved || final];
    setRows(next);
    writeStorage(STORAGE_KEYS.invoices, next);
  };

  const removeInvoice = async (id) => {
    const target = rows.find((r) => r.id === id);
    if (!window.confirm(`هل أنت متأكد من حذف الفاتورة ${target?.no || ""}؟ لا يمكن التراجع!`)) return;
    if (target?.items?.length) {
      const products = await fetchCollection("products", seedProducts);
      const restored = (Array.isArray(products) ? products : []).map((product) => {
        const returned = target.items
          .filter((item) => String(item.productId) === String(product.id))
          .reduce((sum, item) => sum + Number(item.qty || 0), 0);
        return returned ? { ...product, qty: Number(product.qty || 0) + returned } : product;
      });
      await saveCollection("products", restored);
    }
    const result = await deleteSingleItem("invoices", id);
    const next = result ? result : rows.filter((invoice) => invoice.id !== id);
    setRows(next);
    writeStorage(STORAGE_KEYS.invoices, next);
  };

  const clearInvoices = () => {
    if (!window.confirm("تحذير خطير: سيتم حذف جميع الفواتير نهائياً! هل أنت متأكد 100%؟")) return;
    setRows(() => {
      writeStorage(STORAGE_KEYS.invoices, []);
      return [];
    });
    saveCollection("invoices", []);
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
          {rows.length > 0 && (
            <button onClick={clearInvoices} className="btn-outline-danger">
              <i className="fa-solid fa-trash" /> حذف الفواتير
            </button>
          )}
          <button onClick={() => setPos(true)} className="btn-accent"><i className="fa-solid fa-plus" /> فاتورة جديدة (POS)</button>
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
                const rem = (i.total || 0) - (i.paid || 0);
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
                        <button title="طباعة" className="icon-btn text-primary hover:bg-primary hover:text-white"
                          onClick={() => printInvoice({ invoice: i, patientName: pNameOf(i.patientId), clinicName })}>
                          <i className="fa-solid fa-print" />
                        </button>
                        <button title="عرض" className="icon-btn text-info hover:bg-info hover:text-white" onClick={() => setViewing(i)}>
                          <i className="fa-solid fa-eye" />
                        </button>
                        <button title="حذف الفاتورة" className="icon-btn text-danger hover:bg-danger hover:text-white" onClick={() => removeInvoice(i.id)}>
                          <i className="fa-solid fa-trash" />
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

      {pos && <PosModal onClose={() => setPos(false)} onSave={saveInvoice} />}

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
              <span>المتبقي: <b className="text-red-300">{fmtMoney(Math.max(0, (viewing.total || 0) - (viewing.paid || 0)))}</b></span>
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <button className="btn-ghost" onClick={() => printInvoice({ invoice: viewing, patientName: pNameOf(viewing.patientId), clinicName })}>
                <i className="fa-solid fa-print" /> طباعة
              </button>
              <button className="btn-accent" onClick={() => setViewing(null)}>إغلاق</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function printInvoice({ invoice, patientName, clinicName }) {
  const rowsHtml = (invoice.items || []).map((it, idx) => `
    <tr><td>${idx + 1}</td><td>${it.name}</td><td>${it.qty}</td><td>${fmtMoney(it.price)}</td><td>${fmtMoney(Number(it.price || 0) * Number(it.qty || 0))}</td></tr>`).join("");
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>فاتورة ${invoice.no}</title>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
  <style>*{box-sizing:border-box;font-family:Tajawal,sans-serif}body{margin:24px;color:#1f2937}
  .head{display:flex;justify-content:space-between;border-bottom:3px solid #2c1b3d;padding-bottom:10px}
  h1{font-size:20px;color:#2c1b3d;margin:0}
  table{width:100%;border-collapse:collapse;margin-top:14px}
  th,td{border:1px solid #d1d5db;padding:8px;text-align:center;font-size:13px}
  th{background:#2c1b3d;color:#fff}
  .tot{margin-top:14px;font-size:14px}
  .foot{margin-top:26px;font-size:11px;color:#6b7280;text-align:center;border-top:1px dashed #d1d5db;padding-top:8px}
  </style></head><body>
  <div class="head"><h1>${clinicName}</h1><div>فاتورة رقم: ${invoice.no}<br>التاريخ: ${invoice.date}</div></div>
  <p><b>المريض:</b> ${patientName}</p>
  <table><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>${rowsHtml}</table>
  <div class="tot">
    <p>الإجمالي: <b>${fmtMoney(invoice.total)}</b></p>
    <p>المدفوع: <b>${fmtMoney(invoice.paid)}</b></p>
    <p>المتبقي: <b>${fmtMoney(Math.max(0, (invoice.total || 0) - (invoice.paid || 0)))}</b></p>
  </div>
  <div class="foot">شكراً لثقتكم — ${clinicName}</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
  </body></html>`;
  const w = window.open("", "_blank", "width=800,height=900");
  w.document.write(html);
  w.document.close();
}

function PosModal({ onClose, onSave }) {
  const [items, setItems] = useState([]);
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState(1);
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState(0);
  const [patientId, setPatientId] = useState("");
  const [method, setMethod] = useState("cash");
  const [products, setProducts] = useState(seedProducts);
  const [patients, setPatients] = useState(seedPatients);

  useEffect(() => {
    let ignore = false;
    const refresh = async () => {
      const [nextProducts, nextPatients] = await Promise.all([
        fetchCollection("products", seedProducts),
        fetchCollection("patients", seedPatients),
      ]);
      if (!ignore) {
        setProducts(Array.isArray(nextProducts) ? nextProducts : []);
        setPatients(Array.isArray(nextPatients) ? nextPatients : []);
      }
    };

    refresh();
    return () => { ignore = true; };
  }, []);

  const productOptions = Array.isArray(products) ? products : [];
  const patientOptions = Array.isArray(patients) ? patients : [];
  const hasProducts = productOptions.length > 0;
  const hasPatients = patientOptions.length > 0;

  const addItem = () => {
    if (!productId) return;

    const prod = productOptions.find((p) => String(p.id) === String(productId));
    const safeQty = Number(qty) > 0 ? Number(qty) : 1;
    if (!prod) return;
    const available = Number(prod.qty ?? prod.quantity ?? 0);
    const alreadyInCart = items
      .filter((item) => String(item.productId) === String(prod.id))
      .reduce((sum, item) => sum + Number(item.qty || 0), 0);
    if (available >= 0 && alreadyInCart + safeQty > available) {
      window.alert(`الكمية المتوفرة من ${prod.name} هي ${available} فقط`);
      return;
    }

    const price = Number(prod.sell) || 0;
    const nextItem = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId: prod.id,
      name: prod.name,
      price,
      qty: safeQty,
    };

    setItems((current) => [...current, nextItem]);
    setProductId("");
    setQty(1);
  };

  const subtotal = items.reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 0), 0);
  const total = Math.max(0, subtotal - Number(discount || 0));
  const remaining = Math.max(0, total - Number(paid || 0));
  const canSaveInvoice = items.length > 0 && items.every((item) => Number(item.qty || 0) > 0);

  const save = async () => {
    if (!canSaveInvoice) return;
    const invoice = {
      id: Date.now(),
      date: todayISO(),
      patientId: patientId ? Number(patientId) : 0,
      total,
      paid: Number(paid || 0),
      method,
      status: Number(paid || 0) >= total ? "paid" : Number(paid || 0) > 0 ? "partial" : "unpaid",
      items,
    };
    await onSave(invoice);

    try {
      const currentProducts = await fetchCollection("products", seedProducts);
      if (Array.isArray(currentProducts)) {
        const updated = currentProducts.map((p) => {
          const sold = items
            .filter((it) => String(it.productId) === String(p.id))
            .reduce((s, it) => s + Number(it.qty || 0), 0);
          return sold ? { ...p, qty: Math.max(0, (Number(p.qty) || 0) - sold) } : p;
        });
        await saveCollection("products", updated);
      }
    } catch {}

    onClose();
  };

  return (
    <Modal open onClose={onClose} wide title="إنشاء فاتورة جديدة — نقطة البيع">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-0">
            <Field label="المنتج / الخدمة">
              <Select value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!hasProducts}>
                <option value="">{hasProducts ? "— اختر منتجاً —" : "لا توجد منتجات مسجلة"}</option>
                {productOptions.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtMoney(p.sell)}</option>)}
              </Select>
            </Field>
            {!hasProducts && (
              <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] font-bold text-orange-700">
                لا توجد منتجات مسجلة. أضف منتجاً من شاشة المنتجات أولاً.
              </div>
            )}
          </div>
          <Field label="الكمية">
            <Input type="number" min="1" className="w-24" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <button type="button" onClick={addItem} disabled={!hasProducts || !productId} className="btn-accent mb-0.5 disabled:cursor-not-allowed disabled:opacity-50">
            <i className="fa-solid fa-plus" /> إضافة
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full overflow-hidden rounded-xl2 border border-gray-100">
            <thead className="bg-gray-50"><tr><th className="th">الصنف</th><th className="th">السعر</th><th className="th">الكمية</th><th className="th">الإجمالي</th><th className="th"></th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {items.length === 0 && <EmptyRow span={5} text="لم تتم إضافة أصناف بعد" />}
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="td font-bold">{i.name}</td><td className="td">{fmtMoney(i.price)}</td>
                  <td className="td">{i.qty}</td><td className="td font-bold">{fmtMoney(i.price * i.qty)}</td>
                  <td className="td"><button className="icon-btn text-danger hover:bg-danger hover:text-white" onClick={() => setItems(items.filter((x) => x.id !== i.id))}><i className="fa-solid fa-trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="المريض (اختياري)">
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)} disabled={!hasPatients}>
              <option value="">{hasPatients ? "— عميل نقدي —" : "لا توجد مرضى مسجلين"}</option>
              {patientOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            {!hasPatients && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
                لا توجد مرضى مسجلين. أضف مريضاً من شاشة المرضى أولاً.
              </div>
            )}
          </Field>
          <Field label="طريقة الدفع">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">نقدي</option>
              <option value="card">شبكة</option>
              <option value="installments">أقساط</option>
              <option value="transfer">تحويل</option>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="الخصم"><Input dir="ltr" type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
          <Field label="المبلغ المدفوع"><Input dir="ltr" type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
          <div className="space-y-2 rounded-xl2 bg-primary p-4 text-white">
            <div className="flex justify-between text-sm"><span>الإجمالي الفرعي</span><b>{fmtMoney(subtotal)}</b></div>
            <div className="flex justify-between text-sm"><span>الإجمالي النهائي</span><b className="text-accent">{fmtMoney(total)}</b></div>
            <div className="flex justify-between text-sm"><span>المتبقي</span><b className={remaining > 0 ? "text-red-300" : "text-emerald-300"}>{fmtMoney(remaining)}</b></div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-4">
          <button type="button" onClick={onClose} className="btn-outline-danger">إلغاء</button>
          <button type="button" onClick={save} disabled={!canSaveInvoice} className="btn-accent disabled:cursor-not-allowed disabled:opacity-50">
            <i className="fa-solid fa-floppy-disk" /> حفظ الفاتورة
          </button>
        </div>
      </div>
    </Modal>
  );
}
