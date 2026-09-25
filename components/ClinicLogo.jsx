"use client";
import React, { useEffect, useState } from "react";
import { fetchCollection } from "@/lib/api";

export default function ClinicLogo({ compact = false, className = "" }) {
  const [logo, setLogo] = useState(null);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      const s = await fetchCollection("settings", {});
      if (!ignore && s && typeof s === "object" && s.logo) setLogo(s.logo);
    };
    load();
    const onUpdate = () => load();
    if (typeof window !== "undefined") {
      window.addEventListener("clinic-data-updated", onUpdate);
    }
    return () => {
      ignore = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("clinic-data-updated", onUpdate);
      }
    };
  }, []);

  return (
    <div className={`flex items-center ${compact ? "gap-2" : "flex-col gap-2"} ${className}`}>
      <img
        src={logo || "/clinic-logo.png"}
        alt="شعار العيادة"
        className={compact ? "h-12 w-12 object-contain" : "h-32 w-auto object-contain"}
      />
    </div>
  );
}
