/**
 * Background tick for ARGUE IT (plan Task 4): runs `runTick()` every 60 s in the server process —
 * deadlines, AI judging jobs, suspension expiry and housekeeping. Replaces the reference app's
 * `/api/cron/tick` route + external scheduler.
 *
 * - Skipped where the framework disables in-process sweeps (production serverless functions, or
 *   AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS=1) and with ARGUE_IT_TICK=0. On serverless a scheduled caller
 *   of runTick() is needed instead (not wired: the hackathon deploy is a long-lived Node host).
 * - The first tick waits TICK_STARTUP_DELAY_MS so the database plugin's migrations finish first.
 * - A tick never overlaps the previous one (startIntervalJob waits for the in-flight run).
 * - runTick() never throws; each failing step is logged with its error.
 */
import { defineNitroPlugin, shouldDisableInProcessSweeps, startIntervalJob, type IntervalJobHandle } from "@agent-native/core/server";
import { TICK_INTERVAL_MS, TICK_STARTUP_DELAY_MS, TICK_TIMEOUT_MS } from "../domain/judging/config";

export default defineNitroPlugin((nitroApp) => {
  if (process.env.VITEST || process.env.ARGUE_IT_TICK === "0") return;
  if (shouldDisableInProcessSweeps()) {
    console.info("[tick] in-process background tick disabled for this runtime; schedule runTick() externally.");
    return;
  }

  let job: IntervalJobHandle | null = null;
  const startup = setTimeout(() => {
    job = startIntervalJob(
      async () => {
        const { runTick } = await import("../domain/tick");
        const results = await runTick();
        const failed = Object.entries(results).filter(([, r]) => !r.ok);
        if (failed.length > 0) {
          console.error(`[tick] ${failed.length} step(s) failed:`, Object.fromEntries(failed));
        }
      },
      {
        intervalMs: TICK_INTERVAL_MS,
        timeoutMs: TICK_TIMEOUT_MS,
        onError: (error) => console.error("[tick] run failed:", error),
      },
    );
  }, TICK_STARTUP_DELAY_MS);
  (startup as { unref?: () => void }).unref?.();

  nitroApp?.hooks?.hook?.("close", async () => {
    clearTimeout(startup);
    await job?.stop();
  });
});
