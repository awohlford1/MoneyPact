/** Production/default transport (the real API behind the same-origin /v1 proxy). Next selects the mock module only in its development phase, unless apps/web/.api-mode says `live`. */
export const mockMode = false;
export const apiBase = "/v1";
