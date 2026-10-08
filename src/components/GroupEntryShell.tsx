import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createGroupJoinCoordinator } from '../group/groupJoinClient'
import {
  classifyGroupUrlFragment,
  createGroupInvitationUrl,
  hostUrlFromGroupHost,
  parseGroupInvitationUrl,
} from '../group/groupInvitation'
import {
  readGroupHost,
  readGroupParticipant,
} from '../group/groupPersistence'
import {
  createGroupPlayBootstrapCoordinator,
  createGroupPlayClient,
  type GroupPlayReady,
  type GroupResult,
} from '../group/groupPlayClient'
import type { AppStrings } from '../i18n'
import { GroupCompletionWaiting } from './GroupCompletionWaiting'
import { GroupInviteShareScreen } from './GroupInviteShareScreen'
import { GroupPlayScreen } from './GroupPlayScreen'
import { GroupReadyScreen } from './GroupReadyScreen'
import { GroupResultScreen } from './GroupResultScreen'

function resolveShareUrls(initialUrl: string): {
  invitationUrl: string
  hostUrl: string
} | null {
  try {
    const invitation = parseGroupInvitationUrl(initialUrl)
    const storage = window.localStorage
    const host = readGroupHost(storage, invitation.groupId)
    if (!host || readGroupParticipant(storage, invitation.groupId) !== null) {
      return null
    }
    return {
      invitationUrl: createGroupInvitationUrl(
        window.location.origin,
        host.groupId,
        host.invitationToken,
      ),
      hostUrl: hostUrlFromGroupHost(window.location.origin, host),
    }
  } catch {
    return null
  }
}

