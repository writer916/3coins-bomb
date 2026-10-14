import { createHash, createHmac } from 'node:crypto'
import { validateDailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import {
  readDuelTokenHmacKey,
  validateCreateRequestId,
} from './duelTokens.js'

export const DAILY_PARTICIPANT_TOKEN_PREFIX = '3cb_dp1_'
const DAILY_TOKEN_DERIVATION_VERSION = 1
const DAILY_QUESTION_COUNT = 20
const CANONICAL_32_BYTE_BASE64URL = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

function updateFramed(
  hmac: ReturnType<typeof createHmac>,
  value: Uint8Array,
): void {
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(value.byteLength)
  hmac.update(length)
  hmac.update(value)
}

/** Deterministic per-day JOIN capability supports safe response-loss recovery. */
export function deriveDailyParticipantCapability(
  challengeDateValue: unknown,
  joinRequestIdValue: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const challengeDate = validateDailyChallengeDate(challengeDateValue)
  const joinRequestId = validateCreateRequestId(joinRequestIdValue)
  const hmac = createHmac('sha256', readDuelTokenHmacKey(environment))
  updateFramed(hmac, Buffer.from('3cb-daily-token', 'utf8'))
  updateFramed(hmac, Buffer.from([DAILY_TOKEN_DERIVATION_VERSION]))
  updateFramed(hmac, Buffer.from('participant', 'utf8'))
  updateFramed(hmac, Buffer.from(challengeDate, 'utf8'))
  updateFramed(hmac, Buffer.from(joinRequestId, 'utf8'))
  return DAILY_PARTICIPANT_TOKEN_PREFIX + hmac.digest('base64url')
}

/** Keyed deterministic shuffle: retries derive exactly the same 1..20 order. */
export function deriveDailyQuestionOrder(
  challengeDateValue: unknown,
  joinRequestIdValue: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): readonly number[] {
  const challengeDate = validateDailyChallengeDate(challengeDateValue)
  const joinRequestId = validateCreateRequestId(joinRequestIdValue)
  const key = readDuelTokenHmacKey(environment)
  let block = Buffer.alloc(0)
  let offset = 0
  let counter = 0
  const nextByte = (): number => {
    if (offset >= block.length) {
      const hmac = createHmac('sha256', key)
      updateFramed(hmac, Buffer.from('3cb-daily-question-order', 'utf8'))
      updateFramed(hmac, Buffer.from([DAILY_TOKEN_DERIVATION_VERSION]))
      updateFramed(hmac, Buffer.from(challengeDate, 'utf8'))
      updateFramed(hmac, Buffer.from(joinRequestId, 'utf8'))
      const encodedCounter = Buffer.allocUnsafe(4)
      encodedCounter.writeUInt32BE(counter)
      updateFramed(hmac, encodedCounter)
      block = hmac.digest()
      offset = 0
      counter += 1
    }
    return block[offset++]!
  }
  const order = Array.from({ length: DAILY_QUESTION_COUNT }, (_, index) => index + 1)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const range = index + 1
    const unbiasedLimit = Math.floor(256 / range) * range
    let byte = nextByte()
    while (byte >= unbiasedLimit) byte = nextByte()
    const selected = byte % range
    const value = order[index]!
    order[index] = order[selected]!
    order[selected] = value
  }
  return order
}

export function validateDailyParticipantCapability(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith(DAILY_PARTICIPANT_TOKEN_PREFIX) ||
    !CANONICAL_32_BYTE_BASE64URL.test(
      value.slice(DAILY_PARTICIPANT_TOKEN_PREFIX.length),
    )
  ) {
    throw new Error('A valid DAILY participant capability is required.')
  }
  return value
}

export function hashDailyParticipantCapability(tokenValue: unknown): string {
  const token = validateDailyParticipantCapability(tokenValue)
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
