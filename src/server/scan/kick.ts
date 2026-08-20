/**
 * Waking the background worker.
 *
 * Netlify background functions are invoked over HTTP: a POST to
 * `/.netlify/functions/<name>-background` returns 202 immediately and the
 * function keeps running for up to 15 minutes. So "start the work now" is a
 * fire-and-forget request rather than a queue publish.
 *
 * ── Why every failure here is swallowed ─────────────────────────────
 * This is an OPTIMISATION, not the delivery mechanism. The job row is already
 * durably in Postgres before this is called; the kick only decides whether the
 * scan starts in two seconds or on the next scheduled sweep. Letting a failed
 * kick fail the request would turn a latency problem into a visible error on
 * work that is, in fact, safely queued.
 *
 * That is also why the scheduled sweep is not optional: it is what makes this
 * best-effort call safe to be best-effort.
 */
export function kickScanWorker(origin: string): void {
  const url = new URL("/.netlify/functions/scan-worker-background", origin).toString();

  // Not awaited. The caller is inside a 10s request budget and has nothing to
  // do with the result.
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(2500),
  }).catch((error: unknown) => {
    // Debug, not error: locally there is no Netlify functions runtime at all,
    // and logging this at error level would train everyone to ignore the log.
    console.debug("[scan] worker kick did not land; the scheduled sweep will pick it up", error);
  });
}
