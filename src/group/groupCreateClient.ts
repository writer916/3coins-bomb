import type { RandomUuidCrypto } from '../browser/randomUuid'
import {
  GROUP_FORMATION_VERSION,
  GROUP_RULE_VERSION,
  GROUP_SCORING_VERSION,
} from './groupDomain'
import { createGroupHostUrl, createGroupInvitationUrl } from './groupInvitation'
import {
  completeGroupCreate,
  createPendingGroupCreate,
  readPendingGroupCreate,
  savePendingGroupCreate,
  type GroupHostRecord,
  type GroupStorageAdapter,
} from './groupPersistence'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INVITATION_PATTERN = /^3cb_gi1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const HOST_PATTERN = /^3cb_gh1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

export class GroupCreateClientError extends Error {
  constructor() {
    super('The GROUP could not be created.')
    this.name = 'GroupCreateClientError'
  }
}

export interface GroupCreateClientDependencies {
  readonly storage: GroupStorageAdapter
  readonly fetch: typeof fetch
  readonly crypto: RandomUuidCrypto
  readonly origin: string
}

export interface GroupCreateClientInput {
  readonly totalRounds: number
  readonly playerLimit: number
}

export interface GroupCreateClientResult {
  readonly groupId: string
  readonly invitationUrl: string
  readonly hostUrl: string
}

function invalid(): never {
  throw new GroupCreateClientError()
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}

function parseResponse(value: unknown, input: GroupCreateClientInput): GroupHostRecord {
  const record = object(value)
  const invitation = object(record.invitation)
  const host = object(record.host)
  const keys = Object.keys(record).sort()
  const expected = [
    'groupId', 'totalRounds', 'playerLimit', 'invitation', 'host', 'createdAt',
    'expiresAt', 'formationVersion', 'ruleVersion', 'scoringVersion',
  ].sort()
  if (
    keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) ||
    Object.keys(invitation).length !== 1 || Object.keys(invitation)[0] !== 'token' ||
    Object.keys(host).length !== 1 || Object.keys(host)[0] !== 'token' ||
    typeof record.groupId !== 'string' || !UUID_V4_PATTERN.test(record.groupId) ||
    record.totalRounds !== input.totalRounds || record.playerLimit !== input.playerLimit ||
    typeof invitation.token !== 'string' || !INVITATION_PATTERN.test(invitation.token) ||
    typeof host.token !== 'string' || !HOST_PATTERN.test(host.token) ||
    typeof record.createdAt !== 'string' ||
    new Date(record.createdAt).toISOString() !== record.createdAt ||
    record.expiresAt !== null ||
    record.formationVersion !== GROUP_FORMATION_VERSION ||
    record.ruleVersion !== GROUP_RULE_VERSION ||
    record.scoringVersion !== GROUP_SCORING_VERSION
  ) return invalid()
  return {
    version: 1,
    groupId: record.groupId.toLowerCase(),
    invitationToken: invitation.token,
    hostToken: host.token,
    totalRounds: input.totalRounds,
    playerLimit: input.playerLimit,
    formationVersion: GROUP_FORMATION_VERSION,
    ruleVersion: GROUP_RULE_VERSION,
    scoringVersion: GROUP_SCORING_VERSION,
  }
}

async function executeCreate(
  input: GroupCreateClientInput,
  dependencies: GroupCreateClientDependencies,
): Promise<GroupCreateClientResult> {
  try {
    const existing = readPendingGroupCreate(dependencies.storage)
    const pending = existing ?? createPendingGroupCreate(
      input.totalRounds,
      input.playerLimit,
      dependencies.crypto,
    )
    if (
      pending.totalRounds !== input.totalRounds ||
      pending.playerLimit !== input.playerLimit
    ) return invalid()
    if (!existing) savePendingGroupCreate(dependencies.storage, pending)

    const response = await dependencies.fetch('/api/group/matches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': pending.createRequestId,
      },
      body: JSON.stringify({
        totalRounds: pending.totalRounds,
        playerLimit: pending.playerLimit,
      }),
    })
    if (!response.ok) return invalid()
    let json: unknown
    try {
      json = await response.json()
    } catch {
      return invalid()
    }
    const host = parseResponse(json, input)
    completeGroupCreate(dependencies.storage, host)
    return {
      groupId: host.groupId,
      invitationUrl: createGroupInvitationUrl(
        dependencies.origin,
        host.groupId,
        host.invitationToken,
      ),
      hostUrl: createGroupHostUrl(
        dependencies.origin,
        host.groupId,
        host.hostToken,
        host.invitationToken,
      ),
    }
  } catch (error: unknown) {
    if (error instanceof GroupCreateClientError) throw error
    throw new GroupCreateClientError()
  }
}

export function createGroupCreateCoordinator(
  dependencies: GroupCreateClientDependencies,
): { run(input: GroupCreateClientInput): Promise<GroupCreateClientResult> } {
  let inFlight: Promise<GroupCreateClientResult> | null = null
  return {
    run(input) {
      if (inFlight) return inFlight
      inFlight = executeCreate(input, dependencies).finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}
