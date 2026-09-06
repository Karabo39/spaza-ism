export function safeAuthPath(raw: string | null): string {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(raw)
  )
    return "/";
  try {
    return new URL(raw, "https://spaza.invalid").origin ===
      "https://spaza.invalid"
      ? raw
      : "/";
  } catch {
    return "/";
  }
}
