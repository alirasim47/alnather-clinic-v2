"use client";
import React, { useEffect, useRef, useState } from "react";
import { Card, Field, Input } from "@/components/ui";
import { apiRequest, applyImport, fetchCollection, previewImport, saveCollection } from "@/lib/api";

const TABS = [
  { id: "clinic", label: "إعدادات العيادة", icon: "fa-hospital" },
  { id: "wa", label: "قوالب واتساب", icon: "fa-brands fa-whatsapp" },
  { id: "backup", label: "النسخ الاحتياطي", icon: "fa-database" },
  { id: "updates", label: "التحديثات", icon: "fa-cloud-arrow-down" },
];

const DEFAULT_SETTINGS = {
  clinicName: "عيادة الناظر",
  phone1: "",
  phone2: "",
  footerText: "شكراً لزيارتكم — نسعد بخدمتكم",
  primaryColor: "#2c1b3d",
  waTemplate: "مرحباً {name} 👋\nنذكركم بموعد المراجعة في عيادة {clinic} بتاريخ {date} الساعة {time}.",
};

const ALL_COLLECTIONS = ["patients", "exams", "examiners", "products", "invoices", "followups", "users", "branches", "lensInventory", "expenses", "returns", "transfers", "stockBatches", "stockMovements"];
export default function Settings({ can }) {
  const [tab, setTab] = useState("clinic");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState("success");
  const [backupInfo, setBackupInfo] = useState(null);
  const uploadRef = useRef(null);
  const logoRef = useRef(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditExporting, setAuditExporting] = useState(false);

  useEffect(() => {
    const load = async () => {
      const savedSettings = await fetchCollection("settings", DEFAULT_SETTINGS);
      if (savedSettings && typeof savedSettings === "object") {
        setSettings((prev) => ({ ...prev, ...savedSettings }));
      }
    };
    load();
  }, []);

  const update = (field) => (e) => setSettings((prev) => ({ ...prev, [field]: e.target.value }));

  const showNotice = (msg, type = "success") => {
    setNotice(msg);
    setNoticeType(type);
    setTimeout(() => setNotice(""), 4000);
  };

  const persistSettings = async (nextSettings = settings) => {
    await saveCollection("settings", nextSettings);
  };

  const reset = () => {
    const next = DEFAULT_SETTINGS;
    setSettings(next);
    persistSettings(next);
    showNotice("تمت استعادة الإعدادات الافتراضية");
  };

  const saveClinic = async () => {
    await persistSettings(settings);
    showNotice("تم حفظ إعدادات العيادة بنجاح ✅");
  };

  const saveTemplate = async () => {
    await persistSettings(settings);
    showNotice("تم حفظ قالب واتساب بنجاح ✅");
  };

  const backupAction = async () => {
    if (typeof can === "function" && !can("users.manage")) {
      showNotice("تنزيل نسخة بيانات التشغيل متاح لمدير العيادة فقط.", "error");
      return;
    }
    showNotice("جاري تجهيز تصدير بيانات التشغيل...");
    try {
      const data = { settings };
      for (const key of ALL_COLLECTIONS) {
        data[key] = await apiRequest(`/api/collections/${encodeURIComponent(key)}`);
      }
      const payload = {
        version: "1.0",
        savedAt: new Date().toISOString(),
        clinicName: settings.clinicName,
        counts: {
          patients: (data.patients || []).length,
          exams: (data.exams || []).length,
          invoices: (data.invoices || []).length,
          products: (data.products || []).length,
          examiners: (data.examiners || []).length,
          followups: (data.followups || []).length,
          users: (data.users || []).length,
        },
        data,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `clinic-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      const info = { savedAt: payload.savedAt, counts: payload.counts };
      setBackupInfo(info);
      showNotice(`تم تنزيل تصدير بيانات التشغيل (${(data.patients || []).length} مريض، ${(data.invoices || []).length} فاتورة) ✅`);
    } catch (e) {
      showNotice("فشل إنشاء النسخة الاحتياطية: " + e.message, "error");
    }
  };

  const exportAuditAction = async () => {
    if (typeof can !== "function" || !can("audit.view")) {
      showNotice("تصدير سجل التدقيق متاح لمدير العيادة فقط.", "error");
      return;
    }
    if (auditFrom && auditTo && auditFrom > auditTo) {
      showNotice("تاريخ البداية يجب ألا يأتي بعد تاريخ النهاية.", "error");
      return;
    }
    setAuditExporting(true);
    showNotice("جاري تجهيز سجل التدقيق...");
    try {
      const events = [];
      const seenCursors = new Set();
      let cursor = null;
      let clinicId = null;
      do {
        if (events.length >= 20000) {
          throw new Error("يتجاوز السجل 20,000 حدث. حدّد نطاقًا زمنيًا أضيق ثم أعد التصدير.");
        }
        const params = new URLSearchParams({ limit: "500" });
        if (auditFrom) params.set("from", auditFrom);
        if (auditTo) params.set("to", auditTo);
        if (cursor) params.set("cursor", cursor);
        const page = await apiRequest(`/api/admin/audit?${params.toString()}`);
        if (!Array.isArray(page?.events)) throw new Error("استجابة سجل التدقيق غير صالحة.");
        if (clinicId !== null && String(page.clinicId) !== String(clinicId)) throw new Error("تغيّر نطاق العيادة أثناء التصدير؛ أعد المحاولة.");
        clinicId = page.clinicId;
        events.push(...page.events);
        cursor = page.nextCursor || null;
        if (cursor && seenCursors.has(cursor)) throw new Error("تعذر متابعة صفحات سجل التدقيق بأمان.");
        if (cursor) seenCursors.add(cursor);
      } while (cursor);

      const payload = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        clinicId,
        clinicName: settings.clinicName,
        dateRange: { from: auditFrom || null, to: auditTo || null },
        count: events.length,
        events,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `clinic-audit-${auditFrom || "all"}-${auditTo || "all"}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showNotice(`تم تنزيل ${events.length.toLocaleString("ar-EG")} حدثًا من سجل تدقيق هذه العيادة. احفظ الملف في مكان آمن؛ قد يحتوي بيانات طبية حساسة.`);
    } catch (e) {
      showNotice(`تعذر تصدير سجل التدقيق: ${e.message}`, "error");
    } finally {
      setAuditExporting(false);
    }
  };

  const handleBackupUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportPreview(null);
    setImportResult(null);
    if (file.size > 5 * 1024 * 1024) {
      showNotice("حجم الملف أكبر من 5 ميغابايت.", "error");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const payload = parsed?.data ? parsed : { data: parsed };
        const preview = await previewImport(payload);
        setImportPreview({ payload, preview });
        showNotice("اكتملت المعاينة. لن تُستبدل السجلات الموجودة.");
      } catch (e) {
        showNotice("ملف النسخة الاحتياطية غير صالح: " + e.message, "error");
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  };

  const applyBackupImport = async () => {
    if (!importPreview?.payload) return;
    const invoiceValidation = importPreview.preview.invoiceValidation;
    const invoiceSummary = invoiceValidation
      ? `\nالفواتير: ${invoiceValidation.validCount} صالحة ستُضاف، ${invoiceValidation.rejectedCount} مرفوضة ستُستبعد، وإنشاء ${invoiceValidation.paymentCount} سجل دفعة. الفواتير المرحّلة لا تخصم المخزون.`
      : "";
    if (!window.confirm(`سيتم إضافة ${importPreview.preview.totalToImport} سجل جديد صالح فقط. لن تُستبدل السجلات الموجودة.${invoiceSummary}\nحسابات الموظفين وطلبات النقل التاريخية لا تُستورد. متابعة؟`)) return;
    try {
      const result = await applyImport(importPreview.payload);
      setImportPreview(null);
      setImportResult(result.invoiceImport || null);
      const count = Object.values(result.imported || {}).reduce((sum, value) => sum + Number(value || 0), 0);
      const invoiceResult = result.invoiceImport;
      const partial = Number(invoiceResult?.rejectedCount || 0) > 0;
      const invoiceText = invoiceResult ? ` أُضيف ${invoiceResult.imported || 0} فاتورة و${invoiceResult.paymentRowsInserted || 0} دفعة تاريخية؛ استُبعدت ${invoiceResult.rejectedCount || 0} فاتورة غير صالحة.` : "";
      showNotice(`${partial ? "اكتمل الاستيراد جزئيًا." : "اكتمل الاستيراد الآمن."} أُضيف ${count} سجل.${invoiceText} تم تجاوز ${result.skippedUsers || 0} حساب موظف و${result.skippedTransfers || 0} حركة نقل، دون استبدال الموجود.`, partial ? "error" : "success");
    } catch (e) {
      showNotice(`تعذر الاستيراد: ${e.message}`, "error");
    }
  };

  const handleLogoUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showNotice("حجم الشعار يجب ألا يتجاوز 2 ميغابايت.", "error"); event.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      setLogoPreview(dataUrl);
      const next = { ...settings, logo: dataUrl };
      setSettings(next);
      await persistSettings(next);
      showNotice("تم رفع الشعار بنجاح ✅");
    };
    reader.readAsDataURL(file);
  };

  const checkUpdates = () => {
    showNotice("فحص التحديثات عبر الإنترنت غير متاح في هذه النسخة. راجع مستودع المشروع أو مسؤول النظام قبل تحديث الملفات.", "error");
  };

  const fmtCount = (n) => new Intl.NumberFormat("ar-EG").format(n || 0);

  return (
    <div className="space-y-5">
      {notice && (
        <div className={`rounded-xl2 border px-4 py-3 text-sm font-bold ${
          noticeType === "error" ? "border-danger/20 bg-red-50 text-danger" : "border-success/20 bg-emerald-50 text-success"
        }`}>
          {notice}
        </div>
      )}

      <div className="flex flex-wrap gap-2 rounded-xl2 bg-white p-2 shadow-card">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition
              ${tab === t.id ? "bg-primary text-accent" : "text-gray-500 hover:bg-gray-100"}`}>
            <i className={t.icon.startsWith("fa-brands") ? t.icon : `fa-solid ${t.icon}`} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "clinic" && (
        <Card className="p-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Field label="اسم العيادة"><Input value={settings.clinicName} onChange={update("clinicName")} /></Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="رقم الهاتف 1"><Input dir="ltr" value={settings.phone1} onChange={update("phone1")} /></Field>
                <Field label="رقم الهاتف 2"><Input dir="ltr" value={settings.phone2} placeholder="اختياري" onChange={update("phone2")} /></Field>
              </div>
              <Field label="نص تذييل الفواتير"><textarea className="input min-h-16" value={settings.footerText} onChange={update("footerText")} /></Field>
              <Field label="اللون الأساسي للنظام">
                <div className="flex items-center gap-3">
                  <input type="color" value={settings.primaryColor} onChange={update("primaryColor")} className="h-11 w-16 cursor-pointer rounded-lg border border-gray-300" />
                  <Input dir="ltr" value={settings.primaryColor} onChange={update("primaryColor")} className="w-32" />
                  <span className="h-8 w-8 rounded-lg" style={{ background: settings.primaryColor }} />
                </div>
              </Field>
            </div>
            <div className="space-y-4">
              <Field label="شعار العيادة">
                <label className="flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl2 border-2 border-dashed border-gray-300 text-gray-400 transition hover:border-accent hover:text-accent overflow-hidden relative">
                  {logoPreview || settings.logo ? (
                    <img src={logoPreview || settings.logo} alt="logo" className="h-full w-full object-contain" />
                  ) : (
                    <>
                      <i className="fa-solid fa-cloud-arrow-up text-2xl" />
                      <span className="text-xs font-bold">اضغط لرفع الشعار</span>
                    </>
                  )}
                  <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </label>
              </Field>
              <div className="rounded-xl2 border border-gray-100 p-4 text-center">
                <div className="mx-auto grid h-32 w-32 grid-cols-8 gap-0.5 rounded-lg border border-gray-200 p-2">
                  {Array.from({ length: 64 }).map((_, i) => (
                    <span key={i} className={`rounded-[1px] ${i % 3 === 0 ? "bg-primary" : "bg-white"}`} />
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-gray-400">رمز QR للعيادة (سيتم تفعيله لاحقاً)</p>
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={reset} className="btn-outline-danger">استعادة الافتراضي</button>
            <button type="button" onClick={saveClinic} className="btn-accent"><i className="fa-solid fa-floppy-disk" /> حفظ الإعدادات</button>
          </div>
        </Card>
      )}

      {tab === "wa" && (
        <Card className="p-6">
          <Field label="قالب تذكير المراجعة — المتغيرات: {name} {date} {time} {clinic}">
            <textarea className="input min-h-32" value={settings.waTemplate} onChange={update("waTemplate")} />
          </Field>
          <div className="mt-4 flex justify-end"><button type="button" onClick={saveTemplate} className="btn-accent"><i className="fa-solid fa-floppy-disk" /> حفظ القالب</button></div>
        </Card>
      )}

      {tab === "backup" && (
        <Card className="p-6 space-y-4">
          <div className="rounded-xl2 border border-gray-100 p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="font-extrabold text-primary">تصدير بيانات التشغيل</div>
                <div className="text-sm text-gray-500">تصدير سجلات العيادة والفروع والمخزون والمصاريف والعوائد بصيغة JSON. لا يشمل كلمات المرور أو الجلسات أو سجل التدقيق، ولا يغني عن نسخة PostgreSQL كاملة.</div>
                {backupInfo?.savedAt && (
                  <div className="mt-2 text-xs text-success">
                    <i className="fa-solid fa-clock ml-1" />آخر نسخة: {new Date(backupInfo.savedAt).toLocaleString("ar-EG")}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={backupAction} className="btn-blue"><i className="fa-solid fa-download" /> تنزيل نسخة بيانات التشغيل</button>
                {typeof can !== "function" || can("users.manage") ? <button type="button" onClick={() => uploadRef.current?.click()} className="btn-accent"><i className="fa-solid fa-upload" /> معاينة واستيراد</button> : null}
                <input ref={uploadRef} type="file" accept="application/json" className="hidden" onChange={handleBackupUpload} />
              </div>
            </div>
          </div>

          {typeof can === "function" && can("audit.view") && (
            <div className="rounded-xl2 border border-amber-200 bg-amber-50/40 p-4">
              <div className="mb-3">
                <div className="font-extrabold text-primary">تصدير سجل التدقيق</div>
                <div className="text-sm leading-6 text-gray-600">تصدير أحداث هذه العيادة مع الفروقات قبل/بعد، بصفحات محدودة ونطاق تاريخ اختياري. قد يتضمن الملف معلومات طبية حساسة؛ خزّنه بأمان.</div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="من تاريخ (اختياري)"><Input type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)} /></Field>
                <Field label="إلى تاريخ (اختياري)"><Input type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)} /></Field>
                <button type="button" onClick={exportAuditAction} disabled={auditExporting} className="btn-accent disabled:cursor-wait disabled:opacity-60">
                  <i className={`fa-solid ${auditExporting ? "fa-spinner fa-spin" : "fa-file-arrow-down"}`} /> {auditExporting ? "جاري التصدير..." : "تنزيل سجل التدقيق"}
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-500">اترك التاريخين فارغين لتصدير السجل كاملًا. إذا تجاوز 20,000 حدث، اختر نطاقًا زمنيًا أضيق.</div>
            </div>
          )}

          {importPreview && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="font-extrabold text-amber-950">معاينة الاستيراد — لن تُستبدل السجلات الموجودة</div>
              <div className="overflow-x-auto rounded-lg border border-amber-100 bg-white">
                <table className="w-full min-w-[600px]"><thead className="bg-amber-50"><tr><th className="th">القسم</th><th className="th">في الملف</th><th className="th">موجود مسبقًا</th><th className="th">سيضاف</th></tr></thead><tbody className="divide-y divide-gray-100">{Object.entries(importPreview.preview.counts).map(([key, value]) => <tr key={key}><td className="td font-bold">{({ patients:"المرضى", exams:"الفحوصات", examiners:"الفاحصون", followups:"المراجعات", products:"المنتجات", invoices:"الفواتير", settings:"الإعدادات", branches:"الفروع", lensInventory:"مخزون العدسات", expenses:"المصاريف", returns:"العوائد", transfers:"طلبات النقل", stockBatches:"دفعات المخزون", stockMovements:"حركات المخزون", users:"حسابات الموظفين" })[key] || key}</td><td className="td">{value.sourceCount ?? (value.present ? 1 : 0)}</td><td className="td">{value.alreadyPresent ? `${value.alreadyPresent}${value.duplicateInFile ? ` (+${value.duplicateInFile} مكرر بالملف)` : ""}` : value.alreadyPresent === 0 ? 0 : value.alreadyPresent ? "نعم" : "—"}</td><td className="td font-bold text-emerald-700">{typeof value.toImport === "boolean" ? Number(value.toImport) : (value.toImport ?? 0)}</td></tr>)}</tbody></table>
              </div>
              {importPreview.preview.skippedUsers > 0 && <p className="text-xs leading-5 text-amber-900">تُتجاوز حسابات الموظفين حفاظًا على كلمات المرور والجلسات؛ أنشئ الحسابات من جديد أو حدّثها عبر شاشة الموظفين.</p>}
              {importPreview.preview.skippedTransfers > 0 && <p className="text-xs leading-5 text-amber-900">طلبات النقل التاريخية تُتجاوز؛ لا تُعاد حركات النقل المعلّقة عند استيراد نسخة احتياطية.</p>}
              {importPreview.preview.invoiceValidation && <div role="status" className="space-y-2 rounded-lg border border-amber-300 bg-white p-3 text-sm text-amber-950">
                <div className="font-extrabold">تدقيق الفواتير القديمة: {importPreview.preview.invoiceValidation.validCount} صالحة، {importPreview.preview.invoiceValidation.alreadyPresent} موجودة، {importPreview.preview.invoiceValidation.duplicateInFile} مكررة بالملف، و{importPreview.preview.invoiceValidation.rejectedCount} مرفوضة. سيُنشأ {importPreview.preview.invoiceValidation.paymentCount} سجل دفعة دون خصم مخزون.</div>
                {importPreview.preview.invoiceValidation.rejected?.length > 0 && <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pr-5 text-xs leading-5">
                  {importPreview.preview.invoiceValidation.rejected.slice(0, 20).map((issue, index) => <li key={`${issue.invoice}-${index}`}><b>{issue.invoice}:</b> {issue.reason}</li>)}
                </ul>}
                {importPreview.preview.invoiceValidation.rejectionListTruncated && <p className="text-xs">عُرضت أول 20 ملاحظة فقط؛ سيحفظ التقرير النهائي عددًا محدودًا من التفاصيل.</p>}
              </div>}
              <div className="flex justify-end gap-2"><button type="button" className="btn-outline-danger" onClick={() => setImportPreview(null)}>إلغاء</button><button type="button" className="btn-accent" disabled={!importPreview.preview.totalToImport} onClick={applyBackupImport}>إضافة السجلات الجديدة الصالحة فقط</button></div>
            </div>
          )}

          {importResult && <div role="status" className={`space-y-2 rounded-xl border p-4 ${importResult.rejectedCount ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
            <div className="font-extrabold">نتيجة استيراد الفواتير: أُضيف {importResult.imported || 0} فاتورة و{importResult.paymentRowsInserted || 0} سجل دفعة، واستُبعدت {importResult.rejectedCount || 0} فاتورة.</div>
            {importResult.rejected?.length > 0 && <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pr-5 text-xs leading-5">
              {importResult.rejected.slice(0, 20).map((issue, index) => <li key={`${issue.invoice}-${index}`}><b>{issue.invoice}:</b> {issue.reason}</li>)}
            </ul>}
          </div>}

          {backupInfo?.counts && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg bg-purple-50 p-3 text-center">
                <div className="text-2xl font-black text-primary">{fmtCount(backupInfo.counts.patients)}</div>
                <div className="text-xs text-gray-500">مريض</div>
              </div>
              <div className="rounded-lg bg-blue-50 p-3 text-center">
                <div className="text-2xl font-black text-primary">{fmtCount(backupInfo.counts.exams)}</div>
                <div className="text-xs text-gray-500">فحص</div>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3 text-center">
                <div className="text-2xl font-black text-primary">{fmtCount(backupInfo.counts.invoices)}</div>
                <div className="text-xs text-gray-500">فاتورة</div>
              </div>
              <div className="rounded-lg bg-orange-50 p-3 text-center">
                <div className="text-2xl font-black text-primary">{fmtCount(backupInfo.counts.products)}</div>
                <div className="text-xs text-gray-500">منتج</div>
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === "updates" && (
        <Card className="p-6 text-center">
          <i className="fa-solid fa-circle-check mb-3 text-4xl text-success" />
          <div className="text-lg font-extrabold text-primary">معلومات إصدار التطبيق</div>
          <p className="mt-1 text-sm text-gray-500">التطبيق 1.0.0 • Next.js 15.5.28 • React 18.3.1 • Tailwind 3.4.4</p>
          <button type="button" onClick={checkUpdates} className="btn-accent mt-4"><i className="fa-solid fa-rotate" /> التحقق من التحديثات</button>
        </Card>
      )}
    </div>
  );
}
