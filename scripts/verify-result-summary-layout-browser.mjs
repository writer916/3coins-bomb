import assert from 'node:assert/strict'

const viewports = [[320, 568], [375, 667], [390, 844], [768, 1024], [1280, 800]]
const target = await fetch('http://127.0.0.1:9222/json/new?http://127.0.0.1:5173', { method: 'PUT' }).then((response) => response.json())
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
  const id = ++commandId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
  }
  return response.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await new Promise((resolve) => setTimeout(resolve, 800))

const report = []
for (const [width, height] of viewports) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 })
  for (const locale of ['ja', 'en']) {
    for (const mode of ['duel', 'group']) {
      const result = await evaluate(`(async () => {
        const React = (await import('/node_modules/.vite/deps/react.js')).default
        const ReactDom = await import('/node_modules/.vite/deps/react-dom_client.js')
        const createRoot = ReactDom.createRoot ?? ReactDom.default.createRoot
        const t = (await import('/src/i18n/${locale}.ts')).${locale}
        const isDuel = '${mode}' === 'duel'
        const Screen = isDuel
          ? (await import('/src/components/DuelResultScreen.tsx')).DuelResultScreen
          : (await import('/src/components/GroupResultScreen.tsx')).GroupResultScreen
        document.documentElement.lang = '${locale}'
        document.body.innerHTML = '<main class="app app--duel"><div class="field-header"><header class="app-header"><h1 id="mode-title" class="brand-title duel-setup-heading"></h1></header></div><div id="result-root"></div></main>'
        document.querySelector('#mode-title').textContent = isDuel ? t.modeDuelName : t.modeGroupName
        const duelSummary = { totalCapturedCoins: 30, threeCoinsComplete: 10, bombsHit: 2, coinBagHits: 20, totalOpens: 40, hitRate: { numerator: 20, denominator: 40 }, rounds: [{ roundNumber: 1, endReason: 'cleared', capturedCoins: 3, openedBagCount: 3 }] }
        const duelResult = { matchId: '11111111-1111-4111-8111-111111111111', status: 'completed', viewerRole: 'A', totalRounds: 1, winner: 'A', participants: { A: { role: 'A', ...duelSummary }, B: { role: 'B', ...duelSummary, totalCapturedCoins: 27 } } }
        const ranking = Array.from({ length: 20 }, (_, index) => ({ rank: index + 1, entryKey: 'entry-' + index, nickname: index === 0 ? 'VERY-LONG-NICKNAME-PLAYER-01' : 'PLAYER' + (index + 1), isSelf: index === 4, totalCoins: 60 - index, threeCoinsComplete: 20 - Math.min(index, 20), coinBagHits: 40, totalOpens: 80, coinBagHitRate: { numerator: 40, denominator: 80 } }))
        const groupResult = { groupId: 'verify', totalRounds: 20, playerLimit: 20, acceptedCount: 20, completedCount: 20, status: 'closed', ranking }
        const props = isDuel
          ? { matchId: duelResult.matchId, initialResult: duelResult, fetchResult: async () => duelResult, fetchDetail: async () => ({}), t, initialRevealed: true, onGoTop() {} }
          : { result: groupResult, t, onGoTop() {}, fetchDetail: async () => ({}) }
        createRoot(document.querySelector('#result-root')).render(React.createElement(Screen, props))
        await new Promise(resolve => setTimeout(resolve, 250))
        const root = document.querySelector(isDuel ? '.duel-final--completed' : '.group-result')
        const button = document.querySelector(isDuel ? '.duel-final-return' : '.group-result__top')
        const resultTitle = document.querySelector(isDuel ? '.duel-final-kicker' : '.group-result__title')
        const buttonRect = button.getBoundingClientRect()
        const output = {
          modeTitle: document.querySelector('#mode-title').textContent,
          resultTitle: resultTitle.textContent,
          brandCount: root.querySelectorAll('.duel-final-brand').length,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          resultTitleTop: resultTitle.getBoundingClientRect().top,
          buttonTop: buttonRect.top,
          buttonHeight: buttonRect.height,
          buttonWidth: buttonRect.width,
        }
        if (!isDuel) {
          const headings = [...document.querySelectorAll('.group-result__h-metric')]
          const firstMetrics = [...document.querySelectorAll('.group-result__entry:first-child .group-result__metric')]
          const firstRowCells = [...document.querySelectorAll('.group-result__entry:first-child > *')]
          const nickname = document.querySelector('.group-result__entry:first-child .group-result__nickname')
          const rankingNode = document.querySelector('.group-result__ranking')
          const tableNode = document.querySelector('.group-result__table')
          const background = getComputedStyle(document.querySelector('.group-result__header')).backgroundColor
          tableNode.scrollTop = tableNode.scrollHeight
          await new Promise(resolve => requestAnimationFrame(resolve))
          const lastRect = rankingNode.lastElementChild.getBoundingClientRect()
          const tableRect = tableNode.getBoundingClientRect()
          Object.assign(output, {
            headingLines: headings.map(heading => [...heading.children].map(node => node.textContent)),
            headingWidths: headings.map(heading => heading.getBoundingClientRect().width),
            headingLineWidths: headings.map(heading => [...heading.children].map(line => line.scrollWidth)),
            headingLinesFit: headings.every(heading => [...heading.children].every(line => line.getBoundingClientRect().width <= heading.getBoundingClientRect().width + 0.5)),
            headingBackground: background,
            columnCenterDeltas: headings.map((heading, index) => {
              const headingRect = heading.getBoundingClientRect()
              const metricRect = firstMetrics[index].getBoundingClientRect()
              return Math.abs((headingRect.left + headingRect.width / 2) - (metricRect.left + metricRect.width / 2))
            }),
            rowCellsOverlap: firstRowCells.some((cell, index) => index > 0 && cell.getBoundingClientRect().left < firstRowCells[index - 1].getBoundingClientRect().right - 0.5),
            nicknameWidth: nickname.getBoundingClientRect().width,
            nicknameEllipsized: nickname.scrollWidth > nickname.clientWidth && getComputedStyle(nickname).textOverflow === 'ellipsis',
            gridColumns: getComputedStyle(document.querySelector('.group-result__header')).gridTemplateColumns,
            rankingScrolls: tableNode.scrollHeight > tableNode.clientHeight,
            lastVisible: lastRect.bottom <= tableRect.bottom + 1,
            buttonVisible: button.getBoundingClientRect().bottom <= innerHeight,
          })
        }
        return output
      })()`)
      assert.equal(result.resultTitle, 'RESULT')
      assert.equal(result.brandCount, 0)
      assert.equal(result.horizontalOverflow, false)
      assert.ok(result.modeTitle.length > 0)
      if (mode === 'group') {
        assert.deepEqual(result.headingLines, [['TOTAL', 'COINS'], ['3COINS', 'COMPLETE'], ['COIN-BAG', 'HIT RATE']])
        assert.equal(result.headingLinesFit, true, `${width}x${height} ${locale}: grid ${result.gridColumns}; heading widths ${result.headingWidths}; line widths ${JSON.stringify(result.headingLineWidths)}`)
        assert.equal(result.headingBackground, 'rgba(0, 0, 0, 0)')
        assert.ok(result.columnCenterDeltas.every(delta => delta <= 1), `${width}x${height} ${locale}: metric center deltas ${result.columnCenterDeltas}`)
        assert.equal(result.rowCellsOverlap, false)
        assert.equal(result.nicknameEllipsized, true)
        if (width <= 390) assert.equal(result.rankingScrolls, true)
        assert.equal(result.lastVisible, true)
        assert.equal(result.buttonVisible, true)
      }
      report.push({ viewport: `${width}x${height}`, locale, mode, ...result })
    }
  }
}

for (const [width, height] of viewports) {
  for (const mode of ['duel', 'group']) {
    const ja = report.find((entry) => entry.viewport === `${width}x${height}` && entry.locale === 'ja' && entry.mode === mode)
    const en = report.find((entry) => entry.viewport === `${width}x${height}` && entry.locale === 'en' && entry.mode === mode)
    assert.ok(ja && en)
    assert.ok(Math.abs(ja.buttonWidth - en.buttonWidth) <= 1)
    assert.ok(Math.abs(ja.buttonHeight - en.buttonHeight) <= 1)
    assert.ok(Math.abs(ja.resultTitleTop - en.resultTitleTop) <= 1)
    assert.ok(Math.abs(ja.buttonTop - en.buttonTop) <= 1)
  }
}

console.log(JSON.stringify(report, null, 2))
console.log('verify:result-summary-layout-browser OK')
socket.close()
