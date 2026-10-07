import { createHash } from 'node:crypto'

const ENTRY_KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/

/**
 * Opaque, non-secret ranking entry key for closed-GROUP detail lookup.
 * Deterministic from groupId + participantId; not reversible without brute force.
 */
export function createGroupResultEntryKey(
  groupId: string,
  participantId: string,
): string {
  return createHash('sha256')
    .update('3cb-group-result-entry\0', 'utf8')
    .update(groupId, 'utf8')
    .update('\0', 'utf8')
    .update(participantId, 'utf8')
    .digest('base64url')
    .slice(0, 22)
}

export function validateGroupResultEntryKey(value: unknown): string {
  if (typeof value !== 'string' || !ENTRY_KEY_PATTERN.test(value)) {
    throw new Error('Invalid GROUP result entry key.')
  }
  return value
}
