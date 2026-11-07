const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

function stableJson(value, depth = 0) {
  if (depth > 25) return "[depth-limit]";
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item, depth + 1)).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key], depth + 1)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeAuditValue(value, depth = 0) {
  if (depth > 25) return "[depth-limit]";
  if (Array.isArray(value)) return value.map((item) => safeAuditValue(item, depth + 1));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeAuditValue(item, depth + 1)]));
  }
  if (typeof value === "string" && /^data:[^,]+;base64,/i.test(value)) {
    return { omitted: "embedded-binary", characterCount: value.length };
  }
  return value;
}

export function auditSnapshot(before, after) {
  if (before === null || after === null) return { before: safeAuditValue(before), after: safeAuditValue(after) };
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter((key) => stableJson(before?.[key]) !== stableJson(after?.[key]));
  return {
    before: Object.fromEntries(keys.map((key) => [key, Object.hasOwn(before || {}, key) ? safeAuditValue(before[key]) : null])),
    after: Object.fromEntries(keys.map((key) => [key, Object.hasOwn(after || {}, key) ? safeAuditValue(after[key]) : null])),
  };
}
