type LanguageToggleProps = {
  ariaLabel: string
  title: string
  onToggle: () => void
}

/**
 * Same 2.25rem footprint as SoundToggle — globe glyph only (no flags).
 */
export function LanguageToggle({
  ariaLabel,
  title,
  onToggle,
}: LanguageToggleProps) {
  return (
    <button
      type="button"
      className="lang-toggle"
      aria-label={ariaLabel}
      title={title}
      onClick={onToggle}
    >
      <span className="lang-toggle-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="15" height="15" focusable="false">
          <path
            fill="currentColor"
            d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 9h-3.1a15.4 15.4 0 0 0-1.3-5.1A8.1 8.1 0 0 1 18.9 11zM12 3.9c.9 1.2 1.7 3.1 2 5.1H10c.3-2 1.1-3.9 2-5.1zM5.1 13h3.1c.2 1.8.7 3.5 1.3 5.1A8.1 8.1 0 0 1 5.1 13zm3.1-2H5.1a8.1 8.1 0 0 1 4.4-5.1A15.4 15.4 0 0 0 8.2 11zM12 20.1c-.9-1.2-1.7-3.1-2-5.1h4c-.3 2-1.1 3.9-2 5.1zm1.5-2a15.4 15.4 0 0 0 1.3-5.1h3.1a8.1 8.1 0 0 1-4.4 5.1z"
          />
        </svg>
      </span>
    </button>
  )
}
