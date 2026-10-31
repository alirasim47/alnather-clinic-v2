"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Badge, Card, EmptyRow, Field, Input, Modal, Select } from "@/components/ui";
import { catAr } from "@/lib/data";
import { createStockBatch, deleteSingleItem, fetchCollection, saveSingleItem } from "@/lib/api";
import { fmtMoney } from "@/lib/utils";

const EMPTY = { name: "", barcode: "", cat: "frames", buy: "", sell: "", min: 5, imageUrl: "", notes: "", active: true };
const num = (value) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; };

export default function Products({ can, currentUser }) {
  const allowed = (permission) => typeof can !== "function" || can(permission);
  const [list, setList] = useState([]);
  const [movements, setMovements] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [stockForm, setStockForm] = useState({ productId: "", branchId: "", quantity: "", unitCost: "", reference: "", notes: "" });
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [products, stockMovements, branchRows] = await Promise.all([fetchCollection("products"), fetchCollection("stockMovements", []), fetchCollection("branches", [])]);
      setList(Array.isArray(products) ? products : []);
      setMovements(Array.isArray(stockMovements) ? stockMovements : []);
      setBranches(Array.isArray(branchRows) ? branchRows.filter((branch) => branch.active !== false) : []);
    } catch (e) { setError(e.message || "تعذر تحميل المنتجات والمخزون."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => list.filter((p) => !query || `${p.name} ${p.barcode || ""} ${catAr[p.cat] || p.cat || ""}`.toLowerCase().includes(query.toLowerCase())), [list, query]);
  const stockProducts = list.filter((p) => p.cat !== "services" && p.type !== "service" && p.trackStock !== false);
  const low = stockProducts.filter((p) => Number(p.qty || 0) <= Number(p.min || 0));
  const lowValue = low.reduce((sum, p) => sum + Number(p.buy || 0) * Number(p.qty || 0), 0);
  const stockValue = stockProducts.reduce((sum, p) => sum + Number(p.buy || 0) * Number(p.qty || 0), 0);
  const cards = [
    { label: "عدد المنتجات والخدمات", value: list.length, icon: "fa-boxes-stacked", color: "bg-purple-100 text-purple-700" },
    { label: "قيمة المخزون المنخفض — تقديرية", value: fmtMoney(lowValue), icon: "fa-triangle-exclamation", color: "bg-red-100 text-red-700" },
    { label: "قيمة المخزون — تقديرية", value: fmtMoney(stockValue), icon: "fa-vault", color: "bg-emerald-100 text-emerald-700" },
  ];

  const openAdd = () => { setEditing(null); setForm(EMPTY); setError(""); setOpen(true); };
  const openEdit = (product) => { setEditing(product); setForm({ ...EMPTY, ...product, buy: String(product.buy ?? ""), sell: String(product.sell ?? "") }); setError(""); setOpen(true); };
  const saveProduct = async (event) => {
    event.preventDefault();
    if (saving || !allowed(editing ? "products.update" : "products.create")) return;
    if (!form.name.trim()) { setError("أدخل اسم المنتج أو الخدمة."); return; }
    if (num(form.sell) < 0 || num(form.buy) < 0) { setError("الأسعار لا تقبل القيم السالبة."); return; }
    setSaving(true); setError("");
    try {
      const id = editing?.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const payload = {
        ...(editing || {}), id, name: form.name.trim(), barcode: form.barcode.trim(), cat: form.cat,
        buy: num(form.buy), sell: num(form.sell), min: num(form.min), imageUrl: form.imageUrl.trim(),
        notes: form.notes.trim(), active: form.active !== false,
        ...(editing ? {} : { qty: 0 }),
      };
      await saveSingleItem("products", payload);
      setOpen(false); setNotice(editing ? "تم تحديث بطاقة المنتج. لم تتغير تكلفة دفعات الشراء السابقة." : "تمت إضافة المنتج."); await load();
    } catch (e) { setError(e.message || "تعذر حفظ المنتج."); }
    finally { setSaving(false); }
  };

  const receiveStock = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!stockForm.productId || !stockForm.branchId && !currentUser?.branchId || num(stockForm.quantity) <= 0) { setError("اختر فرعًا ومنتجًا وأدخل كمية أكبر من صفر."); return; }
    setSaving(true); setError("");
    try {
      const result = await createStockBatch({ productId: stockForm.productId, branchId: stockForm.branchId || currentUser?.branchId || null, quantity: num(stockForm.quantity), unitCost: num(stockForm.unitCost), reference: stockForm.reference, notes: stockForm.notes });
      if (!result?.id) throw new Error("لم يؤكد الخادم تسجيل دفعة المخزون.");
      setStockOpen(false); setStockForm({ productId: "", branchId: "", quantity: "", unitCost: "", reference: "", notes: "" }); setNotice("تم تسجيل دفعة الاستلام بكلفتها."); await load();
    } catch (e) { setError(e.message || "تعذر تسجيل دفعة المخزون."); }
    finally { setSaving(false); }
  };

  const disableProduct = async (product) => {
    if (!allowed("products.delete") || !window.confirm(`تعطيل «${product.name}»؟ سيبقى سجل المبيعات محفوظًا.`)) return;
    try { await deleteSingleItem("products", product.id); setNotice("تم تعطيل المنتج."); await load(); }
    catch (e) { setError(e.message || "تعذر تعطيل المنتج."); }
  };

  return <div className="space-y-6" dir="rtl">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">{cards.map((c) => <Card key={c.label} className="flex items-center gap-4 p-5"><span className={`flex h-12 w-12 items-center justify-center rounded-xl2 ${c.color}`}><i className={`fa-solid ${c.icon} text-xl`} /></span><div><div className="text-xl font-black text-primary">{c.value}</div><div className="text-sm font-bold text-gray-500">{c.label}</div></div></Card>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-primary">المنتجات والمخزون</h2><p className="mt-1 text-sm text-gray-500">سجّل كل استلام بدفعة كلفة مستقلة؛ كمية البيع تُخصم خادميًا وفق FIFO.</p></div><div className="flex flex-wrap gap-2">{allowed("products.update") && list.some(p => p.active !== false) && <button type="button" onClick={() => { setStockForm({ productId: "", branchId: currentUser?.branchId || branches[0]?.id || "", quantity: "", unitCost: "", reference: "", notes: "" }); setError(""); setStockOpen(true); }} className="btn-blue"><i className="fa-solid fa-box-open" /> استلام مخزون</button>}{allowed("products.create") && <button type="button" onClick={openAdd} className="btn-accent"><i className="fa-solid fa-plus" /> إضافة صنف</button>}</div></div>
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</div>}
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800"><span>{error}</span><button type="button" className="underline" onClick={load}>إعادة المحاولة</button></div>}
    <Card className="p-4"><Field label="بحث بالاسم أو الباركود أو التصنيف"><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث عن منتج…" /></Field></Card>
    <Card><div className="overflow-x-auto"><table className="w-full min-w-[850px]"><thead className="bg-gray-50"><tr><th className="th">الصنف</th><th className="th">التصنيف</th><th className="th">كلفة مرجعية</th><th className="th">سعر البيع</th><th className="th">المتاح</th><th className="th">حد التنبيه</th><th className="th">الحالة</th><th className="th">إجراءات</th></tr></thead><tbody className="divide-y divide-gray-50">{loading ? <tr><td colSpan={8} className="py-10 text-center text-sm text-gray-500">جارٍ تحميل المنتجات…</td></tr> : visible.length === 0 ? <EmptyRow span={8} text="لا توجد أصناف مطابقة." /> : visible.map(p => <tr key={p.id} className="hover:bg-gray-50"><td className="td font-bold text-gray-800">{p.name}<div className="text-[10px] font-normal text-gray-400" dir="ltr">{p.barcode || ""}</div></td><td className="td"><Badge color="blue">{catAr[p.cat] || p.cat || "أخرى"}</Badge></td><td className="td">{fmtMoney(p.buy)}</td><td className="td font-bold text-emerald-700">{fmtMoney(p.sell)}</td><td className="td">{p.cat === "services" || p.type === "service" || p.trackStock === false ? <Badge color="blue">غير مخزني</Badge> : <Badge color={Number(p.qty) <= Number(p.min) ? "red" : "green"}>{p.qty ?? 0}{Number(p.qty) <= Number(p.min) && <i className="fa-solid fa-triangle-exclamation" />}</Badge>}</td><td className="td">{p.min ?? 0}</td><td className="td"><Badge color={p.active === false ? "gray" : "green"}>{p.active === false ? "موقوف" : "فعال"}</Badge></td><td className="td"><div className="flex gap-1">{allowed("products.update") && <button type="button" onClick={() => openEdit(p)} className="icon-btn text-info hover:bg-info hover:text-white" aria-label={`تعديل ${p.name}`}><i className="fa-solid fa-pen" /></button>}{p.active !== false && allowed("products.delete") && <button type="button" className="icon-btn text-danger hover:bg-danger hover:text-white" onClick={() => disableProduct(p)} aria-label={`تعطيل ${p.name}`}><i className="fa-solid fa-ban" /></button>}</div></td></tr>)}</tbody></table></div></Card>
    <Card><div className="border-b border-gray-100 px-5 py-4"><h3 className="font-extrabold text-primary"><i className="fa-solid fa-clock-rotate-left ml-2 text-accent" />أحدث حركات المخزون</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[700px]"><thead className="bg-gray-50"><tr><th className="th">التاريخ</th><th className="th">المنتج</th><th className="th">الفرع</th><th className="th">الحركة</th><th className="th">الكمية</th><th className="th">كلفة الوحدة</th><th className="th">مرجع</th></tr></thead><tbody className="divide-y divide-gray-50">{movements.length === 0 ? <EmptyRow span={7} text="لا توجد حركات مخزون مسجلة بعد." /> : movements.slice(0, 30).map(m => <tr key={m.id}><td className="td" dir="ltr">{String(m.createdAt || "").slice(0, 10)}</td><td className="td">{list.find(p => String(p.id) === String(m.productId))?.name || m.productId}</td><td className="td">{m.branchName || "—"}</td><td className="td">{{ opening:"رصيد افتتاحي", purchase:"استلام", sale:"بيع", return:"إرجاع", adjustment:"تسوية", transfer_out:"نقل صادر", transfer_in:"نقل وارد" }[m.type] || m.type}</td><td className={`td font-bold ${Number(m.quantityDelta) < 0 ? "text-red-700" : "text-emerald-700"}`} dir="ltr">{Number(m.quantityDelta) > 0 ? "+" : ""}{m.quantityDelta}</td><td className="td">{fmtMoney(m.unitCost)}</td><td className="td">{m.referenceId || "—"}</td></tr>)}</tbody></table></div></Card>
    {open && <Modal open onClose={() => !saving && setOpen(false)} title={editing ? "تعديل بطاقة الصنف" : "إضافة منتج أو خدمة"}><form className="space-y-4" onSubmit={saveProduct}><Field label="اسم المنتج أو الخدمة" required><Input required maxLength={140} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="باركود أو رمز"><Input dir="ltr" maxLength={80} value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} /></Field><Field label="التصنيف"><Select value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })}><option value="medical_glasses">نظارات طبية كاملة</option><option value="frames">إطارات</option><option value="lenses">عدسات طبية</option><option value="contact_lenses">عدسات لاصقة</option><option value="accessories">إكسسوارات</option><option value="services">خدمات / فحص</option><option value="other">أخرى</option></Select></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="كلفة مرجعية (للتقدير فقط)"><Input type="number" min="0" step="0.01" dir="ltr" value={form.buy} onChange={e => setForm({ ...form, buy: e.target.value })} /></Field><Field label="سعر البيع"><Input type="number" min="0" step="0.01" dir="ltr" value={form.sell} onChange={e => setForm({ ...form, sell: e.target.value })} /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="حد التنبيه"><Input type="number" min="0" step="0.01" dir="ltr" value={form.min} onChange={e => setForm({ ...form, min: e.target.value })} /></Field><Field label="رابط صورة اختياري"><Input type="url" dir="ltr" maxLength={1000} value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://…" /></Field></div><Field label="ملاحظات"><textarea className="input min-h-16" maxLength={1000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>{editing && <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.active !== false} onChange={e => setForm({ ...form, active: e.target.checked })} /> الصنف فعال</label>}{error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}<div className="flex justify-end gap-3 border-t pt-4"><button type="button" className="btn-outline-danger" onClick={() => setOpen(false)}>إلغاء</button><button disabled={saving} className="btn-accent">{saving ? "جارٍ الحفظ…" : "حفظ الصنف"}</button></div></form></Modal>}
    {stockOpen && <Modal open onClose={() => !saving && setStockOpen(false)} title="استلام دفعة مخزون"><form className="space-y-4" onSubmit={receiveStock}><Field label="الفرع" required><Select required value={stockForm.branchId} disabled={Boolean(currentUser?.branchId)} onChange={e=>setStockForm({...stockForm,branchId:e.target.value})}><option value="">اختر الفرع</option>{branches.map(branch=><option key={branch.id} value={String(branch.id)}>{branch.name}</option>)}</Select></Field><Field label="المنتج" required><Select required value={stockForm.productId} onChange={e => setStockForm({ ...stockForm, productId: e.target.value })}><option value="">اختر المنتج</option>{list.filter(p => p.active !== false && p.cat !== "services" && p.type !== "service" && p.trackStock !== false).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field><Field label="الكمية المستلمة" required><Input required type="number" min="0.01" step="0.01" dir="ltr" value={stockForm.quantity} onChange={e => setStockForm({ ...stockForm, quantity: e.target.value })} /></Field><Field label="كلفة الوحدة لهذه الدفعة" required><Input required type="number" min="0" step="0.01" dir="ltr" value={stockForm.unitCost} onChange={e => setStockForm({ ...stockForm, unitCost: e.target.value })} /></Field><Field label="مرجع شراء"><Input maxLength={80} value={stockForm.reference} onChange={e => setStockForm({ ...stockForm, reference: e.target.value })} /></Field><Field label="ملاحظات"><Input maxLength={300} value={stockForm.notes} onChange={e => setStockForm({ ...stockForm, notes: e.target.value })} /></Field><div className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900">تُخصم مبيعات المنتجات حسب أقدم دفعة، وتُحفظ كلفة البيع على الفاتورة حتى لا تتغير أرباح الماضي.</div>{error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}<div className="flex justify-end gap-3 border-t pt-4"><button type="button" className="btn-outline-danger" onClick={() => setStockOpen(false)}>إلغاء</button><button disabled={saving} className="btn-accent">{saving ? "جارٍ التسجيل…" : "تأكيد الاستلام"}</button></div></form></Modal>}
  </div>;
}
