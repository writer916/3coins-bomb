/** DAILY PLAY cash-out button visibility vs enablement (UI only). */

/** Visibility: once 1–2 provisional coins, keep mounted until the ROUND ends. */
export function canShowDailyCashOutButton(
  provisionalCoins: 0 | 1 | 2 | 3,
  terminal: boolean,
): boolean {
  return !terminal && (provisionalCoins === 1 || provisionalCoins === 2)
}

/** Enablement only — FX / in-flight / timer-zero must not unmount the button. */
export function isDailyCashOutButtonDisabled(
  requestPending: boolean,
  fxActive: boolean,
  timerExpired: boolean,
): boolean {
  return requestPending || fxActive || timerExpired
}
