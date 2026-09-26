import type { AppStrings } from '../i18n'

export type PlayMode = 'solo' | 'duel' | 'group'

type ModeSelectProps = {
  t: AppStrings
  onSelect: (mode: PlayMode) => void
}

/**
 * App front door — three equal mode blocks. No tagline.
 */
export function ModeSelect({ t, onSelect }: ModeSelectProps) {
  return (
    <nav className="mode-select" aria-label="Game modes">
      <button
        type="button"
        className="mode-card"
        onClick={() => onSelect('solo')}
      >
        <span className="mode-card-title">{t.modeSoloName}</span>
        <span className="mode-card-desc">{t.modeSoloDesc}</span>
      </button>

      <button
        type="button"
        className="mode-card"
        onClick={() => onSelect('duel')}
      >
        <span className="mode-card-title">{t.modeDuelName}</span>
        <span className="mode-card-desc">{t.modeDuelDesc}</span>
      </button>

      <button
        type="button"
        className="mode-card"
        onClick={() => onSelect('group')}
      >
        <span className="mode-card-heading">
          <span className="mode-card-title">{t.modeGroupName}</span>
          <span className="mode-badge">{t.modeGroupBadge}</span>
        </span>
        <span className="mode-card-desc">{t.modeGroupDesc}</span>
      </button>
    </nav>
  )
}
