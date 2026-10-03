import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildDuelParticipantUrl,
  createDuelInvitationUrl,
  DuelInvitationUrlError,
  DuelParticipantUrlError,
  parseDuelInvitationUrl,
  parseDuelParticipantUrl,
} from '../src/duel/duelInvitation'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_A_TOKEN = `3cb_pa1_${'c'.repeat(42)}A`
const PARTICIPANT_B_TOKEN = `3cb_pb1_${'d'.repeat(42)}A`
const INVITATION_TOKEN = `3cb_pi1_${'a'.repeat(42)}A`
const ORIGIN = 'https://example.test'
const EXPECTED_A_URL = `${ORIGIN}/duel/${MATCH_ID}#p=${PARTICIPANT_A_TOKEN}`
const EXPECTED_B_URL = `${ORIGIN}/duel/${MATCH_ID}#p=${PARTICIPANT_B_TOKEN}`
const EXPECTED_INVITE_URL = `${ORIGIN}/duel/${MATCH_ID}#invite=${INVITATION_TOKEN}`

function expectParticipantInvalid(action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof DuelParticipantUrlError)
    assert(!error.message.includes(PARTICIPANT_A_TOKEN))
    assert(!error.message.includes(PARTICIPANT_B_TOKEN))
    assert(!error.message.includes(INVITATION_TOKEN))
    assert(!error.message.includes(EXPECTED_A_URL))
    return true
  })
}

function expectInvitationInvalid(action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof DuelInvitationUrlError)
    assert(!error.message.includes(PARTICIPANT_A_TOKEN))
    assert(!error.message.includes(INVITATION_TOKEN))
    return true
  })
}

const builtA = buildDuelParticipantUrl(ORIGIN, MATCH_ID, PARTICIPANT_A_TOKEN)
assert.equal(builtA, EXPECTED_A_URL)
const builtB = buildDuelParticipantUrl(ORIGIN, MATCH_ID, PARTICIPANT_B_TOKEN)
assert.equal(builtB, EXPECTED_B_URL)

for (const built of [builtA, builtB]) {
  const url = new URL(built)
  assert.equal(url.pathname, `/duel/${MATCH_ID}`)
  assert.equal(url.search, '')
  assert(!url.pathname.includes('3cb_'))
  assert(!url.search.includes('3cb_'))
  assert(url.hash.startsWith('#p='))
  assert(!url.hash.includes('invite='))
}

assert.deepEqual(parseDuelParticipantUrl(EXPECTED_A_URL), {
  matchId: MATCH_ID,
  participantToken: PARTICIPANT_A_TOKEN,
  cleanPath: `/duel/${MATCH_ID}`,
})
assert.deepEqual(parseDuelParticipantUrl(EXPECTED_B_URL), {
  matchId: MATCH_ID,
  participantToken: PARTICIPANT_B_TOKEN,
  cleanPath: `/duel/${MATCH_ID}`,
})

assert.deepEqual(parseDuelParticipantUrl(builtA), {
  matchId: MATCH_ID,
  participantToken: PARTICIPANT_A_TOKEN,
  cleanPath: `/duel/${MATCH_ID}`,
})
assert.deepEqual(parseDuelParticipantUrl(builtB), {
  matchId: MATCH_ID,
  participantToken: PARTICIPANT_B_TOKEN,
  cleanPath: `/duel/${MATCH_ID}`,
})

assert.equal(
  createDuelInvitationUrl(ORIGIN, MATCH_ID, INVITATION_TOKEN),
  EXPECTED_INVITE_URL,
)
assert.deepEqual(parseDuelInvitationUrl(EXPECTED_INVITE_URL), {
  matchId: MATCH_ID,
  invitationToken: INVITATION_TOKEN,
  cleanPath: `/duel/${MATCH_ID}`,
})

expectParticipantInvalid(() => parseDuelParticipantUrl(EXPECTED_INVITE_URL))
expectInvitationInvalid(() => parseDuelInvitationUrl(EXPECTED_A_URL))
expectInvitationInvalid(() => parseDuelInvitationUrl(EXPECTED_B_URL))

