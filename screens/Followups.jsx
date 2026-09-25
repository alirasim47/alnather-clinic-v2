"use client";
import React, { useState, useEffect } from "react";
import { Card, Modal, Badge, Field, Input, EmptyRow } from "@/components/ui";
import { seedFollowups, seedPatients } from "@/lib/data";
import { fetchCollection, saveSingleItem, deleteSingleItem } from "@/lib/api";
import { openWhatsApp, fmtDate, todayISO } from "@/lib/utils";

export default function Followups() {
  const [rows, setRows] = useState(seedFollowups);
  const [patients, setPatients] = useState(seedPatients);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      const [loadedFollowups, loadedPatients, loadedSettings] = await Promise.all([
        fetchCollection("followups", seedFollowups),
        fetchCollection("patients", seedPatients),
        fetchCollection("settings", {}),
      ]);
      if (!ignore) {
        setRows(Array.isArray(loadedFollowups) ? loadedFollowups : seedFollowups);
        setPatients(Array.isArray(loadedPatients) ? loadedPatients : seedPatients);
        setSettings(loadedSettings && typeof loadedSettings === "object" ? loadedSettings : {});
      }
    };
    load();
    return () => { ignore = true; };
  }, []);
  const [wa, setWa] = useState(null);
  const [waDate, setWaDate] = useState("");
  const [waTime, setWaTime] = useState("");

  const today = todayISO();
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const monthPrefix = today.slice(0, 7);
  const clinicName = settings.clinicName || "عيادة العلي";

  const pOf = (id) => patients.find((x) => x.id === id);
  const effStatus = (r) => (r.status === "pending" && r.date < today ? "overdue" : r.status);

  const metric = (fn) => rows.filter(fn).length;
  const cards = [
    { label: "مراجعات اليوم", value: metric((r) => r.date === today && effStatus(r) === "pending"), icon: "fa-calendar-day", c: "text-purple-600 bg-purple-100" },
    { label: "هذا الأسبوع", value: metric((r) => effStatus(r) === "pending" && r.date >= today && r.date <= weekEnd), icon: "fa-calendar-week", c: "text-info bg-blue-100" },
    { label: "هذا الشهر", value: metric((r) => String(r.date || "").startsWith(monthPrefix)), icon: "fa-calendar", c: "text-teal bg-teal-100" },
    { label: "متأخرة", value: metric((r) => effStatus(r) === "overdue"), icon: "fa-triangle-exclamation", c: "text-danger bg-red-100" },
  ];

  const markDone = async (id) => {
    const next = rows.map((r) => (r.id === id ? { ...r, status: "done" } : r));
    const updated = next.find((r) => r.id === id);
    if (updated) {
      const result = await saveSingleItem("followups", updated);
      if (result) setRows(next);
    }
  };

  const removeFollowup = async (r) => {
    if (!window.confirm(`هل أنت متأكد من حذف تنبيه المراجعة للمريض "${pOf(r.patientId)?.name || ""}"؟`)) return;
    const result = await deleteSingleItem("followups", r.id);
    if (result !== null) setRows((current) => current.filter((x) => x.id !== r.id));
  };

  const stBadge = (s) => s === "done" ? <Badge color="green">تم</Badge>
    : s === "overdue" ? <Badge color="red">متأخرة</Badge> : <Badge color="orange">قيد الانتظار</Badge>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="flex items-center gap-4 p-5">
            <span className={`flex h-12 w-12 items-center justify-center rounded-xl2 ${c.c}`}><i className={`fa-solid ${c.icon} text-xl`} /></span>
            <div><div className="text-2xl font-black text-primary">{c.value}</div><div className="text-sm font-bold text-gray-500">{c.label}</div></div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr><th className="th">التاريخ</th><th className="th">الوقت</th><th className="th">اسم المريض</th>
                <th className="th">الجوال</th><th className="th">الحالة</th><th className="th">ملاحظات</th><th className="th">إجراءات</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 && <EmptyRow span={7} />}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-accent-soft/40">
                  <td className="td font-bold">{fmtDate(r.date)}</td>
                  <td className="td" dir="ltr">{r.time}</td>
                  <td className="td font-bold text-gray-800">{pOf(r.patientId)?.name || "—"}</td>
                  <td className="td" dir="ltr">{pOf(r.patientId)?.phone1 || "—"}</td>
                  <td className="td">{stBadge(effStatus(r))}</td>
                  <td className="td max-w-40 truncate text-gray-500">{r.notes || "—"}</td>
                  <td className="td">
                    <div className="flex gap-1">
                      <button title="إرسال تذكير واتساب" className="icon-btn text-success hover:bg-success hover:text-white"
                        onClick={() => { setWa(r); setWaDate(r.date); setWaTime(r.time); }}>
                        <i className="fa-brands fa-whatsapp text-base" />
                      </button>
                      <button title="تحديد كمكتمل" className="icon-btn text-info hover:bg-info hover:text-white"
                        onClick={() => markDone(r.id)} disabled={r.status === "done"}>
                        <i className="fa-solid fa-check" />
                      </button>
                      <button title="حذف التنبيه" className="icon-btn text-danger hover:bg-danger hover:text-white" onClick={() => removeFollowup(r)}>
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

      {wa && (
        <Modal open onClose={() => setWa(null)} title="إرسال تذكير واتساب">
          <div className="space-y-4">
            <div className="rounded-lg bg-emerald-50 p-3 text-sm font-bold text-success">
              <i className="fa-brands fa-whatsapp ml-2" />سيتم إرسال رسالة تذكير إلى: {pOf(wa.patientId)?.name || "—"}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="تاريخ الموعد"><Input type="date" value={waDate} onChange={(e) => setWaDate(e.target.value)} /></Field>
              <Field label="وقت الموعد"><Input type="time" value={waTime} onChange={(e) => setWaTime(e.target.value)} /></Field>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button onClick={() => setWa(null)} className="btn-outline-danger">إلغاء</button>
              <button className="btn-green" onClick={() => {
                openWhatsApp({ phone: pOf(wa.patientId)?.phone1, name: pOf(wa.patientId)?.name, date: waDate, time: waTime, clinic: clinicName });
                setWa(null);
              }}>
                <i className="fa-brands fa-whatsapp" /> توليد الرسالة وإرسالها
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
