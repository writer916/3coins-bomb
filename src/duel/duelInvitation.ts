import {
  createPendingClaimRecord,
  readParticipant,
  readPendingClaim,
  savePendingClaim,
  validateInvitation,
  type DuelParticipantRecord,
  type PendingClaimRecord,
  type StorageAdapter,
} from './duelPersistence'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type DuelInvitationEntryKind =
  | 'new-claim'
  | 'claim-retry'
  | 'participant-a'
  | 'participant-b'

export class DuelInvitationUrlError extends Error {
  constructor() {
    super('The DUEL invitation URL is invalid or unavailable.')
    this.name = 'DuelInvitationUrlError'
  }
}

export interface ParsedDuelInvitationUrl {
  readonly matchId: string
  readonly invitationToken: string
  readonly cleanPath: string
}

export interface ParsedDuelMatchRoute {
  readonly matchId: string
  readonly hasFragment: boolean
}

export interface HistoryAdapter {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void
}

export type DuelInvitationEntry =
  | {
      readonly kind: 'new-claim'
      readonly matchId: string
      readonly pending: PendingClaimRecord
      readonly cleanPath: string
    }
  | {
      readonly kind: 'claim-retry'
      readonly matchId: string
      readonly pending: PendingClaimRecord
      readonly cleanPath: string
    }
  | {
      readonly kind: 'participant-a'
      readonly matchId: string
      readonly participant: DuelParticipantRecord
      readonly cleanPath: string
    }
  | {
      readonly kind: 'participant-b'
      readonly matchId: string
      readonly participant: DuelParticipantRecord
      readonly cleanPath: string
    }

function invalid(): never {
  throw new DuelInvitationUrlError()
}

function validatedInvitation(matchId: unknown, token: unknown) {
  try {
    return validateInvitation({
      version: 1,
      matchId,
      token,
    })
  } catch {
    return invalid()
  }
}

function parseOrigin(origin: string): URL {
  try {
    const parsed = new URL(origin)
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return invalid()
    }
    return parsed
  } catch {
    return invalid()
  }
}

export function createDuelInvitationUrl(
  origin: string,
  matchId: string,
  invitationToken: string,
): string {
  const invitation = validatedInvitation(matchId, invitationToken)
  const url = new URL(`/duel/${invitation.matchId}`, parseOrigin(origin))
  url.hash = new URLSearchParams({ invite: invitation.token }).toString()
  return url.toString()
}

export function parseDuelInvitationUrl(urlValue: string): ParsedDuelInvitationUrl {
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    return invalid()
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search
  ) {
    return invalid()
  }
  const pathMatch = /^\/duel\/([^/]+)$/.exec(url.pathname)
  if (!pathMatch || !url.hash.startsWith('#')) return invalid()
  let matchId: string
  try {
    matchId = decodeURIComponent(pathMatch[1])
  } catch {
    return invalid()
  }
  const fields = [...new URLSearchParams(url.hash.slice(1)).entries()]
  if (fields.length !== 1 || fields[0][0] !== 'invite') return invalid()
  const invitation = validatedInvitation(matchId, fields[0][1])
  return {
    matchId: invitation.matchId,
    invitationToken: invitation.token,
    cleanPath: `/duel/${invitation.matchId}`,
  }
}

export function isDuelMatchRouteUrl(urlValue: string): boolean {
  try {
    return /^\/duel\/[^/]+$/.test(new URL(urlValue).pathname)
  } catch {
    return false
  }
}

export function parseDuelMatchRouteUrl(urlValue: string): ParsedDuelMatchRoute {
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    return invalid()
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search
  ) {
    return invalid()
  }
  const pathMatch = /^\/duel\/([^/]+)$/.exec(url.pathname)
  if (!pathMatch) return invalid()
  let matchId: string
  try {
    matchId = decodeURIComponent(pathMatch[1])
  } catch {
    return invalid()
  }
  if (!UUID_V4_PATTERN.test(matchId)) return invalid()
  return { matchId: matchId.toLowerCase(), hasFragment: url.hash.length > 0 }
}

function cleanFragment(history: HistoryAdapter, cleanPath: string): void {
  try {
    history.replaceState(null, '', cleanPath)
  } catch {
    throw new DuelInvitationUrlError()
  }
}

/**
 * Prepares a future claim without making a network request. A new pending
 * claim is durably written and read back before the invitation fragment is
 * removed from the current history entry.
 */
export function prepareDuelInvitationEntry(
  urlValue: string,
  storage: StorageAdapter,
  history: HistoryAdapter,
  cryptoSource: Pick<Crypto, 'getRandomValues'> = globalThis.crypto,
): DuelInvitationEntry {
  const parsed = parseDuelInvitationUrl(urlValue)
  const participant = readParticipant(storage, parsed.matchId)
  if (participant) {
    cleanFragment(history, parsed.cleanPath)
    return {
      kind: participant.role === 'A' ? 'participant-a' : 'participant-b',
      matchId: parsed.matchId,
      participant,
      cleanPath: parsed.cleanPath,
    }
  }

  const existingPending = readPendingClaim(storage)
  let pending: PendingClaimRecord
  let kind: 'new-claim' | 'claim-retry'
  if (existingPending) {
    if (
      existingPending.matchId !== parsed.matchId ||
      existingPending.invitationToken !== parsed.invitationToken
    ) {
      return invalid()
    }
    pending = existingPending
    kind = 'claim-retry'
  } else {
    pending = createPendingClaimRecord(
      parsed.matchId,
      parsed.invitationToken,
      cryptoSource,
    )
    savePendingClaim(storage, pending)
    kind = 'new-claim'
  }
  cleanFragment(history, parsed.cleanPath)
  return { kind, matchId: parsed.matchId, pending, cleanPath: parsed.cleanPath }
}
