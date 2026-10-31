"use client";
import React, { useEffect, useReducer } from "react";
import { Modal, Field, Input, Select } from "@/components/ui";
// Input يعالج type="date" تلقائياً: dir=ltr + lang=en-GB → عرض dd/mm/yyyy على كل الأجهزة
import { fetchCollection } from "@/lib/api";
import { todayISO } from "@/lib/utils";

const emptyEye = () => ({ SPH: "", CYL: "", AXIS: "" });

const makeInitialState = (exam = null) => {
  const src = exam || {};
  const rx = src.rx || { distance: { OD: {}, OS: {} }, near: { OD: {}, OS: {} } };
  const distance = {
    OD: { ...emptyEye(), ...(rx.distance?.OD || {}) },
    OS: { ...emptyEye(), ...(rx.distance?.OS || {}) },
  };
  const near = {
    OD: { ...emptyEye(), ...(rx.near?.OD || {}) },
    OS: { ...emptyEye(), ...(rx.near?.OS || {}) },
  };

  return {
    distance,
    near,
    pd: src.pd ?? "",
    vaOD: src.vaOD ?? "",
    vaOS: src.vaOS ?? "",
    refraction: src.refraction ?? "",
    examinerId: src.examinerId != null ? String(src.examinerId) : "",
    lensType: src.lensType ?? src.lens ?? "",
    date: src.date || todayISO(),
    reviewDate: src.reviewDate || "",
    notes: src.notes || "",
    price: src.price != null ? String(src.price) : "",
  };
};

function reducer(state, action) {
  switch (action.type) {
    case "rx": {
      const { section, eye, field, value } = action;
      if (value !== "" && !/^-?\d*\.?\d*$/.test(value) && field !== "AXIS") return state;
      if (field === "AXIS" && value !== "" && !/^\d{0,3}$/.test(value)) return state;
      if (field === "AXIS" && value !== "" && (Number(value) < 0 || Number(value) > 180)) return state;
      return {
        ...state,
        [section]: { ...state[section], [eye]: { ...state[section][eye], [field]: value } },
      };
    }
    case "set":
      return { ...state, [action.field]: action.value };
    case "reset":
      return makeInitialState();
    case "hydrate":
      return makeInitialState(action.payload);
    default:
      return state;
  }
}

const LENS_TYPES = ["عدسات أحادية البؤرة", "عدسات متعددة البؤر", "عدسات أسطوانية", "عدسات مضادة للضوء الأزرق", "عدسات لاصقة", "أخرى"];

const RxCell = ({ value, onChange, placeholder }) => (
  <input
    dir="ltr"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className="input h-10 px-2 text-center font-mono text-sm"
  />
);