function shouldOfferInviteShare(initialUrl: string): boolean {
  return (
    classifyGroupUrlFragment(initialUrl) === 'invite' &&
    resolveShareUrls(initialUrl) !== null
  )
}

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
  const [shareDismissed, setShareDismissed] = useState(false)
  const [readyVisible, setReadyVisible] = useState(false)
  const [joinedNickname, setJoinedNickname] = useState<string | null>(null)
  const [readyTotalRounds, setReadyTotalRounds] = useState<number | null>(null)
  const [readyPlayerLimit, setReadyPlayerLimit] = useState<number | null>(null)
  const [playReady, setPlayReady] = useState<GroupPlayReady | null>(null)
  const [startedPlay, setStartedPlay] = useState(false)
  const [playCoordinator, setPlayCoordinator] = useState<ReturnType<
    typeof createGroupPlayBootstrapCoordinator
  > | null>(null)
  const [completionGroupId, setCompletionGroupId] = useState<string | null>(null)
  const [completionInitiallyClosed, setCompletionInitiallyClosed] = useState(false)
  const [groupResult, setGroupResult] = useState<GroupResult | null>(null)
  const pendingRef = useRef(false)
  const coordinatorRef = useRef<ReturnType<typeof createGroupJoinCoordinator> | null>(null)
  const playCoordinatorRef = useRef<ReturnType<
    typeof createGroupPlayBootstrapCoordinator
  > | null>(null)
  const explicitResumeRef = useRef<boolean | null>(null)

  const fragmentKind = classifyGroupUrlFragment(initialUrl)
  const validUrl = fragmentKind === 'invite' || fragmentKind === 'host'
  const shareUrls = validUrl && !shareDismissed ? resolveShareUrls(initialUrl) : null
  const showShare =
    validUrl && !shareDismissed && shouldOfferInviteShare(initialUrl) && shareUrls !== null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pendingRef.current || !validUrl) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    setReadyVisible(true)
    setPlayReady(null)
    setReadyTotalRounds(null)
    setReadyPlayerLimit(null)
    setStartedPlay(false)
    try {
      coordinatorRef.current ??= createGroupJoinCoordinator({
        storage: window.localStorage,
        fetch: window.fetch.bind(window),
      })
      const result = await coordinatorRef.current.run(initialUrl, nickname)
      explicitResumeRef.current ??= !result.newlyJoined
      setJoinedNickname(result.participant.displayNickname)
      setReadyTotalRounds(result.totalRounds)
      setReadyPlayerLimit(result.playerLimit)
      playCoordinatorRef.current ??= createGroupPlayBootstrapCoordinator(
        createGroupPlayClient({
          storage: window.localStorage,
          fetch: window.fetch.bind(window),
          crypto: window.crypto,
        }),
      )
      setPlayCoordinator(playCoordinatorRef.current)
      if (result.status === 'closed') {
        setReadyVisible(false)
        setCompletionInitiallyClosed(true)
        setCompletionGroupId(result.participant.groupId)
        return
      }
      const progress = await playCoordinatorRef.current.getProgress(
        result.participant.groupId,
      )
      if (progress.status === 'closed' || progress.selfCompleted) {
        setReadyVisible(false)
        setCompletionInitiallyClosed(progress.status === 'closed')
        setCompletionGroupId(result.participant.groupId)
        return
      }
      setPlayReady(
        await playCoordinatorRef.current.run(
          result.participant.groupId,
          explicitResumeRef.current,
        ),
      )
    } catch (caught: unknown) {
      setJoinedNickname(null)
      setReadyTotalRounds(null)
      setReadyPlayerLimit(null)
      setPlayReady(null)
      setReadyVisible(false)
      setError(
        caught instanceof Error &&
          'code' in caught &&
          caught.code === 'INVALID_NICKNAME'
          ? 'nickname'
          : 'join',
      )
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <main className="app app--duel app--group-entry">
      <div className="field-header">
        {topControls}
        <header className="app-header">
          <h1 className="brand-title duel-setup-heading">{t.modeGroupName}</h1>
        </header>
      </div>
      {groupResult && playCoordinator ? (
        <GroupResultScreen
          result={groupResult}
          t={t}
          onGoTop={onGoTop}
          fetchDetail={(entryKey) =>
            playCoordinator.getResultDetail(groupResult.groupId, entryKey)
          }
        />
      ) : !validUrl ? (
        <div className="duel-flow duel-flow--setup">
          <p className="duel-instruction" role="alert">
            {t.groupEntryError}
          </p>
          <div className="duel-setup-spacer duel-setup-spacer--mid" aria-hidden="true" />
          <div className="duel-btn-area duel-button-field">
            <div className="duel-btn-stack standard-action-stack">
              <button type="button" className="duel-btn" onClick={onGoTop}>
                {t.duelTop}
              </button>
            </div>
          </div>
        </div>
      ) : completionGroupId && playCoordinator ? (
        <GroupCompletionWaiting
          groupId={completionGroupId}
          coordinator={playCoordinator}
          t={t}
          initialClosed={completionInitiallyClosed}
          onResult={setGroupResult}
        />
      ) : startedPlay && playCoordinator && playReady ? (
        <GroupPlayScreen
          initialReady={playReady}
          coordinator={playCoordinator}
          t={t}
          onResult={setGroupResult}
        />
      ) : readyVisible ? (
        <GroupReadyScreen
          nickname={joinedNickname}
          totalRounds={readyTotalRounds}
          playerLimit={readyPlayerLimit}
          canStart={playReady !== null}
          t={t}
          onStart={() => setStartedPlay(true)}
          onGoTop={onGoTop}
        />
      ) : showShare && shareUrls ? (
        <GroupInviteShareScreen
          invitationUrl={shareUrls.invitationUrl}
          hostUrl={shareUrls.hostUrl}
          t={t}
          onEnterNickname={() => setShareDismissed(true)}
        />
      ) : (
        <form
          className="duel-flow duel-flow--setup group-entry-nickname"
          onSubmit={submit}
        >
          <div className="duel-status-slot" aria-hidden="true" />
          <div className="duel-setup-spacer duel-setup-spacer--top" aria-hidden="true" />
          <div className="duel-setup-hero">
            <p className="duel-instruction">{t.groupNicknameLead}</p>
            <div className="duel-field">
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
                aria-label={t.groupNicknameLabel}
              />
            </div>
            {error ? (
              <p className="duel-lock-error" role="alert">
                {error === 'nickname' ? t.groupNicknameError : t.groupPlayError}
              </p>
            ) : null}
          </div>
          <div className="duel-setup-spacer duel-setup-spacer--mid" aria-hidden="true" />
          <div className="duel-btn-area duel-button-field">
            <div className="duel-btn-stack standard-action-stack">
              <button
                type="submit"
                className={`duel-btn duel-btn--primary${!pending && t.groupJoin === 'JOIN GROUP' ? ' standard-action-btn--join-group' : ''}`}
                disabled={pending}
              >
                {pending ? t.groupJoining : t.groupJoin}
              </button>
              <button type="button" className="duel-btn" onClick={onGoTop} disabled={pending}>
                {t.duelTop}
              </button>
            </div>
          </div>
          <div className="duel-setup-spacer duel-setup-spacer--bottom" aria-hidden="true" />
        </form>
      )}
    </main>
  )
}
