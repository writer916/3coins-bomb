export function formatGroupHitRate(hits: number, opens: number): string {
  if (opens === 0) return '0%'
  const value = Math.round((hits / opens) * 1000) / 10
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`
}
