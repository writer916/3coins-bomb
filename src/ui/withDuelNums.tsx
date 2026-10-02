import { Fragment, type ReactNode } from 'react'

/**
 * Wrap ASCII digit runs in `.duel-num` (same stack as SOLO `.score-num`).
 * Keeps CJK body text on Georgia while digits use lining system-ui figures.
 */
export function withDuelNums(text: string): ReactNode {
  return text.split(/(\d+)/).map((part, i) =>
    /^\d+$/.test(part) ? (
      <span key={i} className="duel-num">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

/**
 * Digits via `.duel-num`, plus explicit line breaks for `\n` in copy.
 * Each intentional line is nowrap so CJK cannot mid-phrase wrap inside it.
 */
export function withDuelNumsAndBreaks(text: string): ReactNode {
  const lines = text.split('\n')
  return lines.map((line, li) => (
    <Fragment key={li}>
      {li > 0 ? <br /> : null}
      <span className="duel-instruction-line">{withDuelNums(line)}</span>
    </Fragment>
  ))
}
