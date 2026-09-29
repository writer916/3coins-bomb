import {
  DUEL_ROUNDS_MAX,
  DUEL_ROUNDS_MIN,
  isValidCompletedPlacement,
  type DuelRoundPlacement,
} from '../game/duelPlacement'

export const DUEL_STORAGE_VERSION = 1 as const
export const DUEL_PENDING_CREATE_KEY = '3cb:duel:v1:pending-create'
export const DUEL_PENDING_LOCK_KEY = '3cb:duel:v1:pending-lock'
export const DUEL_PENDING_CLAIM_KEY = '3cb:duel:v1:pending-claim'
export const DUEL_MATCH_INDEX_KEY = '3cb:duel:v1:index'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// A canonical unpadded base64url encoding of 32 bytes has 43 characters;
// its final character carries four data bits and must have zero padding bits.
const BASE64URL_32_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const PARTICIPANT_A_TOKEN_PATTERN =
  /^3cb_pa1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const PARTICIPANT_B_TOKEN_PATTERN =
  /^3cb_pb1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const INVITATION_TOKEN_PATTERN =
  /^3cb_pi1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

export type DuelParticipantRole = 'A' | 'B'

export interface CanonicalDuelPlacement {
  readonly roundNumber: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
}

export interface PendingCreateRecord {
  readonly version: 1
  readonly phase: 'pending-create'
  readonly createRequestId: string
  readonly createRecoverySecret: string
  readonly totalRounds: number
  readonly placements: readonly CanonicalDuelPlacement[]
}

export interface PendingLockRecord {
  readonly version: 1
  readonly phase: 'pending-lock'
  readonly matchId: string
  readonly placements: readonly CanonicalDuelPlacement[]
}

export interface PendingClaimRecord {
  readonly version: 1
  readonly phase: 'pending-claim'
  readonly matchId: string
  readonly invitationToken: string
  readonly claimRecoverySecret: string
}

export interface DuelParticipantRecord {
  readonly version: 1
  readonly matchId: string
  readonly role: DuelParticipantRole
  readonly token: string
}

export interface DuelInvitationRecord {
  readonly version: 1
  readonly matchId: string
  readonly token: string
}

export interface DuelMatchIndexRecord {
  readonly version: 1
  readonly matchIds: readonly string[]
}

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type DuelStorageErrorCode =
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'REMOVE_FAILED'
  | 'INVALID_DATA'

export class DuelStorageError extends Error {
  readonly code: DuelStorageErrorCode

  constructor(code: DuelStorageErrorCode) {
    super(
      code === 'READ_FAILED'
        ? 'DUEL browser storage could not be read.'
        : code === 'WRITE_FAILED'
          ? 'DUEL browser storage could not be written.'
          : code === 'REMOVE_FAILED'
            ? 'DUEL browser storage could not be cleared.'
            : 'DUEL browser storage contains invalid data.',
    )
    this.name = 'DuelStorageError'
    this.code = code
  }
}

export function participantStorageKey(matchId: string): string {
  return `3cb:duel:v1:participant:${validateUuid(matchId)}`
}

export function invitationStorageKey(matchId: string): string {
  return `3cb:duel:v1:invitation:${validateUuid(matchId)}`
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DuelStorageError('INVALID_DATA')
  }
  return value as Record<string, unknown>
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) {
    throw new DuelStorageError('INVALID_DATA')
  }
}

function validateUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new DuelStorageError('INVALID_DATA')
  }
  return value.toLowerCase()
}

function validateTotalRounds(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < DUEL_ROUNDS_MIN ||
    (value as number) > DUEL_ROUNDS_MAX
  ) {
    throw new DuelStorageError('INVALID_DATA')
  }
  return value as number
}

