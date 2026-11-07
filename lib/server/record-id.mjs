import { randomUUID } from "node:crypto";

export function newRecordIdentity(collection) {
  const id = randomUUID();
  if (collection === "patients") {
    const compactId = id.replaceAll("-", "").slice(0, 12).toUpperCase();
    return { id, fileNo: `P-${compactId}` };
  }
  return { id };
}

export function assertSingleCreate(rowCount) {
  if (rowCount !== 1) {
    throw Object.assign(new Error("تعذر إنشاء السجل بسبب تعارض المعرّف. حاول مرة أخرى."), { status: 409 });
  }
}
