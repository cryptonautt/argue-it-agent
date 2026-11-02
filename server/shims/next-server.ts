/**
 * Alias target for `next/server` in server (domain) code. Only `after()` is used (judging/jobs.ts kicks
 * the evaluation queue after a response). Here it runs the callback on the next microtask, detached; a
 * failure is logged and the background tick retries the job.
 */
export function after(fn: () => unknown | Promise<unknown>): void {
  void Promise.resolve()
    .then(fn)
    .catch((error: unknown) => {
      console.error("[after] background task failed", error);
    });
}
