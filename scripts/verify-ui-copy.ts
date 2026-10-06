import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'

const [flow, invite, appCss, jaSource, enSource] = await Promise.all([
  readFile('src/components/DuelFlow.tsx', 'utf8'),
  readFile('src/components/DuelInvitePanel.tsx', 'utf8'),
  readFile('src/App.css', 'utf8'),
  readFile('src/i18n/ja.ts', 'utf8'),
  readFile('src/i18n/en.ts', 'utf8'),
])

assert.deepEqual(
  {
    roundsHint: ja.duelRoundsHint,
    continue: ja.duelContinue,
    set: ja.duelSet,
    nextRound: ja.duelNextRound,
    complete: ja.duelComplete,
    lock: ja.duelLock,
    locking: ja.duelLocking,
    roundsReady: ja.duelRoundsReady,
    inviteNext: ja.duelInviteNext,
    cashOut: ja.cashOut,
    cashOutRetry: ja.duelCashOutRetry,
    waitingTitle: ja.duelWaitingTitle,
    waitingBody: ja.duelWaitingBody,
    viewResult: ja.duelViewResult,
  },
  {
    roundsHint: 'ROUND数を決めてください',
    continue: 'OK',
    set: 'OK',
    nextRound: 'OK',
    complete: 'OK',
    lock: 'OK',
    locking: 'LOCKING...',
    roundsReady: 'すべてよろしいですか？',
    inviteNext: 'OK',
    cashOut: 'ここで利確',
    cashOutRetry: '利確できませんでした。もう一度「ここで利確」をタップしてください。',
    waitingTitle: 'プレイが完了しました',
    waitingBody: '相手のプレイを待っています',
    viewResult: '結果をみる',
  },
)

assert.equal(ja.modeSoloDesc, '3枚のコインが隠された袋を当てる')
assert.equal(ja.modeDuelDesc, '互いにコインを隠して当てる2人対戦')
assert.equal(ja.modeGroupDesc, '同じ出題をそれぞれ解いてスコアを競う')
assert.equal(ja.duelPlaceCoins, '袋をタップして\n3枚のコインを置いてください')

assert.equal(ja.duelRoundsLabel, 'ROUNDS（1–20）')
assert.equal(en.duelRoundsLabel, 'ROUNDS（1–20）')
assert.equal(ja.duelBagsLabel, 'BAGS（3–8）')
assert.equal(en.duelBagsLabel, 'BAGS（3–8）')

// Confirmed EN copy and intentionally unchanged command labels.
assert.equal(en.modeSoloDesc, 'Find the 3 hidden coins')
assert.equal(en.modeDuelDesc, 'Hide & find — 1 vs 1')
assert.equal(en.modeGroupDesc, 'Same challenge — highest score wins')
assert.equal(en.duelContinue, 'CONTINUE')
assert.equal(en.duelSet, 'CONTINUE')
assert.equal(en.duelNextRound, 'NEXT ROUND')
assert.equal(en.duelComplete, 'CONTINUE')
assert.equal(en.duelLock, 'LOCK')
assert.equal(en.duelLocking, 'LOCKING…')
assert.equal(en.duelJoining, 'JOINING THE MATCH…')
assert.equal(en.duelWaitingForOpponentPlacement, 'WAITING FOR OPPONENT')
assert.equal(en.duelInviteUrlLabel, 'INVITE LINK')
assert.equal(en.duelSelfUrlLabel, 'YOUR URL')
assert.equal(
  en.duelSelfUrlIntro,
  'Once your opponent finishes placing their coins and bomb, you can start the match from this URL. Keep it until the match ends.',
)
assert.equal(en.cashOut, 'CASH OUT')
assert.equal(en.duelInviteNext, 'NEXT')
assert.equal(en.duelWaitingTitle, 'YOUR PLAY IS COMPLETE')
assert.equal(en.duelViewResult, 'VIEW RESULT')
assert.equal(en.duelWin, 'YOU WIN')
assert.equal(en.duelLose, 'YOU LOSE')
assert.equal(en.duelDraw, 'DRAW')
assert.equal(en.duelMatchDetailError, 'Could not load details.')
assert.equal(en.duelThreeCoinsComplete, '3COINS COMPLETE')
assert.equal(en.duelRoundsReady, 'ALL ROUNDS READY')

const placeStart = flow.indexOf('data-duel-slot="buttons"')
const placeButtons = flow.slice(placeStart, placeStart + 2600)
const advance = placeButtons.indexOf('data-duel-metric="place-advance"')
const reset = placeButtons.indexOf('data-duel-metric="place-reset"')
const back = placeButtons.indexOf('onClick={onBackFromPlace}')
assert.ok(placeStart >= 0 && advance >= 0 && reset >= 0 && back >= 0)
assert.ok(advance < reset && reset < back)

// Invite layout stays SHARE / QR(or TOP) above the final OK/NEXT control.
const share = invite.indexOf('t.duelInviteShare')
const qr = invite.indexOf('t.duelInviteQr')
const top = invite.indexOf('t.duelReturnToTop', share)
const inviteNext = invite.indexOf('t.duelInviteNext')
assert.ok(share >= 0 && qr > share && top > share && inviteNext > qr && inviteNext > top)

// RESULT numeric span must escape the Georgia label selector.
assert.match(appCss, /\.duel-final-stat\s*>\s*span\s*{/)
assert.doesNotMatch(appCss, /\.duel-final-stat span\s*{/)

// No accidental fullwidth Latin letters or digits in either active catalog.
assert.doesNotMatch(jaSource, /[Ａ-Ｚａ-ｚ０-９]/)
assert.doesNotMatch(enSource, /[Ａ-Ｚａ-ｚ０-９]/)

console.log('verify:ui-copy OK')
