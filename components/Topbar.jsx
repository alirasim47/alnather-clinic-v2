"use client";

import React from "react";
import { longDate } from "@/lib/utils";
import { roleAr } from "@/lib/data";

export default function Topbar({ title, onMenu, user }) {
  const name = user?.name || "مستخدم";
  const initials = name.substring(0, 2);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 shadow-sm sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onMenu} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-100 lg:hidden" aria-label="فتح القائمة">
          <i className="fa-solid fa-bars text-xl" />
        </button>
        <h1 className="truncate text-lg font-extrabold text-[#2c1b3d] sm:text-xl">{title}</h1>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-4">
        <span className="hidden min-w-0 items-center gap-2 text-sm font-medium text-gray-500 md:flex">
          <i className="fa-regular fa-calendar-days text-[#eab308]" />
          <bdi className="date-display whitespace-nowrap" dir="rtl">{longDate()}</bdi>
        </span>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-sm font-extrabold leading-none text-gray-800">{name}</div>
            <div className="mt-1 text-[11px] font-bold text-[#eab308]">{roleAr[user?.role] || user?.role || "موظف"}</div>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2c1b3d] to-purple-700 font-black text-[#eab308] ring-2 ring-[#eab308]/50 select-none">{initials}</div>
        </div>
      </div>
    </header>
  );
}