function validateCanonicalPlacement(value: unknown): CanonicalDuelPlacement {
  const record = objectRecord(value)
  exactKeys(record, [
    'roundNumber',
    'bagCount',
    'bombBagNumber',
    'coinBagNumbers',
  ])
  const { roundNumber, bagCount, bombBagNumber, coinBagNumbers } = record
  if (
    !Number.isInteger(roundNumber) ||
    !Number.isInteger(bagCount) ||
    !Number.isInteger(bombBagNumber) ||
    (roundNumber as number) < 1 ||
    (roundNumber as number) > DUEL_ROUNDS_MAX ||
    (bagCount as number) < 3 ||
    (bagCount as number) > 8 ||
    (bombBagNumber as number) < 1 ||
    (bombBagNumber as number) > (bagCount as number) ||
    !Array.isArray(coinBagNumbers) ||
    coinBagNumbers.length !== 3 ||
    !coinBagNumbers.every(
      (bag) =>
        Number.isInteger(bag) &&
        (bag as number) >= 1 &&
        (bag as number) <= (bagCount as number) &&
        bag !== bombBagNumber,
    )
  ) {
    throw new DuelStorageError('INVALID_DATA')
  }
  const coins = [...coinBagNumbers].sort((a, b) => (a as number) - (b as number))
  if (coins.some((coin, i) => coin !== coinBagNumbers[i])) {
    throw new DuelStorageError('INVALID_DATA')
  }
  return {
    roundNumber: roundNumber as number,
    bagCount: bagCount as number,
    bombBagNumber: bombBagNumber as number,
    coinBagNumbers: coins as [number, number, number],
  }
}

function validateCanonicalPlacements(
  value: unknown,
  totalRounds?: number,
): readonly CanonicalDuelPlacement[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DUEL_ROUNDS_MAX) {
    throw new DuelStorageError('INVALID_DATA')
  }
  if (totalRounds !== undefined && value.length !== totalRounds) {
    throw new DuelStorageError('INVALID_DATA')
  }
  const placements = value.map(validateCanonicalPlacement)
  if (placements.some((placement, index) => placement.roundNumber !== index + 1)) {
    throw new DuelStorageError('INVALID_DATA')
  }
  return placements
}

function readRaw(storage: StorageAdapter, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    throw new DuelStorageError('READ_FAILED')
  }
}

function parseRaw(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new DuelStorageError('INVALID_DATA')
  }
}

function writeVerified(storage: StorageAdapter, key: string, value: unknown): void {
  const serialized = JSON.stringify(value)
  try {
    storage.setItem(key, serialized)
  } catch {
    throw new DuelStorageError('WRITE_FAILED')
  }
  if (readRaw(storage, key) !== serialized) {
    throw new DuelStorageError('WRITE_FAILED')
  }
}

function removeVerified(storage: StorageAdapter, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    throw new DuelStorageError('REMOVE_FAILED')
  }
  if (readRaw(storage, key) !== null) {
    throw new DuelStorageError('REMOVE_FAILED')
  }
}

function readValidated<T>(
  storage: StorageAdapter,
  key: string,
  validate: (value: unknown) => T,
): T | null {
  const raw = readRaw(storage, key)
  return raw === null ? null : validate(parseRaw(raw))
}

export function toCanonicalDuelPlacements(
  placements: readonly DuelRoundPlacement[],
  totalRounds: number,
): readonly CanonicalDuelPlacement[] {
  const rounds = validateTotalRounds(totalRounds)
  if (
    placements.length !== rounds ||
    placements.some(
      (placement, index) =>
        placement.roundNumber !== index + 1 ||
        !isValidCompletedPlacement(placement),
    )
  ) {
    throw new DuelStorageError('INVALID_DATA')
  }
  return placements.map((placement) => {
    const bombBagNumber = Number(placement.bombBagId.replace(/^bag-/, ''))
    const coinBagNumbers: number[] = []
    for (const [bagId, count] of Object.entries(placement.coinCountsByBag)) {
      if (count === undefined) continue
      const bagNumber = Number(bagId.replace(/^bag-/, ''))
      for (let i = 0; i < count; i += 1) coinBagNumbers.push(bagNumber)
    }
    coinBagNumbers.sort((a, b) => a - b)
    return validateCanonicalPlacement({
      roundNumber: placement.roundNumber,
      bagCount: placement.bagCount,
      bombBagNumber,
      coinBagNumbers,
    })
  })
}

