import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createGroupJoinCoordinator } from '../group/groupJoinClient'
import { parseGroupInvitationUrl } from '../group/groupInvitation'
import type { AppStrings } from '../i18n'

export function GroupEntryShell({
  initialUrl,
  t,
  onGoTop,
  topControls,
}: {
  readonly initialUrl: string
  readonly t: AppStrings
  readonly onGoTop: () => void
  readonly topControls?: ReactNode
}) {
  const [nickname, setNickname] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<'nickname' | 'join' | null>(null)
  const [joinedNickname, setJoinedNickname] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const coordinatorRef = useRef<ReturnType<typeof createGroupJoinCoordinator> | null>(null)
  let validUrl = true
  try {
    parseGroupInvitationUrl(initialUrl)
  } catch {
    validUrl = false
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pendingRef.current || !validUrl) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      coordinatorRef.current ??= createGroupJoinCoordinator({
        storage: window.localStorage,
        fetch: window.fetch.bind(window),
      })
      const result = await coordinatorRef.current.run(initialUrl, nickname)
      setJoinedNickname(result.participant.displayNickname)
    } catch (caught: unknown) {
      setError(
        caught instanceof Error && 'code' in caught && caught.code === 'INVALID_NICKNAME'
          ? 'nickname'
          : 'join',
      )
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <main className="app app--coming app--group-entry">
      <div className="field-header">
        {topControls}
        <header className="app-header">
          <h1 className="brand-title duel-setup-heading">{t.modeGroupName}</h1>
        </header>
      </div>
      <div className="coming-soon">
        {!validUrl ? (
          <p className="coming-soon-mode" role="alert">{t.groupEntryError}</p>
        ) : joinedNickname ? (
          <div className="group-entry-complete" aria-live="polite">
            <p className="coming-soon-mode">{t.groupParticipantReady}</p>
            <p className="group-entry-nickname">{joinedNickname}</p>
          </div>
        ) : (
          <form className="group-entry-form" onSubmit={submit}>
            <label className="group-entry-label" htmlFor="group-nickname">
              {t.groupNicknameLabel}
            </label>
            <input
              id="group-nickname"
              className="group-nickname-input"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              autoComplete="nickname"
              autoCapitalize="none"
              spellCheck={false}
              disabled={pending}
              placeholder={t.groupNicknamePlaceholder}
            />
            {error ? (
              <p className="duel-lock-error" role="alert">
                {error === 'nickname' ? t.groupNicknameError : t.groupJoinError}
              </p>
            ) : null}
            <button type="submit" className="duel-btn duel-btn--primary" disabled={pending}>
              {pending ? t.groupJoining : t.groupJoin}
            </button>
          </form>
        )}
        <button type="button" className="duel-btn" onClick={onGoTop}>
          {t.duelTop}
        </button>
      </div>
    </main>
  )
}
