import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  canUseWebShare,
  copyDuelInviteUrl,
  DuelInviteActionError,
  readDuelInviteUrl,
  renderDuelInviteQrSvg,
  shareDuelInviteUrl,
} from '../src/duel/duelInviteActions'
import { createDuelInvitationUrl } from '../src/duel/duelInvitation'
import {
  invitationStorageKey,
  participantStorageKey,
  type StorageAdapter,
} from '../src/duel/duelPersistence'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const INVITATION_TOKEN = `3cb_pi1_${'a'.repeat(42)}A`
const PARTICIPANT_A_TOKEN = `3cb_pa1_${'c'.repeat(42)}A`
const PARTICIPANT_B_TOKEN = `3cb_pb1_${'d'.repeat(42)}A`
const ORIGIN = 'https://example.test'
const EXPECTED_URL = `${ORIGIN}/duel/${MATCH_ID}#invite=${INVITATION_TOKEN}`

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

function setParticipant(
  storage: MemoryStorage,
  role: 'A' | 'B',
  token: string,
) {
  storage.setItem(
    participantStorageKey(MATCH_ID),
    JSON.stringify({ version: 1, matchId: MATCH_ID, role, token }),
  )
}

function setInvitation(storage: MemoryStorage) {
  storage.setItem(
    invitationStorageKey(MATCH_ID),
    JSON.stringify({ version: 1, matchId: MATCH_ID, token: INVITATION_TOKEN }),
  )
}

async function main() {
  const storage = new MemoryStorage()
  setParticipant(storage, 'A', PARTICIPANT_A_TOKEN)
  setInvitation(storage)

  const inviteUrl = readDuelInviteUrl(storage, MATCH_ID, ORIGIN)
  assert.equal(inviteUrl, EXPECTED_URL)
  assert.equal(
    inviteUrl,
    createDuelInvitationUrl(ORIGIN, MATCH_ID, INVITATION_TOKEN),
  )
  assert(inviteUrl.includes(`/duel/${MATCH_ID}#invite=`))
  assert(!inviteUrl.includes('?'))
  assert(!inviteUrl.includes(PARTICIPANT_A_TOKEN))
  assert(!inviteUrl.includes(PARTICIPANT_B_TOKEN))

  const bStorage = new MemoryStorage()
  setParticipant(bStorage, 'B', PARTICIPANT_B_TOKEN)
  setInvitation(bStorage)
  assert.throws(
    () => readDuelInviteUrl(bStorage, MATCH_ID, ORIGIN),
    (error: unknown) => error instanceof DuelInviteActionError,
  )

  let written = ''
  const copyOk = await copyDuelInviteUrl(inviteUrl, {
    writeText: async (value) => {
      written = value
    },
  })
  assert.equal(copyOk, 'copied')
  assert.equal(written, EXPECTED_URL)

  const copyFail = await copyDuelInviteUrl(inviteUrl, {
    writeText: async () => {
      throw new Error(`clipboard failed ${INVITATION_TOKEN}`)
    },
  })
  assert.equal(copyFail, 'failed')

  assert.equal(canUseWebShare({ share: async () => {} }), true)
  assert.equal(canUseWebShare({} as Pick<Navigator, 'share'>), false)
  assert.equal(canUseWebShare(undefined), false)

  const shareOk = await shareDuelInviteUrl(
    inviteUrl,
    '3 COINS BOMB',
    {
      share: async (data) => {
        assert.equal(data?.url, EXPECTED_URL)
        assert.equal(data?.title, '3 COINS BOMB')
      },
    },
  )
  assert.equal(shareOk, 'shared')

  const shareCancel = await shareDuelInviteUrl(inviteUrl, '3 COINS BOMB', {
    share: async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    },
  })
  assert.equal(shareCancel, 'cancelled')

  const shareUnavailable = await shareDuelInviteUrl(
    inviteUrl,
    '3 COINS BOMB',
    {} as Pick<Navigator, 'share'>,
  )
  assert.equal(shareUnavailable, 'unavailable')

  const svg = renderDuelInviteQrSvg(inviteUrl)
  assert(svg.includes('<svg'))
  assert(svg.includes(EXPECTED_URL) || svg.length > 80)

  assert.throws(
    () => renderDuelInviteQrSvg(`${ORIGIN}/duel/${MATCH_ID}?invite=${INVITATION_TOKEN}`),
    (error: unknown) => error instanceof DuelInviteActionError,
  )

  const flowSource = await readFile('src/components/DuelFlow.tsx', 'utf8')
  const bootstrapSource = await readFile(
    'src/components/DuelClaimBootstrap.tsx',
    'utf8',
  )
  const panelSource = await readFile('src/components/DuelInvitePanel.tsx', 'utf8')
  const actionsSource = await readFile('src/duel/duelInviteActions.ts', 'utf8')

  assert(flowSource.includes('DuelInvitePanel'))
  assert(flowSource.includes('!participantB && lockedMatchId'))
  assert(!flowSource.includes('duelLockConfirm'))
  assert(flowSource.includes('window.confirm(t.duelStartOverConfirm)'))
  assert(bootstrapSource.includes('DuelInvitePanel'))
  assert(panelSource.includes('duelInviteCopy'))
  assert(panelSource.includes('duelInviteShare'))
  assert(panelSource.includes('duelInviteQr'))
  assert(panelSource.includes('opponent.claimed'))
  assert(panelSource.includes('duelInviteOpponentJoined'))
  assert(!panelSource.includes('console.'))
  assert(actionsSource.includes("from 'uqr'"))
  assert(actionsSource.includes('createDuelInvitationUrl'))
  assert(!actionsSource.includes('api.qrserver'))
  assert(!actionsSource.includes('chart.googleapis'))
  assert(!actionsSource.includes('../server/'))
  assert(!actionsSource.includes('console.'))
  assert(!actionsSource.includes('node:crypto'))

  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    dependencies: Record<string, string>
  }
  assert(packageJson.dependencies.uqr)

  console.log('verify-duel-invite-share-client: all checks passed')
}

await main()
