"use client";
import React, { useState, useMemo, useEffect } from "react";
import { Card, Modal, Field, Input, Badge, EmptyRow } from "@/components/ui";
import { seedPatients, seedExams, seedExaminers } from "@/lib/data";
import { fetchCollection, saveCollection, saveSingleItem, deleteSingleItem } from "@/lib/api";
import { fmtMoney, fmtDate, printPrescription, openWhatsApp, todayISO } from "@/lib/utils";
import ExamForm from "@/components/ExamForm";

export default function Patients({ can }) {
  const allowed = (permission) => typeof can !== "function" || can(permission);
  const [patients, setPatients] = useState(seedPatients);
  const [exams, setExams] = useState(seedExams);
  const [examiners, setExaminers] = useState(seedExaminers);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      const [loadedPatients, loadedExams, loadedExaminers, loadedSettings] = await Promise.all([
        fetchCollection("patients", seedPatients),
        fetchCollection("exams", seedExams),
        fetchCollection("examiners", seedExaminers),
        fetchCollection("settings", {}),
      ]);
      if (!ignore) {
        setPatients(loadedPatients);
        setExams(loadedExams);
        setExaminers(Array.isArray(loadedExaminers) ? loadedExaminers : seedExaminers);
        setSettings(loadedSettings && typeof loadedSettings === "object" ? loadedSettings : {});
      }
    };
    load();
    return () => { ignore = true; };
  }, []);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState(null);
  const [fileOf, setFileOf] = useState(null);
  const [examFor, setExamFor] = useState(null);
  const [editingExam, setEditingExam] = useState(null);
  const [viewingExam, setViewingExam] = useState(null);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () => patients.filter((p) => {
      const name = (p.name || "").toLowerCase();
      const phone = (p.phone1 || "").toLowerCase();
      return !normalizedQuery || name.includes(normalizedQuery) || phone.includes(normalizedQuery);
    }),
    [patients, normalizedQuery]
  );

  const savePatient = async (data) => {
    if (!allowed("patients.create")) return;
    const nextId = patients.length ? Math.max(...patients.map((p) => p.id)) + 1 : 1;
    const item = { id: nextId, fileNo: `P-${1000 + nextId}`, lastVisit: "—", ...data };
    const result = await saveSingleItem("patients", item);
    if (result) {
      setPatients((current) => [...current, item]);
    }
    setAddOpen(false);
  };

  const updatePatient = async (data) => {
    if (!allowed("patients.update")) return;
    const payload = { ...editingPatient, ...data };
    const result = await saveSingleItem("patients", payload);
    if (result) {
      setPatients((current) => current.map((p) => (p.id === editingPatient.id ? payload : p)));
    }
    setEditingPatient(null);
  };

  const removePatient = async (id) => {
    if (!allowed("patients.delete")) return;
    if (window.confirm("هل أنت متأكد من حذف هذا المريض؟ سيتم حذف جميع فحوصاته.")) {
      const result = await deleteSingleItem("patients", id);
      if (result !== null) {
        setPatients((current) => current.filter((p) => p.id !== id));
        setExams((current) => current.filter((exam) => exam.patientId !== id));
        if (fileOf === id) setFileOf(null);
      }
    }
  };

  const detailPatient = fileOf ? patients.find((p) => p.id === fileOf) : null;
  const detailExams = detailPatient ? exams.filter((e) => e.patientId === detailPatient.id) : [];
  const clinicName = settings.clinicName || "عيادة العلي";
  const clinicPhone = settings.phone1 || "";

  const detailView = detailPatient ? (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-2xl font-black text-accent">
              {detailPatient.name.charAt(0)}
            </span>
            <div>
              <h2 className="text-xl font-black text-primary">{detailPatient.name}</h2>
              <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-500">
                <span><i className="fa-solid fa-hashtag ml-1 text-accent" />{detailPatient.fileNo}</span>
                <span><i className="fa-solid fa-phone ml-1 text-accent" />{detailPatient.phone1}</span>
                <span><i className={`fa-solid ${detailPatient.gender === "male" ? "fa-mars" : "fa-venus"} ml-1 text-accent`} />{detailPatient.gender === "male" ? "ذكر" : "أنثى"}</span>
                <span><i className="fa-regular fa-calendar ml-1 text-accent" />آخر زيارة: {detailPatient.lastVisit}</span>
              </div>
              {detailPatient.notes && <p className="mt-2 rounded-lg bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-600"><i className="fa-solid fa-triangle-exclamation ml-1" />{detailPatient.notes}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            {allowed("patients.update") && <button onClick={() => setEditingPatient(detailPatient)} className="btn-ghost">
              <i className="fa-solid fa-pen" /> تعديل بيانات المريض
            </button>}
            {allowed("exams.create") && <button onClick={() => setExamFor(detailPatient)} className="btn-accent">
              <i className="fa-solid fa-plus" /> فحص جديد
            </button>}
            <button onClick={() => setFileOf(null)} className="btn-ghost">
              <i className="fa-solid fa-arrow-right" /> رجوع
            </button>
          </div>
        </div>
      </Card>

      {allowed("exams.view") && <Card>
        <div className="border-b border-gray-100 px-5 py-4">
          <h3 className="font-extrabold text-primary"><i className="fa-solid fa-clock-rotate-left ml-2 text-accent" />سجل الفحوصات السابقة</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="th">التاريخ</th><th className="th">نوع العدسة</th><th className="th">الفاحص</th>
                <th className="th">السعر</th><th className="th">موعد المراجعة</th><th className="th">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {detailExams.length === 0 && <EmptyRow span={6} text="لا توجد فحوصات سابقة — ابدأ بإضافة فحص جديد" />}
              {detailExams.map((e) => (
                <tr key={e.id} className="hover:bg-accent-soft/40">
                  <td className="td font-bold">{fmtDate(e.date)}</td>
                  <td className="td">{e.lensType || e.lens || "—"}</td>
                  <td className="td">{examiners.find((x) => x.id === e.examinerId)?.name || "—"}</td>
                  <td className="td font-bold text-success">{fmtMoney(e.price)}</td>
                  <td className="td">{e.reviewDate ? fmtDate(e.reviewDate) : "—"}</td>
                  <td className="td">
                    <div className="flex gap-1">
                      {allowed("exams.view") && <button title="معاينة الفحص" className="icon-btn text-purple-600 hover:bg-purple-100"
                        onClick={() => setViewingExam(e)}>
                        <i className="fa-solid fa-eye" />
                      </button>}
                      {allowed("exams.print") && <button title="طباعة الوصفة" className="icon-btn text-primary hover:bg-primary hover:text-white"
                        onClick={() => printPrescription({
                          patient: detailPatient,
                          exam: { date: fmtDate(e.date), examiner: examiners.find((x) => x.id === e.examinerId)?.name, pd: e.pd, vaOD: e.vaOD, vaOS: e.vaOS, lens: e.lensType || e.lens, refraction: e.refraction, notes: e.notes },
                          rx: e.rx || { distance: { OD: {}, OS: {} }, near: { OD: {}, OS: {} } },
                          clinic: { name: clinicName, phone: clinicPhone },
                        })}>
                        <i className="fa-solid fa-print" />
                      </button>}
                      {allowed("followups.send") && <button title="إرسال واتساب" className="icon-btn text-success hover:bg-success hover:text-white"
                        onClick={() => openWhatsApp({ phone: detailPatient.phone1, name: detailPatient.name, date: e.reviewDate || todayISO(), time: "10:00", clinic: clinicName })}>
                        <i className="fa-brands fa-whatsapp" />
                      </button>}
                      {allowed("exams.update") && <button title="تعديل" className="icon-btn text-info hover:bg-info hover:text-white" onClick={() => setEditingExam(e)}><i className="fa-solid fa-pen" /></button>}
                      {allowed("exams.delete") && <button title="حذف" className="icon-btn text-danger hover:bg-danger hover:text-white"
                        onClick={async () => {
                          if (!allowed("exams.delete")) return;
                          if (!window.confirm("هل أنت متأكد من حذف هذا الفحص؟ لا يمكن التراجع!")) return;
                          const result = await deleteSingleItem("exams", e.id);
                          if (result !== null) {
                            setExams((current) => current.filter((x) => x.id !== e.id));
                          }
                        }}>
                        <i className="fa-solid fa-trash" />
                      </button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>}

      {(examFor || editingExam) && (
        <ExamForm
          patient={examFor || detailPatient}
          exam={editingExam}
          onClose={() => {
            setExamFor(null);
            setEditingExam(null);
          }}
          onSave={async (exam) => {
            if (editingExam) {
              if (!allowed("exams.update")) return;
              const payload = { ...editingExam, ...exam, id: editingExam.id, patientId: detailPatient.id };
              const result = await saveSingleItem("exams", payload);
              if (result) {
                setExams((current) => current.map((entry) => (entry.id === editingExam.id ? payload : entry)));
              }
              setEditingExam(null);
              return;
            }

            if (!allowed("exams.create")) return;
            const id = exams.length ? Math.max(...exams.map((e) => e.id)) + 1 : 1;
            const payload = { id, patientId: examFor.id, ...exam };
            const result = await saveSingleItem("exams", payload);
            if (result) {
              setExams((current) => [...current, payload]);
            }
            setExamFor(null);
          }}
        />
      )}
    </div>
  ) : null;

  return (
    <>
      {viewingExam && (
        <Modal open wide onClose={() => setViewingExam(null)} title="معاينة وصفة فحص النظر">
          <div className="bg-white p-2 sm:p-4 text-gray-800" style={{ minWidth: "100%" }}>
            
            {/* Header / رأس المعاينة */}
            <div className="flex justify-between items-end border-b-[3px] border-[#2c1b3d] pb-3 mb-6">
              <span className="text-gray-400 font-bold text-sm">وصفة فحص نظر</span>
              <h2 className="text-2xl font-black text-[#2c1b3d]">{clinicName || "عيادة العلي"}</h2>
            </div>

            {/* Info Cards / بيانات المريض والفحص */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 text-sm">
              <div className="border border-gray-200 rounded-lg p-2.5 bg-gray-50/50 flex justify-between">
                <span className="text-gray-900">{detailPatient?.name}</span>
                <span className="font-bold text-[#2c1b3d]">المريض:</span> 
              </div>
              <div className="border border-gray-200 rounded-lg p-2.5 bg-gray-50/50 flex justify-between">
                <span className="text-gray-900">{fmtDate(viewingExam.date)}</span>
                <span className="font-bold text-[#2c1b3d]">التاريخ:</span> 
              </div>
              <div className="border border-gray-200 rounded-lg p-2.5 bg-gray-50/50 flex justify-between">
                <span className="text-gray-900">{examiners.find((x) => x.id === viewingExam.examinerId)?.name || "—"}</span>
                <span className="font-bold text-[#2c1b3d]">الفاحص:</span> 
              </div>
              <div className="border border-gray-200 rounded-lg p-2.5 bg-gray-50/50 flex justify-between">
                <span className="text-gray-900">{viewingExam.lensType || viewingExam.lens || "—"}</span>
                <span className="font-bold text-[#2c1b3d]">نوع العدسة:</span> 
              </div>
              <div className="border border-gray-200 rounded-lg p-2.5 bg-gray-50/50 flex justify-between">
                <span className="text-gray-900" dir="ltr">{viewingExam.vaOD || "—"} / {viewingExam.vaOS || "—"}</span>
                <span className="font-bold text-[#2c1b3d]">حدة الإبصار OD/OS:</span> 
              </div>
              <div className="border border-gray-200 rounded-lg p-2.5 bg-gray-50/50 flex justify-between">
                <span className="text-gray-900" dir="ltr">{viewingExam.pd || "—"}</span>
                <span className="font-bold text-[#2c1b3d]">PD:</span> 
              </div>
            </div>

            {/* الرؤية البعيدة (Distance) */}
            <div className="mb-6 overflow-x-auto">
              <h3 className="font-bold text-[#2c1b3d] mb-3 text-lg text-right">الرؤية البعيدة (Distance)</h3>
              <table className="w-full text-center border-collapse border border-gray-300 min-w-[600px] text-sm">
                <thead>
                  <tr className="bg-[#2c1b3d] text-white">
                    <th colSpan={3} className="border border-white/20 p-2">OD — اليمنى</th>
                    <th colSpan={3} className="border border-white/20 p-2">OS — اليسرى</th>
                    <th rowSpan={2} className="border border-white/20 p-2 align-middle w-24">العين</th>
                  </tr>
                  <tr className="bg-[#2c1b3d] text-white">
                    <th className="border border-white/20 p-2 w-1/6">SPH</th>
                    <th className="border border-white/20 p-2 w-1/6">CYL</th>
                    <th className="border border-white/20 p-2 w-1/6">AXIS</th>
                    <th className="border border-white/20 p-2 w-1/6">SPH</th>
                    <th className="border border-white/20 p-2 w-1/6">CYL</th>
                    <th className="border border-white/20 p-2 w-1/6">AXIS</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  <tr>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.distance?.OD?.SPH || "—"}</td>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.distance?.OD?.CYL || "—"}</td>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.distance?.OD?.AXIS || "—"}</td>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.distance?.OS?.SPH || "—"}</td>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.distance?.OS?.CYL || "—"}</td>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.distance?.OS?.AXIS || "—"}</td>
                    <td className="border border-gray-300 p-3 font-bold text-gray-800 bg-gray-50">بعيد</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* الرؤية القريبة (Near) */}
            <div className="mb-6 overflow-x-auto">
              <h3 className="font-bold text-[#2c1b3d] mb-3 text-lg text-right">الرؤية القريبة (Near)</h3>
              <table className="w-full text-center border-collapse border border-gray-300 min-w-[600px] text-sm">
                <thead>
                  <tr className="bg-[#2c1b3d] text-white">
                    <th colSpan={3} className="border border-white/20 p-2">OD — اليمنى</th>
                    <th colSpan={3} className="border border-white/20 p-2">OS — اليسرى</th>
                    <th rowSpan={2} className="border border-white/20 p-2 align-middle w-24">العين</th>
                  </tr>
                  <tr className="bg-[#2c1b3d] text-white">
                    <th className="border border-white/20 p-2 w-1/6">SPH</th>
                    <th className="border border-white/20 p-2 w-1/6">CYL</th>
                    <th className="border border-white/20 p-2 w-1/6">AXIS</th>
                    <th className="border border-white/20 p-2 w-1/6">SPH</th>
                    <th className="border border-white/20 p-2 w-1/6">CYL</th>
                    <th className="border border-white/20 p-2 w-1/6">AXIS</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  <tr>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.near?.OD?.SPH || "—"}</td>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.near?.OD?.CYL || "—"}</td>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.near?.OD?.AXIS || "—"}</td>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.near?.OS?.SPH || "—"}</td>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.near?.OS?.CYL || "—"}</td>
                    <td className="border border-gray-300 p-3 text-gray-800" dir="ltr">{viewingExam.rx?.near?.OS?.AXIS || "—"}</td>
                    <td className="border border-gray-300 p-3 font-bold text-gray-800 bg-gray-50">قريب</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Additional Info / ملاحظات إضافية */}
            {(viewingExam.refraction || viewingExam.notes) && (
              <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {viewingExam.refraction && (
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/50">
                    <span className="font-bold text-[#2c1b3d]">نتيجة الانكسار:</span>
                    <p className="mt-1 text-sm text-gray-600">{viewingExam.refraction}</p>
                  </div>
                )}
                {viewingExam.notes && (
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/50">
                    <span className="font-bold text-[#2c1b3d]">ملاحظات:</span>
                    <p className="mt-1 text-sm text-gray-600">{viewingExam.notes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-dotted border-gray-300 mt-8 pt-4 text-center text-xs text-gray-400">
              تم إصدار هذه الوصفة إلكترونياً بواسطة نظام عيادة العلي لإدارة فحص النظر والبصريات
            </div>
            
            <div className="mt-6 flex justify-end pt-2 border-t border-gray-100 no-print">
              <button className="btn-accent" onClick={() => setViewingExam(null)}>إغلاق المعاينة</button>
            </div>
          </div>
        </Modal>
      )}

      {detailView || (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-black text-primary">المرضى</h2>
              <Badge color="yellow">{patients.length} مريض</Badge>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative w-full sm:w-72">
                <Input placeholder="بحث بالاسم أو رقم الجوال..." value={query} onChange={(e) => setQuery(e.target.value)} />
                <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
              {allowed("patients.create") && <button onClick={() => setAddOpen(true)} className="btn-accent">
                <i className="fa-solid fa-plus" /> إضافة مريض جديد
              </button>}
            </div>
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="th">الاسم</th><th className="th">الجوال</th><th className="th">رقم الملف</th>
                    <th className="th">آخر زيارة</th><th className="th">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.length === 0 && <EmptyRow span={5} text="لا توجد نتائج مطابقة للبحث" />}
                  {filtered.map((p) => (
                    <tr key={p.id} className="transition hover:bg-accent-soft/40">
                      <td className="td font-bold text-gray-800">
                        <i className={`fa-solid ${p.gender === "male" ? "fa-mars text-info" : "fa-venus text-pink-500"} ml-2`} />{p.name}
                      </td>
                      <td className="td" dir="ltr">{p.phone1}</td>
                      <td className="td"><Badge color="gray">{p.fileNo}</Badge></td>
                      <td className="td text-gray-500">{p.lastVisit}</td>
                      <td className="td">
                        <div className="flex gap-1">
                          <button title="عرض الملف" className="icon-btn text-primary hover:bg-primary hover:text-white" onClick={() => setFileOf(p.id)}>
                            <i className="fa-solid fa-folder-open" />
                          </button>
                          {allowed("patients.update") && <button title="تعديل" className="icon-btn text-info hover:bg-info hover:text-white" onClick={() => setEditingPatient(p)}><i className="fa-solid fa-pen" /></button>}
                          {allowed("patients.delete") && <button title="حذف" className="icon-btn text-danger hover:bg-danger hover:text-white" onClick={() => removePatient(p.id)}>
                            <i className="fa-solid fa-trash" />
                          </button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {addOpen && allowed("patients.create") && <PatientFormModal onClose={() => setAddOpen(false)} onSave={savePatient} title="إضافة مريض جديد" />}
      {editingPatient && allowed("patients.update") && (
        <PatientFormModal
          patient={editingPatient}
          onClose={() => setEditingPatient(null)}
          onSave={updatePatient}
          title="تعديل بيانات المريض"
        />
      )}
    </>
  );
}

function PatientFormModal({ patient = null, onClose, onSave, title }) {
  const [f, setF] = useState({
    name: patient?.name || "",
    phone1: patient?.phone1 || "",
    phone2: patient?.phone2 || "",
    gender: patient?.gender || "male",
    dob: patient?.dob || "",
    address: patient?.address || "",
    notes: patient?.notes || "",
  });

  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) onSave({ ...f, name: f.name.trim() }); }} className="space-y-4">
        <Field label="الاسم الكامل" required>
          <Input required placeholder="أدخل اسم المريض الثلاثي" value={f.name} onChange={set("name")} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="رقم الجوال 1"><Input dir="ltr" placeholder="05xxxxxxxx" value={f.phone1} onChange={set("phone1")} /></Field>
          <Field label="رقم الجوال 2"><Input dir="ltr" placeholder="05xxxxxxxx" value={f.phone2} onChange={set("phone2")} /></Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="الجنس">
            <div className="flex items-center gap-6 rounded-lg border border-gray-300 px-3 py-2.5">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="g" checked={f.gender === "male"} onChange={() => setF((prev) => ({ ...prev, gender: "male" }))} className="accent-yellow-500" /> ذكر
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="g" checked={f.gender === "female"} onChange={() => setF((prev) => ({ ...prev, gender: "female" }))} className="accent-yellow-500" /> أنثى
              </label>
            </div>
          </Field>
          <Field label="تاريخ الميلاد"><Input type="date" value={f.dob} onChange={set("dob")} /></Field>
        </div>
        <Field label="العنوان"><Input placeholder="المدينة — الحي" value={f.address} onChange={set("address")} /></Field>
        <Field label="ملاحظات"><textarea className="input min-h-20" placeholder="أي ملاحظات طبية مهمة..." value={f.notes} onChange={set("notes")} /></Field>
        <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
          <button type="button" onClick={onClose} className="btn-outline-danger">إلغاء</button>
          <button type="submit" className="btn-accent"><i className="fa-solid fa-floppy-disk" /> {patient ? "حفظ التعديلات" : "حفظ"}</button>
        </div>
      </form>
    </Modal>
  );
}
