/**
 * The neutral label every surface shows until a subject has chosen a display
 * name (`DI-91-065`, SS9). It lives here, below every engine, because two
 * packages that cannot import each other both need the one string:
 * `@cobudget/budget-application/invitations` renders it in place of an unset
 * name, and `packages/data-access/src/financial-profile.ts` refuses a display
 * name that equals or visually equals it (SEC-NS-R2). Nothing else about
 * display identity belongs in this package.
 */
export const NEUTRAL_DISPLAY_LABEL = "A MoneyPact member";