export function generateCreateRequestId(
  cryptoSource: Pick<Crypto, 'randomUUID'> = globalThis.crypto,
): string {
  return validateUuid(cryptoSource.randomUUID())
}

function encodeBase64Url(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const hasB = i + 1 < bytes.length
    const hasC = i + 2 < bytes.length
    const b = hasB ? bytes[i + 1] : 0
    const c = hasC ? bytes[i + 2] : 0
    result += alphabet[a >> 2]
    result += alphabet[((a & 3) << 4) | (b >> 4)]
    if (hasB) result += alphabet[((b & 15) << 2) | (c >> 6)]
    if (hasC) result += alphabet[c & 63]
  }
  return result
}

export function generateCreateRecoverySecret(
  cryptoSource: Pick<Crypto, 'getRandomValues'> = globalThis.crypto,
): string {
  const bytes = new Uint8Array(32)
  cryptoSource.getRandomValues(bytes)
  const encoded = encodeBase64Url(bytes)
  if (!BASE64URL_32_PATTERN.test(encoded)) {
    throw new DuelStorageError('INVALID_DATA')
  }
  return encoded
}

export function generateClaimRecoverySecret(
  cryptoSource: Pick<Crypto, 'getRandomValues'> = globalThis.crypto,
): string {
  return generateCreateRecoverySecret(cryptoSource)
}

export function createPendingClaimRecord(
  matchIdValue: string,
  invitationToken: string,
  cryptoSource: Pick<Crypto, 'getRandomValues'> = globalThis.crypto,
): PendingClaimRecord {
  const invitation = validateInvitation({
    version: DUEL_STORAGE_VERSION,
    matchId: matchIdValue,
    token: invitationToken,
  })
  return {
    version: DUEL_STORAGE_VERSION,
    phase: 'pending-claim',
    matchId: invitation.matchId,
    invitationToken: invitation.token,
    claimRecoverySecret: generateClaimRecoverySecret(cryptoSource),
  }
}

export function createPendingCreateRecord(
  placements: readonly DuelRoundPlacement[],
  totalRounds: number,
  cryptoSource: Pick<Crypto, 'randomUUID' | 'getRandomValues'> = globalThis.crypto,
): PendingCreateRecord {
  return {
    version: DUEL_STORAGE_VERSION,
    phase: 'pending-create',
    createRequestId: generateCreateRequestId(cryptoSource),
    createRecoverySecret: generateCreateRecoverySecret(cryptoSource),
    totalRounds: validateTotalRounds(totalRounds),
    placements: toCanonicalDuelPlacements(placements, totalRounds),
  }
}

export function validatePendingCreate(value: unknown): PendingCreateRecord {
  const record = objectRecord(value)
  exactKeys(record, [
    'version',
    'phase',
    'createRequestId',
    'createRecoverySecret',
    'totalRounds',
    'placements',
  ])
  if (
    record.version !== DUEL_STORAGE_VERSION ||
    record.phase !== 'pending-create' ||
    typeof record.createRecoverySecret !== 'string' ||
    !BASE64URL_32_PATTERN.test(record.createRecoverySecret)
  ) {
    throw new DuelStorageError('INVALID_DATA')
  }
  const totalRounds = validateTotalRounds(record.totalRounds)
  return {
    version: DUEL_STORAGE_VERSION,
    phase: 'pending-create',
    createRequestId: validateUuid(record.createRequestId),
    createRecoverySecret: record.createRecoverySecret,
    totalRounds,
    placements: validateCanonicalPlacements(record.placements, totalRounds),
  }
}

export function validatePendingLock(value: unknown): PendingLockRecord {
  const record = objectRecord(value)
  exactKeys(record, ['version', 'phase', 'matchId', 'placements'])
  if (record.version !== DUEL_STORAGE_VERSION || record.phase !== 'pending-lock') {
    throw new DuelStorageError('INVALID_DATA')
  }
  return {
    version: DUEL_STORAGE_VERSION,
    phase: 'pending-lock',
    matchId: validateUuid(record.matchId),
    placements: validateCanonicalPlacements(record.placements),
  }
}

