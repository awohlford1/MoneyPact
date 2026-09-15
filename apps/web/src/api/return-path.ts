/**
 * SEC-PK8-F1: the one same-origin rule for a return path. The WHATWG parser treats a backslash as a slash for
 * special schemes, so '/\evil.example' and '//evil.example' both resolve off this origin and Next's router would
 * complete a hard navigation there. A path is followed only when its second character is neither '/' nor '\'
 * and, resolved against `origin`, it stays on that origin; what is returned is the resolved pathname plus search,
 * never the raw string.
 */
export function sameOriginPath(candidate: unknown, origin: string): string | undefined {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate[0] !== "/") return undefined;
  if (candidate[1] === "/" || candidate[1] === "\\") return undefined;
  try {
    const url = new URL(candidate, origin);
    if (url.origin !== origin) return undefined;
    return `${url.pathname}${url.search}`;
  } catch { return undefined; }
}
