"use client";
import React, { useState, useEffect, useMemo } from "react";
import { Card, Field, Input, EmptyRow } from "@/components/ui";
import { seedPatients, seedExams, seedInvoices } from "@/lib/data";
import { fetchCollection } from "@/lib/api";
import { fmtMoney, fmtDate, todayISO } from "@/lib/utils";

export default function Reports() {
  const [patients, setPatients] = useState(seedPatients);
  const [exams, setExams] = useState(seedExams);
  const [invoices, setInvoices] = useState(seedInvoices);

  const today = todayISO();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      const [p, e, i] = await Promise.all([
        fetchCollection("patients", seedPatients),
        fetchCollection("exams", seedExams),
        fetchCollection("invoices", seedInvoices),
      ]);
      if (!ignore) {
        setPatients(Array.isArray(p) ? p : seedPatients);
        setExams(Array.isArray(e) ? e : seedExams);
        setInvoices(Array.isArray(i) ? i : seedInvoices);
      }
    };
    load();
    return () => { ignore = true; };
  }, []);

  const inRange = (d) => (!from || String(d || "") >= from) && (!to || String(d || "") <= to);
  const ex = useMemo(() => exams.filter((e) => inRange(e.date)), [exams, from, to]);
  const inv = useMemo(() => invoices.filter((i) => inRange(i.date)), [invoices, from, to]);

  const totalRev = inv.reduce((s, i) => s + (i.total || 0), 0) + ex.reduce((s, e) => s + (e.price || 0), 0);
  const totalPaid = inv.reduce((s, i) => s + (i.paid || 0), 0);
  const totalRem = inv.reduce((s, i) => s + ((i.total || 0) - (i.paid || 0)), 0);

  const exportCsv = () => {
    const header = ["رقم الفاتورة", "التاريخ", "المريض", "الإجمالي", "المدفوع", "المتبقي"];
    const rows = inv.map((i) => [
      i.no,
      i.date,
      patients.find((p) => p.id === i.patientId)?.name || "عميل نقدي",
      i.total || 0,
      i.paid || 0,
      (i.total || 0) - (i.paid || 0),
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `report-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="من تاريخ"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="إلى تاريخ"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="flex flex-wrap items-center gap-3 lg:col-span-2 lg:justify-end">
          <button onClick={() => window.print()} className="btn-ghost"><i className="fa-solid fa-print" /> طباعة</button>
          <button onClick={() => window.print()} className="btn-blue"><i className="fa-solid fa-file-pdf" /> PDF</button>
          <button onClick={exportCsv} className="btn-green"><i className="fa-solid fa-file-excel" /> Excel</button>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <Card className="p-5 text-center">
          <div className="text-3xl font-black text-primary">{fmtMoney(totalRev)}</div>
          <div className="mt-1 text-sm font-bold text-gray-500">إجمالي الإيرادات</div>
        </Card>
        <Card className="p-5 text-center">
          <div className="text-3xl font-black text-success">{fmtMoney(totalPaid)}</div>
          <div className="mt-1 text-sm font-bold text-gray-500">المبالغ المحصلة</div>
        </Card>
        <Card className="p-5 text-center">
          <div className="text-3xl font-black text-info">{ex.length}</div>
          <div className="mt-1 text-sm font-bold text-gray-500">عدد الفحوصات</div>
        </Card>
      </div>

      <Card>
        <div className="border-b border-gray-100 px-5 py-4">
          <h3 className="font-extrabold text-primary">
            <i className="fa-solid fa-table ml-2 text-accent" />تفاصيل الفترة ({fmtDate(from)} — {fmtDate(to)})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="th">رقم الفاتورة</th><th className="th">التاريخ</th><th className="th">المريض</th>
                <th className="th">الإجمالي</th><th className="th">المدفوع</th><th className="th">المتبقي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {inv.length === 0 && <EmptyRow span={6} text="لا توجد فواتير ضمن هذه الفترة" />}
              {inv.map((i) => (
                <tr key={i.id} className="hover:bg-accent-soft/40">
                  <td className="td font-bold">{i.no}</td>
                  <td className="td">{fmtDate(i.date)}</td>
                  <td className="td">{patients.find((p) => p.id === i.patientId)?.name || "عميل نقدي"}</td>
                  <td className="td">{fmtMoney(i.total)}</td>
                  <td className="td text-success">{fmtMoney(i.paid)}</td>
                  <td className="td text-danger">{fmtMoney((i.total || 0) - (i.paid || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap justify-end gap-6 border-t border-gray-100 px-5 py-4 text-sm font-black">
          <span className="text-gray-600">الإجمالي: <b className="text-primary">{fmtMoney(totalRev)}</b></span>
          <span className="text-gray-600">المحصل: <b className="text-success">{fmtMoney(totalPaid)}</b></span>
          <span className="text-gray-600">المتبقي: <b className="text-danger">{fmtMoney(totalRem)}</b></span>
        </div>
      </Card>
    </div>
  );
}
