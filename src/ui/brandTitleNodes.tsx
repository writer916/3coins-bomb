import type { ReactNode } from 'react'

/** Lead digit → `.duel-num`; remainder stays on Georgia brand face. */
export function brandTitleNodes(title: string): ReactNode {
  const match = /^(\d)(\s.+)$/.exec(title)
  if (!match) return title
  return (
    <>
      <span className="brand-title-digit duel-num">{match[1]}</span>
      <span className="brand-title-rest">{match[2]}</span>
    </>
  )
}
