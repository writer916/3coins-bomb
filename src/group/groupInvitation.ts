import { validateGroupHostRecord } from './groupPersistence'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INVITATION_PATTERN = /^3cb_gi1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const HOST_PATTERN = /^3cb_gh1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

export class GroupInvitationUrlError extends Error {
  constructor() {
    super('The GROUP invitation URL is invalid or unavailable.')
    this.name = 'GroupInvitationUrlError'
  }
}

export type GroupUrlFragmentKind = 'invite' | 'host' | 'none' | 'invalid'

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

function parseGroupPath(url: URL): string {
  const match = /^\/group\/([^/]+)$/.exec(url.pathname)
  if (!match) return invalid()
  try {
    const groupId = decodeURIComponent(match[1]!)
    if (!UUID_V4_PATTERN.test(groupId)) return invalid()
    return groupId.toLowerCase()
  } catch {
    return invalid()
  }
}

/** Player-facing URL: `/group/{id}#invite={invitationToken}` */
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

/**
 * Host-facing durable URL (DUEL `#p=` analogue).
 * Format: `/group/{id}#host={hostToken}&invite={invitationToken}`
 * Invite is required so join/resume works without prior localStorage.
 * Fragment stays client-side only.
 */
export function createGroupHostUrl(
  origin: string,
  groupIdValue: string,
  hostToken: string,
  invitationToken: string,
): string {
  if (
    !UUID_V4_PATTERN.test(groupIdValue) ||
    !HOST_PATTERN.test(hostToken) ||
    !INVITATION_PATTERN.test(invitationToken)
  ) {
    return invalid()
  }
  const groupId = groupIdValue.toLowerCase()
  const url = new URL(`/group/${groupId}`, parseOrigin(origin))
  url.hash = new URLSearchParams({
    host: hostToken,
    invite: invitationToken,
  }).toString()
  return url.toString()
}

export interface ParsedGroupInvitationUrl {
  readonly groupId: string
  readonly invitationToken: string
  readonly cleanPath: string
}

export interface ParsedGroupHostUrl {
  readonly groupId: string
  readonly hostToken: string
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
  const groupId = parseGroupPath(url)
  if (!url.hash.startsWith('#')) return invalid()
  const fields = [...new URLSearchParams(url.hash.slice(1)).entries()]
  if (
    fields.length !== 1 ||
    fields[0]![0] !== 'invite' ||
    !INVITATION_PATTERN.test(fields[0]![1])
  ) return invalid()
  return {
    groupId,
    invitationToken: fields[0]![1],
    cleanPath: `/group/${groupId}`,
  }
}

export function parseGroupHostUrl(value: string): ParsedGroupHostUrl {
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
  const groupId = parseGroupPath(url)
  if (!url.hash.startsWith('#')) return invalid()
  const params = new URLSearchParams(url.hash.slice(1))
  const fields = [...params.entries()]
  if (fields.length !== 2) return invalid()
  const hostToken = params.get('host')
  const invitationToken = params.get('invite')
  if (
    hostToken === null ||
    invitationToken === null ||
    !HOST_PATTERN.test(hostToken) ||
    !INVITATION_PATTERN.test(invitationToken)
  ) return invalid()
  return {
    groupId,
    hostToken,
    invitationToken,
    cleanPath: `/group/${groupId}`,
  }
}

/** Route `/group/:id` with `#invite=` vs `#host=` (DUEL classify analogue). */
export function classifyGroupUrlFragment(value: string): GroupUrlFragmentKind {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'invalid'
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    !/^\/group\/[^/]+$/.test(url.pathname)
  ) {
    return 'invalid'
  }
  if (!url.hash || url.hash === '#') return 'none'
  try {
    parseGroupHostUrl(value)
    return 'host'
  } catch {
    /* continue */
  }
  try {
    parseGroupInvitationUrl(value)
    return 'invite'
  } catch {
    return 'invalid'
  }
}

export function isGroupRouteUrl(value: string): boolean {
  try {
    return /^\/group\/[^/]+$/.test(new URL(value).pathname)
  } catch {
    return false
  }
}

/** Builds player invite URL from a stored host record (never embeds hostToken). */
export function invitationUrlFromGroupHost(origin: string, value: unknown): string {
  const host = validateGroupHostRecord(value)
  return createGroupInvitationUrl(origin, host.groupId, host.invitationToken)
}

/** Builds host personal URL from a stored host record. */
export function hostUrlFromGroupHost(origin: string, value: unknown): string {
  const host = validateGroupHostRecord(value)
  return createGroupHostUrl(
    origin,
    host.groupId,
    host.hostToken,
    host.invitationToken,
  )
}
