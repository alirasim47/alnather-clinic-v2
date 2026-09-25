"use client";
import React, { useState, useEffect } from "react";
import { Card, Toggle, Badge, Modal, Field, Input, Select, EmptyRow } from "@/components/ui";
import { seedExaminers } from "@/lib/data";
import { fetchCollection, saveSingleItem, deleteSingleItem } from "@/lib/api";

const defaultForm = { name: "", phone: "", role: "أخصائي بصريات", active: true };

export default function Examiners() {
  const [list, setList] = useState(seedExaminers);

  useEffect(() => {
    let ignore = false;
    fetchCollection("examiners", seedExaminers).then((rows) => {
      if (!ignore) setList(rows);
    });
    return () => { ignore = true; };
  }, []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [f, setF] = useState(defaultForm);

  const openAdd = () => { setEditing(null); setF(defaultForm); setOpen(true); };
  const openEdit = (item) => { setEditing(item); setF({ name: item.name, phone: item.phone, role: item.role, active: item.active }); setOpen(true); };
  const close = () => { setOpen(false); setEditing(null); setF(defaultForm); };

  const submit = async (e) => {
    e.preventDefault();
    const clean = { ...f, name: f.name.trim(), phone: f.phone.trim() };
    if (!clean.name) return;

    if (editing) {
      const payload = { ...editing, ...clean };
      const result = await saveSingleItem("examiners", payload);
      if (result) setList((current) => current.map((item) => item.id === editing.id ? payload : item));
    } else {
      const payload = { id: Date.now(), ...clean, active: true };
      const result = await saveSingleItem("examiners", payload);
      if (result) setList((current) => [...current, payload]);
    }
    close();
  };

  const toggleActive = async (item, v) => {
    const payload = { ...item, active: v };
    const result = await saveSingleItem("examiners", payload);
    if (result) {
      setList((current) => current.map((i) => (i.id === item.id ? payload : i)));
    }
  };

  const removeExaminer = async (item) => {
    if (!window.confirm(`هل أنت متأكد من حذف الفاحص "${item.name}"؟ لا يمكن التراجع!`)) return;
    const result = await deleteSingleItem("examiners", item.id);
    if (result !== null) setList((current) => current.filter((i) => i.id !== item.id));
  };

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2 text-primary font-black text-lg">
            <i className="fa-solid fa-user-doctor text-accent" />
            <span>قائمة الفاحصين والكادر الطبي</span>
          </div>
          <button onClick={openAdd} className="btn-accent"><i className="fa-solid fa-plus" /> إضافة فاحص</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr><th className="th">اسم الفاحص</th><th className="th">الجوال</th><th className="th">المسمى الوظيفي</th><th className="th">الحالة</th><th className="th">إجراءات</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {list.length === 0 && <EmptyRow span={5} />}
              {list.map((x) => (
                <tr key={x.id} className="hover:bg-accent-soft/40">
                  <td className="td font-bold text-gray-800"><i className="fa-solid fa-user-doctor ml-2 text-primary" />{x.name}</td>
                  <td className="td" dir="ltr">{x.phone}</td>
                  <td className="td"><Badge color="blue">{x.role}</Badge></td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <Toggle on={x.active} onChange={(v) => toggleActive(x, v)} />
                      <span className={`text-xs font-bold ${x.active ? "text-success" : "text-gray-400"}`}>{x.active ? "نشط" : "موقوف"}</span>
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(x)} className="icon-btn text-info hover:bg-info hover:text-white"><i className="fa-solid fa-pen" /></button>
                      <button className="icon-btn text-danger hover:bg-danger hover:text-white" onClick={() => removeExaminer(x)}>
                        <i className="fa-solid fa-trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {open && (
        <Modal open onClose={close} title={editing ? "تعديل بيانات الفاحص" : "إضافة فاحص جديد"}>
          <form className="space-y-4" onSubmit={submit}>
            <Field label="اسم الفاحص" required><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="رقم الجوال"><Input dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="المسمى الوظيفي">
              <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                <option>أخصائي بصريات</option><option>طبيب عيون</option><option>فني بصريات</option>
              </Select>
            </Field>
            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <span className="font-bold text-gray-700">الحالة</span>
              <Toggle on={f.active} onChange={(v) => setF({ ...f, active: v })} />
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button type="button" onClick={close} className="btn-outline-danger">إلغاء</button>
              <button type="submit" className="btn-accent"><i className="fa-solid fa-floppy-disk" /> {editing ? "حفظ التعديلات" : "حفظ"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
