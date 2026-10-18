/**
 * Browser checks: GROUP/DUEL ROUND default 5, stepper hold, DAILY play layout.
 * Requires: Vite :5173 and Chrome remote debugging :9222.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const shotDir = resolve(root, 'docs/ui-copy-audit/round-daily-play-verify')
mkdirSync(shotDir, { recursive: true })

const viewports = [
  [320, 568],
  [375, 667],
  [390, 844],
  [1280, 800],
]

const target = await fetch(
  'http://127.0.0.1:9222/json/new?http://127.0.0.1:5173',
  { method: 'PUT' },
).then((response) => response.json())
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolvePromise, reject) => {
  socket.addEventListener('open', resolvePromise, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let commandId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id) return
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.error) entry.reject(new Error(message.error.message))
  else entry.resolve(message.result)
})

function send(method, params = {}) {
  commandId += 1
  const id = commandId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolvePromise, reject) =>
    pending.set(id, { resolve: resolvePromise, reject }),
  )
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluate failed')
  }
  return result.result.value
}

async function screenshot(name) {
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  })
  writeFileSync(resolve(shotDir, `${name}.png`), Buffer.from(result.data, 'base64'))
}

await send('Page.enable')
await send('Runtime.enable')
await new Promise((resolvePromise) => setTimeout(resolvePromise, 700))

// —— GROUP default ROUND = 5 ——
await evaluate(`(() => {
  localStorage.clear()
  location.hash = ''
  location.reload()
})()`)
await new Promise((resolvePromise) => setTimeout(resolvePromise, 900))

await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('button')]
  const group = buttons.find((b) => /GROUP|グループ/.test(b.textContent || ''))
  if (!group) throw new Error('GROUP button missing')
  group.click()
})()`)
await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))

const groupRounds = await evaluate(
  `document.querySelector('.num-stepper-value')?.textContent?.trim() ?? null`,
)
assert.equal(groupRounds, '5', `GROUP default ROUND expected 5, got ${groupRounds}`)
await screenshot('group-rounds-default-5')

// Hold-to-repeat on ▲
const holdResult = await evaluate(`(async () => {
  const up = document.querySelector('.num-stepper-btn')
  if (!up) throw new Error('stepper up missing')
  const before = Number(document.querySelector('.num-stepper-value').textContent)
  const rect = up.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  up.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerType: 'mouse',
    pointerId: 1,
    button: 0,
    buttons: 1,
    clientX: cx,
    clientY: cy,
  }))
  await new Promise((r) => setTimeout(r, 900))
  up.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    pointerType: 'mouse',
    pointerId: 1,
    button: 0,
    buttons: 0,
    clientX: cx,
    clientY: cy,
  }))
  await new Promise((r) => setTimeout(r, 50))
  const after = Number(document.querySelector('.num-stepper-value').textContent)
  // Trailing click should be suppressed after hold; value must have risen by >1.
  up.click()
  await new Promise((r) => setTimeout(r, 30))
  const afterClick = Number(document.querySelector('.num-stepper-value').textContent)
  return { before, after, afterClick }
})()`)
assert.ok(
  holdResult.after >= holdResult.before + 2,
  `hold should accelerate past +1: ${JSON.stringify(holdResult)}`,
)
assert.equal(
  holdResult.afterClick,
  holdResult.after,
  `hold must suppress trailing click: ${JSON.stringify(holdResult)}`,
)

// Clamp at 20
await evaluate(`(async () => {
  const up = document.querySelector('.num-stepper-btn')
  const rect = up.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  up.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerType: 'mouse',
    pointerId: 2,
    button: 0,
    buttons: 1,
    clientX: cx,
    clientY: cy,
  }))
  await new Promise((r) => setTimeout(r, 2500))
  up.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    pointerType: 'mouse',
    pointerId: 2,
    button: 0,
    buttons: 0,
    clientX: cx,
    clientY: cy,
  }))
})()`)
const atMax = await evaluate(
  `document.querySelector('.num-stepper-value')?.textContent?.trim()`,
)
assert.equal(atMax, '20')

// —— DUEL default ROUND = 5 ——
await evaluate(`(() => {
  localStorage.clear()
  location.hash = ''
  location.reload()
})()`)
await new Promise((resolvePromise) => setTimeout(resolvePromise, 900))
await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('button')]
  const duel = buttons.find((b) => /DUEL|デュエル|1vs1/i.test(b.textContent || ''))
  if (!duel) throw new Error('DUEL button missing')
  duel.click()
})()`)
await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
const duelRounds = await evaluate(
  `document.querySelector('.num-stepper-value')?.textContent?.trim() ?? null`,
)
assert.equal(duelRounds, '5', `DUEL default ROUND expected 5, got ${duelRounds}`)
await screenshot('duel-rounds-default-5')

// —— DAILY play layout mount (stub coordinator) ——
const layoutReport = []
for (const [width, height] of viewports) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
  })
  for (const locale of ['ja', 'en']) {
    for (const bagCount of [3, 5, 8]) {
      const measured = await evaluate(`(async () => {
        const ReactMod = await import('/node_modules/.vite/deps/react.js')
        const ReactDomMod = await import('/node_modules/.vite/deps/react-dom_client.js')
        const React = ReactMod.default ?? ReactMod
        const ReactDom = ReactDomMod.default ?? ReactDomMod
        const { createElement } = React
        const { DailyPlayScreen } = await import('/src/components/DailyPlayScreen.tsx')
        const { ${locale} } = await import('/src/i18n/${locale}.ts')
        document.documentElement.lang = '${locale}'
        document.body.innerHTML = ''
        const main = document.createElement('main')
        main.className = 'app app--duel app--daily-play'
        main.innerHTML = \`
          <div class="field-header">
            <header class="app-header">
              <h1 class="brand-title duel-setup-heading">\${${locale}.modeDailyName}</h1>
            </header>
          </div>
          <div id="daily-root"></div>
        \`
        document.body.appendChild(main)
        const createRoot = ReactDom.createRoot ?? ReactDom.default?.createRoot
        const coordinator = {
          getPendingOpen: () => null,
          getPendingCashOut: () => null,
          clearPendingOpen: () => {},
          clearPendingCashOut: () => {},
          openBag: async () => { throw new Error('stub') },
          cashOut: async () => { throw new Error('stub') },
          startRound: async () => { throw new Error('stub') },
          getPlay: async () => { throw new Error('stub') },
        }
        const initialState = {
          challengeDate: '2026-10-18',
          serverNow: '2026-10-18T12:00:00.000Z',
          challengeEndsAt: '2026-10-19T00:00:00.000Z',
          completedRounds: 1,
          totalCoins: 3,
          threeCoinsComplete: 1,
          nextRoundNumber: 2,
          activeAttempt: {
            roundNumber: 2,
            bagCount: ${bagCount},
            startedAt: '2026-10-18T12:00:00.000Z',
            deadlineAt: '2026-10-18T12:01:00.000Z',
            openedBagCount: 0,
            opens: [],
          },
          latestTerminalAttempt: {
            roundNumber: 1,
            bagCount: 3,
            endReason: 'cleared',
            endedAt: '2026-10-18T11:59:00.000Z',
            elapsedSeconds: 12,
            capturedCoins: 3,
            openedBagCount: 3,
            coinBagHits: 3,
            opens: [],
          },
          completedAt: null,
          expiredAt: null,
        }
        localStorage.setItem(
          '3cb:daily:v1:play-score-totals:2026-10-18',
          JSON.stringify({
            challengeDate: '2026-10-18',
            appliedRoundNumber: 1,
            totalCoins: 3,
            threeCoinsComplete: 1,
          }),
        )
        createRoot(document.querySelector('#daily-root')).render(
          createElement(DailyPlayScreen, {
            t: ${locale},
            onGoTop: () => {},
            initialState,
            coordinator,
          }),
        )
        await new Promise((r) => setTimeout(r, 120))
        const title = document.querySelector('.brand-title')
        const round = document.querySelector('.duel-round-index')
        const timer = document.querySelector('.daily-play__timer')
        const board = document.querySelector('.daily-play__board')
        const actions = document.querySelector('.daily-play__mid-actions .field-action')
        const scores = document.querySelector('.daily-play__session')
        const endSlot = document.querySelector('.daily-play__end-slot')
        const endText = document.querySelector('.daily-play__end')
        const order = [round, timer, board, actions, scores]
          .map((el) => el?.getBoundingClientRect().top ?? -1)
        const scoreText = scores?.innerText?.replace(/\\s+/g, ' ').trim() ?? ''
        return {
          orderOk:
            order[0] < order[1] &&
            order[1] < order[2] &&
            order[2] < order[3] &&
            order[3] < order[4],
          titleRoundGap:
            (round?.getBoundingClientRect().top ?? 0) -
            (title?.getBoundingClientRect().bottom ?? 0),
          hasEndSlot: Boolean(endSlot),
          hasEndText: Boolean(endText && endText.textContent && endText.textContent.trim()),
          scoreText,
          boardTop: board?.getBoundingClientRect().top ?? null,
          bagCount: document.querySelectorAll('.bag-hit').length,
        }
      })()`)
      assert.ok(measured.orderOk, `order failed ${width}x${height} ${locale} bags=${bagCount}`)
      assert.ok(measured.titleRoundGap >= 6, `title/round gap too tight: ${measured.titleRoundGap}`)
      assert.equal(measured.hasEndSlot, false)
      assert.equal(measured.hasEndText, false)
      assert.match(measured.scoreText, /(?:^|\s)COINS(?:\s|$)/)
      assert.doesNotMatch(measured.scoreText, /TOTAL COINS/)
      assert.match(measured.scoreText, /3COINS COMPLETE/)
      assert.ok(
        /(?:^|\s)3(?:\s|$)/.test(measured.scoreText),
        `missing totalCoins 3: ${measured.scoreText}`,
      )
      assert.ok(
        /(?:^|\s)1(?:\s|$)/.test(measured.scoreText),
        `missing threeCoinsComplete 1: ${measured.scoreText}`,
      )
      assert.equal(measured.bagCount, bagCount)
      layoutReport.push({ width, height, locale, bagCount, ...measured })
    }
  }
  await screenshot(`daily-play-${width}x${height}`)
}

writeFileSync(
  resolve(shotDir, 'layout-report.json'),
  JSON.stringify(layoutReport, null, 2),
)

console.log('verify-round-daily-play-browser OK')
console.log(`screenshots: ${shotDir}`)

await send('Page.close').catch(() => {})
socket.close()
process.exit(0)
