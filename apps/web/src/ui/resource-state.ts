/** CBD-35: the parts of `./resource.tsx` that build no JSX -- `useResource` and the failure classifier
 * `Failure` renders from. Kept in a plain `.ts` module, and re-exported from `resource.tsx`, so this
 * workspace's plain `node --test` (no JSX transform, no bundler) can load and unit-test them directly;
 * `resource.tsx` itself uses `next/link`, so nothing that imports it can run outside a bundler. */
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client.ts";

/** A read that is cancelled on unmount or identity change and discarded when a newer read has started. */
export function useResource<T>(identity: string, load: (signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<{ identity: string; value?: T; error?: unknown; refreshed?: boolean }>();
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const abort = new AbortController();
    const request = ++sequence.current;
    load(abort.signal).then(value => {
      if (!abort.signal.aborted && request === sequence.current) setResult({ identity, value, refreshed: revision > 0 });
    }, error => {
      if (!abort.signal.aborted && request === sequence.current) setResult({ identity, error });
    });
    return () => { abort.abort(); };
  }, [identity, load, revision]);
  const refresh = () => { sequence.current++; setResult(undefined); setRevision(value => value + 1); };
  return { ...(result?.identity === identity ? result : {}), refresh };
}

export type FailureKind = "denied" | "terminal" | "recoverable";

/** Denied: the session cannot open this at all (401/403) -- retrying never helps, only signing in again might.
 * Terminal: the resource itself is gone or wrong (404/410/502) -- retrying changes nothing either. Everything
 * else is recoverable: a retry might succeed. */
export function classifyFailure(error: unknown): FailureKind {
  const status = error instanceof ApiError ? error.status : 503;
  if (status === 401 || status === 403) return "denied";
  if (status === 404 || status === 410 || status === 502) return "terminal";
  return "recoverable";
}