export function validatePendingClaim(value: unknown): PendingClaimRecord {
  const record = objectRecord(value)
  exactKeys(record, [
    'version',
    'phase',
    'matchId',
    'invitationToken',
    'claimRecoverySecret',
  ])
  if (
    record.version !== DUEL_STORAGE_VERSION ||
    record.phase !== 'pending-claim' ||
    typeof record.claimRecoverySecret !== 'string' ||
    !BASE64URL_32_PATTERN.test(record.claimRecoverySecret)
  ) {
    throw new DuelStorageError('INVALID_DATA')
  }
  const invitation = validateInvitation({
    version: DUEL_STORAGE_VERSION,
    matchId: record.matchId,
    token: record.invitationToken,
  })
  return {
    version: DUEL_STORAGE_VERSION,
    phase: 'pending-claim',
    matchId: invitation.matchId,
    invitationToken: invitation.token,
    claimRecoverySecret: record.claimRecoverySecret,
  }
}

export function validateParticipant(value: unknown): DuelParticipantRecord {
  const record = objectRecord(value)
  exactKeys(record, ['version', 'matchId', 'role', 'token'])
  if (
    record.version !== DUEL_STORAGE_VERSION ||
    (record.role !== 'A' && record.role !== 'B') ||
    typeof record.token !== 'string' ||
    (record.role === 'A'
      ? !PARTICIPANT_A_TOKEN_PATTERN.test(record.token)
      : !PARTICIPANT_B_TOKEN_PATTERN.test(record.token))
  ) {
    throw new DuelStorageError('INVALID_DATA')
  }
  return {
    version: DUEL_STORAGE_VERSION,
    matchId: validateUuid(record.matchId),
    role: record.role,
    token: record.token,
  }
}

export function validateInvitation(value: unknown): DuelInvitationRecord {
  const record = objectRecord(value)
  exactKeys(record, ['version', 'matchId', 'token'])
  if (
    record.version !== DUEL_STORAGE_VERSION ||
    typeof record.token !== 'string' ||
    !INVITATION_TOKEN_PATTERN.test(record.token)
  ) {
    throw new DuelStorageError('INVALID_DATA')
  }
  return {
    version: DUEL_STORAGE_VERSION,
    matchId: validateUuid(record.matchId),
    token: record.token,
  }
}

export function validateMatchIndex(value: unknown): DuelMatchIndexRecord {
  const record = objectRecord(value)
  exactKeys(record, ['version', 'matchIds'])
  if (
    record.version !== DUEL_STORAGE_VERSION ||
    !Array.isArray(record.matchIds)
  ) {
    throw new DuelStorageError('INVALID_DATA')
  }
  const matchIds = record.matchIds.map(validateUuid)
  if (new Set(matchIds).size !== matchIds.length) {
    throw new DuelStorageError('INVALID_DATA')
  }
  return { version: DUEL_STORAGE_VERSION, matchIds }
}

export function savePendingCreate(
  storage: StorageAdapter,
  record: PendingCreateRecord,
): void {
  writeVerified(storage, DUEL_PENDING_CREATE_KEY, validatePendingCreate(record))
}

export function readPendingCreate(storage: StorageAdapter): PendingCreateRecord | null {
  return readValidated(storage, DUEL_PENDING_CREATE_KEY, validatePendingCreate)
}

export function readPendingLock(storage: StorageAdapter): PendingLockRecord | null {
  return readValidated(storage, DUEL_PENDING_LOCK_KEY, validatePendingLock)
}

export function savePendingClaim(
  storage: StorageAdapter,
  record: PendingClaimRecord,
): void {
  writeVerified(storage, DUEL_PENDING_CLAIM_KEY, validatePendingClaim(record))
}

