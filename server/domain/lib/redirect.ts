/**
 * Only allow same-site relative paths as post-auth redirect targets (prevents open redirects like
 * `?next=https://evil.example` or `?next=//evil.example`).
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // Browsers strip tabs/newlines and read "\" as "/" while parsing URLs, so "/\t/evil.example" would become
  // "//evil.example". Refuse any control character or backslash anywhere, and absurdly long values.
  if (/[\u0000-\u001f\u007f\\]/.test(raw) || raw.length > 2048) return fallback;
  return raw;
}