function EyeRow({ section, eye, state, dispatch }) {
  const set = (field) => (value) => dispatch({ type: "rx", section, eye, field, value });
  const ar = eye === "OD" ? "اليمنى" : "اليسرى";
  return (
    <div className="grid grid-cols-[90px_1fr_1fr_1fr] items-center gap-3">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-11 items-center justify-center rounded-lg text-xs font-black
          ${eye === "OD" ? "bg-purple-100 text-purple-700" : "bg-teal-100 text-teal-700"}`}>{eye}</span>
        <span className="text-xs font-bold text-gray-500">{ar}</span>
      </div>
      <RxCell value={state[section][eye].SPH} onChange={set("SPH")} placeholder="SPH" />
      <RxCell value={state[section][eye].CYL} onChange={set("CYL")} placeholder="CYL" />
      <RxCell value={state[section][eye].AXIS} onChange={set("AXIS")} placeholder="AXIS" />
    </div>
  );
}

function RxSection({ title, icon, section, state, dispatch, tone }) {
  return (
    <div className={`rounded-xl2 border-2 p-4 ${tone}`}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="flex items-center gap-2 font-extrabold text-primary">
          <i className={`fa-solid ${icon}`} /> {title}
        </h4>
        <div className="grid w-full max-w-[260px] grid-cols-3 gap-3 text-center text-[10px] font-black text-gray-400">
          <span>SPH</span><span>CYL</span><span>AXIS</span>
        </div>
      </div>
      <div className="space-y-3">
        <EyeRow section={section} eye="OD" state={state} dispatch={dispatch} />
        <EyeRow section={section} eye="OS" state={state} dispatch={dispatch} />
      </div>
    </div>
  );
}

export default function ExamForm({ patient, exam = null, onClose, onSave }) {
  const [state, dispatch] = useReducer(reducer, exam, makeInitialState);
  const [examiners, setExaminers] = React.useState([]);
  const set = (field) => (e) => dispatch({ type: "set", field, value: e.target.value });

  useEffect(() => {
    dispatch({ type: "hydrate", payload: exam });
  }, [exam]);

  useEffect(() => {
    let ignore = false;
    fetchCollection("examiners", []).then((next) => {
      const list = Array.isArray(next) ? next : [];
      if (ignore) return;
      setExaminers(list);
      if (!state.examinerId && list.length) {
        dispatch({ type: "set", field: "examinerId", value: String(list[0].id) });
      }
    });
    return () => { ignore = true; };
  }, []);

  const submit = () => {
    const examinerId = state.examinerId || (examiners[0]?.id ? String(examiners[0].id) : "");
    if (!examinerId) { window.alert("أضف فاحصًا من شاشة الكادر قبل حفظ الفحص."); return; }
    onSave({
      date: state.date, price: Number(state.price) || 0,
      examinerId, lensType: state.lensType,
      reviewDate: state.reviewDate, notes: state.notes,
      pd: state.pd, vaOD: state.vaOD, vaOS: state.vaOS, refraction: state.refraction,
      rx: { distance: state.distance, near: state.near },
    });
  };

  return (
    <Modal open onClose={onClose} wide title={`نموذج فحص النظر — ${patient.name}`}>
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RxSection title="الرؤية البعيدة (DISTANCE)" icon="fa-mountain-sun" section="distance"
            state={state} dispatch={dispatch} tone="border-purple-200 bg-purple-50/50" />
          <RxSection title="الرؤية القريبة (NEAR)" icon="fa-book-open-reader" section="near"
            state={state} dispatch={dispatch} tone="border-teal-200 bg-teal-50/50" />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="المسافة بين البؤبؤين (PD)">
            <Input dir="ltr" placeholder="مثال: 62" value={state.pd} onChange={set("pd")} />
          </Field>
          <Field label="حدة الإبصار — اليمنى (VA OD)">
            <Input dir="ltr" placeholder="مثال: 6/6" value={state.vaOD} onChange={set("vaOD")} />
          </Field>
          <Field label="حدة الإبصار — اليسرى (VA OS)">
            <Input dir="ltr" placeholder="مثال: 6/9" value={state.vaOS} onChange={set("vaOS")} />
          </Field>
        </div>

        <Field label="نتيجة الانكسار (Refraction Result)">
          <textarea className="input min-h-16" placeholder="اكتب نتيجة الانكسار النهائية..." value={state.refraction} onChange={set("refraction")} />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="الفاحص" required>
            <Select required value={state.examinerId || (examiners[0]?.id ?? "")} onChange={set("examinerId")}>
              <option value="">— اختر الفاحص —</option>
              {examiners.filter((x) => x.active !== false).map((x) => (
                <option key={x.id} value={x.id}>{x.name} — {x.role || "فاحص"}</option>
              ))}
            </Select>
          </Field>
          <Field label="نوع العدسة">
            <Select value={state.lensType} onChange={set("lensType")}>
              <option value="">— اختر نوع العدسة —</option>
              {LENS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="تاريخ الفحص"><Input type="date" value={state.date} onChange={set("date")} /></Field>
          <Field label="موعد المراجعة"><Input type="date" value={state.reviewDate} onChange={set("reviewDate")} /></Field>
          <Field label="سعر الفحص"><Input dir="ltr" type="number" min="0" placeholder="150" value={state.price} onChange={set("price")} /></Field>
        </div>

        <Field label="ملاحظات"><textarea className="input min-h-16" placeholder="ملاحظات إضافية..." value={state.notes} onChange={set("notes")} /></Field>

        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          <button onClick={() => dispatch({ type: "reset" })} className="btn-ghost">
            <i className="fa-solid fa-rotate-right" /> تفريغ الحقول
          </button>
          <div className="flex gap-3">
            <button onClick={onClose} className="btn-outline-danger">إلغاء</button>
            <button onClick={submit} disabled={!examiners.some((item) => item.active !== false)} className="btn-accent disabled:cursor-not-allowed disabled:opacity-50"><i className="fa-solid fa-floppy-disk" /> حفظ الفحص</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
