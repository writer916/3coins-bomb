import { randomBytes } from 'node:crypto'
import {
  GROUP_BAG_COUNT_MAX,
  GROUP_BAG_COUNT_MIN,
  validateGroupPlacementSet,
  type GroupPlacementCandidate,
} from '../../src/group/groupDomain.js'

export interface GroupRandomSource {
  readonly next: () => number
}

export interface GroupPlacementProvider {
  readonly provide: (
    totalRounds: number,
  ) => readonly GroupPlacementCandidate[]
}

/** Uniform 53-bit Web/Node-independent RandomSource backed by Node crypto. */
export function createServerCryptoRandomSource(): GroupRandomSource {
  return {
    next(): number {
      const bytes = randomBytes(7)
      let value = bytes[0]! & 0x1f
      for (let index = 1; index < bytes.length; index += 1) {
        value = value * 256 + bytes[index]!
      }
      return value / 0x20_0000_0000_0000
    },
  }
}

function pickInteger(random: GroupRandomSource, min: number, max: number): number {
  const sample = random.next()
  if (!(sample >= 0 && sample < 1)) {
    throw new Error('GROUP random source returned an invalid sample.')
  }
  return min + Math.floor(sample * (max - min + 1))
}

export function createGeneratedGroupPlacementProvider(
  random: GroupRandomSource = createServerCryptoRandomSource(),
): GroupPlacementProvider {
  return {
    provide(totalRounds) {
      const placements: GroupPlacementCandidate[] = []
      for (let roundNumber = 1; roundNumber <= totalRounds; roundNumber += 1) {
        const bagCount = pickInteger(
          random,
          GROUP_BAG_COUNT_MIN,
          GROUP_BAG_COUNT_MAX,
        )
        const bombBagNumber = pickInteger(random, 1, bagCount)
        const coinCandidates = Array.from(
          { length: bagCount },
          (_, index) => index + 1,
        ).filter((bagNumber) => bagNumber !== bombBagNumber)
        const coinBagNumbers = Array.from({ length: 3 }, () =>
          coinCandidates[pickInteger(random, 0, coinCandidates.length - 1)]!,
        ).sort((a, b) => a - b)
        placements.push({
          origin: 'generated',
          placement: {
            roundNumber,
            bagCount,
            bombBagNumber,
            coinBagNumbers: coinBagNumbers as [number, number, number],
          },
        })
      }
      return validateGroupPlacementSet({ totalRounds, placements }).placements
    },
  }
}
