import bcrypt from "bcryptjs";

const COST = 12;

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("يجب ألا تقل كلمة المرور عن 8 أحرف.");
  }
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string" || !encoded.startsWith("$2")) return false;
  try {
    return await bcrypt.compare(password, encoded);
  } catch {
    return false;
  }
}
