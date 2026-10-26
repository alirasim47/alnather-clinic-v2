"use client";
import React, { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import ClinicLogo from "@/components/ClinicLogo";
import { fetchCollection, saveSingleItem } from "@/lib/api";
import { readStorage, STORAGE_KEYS, writeStorage, ensureClinicBaseline } from "@/lib/storage";
import { hashPassword, verifyPassword } from "@/lib/passwords";

const normalizeIdentifier = (value) => String(value || "").trim().toLowerCase();
const normalizePhone = (value) => String(value || "").replace(/[^\d+]/g, "");

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensureClinicBaseline();
    let ignore = false;
    const restoreSession = async () => {
      const users = await fetchCollection("users", []);
      const storedId = readStorage(STORAGE_KEYS.currentUser, null);
      const legacyUsername = readStorage("clinic-current-user", "");
      const user = users.find((entry) => String(entry.id) === String(storedId))
        || users.find((entry) => entry.username?.toLowerCase() === String(legacyUsername).toLowerCase());
      if (!ignore && readStorage(STORAGE_KEYS.auth, false) && user?.active !== false) {
        setCurrentUser(user);
        setAuthed(true);
      } else if (user?.active === false || !user) {
        writeStorage(STORAGE_KEYS.auth, false);
        writeStorage(STORAGE_KEYS.currentUser, null);
      }
      if (!ignore) setReady(true);
    };
    restoreSession();
    return () => { ignore = true; };
  }, []);

  const handleLogin = async ({ identifier, password }) => {
    const users = await fetchCollection("users", []);
    const input = normalizeIdentifier(identifier);
    const inputPhone = normalizePhone(identifier);
    const user = users.find((entry) => {
      const usernameMatches = normalizeIdentifier(entry.username) === input;
      const phoneMatches = Boolean(entry.phone) && normalizePhone(entry.phone) === inputPhone;
      return usernameMatches || phoneMatches;
    });

    if (!user || user.active === false) return { ok: false, message: "اسم المستخدم أو كلمة المرور غير صحيحة، أو أن الحساب موقوف." };
    let valid = await verifyPassword(password, user.passwordHash);

    // ترحيل حساب المدير التجريبي القديم إلى تجزئة PBKDF2 عند أول دخول.
    if (!valid && !user.passwordHash && user.role === "admin" && user.username?.toLowerCase() === "admin" && password === "admin123") {
      const migrated = { ...user, passwordHash: await hashPassword(password) };
      await saveSingleItem("users", migrated);
      valid = true;
      Object.assign(user, migrated);
    }
    if (!valid) {
      const message = !user.passwordHash
        ? "هذا الحساب لا يملك كلمة مرور بعد. على المدير تعيينها من شاشة الموظفين."
        : "اسم المستخدم أو كلمة المرور غير صحيحة.";
      return { ok: false, message };
    }

    writeStorage(STORAGE_KEYS.auth, true);
    writeStorage(STORAGE_KEYS.currentUser, user.id);
    writeStorage("clinic-current-user", user.username);
    setCurrentUser(user);
    setAuthed(true);
    return { ok: true };
  };

  const handleLogout = () => {
    writeStorage(STORAGE_KEYS.auth, false);
    writeStorage(STORAGE_KEYS.currentUser, null);
    writeStorage("clinic-current-user", "");
    setCurrentUser(null);
    setAuthed(false);
  };

  if (!ready) return <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm font-bold text-gray-500">جارٍ تحميل الحساب…</div>;
  if (!authed) return <Login onLogin={handleLogin} />;
  return <Shell onLogout={handleLogout} currentUser={currentUser} />;
}

function Login({ onLogin }) {
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
      const result = await onLogin({ identifier, password });
      if (!result.ok) setError(result.message);
    } catch (loginError) {
      setError(loginError?.message || "تعذر التحقق من الحساب في هذا المتصفح.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#2c1b3d] via-[#341f48] to-[#1d1732] p-4">
      <div className="absolute left-[-80px] top-[-80px] h-60 w-60 rounded-full bg-accent/20 blur-3xl" />
      <div className="absolute bottom-[-100px] right-[-60px] h-72 w-72 rounded-full bg-white/10 blur-3xl" />

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/10 bg-white/8 shadow-[0_30px_80px_rgba(12,8,20,0.55)] backdrop-blur-xl md:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col justify-between bg-[#f7f4fb] p-6 md:p-10">
          <div className="flex items-center justify-between"><span className="text-xs font-bold text-gray-500">v1.1.0</span></div>
          <div className="mt-8">
            <div className="mb-6 flex items-center gap-4">
              <div className="rounded-2xl bg-primary p-3 shadow-lg ring-1 ring-primary/20"><ClinicLogo compact={false} className="justify-center text-white" /></div>
            </div>
            <h1 className="text-3xl font-black leading-tight text-primary">بوابة إدارة العيادة</h1>
            <p className="mt-3 max-w-md text-sm leading-7 text-gray-600">إدارة المرضى والفحوصات والمواعيد والفواتير والمخزون، مع صلاحيات منفصلة لكل موظف.</p>
            <div className="mt-8 space-y-3">
              {["إدارة كاملة للمرضى والفحوصات", "متابعة المراجعات ورسائل واتساب", "موظفون بصلاحيات قابلة للتخصيص", "تقارير وفواتير ومتابعة المدفوعات"].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-success/15 text-success"><i className="fa-solid fa-check text-xs" /></span>
                  <span className="text-sm font-bold text-gray-700">{item}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-8 text-xs font-bold text-gray-400">عيادة العلي — نظام إدارة فحص النظر والبصريات</p>
        </div>

        <div className="flex items-center justify-center bg-white/5 p-6 md:p-8">
          <div className="w-full max-w-md rounded-[24px] border border-white/10 bg-white p-6 shadow-[0_20px_40px_rgba(0,0,0,0.12)]">
            <div className="mb-6 text-center">
              <p className="text-xs font-black tracking-[0.2em] text-gray-400">تسجيل الدخول</p>
              <h2 className="mt-2 text-2xl font-black text-primary">مرحباً بعودتك</h2>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="relative">
                <input required autoComplete="username" className="input pr-11" placeholder="اسم المستخدم أو رقم الهاتف" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
                <i className="fa-regular fa-user absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
              <div className="relative">
                <input required autoComplete="current-password" type="password" className="input pr-11" placeholder="كلمة المرور" value={password} onChange={(event) => setPassword(event.target.value)} />
                <i className="fa-solid fa-lock absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
              {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</div>}
              <button type="submit" disabled={submitting} className="btn-accent w-full py-3 text-base disabled:opacity-60"><i className="fa-solid fa-right-to-bracket" /> {submitting ? "جارٍ التحقق…" : "تسجيل الدخول"}</button>
            </form>
            <div className="mt-5 rounded-xl bg-slate-50 p-3 text-center text-[11px] font-bold leading-5 text-gray-500">
              حساب أول تشغيل لهذه النسخة المحلية: <bdi dir="ltr">admin / admin123</bdi>. غيّر كلمة المرور فورًا، ولا تستخدم هذه النسخة لتخزين بيانات مرضى حقيقية؛ التحقق والصلاحيات ما زالا محليين في المتصفح.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
