"use client";
import React, { useState, useEffect } from "react";
import { Card, Badge, Modal, Field, Input, Select, EmptyRow } from "@/components/ui";
import { seedProducts, catAr } from "@/lib/data";
import { fetchCollection, saveSingleItem, deleteSingleItem } from "@/lib/api";
import { fmtMoney } from "@/lib/utils";

const EMPTY_FORM = { name: "", barcode: "", cat: "lenses", buy: "", sell: "", qty: "", min: 5, notes: "" };

const toNum = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

export default function Products() {
  const [list, setList] = useState(seedProducts);

  useEffect(() => {
    let ignore = false;
    fetchCollection("products", seedProducts).then((rows) => {
      if (!ignore) setList(rows);
    });
    return () => { ignore = true; };
  }, []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [f, setF] = useState(EMPTY_FORM);

  const openAdd = () => { setEditing(null); setF(EMPTY_FORM); setOpen(true); };
  const openEdit = (product) => {
    setEditing(product);
    setF({
      ...product,
      buy: String(product.buy ?? ""),
      sell: String(product.sell ?? ""),
      qty: String(product.qty ?? ""),
      min: String(product.min ?? 5),
    });
    setOpen(true);
  };
  const closeModal = () => { setOpen(false); setEditing(null); setF(EMPTY_FORM); };

  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    const payload = {
      id: editing ? editing.id : Date.now(),
      name: f.name.trim(),
      barcode: f.barcode,
      cat: f.cat,
      buy: toNum(f.buy),
      sell: toNum(f.sell),
      qty: toNum(f.qty),
      min: toNum(f.min),
      notes: f.notes,
    };

    const result = await saveSingleItem("products", payload);
    if (result) {
      setList((current) => editing ? current.map((item) => item.id === editing.id ? payload : item) : [...current, payload]);
    }
    closeModal();
  };

  const removeProduct = async (product) => {
    if (!window.confirm(`هل أنت متأكد من حذف المنتج "${product.name}"؟ لا يمكن التراجع!`)) return;
    const result = await deleteSingleItem("products", product.id);
    if (result !== null) {
      setList((current) => current.filter((x) => x.id !== product.id));
    }
  };

  const low = list.filter((p) => p.qty <= p.min);
  const lowValue = low.reduce((s, p) => s + (p.buy || 0) * (p.qty || 0), 0);
  const stockValue = list.reduce((s, p) => s + (p.buy || 0) * (p.qty || 0), 0);

  const cards = [
    { label: "عدد المنتجات", value: list.length, icon: "fa-boxes-stacked", c: "bg-purple-100 text-purple-600" },
    { label: "قيمة المنتجات المنخفضة", value: fmtMoney(lowValue), icon: "fa-triangle-exclamation", c: "bg-red-100 text-danger" },
    { label: "إجمالي قيمة المخزون", value: fmtMoney(stockValue), icon: "fa-vault", c: "bg-emerald-100 text-success" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="flex items-center gap-4 p-5">
            <span className={`flex h-12 w-12 items-center justify-center rounded-xl2 ${c.c}`}><i className={`fa-solid ${c.icon} text-xl`} /></span>
            <div><div className="text-xl font-black text-primary">{c.value}</div><div className="text-sm font-bold text-gray-500">{c.label}</div></div>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black text-primary">المنتجات والمخزون</h2>
        <button onClick={openAdd} className="btn-accent"><i className="fa-solid fa-plus" /> إضافة منتج</button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr><th className="th">اسم المنتج</th><th className="th">التصنيف</th><th className="th">سعر الشراء</th>
                <th className="th">سعر البيع</th><th className="th">الكمية</th><th className="th">حد التنبيه</th><th className="th">إجراءات</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {list.length === 0 && <EmptyRow span={7} />}
              {list.map((p) => (
                <tr key={p.id} className="hover:bg-accent-soft/40">
                  <td className="td font-bold text-gray-800">{p.name}<div className="text-[10px] text-gray-400" dir="ltr">{p.barcode}</div></td>
                  <td className="td"><Badge color="blue">{catAr[p.cat]}</Badge></td>
                  <td className="td">{fmtMoney(p.buy)}</td>
                  <td className="td font-bold text-success">{fmtMoney(p.sell)}</td>
                  <td className="td">
                    <Badge color={p.qty <= p.min ? "red" : "green"}>
                      {p.qty <= p.min && <i className="fa-solid fa-triangle-exclamation" />} {p.qty}
                    </Badge>
                  </td>
                  <td className="td text-gray-500">{p.min}</td>
                  <td className="td">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(p)} className="icon-btn text-info hover:bg-info hover:text-white"><i className="fa-solid fa-pen" /></button>
                      <button className="icon-btn text-danger hover:bg-danger hover:text-white" onClick={() => removeProduct(p)}><i className="fa-solid fa-trash" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {open && (
        <Modal open onClose={closeModal} title={editing ? "تعديل منتج" : "إضافة منتج جديد"}>
          <form className="space-y-4" onSubmit={submit}>
            <Field label="اسم المنتج" required><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="الباركود"><Input dir="ltr" value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} /></Field>
              <Field label="التصنيف">
                <Select value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })}>
                  <option value="lenses">عدسات</option><option value="frames">إطارات</option>
                  <option value="medical_glasses">نظارات طبية</option><option value="accessories">إكسسوارات</option>
                  <option value="other">أخرى</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="سعر الشراء"><Input dir="ltr" type="number" min="0" value={f.buy} onChange={(e) => setF({ ...f, buy: e.target.value })} /></Field>
              <Field label="سعر البيع"><Input dir="ltr" type="number" min="0" value={f.sell} onChange={(e) => setF({ ...f, sell: e.target.value })} /></Field>
              <Field label="الكمية"><Input dir="ltr" type="number" min="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
            </div>
            <Field label="حد التنبيه (الحد الأدنى للمخزون)"><Input dir="ltr" type="number" min="0" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
            <Field label="ملاحظات"><textarea className="input min-h-16" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button type="button" onClick={closeModal} className="btn-outline-danger">إلغاء</button>
              <button type="submit" className="btn-accent"><i className="fa-solid fa-floppy-disk" /> {editing ? "حفظ التعديلات" : "حفظ"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
