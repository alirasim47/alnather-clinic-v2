"use client";
import React, { useEffect, useState } from "react";
import { Badge, Card, EmptyRow, Field, Input, Modal, Select } from "@/components/ui";
import { deleteSingleItem, fetchCollection, saveSingleItem } from "@/lib/api";
import { fmtMoney } from "@/lib/utils";

const EMPTY_FORM = { brand: "", sku: "", type: "spherical", side: "pair", sph: "", cyl: "", axis: "", add: "", material: "", refractiveIndex: "", coating: "", diameter: "", minimumQuantity: "0", quantity: "", unitCost: "", sell: "", branchId: "", active: true };
const TYPE_LABELS = { spherical: "كروية", toric: "استجماتزم", multifocal: "متعددة البؤر", contact: "لاصقة", other: "أخرى" };
const numberOrZero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const isLowStock = (row) => Number(row.quantity ?? 0) <= Number(row.minimumQuantity ?? 0);

export default function LensInventory({ can, currentUser }) {
  const allowed = (permission) => typeof can !== "function" || can(permission);
  const canView = allowed("lensInventory.view");
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState(null);
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = async (showLoading = false) => {
    if (!canView) return;
    if (showLoading) setLoading(true);
    let apiError = "";
    const captureError = (event) => { apiError = event.detail || "تعذر جلب البيانات من الخادم."; };
    if (typeof window !== "undefined") window.addEventListener("clinic-api-error", captureError);
    try {
      const [nextRows, nextBranches] = await Promise.all([
        fetchCollection("lensInventory", []),
        fetchCollection("branches", []),
      ]);
      setRows(Array.isArray(nextRows) ? nextRows : []);
      setBranches(Array.isArray(nextBranches) ? nextBranches : []);
      setLoadError(apiError);
    } catch (error) {
      setLoadError(error?.message || "تعذر تحميل مخزون العدسات.");
    } finally {
      if (typeof window !== "undefined") window.removeEventListener("clinic-api-error", captureError);
      if (showLoading) setLoading(false);
    }
  };
  useEffect(() => {
    load(true);
    const refresh = (event) => {
      if (event.detail?.collection === "lensInventory") load(false);
    };
    window.addEventListener("clinic-data-updated", refresh);
    return () => window.removeEventListener("clinic-data-updated", refresh);
  }, []);

  const openAdd = () => { setEditing(null); setForm({ ...EMPTY_FORM, branchId: currentUser?.branchId || branches[0]?.id || "" }); setNotice(null); setOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({ ...EMPTY_FORM, ...row, sph: row.sph ?? "", cyl: row.cyl ?? "", axis: row.axis ?? "", add: row.add ?? "", diameter: row.diameter ?? "", refractiveIndex: row.refractiveIndex ?? "", minimumQuantity: String(row.minimumQuantity ?? 0), quantity: String(row.quantity ?? ""), unitCost: String(row.unitCost ?? ""), sell: String(row.sell ?? ""), branchId: row.branchId ?? "" });
    setNotice(null);
    setOpen(true);
  };
  const closeModal = () => { if (!saving) { setOpen(false); setEditing(null); } };
  const save = async (event) => {
    event.preventDefault();
    const permission = editing ? "lensInventory.update" : "lensInventory.create";
    if (!allowed(permission)) return;
    const quantity = Number(form.quantity);
    const unitCost = Number(form.unitCost);
    const sell = Number(form.sell);
    if (!Number.isFinite(quantity) || quantity < 0 || (!editing && quantity === 0)) { setNotice({ type: "error", text: editing ? "أدخل كمية صفرًا أو أكثر." : "أدخل كمية أكبر من صفر." }); return; }
    if (!form.branchId && !currentUser?.branchId && !branches.length) { setNotice({ type: "error", text: "أضف فرعًا فعالًا قبل تسجيل مخزون العدسات." }); return; }
    if (!Number.isFinite(unitCost) || unitCost < 0 || !Number.isFinite(sell) || sell < 0) { setNotice({ type: "error", text: "أدخل كلفة وسعر بيع صالحين، ولا تقبل القيم السالبة." }); return; }
    setSaving(true);
    setNotice(null);
    try {
      const record = {
        ...(editing || {}),
        brand: form.brand.trim(), sku: form.sku.trim(), type: form.type, side: form.side,
        sph: form.sph === "" ? null : numberOrZero(form.sph),
        cyl: form.cyl === "" ? null : numberOrZero(form.cyl),
        axis: form.axis === "" ? null : numberOrZero(form.axis),
        add: form.add === "" ? null : numberOrZero(form.add),
        material: form.material.trim(), coating: form.coating.trim(),
        diameter: form.diameter === "" ? null : numberOrZero(form.diameter),
        refractiveIndex: form.refractiveIndex === "" ? null : numberOrZero(form.refractiveIndex),
        minimumQuantity: form.minimumQuantity === "" ? 0 : numberOrZero(form.minimumQuantity),
        quantity, unitCost, sell,
        branchId: form.branchId || null,
        active: form.active !== false,
      };
      if (!record.brand) throw new Error("أدخل اسم العلامة أو الشركة المصنّعة.");
      const saved = await saveSingleItem("lensInventory", record);
      if (!saved) throw new Error("لم يؤكد الخادم حفظ سجل العدسة.");
      setOpen(false);
      setEditing(null);
      setNotice({ type: "success", text: editing ? "تم تحديث سجل العدسة." : "تمت إضافة رصيد العدسة." });
      await load(false);
    } catch (error) {
      setNotice({ type: "error", text: error?.message || "تعذر حفظ سجل العدسة." });
    } finally { setSaving(false); }
  };
  const remove = async (row) => {
    if (!allowed("lensInventory.delete") || !window.confirm(`تأكيد حذف سجل العدسة «${row.brand || "بدون علامة"}»؟`)) return;
    setBusyId(row.id);
    setNotice(null);
    try {
      const result = await deleteSingleItem("lensInventory", row.id);
      if (result === false) throw new Error("لم يعثر الخادم على سجل العدسة المطلوب.");
      setNotice({ type: "success", text: "تم حذف سجل العدسة." });
      await load(false);
    } catch (error) { setNotice({ type: "error", text: error?.message || "تعذر حذف سجل العدسة." }); }
    finally { setBusyId(null); }
  };

  const filtered = rows.filter((row) => {
    const q = query.trim().toLowerCase();
    const matchesText = !q || [row.brand, row.sku, row.material, row.coating, TYPE_LABELS[row.type] || row.type, row.sph, row.cyl, row.axis, row.add].some((value) => String(value ?? "").toLowerCase().includes(q));
    const matchesStock = stockFilter === "all" || (stockFilter === "low" ? isLowStock(row) : !isLowStock(row));
    return matchesText && matchesStock && (branchFilter === "all" || String(row.branchId || "") === branchFilter) && row.active !== false;
  });
  const activeRows = rows.filter((row) => row.active !== false);
  const lowStockCount = activeRows.filter(isLowStock).length;
  const stockValue = activeRows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.unitCost || 0), 0);
  if (!canView) return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">لا تملك صلاحية عرض مخزون العدسات.</div>;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-xl font-black text-primary">مخزون العدسات بالقياس</h2><p className="mt-1 text-sm text-gray-500">تابع الأرصدة والقياسات لكل فرع.</p></div>
        {allowed("lensInventory.create") && <button type="button" onClick={openAdd} className="btn-accent"><i className="fa-solid fa-plus" aria-hidden="true" /> إضافة رصيد عدسات</button>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4"><div className="text-xs font-bold text-gray-500">أصناف العدسات النشطة</div><div className="mt-1 text-2xl font-black text-primary">{activeRows.length}</div></Card>
        <Card className="p-4"><div className="text-xs font-bold text-gray-500">منخفضة أو نافدة</div><div className={`mt-1 text-2xl font-black ${lowStockCount ? "text-danger" : "text-success"}`}>{lowStockCount}</div></Card>
        <Card className="p-4"><div className="text-xs font-bold text-gray-500">قيمة الرصيد بسعر الكلفة</div><div className="mt-1 text-lg font-black text-primary">{fmtMoney(stockValue)}</div></Card>
      </div>
      {notice && <div role={notice.type === "error" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm font-bold ${notice.type === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{notice.text}</div>}
      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{loadError}</span><button type="button" onClick={() => load(true)} className="font-bold underline">إعادة المحاولة</button></div>}
      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="بحث عن الصنف أو الدرجة"><Input aria-label="بحث عن الصنف أو الدرجة" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="رمز، علامة، SPH، CYL، AXIS أو ADD" /></Field>
        <Field label="الفرع"><Select aria-label="تصفية حسب الفرع" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="all">كل الفروع</option>{branches.map((branch) => <option key={branch.id} value={String(branch.id)}>{branch.name}</option>)}</Select></Field>
        <Field label="حالة المخزون"><Select aria-label="تصفية حسب حالة مخزون العدسة" value={stockFilter} onChange={(event) => setStockFilter(event.target.value)}><option value="all">كل الأرصدة</option><option value="low">منخفض أو نافد</option><option value="available">متوفر</option></Select></Field>
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1240px]">
            <thead className="bg-gray-50"><tr><th className="th">الرمز / العلامة</th><th className="th">النوع / الجهة</th><th className="th">SPH</th><th className="th">CYL</th><th className="th">AXIS</th><th className="th">ADD</th><th className="th">المواصفة</th><th className="th">الرصيد / التنبيه</th><th className="th">كلفة الوحدة</th><th className="th">سعر البيع</th><th className="th">الفرع</th><th className="th">إجراءات</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? <tr><td colSpan={12} className="py-10 text-center text-sm text-gray-500"><i className="fa-solid fa-spinner fa-spin ml-2" aria-hidden="true" />جارٍ تحميل أرصدة العدسات…</td></tr> : filtered.length === 0 ? <EmptyRow span={12} text={rows.length ? "ماكو نتائج تطابق البحث" : "ماكو أرصدة عدسات مسجلة بعد"} /> : filtered.map((row) => (
                <tr key={row.id} className="hover:bg-accent-soft/40"><td className="td font-bold">{row.sku && <div className="font-mono text-xs text-gray-500">{row.sku}</div>}{row.brand || "—"}</td><td className="td"><Badge color="blue">{TYPE_LABELS[row.type] || row.type || "—"}</Badge><div className="mt-1 text-xs text-gray-500">{row.side === "right" ? "يمين" : row.side === "left" ? "يسار" : "زوج"}</div></td><td className="td" dir="ltr">{row.sph ?? "—"}</td><td className="td" dir="ltr">{row.cyl ?? "—"}</td><td className="td" dir="ltr">{row.axis ?? "—"}</td><td className="td" dir="ltr">{row.add ?? "—"}</td><td className="td">{[row.material, row.refractiveIndex && `Index ${row.refractiveIndex}`, row.coating, row.diameter && `${row.diameter} مم`].filter(Boolean).join(" · ") || "—"}</td><td className="td"><Badge color={isLowStock(row) ? "red" : "green"}>{row.quantity ?? 0}</Badge><div className="mt-1 text-xs text-gray-500">حد التنبيه: {row.minimumQuantity ?? 0}</div></td><td className="td">{fmtMoney(row.unitCost)}</td><td className="td font-bold text-success">{fmtMoney(row.sell)}</td><td className="td">{branches.find((branch) => String(branch.id) === String(row.branchId))?.name || "—"}</td><td className="td"><div className="flex gap-1">{allowed("lensInventory.update") && <button type="button" className="icon-btn text-info hover:bg-info hover:text-white" aria-label={`تعديل سجل ${row.brand || "العدسة"}`} onClick={() => openEdit(row)}><i className="fa-solid fa-pen" aria-hidden="true" /></button>}{allowed("lensInventory.delete") && <button type="button" className="icon-btn text-danger hover:bg-danger hover:text-white disabled:opacity-50" aria-label={`حذف سجل ${row.brand || "العدسة"}`} disabled={busyId === row.id} onClick={() => remove(row)}><i className="fa-solid fa-trash" aria-hidden="true" /></button>}</div></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {open && allowed(editing ? "lensInventory.update" : "lensInventory.create") && <Modal open onClose={closeModal} title={editing ? "تعديل سجل العدسة" : "إضافة رصيد عدسات"}>
        <form className="space-y-4" onSubmit={save}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="العلامة أو الشركة المصنّعة" required><Input id="lens-brand" aria-label="العلامة أو الشركة المصنّعة" required value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></Field><Field label="الرمز / SKU أو الباركود"><Input id="lens-sku" aria-label="الرمز أو الباركود" value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></Field><Field label="نوع العدسة" required><Select id="lens-type" aria-label="نوع العدسة" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="spherical">كروية</option><option value="toric">استجماتزم</option><option value="multifocal">متعددة البؤر</option><option value="contact">لاصقة</option><option value="other">أخرى</option></Select></Field><Field label="الجهة / الوحدة"><Select id="lens-side" aria-label="الجهة أو الوحدة" value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value })}><option value="pair">زوج / أي جهة</option><option value="right">يمين (OD)</option><option value="left">يسار (OS)</option></Select></Field></div>
          <div className="rounded-xl border border-purple-100 bg-purple-50/60 p-4"><div className="mb-3 text-sm font-extrabold text-primary">الدرجة البصرية</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Field label="SPH"><Input id="lens-sph" aria-label="قياس SPH" dir="ltr" type="number" min="-30" max="30" step="0.25" value={form.sph} onChange={(event) => setForm({ ...form, sph: event.target.value })} /></Field><Field label="CYL"><Input id="lens-cyl" aria-label="قياس CYL" dir="ltr" type="number" min="-20" max="20" step="0.25" value={form.cyl} onChange={(event) => setForm({ ...form, cyl: event.target.value })} /></Field><Field label="AXIS"><Input id="lens-axis" aria-label="محور العدسة AXIS" dir="ltr" type="number" min="0" max="180" step="1" value={form.axis} onChange={(event) => setForm({ ...form, axis: event.target.value })} /></Field><Field label="ADD"><Input id="lens-add" aria-label="درجة الإضافة ADD" dir="ltr" type="number" min="0" max="15" step="0.25" value={form.add} onChange={(event) => setForm({ ...form, add: event.target.value })} /></Field></div><p className="mt-2 text-xs text-gray-500">تقبل SPH وCYL وADD خطوات 0.25؛ يجب إدخال AXIS عند وجود CYL غير صفري.</p></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="المادة"><Input id="lens-material" aria-label="مادة العدسة" placeholder="مثال: Polycarbonate" value={form.material} onChange={(event) => setForm({ ...form, material: event.target.value })} /></Field><Field label="معامل الانكسار"><Input id="lens-index" aria-label="معامل الانكسار" dir="ltr" type="number" min="1.4" max="2" step="0.01" value={form.refractiveIndex} onChange={(event) => setForm({ ...form, refractiveIndex: event.target.value })} /></Field><Field label="القطر (مم)"><Input id="lens-diameter" aria-label="قطر العدسة" dir="ltr" type="number" min="10" max="30" step="0.1" value={form.diameter} onChange={(event) => setForm({ ...form, diameter: event.target.value })} /></Field><Field label="المعالجة / الطلاء"><Input id="lens-coating" aria-label="معالجة أو طلاء العدسة" placeholder="مثال: مضاد انعكاس" value={form.coating} onChange={(event) => setForm({ ...form, coating: event.target.value })} /></Field></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="الكمية" required><Input type="number" min={editing ? "0" : "0.01"} step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="تنبيه عند الرصيد ≤"><Input type="number" min="0" step="0.01" value={form.minimumQuantity} onChange={(event) => setForm({ ...form, minimumQuantity: event.target.value })} /></Field><Field label="كلفة الوحدة" required><Input required dir="ltr" type="number" min="0" step="0.01" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} /></Field><Field label="سعر البيع" required><Input required dir="ltr" type="number" min="0" step="0.01" value={form.sell} onChange={(event) => setForm({ ...form, sell: event.target.value })} /></Field></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Field label="الكمية" required><Input id="lens-quantity" aria-label="كمية العدسات" required dir="ltr" type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="كلفة الوحدة" required><Input id="lens-cost" aria-label="كلفة وحدة العدسة" required dir="ltr" type="number" min="0" step="0.01" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} /></Field><Field label="سعر البيع" required><Input id="lens-sell" aria-label="سعر بيع العدسة" required dir="ltr" type="number" min="0" step="0.01" value={form.sell} onChange={(event) => setForm({ ...form, sell: event.target.value })} /></Field></div>
          <Field label="الفرع" required><Select required id="lens-branch" aria-label="فرع مخزون العدسة" value={form.branchId || currentUser?.branchId || ""} disabled={Boolean(currentUser?.branchId)} onChange={(event) => setForm({ ...form, branchId: event.target.value })}><option value="">اختر الفرع</option>{branches.filter((branch) => branch.active !== false).map((branch) => <option key={branch.id} value={String(branch.id)}>{branch.name}</option>)}</Select></Field>
          {notice?.type === "error" && <p role="alert" className="text-sm font-bold text-red-700">{notice.text}</p>}
          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4"><button type="button" onClick={closeModal} disabled={saving} className="btn-outline-danger">إلغاء</button><button type="submit" disabled={saving} className="btn-accent">{saving ? "جارٍ الحفظ…" : editing ? "حفظ التعديلات" : "حفظ الرصيد"}</button></div>
        </form>
      </Modal>}
    </div>
  );
}
