/**
 * Browser layout check for GROUP completion waiting counts (JA/EN × viewports).
 * Requires: Vite on :5173 and Chrome remote debugging on :9222.
 */
import assert from 'node:assert/strict'

const viewportList = [
  [320, 568],
  [375, 667],
  [390, 844],
  [768, 1024],
  [1280, 800],
]

const ratioCases = [
  [1, 2],
  [9, 10],
  [10, 20],
  [19, 20],
  [20, 20],
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
    throw new Error(result.exceptionDetails.text || 'evaluate failed')
  }
  return result.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await new Promise((resolve) => setTimeout(resolve, 600))

const report = []

for (const [width, height] of viewportList) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768,
  })

  for (const locale of ['ja', 'en']) {
    for (const [accepted, limit] of ratioCases) {
      for (const completed of [0, Math.min(accepted, limit)]) {
        const measured = await evaluate(`(async () => {
          const { ${locale} } = await import('/src/i18n/${locale}.ts')
          const t = ${locale}
          document.documentElement.lang = '${locale}'
          document.body.innerHTML = ''
          const root = document.createElement('div')
          root.className = 'duel-flow duel-flow--setup group-completion-waiting'
          root.innerHTML = \`
            <div class="duel-status-slot" aria-hidden="true"></div>
            <div class="duel-setup-spacer duel-setup-spacer--top" aria-hidden="true"></div>
            <div class="duel-setup-hero">
              <p class="duel-instruction">\${t.groupPlayComplete}</p>
              <div class="group-completion-waiting__stats">
                <span class="group-completion-waiting__label">\${t.groupReadyPlayersLabel}</span>
                <span class="group-completion-waiting__count">
                  <span class="duel-num">${accepted}</span>
                  <span class="group-completion-waiting__slash" aria-hidden="true"> / </span>
                  <span class="duel-num">${limit}</span>
                </span>
                <span class="group-completion-waiting__label">\${t.groupCompletedLabel}</span>
                <span class="group-completion-waiting__count">
                  <span class="duel-num">${completed}</span>
                  <span class="group-completion-waiting__slash" aria-hidden="true"> / </span>
                  <span class="duel-num">${limit}</span>
                </span>
              </div>
              <p class="duel-lock-error stable-message-slot stable-message-slot--waiting-error" aria-hidden="true">&nbsp;</p>
              <div class="group-completion-waiting__aux">
                <button type="button" class="duel-btn duel-btn--quiet-top group-completion-waiting__close">\${t.groupClose}</button>
              </div>
            </div>
            <div class="duel-setup-spacer duel-setup-spacer--mid" aria-hidden="true"></div>
            <div class="duel-btn-area duel-button-field" aria-hidden="true"></div>
            <div class="duel-setup-spacer duel-setup-spacer--bottom" aria-hidden="true"></div>
          \`
          document.body.appendChild(root)
          const link = document.querySelector('link[rel="stylesheet"]')
          if (link) await new Promise((r) => { if (link.sheet) r(); else link.addEventListener('load', r, { once: true }) })
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

          const stats = root.querySelector('.group-completion-waiting__stats')
          const counts = [...root.querySelectorAll('.group-completion-waiting__count')]
          const aux = root.querySelector('.group-completion-waiting__aux')
          const closeBtn = root.querySelector('.group-completion-waiting__close')
          const statsRect = stats.getBoundingClientRect()
          const auxRect = aux.getBoundingClientRect()
          const countWidths = counts.map((el) => el.getBoundingClientRect().width)
          const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5
          const statsOverflow = stats.scrollWidth > stats.clientWidth + 0.5
          return {
            statsWidth: statsRect.width,
            statsLeft: statsRect.left,
            auxTop: auxRect.top,
            closeTop: closeBtn.getBoundingClientRect().top,
            countWidths,
            overflowX,
            statsOverflow,
            viewportOverflow: root.scrollWidth > ${width} + 0.5,
          }
        })()`)

        assert.equal(
          measured.overflowX,
          false,
          `overflow-x ${locale} ${width}x${height} ${accepted}/${limit}`,
        )
        assert.equal(
          measured.statsOverflow,
          false,
          `stats overflow ${locale} ${width}x${height}`,
        )
        assert.equal(
          measured.viewportOverflow,
          false,
          `root overflow ${locale} ${width}x${height}`,
        )
        assert.ok(
          measured.statsWidth <= width,
          `stats wider than viewport ${locale} ${width}`,
        )
        assert.ok(
          measured.countWidths.every((w) => w >= 7 * 0.5),
          `count too narrow ${locale}`,
        )
        const countDelta = Math.abs(measured.countWidths[0] - measured.countWidths[1])
        assert.ok(
          countDelta < 1,
          `count columns misaligned by ${countDelta}px (${locale} ${accepted}/${limit})`,
        )

        report.push({
          locale,
          width,
          height,
          accepted,
          completed,
          limit,
          statsWidth: Number(measured.statsWidth.toFixed(2)),
          auxTop: Number(measured.auxTop.toFixed(2)),
        })
      }
    }

    /* Digit updates must not move the close button. */
    const stability = await evaluate(`(async () => {
      const { ${locale} } = await import('/src/i18n/${locale}.ts')
      const t = ${locale}
      document.documentElement.lang = '${locale}'
      const paint = (accepted, completed, limit) => {
        document.body.innerHTML = ''
        const root = document.createElement('div')
        root.className = 'group-completion-waiting'
        root.innerHTML = \`
          <div class="duel-setup-hero">
            <p class="duel-instruction">\${t.groupPlayComplete}</p>
            <div class="group-completion-waiting__stats">
              <span class="group-completion-waiting__label">\${t.groupReadyPlayersLabel}</span>
              <span class="group-completion-waiting__count"><span class="duel-num">\${accepted}</span><span aria-hidden="true"> / </span><span class="duel-num">\${limit}</span></span>
              <span class="group-completion-waiting__label">\${t.groupCompletedLabel}</span>
              <span class="group-completion-waiting__count"><span class="duel-num">\${completed}</span><span aria-hidden="true"> / </span><span class="duel-num">\${limit}</span></span>
            </div>
            <div class="group-completion-waiting__aux">
              <button type="button" class="duel-btn duel-btn--quiet-top group-completion-waiting__close">\${t.groupClose}</button>
            </div>
          </div>
        \`
        document.body.appendChild(root)
        return root.querySelector('.group-completion-waiting__close').getBoundingClientRect().top
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const a = paint(1, 1, 2)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const b = paint(20, 19, 20)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const c = paint(20, 20, 20)
      return { a, b, c }
    })()`)
    assert.ok(
      Math.abs(stability.a - stability.b) < 1 && Math.abs(stability.b - stability.c) < 1,
      `close button shifted on count update (${locale} @ ${width}x${height}): ${JSON.stringify(stability)}`,
    )
  }
}

await send('Browser.close').catch(() => {})
socket.close()

console.log(
  'verify-group-completion-waiting-browser: OK',
  `${report.length} cases across ${viewportList.length} viewports`,
)
