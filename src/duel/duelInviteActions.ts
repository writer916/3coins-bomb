import { renderSVG } from 'uqr'
import {
  buildDuelParticipantUrl,
  createDuelInvitationUrl,
} from './duelInvitation'
import {
  readInvitation,
  readParticipant,
  type StorageAdapter,
} from './duelPersistence'

export type DuelInviteShareResult = 'shared' | 'cancelled' | 'unavailable' | 'failed'
export type DuelInviteCopyResult = 'copied' | 'failed'

export class DuelInviteActionError extends Error {
  constructor() {
    super('The DUEL invitation could not be shared.')
    this.name = 'DuelInviteActionError'
  }
}

/** Builds the formal invite URL for an A participant match. Never logs the URL. */
export function readDuelInviteUrl(
  storage: StorageAdapter,
  matchId: string,
  origin: string,
): string {
  const participant = readParticipant(storage, matchId)
  if (!participant || participant.role !== 'A' || participant.matchId !== matchId) {
    throw new DuelInviteActionError()
  }
  const invitation = readInvitation(storage, matchId)
  if (!invitation || invitation.matchId !== matchId) {
    throw new DuelInviteActionError()
  }
  try {
    return createDuelInvitationUrl(origin, matchId, invitation.token)
  } catch {
    throw new DuelInviteActionError()
  }
}

/**
 * Builds A's durable participant capability URL (`#p=`).
 * Never logs the URL or token.
 */
export function readDuelParticipantCapabilityUrl(
  storage: StorageAdapter,
  matchId: string,
  origin: string,
): string {
  const participant = readParticipant(storage, matchId)
  if (!participant || participant.role !== 'A' || participant.matchId !== matchId) {
    throw new DuelInviteActionError()
  }
  try {
    return buildDuelParticipantUrl(origin, matchId, participant.token)
  } catch {
    throw new DuelInviteActionError()
  }
}

/** Short display form; clipboard/share must keep the full URL. */
export function formatDuelShareUrlForDisplay(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}/duel/…`
  } catch {
    return '…'
  }
}

export function canUseWebShare(
  shareApi: Pick<Navigator, 'share'> | undefined = globalThis.navigator,
): boolean {
  return typeof shareApi?.share === 'function'
}

export async function copyDuelInviteUrl(
  inviteUrl: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard,
): Promise<DuelInviteCopyResult> {
  if (!clipboard || typeof clipboard.writeText !== 'function') return 'failed'
  try {
    await clipboard.writeText(inviteUrl)
    return 'copied'
  } catch {
    return 'failed'
  }
}

export async function shareDuelInviteUrl(
  inviteUrl: string,
  title: string,
  shareApi: Pick<Navigator, 'share'> | undefined = globalThis.navigator,
): Promise<DuelInviteShareResult> {
  if (!canUseWebShare(shareApi)) return 'unavailable'
  try {
    await shareApi!.share({ title, url: inviteUrl })
    return 'shared'
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'cancelled'
    }
    return 'failed'
  }
}

/** Client-only QR SVG for the full invite URL. No network. */
export function renderDuelInviteQrSvg(inviteUrl: string): string {
  try {
    const parsed = new URL(inviteUrl)
    if (parsed.search) throw new Error('query')
    if (!parsed.hash.startsWith('#invite=')) throw new Error('hash')
    return renderSVG(inviteUrl, { ecc: 'M', border: 2 })
  } catch {
    throw new DuelInviteActionError()
  }
}