expectParticipantInvalid(() =>
  buildDuelParticipantUrl(ORIGIN, MATCH_ID, INVITATION_TOKEN),
)
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(`${ORIGIN}/duel/${MATCH_ID}#p=${INVITATION_TOKEN}`),
)
expectInvitationInvalid(() =>
  createDuelInvitationUrl(ORIGIN, MATCH_ID, PARTICIPANT_A_TOKEN),
)
expectInvitationInvalid(() =>
  parseDuelInvitationUrl(`${ORIGIN}/duel/${MATCH_ID}#invite=${PARTICIPANT_A_TOKEN}`),
)
expectInvitationInvalid(() =>
  parseDuelInvitationUrl(`${ORIGIN}/duel/${MATCH_ID}#invite=${PARTICIPANT_B_TOKEN}`),
)

expectParticipantInvalid(() =>
  buildDuelParticipantUrl(ORIGIN, MATCH_ID, '3cb_pa1_not-valid'),
)
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(`${ORIGIN}/duel/${MATCH_ID}#p=3cb_pa1_not-valid`),
)
expectParticipantInvalid(() =>
  buildDuelParticipantUrl(ORIGIN, 'not-a-uuid', PARTICIPANT_A_TOKEN),
)
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(`${ORIGIN}/duel/not-a-uuid#p=${PARTICIPANT_A_TOKEN}`),
)
expectParticipantInvalid(() => parseDuelParticipantUrl(`${ORIGIN}/duel/${MATCH_ID}`))
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(`${ORIGIN}/duel/${MATCH_ID}#p=`),
)
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(
    `${ORIGIN}/duel/${MATCH_ID}?p=${PARTICIPANT_A_TOKEN}`,
  ),
)
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(
    `${ORIGIN}/duel/${MATCH_ID}?key=${PARTICIPANT_A_TOKEN}#p=${PARTICIPANT_A_TOKEN}`,
  ),
)
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(`${ORIGIN}/duel/${MATCH_ID}#key=${PARTICIPANT_A_TOKEN}`),
)
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(
    `${ORIGIN}/duel/${MATCH_ID}#p=${PARTICIPANT_A_TOKEN}&invite=${INVITATION_TOKEN}`,
  ),
)
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(
    `${ORIGIN}/duel/${MATCH_ID}#invite=${INVITATION_TOKEN}&p=${PARTICIPANT_A_TOKEN}`,
  ),
)
expectInvitationInvalid(() =>
  parseDuelInvitationUrl(
    `${ORIGIN}/duel/${MATCH_ID}#invite=${INVITATION_TOKEN}&p=${PARTICIPANT_A_TOKEN}`,
  ),
)
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(
    `${ORIGIN}/other/${MATCH_ID}#p=${PARTICIPANT_A_TOKEN}`,
  ),
)
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(
    `${ORIGIN}/duel/${MATCH_ID}/%2e%2e#p=${PARTICIPANT_A_TOKEN}`,
  ),
)
expectParticipantInvalid(() =>
  buildDuelParticipantUrl(`${ORIGIN}/path`, MATCH_ID, PARTICIPANT_A_TOKEN),
)
expectParticipantInvalid(() =>
  parseDuelParticipantUrl(
    `${ORIGIN}/duel/${MATCH_ID}#p=${encodeURIComponent(PARTICIPANT_A_TOKEN)}%ZZ`,
  ),
)

const source = await readFile('src/duel/duelInvitation.ts', 'utf8')
assert(source.includes('buildDuelParticipantUrl'))
assert(source.includes('parseDuelParticipantUrl'))
assert(!source.includes('../server/'))
assert(!source.includes('node:crypto'))
assert(!source.includes('console.'))
assert(!source.includes('localStorage'))
assert(!new DuelParticipantUrlError().message.includes(PARTICIPANT_A_TOKEN))

console.log('verify-duel-participant-url: all checks passed')
