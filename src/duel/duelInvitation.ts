import {
  createPendingClaimRecord,
  readParticipant,
  readPendingClaim,
  savePendingClaim,
  validateInvitation,
  validateParticipant,
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

export class DuelParticipantUrlError extends Error {
  constructor() {
    super('The DUEL participant URL is invalid or unavailable.')
    this.name = 'DuelParticipantUrlError'
  }
}

export interface ParsedDuelInvitationUrl {
  readonly matchId: string
  readonly invitationToken: string
  readonly cleanPath: string
}

export interface ParsedDuelParticipantUrl {
  readonly matchId: string
  readonly participantToken: string
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

function invalidParticipantUrl(): never {
  throw new DuelParticipantUrlError()
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

/** Accepts A (`3cb_pa1_…`) or B (`3cb_pb1_…`) only — never invitation (`3cb_pi1_…`). */
function validatedParticipantCapability(
  matchId: unknown,
  token: unknown,
): DuelParticipantRecord {
  if (typeof token !== 'string') return invalidParticipantUrl()
  const role =
    token.startsWith('3cb_pa1_') ? 'A' : token.startsWith('3cb_pb1_') ? 'B' : null
  if (!role) return invalidParticipantUrl()
  try {
    return validateParticipant({
      version: 1,
      matchId,
      role,
      token,
    })
  } catch {
    return invalidParticipantUrl()
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

/**
 * Durable participant capability URL (A or B).
 * Format: `{origin}/duel/{matchId}#p={participantToken}`
 * Secret stays in the fragment only — never query or path.
 */
export function buildDuelParticipantUrl(
  origin: string,
  matchId: string,
  participantToken: string,
): string {
  const participant = validatedParticipantCapability(matchId, participantToken)
  let base: URL
  try {
    base = parseOrigin(origin)
  } catch {
    return invalidParticipantUrl()
  }
  const url = new URL(`/duel/${participant.matchId}`, base)
  url.hash = new URLSearchParams({ p: participant.token }).toString()
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

export function parseDuelParticipantUrl(urlValue: string): ParsedDuelParticipantUrl {
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    return invalidParticipantUrl()
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search
  ) {
    return invalidParticipantUrl()
  }
  const pathMatch = /^\/duel\/([^/]+)$/.exec(url.pathname)
  if (!pathMatch || !url.hash.startsWith('#')) return invalidParticipantUrl()
  let matchId: string
  try {
    matchId = decodeURIComponent(pathMatch[1])
  } catch {
    return invalidParticipantUrl()
  }
  const fields = [...new URLSearchParams(url.hash.slice(1)).entries()]
  if (fields.length !== 1 || fields[0][0] !== 'p') return invalidParticipantUrl()
  const participant = validatedParticipantCapability(matchId, fields[0][1])
  return {
    matchId: participant.matchId,
    participantToken: participant.token,
    cleanPath: `/duel/${participant.matchId}`,
  }
}

export type DuelMatchUrlFragmentKind =
  | 'none'
  | 'invite'
  | 'participant'
  | 'invalid'

/**
 * Classifies `/duel/{matchId}` fragment without validating token material.
 * Used to route `#invite=` vs `#p=` before either parser runs.
 */
export function classifyDuelMatchUrlFragment(
  urlValue: string,
): DuelMatchUrlFragmentKind {
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    return 'invalid'
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    !/^\/duel\/[^/]+$/.test(url.pathname)
  ) {
    return 'invalid'
  }
  if (!url.hash || url.hash === '#') return 'none'
  if (!url.hash.startsWith('#')) return 'invalid'
  const fields = [...new URLSearchParams(url.hash.slice(1)).entries()]
  if (fields.length === 1 && fields[0][0] === 'invite') return 'invite'
  if (fields.length === 1 && fields[0][0] === 'p') return 'participant'
  return 'invalid'
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
 * Writes or reuses pending-claim for an invitation. Does not touch history —
 * fragment removal happens only after authenticated claim/import success.
 */
export function ensureDuelPendingClaim(
  matchId: string,
  invitationToken: string,
  storage: StorageAdapter,
  cryptoSource: Pick<Crypto, 'getRandomValues'> = globalThis.crypto,
): { readonly kind: 'new-claim' | 'claim-retry'; readonly pending: PendingClaimRecord } {
  const invitation = validatedInvitation(matchId, invitationToken)
  const existingPending = readPendingClaim(storage)
  if (existingPending) {
    if (
      existingPending.matchId !== invitation.matchId ||
      existingPending.invitationToken !== invitation.token
    ) {
      return invalid()
    }
    return { kind: 'claim-retry', pending: existingPending }
  }
  const pending = createPendingClaimRecord(
    invitation.matchId,
    invitation.token,
    cryptoSource,
  )
  savePendingClaim(storage, pending)
  return { kind: 'new-claim', pending }
}

export function cleanDuelMatchFragment(
  history: HistoryAdapter,
  cleanPath: string,
): void {
  cleanFragment(history, cleanPath)
}

/**
 * Prepares a future claim without making a network request. A new pending
 * claim is durably written and read back before the invitation fragment is
 * removed from the current history entry.
 *
 * Prefer {@link ensureDuelPendingClaim} + post-auth {@link cleanDuelMatchFragment}
 * for bootstrap so fragments are not stripped before server verification.
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

  const ensured = ensureDuelPendingClaim(
    parsed.matchId,
    parsed.invitationToken,
    storage,
    cryptoSource,
  )
  cleanFragment(history, parsed.cleanPath)
  return {
    kind: ensured.kind,
    matchId: parsed.matchId,
    pending: ensured.pending,
    cleanPath: parsed.cleanPath,
  }
}
