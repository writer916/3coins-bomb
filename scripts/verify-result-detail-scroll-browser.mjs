import assert from 'node:assert/strict'

const viewports = [
  [320, 568],
  [375, 667],
  [390, 844],
  [768, 1024],
  [1280, 800],
]

const target = await fetch(
  'http://127.0.0.1:9222/json/new?http://127.0.0.1:5173',
  { method: 'PUT' },
).then((response) => response.json())
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
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
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description
    throw new Error(description || result.exceptionDetails.text || 'evaluate failed')
  }
  return result.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await new Promise((resolve) => setTimeout(resolve, 800))

const report = []
for (const [width, height] of viewports) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768,
  })

  for (const locale of ['ja', 'en']) {
    for (const mode of ['duel', 'group']) {
      const measurement = await evaluate(`(async () => {
        const React = (await import('/node_modules/.vite/deps/react.js')).default
        const ReactDom = await import('/node_modules/.vite/deps/react-dom_client.js')
        const createRoot = ReactDom.createRoot ?? ReactDom.default.createRoot
        const strings = (await import('/src/i18n/${locale}.ts')).${locale}
        const Component = async mode => mode === 'duel'
          ? (await import('/src/components/DuelMatchDetailScreen.tsx')).DuelMatchDetailScreen
          : (await import('/src/components/GroupResultDetailScreen.tsx')).GroupResultDetailScreen
        document.documentElement.lang = '${locale}'
        document.body.innerHTML = '<main id="detail-root" class="app"></main>'
        const rounds = Array.from({ length: 4 }, (_, index) => ({
          roundNumber: index + 1,
          endReason: index % 3 === 0 ? 'bombed' : index % 3 === 1 ? 'cashed_out' : 'cleared',
          capturedCoins: index % 4,
          openedBagCount: 4,
          bagCount: 8,
          bombBagNumber: 8,
          coinBagNumbers: [1, 2, 3],
          opens: [1, 2, 3, 4].map((bagNumber, openIndex) => ({
            openOrder: openIndex + 1,
            order: openIndex + 1,
            bagNumber,
            kind: 'empty',
            coinCount: 0,
          })),
        }))
        const detail = '${mode}' === 'duel'
          ? { matchId: 'verify', totalRounds: 4, yourRounds: rounds, opponentRounds: rounds }
          : {
              groupId: 'verify', entryKey: 'verify', nickname: 'PLAYER', isSelf: true,
              totalCoins: 6, threeCoinsComplete: 1, coinBagHits: 6, totalOpens: 12,
              coinBagHitRate: { numerator: 6, denominator: 12 }, rounds,
            }
        const RootComponent = await Component('${mode}')
        createRoot(document.querySelector('#detail-root')).render(
          React.createElement(RootComponent, { detail, t: strings, onBackToResult() {} }),
        )
        await new Promise(resolve => setTimeout(resolve, 250))
        const shellSelector = '${mode}' === 'duel' ? '.duel-match-detail' : '.group-result-detail'
        const roundsSelector = '${mode}' === 'duel' ? '.duel-match-detail__rounds' : '.group-result-detail__rounds'
        const backSelector = '${mode}' === 'duel' ? '.duel-match-detail__back' : '.group-result-detail__back'
        const shell = document.querySelector(shellSelector)
        const roundList = document.querySelector(roundsSelector)
        const back = document.querySelector(backSelector)
        const after = {
          height: roundList.getBoundingClientRect().height,
          scrollHeight: roundList.scrollHeight,
          backTop: back.getBoundingClientRect().top,
          backBottom: back.getBoundingClientRect().bottom,
          shellTop: shell.getBoundingClientRect().top,
          shellBottom: shell.getBoundingClientRect().bottom,
        }
        const brand = document.createElement('h1')
        brand.className = 'brand-title duel-final-brand'
        brand.textContent = strings.brandTitle
        const title = document.createElement('${mode}' === 'duel' ? 'p' : 'h2')
        title.className = '${mode}' === 'duel' ? 'duel-match-detail__title' : 'group-result-detail__title'
        title.textContent = '${mode}' === 'duel' ? strings.duelMatchDetails : strings.groupParticipantDetails
        shell.prepend(title)
        shell.prepend(brand)
        await new Promise(resolve => requestAnimationFrame(resolve))
        const beforeHeight = roundList.getBoundingClientRect().height
        brand.remove()
        title.remove()
        roundList.scrollTop = roundList.scrollHeight
        await new Promise(resolve => requestAnimationFrame(resolve))
        const lastRound = roundList.lastElementChild?.lastElementChild ?? roundList.lastElementChild
        const listRect = roundList.getBoundingClientRect()
        const lastRect = lastRound.getBoundingClientRect()
        return {
          beforeHeight,
          ...after,
          gain: after.height - beforeHeight,
          scrolls: after.scrollHeight > after.height,
          lastVisible: lastRect.bottom <= listRect.bottom + 1,
          backVisible: after.backBottom <= innerHeight,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          brandCount: document.querySelectorAll(shellSelector + ' .brand-title').length,
          titleCount: document.querySelectorAll(shellSelector + ' > .duel-match-detail__title, ' + shellSelector + ' > .group-result-detail__title').length,
        }
      })()`)
      assert.ok(measurement.gain > 0, `${mode} ${locale} ${width}x${height}: no height gain`)
      assert.equal(measurement.scrolls, true)
      assert.equal(measurement.lastVisible, true)
      assert.equal(measurement.backVisible, true)
      assert.equal(measurement.horizontalOverflow, false)
      assert.equal(measurement.brandCount, 0)
      assert.equal(measurement.titleCount, 0)
      report.push({ viewport: `${width}x${height}`, locale, mode, ...measurement })
    }
  }
}

for (const [width, height] of viewports) {
  for (const mode of ['duel', 'group']) {
    const ja = report.find((entry) => entry.viewport === `${width}x${height}` && entry.locale === 'ja' && entry.mode === mode)
    const en = report.find((entry) => entry.viewport === `${width}x${height}` && entry.locale === 'en' && entry.mode === mode)
    assert.ok(ja && en)
    assert.ok(Math.abs(ja.height - en.height) <= 1, `${mode} ${width}x${height}: locale height drift`)
    assert.ok(Math.abs(ja.backTop - en.backTop) <= 1, `${mode} ${width}x${height}: locale button drift`)
  }
}

console.log(JSON.stringify(report, null, 2))
console.log('verify:result-detail-scroll-browser OK')
socket.close()
