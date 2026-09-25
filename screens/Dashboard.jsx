"use client";

import React, { useEffect, useState } from "react";
import { Card, CardHeader, Badge } from "@/components/ui";
import { seedExams, seedInvoices, seedPatients, seedProducts } from "@/lib/data";
import { fetchCollection } from "@/lib/api";
import { fmtMoney, fmtDate, todayISO } from "@/lib/utils";

export default function Dashboard({ go }) {
  const [patients, setPatients] = useState(seedPatients);
  const [exams, setExams] = useState(seedExams);
  const [products, setProducts] = useState(seedProducts);
  const [invoices, setInvoices] = useState(seedInvoices);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      const [nextPatients, nextExams, nextProducts, nextInvoices] = await Promise.all([
        fetchCollection("patients", seedPatients),
        fetchCollection("exams", seedExams),
        fetchCollection("products", seedProducts),
        fetchCollection("invoices", seedInvoices),
      ]);
      if (!ignore) {
        setPatients(Array.isArray(nextPatients) ? nextPatients : seedPatients);
        setExams(Array.isArray(nextExams) ? nextExams : seedExams);
        setProducts(Array.isArray(nextProducts) ? nextProducts : seedProducts);
        setInvoices(Array.isArray(nextInvoices) ? nextInvoices : seedInvoices);
      }
    };
    load();
    const refresh = () => load();
    window.addEventListener("clinic-data-updated", refresh);
    return () => {
      ignore = true;
      window.removeEventListener("clinic-data-updated", refresh);
    };
  }, []);

  const pName = (id) => patients.find((p) => p.id === id)?.name || "—";

  const today = todayISO();
  const todayExams = exams.filter((e) => e.date === today);
  const lowStock = products.filter((p) => (p.quantity ?? p.qty ?? 0) <= (p.min_stock ?? p.min ?? 5));
  const todaySales = invoices
    .filter((i) => (i.issue_date || i.date) === today)
    .reduce((s, i) => s + (i.paid || 0), 0);
  const todayIncome = todaySales + todayExams.reduce((s, e) => s + (e.price || 0), 0);

  const stats = [
    {
      label: "فحوصات اليوم",
      value: todayExams.length,
      icon: "fa-file-medical",
      bg: "bg-purple-100",
      fg: "text-purple-600",
    },
    {
      label: "تنبيهات نقص المخزون",
      value: lowStock.length,
      icon: "fa-box-open",
      bg: "bg-blue-100",
      fg: "text-info",
    },
    {
      label: "مبيعات اليوم",
      value: fmtMoney(todaySales),
      icon: "fa-cart-shopping",
      bg: "bg-teal-100",
      fg: "text-teal",
    },
    {
      label: "إجمالي دخل اليوم",
      value: fmtMoney(todayIncome),
      icon: "fa-sack-dollar",
      bg: "bg-emerald-100",
      fg: "text-success",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card
            key={s.label}
            className="flex items-center gap-4 p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <span
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl2 ${s.bg} ${s.fg}`}
            >
              <i className={`fa-solid ${s.icon} text-2xl`} />
            </span>
            <div>
              <div className="text-2xl font-black text-primary">{s.value}</div>
              <div className="mt-0.5 text-sm font-bold text-gray-500">
                {s.label}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            icon={<i className="fa-solid fa-stethoscope" />}
            title="آخر الفحوصات"
            action={
              <button
                onClick={() => go("patients")}
                className="text-xs font-bold text-info hover:underline"
              >
                عرض الكل
              </button>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">اسم المريض</th>
                  <th className="th">الفاحص</th>
                  <th className="th">التاريخ</th>
                  <th className="th">السعر</th>
                  <th className="th">رقم الفاتورة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {exams.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="td py-10 text-center text-gray-400"
                    >
                      لا توجد فحوصات بعد
                    </td>
                  </tr>
                ) : (
                  exams.slice(0, 5).map((e) => (
                    <tr
                      key={e.id}
                      className="transition hover:bg-accent-soft/40"
                    >
                      <td className="td font-bold text-gray-800">
                        {pName(e.patientId || e.patient_id)}
                      </td>
                      <td className="td">{e.examinerName || "—"}</td>
                      <td className="td text-gray-500">{fmtDate(e.date)}</td>
                      <td className="td font-bold text-success">
                        {fmtMoney(e.price)}
                      </td>
                      <td className="td">
                        <Badge color="yellow">{e.invoiceNo || "—"}</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<i className="fa-solid fa-receipt" />}
            title="آخر الفواتير"
            action={
              <button
                onClick={() => go("invoices")}
                className="text-xs font-bold text-info hover:underline"
              >
                عرض الكل
              </button>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">اسم المريض</th>
                  <th className="th">الإجمالي</th>
                  <th className="th">المتبقي</th>
                  <th className="th">حالة الدفع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="td py-10 text-center text-gray-400"
                    >
                      لا توجد فواتير بعد
                    </td>
                  </tr>
                ) : (
                  invoices.slice(0, 4).map((i) => {
                    const total = i.total || 0;
                    const paid = i.paid || 0;
                    const rem = total - paid;
                    const status =
                      i.payment_status || i.status || "unpaid";
                    const st =
                      status === "paid"
                        ? ["green", "مدفوعة"]
                        : status === "partial"
                        ? ["orange", "جزئي"]
                        : ["red", "غير مدفوعة"];
                    return (
                      <tr
                        key={i.id}
                        className="transition hover:bg-accent-soft/40"
                      >
                        <td className="td font-bold text-gray-800">
                          {pName(i.patientId || i.patient_id)}
                        </td>
                        <td className="td">{fmtMoney(total)}</td>
                        <td
                          className={`td font-bold ${
                            rem > 0 ? "text-danger" : "text-gray-400"
                          }`}
                        >
                          {fmtMoney(rem)}
                        </td>
                        <td className="td">
                          <Badge color={st[0]}>{st[1]}</Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
