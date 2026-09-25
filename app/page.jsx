"use client";
import React, { useState, useEffect } from "react";
import Shell from "@/components/Shell";
import ClinicLogo from "@/components/ClinicLogo";
import { readStorage, STORAGE_KEYS, writeStorage, ensureClinicBaseline } from "@/lib/storage";

export default function Home() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    ensureClinicBaseline();
    const saved = readStorage(STORAGE_KEYS.auth, false);
    setAuthed(Boolean(saved));
  }, []);

  const handleLogin = (username) => {
    writeStorage(STORAGE_KEYS.auth, true);
    writeStorage("clinic-current-user", username);
    setAuthed(true);
  };

  const handleLogout = () => {
    writeStorage(STORAGE_KEYS.auth, false);
    writeStorage("clinic-current-user", "");
    setAuthed(false);
  };

  if (!authed) return <Login onLogin={handleLogin} />;
  return <Shell onLogout={handleLogout} />;
}

function Login({ onLogin }) {
  const [u, setU] = useState("admin");
  const [p, setP] = useState("admin123");
  const [error, setError] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (u.trim() === "admin" && p === "admin123") {
      setError("");
      onLogin(u.trim());
      return;
    }
    setError("اسم المستخدم أو كلمة المرور غير صحيحة");
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#2c1b3d] via-[#341f48] to-[#1d1732] p-4">
      <div className="absolute left-[-80px] top-[-80px] h-60 w-60 rounded-full bg-accent/20 blur-3xl" />
      <div className="absolute bottom-[-100px] right-[-60px] h-72 w-72 rounded-full bg-white/10 blur-3xl" />

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/10 bg-white/8 shadow-[0_30px_80px_rgba(12,8,20,0.55)] backdrop-blur-xl md:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col justify-between bg-[#f7f4fb] p-6 md:p-10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500">v1.0.0</span>
          </div>

          <div className="mt-8">
            <div className="mb-6 flex items-center gap-4">
              <div className="rounded-2xl bg-primary p-3 shadow-lg ring-1 ring-primary/20">
                <ClinicLogo compact={false} className="justify-center text-white" />
              </div>
            </div>

            <h1 className="text-3xl font-black leading-tight text-primary">بوابة إدارة العيادة</h1>
            <p className="mt-3 max-w-md text-sm leading-7 text-gray-600">
              نظام متكامل لإدارة المرضى، الفحوصات، المراجعات، المخزون، والـ invoices
              في واجهة احترافية ومصممة لتلبية احتياجات التشغيل اليومي للعيادة.
            </p>

            <div className="mt-8 space-y-3">
              {[
                "إدارة كاملة للمرضى والفحوصات",
                "متابعة مراجعات واتساب وملفات المريض",
                "مخزون ومنتجات مع تنبيهات تلقائية",
                "تقارير وفواتير ومتابعة المدفوعات",
              ].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-success/15 text-success">
                    <i className="fa-solid fa-check text-xs" />
                  </span>
                  <span className="text-sm font-bold text-gray-700">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-8 text-xs font-bold text-gray-400">
            عيادة العلي — نظام إدارة فحص النظر والبصريات
          </p>
        </div>

        <div className="flex items-center justify-center bg-white/5 p-6 md:p-8">
          <div className="w-full max-w-md rounded-[24px] border border-white/10 bg-white p-6 shadow-[0_20px_40px_rgba(0,0,0,0.12)]">
            <div className="mb-6 text-center">
              <p className="text-xs font-black tracking-[0.2em] text-gray-400">تسجيل الدخول</p>
              <h2 className="mt-2 text-2xl font-black text-primary">مرحباً بعودتك</h2>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div className="relative">
                <input
                  className="input pr-11" placeholder="اسم المستخدم" value={u}
                  onChange={(e) => setU(e.target.value)}
                />
                <i className="fa-regular fa-user absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
              <div className="relative">
                <input
                  type="password" className="input pr-11" placeholder="كلمة المرور" value={p}
                  onChange={(e) => setP(e.target.value)}
                />
                <i className="fa-solid fa-lock absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>

              {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</div>}

              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" defaultChecked className="h-4 w-4 accent-yellow-500" />
                تذكرني على هذا الجهاز
              </label>

              <button type="submit" className="btn-accent w-full py-3 text-base">
                <i className="fa-solid fa-right-to-bracket" /> تسجيل الدخول
              </button>
            </form>

            <div className="mt-5 rounded-xl bg-slate-50 p-3 text-center text-[11px] font-bold text-gray-500">
              بيانات الدخول التجريبية: admin / admin123
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
