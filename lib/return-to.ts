const fallbackPath = "/dashboard";
const validationOrigin = "https://lumina-return.invalid";

function containsUnsafePathCharacters(value: string) {
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return true;
  let decoded = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (/[\\\u0000-\u001f\u007f]/.test(next)) return true;
      if (next === decoded) break;
      decoded = next;
    } catch {
      return true;
    }
  }
  return false;
}

export function safeRelativeReturnTo(value: string | null | undefined, fallback = fallbackPath) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || containsUnsafePathCharacters(value)) {
    return fallback;
  }
  try {
    const target = new URL(value, validationOrigin);
    if (target.origin !== validationOrigin) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
