/** Deliberately excludes messages, stacks, cookies, query strings and business data. */
export function safeErrorEvent(error: unknown, routeTemplate: string) {
  const digest = error && typeof error === "object" && "digest" in error ? String(error.digest) : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return {
    event: "request_failed",
    reference: /^[a-zA-Z0-9_-]{1,64}$/.test(digest) ? digest : "unclassified",
    code: /^[A-Z0-9]{5,12}$/.test(code) ? code : "SERVER_ERROR",
    route: routeTemplate.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]").slice(0, 150),
    time: new Date().toISOString(),
  };
}
