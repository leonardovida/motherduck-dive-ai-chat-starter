// How the admin Activity tab prints an audit entry's detail. Nested objects, such as the model
// tiers, and arrays of objects read as "key value" pairs rather than [object Object].
export function showValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(showValue).join(", ") || "—";
  if (typeof value === "object") return Object.entries(value).map(([key, inner]) => `${key} ${showValue(inner)}`).join(", ") || "—";
  return String(value);
}

export function describeDetail(detail) {
  if (!detail || typeof detail !== "object") return "";
  return Object.entries(detail)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${showValue(value)}`)
    .join(" · ");
}
