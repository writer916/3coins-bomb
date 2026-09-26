type SoundToggleProps = {
  enabled: boolean
  onToggle: () => void
  labelOn: string
  labelOff: string
}

/**
 * Minimal 1-cell SOUND ON/OFF control. No heavy icon libs.
 * Visual: small speaker glyph; hit area larger than the glyph.
 */
export function SoundToggle({
  enabled,
  onToggle,
  labelOn,
  labelOff,
}: SoundToggleProps) {
  const label = enabled ? labelOn : labelOff

  return (
    <button
      type="button"
      className="sound-toggle"
      aria-label={label}
      title={label}
      aria-pressed={enabled}
      onClick={onToggle}
    >
      <span className="sound-toggle-glyph" aria-hidden="true">
        {enabled ? (
          <svg viewBox="0 0 24 24" width="15" height="15" focusable="false">
            <path
              fill="currentColor"
              d="M4 9v6h3.2L12 19.2V4.8L7.2 9H4zm11.5 3a3.5 3.5 0 0 0-1.8-3.1v6.2A3.5 3.5 0 0 0 15.5 12zm-1.8-7.4v1.7a5.8 5.8 0 0 1 0 11.4v1.7a7.5 7.5 0 0 0 0-14.8z"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" focusable="false">
            <path
              fill="currentColor"
              d="M4 9v6h3.2L12 19.2V4.8L7.2 9H4zm16.1-3.9-1.4-1.4-3.2 3.2-1.5-1.5v1.7l1.1 1.1A5.8 5.8 0 0 1 16.7 15l1.5 1.5v-1.7a7.4 7.4 0 0 0-1.3-6.2l3.2-3.5zM14.2 12c0-.4-.1-.8-.2-1.1l4.4 4.4.1-.3a3.5 3.5 0 0 0-1.8-3.1v1.5l-1.4-1.4c.1.5.1 1 .1 1.5v.4l-1.2-1.2V12z"
            />
          </svg>
        )}
      </span>
    </button>
  )
}
