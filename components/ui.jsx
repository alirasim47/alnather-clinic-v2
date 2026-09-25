"use client";
import React from "react";

export const Card = ({ className = "", children }) => (
  <div className={`rounded-2xl border border-gray-100 bg-white shadow-sm ${className}`}>{children}</div>
);

export const CardHeader = ({ icon, title, action }) => (
  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-4">
    <div className="flex items-center gap-2.5">
      {icon && <span className="text-[#eab308]">{icon}</span>}
      <h3 className="text-base font-extrabold text-[#2c1b3d]">{title}</h3>
    </div>
    {action}
  </div>
);

/*
  Modal محسَّن للموبايل والتابلت:
  - z-[200] لضمان الظهور فوق السايدبار (z-[60]) والـ topbar (z-30)
  - المحتوى يكون داخل inset-0 وله margin خاص به
  - على الموبايل: يأخذ أغلب الشاشة من الأسفل (bottom sheet style)
  - على sm+: يكون في المنتصف كـ dialog
*/
export function Modal({ open, onClose, title, children, wide = false }) {
  // منع تمرير الخلفية عند فتح المودال
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center"
      dir="rtl"
      role="presentation"
    >
      {/* خلفية معتمة */}
      <div
        className="absolute inset-0 bg-[#2c1b3d]/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* صندوق المودال */}
      <div
        role="dialog"
        aria-modal="true"
        className={`
          relative z-10 flex w-full flex-col overflow-hidden bg-white shadow-2xl
          rounded-t-2xl sm:rounded-2xl
          max-h-[92dvh] sm:max-h-[90dvh]
          ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"}
          sm:mx-4
        `}
      >
        {/* رأس المودال */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4 py-3 sm:px-6 sm:py-4">
          <h3 className="truncate pr-2 text-base font-extrabold text-[#2c1b3d] sm:text-lg">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق النافذة"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400
              transition hover:bg-red-50 hover:text-red-500"
          >
            <i className="fa-solid fa-xmark text-lg" />
          </button>
        </div>

        {/* محتوى المودال — قابل للتمرير */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

export const Field = ({ label, required, children }) => (
  <div className="min-w-0">
    <label className="mb-1.5 block text-sm font-bold text-gray-700">
      {label}{required && <span className="text-red-500"> *</span>}
    </label>
    {children}
  </div>
);

/*
  Input محسَّن:
  - حقول التاريخ والوقت: dir="ltr" + lang="en-GB" لعرض dd/mm/yyyy
  - min-h-[44px] لسهولة اللمس على الموبايل
*/
export const Input = ({ icon, className = "", onFocus, onBlur, ...props }) => {
  const [focused, setFocused] = React.useState(false);
  const isDate = props.type === "date";
  const isEmpty = isDate && !props.value && !focused;

  const handleFocus = (e) => {
    setFocused(true);
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e) => {
    setFocused(false);
    if (onBlur) onBlur(e);
  };

  const controlClass = `w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm
    transition focus:border-[#eab308] focus:outline-none focus:ring-2 focus:ring-[#eab308]/30
    min-h-[44px] ${className}`;

  return (
    <div className="relative">
      <input 
        {...props} 
        onFocus={handleFocus} 
        onBlur={handleBlur} 
        className={`${controlClass} ${icon ? "pr-10" : ""}`} 
      />
      
      {icon && (
        <i className={`fa-solid ${icon} absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none`} />
      )}
      
      {/* القناع الذكي لإخفاء النص المقلوب (ةنس/رهش/موي) وإظهار العبارة الصحيحة */}
      {isEmpty && (
        <div 
          className="absolute inset-y-[2px] left-10 bg-white flex items-center pointer-events-none text-gray-400 text-sm" 
          style={{ right: '2px', paddingRight: icon ? '2.5rem' : '0.75rem' }}
        >
          سنة / شهر / يوم
        </div>
      )}
    </div>
  );
};

export const Select = ({ children, className = "", ...props }) => (
  <select
    {...props}
    className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm
      transition focus:border-[#eab308] focus:outline-none focus:ring-2 focus:ring-[#eab308]/30
      min-h-[44px] appearance-none cursor-pointer ${className}`}
  >
    {children}
  </select>
);

export const Toggle = ({ on = false, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={Boolean(on)}
    onClick={() => onChange?.(!on)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition
      ${on ? "bg-emerald-500" : "bg-gray-300"}`}
  >
    <span
      className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform
        ${on ? "translate-x-5" : "translate-x-0.5"}`}
    />
  </button>
);

export const Badge = ({ color, children }) => {
  const map = {
    green:  "bg-emerald-50 text-emerald-700",
    red:    "bg-red-50 text-red-700",
    orange: "bg-orange-50 text-orange-700",
    blue:   "bg-blue-50 text-blue-700",
    gray:   "bg-gray-100 text-gray-600",
    yellow: "bg-yellow-50 text-yellow-700",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${map[color] || map.gray}`}>
      {children}
    </span>
  );
};

export const EmptyRow = ({ span, text = "لا توجد بيانات لعرضها" }) => (
  <tr>
    <td colSpan={span} className="py-10 text-center text-sm text-gray-400">
      <i className="fa-regular fa-folder-open ml-2 align-middle text-2xl" />{text}
    </td>
  </tr>
);
