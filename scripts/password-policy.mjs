const PLACEHOLDER_MARKERS = ["replace", "changeme", "yourpassword", "placeholder", "example", "dummy", "sample", "password"];

export function validateAdminPassword(value) {
  const password = String(value ?? "");
  const normalized = password.toLowerCase().replace(/[\s_-]+/g, "");
  if (PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))) {
    return "must not be a placeholder value";
  }
  if (password.length < 16) return "must contain at least 16 characters";

  const characterClasses = [
    /\p{Ll}/u,
    /\p{Lu}/u,
    /\p{N}/u,
    /[^\p{L}\p{N}\s]/u,
  ].filter((pattern) => pattern.test(password)).length;
  if (characterClasses < 3) {
    return "must include at least three character classes: lowercase, uppercase, numbers, and symbols";
  }
  return null;
}
