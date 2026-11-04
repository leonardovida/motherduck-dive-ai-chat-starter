// Small helpers for interface text, shared by the app, the chat panel and the admin portal.

// "{name}" placeholders filled from values; a missing value becomes an empty string.
export function fill(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

// [singular, plural] templates picked by n, with n formatted for the viewer's locale.
export function plural([one, many], n, values = {}) {
  return fill(Number(n) === 1 ? one : many, { ...values, n: Number(n).toLocaleString() });
}

// The reasons a person can give for a "not helpful" answer, in words. The keys match the server's.
export const FEEDBACK_REASONS = {
  wrong_numbers: "Wrong numbers",
  misunderstood: "Misunderstood the question",
  missing_data: "Data is missing",
  too_slow: "Too slow",
  other: "Something else",
};

// The server refuses shorter passwords; forms check first so people see why.
export const MIN_PASSWORD_LENGTH = 12;
