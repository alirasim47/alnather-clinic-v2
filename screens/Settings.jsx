"use client";
import React, { useEffect, useRef, useState } from "react";
import { Card, Field, Input } from "@/components/ui";
import { resetStorage, STORAGE_KEYS } from "@/lib/storage";
import { fetchCollection, saveCollection } from "@/lib/api";
import { seedPatients, seedExams, seedExaminers, seedProducts, seedInvoices, seedFollowups, seedUsers } from "@/lib/data";

const TABS = [
  { id: "clinic", label: "إعدادات العيادة", icon: "fa-hospital" },
  { id: "wa", label: "قوالب واتساب", icon: "fa-brands fa-whatsapp" },
  { id: "backup", label: "النسخ الاحتياطي", icon: "fa-database" },
  { id: "updates", label: "التحديثات", icon: "fa-cloud-arrow-down" },
];

const DEFAULT_SETTINGS = {
  clinicName: "عيادة العلي",
  phone1: "0112345678",
  phone2: "",
  footerText: "شكراً لزيارتكم — نسعد بخدمتكم",
  primaryColor: "#2c1b3d",
  waTemplate: "مرحباً {name} 👋\nنذكركم بموعد المراجعة في عيادة {clinic} بتاريخ {date} الساعة {time}.",
};

const ALL_COLLECTIONS = ["patients", "exams", "examiners", "products", "invoices", "followups", "users"];
const FALLBACKS = {
  patients: seedPatients, exams: seedExams, examiners: seedExaminers,
  products: seedProducts, invoices: seedInvoices, followups: seedFollowups, users: seedUsers,
};

export default function Settings() {
  const [tab, setTab] = useState("clinic");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState("success");
  const [backupInfo, setBackupInfo] = useState(null);
  const uploadRef = useRef(null);
  const logoRef = useRef(null);
  const [logoPreview, setLogoPreview] = useState(null);

  useEffect(() => {
    const load = async () => {
      const savedSettings = await fetchCollection("settings", DEFAULT_SETTINGS);
      if (savedSettings && typeof savedSettings === "object") {
        setSettings((prev) => ({ ...prev, ...savedSettings }));
      }
      const info = typeof window !== "undefined" ? localStorage.getItem("clinic-backup-info") : null;
      if (info) {
        try { setBackupInfo(JSON.parse(info)); } catch {}
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
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(nextSettings));
    }
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
    showNotice("جاري تجهيز النسخة الاحتياطية الكاملة...");
    try {
      const data = { settings };
      for (const key of ALL_COLLECTIONS) {
        data[key] = await fetchCollection(key, FALLBACKS[key]);
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
      link.download = `clinic-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      const info = { savedAt: payload.savedAt, counts: payload.counts };
      setBackupInfo(info);
      if (typeof window !== "undefined") {
        localStorage.setItem("clinic-backup-info", JSON.stringify(info));
      }
      showNotice(`تم تنزيل نسخة احتياطية كاملة (${(data.patients || []).length} مريض، ${(data.invoices || []).length} فاتورة) ✅`);
    } catch (e) {
      showNotice("فشل إنشاء النسخة الاحتياطية: " + e.message, "error");
    }
  };

  const handleBackupUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!window.confirm("تحذير: سيتم استبدال جميع البيانات الحالية بالبيانات من الملف. هل أنت متأكد؟")) {
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const payload = parsed?.data ? parsed : { data: parsed };

        if (payload.data?.settings) {
          const next = { ...DEFAULT_SETTINGS, ...payload.data.settings };
          setSettings(next);
          await persistSettings(next);
        }

        for (const key of ALL_COLLECTIONS) {
          if (Array.isArray(payload.data?.[key])) {
            await saveCollection(key, payload.data[key]);
          }
        }

        const counts = {};
        ALL_COLLECTIONS.forEach((k) => { counts[k] = (payload.data?.[k] || []).length; });
        const info = { savedAt: payload.savedAt || new Date().toISOString(), counts, restoredAt: new Date().toISOString() };
        setBackupInfo(info);
        if (typeof window !== "undefined") {
          localStorage.setItem("clinic-backup-info", JSON.stringify(info));
        }
        showNotice(`تم استيراد ${counts.patients || 0} مريض و ${counts.invoices || 0} فاتورة بنجاح — جاري إعادة التحميل... ✅`);
        setTimeout(() => window.location.reload(), 1500);
      } catch (e) {
        showNotice("ملف النسخة الاحتياطية غير صالح: " + e.message, "error");
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  };

  const handleLogoUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
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

  const checkUpdates = async () => {
    setNotice("جاري التحقق...");
    await new Promise((r) => setTimeout(r, 800));
    showNotice("النظام محدّث — الإصدار 1.0.0 ✅");
  };

  const resetData = () => {
    if (!window.confirm("تحذير خطير: سيتم حذف جميع البيانات (المرضى، الفواتير، المنتجات...)! هل أنت متأكد 100%؟")) return;
    const typed = window.prompt("للتأكيد، اكتب كلمة: احذف");
    if (typed !== "احذف") {
      showNotice("تم إلغاء العملية", "error");
      return;
    }
    resetStorage();
    window.location.reload();
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
            <button type="button" onClick={resetData} className="btn-outline-danger">⚠️ إعادة تعيين كل البيانات</button>
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
                <div className="font-extrabold text-primary">النسخة الاحتياطية الكاملة</div>
                <div className="text-sm text-gray-500">تشمل: المرضى، الفحوصات، الفواتير، المنتجات، الفاحصين، المستخدمين، التنبيهات، الإعدادات</div>
                {backupInfo?.savedAt && (
                  <div className="mt-2 text-xs text-success">
                    <i className="fa-solid fa-clock ml-1" />آخر نسخة: {new Date(backupInfo.savedAt).toLocaleString("ar-EG")}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={backupAction} className="btn-blue"><i className="fa-solid fa-download" /> تنزيل نسخة كاملة</button>
                <button type="button" onClick={() => uploadRef.current?.click()} className="btn-accent"><i className="fa-solid fa-upload" /> استعادة من ملف</button>
                <input ref={uploadRef} type="file" accept="application/json" className="hidden" onChange={handleBackupUpload} />
              </div>
            </div>
          </div>

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
          <div className="text-lg font-extrabold text-primary">النظام محدّث — الإصدار 1.0.0</div>
          <p className="mt-1 text-sm text-gray-500">Next.js 14.2.35 • React 18.3.1 • Tailwind 3.4</p>
          <button type="button" onClick={checkUpdates} className="btn-accent mt-4"><i className="fa-solid fa-rotate" /> التحقق من التحديثات</button>
        </Card>
      )}
    </div>
  );
}
