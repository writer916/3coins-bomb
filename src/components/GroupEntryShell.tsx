import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createGroupJoinCoordinator } from '../group/groupJoinClient'
import { parseGroupInvitationUrl } from '../group/groupInvitation'
import {
  createGroupPlayBootstrapCoordinator,
  createGroupPlayClient,
  type GroupPlayReady,
  type GroupResult,
} from '../group/groupPlayClient'
import type { AppStrings } from '../i18n'
import { GroupPlayScreen } from './GroupPlayScreen'
import { GroupCompletionWaiting } from './GroupCompletionWaiting'
import { GroupResultScreen } from './GroupResultScreen'

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
  const [playReady, setPlayReady] = useState<GroupPlayReady | null>(null)
  const [playCoordinator, setPlayCoordinator] = useState<ReturnType<typeof createGroupPlayBootstrapCoordinator> | null>(null)
  const [completionGroupId, setCompletionGroupId] = useState<string | null>(null)
  const [completionInitiallyClosed, setCompletionInitiallyClosed] = useState(false)
  const [groupResult, setGroupResult] = useState<GroupResult | null>(null)
  const pendingRef = useRef(false)
  const coordinatorRef = useRef<ReturnType<typeof createGroupJoinCoordinator> | null>(null)
  const playCoordinatorRef = useRef<ReturnType<typeof createGroupPlayBootstrapCoordinator> | null>(null)
  const explicitResumeRef = useRef<boolean | null>(null)
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
      explicitResumeRef.current ??= !result.newlyJoined
      setJoinedNickname(result.participant.displayNickname)
      playCoordinatorRef.current ??= createGroupPlayBootstrapCoordinator(
        createGroupPlayClient({
          storage: window.localStorage,
          fetch: window.fetch.bind(window),
          crypto: window.crypto,
        }),
      )
      setPlayCoordinator(playCoordinatorRef.current)
      if (result.status === 'closed') {
        setCompletionInitiallyClosed(true)
        setCompletionGroupId(result.participant.groupId)
        return
      }
      const progress = await playCoordinatorRef.current.getProgress(result.participant.groupId)
      if (progress.status === 'closed' || progress.selfCompleted) {
        setCompletionInitiallyClosed(progress.status === 'closed')
        setCompletionGroupId(result.participant.groupId)
        return
      }
      setPlayReady(await playCoordinatorRef.current.run(
        result.participant.groupId,
        explicitResumeRef.current,
      ))
    } catch (caught: unknown) {
      setJoinedNickname(null)
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
        {groupResult ? (
          <GroupResultScreen result={groupResult} t={t} onGoTop={onGoTop}/>
        ) : !validUrl ? (
          <p className="coming-soon-mode" role="alert">{t.groupEntryError}</p>
        ) : completionGroupId && playCoordinator ? (
          <GroupCompletionWaiting groupId={completionGroupId} coordinator={playCoordinator} t={t} initialClosed={completionInitiallyClosed} onResult={setGroupResult} />
        ) : playReady && playCoordinator ? (
          <GroupPlayScreen initialReady={playReady} coordinator={playCoordinator} t={t} onResult={setGroupResult} />
        ) : joinedNickname ? (
          <div className="group-entry-complete" aria-live="polite">
            <p className="coming-soon-mode">{t.groupPlayPreparing}</p>
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
                {error === 'nickname' ? t.groupNicknameError : t.groupPlayError}
              </p>
            ) : null}
            <button type="submit" className="duel-btn duel-btn--primary" disabled={pending}>
              {pending ? t.groupJoining : t.groupJoin}
            </button>
          </form>
        )}
        {!groupResult ? <button type="button" className="duel-btn" onClick={onGoTop}>
          {t.duelTop}
        </button> : null}
      </div>
    </main>
  )
}
