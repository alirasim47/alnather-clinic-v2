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
import LensInventory from "@/screens/LensInventory";
import Branches from "@/screens/Branches";
import Expenses from "@/screens/Expenses";
import Returns from "@/screens/Returns";
import Transfers from "@/screens/Transfers";
import { canViewPage, hasPermission } from "@/lib/permissions";

const TITLES = {
  dashboard: "لوحة التحكم", patients: "إدارة المرضى", followups: "تنبيهات المراجعات",
  examiners: "الفاحصون والكادر", invoices: "الفواتير والمبيعات", products: "المنتجات والمخزون",
  lensInventory: "مخزون العدسات بالقياس", branches: "الفروع", expenses: "المصاريف",
  returns: "العوائد", transfers: "نقل المخزون",
  reports: "التقارير", users: "الموظفون والصلاحيات", settings: "الإعدادات",
};

const PAGE_ORDER = Object.keys(TITLES);

export default function Shell({ onLogout, currentUser }) {
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [apiError, setApiError] = useState("");
  const can = (permissionId) => hasPermission(currentUser, permissionId);
  const visiblePages = useMemo(() => PAGE_ORDER.filter((pageId) => canViewPage(currentUser, pageId)), [currentUser]);

  useEffect(() => {
    const saved = window.location.hash.replace(/^#\/?/, "");
    const allowed = saved && canViewPage(currentUser, saved) ? saved : visiblePages[0] || "dashboard";
    setPage(allowed);
    window.history.replaceState(null, "", `#${allowed}`);
  }, [currentUser, visiblePages]);

  useEffect(() => {
    const onError = (event) => setApiError(event.detail || "تعذر تحميل بيانات العيادة من الخادم.");
    window.addEventListener("clinic-api-error", onError);
    return () => window.removeEventListener("clinic-api-error", onError);
  }, []);

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
      case "invoices": return <Invoices can={can} currentUser={currentUser} />;
      case "products": return <Products can={can} currentUser={currentUser} />;
      case "lensInventory": return <LensInventory can={can} currentUser={currentUser} />;
      case "branches": return <Branches can={can} />;
      case "expenses": return <Expenses can={can} currentUser={currentUser} />;
      case "returns": return <Returns can={can} />;
      case "transfers": return <Transfers can={can} currentUser={currentUser} />;
      case "reports": return <Reports can={can} />;
      case "users": return <Users currentUser={currentUser} />;
      case "settings": return <Settings can={can} currentUser={currentUser} />;
      default: return null;
    }
  };

  return (
    <div className="relative flex h-[100dvh] overflow-hidden bg-gray-50" dir="rtl">
      <Sidebar page={page} setPage={go} onLogout={onLogout} open={sidebarOpen} onClose={() => setSidebarOpen(false)} currentUser={currentUser} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar title={TITLES[page] || "العيادة"} onMenu={() => setSidebarOpen(true)} user={currentUser} />
        <main className="flex-1 overflow-y-auto overscroll-contain p-4 pb-4 sm:p-6">
          {apiError && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800"><span><i className="fa-solid fa-triangle-exclamation ml-2" />{apiError}</span><button type="button" onClick={() => window.location.reload()} className="underline">إعادة المحاولة</button></div>}
          {pageContent()}
        </main>
      </div>
    </div>
  );
}
