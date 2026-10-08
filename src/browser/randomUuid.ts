/**
 * Browser UUID v4 for client Idempotency-Key / pending-create IDs.
 * Prefers crypto.randomUUID(); falls back to getRandomValues on non-secure
 * contexts (e.g. http://192.168.x.x). Does not use non-crypto RNG.
 */

export type RandomUuidCrypto = {
  readonly randomUUID?: Crypto['randomUUID']
  readonly getRandomValues?: Crypto['getRandomValues']
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0')
}

function uuidFromBytes(bytes: Uint8Array): string {
  /* RFC 4122 version 4 + variant 10xx */
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return (
    `${hex2(bytes[0]!)}${hex2(bytes[1]!)}${hex2(bytes[2]!)}${hex2(bytes[3]!)}-` +
    `${hex2(bytes[4]!)}${hex2(bytes[5]!)}-` +
    `${hex2(bytes[6]!)}${hex2(bytes[7]!)}-` +
    `${hex2(bytes[8]!)}${hex2(bytes[9]!)}-` +
    `${hex2(bytes[10]!)}${hex2(bytes[11]!)}${hex2(bytes[12]!)}` +
    `${hex2(bytes[13]!)}${hex2(bytes[14]!)}${hex2(bytes[15]!)}`
  )
}

function fromGetRandomValues(cryptoSource: RandomUuidCrypto): string {
  if (typeof cryptoSource.getRandomValues !== 'function') {
    throw new Error('UUID generation requires crypto.getRandomValues.')
  }
  const bytes = new Uint8Array(16)
  cryptoSource.getRandomValues(bytes)
  const value = uuidFromBytes(bytes)
  if (!UUID_V4_PATTERN.test(value)) {
    throw new Error('UUID generation produced an invalid value.')
  }
  return value
}

/** RFC 4122 UUID v4 string (lowercase hex). */
export function randomUuid(
  cryptoSource: RandomUuidCrypto = globalThis.crypto,
): string {
  if (typeof cryptoSource.randomUUID === 'function') {
    try {
      const value = cryptoSource.randomUUID.call(cryptoSource)
      if (typeof value === 'string' && UUID_V4_PATTERN.test(value)) {
        return value.toLowerCase()
      }
    } catch {
      /* non-secure context may expose then reject randomUUID */
    }
  }
  return fromGetRandomValues(cryptoSource)
}
