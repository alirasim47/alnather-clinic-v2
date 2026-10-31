import { DEFAULT_CLINIC_SETTINGS } from "./storage";

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function notify(collection) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("clinic-data-updated", { detail: { collection } }));
  }
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.");
  }

  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    throw new ApiError(payload.error || "تعذر تنفيذ الطلب.", response.status, payload);
  }
  return Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload;
}

export async function fetchCollection(name, fallback) {
  const defaultValue = name === "settings" ? (fallback ?? DEFAULT_CLINIC_SETTINGS) : [];
  try {
    const data = await apiRequest(`/api/collections/${encodeURIComponent(name)}`);
    if (name === "settings") return data && typeof data === "object" ? { ...DEFAULT_CLINIC_SETTINGS, ...data } : defaultValue;
    return Array.isArray(data) ? data : defaultValue;
  } catch (error) {
    if (typeof window !== "undefined" && error?.status !== 401 && error?.status !== 403) {
      window.dispatchEvent(new CustomEvent("clinic-api-error", { detail: error.message }));
    }
    return defaultValue;
  }
}

export async function saveCollection(name, rows) {
  const data = await apiRequest(`/api/collections/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(rows),
  });
  notify(name);
  return data;
}

export async function saveSingleItem(name, item) {
  if (!item || typeof item !== "object") throw new ApiError("بيانات السجل غير صالحة.", 400);
  if (name === "settings") return saveCollection(name, item);
  const id = item.id ?? (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const data = await apiRequest(`/api/collections/${encodeURIComponent(name)}/${encodeURIComponent(String(id))}`, {
    method: "PUT",
    body: JSON.stringify({ ...item, id }),
  });
  notify(name);
  return data;
}

export async function deleteSingleItem(name, id) {
  const data = await apiRequest(`/api/collections/${encodeURIComponent(name)}/${encodeURIComponent(String(id))}`, { method: "DELETE" });
  notify(name);
  return data;
}

export async function createSale(payload) {
  const data = await apiRequest("/api/business/sales", { method: "POST", body: JSON.stringify(payload) });
  notify("invoices");
  notify("products");
  notify("lensInventory");
  notify("stockBatches");
  notify("stockMovements");
  return data;
}

export async function createReturn(payload) {
  const data = await apiRequest("/api/business/returns", { method: "POST", body: JSON.stringify(payload) });
  notify("returns");
  notify("invoices");
  notify("products");
  notify("lensInventory");
  notify("stockBatches");
  return data;
}

export async function recordInvoicePayment(payload) {
  const data = await apiRequest("/api/business/payments", { method: "POST", body: JSON.stringify(payload) });
  notify("invoices");
  return data;
}

export async function createStockBatch(payload) {
  const data = await apiRequest("/api/business/stock-batches", { method: "POST", body: JSON.stringify(payload) });
  notify("products");
  notify("stockBatches");
  notify("stockMovements");
  return data;
}

export async function createTransfer(payload) {
  const data = await apiRequest("/api/business/transfers", { method: "POST", body: JSON.stringify(payload) });
  notify("transfers");
  return data;
}

export async function resolveTransfer(id, action) {
  const data = await apiRequest(`/api/business/transfers/${encodeURIComponent(String(id))}/${action}`, { method: "POST", body: JSON.stringify({}) });
  notify("transfers");
  notify("products");
  notify("stockBatches");
  notify("stockMovements");
  return data;
}

export async function previewImport(payload) {
  return apiRequest("/api/admin/import/preview", { method: "POST", body: JSON.stringify(payload) });
}

export async function applyImport(payload) {
  const result = await apiRequest("/api/admin/import", { method: "POST", body: JSON.stringify(payload) });
  notify("all");
  return result;
}
