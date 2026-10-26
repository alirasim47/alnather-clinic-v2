"use client";

import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import Dashboard from "@/screens/Dashboard";
import Patients from "@/screens/Patients";
import Followups from "@/screens/Followups";
import Examiners from "@/screens/Examiners";
import Invoices from "@/screens/Invoices";
import Products from "@/screens/Products";
import Reports from "@/screens/Reports";
import Users from "@/screens/Users";
import Settings from "@/screens/Settings";
import { canViewPage, hasPermission } from "@/lib/permissions";

const TITLES = {
  dashboard: "لوحة التحكم", patients: "إدارة المرضى", followups: "تنبيهات المراجعات",
  examiners: "الفاحصون والكادر", invoices: "الفواتير والمبيعات", products: "المنتجات والمخزون",
  reports: "التقارير", users: "الموظفون والصلاحيات", settings: "الإعدادات",
};

const PAGE_ORDER = Object.keys(TITLES);

export default function Shell({ onLogout, currentUser }) {
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const can = (permissionId) => hasPermission(currentUser, permissionId);
  const visiblePages = useMemo(() => PAGE_ORDER.filter((pageId) => canViewPage(currentUser, pageId)), [currentUser]);

  useEffect(() => {
    const saved = window.location.hash.replace(/^#\/?/, "");
    const allowed = saved && canViewPage(currentUser, saved) ? saved : visiblePages[0] || "dashboard";
    setPage(allowed);
    window.history.replaceState(null, "", `#${allowed}`);
  }, [currentUser, visiblePages]);

  const go = (next) => {
    if (!canViewPage(currentUser, next)) {
      window.alert("ليس لديك صلاحية لفتح هذا القسم. اطلب من مدير العيادة تعديل صلاحيات حسابك.");
      return;
    }
    setPage(next);
    setSidebarOpen(false);
    window.history.replaceState(null, "", `#${next}`);
  };

  const pageContent = () => {
    if (!canViewPage(currentUser, page)) {
      return <div className="m-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-900">ليس لديك صلاحية لعرض هذا القسم.</div>;
    }
    switch (page) {
      case "dashboard": return <Dashboard go={go} can={can} />;
      case "patients": return <Patients can={can} />;
      case "followups": return <Followups can={can} />;
      case "examiners": return <Examiners can={can} />;
      case "invoices": return <Invoices can={can} />;
      case "products": return <Products can={can} />;
      case "reports": return <Reports can={can} />;
      case "users": return <Users currentUser={currentUser} />;
      case "settings": return <Settings can={can} />;
      default: return null;
    }
  };

  return (
    <div className="relative flex h-[100dvh] overflow-hidden bg-gray-50" dir="rtl">
      <Sidebar page={page} setPage={go} onLogout={onLogout} open={sidebarOpen} onClose={() => setSidebarOpen(false)} currentUser={currentUser} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar title={TITLES[page] || "العيادة"} onMenu={() => setSidebarOpen(true)} user={currentUser} />
        <main className="flex-1 overflow-y-auto overscroll-contain p-4 pb-4 sm:p-6">{pageContent()}</main>
      </div>
    </div>
  );
}
