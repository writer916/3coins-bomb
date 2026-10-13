import { randomBytes } from 'node:crypto'
import {
  validateGroupPlacementSet,
  type GroupPlacementCandidate,
} from '../../src/group/groupDomain.js'
import { generateUniqueQuestionSet } from '../../src/game/questionGeneration.js'

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

export function createGeneratedGroupPlacementProvider(
  random: GroupRandomSource = createServerCryptoRandomSource(),
): GroupPlacementProvider {
  return {
    provide(totalRounds) {
      const placements: GroupPlacementCandidate[] = generateUniqueQuestionSet(
        totalRounds,
        random,
      ).map((question, index) => ({
        origin: 'generated',
        placement: {
          roundNumber: index + 1,
          bagCount: question.bagCount,
          bombBagNumber: question.bombBagNumber,
          coinBagNumbers: question.coinBagNumbers,
        },
      }))
      return validateGroupPlacementSet({ totalRounds, placements }).placements
    },
  }
}
