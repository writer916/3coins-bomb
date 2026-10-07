import { validateGroupHostRecord } from './groupPersistence'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INVITATION_PATTERN = /^3cb_gi1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

export class GroupInvitationUrlError extends Error {
  constructor() {
    super('The GROUP invitation URL is invalid or unavailable.')
    this.name = 'GroupInvitationUrlError'
  }
}

function invalid(): never {
  throw new GroupInvitationUrlError()
}

function parseOrigin(value: string): URL {
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash
    ) return invalid()
    return url
  } catch {
    return invalid()
  }
}

export function createGroupInvitationUrl(
  origin: string,
  groupIdValue: string,
  invitationToken: string,
): string {
  if (!UUID_V4_PATTERN.test(groupIdValue) || !INVITATION_PATTERN.test(invitationToken)) {
    return invalid()
  }
  const groupId = groupIdValue.toLowerCase()
  const url = new URL(`/group/${groupId}`, parseOrigin(origin))
  url.hash = new URLSearchParams({ invite: invitationToken }).toString()
  return url.toString()
}

export interface ParsedGroupInvitationUrl {
  readonly groupId: string
  readonly invitationToken: string
  readonly cleanPath: string
}

export function parseGroupInvitationUrl(value: string): ParsedGroupInvitationUrl {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return invalid()
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username || url.password || url.search
  ) return invalid()
  const match = /^\/group\/([^/]+)$/.exec(url.pathname)
  if (!match || !url.hash.startsWith('#')) return invalid()
  let groupId: string
  try {
    groupId = decodeURIComponent(match[1]!)
  } catch {
    return invalid()
  }
  const fields = [...new URLSearchParams(url.hash.slice(1)).entries()]
  if (
    !UUID_V4_PATTERN.test(groupId) ||
    fields.length !== 1 ||
    fields[0]![0] !== 'invite' ||
    !INVITATION_PATTERN.test(fields[0]![1])
  ) return invalid()
  return {
    groupId: groupId.toLowerCase(),
    invitationToken: fields[0]![1],
    cleanPath: `/group/${groupId.toLowerCase()}`,
  }
}

export function isGroupRouteUrl(value: string): boolean {
  try {
    return /^\/group\/[^/]+$/.test(new URL(value).pathname)
  } catch {
    return false
  }
}

/** Compile-time/client boundary check: host records are accepted, never encoded in URLs. */
export function invitationUrlFromGroupHost(origin: string, value: unknown): string {
  const host = validateGroupHostRecord(value)
  return createGroupInvitationUrl(origin, host.groupId, host.invitationToken)
}
