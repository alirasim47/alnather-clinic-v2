"use client";
import React, { useEffect, useState } from "react";
import { Badge, Card, EmptyRow, Field, Input, Modal } from "@/components/ui";
import { deleteSingleItem, fetchCollection, saveSingleItem } from "@/lib/api";

const EMPTY = { name: "", code: "", phone: "", address: "", active: true };

export default function Branches({ can }) {
  const allowed = (id) => typeof can !== "function" || can(id);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const result = await fetchCollection("branches", []);
      setRows(Array.isArray(result) ? result : []);
    } catch (e) { setError(e.message || "تعذر تحميل الفروع."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const openNew = () => { setEditing(null); setForm(EMPTY); setError(""); setOpen(true); };
  const openExisting = (row) => { setEditing(row); setForm({ ...EMPTY, ...row }); setError(""); setOpen(true); };

  const save = async (event) => {
    event.preventDefault();
    if (saving || !allowed(editing ? "branches.update" : "branches.create")) return;
    setSaving(true); setError("");
    try {
      const payload = { ...(editing || {}), ...form, name: form.name.trim(), code: form.code.trim().toUpperCase(), phone: form.phone.trim(), address: form.address.trim() };
      if (!payload.name || !/^[A-Z0-9_-]{2,30}$/.test(payload.code)) throw new Error("أدخل اسم الفرع ورمزًا من حرفين على الأقل، باستخدام الحروف أو الأرقام.");
      await saveSingleItem("branches", payload);
      setOpen(false); setNotice(editing ? "تم تحديث بيانات الفرع." : "تمت إضافة الفرع."); await load();
    } catch (e) { setError(e.message || "تعذر حفظ الفرع."); }
    finally { setSaving(false); }
  };
  const disable = async (row) => {
    if (!allowed("branches.delete") || !window.confirm(`تعطيل فرع «${row.name}»؟ ستبقى سجلاته محفوظة.`)) return;
    try { await deleteSingleItem("branches", row.id); setNotice("تم تعطيل الفرع مع الاحتفاظ بسجلاته."); await load(); }
    catch (e) { setError(e.message || "تعذر تعطيل الفرع."); }
  };

  return <div className="space-y-5" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-primary">فروع العيادة</h2><p className="mt-1 text-sm text-gray-500">إدارة مواقع العمل مع الاحتفاظ بسجلات كل فرع.</p></div>{allowed("branches.create") && <button type="button" onClick={openNew} className="btn-accent"><i className="fa-solid fa-plus" /> إضافة فرع</button>}</div>
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</div>}
    {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800"><span>{error}</span><button type="button" className="underline" onClick={load}>إعادة المحاولة</button></div>}
    <Card><div className="overflow-x-auto"><table className="w-full min-w-[720px]"><thead className="bg-gray-50"><tr><th className="th">الفرع</th><th className="th">الرمز</th><th className="th">الهاتف</th><th className="th">العنوان</th><th className="th">الحالة</th><th className="th">إجراءات</th></tr></thead><tbody className="divide-y divide-gray-50">{loading ? <tr><td colSpan={6} className="py-10 text-center text-gray-500">جارٍ تحميل الفروع…</td></tr> : rows.length === 0 ? <EmptyRow span={6} text="لا توجد فروع مسجلة." /> : rows.map((row) => <tr key={row.id} className="hover:bg-gray-50"><td className="td font-bold">{row.name}</td><td className="td" dir="ltr">{row.code}</td><td className="td" dir="ltr">{row.phone || "—"}</td><td className="td">{row.address || "—"}</td><td className="td"><Badge color={row.active ? "green" : "gray"}>{row.active ? "فعال" : "موقوف"}</Badge></td><td className="td"><div className="flex gap-1">{allowed("branches.update") && <button className="icon-btn text-info hover:bg-info hover:text-white" aria-label={`تعديل ${row.name}`} onClick={() => openExisting(row)}><i className="fa-solid fa-pen" /></button>}{row.active && allowed("branches.delete") && <button className="icon-btn text-danger hover:bg-danger hover:text-white" aria-label={`تعطيل ${row.name}`} onClick={() => disable(row)}><i className="fa-solid fa-ban" /></button>}</div></td></tr>)}</tbody></table></div></Card>
    {open && <Modal open onClose={() => !saving && setOpen(false)} title={editing ? "تعديل فرع" : "إضافة فرع"}><form className="space-y-4" onSubmit={save}><Field label="اسم الفرع" required><Input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="رمز الفرع" required><Input required dir="ltr" maxLength={30} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MAIN" /></Field><Field label="رقم الهاتف"><Input dir="ltr" maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field><Field label="العنوان"><Input maxLength={240} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>{editing && <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> الفرع فعال</label>}{error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}<div className="flex justify-end gap-3 border-t pt-4"><button type="button" className="btn-outline-danger" onClick={() => setOpen(false)}>إلغاء</button><button disabled={saving} className="btn-accent">{saving ? "جارٍ الحفظ…" : "حفظ الفرع"}</button></div></form></Modal>}
  </div>;
}