export function readPendingClaim(storage: StorageAdapter): PendingClaimRecord | null {
  return readValidated(storage, DUEL_PENDING_CLAIM_KEY, validatePendingClaim)
}

export function readParticipant(
  storage: StorageAdapter,
  matchId: string,
): DuelParticipantRecord | null {
  return readValidated(storage, participantStorageKey(matchId), validateParticipant)
}

export function readInvitation(
  storage: StorageAdapter,
  matchId: string,
): DuelInvitationRecord | null {
  return readValidated(storage, invitationStorageKey(matchId), validateInvitation)
}

export function readMatchIndex(storage: StorageAdapter): DuelMatchIndexRecord {
  return (
    readValidated(storage, DUEL_MATCH_INDEX_KEY, validateMatchIndex) ?? {
      version: DUEL_STORAGE_VERSION,
      matchIds: [],
    }
  )
}

export interface CreatedMatchSecrets {
  readonly matchId: string
  readonly participantToken: string
  readonly invitationToken: string
}

/**
 * Durable create-to-LOCK handoff. pending-create is removed only after the A
 * participant, B invitation, and pending-lock records all pass read-back.
 */
export function persistCreatedMatchHandoff(
  storage: StorageAdapter,
  created: CreatedMatchSecrets,
): PendingLockRecord {
  const pendingCreate = readPendingCreate(storage)
  if (!pendingCreate) throw new DuelStorageError('INVALID_DATA')
  const matchId = validateUuid(created.matchId)
  const participant = validateParticipant({
    version: DUEL_STORAGE_VERSION,
    matchId,
    role: 'A',
    token: created.participantToken,
  })
  const invitation = validateInvitation({
    version: DUEL_STORAGE_VERSION,
    matchId,
    token: created.invitationToken,
  })
  const pendingLock = validatePendingLock({
    version: DUEL_STORAGE_VERSION,
    phase: 'pending-lock',
    matchId,
    placements: pendingCreate.placements,
  })
  writeVerified(storage, participantStorageKey(matchId), participant)
  writeVerified(storage, invitationStorageKey(matchId), invitation)
  writeVerified(storage, DUEL_PENDING_LOCK_KEY, pendingLock)
  removeVerified(storage, DUEL_PENDING_CREATE_KEY)
  return pendingLock
}

/** Updates the durable match index before clearing the retryable LOCK record. */
export function completePendingLock(
  storage: StorageAdapter,
  matchIdValue: string,
): DuelMatchIndexRecord {
  const matchId = validateUuid(matchIdValue)
  const pendingLock = readPendingLock(storage)
  const participant = readParticipant(storage, matchId)
  const invitation = readInvitation(storage, matchId)
  if (
    !pendingLock ||
    pendingLock.matchId !== matchId ||
    participant?.role !== 'A' ||
    invitation?.matchId !== matchId
  ) {
    throw new DuelStorageError('INVALID_DATA')
  }
  const current = readMatchIndex(storage)
  const next = validateMatchIndex({
    version: DUEL_STORAGE_VERSION,
    matchIds: current.matchIds.includes(matchId)
      ? current.matchIds
      : [...current.matchIds, matchId],
  })
  writeVerified(storage, DUEL_MATCH_INDEX_KEY, next)
  removeVerified(storage, DUEL_PENDING_LOCK_KEY)
  return next
}

export interface CompleteParticipantBClaimInput {
  readonly matchId: string
  readonly participantToken: string
}

