"use client";

import React from "react";
import ClinicLogo from "./ClinicLogo";

const NAV = [
  { id: "dashboard",  label: "الرئيسية",           icon: "fa-house" },
  { id: "patients",   label: "المرضى",              icon: "fa-users" },
  { id: "followups",  label: "تنبيهات المراجعات",   icon: "fa-bell" },
  { id: "examiners",  label: "الفاحصون",             icon: "fa-user-doctor" },
  { id: "invoices",   label: "الفواتير",             icon: "fa-file-invoice-dollar" },
  { id: "products",   label: "المنتجات",             icon: "fa-boxes-stacked" },
  { id: "reports",    label: "التقارير",             icon: "fa-chart-column" },
  { id: "users",      label: "المستخدمون",           icon: "fa-user-shield" },
  { id: "settings",   label: "الإعدادات",            icon: "fa-gear" },
];

export default function Sidebar({ page, setPage, onLogout, open, onClose }) {
  return (
    <>
      {/* طبقة التعتيم خلف القائمة على الموبايل */}
      <div
        className={`fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden
          ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/*
        القائمة الجانبية:
        - موبايل/تابلت: fixed تنزلق من اليمين (RTL) فوق المحتوى
        - lg+: static داخل الـ flex layout، لا تُغطي المحتوى
      */}
      <aside
        aria-label="القائمة الرئيسية"
        className={`
          fixed inset-y-0 right-0 z-[60] flex h-[100dvh] w-[min(82vw,17rem)] shrink-0
          flex-col bg-[#2c1b3d] text-white shadow-2xl
          transition-transform duration-300 ease-in-out
          ${open ? "translate-x-0" : "translate-x-full"}
          lg:static lg:z-auto lg:h-auto lg:min-h-[100dvh] lg:translate-x-0 lg:shadow-none
        `}
      >
        {/* رأس القائمة */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <ClinicLogo compact={false} className="justify-start text-white" />
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق القائمة"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60
              hover:bg-white/10 hover:text-white lg:hidden"
          >
            <i className="fa-solid fa-xmark text-xl" />
          </button>
        </div>

        {/* عناصر التنقل */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {NAV.map((item) => {
            const active = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPage(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition
                  ${active
                    ? "bg-[#eab308] text-[#2c1b3d] shadow-md"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
              >
                <i className={`fa-solid ${item.icon} w-5 shrink-0 text-center text-base`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* تسجيل الخروج */}
        <div className="shrink-0 border-t border-white/10 p-3">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold
              text-white/70 transition hover:bg-red-500/20 hover:text-red-400"
          >
            <i className="fa-solid fa-right-from-bracket w-5 shrink-0 text-center text-base" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>
    </>
  );
}
