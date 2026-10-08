import type { ReactNode } from 'react'
import { brandTitleNodes } from './brandTitleNodes'

/**
 * Product brand “3 COINS BOMB” markup for RESULT / TOP / SOLO headers.
 */
export function BrandTitle({
  title,
  className = 'brand-title',
  as: Tag = 'h1',
}: {
  readonly title: string
  readonly className?: string
  readonly as?: 'h1' | 'h2' | 'p'
}): ReactNode {
  return (
    <Tag className={className} aria-label={title}>
      {brandTitleNodes(title)}
    </Tag>
  )
}
