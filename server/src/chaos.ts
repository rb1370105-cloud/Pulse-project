/**
 * Fault injection. Degraded data is the normal case for a market feed, not an
 * exception, so it is switchable at runtime and demonstrable in the UI rather
 * than something you have to take on faith from the code.
 *
 *  outage  — every provider throws; breakers open, last good prices go stale
 *  stale   — quotes arrive stamped 45 minutes old
 *  dispute — a phantom second source disagrees, so signals are suppressed
 */
export type ChaosMode = "none" | "outage" | "stale" | "dispute";

export const chaos: { mode: ChaosMode } = { mode: "none" };
