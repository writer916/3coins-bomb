/**
 * Eng2: start-confirm after both LOCK — no auto-PLAY on normal A/B flows.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  formatDuelMatchCreatedAtEn,
  formatDuelMatchCreatedAtJa,
} from '../src/duel/duelMatchCreatedAt'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'

const SAMPLE_ISO = '2026-10-03T14:00:00.000Z' // 23:00 JST

assert.equal(formatDuelMatchCreatedAtJa(SAMPLE_ISO), '2026年10月3日 23:00 作成')
assert.equal(
  formatDuelMatchCreatedAtEn(SAMPLE_ISO),
  'Created Oct 3, 2026, 11:00 PM',
)
assert.equal(ja.duelMatchCreatedAt(SAMPLE_ISO), '2026年10月3日 23:00 作成')
assert.equal(en.duelMatchCreatedAt(SAMPLE_ISO), 'Created Oct 3, 2026, 11:00 PM')

assert.equal(ja.duelStartConfirmReady, 'お互いの配置が完了しました')
assert.equal(en.duelStartConfirmReady, 'BOTH PLACEMENTS ARE COMPLETE')
assert.equal(ja.duelStartConfirmRoundsLabel, 'ROUND数')
assert.equal(en.duelStartConfirmRoundsLabel, 'ROUNDS')
assert.equal(ja.duelStartConfirmRoundsValue(5), '5 ROUND')
assert.equal(en.duelStartConfirmRoundsValue(5), '5')
assert.equal(ja.duelStartConfirmStart, '対戦をはじめる')
assert.equal(en.duelStartConfirmStart, 'START DUEL')

const confirmSource = await readFile(
  'src/components/DuelStartConfirm.tsx',
  'utf8',
)
assert(confirmSource.includes('duelStartConfirmReady'))
assert(confirmSource.includes('duelStartConfirmStart'))
assert(confirmSource.includes('duelReturnToTop'))
assert(confirmSource.includes('duelMatchCreatedAt'))
assert(confirmSource.includes('totalRounds'))
assert(confirmSource.includes('onStart'))
assert(confirmSource.includes('withDuelNums'))
assert(confirmSource.includes('withDuelNums(createdLabel)'))
assert(!confirmSource.includes('fetch('))
assert(!confirmSource.includes('/api/'))
assert(!confirmSource.includes('localStorage'))

const panelSource = await readFile('src/components/DuelInvitePanel.tsx', 'utf8')
assert(panelSource.includes('DuelStartConfirm'))
assert(panelSource.includes('inviteWizardFinished'))
assert(panelSource.includes('onFinishInviteWizard'))
assert(panelSource.includes('startedPlay'))
assert(panelSource.includes('inInviteWizard'))
assert(panelSource.includes('hasWizardUrls'))
assert(panelSource.includes('parseMatchMeta'))
assert(panelSource.includes('createdAt'))
assert(panelSource.includes('totalRounds'))
/* Wizard stays while URLs present and not finished — Eng1. */
assert(panelSource.includes('hasWizardUrls && !inviteWizardFinished'))
/* Auto-PLAY only for degraded resume (no wizard URLs), not normal flow. */
assert(panelSource.includes('playReady && !inInviteWizard && !hasWizardUrls'))
assert(panelSource.includes('inviteWizardFinished'))
assert(panelSource.includes('DuelPlayScreen'))
assert(panelSource.includes('DuelStartConfirm'))
/* No persisted start / invite-complete flags. */
assert(!panelSource.includes('localStorage.setItem'))
assert(!panelSource.includes('inviteFlowComplete'))
assert(!panelSource.includes('console.'))

const flowSource = await readFile('src/components/DuelFlow.tsx', 'utf8')
assert(flowSource.includes('DuelStartConfirm'))
assert(flowSource.includes('bStartedPlay'))
assert(flowSource.includes('existingCreatedAt'))
assert(flowSource.includes('participantB && lockedMatchId'))
/* B must not jump straight to Play without start-confirm gate. */
assert(
  !flowSource.includes(
    'if (participantB && lockedMatchId) {\n      return <DuelPlayScreen',
  ),
)

const bootstrapSource = await readFile(
  'src/components/DuelClaimBootstrap.tsx',
  'utf8',
)
assert(bootstrapSource.includes('createdAt: result.state.createdAt'))
assert(bootstrapSource.includes("kind === 'play'"))
assert(bootstrapSource.includes("kind === 'start-confirm'"))
assert(bootstrapSource.includes('DuelPlayScreen'))
assert(bootstrapSource.includes('DuelStartConfirm'))
assert(bootstrapSource.includes('fetchPlayState'))

const resumeSource = await readFile('src/duel/duelResumeState.ts', 'utf8')
const lockedResumeSource = await readFile(
  'src/duel/duelLockedResume.ts',
  'utf8',
)
/* Match/completion classifier stays completion-only; OPEN split is locked-resume. */
assert(resumeSource.includes("kind: 'play'"))
assert(!resumeSource.includes('start-confirm'))
assert(lockedResumeSource.includes('start-confirm'))
assert(lockedResumeSource.includes('duelPlayHasSelfOpenedBags'))
assert(lockedResumeSource.includes('fetchPlayState'))

const appSource = await readFile('src/App.tsx', 'utf8')
assert(appSource.includes('onGoTop={goTop}'))
assert(!appSource.includes('removeItem(participantStorageKey'))

console.log('verify-duel-start-confirm-client: all checks passed')
