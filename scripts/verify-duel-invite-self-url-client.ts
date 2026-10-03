import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  copyDuelInviteUrl,
  formatDuelShareUrlForDisplay,
  readDuelInviteUrl,
  readDuelParticipantCapabilityUrl,
  shareDuelInviteUrl,
} from '../src/duel/duelInviteActions'
import { buildDuelParticipantUrl } from '../src/duel/duelInvitation'
import {
  invitationStorageKey,
  participantStorageKey,
  type StorageAdapter,
} from '../src/duel/duelPersistence'
import { ja } from '../src/i18n/ja'
import { en } from '../src/i18n/en'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const INVITATION_TOKEN = `3cb_pi1_${'a'.repeat(42)}A`
const PARTICIPANT_A_TOKEN = `3cb_pa1_${'c'.repeat(42)}A`
const ORIGIN = 'https://example.test'

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

const storage = new MemoryStorage()
storage.setItem(
  participantStorageKey(MATCH_ID),
  JSON.stringify({
    version: 1,
    matchId: MATCH_ID,
    role: 'A',
    token: PARTICIPANT_A_TOKEN,
  }),
)
storage.setItem(
  invitationStorageKey(MATCH_ID),
  JSON.stringify({ version: 1, matchId: MATCH_ID, token: INVITATION_TOKEN }),
)

const inviteUrl = readDuelInviteUrl(storage, MATCH_ID, ORIGIN)
const selfUrl = readDuelParticipantCapabilityUrl(storage, MATCH_ID, ORIGIN)
assert.equal(inviteUrl, `${ORIGIN}/duel/${MATCH_ID}#invite=${INVITATION_TOKEN}`)
assert.equal(
  selfUrl,
  buildDuelParticipantUrl(ORIGIN, MATCH_ID, PARTICIPANT_A_TOKEN),
)
assert(inviteUrl.includes('#invite='))
assert(!inviteUrl.includes('#p='))
assert(!inviteUrl.includes(PARTICIPANT_A_TOKEN))
assert(selfUrl.includes('#p='))
assert(!selfUrl.includes('#invite='))
assert(!selfUrl.includes(INVITATION_TOKEN))
assert(selfUrl.includes(PARTICIPANT_A_TOKEN))

assert.equal(
  formatDuelShareUrlForDisplay(selfUrl),
  'example.test/duel/…',
)
assert.equal(
  formatDuelShareUrlForDisplay(inviteUrl),
  'example.test/duel/…',
)
assert(!formatDuelShareUrlForDisplay(selfUrl).includes(PARTICIPANT_A_TOKEN))

let copied = ''
assert.equal(
  await copyDuelInviteUrl(selfUrl, {
    writeText: async (value) => {
      copied = value
    },
  }),
  'copied',
)
assert.equal(copied, selfUrl)
assert(copied.includes('#p='))

let sharedUrl = ''
assert.equal(
  await shareDuelInviteUrl(selfUrl, '3 COINS BOMB', {
    share: async (data) => {
      sharedUrl = data?.url ?? ''
    },
  }),
  'shared',
)
assert.equal(sharedUrl, selfUrl)

assert.equal(ja.duelInviteUrlLabel, '相手用URL')
assert.equal(ja.duelSelfUrlLabel, 'あなた用URL')
assert.equal(ja.duelInviteNext, '次へ')
assert.equal(ja.duelReturnToTop, 'トップへ戻る')
assert(ja.duelSelfUrlIntro.includes('保管'))
assert.equal(en.duelInviteUrlLabel, 'Invite URL')
assert.equal(en.duelSelfUrlLabel, 'Your URL')
assert.equal(en.duelInviteNext, 'NEXT')

const panelSource = await readFile('src/components/DuelInvitePanel.tsx', 'utf8')
assert(panelSource.includes("useState<InvitePage>('opponent')"))
assert(panelSource.includes("setPage('self')"))
assert(panelSource.includes('readDuelParticipantCapabilityUrl'))
assert(panelSource.includes('buildDuelParticipantUrl') === false)
assert(panelSource.includes('formatDuelShareUrlForDisplay'))
assert(panelSource.includes('t.duelInviteNext'))
assert(panelSource.includes('t.duelReturnToTop'))
assert(panelSource.includes('t.duelSelfUrlLabel'))
assert(panelSource.includes('onGoTop'))
assert(panelSource.includes('DUEL_READY_POLL_INTERVAL_MS = 5_000'))
assert(panelSource.includes('setInterval'))
assert.equal([...panelSource.matchAll(/\buseEffect\s*\(/g)].length, 1)
assert.equal([...panelSource.matchAll(/setInterval\s*\(/g)].length, 1)
assert(panelSource.includes('playReady'))
assert(panelSource.includes('DuelPlayScreen'))
assert(!panelSource.includes('console.'))

const actionsSource = await readFile('src/duel/duelInviteActions.ts', 'utf8')
assert(actionsSource.includes('readDuelParticipantCapabilityUrl'))
assert(actionsSource.includes('buildDuelParticipantUrl'))
assert(!actionsSource.includes('console.'))

const appSource = await readFile('src/App.tsx', 'utf8')
assert(appSource.includes('setDuelBootstrapUrl(null)'))
assert(appSource.includes("replaceState(null, '', '/')"))
assert(appSource.includes('onGoTop={goTop}'))

const flowSource = await readFile('src/components/DuelFlow.tsx', 'utf8')
assert(flowSource.includes('onGoTop={onGoTop}'))

const bootstrapSource = await readFile(
  'src/components/DuelClaimBootstrap.tsx',
  'utf8',
)
assert(bootstrapSource.includes('onGoTop={onGoTop}'))

/* TOP return must not clear participant LS helpers */
assert(!appSource.includes('removeItem(participantStorageKey'))
assert(!panelSource.includes('removeItem('))
assert(!panelSource.includes('localStorage.clear'))

console.log('verify-duel-invite-self-url-client: all checks passed')
