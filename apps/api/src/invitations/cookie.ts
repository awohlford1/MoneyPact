/**
 * The `__Host-mp_invitation_ceremony` cookie (CBD-234 design section 4.4;
 * CBD-73 `DR-73-03`).
 *
 * The cookie value is the opaque, one-time ceremony token `TR-73-08` issued;
 * the server stores only its keyed digest (`ceremony_secret_digest`). It is
 * `HttpOnly`, `Secure`, `Path=/` (the `__Host-` prefix requires exactly that)
 * and `SameSite=Strict`, so a page on another site can neither read it nor
 * ride it. The ceremony id travels in the path and the secret in the cookie;
 * neither alone locates a usable ceremony (`loadCeremony` compares the
 * digest, the environment, the current flag and the state before anything
 * else is read). The token is never the reconciliation code.
 */
export const INVITATION_CEREMONY_COOKIE_NAME = "__Host-mp_invitation_ceremony";

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,256}$/u;

/** `Set-Cookie` for a freshly resolved ceremony. `expiresAt` bounds the browser copy to the ceremony's own life. */
export function invitationCeremonyCookie(secret: string, expiresAt: string, now: Date): string {
  const seconds = Math.max(1, Math.floor((Date.parse(expiresAt) - now.getTime()) / 1000));
  return [`${INVITATION_CEREMONY_COOKIE_NAME}=${secret}`, "Path=/", "Secure", "HttpOnly", "SameSite=Strict", `Max-Age=${seconds}`].join("; ");
}

/** The value of the ceremony cookie in a `Cookie` header, or undefined. A value outside the token shape is treated as absent. */
export function readInvitationCeremonyCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== INVITATION_CEREMONY_COOKIE_NAME) continue;
    const value = part.slice(index + 1).trim();
    return TOKEN_SHAPE.test(value) ? value : undefined;
  }
  return undefined;
}
