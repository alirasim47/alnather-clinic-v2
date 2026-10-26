"use client";
import React, { useEffect, useState } from "react";
import { Badge, Card, EmptyRow, Field, Input, Modal, Select, Toggle } from "@/components/ui";
import { seedUsers, roleAr } from "@/lib/data";
import { deleteSingleItem, fetchCollection, saveSingleItem } from "@/lib/api";
import { hashPassword } from "@/lib/passwords";
import { normalizePermissions, PERMISSION_GROUPS, permissionsForRole } from "@/lib/permissions";

const EMPTY_FORM = {
  name: "", username: "", phone: "", role: "receptionist", active: true,
  password: "", permissions: permissionsForRole("receptionist"),
};

export default function Users({ currentUser }) {
  const [list, setList] = useState(seedUsers);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    fetchCollection("users", seedUsers).then((rows) => { if (!ignore) setList(rows); });
    return () => { ignore = true; };
  }, []);

  const openAdd = () => {
    setEditing(null);
    setError("");
    setForm({ ...EMPTY_FORM, permissions: permissionsForRole("receptionist") });
    setOpen(true);
  };

  const openEdit = (user) => {
    if (user.role === "admin" && (currentUser?.role !== "admin" || String(user.id) !== String(currentUser.id))) return;
    setEditing(user);
    setError("");
    setForm({
      name: user.name || "", username: user.username || "", phone: user.phone || "",
      role: user.role || "receptionist", active: user.active !== false, password: "",
      permissions: normalizePermissions(user),
    });
    setOpen(true);
  };

  const closeModal = () => { setOpen(false); setEditing(null); setForm(EMPTY_FORM); setError(""); };

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setError("");
    const cleaned = {
      ...form,
      name: form.name.trim(),
      username: form.username.trim().toLowerCase(),
      phone: form.phone.trim(),
    };
    if (editing?.role === "admin" && (currentUser?.role !== "admin" || String(editing.id) !== String(currentUser.id))) {
      setError("لا يمكن تعديل حساب المدير من حساب موظف آخر.");
      return;
    }
    if (!cleaned.name || !cleaned.username) { setError("أدخل الاسم واسم المستخدم."); return; }
    if (!editing && cleaned.password.length < 8) { setError("كلمة المرور مطلوبة ويجب ألا تقل عن 8 أحرف."); return; }
    if (cleaned.password && cleaned.password.length < 8) { setError("يجب ألا تقل كلمة المرور عن 8 أحرف."); return; }

    const duplicate = list.find((user) =>
      user.id !== (editing?.id ?? null) && user.username?.toLowerCase() === cleaned.username
    );
    if (duplicate) { setError("اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر."); return; }
    const duplicatePhone = cleaned.phone && list.find((user) =>
      user.id !== (editing?.id ?? null) && user.phone && user.phone.replace(/\s+/g, "") === cleaned.phone.replace(/\s+/g, "")
    );
    if (duplicatePhone) { setError("رقم الهاتف مسجل لحساب موظف آخر."); return; }

    setSaving(true);
    try {
      const payload = {
        ...(editing || {}),
        id: editing?.id ?? Date.now(),
        name: cleaned.name,
        username: cleaned.username,
        phone: cleaned.phone,
        role: editing?.role === "admin" ? "admin" : cleaned.role,
        active: editing?.role === "admin" || String(editing?.id) === String(currentUser?.id) ? true : Boolean(cleaned.active),
        permissions: editing?.role === "admin" ? permissionsForRole("admin") : { ...cleaned.permissions, "users.manage": false },
      };
      if (cleaned.password) payload.passwordHash = await hashPassword(cleaned.password);
      if (payload.role === "admin") payload.permissions = permissionsForRole("admin");

      const result = await saveSingleItem("users", payload);
      if (result) {
        setList((current) => editing
          ? current.map((user) => String(user.id) === String(editing.id) ? payload : user)
          : [...current, payload]);
        closeModal();
      } else {
        setError("تعذر حفظ بيانات الموظف.");
      }
    } catch (saveError) {
      setError(saveError?.message || "حدث خطأ أثناء حفظ الحساب.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user, active) => {
    if (user.role === "admin" || String(user.id) === String(currentUser?.id)) return;
    const payload = { ...user, active };
    const result = await saveSingleItem("users", payload);
    if (result) setList((current) => current.map((item) => String(item.id) === String(user.id) ? payload : item));
  };

  const removeUser = async (user) => {
    if (user.role === "admin" || String(user.id) === String(currentUser?.id)) {
      window.alert("لا يمكن حذف حساب المدير أو الحساب المستخدم حاليًا.");
      return;
    }
    if (!window.confirm(`هل تريد حذف حساب الموظف «${user.name}»؟`)) return;
    const result = await deleteSingleItem("users", user.id);
    if (result !== null) setList((current) => current.filter((item) => String(item.id) !== String(user.id)));
  };

  const updatePermission = (permissionId, allowed) => {
    setForm((current) => ({ ...current, permissions: { ...current.permissions, [permissionId]: allowed } }));
  };

  const isAdmin = editing?.role === "admin";

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-primary font-black text-lg">
              <i className="fa-solid fa-users-gear text-accent" />
              <span>الموظفون والصلاحيات</span>
            </div>
            <p className="mt-1 text-sm text-gray-500">أنشئ حسابًا لكل موظف، ثم اختر الأقسام والإجراءات المسموح بها.</p>
          </div>
          <button onClick={openAdd} className="btn-accent"><i className="fa-solid fa-plus" /> إضافة موظف</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr><th className="th">الاسم</th><th className="th">اسم المستخدم / الهاتف</th><th className="th">الدور</th><th className="th">الحالة</th><th className="th">إجراءات</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {list.length === 0 && <EmptyRow span={5} />}
              {list.map((user) => {
                const protectedAccount = user.role === "admin";
                const isCurrent = String(user.id) === String(currentUser?.id);
                const canEditAccount = !protectedAccount || (currentUser?.role === "admin" && isCurrent);
                return (
                  <tr key={user.id} className="hover:bg-accent-soft/40">
                    <td className="td font-bold text-gray-800">
                      {user.name}
                      {isCurrent && <span className="mr-2 text-[10px] font-bold text-gray-400">(حسابك)</span>}
                    </td>
                    <td className="td text-gray-500" dir="ltr">
                      <div>{user.username}</div>
                      {user.phone && <div className="mt-1 text-xs">{user.phone}</div>}
                    </td>
                    <td className="td"><Badge color={protectedAccount ? "yellow" : user.role === "accountant" ? "blue" : "gray"}>{roleAr[user.role] || user.role}</Badge></td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <Toggle on={user.active !== false} disabled={protectedAccount || isCurrent} onChange={(value) => toggleActive(user, value)} />
                        <span className={`text-xs font-bold ${user.active !== false ? "text-success" : "text-gray-400"}`}>{user.active !== false ? "نشط" : "موقوف"}</span>
                      </div>
                    </td>
                    <td className="td">
                      <div className="flex gap-1">
                        <button aria-label={`تعديل ${user.name}`} disabled={!canEditAccount} onClick={() => openEdit(user)} className="icon-btn text-info hover:bg-info hover:text-white disabled:cursor-not-allowed disabled:opacity-30"><i className="fa-solid fa-pen" /></button>
                        <button aria-label={`حذف ${user.name}`} disabled={protectedAccount || isCurrent} onClick={() => removeUser(user)} className="icon-btn text-danger hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-30"><i className="fa-solid fa-trash" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {open && (
        <Modal open wide onClose={closeModal} title={editing ? "تعديل حساب الموظف وصلاحياته" : "إضافة موظف جديد"}>
          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الاسم الكامل" required>
                <Input required maxLength={100} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field label="اسم المستخدم" required>
                <Input required maxLength={60} dir="ltr" autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
              </Field>
              <Field label="رقم الهاتف — اختياري، ويُستخدم لتسجيل الدخول">
                <Input type="tel" maxLength={30} dir="ltr" autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              </Field>
              <Field label={editing ? "كلمة مرور جديدة — اتركها فارغة للإبقاء على الحالية" : "كلمة المرور"} required={!editing}>
                <Input type="password" minLength={8} autoComplete={editing ? "new-password" : "new-password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editing ? "••••••••" : "8 أحرف على الأقل"} />
              </Field>
              <Field label="الدور الوظيفي">
                <Select disabled={isAdmin} value={form.role} onChange={(event) => {
                  const role = event.target.value;
                  setForm((current) => ({ ...current, role, permissions: permissionsForRole(role) }));
                }}>
                  <option value="accountant">محاسب</option>
                  <option value="receptionist">موظف استقبال</option>
                  <option value="examiner">طبيب / فاحص</option>
                  {isAdmin && <option value="admin">مدير العيادة</option>}
                </Select>
              </Field>
              {!isAdmin && (
                <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                  <span className="font-bold text-gray-700">حساب نشط</span>
                  <Toggle on={form.active} disabled={String(editing?.id) === String(currentUser?.id)} onChange={(value) => setForm({ ...form, active: value })} />
                </div>
              )}
            </div>

            <section className="space-y-3 rounded-2xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-black text-primary">صلاحيات هذا الموظف</h3>
                  <p className="mt-1 text-xs leading-5 text-gray-500">يمكن تخصيص الصلاحيات بعد اختيار الدور. المدير يملك جميع الصلاحيات ولا يمكن تقليلها.</p>
                </div>
                {!isAdmin && <button type="button" className="btn-ghost text-sm" onClick={() => setForm((current) => ({ ...current, permissions: permissionsForRole(current.role) }))}>استعادة صلاحيات الدور الافتراضية</button>}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {PERMISSION_GROUPS.map((group) => (
                  <fieldset key={group.id} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3" disabled={isAdmin}>
                    <legend className="px-1 text-sm font-extrabold text-gray-800">{group.label}</legend>
                    <div className="mt-1 space-y-2">
                      {group.permissions.map((permission) => (
                        <label key={permission.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm text-gray-700">
                          <span>{permission.label}</span>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[#eab308]"
                            checked={isAdmin || (permission.id === "users.manage" ? false : Boolean(form.permissions[permission.id]))}
                            disabled={isAdmin || permission.id === "users.manage"}
                            onChange={(event) => updatePermission(permission.id, event.target.checked)}
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </section>

            {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</div>}
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              تنبيه: هذه النسخة تحفظ الحسابات والصلاحيات محليًا في المتصفح. لا تعتبر هذه القيود حماية خادمية لبيانات المرضى؛ يلزم ربطها بخادم وقاعدة بيانات قبل الاستخدام عبر الإنترنت أو تخزين بيانات حقيقية.
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button type="button" onClick={closeModal} className="btn-outline-danger">إلغاء</button>
              <button type="submit" disabled={saving} className="btn-accent disabled:cursor-wait disabled:opacity-60"><i className="fa-solid fa-floppy-disk" /> {saving ? "جارٍ الحفظ…" : editing ? "حفظ التعديلات" : "إنشاء الحساب"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
