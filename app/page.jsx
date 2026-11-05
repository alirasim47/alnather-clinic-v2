"use client";
import React, { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import ClinicLogo from "@/components/ClinicLogo";

export default function Home() {
  const [currentUser, setCurrentUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let ignore = false;
    fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) return null;
        return result.user || null;
      })
      .catch(() => null)
      .then((user) => {
        if (ignore) return;
        setCurrentUser(user);
        setReady(true);
      });
    return () => { ignore = true; };
  }, []);

  const handleLogin = async ({ clinicSlug, identifier, password }) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicSlug, identifier, password }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: result.error || "تعذر تسجيل الدخول." };
    setCurrentUser(result.user);
    return { ok: true };
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      setCurrentUser(null);
    }
  };

  if (!ready) return <div className="flex min-h-screen items-center justify-center bg-[#f6f3f8] text-sm font-bold text-gray-500">جارٍ التحقق من جلسة الحساب…</div>;
  if (!currentUser) return <Login onLogin={handleLogin} />;
  return <Shell onLogout={handleLogout} currentUser={currentUser} />;
}

function Login({ onLogin }) {
  const [clinicSlug, setClinicSlug] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await onLogin({ clinicSlug, identifier, password });
      if (!result.ok) setError(result.message);
    } catch {
      setError("تعذر الاتصال بخادم العيادة. تحقق من إعداد الخادم والشبكة.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#24182f] p-4 sm:p-8">
      <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-[#eab308]/15 blur-3xl" />
      <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-[#6b4b87]/30 blur-3xl" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[30px] border border-white/10 bg-white shadow-[0_35px_100px_rgba(8,5,15,.45)] md:grid-cols-[1.08fr_.92fr]">
        <section className="flex flex-col justify-between bg-[#f8f6fa] p-7 sm:p-10">
          <div className="flex items-center justify-between text-xs font-bold text-gray-400"><span>نظام إدارة العيادة</span><span>متعدد الأجهزة</span></div>
          <div className="my-10">
            <div className="mb-8 inline-flex rounded-2xl bg-[#2c1b3d] p-3 shadow-lg"><ClinicLogo compact={false} className="justify-center text-white" /></div>
            <h1 className="text-3xl font-black leading-tight text-[#2c1b3d] sm:text-4xl">رعاية أدق، وإدارة أوضح</h1>
            <p className="mt-4 max-w-lg text-sm leading-7 text-gray-600">إدارة المرضى والفحوصات والمواعيد والمنتجات والمبيعات والفروع، مع صلاحيات الموظفين في مكان واحد.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {["سجل طبي منظم", "مخزون وعدسات بالقياس", "فواتير وعوائد موثقة", "تقارير حسب الفرع"].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><i className="fa-solid fa-check text-xs" /></span>
                  <span className="text-sm font-bold text-gray-700">{item}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs font-bold text-gray-400">دخول آمن عبر جلسة خادمية — لا توجد كلمة مرور افتراضية.</p>
        </section>

        <section className="flex items-center justify-center bg-white p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8">
              <span className="text-xs font-black tracking-[.18em] text-[#a18fae]">مرحبًا بعودتك</span>
              <h2 className="mt-2 text-2xl font-black text-[#2c1b3d]">تسجيل الدخول</h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">أدخل بيانات الحساب التي أنشأها مدير العيادة.</p>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-bold text-gray-700">رمز العيادة</label>
                <input required autoComplete="organization" className="input" dir="ltr" placeholder="clinic-code" value={clinicSlug} onChange={(event) => setClinicSlug(event.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-bold text-gray-700">اسم المستخدم أو رقم الهاتف</label>
                <input required autoComplete="username" className="input" dir="auto" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-bold text-gray-700">كلمة المرور</label>
                <input required autoComplete="current-password" type="password" className="input" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold leading-6 text-red-700">{error}</div>}
              <button type="submit" disabled={submitting} className="btn-accent w-full justify-center py-3 text-base disabled:cursor-wait disabled:opacity-60">
                <i className="fa-solid fa-right-to-bracket" /> {submitting ? "جارٍ التحقق…" : "دخول إلى العيادة"}
              </button>
            </form>
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">إذا كانت هذه أول مرة، على مسؤول النظام تهيئة قاعدة البيانات وإنشاء حساب المدير كما هو موضح في دليل التشغيل.</div>
          </div>
        </section>
      </div>
    </div>
  );
}
