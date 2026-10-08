/** GROUP PLAY cash-out button visibility vs enablement (UI only). */

/** Visibility: once 1–2 provisional coins, keep until the ROUND ends. */
export function canShowGroupCashOutButton(
  provisionalCoins: 0 | 1 | 2 | 3,
  terminal: boolean,
): boolean {
  return !terminal && (provisionalCoins === 1 || provisionalCoins === 2)
}

/** Enablement only — FX / in-flight must not unmount the button. */
export function isGroupCashOutButtonDisabled(
  requestPending: boolean,
  fxActive: boolean,
): boolean {
  return requestPending || fxActive
}