/** Persists B and the index before removing the only retryable claim secret. */
export function completeParticipantBClaim(
  storage: StorageAdapter,
  input: CompleteParticipantBClaimInput,
): DuelMatchIndexRecord {
  const pending = readPendingClaim(storage)
  if (!pending || pending.matchId !== input.matchId.toLowerCase()) {
    throw new DuelStorageError('INVALID_DATA')
  }
  const participant = validateParticipant({
    version: DUEL_STORAGE_VERSION,
    matchId: input.matchId,
    role: 'B',
    token: input.participantToken,
  })
  const existing = readParticipant(storage, participant.matchId)
  if (existing?.role === 'A') throw new DuelStorageError('INVALID_DATA')
  if (existing && existing.token !== participant.token) {
    throw new DuelStorageError('INVALID_DATA')
  }
  writeVerified(storage, participantStorageKey(participant.matchId), participant)
  const current = readMatchIndex(storage)
  const next = validateMatchIndex({
    version: DUEL_STORAGE_VERSION,
    matchIds: current.matchIds.includes(participant.matchId)
      ? current.matchIds
      : [...current.matchIds, participant.matchId],
  })
  writeVerified(storage, DUEL_MATCH_INDEX_KEY, next)
  removeVerified(storage, DUEL_PENDING_CLAIM_KEY)
  return next
}

export type DuelARecoveryState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'create-retry'; readonly pending: PendingCreateRecord }
  | {
      readonly phase: 'lock-retry'
      readonly pending: PendingLockRecord
      readonly participant: DuelParticipantRecord
      readonly invitation: DuelInvitationRecord
    }

/** Determines the next safe network action after reload without making a request. */
export function readARecoveryState(storage: StorageAdapter): DuelARecoveryState {
  const pendingLock = readPendingLock(storage)
  if (pendingLock) {
    const participant = readParticipant(storage, pendingLock.matchId)
    const invitation = readInvitation(storage, pendingLock.matchId)
    if (
      participant?.role === 'A' &&
      participant.matchId === pendingLock.matchId &&
      invitation?.matchId === pendingLock.matchId
    ) {
      return { phase: 'lock-retry', pending: pendingLock, participant, invitation }
    }
  }
  const pendingCreate = readPendingCreate(storage)
  if (pendingCreate) return { phase: 'create-retry', pending: pendingCreate }
  if (pendingLock) {
    const participant = readParticipant(storage, pendingLock.matchId)
    if (participant?.role === 'B') return { phase: 'idle' }
    throw new DuelStorageError('INVALID_DATA')
  }
  return { phase: 'idle' }
}

export type DuelBRecoveryState =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'lock-retry'
      readonly pending: PendingLockRecord
      readonly participant: DuelParticipantRecord
    }

/** Determines the next safe B LOCK action after reload without making a request. */
export function readBRecoveryState(
  storage: StorageAdapter,
  matchIdValue: string,
): DuelBRecoveryState {
  const matchId = validateUuid(matchIdValue)
  const pendingLock = readPendingLock(storage)
  if (!pendingLock || pendingLock.matchId !== matchId) {
    return { phase: 'idle' }
  }
  const participant = readParticipant(storage, matchId)
  if (
    participant?.role === 'B' &&
    participant.matchId === pendingLock.matchId
  ) {
    return { phase: 'lock-retry', pending: pendingLock, participant }
  }
  return { phase: 'idle' }
}

export function savePendingLock(
  storage: StorageAdapter,
  record: PendingLockRecord,
): void {
  writeVerified(storage, DUEL_PENDING_LOCK_KEY, validatePendingLock(record))
}

/** Clears retryable B LOCK state after server confirmation. */
export function completeParticipantBLock(
  storage: StorageAdapter,
  matchIdValue: string,
): DuelMatchIndexRecord {
  const matchId = validateUuid(matchIdValue)
  const pendingLock = readPendingLock(storage)
  const participant = readParticipant(storage, matchId)
  if (
    !pendingLock ||
    pendingLock.matchId !== matchId ||
    participant?.role !== 'B' ||
    participant.matchId !== matchId
  ) {
    throw new DuelStorageError('INVALID_DATA')
  }
  const current = readMatchIndex(storage)
  const next = validateMatchIndex({
    version: DUEL_STORAGE_VERSION,
    matchIds: current.matchIds.includes(matchId)
      ? current.matchIds
      : [...current.matchIds, matchId],
  })
  writeVerified(storage, DUEL_MATCH_INDEX_KEY, next)
  removeVerified(storage, DUEL_PENDING_LOCK_KEY)
  return next
}
