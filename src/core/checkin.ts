export const DAY_MS = 24 * 60 * 60 * 1000;
export const KPI_WINDOW_MS = 30 * DAY_MS;

/** True when `at` is after the claim and no later than 30 days after it. */
export function inKpiWindow(claimedAt: number, at: number): boolean {
  return at > claimedAt && at <= claimedAt + KPI_WINDOW_MS;
}
