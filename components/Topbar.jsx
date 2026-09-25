"use client";

import React, { useState, useEffect } from "react";
import { longDate } from "@/lib/utils";
import { fetchCollection } from "@/lib/api";
import { roleAr, seedUsers } from "@/lib/data";
import { readStorage } from "@/lib/storage";

export default function Topbar({ title, onMenu }) {
  const [user, setUser] = useState({ name: "مدير العيادة", role: "admin" });

  useEffect(() => {
    let ignore = false;
    const loadUser = async () => {
      const users = await fetchCollection("users", seedUsers);
      const savedUsername = readStorage("clinic-current-user", "admin");
      
      if (!ignore && Array.isArray(users)) {
        const active = users.find(u => String(u.username).toLowerCase() === String(savedUsername).toLowerCase()) || users[0];
        if (active) setUser(active);
      }
    };
    loadUser();
    
    // التحديث عند تغيير البيانات لتنعكس التعديلات فورا
    const refresh = () => loadUser();
    window.addEventListener("clinic-data-updated", refresh);
    return () => {
      ignore = true;
      window.removeEventListener("clinic-data-updated", refresh);
    };
  }, []);

  const initials = user.name ? user.name.substring(0, 2) : "م";

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 shadow-sm sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {/* زر القائمة: يظهر فقط في الشاشات الصغيرة (أقل من lg) */}
        <button
          type="button"
          onClick={onMenu}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-100 lg:hidden"
          aria-label="فتح القائمة"
        >
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
            <div className="text-sm font-extrabold leading-none text-gray-800">{user.name}</div>
            <div className="mt-1 text-[11px] font-bold text-[#eab308]">{roleAr[user.role] || user.role || "مدير العيادة"}</div>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2c1b3d] to-purple-700 font-black text-[#eab308] ring-2 ring-[#eab308]/50 select-none">
            {initials}
          </div>
        </div>
      </div>
    </header>
  );
}
