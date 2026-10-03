/**
 * Turn a FastAPI error body into one readable line. Handles `{detail: "..."}`,
 * validation arrays `{detail: [{loc, msg}]}`, and plain strings.
 */
export function apiError(err: unknown, fallback = "Something went wrong. Please try again.") {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  const detail = (err as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { loc?: (string | number)[]; msg?: string };
    const field = first.loc?.filter((p) => p !== "body").join(".");
    const msg = (first.msg ?? "").replace(/^Value error, /, "");
    return field ? `${field}: ${msg}` : msg || fallback;
  }
  if (detail && typeof detail === "object" && "message" in detail) return String((detail as { message: unknown }).message);
  return fallback;
}
